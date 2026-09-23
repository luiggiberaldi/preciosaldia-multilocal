import { useState, useEffect, useCallback, useRef } from 'react';
import { BcvApiClient } from '../services/bcvApiClient';

const BCV_API_URL = import.meta.env.VITE_BCV_API_URL || '';

const DEFAULT_RATES = {
    bcv: { price: 36.35, source: 'BCV Oficial', change: 0.05 },
    euro: { price: 39.80, source: 'Euro BCV', change: -0.02 },
    lastUpdate: new Date().toISOString()
};

const DEFAULT_EUR_USD_RATIO = 1.18;
const UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutos
const CACHE_MAX_AGE_MS = 14 * 60 * 1000; // refrescar si tiene más de 14 min

// Fallback directo (solo si el endpoint /api/rates no está disponible)
const EXCHANGERATE_KEY = import.meta.env.VITE_EXCHANGERATE_KEY || '';
const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_RATES_URL || import.meta.env.VITE_GOOGLE_SCRIPT_URL || '';

export function useRates() {
    const [rates, setRates] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('monitor_rates_v12'));
            if (saved) {
                return saved;
            }
            return null;
        }
        catch { return null; }
    });

    const [loading, setLoading] = useState(false);
    const [isOffline, setIsOffline] = useState(false);
    const [logs, setLogs] = useState([]);
    const [rateDiscrepancyWarning, setRateDiscrepancyWarning] = useState(null);

    const ratesRef = useRef(rates);
    // HOOK-016: Ref para isOffline, evita stale-closure dentro de updateData
    // (que tiene useCallback con deps mínimas para no re-crear el interval).
    const isOfflineRef = useRef(isOffline);
    useEffect(() => { isOfflineRef.current = isOffline; }, [isOffline]);

    useEffect(() => {
        ratesRef.current = rates;
        if (rates) localStorage.setItem('monitor_rates_v12', JSON.stringify(rates));
    }, [rates]);

    const addLog = useCallback((msg, type = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-49), { time, msg, type }]);
    }, []);

    const parseSafeFloat = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const clean = val.replace(/[^\d.,]/g, '');
            const lastDot = clean.lastIndexOf('.');
            const lastComma = clean.lastIndexOf(',');
            const lastSep = Math.max(lastDot, lastComma);

            if (lastSep === -1) return parseFloat(clean) || 0;

            const integer = clean.slice(0, lastSep).replace(/[.,]/g, '');
            const decimals = clean.slice(lastSep + 1);
            return parseFloat(`${integer}.${decimals}`) || 0;
        }
        return 0;
    };

    const updateData = useCallback(async (isAutoUpdate = false) => {
        // Si es auto-update, saltar si los datos son recientes (< 14 min)
        if (isAutoUpdate && ratesRef.current?.lastUpdate) {
            const age = Date.now() - new Date(ratesRef.current.lastUpdate).getTime();
            if (age < CACHE_MAX_AGE_MS) return;
        }

        if (!isAutoUpdate) setLoading(true);

        const log = (msg, type) => !isAutoUpdate && addLog(msg, type);
        log(isAutoUpdate ? "--- Auto-Update ---" : "--- Actualización Manual ---");

        const fetchGeneric = async (url, retries = 1) => {
            for (let i = 0; i <= retries; i++) {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 8000);
                try {
                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(id);
                    if (!res.ok) { if (i < retries) continue; return null; }
                    return await res.json();
                } catch (e) {
                    clearTimeout(id);
                    if (i < retries) { await new Promise(r => setTimeout(r, 1000)); continue; }
                    return null;
                }
            }
            return null;
        };

        // HOOK-015: Fetch con backoff exponencial (1s, 2s, 4s) + jitter.
        // Máximo 3 reintentos. Usa AbortController con timeout de 8s por intento.
        const fetchWithBackoff = async (url, maxRetries = 3) => {
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);
                try {
                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (!res.ok) {
                        // 4xx/5xx: si es el último intento, salir; si no, backoff.
                        if (attempt >= maxRetries) return null;
                    } else {
                        return await res.json();
                    }
                } catch (e) {
                    clearTimeout(timeoutId);
                    if (attempt >= maxRetries) return null;
                    // Errores de red / abort: backoff y reintento.
                }
                // Backoff exponencial: 1s, 2s, 4s + jitter (0-300ms).
                const baseDelay = Math.pow(2, attempt) * 1000; // 1000, 2000, 4000
                const jitter = Math.floor(Math.random() * 300);
                await new Promise((r) => setTimeout(r, baseDelay + jitter));
            }
            return null;
        };

        const getExternalRatesFallback = async () => {
            if (!EXCHANGERATE_KEY) {
                return { eur: DEFAULT_EUR_USD_RATIO, cop: null };
            }
            try {
                const data = await fetchGeneric(`https://v6.exchangerate-api.com/v6/${EXCHANGERATE_KEY}/latest/USD`);
                if (data?.result === "success") {
                    return {
                        eur: data.conversion_rates?.EUR ? 1 / data.conversion_rates.EUR : DEFAULT_EUR_USD_RATIO,
                        cop: data.conversion_rates?.COP || null
                    };
                }
            } catch (e) { }
            return { eur: DEFAULT_EUR_USD_RATIO, cop: null };
        };

        const getMeta = (newP, oldP, oldChange = 0, apiChange = null) => {
            let p = parseSafeFloat(newP);
            const o = parseSafeFloat(oldP);

            if (apiChange !== null && apiChange !== undefined && apiChange !== 0) {
                return { price: p, change: parseSafeFloat(apiChange) };
            }

            if (p === o) return { price: p, change: oldChange };
            return { price: p, change: (p > 0 && o > 0) ? ((p - o) / o) * 100 : 0 };
        };

        try {
            // Fetch en paralelo de todas las fuentes disponibles
            const taskCacheApi = fetchGeneric('/api/rates');
            const taskPrivate = GOOGLE_SCRIPT_URL ? fetchGeneric(GOOGLE_SCRIPT_URL) : Promise.resolve(null);
            const taskDolarApi = fetchGeneric('https://ve.dolarapi.com/v1/dolares');
            const taskExternal = getExternalRatesFallback();
            
            let taskClient = Promise.resolve(null);
            if (BCV_API_URL) {
                const client = new BcvApiClient(BCV_API_URL);
                taskClient = client.getRaw().catch(() => null);
            }

            const [cacheApiData, privateData, bcvFallbackData, externalRates, clientData] = await Promise.all([
                taskCacheApi.catch(() => null),
                taskPrivate.catch(() => null),
                taskDolarApi.catch(() => null),
                taskExternal.catch(() => ({ eur: DEFAULT_EUR_USD_RATIO, cop: null })),
                taskClient
            ]);

            const euroFactor = externalRates.eur;

            const candidates = [];

            const validateMagnitude = (val, min = 10, max = 5000) => {
                if (!val || val <= 0) return 0;
                if (val < min) {
                    let v = val;
                    let guard = 0;
                    while (v < min && guard < 6) { v *= 10; guard++; }
                    return v;
                }
                if (val > max) {
                    let v = val;
                    let guard = 0;
                    while (v > max && guard < 6) { v /= 10; guard++; }
                    return v;
                }
                return val;
            };

            // 1. Candidato: cacheApiData (/api/rates)
            if (cacheApiData && cacheApiData.bcv?.price > 0) {
                const price = validateMagnitude(parseSafeFloat(cacheApiData.bcv.price));
                if (price > 10.0) {
                    candidates.push({ val: price, source: cacheApiData.bcv.source || '/api/rates' });
                }
            }

            // 2. Candidato: privateData (Google Script)
            if (privateData) {
                const rawBcv = privateData.bcv || privateData.usd;
                const price = validateMagnitude(parseSafeFloat(typeof rawBcv === 'object' ? rawBcv.price : rawBcv));
                if (price > 10.0) {
                    candidates.push({ val: price, source: 'Google Script (VITE_GOOGLE_SCRIPT_URL)' });
                }
            }

            // 3. Candidato: bcvFallbackData (DolarApi)
            if (bcvFallbackData) {
                const oficial = Array.isArray(bcvFallbackData) 
                    ? bcvFallbackData.find(d => d.fuente === 'oficial' || d.nombre === 'Oficial') 
                    : null;
                if (oficial?.promedio > 0) {
                    const price = validateMagnitude(parseSafeFloat(oficial.promedio));
                    if (price > 10.0) {
                        candidates.push({ val: price, source: 'DolarApi Oficial' });
                    }
                }
            }

            // 4. Candidato: clientData (BcvApiClient)
            if (clientData && clientData.ok && clientData.tasa > 0) {
                const price = validateMagnitude(parseSafeFloat(clientData.tasa));
                if (price > 10.0) {
                    candidates.push({ val: price, source: clientData.source || 'BcvApiClient' });
                }
            }

            let newRates = { ...(ratesRef.current || DEFAULT_RATES) };
            let chosenBcv = 0;
            let chosenSource = 'Default';

            if (candidates.length > 0) {
                // Ordenar por precio descendente para tomar la tasa más alta
                candidates.sort((a, b) => b.val - a.val);
                chosenBcv = candidates[0].val;
                chosenSource = candidates[0].source;

                // Calcular advertencia de discrepancia si hay una diferencia notable (> 3%)
                const lowestRate = candidates[candidates.length - 1].val;
                const diffPercent = ((chosenBcv - lowestRate) / lowestRate) * 100;
                if (diffPercent > 3.0 && candidates.length > 1) {
                    setRateDiscrepancyWarning({
                        highest: chosenBcv,
                        lowest: lowestRate,
                        highestSource: chosenSource,
                        lowestSource: candidates[candidates.length - 1].source,
                        diff: diffPercent.toFixed(1)
                    });
                    if (!isAutoUpdate) addLog(`⚠️ Discrepancia del ${diffPercent.toFixed(1)}% detectada. Usando la más alta: ${chosenBcv.toFixed(2)} Bs (${chosenSource})`, 'warning');
                } else {
                    setRateDiscrepancyWarning(null);
                }
            } else {
                chosenBcv = newRates.bcv.price;
                chosenSource = newRates.bcv.source || 'Cache';
                setRateDiscrepancyWarning(null);
            }

            // Extraer y procesar Euro
            let newEuroPrice = 0;
            let euroSource = 'Calculado';

            if (privateData) {
                const rawEuro = privateData.euro || privateData.eur;
                newEuroPrice = validateMagnitude(parseSafeFloat(typeof rawEuro === 'object' ? rawEuro.price : rawEuro));
                if (newEuroPrice > 0) euroSource = 'Google Script (VITE_GOOGLE_SCRIPT_URL)';
            }

            if (newEuroPrice <= 0 && cacheApiData && cacheApiData.euro?.price > 0) {
                newEuroPrice = validateMagnitude(parseSafeFloat(cacheApiData.euro.price));
                if (newEuroPrice > 0) euroSource = cacheApiData.euro.source || '/api/rates';
            }

            if (newEuroPrice <= 0) {
                newEuroPrice = chosenBcv * (euroFactor || DEFAULT_EUR_USD_RATIO);
                euroSource = 'Euro BCV (Triangulado)';
            }

            // Extraer y procesar USDT
            let newUsdtPrice = 0;
            let usdtSource = 'Default';

            if (privateData && privateData.usdt) {
                const rawUsdt = privateData.usdt;
                const usdP = parseSafeFloat(typeof rawUsdt === 'object' ? rawUsdt.price : rawUsdt);
                newUsdtPrice = validateMagnitude(usdP);
                if (newUsdtPrice > 0) usdtSource = 'Google Script';
            }
            if (newUsdtPrice <= 0 && cacheApiData && cacheApiData.usdt?.price > 0) {
                newUsdtPrice = validateMagnitude(parseSafeFloat(cacheApiData.usdt.price));
                if (newUsdtPrice > 0) usdtSource = cacheApiData.usdt.source || '/api/rates';
            }
            if (newUsdtPrice <= 0 && bcvFallbackData) {
                const usdtData = Array.isArray(bcvFallbackData) 
                    ? bcvFallbackData.find(d => d.nombre?.toLowerCase() === 'binance' || d.fuente === 'binance' || d.casa === 'binance') || bcvFallbackData.find(d => d.nombre?.toLowerCase() === 'paralelo' || d.fuente === 'paralelo' || d.casa === 'paralelo') 
                    : null;
                if (usdtData?.promedio > 0) {
                    newUsdtPrice = validateMagnitude(parseSafeFloat(usdtData.promedio));
                    usdtSource = 'Binance P2P';
                }
            }

            // Integrar a las tasas del sistema
            const bcvMeta = getMeta(chosenBcv, newRates.bcv.price, newRates.bcv.change);
            newRates.bcv = { ...newRates.bcv, ...bcvMeta, price: chosenBcv, source: chosenSource };

            const euroMeta = getMeta(newEuroPrice, newRates.euro.price, newRates.euro.change);
            newRates.euro = { ...newRates.euro, ...euroMeta, price: newEuroPrice, source: euroSource };

            if (newUsdtPrice > 0) {
                const usdtMeta = getMeta(newUsdtPrice, newRates.usdt?.price ?? 0, newRates.usdt?.change ?? 0);
                newRates.usdt = { ...usdtMeta, price: newUsdtPrice, source: usdtSource };
            }

            if (externalRates.cop > 0) {
                newRates.autoCopRate = { 
                    price: externalRates.cop, 
                    source: 'Binance USDT / TRM', 
                    rawTrm: externalRates.cop, 
                    rawUsdt: newUsdtPrice || chosenBcv
                };
            }

            newRates.lastUpdate = new Date();
            setRates(newRates);
            if (!isAutoUpdate) addLog("Actualización completada", 'success');

            if (!(newRates.bcv?.price > 0)) {
                setIsOffline(true);
                if (!isAutoUpdate) addLog("Sin tasa BCV válida, modo offline", 'warning');
            } else if (isOfflineRef.current) {
                setIsOffline(false);
            }

        } catch (e) {
            console.error(e);
            log("Error actualización", 'error');
            setIsOffline(true);
        } finally {
            setLoading(false);
        }
    }, [addLog]);

    useEffect(() => {
        updateData(false);
        const intervalId = setInterval(() => { updateData(true); }, UPDATE_INTERVAL);
        return () => clearInterval(intervalId);
    }, [updateData]);

    const currentRates = rates || DEFAULT_RATES;
    return { rates: currentRates, loading, isOffline, logs, updateData, rateDiscrepancyWarning };
}
