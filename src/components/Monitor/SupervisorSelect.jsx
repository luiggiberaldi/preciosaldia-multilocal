import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export default function SupervisorSelect({
    value,
    onChange,
    options = [],
    label,
    ariaLabel,
    className = '',
    testId,
    disabled = false,
}) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);
    const optionRefs = useRef([]);
    const selectedOption = options.find(option => option.value === value);
    const labelText = ariaLabel || label || 'Seleccionar opción';

    useEffect(() => {
        const handlePointerDown = (event) => {
            if (!containerRef.current?.contains(event.target)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, []);

    useEffect(() => {
        if (isOpen) {
            const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
            optionRefs.current[selectedIndex]?.focus();
        }
    }, [isOpen, options, value]);

    const selectOption = (option) => {
        onChange(option.value);
        setIsOpen(false);
    };

    const handleButtonKeyDown = (event) => {
        if (disabled) return;
        if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            setIsOpen(true);
        }
    };

    const handleOptionKeyDown = (event, index) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            setIsOpen(false);
            containerRef.current?.querySelector('button[aria-haspopup="listbox"]')?.focus();
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectOption(options[index]);
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = (index + direction + options.length) % options.length;
            optionRefs.current[nextIndex]?.focus();
        }
    };

    return (
        <div ref={containerRef} className={`relative min-w-0 ${className}`} data-testid={testId}>
            {label && <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span>}
            <button
                type="button"
                disabled={disabled}
                aria-label={labelText}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => setIsOpen(open => !open)}
                onKeyDown={handleButtonKeyDown}
                className="mt-1.5 flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-left text-xs font-bold text-slate-700 shadow-sm outline-none transition-all hover:border-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            >
                <span className="min-w-0 truncate">{selectedOption?.label || 'Seleccionar...'}</span>
                <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && !disabled && (
                <div
                    role="listbox"
                    aria-label={labelText}
                    className="absolute left-0 right-0 z-[80] mt-1.5 max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/5"
                >
                    {options.map((option, index) => {
                        const selected = option.value === value;
                        return (
                            <button
                                key={option.value}
                                ref={(element) => { optionRefs.current[index] = element; }}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => selectOption(option)}
                                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                                className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors ${
                                    selected
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                                }`}
                            >
                                <span className="truncate">{option.label}</span>
                                {selected && <Check size={14} className="shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
