// Vercel Serverless Function — Proxy de tasas BCV (dolarapi.com)
// Cachea en memoria por 14 minutos para no saturar la fuente externa.
import { fetchBcvRates } from './bcvRatesHelper.js';

let cache = null;
let cacheTime = 0;
const CACHE_MS = 14 * 60 * 1000;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Return cache if fresh
    if (cache && Date.now() - cacheTime < CACHE_MS) {
        return res.status(200).setHeader('X-Cache', 'HIT').json(cache);
    }

    try {
        const rates = await fetchBcvRates();

        cache = {
            bcv:  { price: rates.bcv,  source: `${rates.source} (USD)`, change: 0 },
            euro: { price: rates.euro, source: `${rates.source} (EUR)`, change: 0 },
            usdt: { price: rates.usdt, source: 'USDT Binance', change: 0 },
            lastUpdate: new Date().toISOString(),
        };
        cacheTime = Date.now();

        return res.status(200).setHeader('X-Cache', 'MISS').json(cache);

    } catch (err) {
        if (cache) {
            return res.status(200).setHeader('X-Cache', 'STALE').json({ ...cache, stale: true });
        }
        return res.status(503).json({ error: 'No se pudo obtener la tasa de cambio: ' + err.message });
    }
}
