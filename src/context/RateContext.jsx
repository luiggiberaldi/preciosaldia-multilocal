import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { pushLocalSync } from '../hooks/useCloudSync';

const RateContext = createContext();

export function RateProvider({ children, rates = {}, rateDiscrepancyWarning = null }) {
    // ── MARKET LOGIC - Street Rate ──
    const [streetRate, setStreetRate] = useState(() => {
        const saved = localStorage.getItem('street_rate_bs');
        return saved ? parseFloat(saved) : 0;
    });

    // ── GLOBAL RATE LOGIC — rateMode: 'bcv' | 'euro' | 'usdt' | 'manual' ──
    const [rateMode, setRateMode] = useState(() => {
        const saved = localStorage.getItem('bodega_rate_mode');
        if (saved && ['bcv', 'euro', 'usdt', 'manual'].includes(saved)) return saved;
        const oldAuto = localStorage.getItem('bodega_use_auto_rate');
        return (oldAuto === 'false') ? 'manual' : 'bcv';
    });

    const [customRate, setCustomRate] = useState(() => {
        const saved = localStorage.getItem('bodega_custom_rate');
        return saved && parseFloat(saved) > 0 ? saved : '';
    });

    const useAutoRate = rateMode !== 'manual';
    const setUseAutoRate = useCallback((val) => {
        if (val) {
            setRateMode(prev => ['bcv', 'euro', 'usdt'].includes(prev) ? prev : 'bcv');
        } else {
            setRateMode('manual');
        }
    }, []);

    // ── AUTO COP LOGIC ──
    const [copEnabled, setCopEnabled] = useState(() => {
        return localStorage.getItem('cop_enabled') === 'true';
    });
    const [autoCopEnabled, setAutoCopEnabled] = useState(() => {
        return localStorage.getItem('auto_cop_enabled') === 'true';
    });
    const [tasaCopManual, setTasaCopManual] = useState(() => {
        return localStorage.getItem('tasa_cop') || '';
    });
    const [copPrimary, setCopPrimary] = useState(() => {
        return localStorage.getItem('cop_primary') === 'true';
    });

    // ── REDONDEO DE TASA AUTOMÁTICA — solo aplica cuando rateMode !== 'manual' ──
    const [redondearTasaAuto, setRedondearTasaAuto] = useState(() => {
        const saved = localStorage.getItem('redondear_tasa_auto');
        return saved === null ? true : saved === 'true';
    });

    // Sync con localStorage
    useEffect(() => {
        localStorage.setItem('bodega_rate_mode', rateMode);
        localStorage.setItem('bodega_use_auto_rate', (rateMode !== 'manual').toString());
        pushLocalSync('bodega_rate_mode', rateMode);
        pushLocalSync('bodega_use_auto_rate', (rateMode !== 'manual').toString());
    }, [rateMode]);

    useEffect(() => {
        if (customRate) {
            localStorage.setItem('bodega_custom_rate', customRate.toString());
            pushLocalSync('bodega_custom_rate', customRate.toString());
        }
    }, [customRate]);

    useEffect(() => {
        if (streetRate > 0) localStorage.setItem('street_rate_bs', streetRate.toString());
    }, [streetRate]);

    useEffect(() => {
        localStorage.setItem('redondear_tasa_auto', redondearTasaAuto.toString());
        pushLocalSync('redondear_tasa_auto', redondearTasaAuto.toString());
    }, [redondearTasaAuto]);

    useEffect(() => {
        localStorage.setItem('cop_enabled', copEnabled.toString());
        localStorage.setItem('auto_cop_enabled', autoCopEnabled.toString());
        localStorage.setItem('cop_primary', copPrimary.toString());
        if (tasaCopManual) localStorage.setItem('tasa_cop', tasaCopManual.toString());

        pushLocalSync('cop_enabled', copEnabled.toString());
        pushLocalSync('auto_cop_enabled', autoCopEnabled.toString());
        pushLocalSync('cop_primary', copPrimary.toString());
        if (tasaCopManual) pushLocalSync('tasa_cop', tasaCopManual.toString());
    }, [copEnabled, autoCopEnabled, copPrimary, tasaCopManual]);

    // Listener multi-tab para tasas de cambio
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'bodega_custom_rate' && e.newValue && parseFloat(e.newValue) > 0) setCustomRate(e.newValue);
            if (e.key === 'bodega_rate_mode' && e.newValue) setRateMode(e.newValue);
            if (e.key === 'redondear_tasa_auto') setRedondearTasaAuto(e.newValue === 'true');
            if (e.key === 'cop_enabled') setCopEnabled(e.newValue === 'true');
            if (e.key === 'auto_cop_enabled') setAutoCopEnabled(e.newValue === 'true');
            if (e.key === 'tasa_cop') setTasaCopManual(e.newValue || '');
            if (e.key === 'cop_primary') setCopPrimary(e.newValue === 'true');
        };

        const handleAppStorageUpdate = (e) => {
            const key = e.detail?.key;
            if (!key) return;
            if (key === 'bodega_rate_mode') {
                const val = localStorage.getItem('bodega_rate_mode');
                if (val) setRateMode(val);
            }
            if (key === 'bodega_custom_rate') {
                const val = localStorage.getItem('bodega_custom_rate');
                if (val && parseFloat(val) > 0) setCustomRate(val);
            }
            if (key === 'cop_enabled') setCopEnabled(localStorage.getItem('cop_enabled') === 'true');
            if (key === 'auto_cop_enabled') setAutoCopEnabled(localStorage.getItem('auto_cop_enabled') === 'true');
            if (key === 'tasa_cop') setTasaCopManual(localStorage.getItem('tasa_cop') || '');
            if (key === 'cop_primary') setCopPrimary(localStorage.getItem('cop_primary') === 'true');
            // Faltaba en este handler: era la única tasa que no se re-leía al
            // aplicarse el documento remoto (quedaba visible tras recargar).
            if (key === 'redondear_tasa_auto')
                setRedondearTasaAuto(localStorage.getItem('redondear_tasa_auto') === 'true');
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
        };
    }, []);

    // ── CÁLCULO DE TASA EFECTIVA EN BS Y COP ──
    // Si redondearTasaAuto está activo y la tasa NO es manual, se redondea HACIA ARRIBA al entero siguiente.
    const effectiveRate = useMemo(() => {
        let rate;
        if (rateMode === 'manual') {
            const parsed = parseFloat(customRate);
            rate = (parsed && parsed > 0) ? parsed : (rates?.bcv?.price || 1);
        } else if (rateMode === 'usdt') {
            rate = rates?.usdt?.price || rates?.bcv?.price || 1;
        } else if (rateMode === 'euro') {
            rate = rates?.euro?.price || rates?.bcv?.price || 1;
        } else {
            rate = rates?.bcv?.price || 1;
        }
        if (rateMode !== 'manual' && redondearTasaAuto) {
            return Math.ceil(rate);
        }
        return rate;
    }, [rateMode, customRate, rates, redondearTasaAuto]);

    const tasaCop = useMemo(() => {
        if (!copEnabled) return 0;
        if (autoCopEnabled && rates?.cop?.price) {
            return rates.cop.price;
        }
        const manual = parseFloat(tasaCopManual);
        return (manual && manual > 0) ? manual : (rates?.cop?.price || 0);
    }, [copEnabled, autoCopEnabled, tasaCopManual, rates]);

    const value = useMemo(() => ({
        streetRate,
        setStreetRate,
        rateMode,
        setRateMode,
        useAutoRate,
        setUseAutoRate,
        customRate,
        setCustomRate,
        effectiveRate,
        redondearTasaAuto,
        setRedondearTasaAuto,
        rates,
        rateDiscrepancyWarning,
        copEnabled,
        setCopEnabled,
        autoCopEnabled,
        setAutoCopEnabled,
        tasaCopManual,
        setTasaCopManual,
        copPrimary,
        setCopPrimary,
        tasaCop
    }), [
        streetRate,
        rateMode,
        useAutoRate,
        setUseAutoRate,
        customRate,
        effectiveRate,
        redondearTasaAuto,
        rates,
        rateDiscrepancyWarning,
        copEnabled,
        autoCopEnabled,
        tasaCopManual,
        copPrimary,
        tasaCop
    ]);

    return (
        <RateContext.Provider value={value}>
            {children}
        </RateContext.Provider>
    );
}

export const useRateContext = () => {
    const context = useContext(RateContext);
    if (!context) {
        throw new Error("useRateContext debe usarse dentro de un RateProvider");
    }
    return context;
};
