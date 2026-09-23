// v1.2.0: Rebrand al design system "Precios al Día".
// - Títulos de cada paso con font-display (Instrument Serif).
// - Botón "Siguiente" con bg-brand (cian) en vez de emerald.
// - Animación reveal en elementos persistentes (skip, navegación) vía useReveal.
// - Contenido por paso conserva slideInRight/slideInLeft pero añade stagger con animate-fade-in / animate-slide-up.
// - Fondos warm cream (bg-surface-950/95 backdrop, bg-surface card).
import React, { useState } from 'react';
import { Home, ShoppingCart, Store, Users, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

const STEPS = [
    {
        type: 'welcome',
    },
    {
        icon: Home,
        color: 'text-emerald-500',
        bg: 'bg-emerald-100 dark:bg-emerald-900/30',
        title: 'Inicio',
        headline: 'Tu bodega de un vistazo',
        description: 'Dashboard con resumen de ventas del día, productos con stock bajo y accesos rápidos a todas las funciones.',
        tip: '💡 Las tasas de cambio se actualizan automáticamente para calcular precios en Bolívares.',
    },
    {
        icon: ShoppingCart,
        color: 'text-brand',
        bg: 'bg-brand-light dark:bg-surface-700/40',
        title: 'Vender',
        headline: 'Punto de venta rápido',
        description: 'Agrega productos al carrito, aplica descuentos y cobra en efectivo, pago móvil o transferencia. El sistema calcula automáticamente el precio en Bs.',
        tip: '💡 Toca + en un producto para agregarlo al carrito directamente.',
    },
    {
        icon: Store,
        color: 'text-brand',
        bg: 'bg-brand-light dark:bg-surface-700/40',
        title: 'Inventario',
        headline: 'Tu inventario de productos',
        descriptionFree: 'PreciosAlDía Free incluye uso ilimitado y gratis para siempre. Guarda hasta 50 productos, convierte precios y consulta la tasa del día al instante.',
        descriptionPremium: 'Con PreciosAlDía Premium puedes gestionar un inventario ilimitado, cobrar con POS y compartir tu inventario.',
        tipPremium: '💡 Comparte tu inventario con otros usando un código de 6 dígitos.',
        tipFree: '👑 Activa tu licencia para desbloquear todas las funciones.',
    },
    {
        icon: Users,
        color: 'text-amber-500',
        bg: 'bg-amber-100 dark:bg-amber-900/30',
        title: 'Clientes',
        headline: 'Gestiona tus clientes',
        descriptionPremium: 'Registra a tus clientes frecuentes, lleva control de fiados y pagos parciales. Todo offline y seguro.',
        descriptionFree: 'Con PreciosAlDía Premium puedes gestionar tu cartera de clientes y control de deudas.',
        tipPremium: '💡 Toca un cliente para ver su historial completo de fiados.',
        tipFree: '👑 Activa tu licencia para gestionar clientes.',
    },
];

export default function OnboardingOverlay({ isPremium = false }) {
    const [done, setDone] = useState(
        () => localStorage.getItem('pda_onboarding_done') === 'true'
    );
    const [step, setStep] = useState(0);
    const [direction, setDirection] = useState(1);
    // v1.2.0: reveal-on-scroll para elementos persistentes (skip button, navegación, dots).
    const revealRef = useReveal();

    if (done) return null;

    const current = STEPS[step];
    const isFirst = step === 0;
    const isLast = step === STEPS.length - 1;
    const isWelcome = current.type === 'welcome';
    const hasVariants = current.descriptionPremium !== undefined;

    const finish = () => {
        localStorage.setItem('pda_onboarding_done', 'true');
        setDone(true);
    };

    const goNext = () => {
        if (isLast) { finish(); return; }
        setDirection(1);
        setStep(step + 1);
    };

    const goBack = () => {
        if (isFirst) return;
        setDirection(-1);
        setStep(step - 1);
    };

    return (
        // v1.2.0: backdrop bg-black/80 con blur.
        <div ref={revealRef} className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-md flex items-center justify-center p-5 animate-in fade-in duration-300 overflow-hidden">

            {/* Decorative background orbs — tone-matched cian + emerald */}
            <div className="absolute top-1/4 -left-20 w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none animate-pulse" />
            <div className="absolute bottom-1/4 -right-20 w-64 h-64 bg-brand/10 rounded-full blur-[100px] pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />

            {/* Skip button — reveal on first mount */}
            <button
                onClick={finish}
                className="reveal absolute top-6 right-6 text-surface-400 dark:text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-wider z-10"
            >
                Omitir <X size={14} />
            </button>

            <div className="reveal w-full max-w-sm">

                {/* Card — keyed by step for slideIn animation; inner content staggers via Tailwind animate-* */}
                <div
                    className="bg-surface-100 dark:bg-surface-100 rounded-[2rem] shadow-tone-lg border border-surface-200 dark:border-surface-700 overflow-hidden"
                    key={step}
                    style={{
                        animation: `${direction > 0 ? 'slideInRight' : 'slideInLeft'} 0.3s ease-out`,
                    }}
                >
                    {isWelcome ? (
                        /* ─── WELCOME SLIDE ─── */
                        <div className="p-8 text-center relative overflow-hidden">
                            {/* v1.2.0: Gradient header accent con brand (cian) en vez de emerald. */}
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand-light via-brand to-brand-light" />

                            {/* Logo */}
                            <div className="relative mx-auto mb-5 animate-slide-up">
                                <img
                                    src="./logo.png"
                                    alt="PreciosAlDía Bodega"
                                    className="w-44 h-auto mx-auto drop-shadow-lg"
                                />
                                <div className="absolute inset-0 bg-brand/15 rounded-full blur-2xl -z-10 scale-150" />
                            </div>
                            <p className="text-xs font-bold text-brand uppercase tracking-[0.2em] mb-5 animate-fade-in" style={{ animationDelay: '60ms' }}>
                                Tu bodega inteligente
                            </p>

                            <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed mb-6 max-w-[260px] mx-auto animate-fade-in" style={{ animationDelay: '120ms' }}>
                                Inventario, ventas y gestión de clientes en una sola app, diseñada para el bodeguero venezolano.
                            </p>

                            {/* Feature pills */}
                            <div className="flex flex-wrap justify-center gap-2 mb-2 animate-fade-in" style={{ animationDelay: '180ms' }}>
                                {['Inventario', 'Punto de Venta', 'Clientes', 'Reportes'].map(label => (
                                    <span key={label} className="badge">
                                        {label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        /* ─── FEATURE SLIDES ─── */
                        <div className="p-8">
                            {/* Icon */}
                            <div className={`w-16 h-16 rounded-2xl ${current.bg} flex items-center justify-center mx-auto mb-5 animate-slide-up`}>
                                <current.icon size={32} className={current.color} strokeWidth={2} />
                            </div>

                            {/* Step label */}
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-surface-400 text-center mb-1 animate-fade-in" style={{ animationDelay: '60ms' }}>
                                {current.title}
                            </p>

                            {/* Headline — font-display (Instrument Serif) */}
                            <h2 className="font-display text-2xl text-surface-700 text-center mb-3 leading-tight animate-slide-up" style={{ animationDelay: '120ms' }}>
                                {current.headline}
                            </h2>

                            {/* Description */}
                            <p className="text-sm text-surface-500 dark:text-surface-400 text-center leading-relaxed mb-4 animate-fade-in" style={{ animationDelay: '180ms' }}>
                                {hasVariants
                                    ? (isPremium ? current.descriptionPremium : current.descriptionFree)
                                    : current.description}
                            </p>

                            {/* Tip */}
                            <div className="bg-surface-200 dark:bg-surface-200 rounded-xl px-4 py-3 border border-surface-200 dark:border-surface-700 animate-fade-in" style={{ animationDelay: '240ms' }}>
                                <p className="text-xs text-surface-700 font-medium text-center">
                                    {hasVariants
                                        ? (isPremium ? current.tipPremium : current.tipFree)
                                        : current.tip}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation — reveal on first mount */}
                <div className="flex items-center justify-between mt-6 px-2">
                    {!isFirst ? (
                        <button
                            onClick={goBack}
                            className="flex items-center gap-1 text-surface-400 dark:text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 transition-colors px-3 py-3 rounded-full text-sm font-bold"
                        >
                            <ChevronLeft size={16} strokeWidth={3} />
                            <span>Atrás</span>
                        </button>
                    ) : (
                        <div className="w-20" />
                    )}

                    {/* Dots — brand cian en vez de emerald */}
                    <div className="flex gap-2">
                        {STEPS.map((_, i) => (
                            <div
                                key={i}
                                className={`h-2 rounded-full transition-all duration-300 ${i === step
                                    ? 'w-6 bg-brand'
                                    : i < step
                                        ? 'w-2 bg-brand/40'
                                        : 'w-2 bg-surface-400 dark:bg-surface-600'
                                    }`}
                            />
                        ))}
                    </div>

                    {/* Button — bg-brand (cian) según spec */}
                    <button
                        onClick={goNext}
                        className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white px-5 py-3 rounded-full font-bold text-sm shadow-primary-tone active:scale-95 transition-all"
                    >
                        <span>{isLast ? '¡Empezar!' : isWelcome ? 'Inicio' : 'Siguiente'}</span>
                        {!isLast && <ChevronRight size={16} strokeWidth={3} />}
                    </button>
                </div>
            </div>

            {/* Slide animations (mantener para per-step slideIn) */}
            <style>{`
                @keyframes slideInRight {
                    from { opacity: 0; transform: translateX(30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes slideInLeft {
                    from { opacity: 0; transform: translateX(-30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
            `}</style>
        </div>
    );
}
