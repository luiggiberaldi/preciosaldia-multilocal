/**
 * BCV Rates Scraper Helper
 * Realiza consultas robustas y directas al Banco Central de Venezuela (bcv.org.ve)
 * con simulación de cabeceras, bypass de certificados SSL y esquema de fallbacks.
 */

async function fetchBinanceP2PUsdt() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch('https://criptoya.com/api/binancep2p/USDT/VES/1', { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return null;

        const result = await res.json();
        if (!result) return null;

        const avgAsk = typeof result.ask === 'number' ? result.ask
            : (Array.isArray(result.ask) && result.ask.length > 0
                ? result.ask.slice(0, 3).reduce((s, i) => s + (i.price ?? i), 0) / Math.min(3, result.ask.length)
                : 0);
        const avgBid = typeof result.bid === 'number' ? result.bid
            : (Array.isArray(result.bid) && result.bid.length > 0
                ? result.bid.slice(0, 3).reduce((s, i) => s + (i.price ?? i), 0) / Math.min(3, result.bid.length)
                : 0);

        if (avgAsk <= 0 && avgBid <= 0) return null;
        const basePrice = (avgAsk > 0 && avgBid > 0) ? (avgAsk + avgBid) / 2 : (avgAsk || avgBid);

        // Regla Math.ceil + 2
        return Math.ceil(basePrice) + 2;
    } catch (e) {
        console.warn(`[BCV Helper] Fallback al calcular USDT desde CriptoYa: ${e.message}`);
        return null;
    }
}

export async function fetchBcvRates() {
    // 1. Evitar errores de certificado SSL/TLS
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const bcvUrl = 'https://www.bcv.org.ve';
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Intentar obtener USDT por vía primaria (Binance P2P CriptoYa)
    const primaryUsdt = await fetchBinanceP2PUsdt();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 segundos de timeout
        const response = await fetch(bcvUrl, {
            method: 'GET',
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`BCV HTTP ${response.status}`);
        }

        const html = await response.text();

        // 3. Extracción por Expresiones Regulares
        const usdMatch = html.match(/id="dolar"[\s\S]*?<strong class="strong-tb">[\s]*?([\d,.]+)/i);
        const eurMatch = html.match(/id="euro"[\s\S]*?<strong class="strong-tb">[\s]*?([\d,.]+)/i);

        if (!usdMatch) throw new Error('No se pudo encontrar la tasa de cambio USD en el HTML del BCV');
        if (!eurMatch) throw new Error('No se pudo encontrar la tasa de cambio EUR en el HTML del BCV');

        // 4. Formateo y conversión (coma a punto)
        const bcvPrice = parseFloat(usdMatch[1].trim().replace(/\./g, '').replace(',', '.'));
        const euroPrice = parseFloat(eurMatch[1].trim().replace(/\./g, '').replace(',', '.'));

        if (isNaN(bcvPrice) || bcvPrice <= 0) throw new Error('Tasa USD BCV parseada no es válida');
        if (isNaN(euroPrice) || euroPrice <= 0) throw new Error('Tasa EUR BCV parseada no es válida');

        let usdtPrice = primaryUsdt;
        if (!usdtPrice) {
            // Fallback secundario de USDT: Obtener de DolarApi paralelo
            usdtPrice = parseFloat((bcvPrice * 1.12).toFixed(2));
            try {
                const dResponse = await fetch('https://ve.dolarapi.com/v1/dolares');
                if (dResponse.ok) {
                    const dData = await dResponse.json();
                    const paralelo = Array.isArray(dData) ? dData.find(d => d.fuente === 'paralelo' || d.nombre === 'Paralelo') : null;
                    if (paralelo?.promedio) {
                        usdtPrice = parseFloat(paralelo.promedio);
                    }
                }
            } catch (e) {
                // Ignorar y mantener aproximado si falla
            }
        }

        return {
            bcv: bcvPrice,
            euro: euroPrice,
            usdt: usdtPrice,
            source: 'BCV Directo'
        };

    } catch (bcvError) {
        console.warn(`[BCV Scraper] Falla en conexión directa al BCV: ${bcvError.message}. Iniciando esquema de respaldo...`);
        
        // 5. Esquema de Respaldo (Fallback)
        // Intentar primero Google Script (VITE_GOOGLE_SCRIPT_URL o GOOGLE_SCRIPT_URL)
        const googleScriptUrl = process.env.VITE_GOOGLE_SCRIPT_URL || process.env.GOOGLE_SCRIPT_URL;
        if (googleScriptUrl) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                const gRes = await fetch(googleScriptUrl, { signal: controller.signal });
                clearTimeout(timeout);
                if (gRes.ok) {
                    const gData = await gRes.json();
                    if (gData && gData.bcv) {
                        return {
                            bcv: parseFloat(gData.bcv.price || gData.bcv),
                            euro: parseFloat(gData.euro?.price || gData.euro || (gData.bcv * 1.09)),
                            usdt: primaryUsdt || parseFloat(gData.usdt?.price || gData.usdt || (gData.bcv * 1.12)),
                            source: 'Google API (Fallback)'
                        };
                    }
                }
            } catch (gErr) {
                console.warn(`[BCV Scraper Fallback] Falla en Google Script: ${gErr.message}`);
            }
        }

        // Si falla Google Script, intentar dolarapi (tanto para dólares como para euros)
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            
            const [dRes, eRes] = await Promise.all([
                fetch('https://ve.dolarapi.com/v1/dolares', { signal: controller.signal }),
                fetch('https://ve.dolarapi.com/v1/euros', { signal: controller.signal })
            ]);
            clearTimeout(timeout);

            if (!dRes.ok) throw new Error(`DolarApi USD returned HTTP ${dRes.status}`);

            const dData = await dRes.json();
            const oficial = Array.isArray(dData) ? dData.find(d => d.fuente === 'oficial' || d.nombre === 'Oficial') : null;
            const paralelo = Array.isArray(dData) ? dData.find(d => d.fuente === 'paralelo' || d.nombre === 'Paralelo') : null;

            if (!oficial?.promedio) throw new Error('No se encontró tasa oficial en DolarApi USD');

            const bcvPrice = parseFloat(oficial.promedio);
            let euroPrice = parseFloat((bcvPrice * 1.09).toFixed(2));
            const usdtPrice = primaryUsdt || parseFloat(paralelo?.promedio || (bcvPrice * 1.12).toFixed(2));

            if (eRes.ok) {
                try {
                    const eData = await eRes.json();
                    const eOficial = Array.isArray(eData) ? eData.find(d => d.fuente === 'oficial' || d.nombre === 'Oficial') : null;
                    if (eOficial?.promedio) {
                        euroPrice = parseFloat(eOficial.promedio);
                    }
                } catch (eErr) {
                    console.warn(`[BCV Scraper Fallback] Error parseando euros de DolarApi: ${eErr.message}`);
                }
            }

            return {
                bcv: bcvPrice,
                euro: euroPrice,
                usdt: usdtPrice,
                source: 'DolarApi (Fallback)'
            };

        } catch (dolarApiError) {
            throw new Error(`[BCV Scraper] Todos los intentos de obtención de tasas fallaron. Último error: ${dolarApiError.message}`);
        }
    }
}
