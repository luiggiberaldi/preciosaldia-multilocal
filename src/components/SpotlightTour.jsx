import React, { useState, useEffect } from 'react';

export default function SpotlightTour({ steps, onComplete }) {
    const [currentStep, setCurrentStep] = useState(0);
    const [rect, setRect] = useState(null);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (!isMounted) return;
        const updateRect = () => {
             const targetSelector = steps[currentStep]?.target;
             if (!targetSelector) {
                 setRect('center');
                 return;
             }
             const el = document.querySelector(targetSelector);
             if (el) {
                 const r = el.getBoundingClientRect();
                 setRect(r);
             } else {
                 setRect('center');
             }
        };
        
        // Small delay to allow elements to render/animate
        const t = setTimeout(updateRect, 300);
        window.addEventListener('resize', updateRect);
        
        return () => {
            clearTimeout(t);
            window.removeEventListener('resize', updateRect);
        };
    }, [currentStep, steps, isMounted]);

    if (!rect || !isMounted) return null;

    const isCenter = rect === 'center';

    return (
        <div className="fixed inset-0 z-[9999] pointer-events-none animate-in fade-in duration-500">
            {/* Dark overlay with hole */}
            <div 
               className="absolute w-full h-full pointer-events-auto transition-all duration-500 ease-in-out"
               style={{
                   clipPath: isCenter 
                        ? `polygon(0% 0%, 0% 100%, 0% 100%, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 100%, 100% 100%, 100% 0%)` // No hole
                        : `polygon(0% 0%, 0% 100%, ${rect.left - 6}px 100%, ${rect.left - 6}px ${rect.top - 6}px, ${rect.right + 6}px ${rect.top - 6}px, ${rect.right + 6}px ${rect.bottom + 6}px, ${rect.left - 6}px ${rect.bottom + 6}px, ${rect.left - 6}px 100%, 100% 100%, 100% 0%)`,
                   backgroundColor: 'rgba(15, 23, 42, 0.75)',
                   backdropFilter: 'blur(3px)'
               }}
            />
            {/* Popover */}
            <div 
               className={`absolute z-10 bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-2xl border border-slate-100 dark:border-slate-800 w-72 pointer-events-auto transition-all duration-500 ease-out ${isCenter ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : ''}`}
               style={isCenter ? {} : {
                   // Position above or below
                   top: rect.bottom + 20 > window.innerHeight - 160 ? rect.top - 160 - 20 : rect.bottom + 20,
                   // Center horizontally relative to target if possible
                   left: Math.max(16, Math.min(rect.left + (rect.width/2) - 144, window.innerWidth - 304)),
               }}
            >
                <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black text-sm shadow-lg shadow-emerald-500/30">
                    {currentStep + 1}
                </div>
                <h3 className="font-black text-lg text-slate-800 dark:text-white mb-2 ml-4 tracking-tight">{steps[currentStep].title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">{steps[currentStep].text}</p>
                
                <div className="flex justify-between items-center">
                    <div className="flex gap-1">
                        {steps.map((_, i) => (
                            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === currentStep ? 'w-4 bg-emerald-500' : 'w-1.5 bg-slate-200 dark:bg-slate-700'}`} />
                        ))}
                    </div>
                    <button 
                       onClick={() => {
                           if (currentStep < steps.length - 1) setCurrentStep(c => c + 1);
                           else onComplete && onComplete();
                       }}
                       className="bg-emerald-500 hover:bg-emerald-400 text-white px-5 py-2 rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
                    >
                       {currentStep < steps.length - 1 ? 'Siguiente' : '¡Empezar!'}
                    </button>
                </div>
            </div>
        </div>
    );
}
