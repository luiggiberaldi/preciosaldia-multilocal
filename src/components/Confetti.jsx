import { useEffect, useState } from 'react';

/**
 * Mini confetti burst — se muestra 2 segundos y desaparece.
 * Pure CSS, cero dependencias.
 */
export default function Confetti({ onDone }) {
    const [particles] = useState(() =>
        Array.from({ length: 24 }, (_, i) => ({
            id: i,
            x: Math.random() * 100,
            delay: Math.random() * 0.3,
            duration: 0.8 + Math.random() * 0.6,
            size: 4 + Math.random() * 6,
            color: ['#10B981', '#6366F1', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'][i % 6],
            rotation: Math.random() * 360,
        }))
    );

    useEffect(() => {
        const t = setTimeout(() => onDone?.(), 2000);
        return () => clearTimeout(t);
    }, [onDone]);

    return (
        <div className="fixed inset-0 z-[300] pointer-events-none overflow-hidden">
            {particles.map(p => (
                <div
                    key={p.id}
                    className="absolute animate-confetti-fall"
                    style={{
                        left: `${p.x}%`,
                        top: '-10px',
                        width: `${p.size}px`,
                        height: `${p.size * 1.4}px`,
                        backgroundColor: p.color,
                        borderRadius: '2px',
                        animationDelay: `${p.delay}s`,
                        animationDuration: `${p.duration}s`,
                        transform: `rotate(${p.rotation}deg)`,
                    }}
                />
            ))}
            <style>{`
                @keyframes confetti-fall {
                    0% { 
                        transform: translateY(0) rotate(0deg) scale(1); 
                        opacity: 1; 
                    }
                    100% { 
                        transform: translateY(100vh) rotate(720deg) scale(0.3); 
                        opacity: 0; 
                    }
                }
                .animate-confetti-fall {
                    animation: confetti-fall ease-out forwards;
                }
            `}</style>
        </div>
    );
}
