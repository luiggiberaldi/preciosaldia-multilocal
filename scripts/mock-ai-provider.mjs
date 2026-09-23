#!/usr/bin/env node
// mock-ai-provider.mjs — Servidor local compatible con OpenAI (/chat/completions, streaming SSE).
//
// Sirve para probar la cadena completa del asistente SIN ninguna clave de proveedor real:
//
//   1. En una terminal:      node scripts/mock-ai-provider.mjs
//   2. En .env (luego reinicia `bun run dev`):
//        AI_BASE_URL=http://127.0.0.1:5111/v1
//        AI_MODEL=mock-echo
//        AI_API_KEYS=mock-key
//   3. En el POS, abre el asistente y envía una pregunta → verás la respuesta del mock
//      transmitida por el proxy /api/chat, con el system prompt nuevo inyectado.
//
// Qué hace: recibe el payload (incluye el system prompt compartido), responde por SSE
// con un texto corto y, si pediste "debug", muestra en consola las reglas que detectó
// en el system prompt para verificar que llega bien.

import http from 'node:http';

const PORT = process.env.MOCK_PORT || 5111;

const REPLY = `**Prueba del asistente (proveedor mock local)**

El circuito funciona: tu proxy /api/chat recibió este mensaje, lo reenvió a un proveedor compatible con OpenAI y está transmitiendo la respuesta por streaming.

- Si lees esto, el system prompt nuevo ya está inyectado por el servidor.
- Pregunta algo del POS (ej. "¿cómo calcula el vuelto?") con un proveedor real para evaluar la calidad de la respuesta.`;

function detectPromptSignals(messages) {
    const sys = messages?.find?.(m => m?.role === 'system')?.content || '';
    return {
        hasSystem: Boolean(sys),
        words: sys ? sys.trim().split(/\s+/).length : 0,
        antiInvention: /NUNCA inventes rutas/.test(sys),
        wordBudget: /Máximo ~180 palabras/.test(sys),
        cashOnlyChange: /SOLO los métodos de efectivo generan vuelto/.test(sys),
    };
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
    }

    if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Usa POST /v1/chat/completions' }));
        return;
    }

    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        let messages = [];
        try {
            messages = JSON.parse(body)?.messages || [];
        } catch { /* payload inválido → seguimos con lista vacía */ }

        const signals = detectPromptSignals(messages);
        console.log('[mock] /chat/completions →', signals);

        if (process.argv.includes('--debug')) {
            console.log('[mock] system prompt recibido:',
                messages.find(m => m?.role === 'system')?.content?.slice(0, 300) || '(ninguno)');
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.flushHeaders?.();

        // Stream palabra por palabra, formato OpenAI (choices[0].delta.content)
        const tokens = REPLY.split(/(\s+)/);
        let i = 0;
        const timer = setInterval(() => {
            if (i >= tokens.length) {
                clearInterval(timer);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            }
            const chunk = {
                choices: [{ delta: { content: tokens[i] }, index: 0 }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            i += 1;
        }, 15);

        // ⚠️ En Node ≥16, req 'close' dispara al terminar el body del request
        // (no al cerrar el socket). Para detectar desconexión del cliente se
        // escucha 'close' en la RESPUESTA, no en el request.
        res.on('close', () => clearInterval(timer));
    });
});

server.listen(PORT, () => {
    console.log(`[mock] Proveedor IA de prueba en http://127.0.0.1:${PORT}/v1`);
    console.log('[mock] En .env:  AI_BASE_URL=http://127.0.0.1:' + PORT + '/v1  ·  AI_MODEL=mock-echo  ·  AI_API_KEYS=mock-key');
});
