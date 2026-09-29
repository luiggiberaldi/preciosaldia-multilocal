/**
 * NegocioSelector.jsx — Selector y administrador de negocios (Fase 1).
 *
 * Pill compacta para el header: muestra el negocio activo. Al tocarla abre el
 * modal de gestión: cambiar de negocio (tocar la fila), crear, editar y
 * eliminar. Eliminar pide confirmación con ConfirmModal.
 *
 * Cambiar de negocio recarga la app (decisión Fase 1: rehidratación total).
 *
 * UI: todo redondeado, sin <select> nativo, sin alert/confirm/prompt,
 * iconos lucide, una sola señal de foco.
 */
import React, { useState } from 'react';
import { Store, ChevronDown, X, Plus, Pencil, Trash2, Check } from 'lucide-react';
import { showToast } from './Toast';
import ConfirmModal from './ConfirmModal';
import NegocioModal from './NegocioModal';
import { useNegociosStore } from '../hooks/store/useNegociosStore';

export default function NegocioSelector({ triggerHaptic }) {
    const negocios = useNegociosStore((s) => s.negocios);
    const negocioActivoId = useNegociosStore((s) => s.negocioActivoId);
    const activarNegocio = useNegociosStore((s) => s.activarNegocio);
    const eliminarNegocio = useNegociosStore((s) => s.eliminarNegocio);

    const [showManager, setShowManager] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [busy, setBusy] = useState(false);

    const activo = negocios.find((n) => n.id === negocioActivoId) ?? negocios[0];

    const openManager = () => {
        triggerHaptic && triggerHaptic();
        setShowManager(true);
    };

    const handleSwitch = (id) => {
        if (id === negocioActivoId) {
            setShowManager(false);
            return;
        }
        triggerHaptic && triggerHaptic();
        const target = negocios.find((n) => n.id === id);
        const res = activarNegocio(id);
        if (res?.ok) {
            showToast(`Cambiando a "${target?.nombre ?? ''}"…`, 'info');
            // activarNegocio recarga la app tras persistir.
        } else {
            showToast(res?.error || 'No se pudo cambiar de negocio', 'error');
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        setBusy(true);
        try {
            const res = await eliminarNegocio(deleting.id);
            if (res?.ok) {
                showToast(`"${deleting.nombre}" eliminado`, 'success');
                setDeleting(null);
            } else {
                showToast(res?.error || 'No se pudo eliminar', 'error');
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {/* Pill del header */}
            <button
                onClick={openManager}
                className="flex items-center gap-1.5 max-w-[180px] sm:max-w-[240px] pl-2.5 pr-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-full shadow-sm hover:shadow transition-all active:scale-95 outline-none focus:ring-2 focus:ring-brand/50"
                title="Cambiar o gestionar negocios"
            >
                <Store size={15} className="text-brand shrink-0" />
                <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 truncate">
                    {activo?.nombre ?? 'Negocio'}
                </span>
                <ChevronDown size={14} className="text-slate-400 shrink-0" />
            </button>

            {/* Modal de gestión */}
            {showManager && (
                <div
                    className="fixed inset-0 z-[205] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={() => setShowManager(false)}
                >
                    <div
                        className="bg-white dark:bg-slate-900 rounded-[1.5rem] p-5 sm:p-6 max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-black text-slate-800 dark:text-white">
                                Mis negocios
                            </h3>
                            <button
                                onClick={() => setShowManager(false)}
                                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                aria-label="Cerrar"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-2">
                            {negocios.map((n) => {
                                const isActive = n.id === negocioActivoId;
                                const canDelete = negocios.length > 1 && !isActive;
                                return (
                                    <div
                                        key={n.id}
                                        className={`flex items-center gap-2 p-3 rounded-2xl border transition-all ${
                                            isActive
                                                ? 'border-brand/60 bg-brand-light/20 dark:bg-brand-dark/10'
                                                : 'border-slate-200/70 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                                        }`}
                                    >
                                        <button
                                            onClick={() => handleSwitch(n.id)}
                                            className="flex-1 min-w-0 text-left outline-none focus:ring-2 focus:ring-brand/50 rounded-xl"
                                            title={isActive ? 'Negocio activo' : `Cambiar a ${n.nombre}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-extrabold text-slate-800 dark:text-white truncate">
                                                    {n.nombre}
                                                </span>
                                                {isActive && (
                                                    <span className="shrink-0 text-[10px] font-black uppercase tracking-wide bg-brand text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                                                        <Check size={10} /> Activo
                                                    </span>
                                                )}
                                            </div>
                                            {n.rif && (
                                                <div className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold truncate mt-0.5">
                                                    RIF: {n.rif}
                                                </div>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => { triggerHaptic && triggerHaptic(); setEditing(n); setShowForm(true); }}
                                            className="p-2 text-slate-400 hover:text-brand rounded-xl hover:bg-white dark:hover:bg-slate-900 transition-colors shrink-0"
                                            title={`Editar ${n.nombre}`}
                                            aria-label={`Editar ${n.nombre}`}
                                        >
                                            <Pencil size={16} />
                                        </button>
                                        <button
                                            onClick={() => { triggerHaptic && triggerHaptic(); setDeleting(n); }}
                                            disabled={!canDelete}
                                            className="p-2 text-slate-400 hover:text-red-500 rounded-xl hover:bg-white dark:hover:bg-slate-900 transition-colors shrink-0 disabled:opacity-30 disabled:pointer-events-none"
                                            title={isActive ? 'No se puede eliminar el negocio activo' : `Eliminar ${n.nombre}`}
                                            aria-label={`Eliminar ${n.nombre}`}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); setEditing(null); setShowForm(true); }}
                            className="mt-4 w-full px-4 py-3 rounded-2xl font-bold text-sm bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/25 transition-all active:scale-95 flex items-center justify-center gap-2 outline-none focus:ring-2 focus:ring-brand/50"
                        >
                            <Plus size={16} />
                            Nuevo negocio
                        </button>
                        <p className="mt-3 text-[11px] text-center text-slate-400 dark:text-slate-500 leading-relaxed">
                            Cada negocio tiene sus propios productos, ventas, fiados y usuarios.
                            Cambiar de negocio recarga la app.
                        </p>
                    </div>
                </div>
            )}

            {/* Form crear/editar */}
            <NegocioModal
                isOpen={showForm}
                negocio={editing}
                onClose={() => { setShowForm(false); setEditing(null); }}
            />

            {/* Confirmar eliminación */}
            <ConfirmModal
                isOpen={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                onConfirm={handleDelete}
                title="Eliminar negocio"
                message={`Se eliminará "${deleting?.nombre}" y TODOS sus datos (productos, ventas, fiados, usuarios). Esta acción no se puede deshacer.`}
                confirmText={busy ? 'Eliminando…' : 'Eliminar'}
                variant="danger"
            />
        </>
    );
}
