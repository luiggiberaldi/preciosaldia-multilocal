import React from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../Modal';

export default function CategoryManagerModal({
    isOpen,
    onClose,
    categories,
    newCategoryName,
    setNewCategoryName,
    newCategoryIcon,
    setNewCategoryIcon,
    onAddCategory,
    onDeleteCategory
}) {
    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Gestionar Categorías">
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 pb-4">
                {/* Nueva Categoría */}
                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700">
                    <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-3">Crear Categoría</h4>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Nombre categoría"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            className="flex-1 form-input bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500/50 placeholder-slate-500"
                        />
                        <button
                            onClick={onAddCategory}
                            disabled={!newCategoryName.trim()}
                            className="px-4 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>

                {/* Lista de Categorías */}
                <div>
                    <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-3">Tus Categorías</h4>
                    <div className="space-y-2">
                        {categories.map(cat => (
                            <div key={cat.id} className="flex justify-between items-center bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-3 rounded-xl shadow-sm">
                                <div className="flex items-center gap-3">
                                    <span className="font-bold text-slate-700 dark:text-slate-200">{cat.label || cat.name || cat.id}</span>
                                </div>
                                {cat.id !== 'todos' && cat.id !== 'otros' && (
                                    <button
                                        onClick={() => onDeleteCategory(cat.id)}
                                        className="p-2 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
