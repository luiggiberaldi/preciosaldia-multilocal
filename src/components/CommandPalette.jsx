import { useState, useEffect, useRef } from 'react';
import { Search, ChevronRight, Package, Users, FileText, Settings, X } from 'lucide-react';

export default function CommandPalette({ isOpen, onClose, onToggle, navigateTo }) {
    const [query, setQuery] = useState('');
    const inputRef = useRef(null);

    const commands = [
        { id: 'nav-sales', title: 'Ir a Ventas', icon: Package, action: () => navigateTo('ventas') },
        { id: 'nav-inventory', title: 'Ir a Inventario', icon: Package, action: () => navigateTo('catalogo') },
        { id: 'nav-customers', title: 'Ir a Clientes', icon: Users, action: () => navigateTo('clientes') },
        { id: 'nav-reports', title: 'Ir a Reportes', icon: FileText, action: () => navigateTo('reportes') },
        { id: 'nav-dashboard', title: 'Ir a Inicio', icon: Package, action: () => navigateTo('inicio') },
        { id: 'nav-settings', title: 'Ir a Ajustes', icon: Settings, action: () => navigateTo('ajustes') },
    ];

    const filteredCommands = commands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()));

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onToggle ? onToggle() : onClose();
            }
            if (e.key === 'Escape') {
                if (isOpen) {
                    onClose();
                } else {
                    // Abrir solo si no hay un input/textarea/modal enfocado
                    const tag = document.activeElement?.tagName;
                    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
                        e.preventDefault();
                        onToggle && onToggle();
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, onToggle]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 backdrop-blur-sm bg-slate-900/40"
             onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200"
                 onClick={e => e.stopPropagation()}>
                
                <div className="flex items-center px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                    <Search className="text-slate-400 mr-3" size={20} />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Buscar acciones, productos o clientes..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-white text-lg placeholder:text-slate-400"
                    />
                    <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2">
                    {filteredCommands.length === 0 ? (
                        <div className="text-center py-10 text-slate-500">No se encontraron resultados para "{query}"</div>
                    ) : (
                        <div className="space-y-1">
                            {filteredCommands.map(cmd => {
                                const Icon = cmd.icon;
                                return (
                                    <button
                                        key={cmd.id}
                                        onClick={() => { cmd.action(); onClose(); }}
                                        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-slate-100 dark:bg-slate-800 group-hover:bg-white dark:group-hover:bg-slate-700 rounded-lg transition-colors">
                                                <Icon size={18} className="text-slate-500 dark:text-slate-400" />
                                            </div>
                                            <span className="font-bold text-slate-700 dark:text-slate-200">{cmd.title}</span>
                                        </div>
                                        <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:text-slate-400 transform group-hover:translate-x-1 transition-all" />
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                
                <div className="bg-slate-50 dark:bg-slate-950/50 px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400 font-medium">
                    <div className="flex items-center gap-2">
                        <span>Navegación principal</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span>ESC para cerrar</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
