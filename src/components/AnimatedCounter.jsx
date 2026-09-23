import { useState, useEffect } from 'react';

/**
 * Contador animado que hace count-up desde 0 hasta el valor final.
 * Para stats del Dashboard.
 */
export default function AnimatedCounter({ value, prefix = '', suffix = '', duration = 600 }) {
    const [display, setDisplay] = useState(0);
    const numericValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
    const isDecimal = String(value).includes('.') || numericValue % 1 !== 0;

    useEffect(() => {
        if (numericValue === 0) { setDisplay(0); return; }

        const startTime = performance.now();
        let rafId;

        const animate = (now) => {
            const elapsed = now - startTime;
            if (elapsed >= duration) {
                setDisplay(numericValue);
                return;
            }
            const progress = elapsed / duration;
            // easeOutExpo
            const eased = 1 - Math.pow(2, -10 * progress);
            setDisplay(numericValue * eased);
            rafId = requestAnimationFrame(animate);
        };

        rafId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafId);
    }, [numericValue, duration]);

    const formatted = isDecimal ? display.toFixed(2) : Math.round(display).toLocaleString();

    return <>{prefix}{formatted}{suffix}</>;
}
