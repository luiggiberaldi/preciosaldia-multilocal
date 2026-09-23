import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

/**
 * usePaymentState — Portado de Listo POS ModalPago
 * Adaptado para recibir metodosActivos como parámetro (sin useStore).
 */
export const usePaymentState = (initialClient, metodosActivos, isTouch) => {
    const [modo, setModo] = useState('contado');
    const [clienteSeleccionado, setClienteSeleccionado] = useState(initialClient?.id || '');
    const [pagos, setPagos] = useState({});
    const [referencias, setReferencias] = useState({});
    const [pagoSaldoFavor, setPagoSaldoFavor] = useState('');
    const [activeInputId, setActiveInputId] = useState(null);
    const [activeInputType, setActiveInputType] = useState('amount');
    const inputRefs = useRef([]);

    const metodosActivosIds = JSON.stringify(metodosActivos?.map(m => m.id) || []);
    const stableMetodosActivos = useMemo(() => metodosActivos, [metodosActivosIds]);

    // Auto-focus primer input al montar
    useEffect(() => {
        if (inputRefs.current[0]) setTimeout(() => inputRefs.current[0]?.focus(), 120);
    }, []);

    // Reset saldo al cambiar cliente
    useEffect(() => {
        setPagoSaldoFavor('');
    }, [clienteSeleccionado]);

    // Auto-scroll táctil
    useEffect(() => {
        if (isTouch && activeInputId) {
            const index = stableMetodosActivos.findIndex(m => m.id === activeInputId);
            if (index !== -1 && inputRefs.current[index]) {
                inputRefs.current[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [activeInputId, isTouch, stableMetodosActivos]);

    const val = useCallback(
        (id) => (pagos[id] === '' || !pagos[id] ? 0 : Math.round((parseFloat(pagos[id]) + Number.EPSILON) * 100) / 100),
        [pagos]
    );

    return {
        modo, setModo,
        clienteSeleccionado, setClienteSeleccionado,
        pagos, setPagos,
        referencias, setReferencias,
        pagoSaldoFavor, setPagoSaldoFavor,
        activeInputId, setActiveInputId,
        activeInputType, setActiveInputType,
        inputRefs,
        val,
    };
};
