// Vercel Serverless Function — Relay de inventario con código de 6 dígitos
// Storage: Upstash Redis (REST API, gratis)

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL_SECONDS = 86400; // 24 horas
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB máximo

// Helper: ejecutar comando Redis via REST
async function redis(command, ...args) {
    const res = await fetch(`${UPSTASH_URL}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${UPSTASH_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify([command, ...args]),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

// Generar código de 6 dígitos
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
    const origin = req.headers?.origin || '';
    const allowed =
        origin.includes('localhost') ||
        origin.includes('vercel.app') ||
        origin.includes('tasasaldia') ||
        origin.includes('preciosaldia') ||
        origin.includes('github.io');
    res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        return res.status(500).json({
            error: 'Upstash Redis no configurado. Agrega UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN en las variables de entorno de Vercel.',
        });
    }

    try {
        // POST — Compartir
        if (req.method === 'POST') {
            const body = req.body;
            const payloadStr = JSON.stringify(body);

            if (payloadStr.length > MAX_PAYLOAD_BYTES) {
                return res.status(413).json({
                    error: `Payload demasiado grande (${(payloadStr.length / 1024 / 1024).toFixed(1)}MB). Máximo: 5MB.`,
                });
            }

            // Contar productos
            let productCount = 0;
            if (body?.idb?.bodega_products_v1) {
                productCount = Array.isArray(body.idb.bodega_products_v1) ? body.idb.bodega_products_v1.length : 0;
            } else if (Array.isArray(body?.products)) {
                productCount = body.products.length;
            }

            // Generar código único (reintentar si existe)
            let code;
            for (let i = 0; i < 5; i++) {
                const candidate = generateCode();
                const exists = await redis('EXISTS', `inv:${candidate}`);
                if (!exists) { code = candidate; break; }
            }
            if (!code) return res.status(500).json({ error: 'No se pudo generar un código único.' });

            const payload = JSON.stringify({
                ...body,
                isComplete: !!(body.idb),
                groups: Array.isArray(body.groups) ? body.groups : [],
                createdAt: new Date().toISOString(),
            });

            await redis('SET', `inv:${code}`, payload, 'EX', TTL_SECONDS);

            return res.status(200).json({
                code: `${code.slice(0, 3)}-${code.slice(3)}`,
                expiresIn: '24 horas',
                productCount,
            });
        }

        // GET — Importar
        if (req.method === 'GET') {
            const rawCode = req.query.code || '';
            const clean = rawCode.replace(/[-\s]/g, '');

            if (clean.length !== 6 || !/^\d+$/.test(clean)) {
                return res.status(400).json({ error: 'Código inválido. Usa el formato XXX-XXX.' });
            }

            const data = await redis('GET', `inv:${clean}`);
            if (!data) {
                return res.status(404).json({ error: 'Código no encontrado o expirado.' });
            }

            return res.status(200).json(JSON.parse(data));
        }

        return res.status(405).json({ error: 'Método no permitido.' });
    } catch (err) {
        console.error('Share API error:', err);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
}
