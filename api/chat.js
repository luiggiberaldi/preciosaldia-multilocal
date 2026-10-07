import { CHAT_SYSTEM_PROMPT as CHAT_SYSTEM } from '../src/services/chatSystemPrompt.js';

// Vercel Serverless Function — Proxy seguro para el Chatbot del POS Precios al Día
// Realiza rotación aleatoria (óptima para entornos serverless sin estado) y oculta las API keys de Groq.
//
// Blindaje (feat/security):
// - Rate limit por IP vía Upstash Redis (10 req/min y 200 req/día), fail-open con log.
// - CORS con allowlist (preciosaldiaoficial.vercel.app + localhost, extensible con CHAT_ALLOWED_ORIGINS).
// - El cliente no puede inyectar mensajes "system": se descartan y el servidor siempre inyecta el suyo.
// - Guardas de entrada (máx. 20 mensajes, máx. 4.000 caracteres por mensaje).
// - Sin fugas de errores internos al cliente (los bodies de Groq solo van al log del servidor).
// - reasoning_effort "low" (los tokens de razonamiento de gpt-oss consumen max_tokens) y timeouts.

// CHAT_SYSTEM vive en src/services/chatSystemPrompt.js — fuente única compartida
// con el proxy dev (vite.config.js) para que dev y producción nunca diverjan.

// ── Blindaje: constantes y helpers ──────────────────────────────────────────

const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 4000;
const GROQ_CONNECT_TIMEOUT_MS = 15000; // sin respuesta inicial → rotar a la siguiente key
const GROQ_STREAM_DEADLINE_MS = 60000; // tope global de la respuesta en streaming

// Orígenes permitidos: producción + desarrollo local. Ampliable con CHAT_ALLOWED_ORIGINS (separados por coma).
const BASE_ALLOWED_ORIGINS = [
    'https://preciosaldiaoficial.vercel.app',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
    'http://127.0.0.1:3000',
];

function getAllowedOrigins() {
    const extra = (process.env.CHAT_ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
    return [...new Set([...BASE_ALLOWED_ORIGINS, ...extra])];
}

// Devuelve los headers CORS solo si el origin es de la allowlist.
// Un origin ajeno recibe la respuesta SIN headers CORS → el navegador la bloquea.
function applyCorsHeaders(res, req) {
    const origin = req.headers.origin;
    if (origin && getAllowedOrigins().includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
}

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        return fwd.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || 'desconocida';
}

// ── Rate limit con Upstash Redis (REST puro, sin dependencias) ──────────────
// Ventana fija por IP: 10 req/min y 200 req/día.
// Fail-open: si Redis falla, se permite la request y se loguea (disponibilidad primero).

const RL_PER_MINUTE = 10;
const RL_PER_DAY = 200;
const memoryCounters = new Map(); // fallback en memoria (por instancia) si no hay Redis

function memoryIncrement(bucketKey, windowMs) {
    const now = Date.now();
    const entry = memoryCounters.get(bucketKey);
    if (!entry || now > entry.expiresAt) {
        memoryCounters.set(bucketKey, { count: 1, expiresAt: now + windowMs });
        return 1;
    }
    entry.count += 1;
    return entry.count;
}

// Limpieza oportunista del fallback en memoria para no crecer indefinidamente.
function pruneMemoryCounters() {
    if (memoryCounters.size < 500) return;
    const now = Date.now();
    for (const [k, v] of memoryCounters) {
        if (now > v.expiresAt) memoryCounters.delete(k);
    }
}

async function upstashCommand(command) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null; // sin Redis configurado → usar fallback

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(command),
            signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`Upstash HTTP ${resp.status}`);
        const data = await resp.json();
        return data.result;
    } finally {
        clearTimeout(timeout);
    }
}

// Retorna { allowed: true } o { allowed: false, retryAfterSeconds }.
async function checkRateLimit(ip) {
    const dayKey = `rl:chat:d:${new Date().toISOString().slice(0, 10)}:${ip}`;
    const minKey = `rl:chat:m:${Math.floor(Date.now() / 60000)}:${ip}`;

    try {
        const dayCount = await upstashCommand(['INCR', dayKey]);
        if (dayCount !== null) {
            if (dayCount === 1) await upstashCommand(['EXPIRE', dayKey, 86400]);
            if (dayCount > RL_PER_DAY) {
                return { allowed: false, retryAfterSeconds: 3600, reason: 'daily' };
            }
            const minCount = await upstashCommand(['INCR', minKey]);
            if (minCount === 1) await upstashCommand(['EXPIRE', minKey, 60]);
            if (minCount > RL_PER_MINUTE) {
                return { allowed: false, retryAfterSeconds: 60, reason: 'minute' };
            }
            return { allowed: true };
        }
    } catch (err) {
        console.error('[Chat API] Rate limit Redis no disponible (fail-open):', err?.message || err);
    }

    // Fallback en memoria (por instancia; protección parcial si no hay Redis)
    const minCount = memoryIncrement(`m:${Math.floor(Date.now() / 60000)}:${ip}`, 60000);
    const dayCount = memoryIncrement(`d:${new Date().toISOString().slice(0, 10)}:${ip}`, 86400000);
    pruneMemoryCounters();
    if (dayCount > RL_PER_DAY) return { allowed: false, retryAfterSeconds: 3600, reason: 'daily' };
    if (minCount > RL_PER_MINUTE) return { allowed: false, retryAfterSeconds: 60, reason: 'minute' };
    return { allowed: true };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    applyCorsHeaders(res, req);

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // 1) Rate limit por IP (antes de consumir cualquier recurso)
        const rl = await checkRateLimit(getClientIp(req));
        if (!rl.allowed) {
            res.setHeader('Retry-After', String(rl.retryAfterSeconds));
            return res.status(429).json({
                error: rl.reason === 'daily'
                    ? 'Alcanzaste el límite diario de consultas al asistente. Inténtalo de nuevo mañana.'
                    : 'Demasiadas consultas seguidas. Espera un momento e inténtalo de nuevo.',
            });
        }

        const { messages } = req.body;

        // 2) Guardas de entrada
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: "El cuerpo de la petición debe contener un arreglo de 'messages'." });
        }
        if (messages.length > MAX_MESSAGES) {
            return res.status(400).json({ error: `Demasiados mensajes (máximo ${MAX_MESSAGES}).` });
        }
        for (const m of messages) {
            if (!m || typeof m.content !== 'string' || m.content.length > MAX_CHARS_PER_MESSAGE) {
                return res.status(400).json({ error: `Cada mensaje debe ser texto de hasta ${MAX_CHARS_PER_MESSAGE} caracteres.` });
            }
        }

        // ── Proveedor multi-tenant (OpenAI-compatible) ──
        // AI_BASE_URL / AI_MODEL / AI_API_KEYS (GROQ_KEYS sigue siendo alias).
        const aiBaseUrl = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
        const aiModel = process.env.AI_MODEL || 'openai/gpt-oss-120b';
        const groqKeysStr = process.env.AI_API_KEYS || process.env.GROQ_KEYS || '';
        const allKeys = groqKeysStr.split(',').map(k => k.trim()).filter(Boolean);

        if (allKeys.length === 0) {
            return res.status(500).json({ error: 'No se encontraron claves de API configuradas en el servidor (GROQ_KEYS).' });
        }

        // 3) Anti-inyección: se descarta cualquier "system" proveniente del cliente.
        // El prompt del sistema especializado SIEMPRE lo inyecta el servidor.
        const userMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
        const formattedMessages = [{ role: 'system', content: CHAT_SYSTEM }, ...userMessages];

        const requestBody = JSON.stringify({
            model: aiModel,
            messages: formattedMessages,
            temperature: 0.4,
            max_tokens: 4096,
            reasoning_effort: 'low', // los tokens de razonamiento de gpt-oss consumen max_tokens
            stream: true,
        });

        // Rotación secuencial con retry: si una key da 429 o error 5xx,
        // se pasa automáticamente a la siguiente hasta agotar todas.
        // Empezamos por una key aleatoria para distribuir la carga entre invocaciones.
        const startIndex = Math.floor(Math.random() * allKeys.length);
        let lastError = null;

        for (let attempt = 0; attempt < allKeys.length; attempt++) {
            const keyIndex = (startIndex + attempt) % allKeys.length;
            const apiKey = allKeys[keyIndex];

            let response;
            const groqController = new AbortController();
            const connectTimeout = setTimeout(() => groqController.abort(), GROQ_CONNECT_TIMEOUT_MS);
            try {
                response = await fetch(`${aiBaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: requestBody,
                    signal: groqController.signal,
                });
            } catch (fetchErr) {
                clearTimeout(connectTimeout);
                // Timeout sin respuesta inicial o error de red — intentar con la siguiente key
                lastError = `Key[${keyIndex}] ${fetchErr?.name === 'AbortError' ? 'timeout de conexión' : 'error de red'}: ${fetchErr?.message || fetchErr}`;
                continue;
            }
            clearTimeout(connectTimeout);

            // Si es rate limit (429), llave inválida/expirada (401/403) o error de servidor (5xx), rotar a la siguiente key
            if (response.status === 429 || response.status === 401 || response.status === 403 || response.status >= 500) {
                const errBody = await response.text().catch(() => '');
                lastError = `Key[${keyIndex}] HTTP ${response.status}: ${errBody.slice(0, 500)}`;
                continue; // siguiente key
            }

            // Cualquier otro error no recuperable (ej. 400 bad request) — falla con mensaje genérico (sin body crudo)
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                console.error(`[Chat API] Error no recuperable de Groq (HTTP ${response.status}):`, errText.slice(0, 500));
                return res.status(502).json({ error: 'El asistente no pudo procesar la consulta en este momento.' });
            }

            // ✅ Key funcionó — configurar streaming y devolver respuesta (con deadline global)
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const streamDeadline = setTimeout(() => {
                try { response.body.cancel(); } catch {}
            }, GROQ_STREAM_DEADLINE_MS);

            try {
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
                res.end();
            } catch (streamErr) {
                // Cliente desconectado o deadline: cortar limpio
                try { res.end(); } catch {}
            } finally {
                clearTimeout(streamDeadline);
            }
            return; // salir del handler
        }

        // Si llegamos aquí, todas las keys fallaron — sin detalles internos al cliente.
        // Si TODAS dieron 403, la organización del proveedor está bloqueada: damos una
        // pista accionable en el mensaje (sin exponer claves ni bodies crudos).
        const allBlocked403 = /HTTP 403/.test(lastError || '');
        console.error('[Chat API] Todas las keys de IA fallaron:', lastError);
        return res.status(503).json({
            error: allBlocked403
                ? 'El servicio de IA rechazó todas las claves (403). La organización del proveedor parece bloqueada o suspendida — revisa la consola del proveedor o configura otro proveedor (AI_BASE_URL / AI_API_KEYS).'
                : 'El servicio de IA está temporalmente saturado. Por favor intenta en unos segundos.',
        });
    } catch (error) {
        console.error('[Chat API] Error inesperado:', error?.message || error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
}
