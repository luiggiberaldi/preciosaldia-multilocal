import { useState, useRef } from 'react';
import { Edit2, Trash2 } from 'lucide-react';

export default function SwipeableItem({ children, onEdit, onDelete, triggerHaptic }) {
    const [offset, setOffset] = useState(0);
    const startX = useRef(0);
    const currentX = useRef(0);
    const isSwiping = useRef(false);

    const SWIPE_THRESHOLD = 70; // Sensibilidad de activación

    const handleTouchStart = (e) => {
        startX.current = e.touches[0].clientX;
        isSwiping.current = true;
    };

    const handleTouchMove = (e) => {
        if (!isSwiping.current) return;
        currentX.current = e.touches[0].clientX;
        const diff = currentX.current - startX.current;

        // Limita el deslizamiento visible para que no se escape
        if (diff > 90) setOffset(90);
        else if (diff < -90) setOffset(-90);
        else setOffset(diff);
    };

    const handleTouchEnd = () => {
        isSwiping.current = false;
        
        if (offset > SWIPE_THRESHOLD && onEdit) {
            triggerHaptic && triggerHaptic();
            onEdit();
        } else if (offset < -SWIPE_THRESHOLD && onDelete) {
            triggerHaptic && triggerHaptic();
            onDelete();
        }
        
        // Volver a posición original suavemente
        setOffset(0);
    };

    return (
        <div className="relative w-full rounded-2xl md:rounded-3xl hover:z-20 transition-all">
            {/* Background Actions Layer */}
            <div className="absolute inset-0 flex items-center justify-between px-4 sm:px-6 rounded-2xl md:rounded-3xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
                {/* Left Action (Edit) */}
                <div className={`flex items-center gap-2 transform transition-all duration-300 font-bold text-sm bg-brand rounded-xl p-2 text-white shadow-lg shadow-primary/30 ${offset > 20 ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'}`}>
                    <Edit2 size={18} /> <span className="hidden sm:inline">Editar</span>
                </div>
                
                {/* Right Action (Delete) */}
                <div className={`flex items-center gap-2 transform transition-all duration-300 font-bold text-sm bg-red-500 rounded-xl p-2 text-white shadow-lg shadow-red-500/30 ml-auto ${offset < -20 ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
                    <span className="hidden sm:inline">Borrar</span> <Trash2 size={18} />
                </div>
            </div>

            {/* Foreground Content */}
            <div
                className="relative z-10 w-full transition-transform duration-300 ease-out bg-white dark:bg-slate-900 rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800"
                style={{ transform: `translateX(${offset}px)` }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                {/* Evita que el navegador bloquee el swipe interrumpiendo eventos pointer */}
                <div className="touch-pan-y pointer-events-auto">
                    {children}
                </div>
            </div>
        </div>
    );
}
