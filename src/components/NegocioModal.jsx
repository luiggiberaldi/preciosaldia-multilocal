/**
 * NegocioModal.jsx — Crear / editar un negocio (Fase 1 multi-negocio).
 *
 * Formulario con los datos del negocio: nombre (obligatorio), RIF, dirección
 * y teléfono. Los datos fiscales alimentan los recibos del negocio activo
 * (vía `syncFiscalMirror` en el store).
 *
 * UI: modal redondeado, sin <select> nativo, sin alert/confirm/prompt,
 * iconos lucide, una sola señal de foco.
 */
import React, { useState, useEffect } from 'react';
import { X, Store, Save } from 'lucide-react';
import { showToast } from './Toast';
import { useNegociosStore } from '../hooks/store/useNegociosStore';

const inputCls =
    'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ' +
    'rounded-xl px-4 py-3 text-sm font-medium text-slate-800 dark:text-white ' +
    'outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all';

const labelCls =
    'block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5';

export default function NegocioModal({ isOpen, onClose, negocio = null }) {
    const crearNegocio = useNegociosStore((s) => s.crearNegocio);
    const actualizarNegocio = useNegociosStore((s) => s.actualizarNegocio);

    const [nombre, setNombre] = useState('');
    const [rif, setRif] = useState('');
    const [direccion, setDireccion] = useState('');
    const [telefono, setTelefono] = useState('');
    const [saving, setSaving] = useState(false);

    const isEdit = Boolean(negocio?.id);

    useEffect(() => {
        if (isOpen) {
            setNombre(negocio?.nombre ?? '');
            setRif(negocio?.rif ?? '');
            setDireccion(negocio?.direccion ?? '');
            setTelefono(negocio?.telefono ?? '');
            setSaving(false);
        }
    }, [isOpen, negocio]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!nombre.trim()) {
            showToast('El nombre del negocio es obligatorio', 'error');
            return;
        }
        setSaving(true);
        try {
            const datos = {
                nombre: nombre.trim(),
                rif: rif.trim(),
                direccion: direccion.trim(),
                telefono: telefono.trim(),
            };
            const res = isEdit
                ? actualizarNegocio(negocio.id, datos)
                : crearNegocio(datos);
            if (res?.ok) {
                showToast(
                    isEdit ? 'Negocio actualizado' : 'Negocio creado. Cámbiate a él desde el selector.',
                    'success'
                );
                onClose();
            } else {
                showToast(res?.error || 'No se pudo guardar el negocio', 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-x-0 top-0 h-dvh z-[210] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-[1.5rem] p-6 max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200 max-h-[90dvh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-brand-light/30 dark:bg-brand-dark/30 text-brand rounded-2xl flex items-center justify-center">
                            <Store size={22} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white">
                            {isEdit ? 'Editar negocio' : 'Nuevo negocio'}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label="Cerrar"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className={labelCls} htmlFor="neg-nombre">Nombre *</label>
                        <input
                            id="neg-nombre"
                            value={nombre}
                            onChange={(e) => setNombre(e.target.value)}
                            placeholder="Ej: Bodega El Sol"
                            maxLength={60}
                            className={inputCls}
                        />
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="neg-rif">RIF</label>
                        <input
                            id="neg-rif"
                            value={rif}
                            onChange={(e) => setRif(e.target.value)}
                            placeholder="Ej: J-12345678-9"
                            maxLength={20}
                            className={inputCls}
                        />
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="neg-dir">Dirección</label>
                        <input
                            id="neg-dir"
                            value={direccion}
                            onChange={(e) => setDireccion(e.target.value)}
                            placeholder="Dirección fiscal"
                            maxLength={120}
                            className={inputCls}
                        />
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="neg-tel">Teléfono</label>
                        <input
                            id="neg-tel"
                            value={telefono}
                            onChange={(e) => setTelefono(e.target.value)}
                            placeholder="Ej: 0412-0000000"
                            maxLength={20}
                            inputMode="tel"
                            className={inputCls}
                        />
                    </div>
                </div>

                <div className="flex gap-2.5 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-3 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-4 py-3 rounded-xl font-bold text-sm bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/25 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        <Save size={16} />
                        {saving ? 'Guardando…' : 'Guardar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
