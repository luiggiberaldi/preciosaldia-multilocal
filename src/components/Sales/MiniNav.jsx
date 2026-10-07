import { Home, Store, Users, BarChart3 } from 'lucide-react';

const NAV_ITEMS = [
    { id: 'inicio', icon: Home, label: 'Inicio' },
    { id: 'catalogo', icon: Store, label: 'Inventario' },
    { id: 'clientes', icon: Users, label: 'Clientes' },
    { id: 'reportes', icon: BarChart3, label: 'Reportes' },
];

export default function MiniNav({ onNavigate, triggerHaptic }) {
    if (!onNavigate) return null;

    return (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-xl border-t border-slate-700/50 pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-around max-w-md mx-auto px-2 py-1.5">
                {NAV_ITEMS.map(nav => (
                    <button
                        key={nav.id}
                        onClick={() => { triggerHaptic?.(); onNavigate(nav.id); }}
                        className="flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl text-slate-400 hover:text-white active:scale-95 transition-all"
                    >
                        <nav.icon size={18} />
                        <span className="text-[9px] font-bold">{nav.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
