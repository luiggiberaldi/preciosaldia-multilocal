import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowDownToLine,
    ArrowUpFromLine,
    Check,
    Info,
    PackageMinus,
    PackagePlus,
    X,
} from 'lucide-react';
import SupervisorSelect from './SupervisorSelect';
import { sendSupervisorCommand } from '../../services/supervisorCommandService';
import { SUPERVISOR_REMOTE_EGRESS_ENABLED } from '../../config/supervisorPolicy';
import { showToast } from '../Toast';

const EGRESS_REASONS = [
    { value: 'merma', label: 'Merma' },
    { value: 'danio', label: 'Daño' },
    { value: 'vencimiento', label: 'Vencimiento' },
    { value: 'autoconsumo', label: 'Autoconsumo' },
    { value: 'devolucion', label: 'Devolución' },
    { value: 'ajuste', label: 'Ajuste administrativo' },
];

const UNIT_LABELS = {
    unidades: 'unidades',
    cajas: 'cajas / bultos',
    bultos: 'cajas / bultos',
};

function formatNumber(value) {
    return Number(value || 0).toLocaleString('es-VE', {
        maximumFractionDigits: 2,
    });
}

export default function SupervisorInventoryBatchModal({
    isOpen,
    onClose,
    product,
    targetDeviceId,
    remoteAvailable = false,
    allowEgress = SUPERVISOR_REMOTE_EGRESS_ENABLED,
}) {
    const [direction, setDirection] = useState('ingreso');
    const [quantityInput, setQuantityInput] = useState('1');
    const [inputUnit, setInputUnit] = useState('unidades');
    const [unitsPerPackage, setUnitsPerPackage] = useState('1');
    const [reason, setReason] = useState('');
    const [reasonCategory, setReasonCategory] = useState('merma');
    const [lotReference, setLotReference] = useState('');
    const [formError, setFormError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const productId = product?.id;
    const productPackageUnits = product?.unitsPerPackage;

    useEffect(() => {
        if (!isOpen || !productId) return;
        setDirection('ingreso');
        setQuantityInput('1');
        setInputUnit('unidades');
        setUnitsPerPackage(String(Math.max(1, Number(productPackageUnits) || 1)));
        setReason('');
        setReasonCategory('merma');
        setLotReference('');
        setFormError('');
    }, [isOpen, productId, productPackageUnits]);

    const isEgress = direction === 'egreso';
    const stock = Number(product?.stock || 0);
    const quantity = Number(quantityInput);
    const packageUnits = inputUnit === 'unidades' ? 1 : Number(unitsPerPackage);
    const hasValidNumbers = Number.isFinite(quantity)
        && quantity > 0
        && Number.isFinite(packageUnits)
        && packageUnits > 0;
    const unitsDelta = hasValidNumbers ? quantity * packageUnits : 0;
    const projectedStock = stock + (isEgress ? -unitsDelta : unitsDelta);
    const stockWillBeNegative = isEgress && hasValidNumbers && projectedStock < 0;
    const unitLabel = UNIT_LABELS[inputUnit] || 'unidades';
    const packageLabel = 'Unidades por caja / bulto';

    const directionContent = useMemo(() => ({
        ingreso: {
            title: 'Ingreso',
            description: 'Suma mercancía a la caja',
            icon: ArrowDownToLine,
            color: 'emerald',
        },
        egreso: {
            title: 'Egreso',
            description: 'Resta mercancía de la caja',
            icon: ArrowUpFromLine,
            color: 'rose',
        },
    }), []);

    if (!isOpen || !product) return null;

    const clearFormError = () => {
        if (formError) setFormError('');
    };

    const handleDirectionChange = (nextDirection) => {
        setDirection(nextDirection);
        clearFormError();
    };

    const handleUnitChange = (nextUnit) => {
        setInputUnit(nextUnit);
        if (nextUnit === 'unidades') setUnitsPerPackage('1');
        clearFormError();
    };

    const resetAndClose = () => {
        if (isSubmitting) return;
        onClose?.();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setFormError('');

        if (!remoteAvailable) {
            setFormError('La caja está desconectada. Espera a que vuelva a estar en línea.');
            return;
        }
        if (!hasValidNumbers) {
            setFormError('Indica una cantidad mayor que cero.');
            return;
        }
        if (isEgress && !allowEgress) {
            setFormError('Los egresos remotos aún están bloqueados por seguridad.');
            return;
        }
        if (stockWillBeNegative) {
            setFormError(`No puedes retirar ${formatNumber(unitsDelta)} unidades: el stock disponible es ${formatNumber(stock)}.`);
            return;
        }
        if (!reason.trim()) {
            setFormError(isEgress
                ? 'Escribe el motivo del egreso para continuar.'
                : 'Escribe el motivo del ingreso para continuar.');
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await sendSupervisorCommand({
                type: 'supervisor.inventory.batch.adjust',
                targetDeviceId,
                payload: {
                    direction,
                    productId: String(product.id),
                    quantityInput: quantity,
                    inputUnit,
                    unitsPerPackage: packageUnits,
                    expectedStock: stock,
                    reason: reason.trim(),
                    reasonCategory: isEgress ? reasonCategory : undefined,
                    lotReference: lotReference.trim() || undefined,
                },
            });
            if (!result.ok) {
                setFormError(result.error || 'No se pudo enviar el movimiento.');
                return;
            }

            const ack = await result.ackPromise;
            if (!ack?.ok) {
                setFormError(ack?.error || 'La caja no confirmó el movimiento.');
                return;
            }

            showToast(isEgress ? 'Egreso confirmado en la caja' : 'Ingreso confirmado en la caja', 'success');
            onClose?.();
        } catch (error) {
            setFormError(error?.message || 'No se pudo enviar el movimiento.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const MovementIcon = isEgress ? PackageMinus : PackagePlus;
    const movementTitle = isEgress ? 'Registrar egreso' : 'Registrar ingreso';
    const movementDescription = isEgress
        ? 'Retira mercancía de la caja y deja el motivo registrado.'
        : 'Agrega mercancía a la caja y deja la referencia registrada.';

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="supervisor-inventory-batch-title"
                className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            >
                <div className="space-y-4 p-5 pb-4 sm:p-6 sm:pb-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isEgress ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'}`}>
                                <MovementIcon size={21} />
                            </div>
                            <div className="min-w-0">
                                <h2 id="supervisor-inventory-batch-title" className="text-base font-black text-slate-800 dark:text-white">
                                    Movimiento de inventario
                                </h2>
                                <p className="truncate text-xs font-semibold text-slate-400">{product.name}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            aria-label="Cerrar movimiento de inventario"
                            onClick={resetAndClose}
                            className="min-h-11 min-w-11 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className={`flex items-start gap-2 rounded-2xl border p-3 text-xs font-semibold ${remoteAvailable ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300'}`}>
                        {remoteAvailable ? <Info size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
                        <span>{remoteAvailable ? 'Se enviará a la caja y solo se aplicará cuando la caja lo confirme.' : 'La caja está desconectada. El movimiento estará disponible cuando vuelva a estar en línea.'}</span>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
                    <fieldset>
                        <legend className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">¿Qué quieres hacer?</legend>
                        <div role="radiogroup" aria-label="Tipo de movimiento" className="grid grid-cols-2 gap-2">
                            {Object.entries(directionContent).map(([value, option]) => {
                                const Icon = option.icon;
                                const selected = direction === value;
                                const isRose = option.color === 'rose';
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        onClick={() => handleDirectionChange(value)}
                                        className={`flex min-h-[76px] items-center gap-2 rounded-2xl border p-3 text-left transition-all ${selected
                                            ? isRose
                                                ? 'border-rose-400 bg-rose-50 text-rose-700 shadow-sm ring-2 ring-rose-500/10 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                                                : 'border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm ring-2 ring-emerald-500/10 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                                            : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'} ${value === 'egreso' && !allowEgress ? 'cursor-not-allowed opacity-60' : ''}`}
                                        disabled={value === 'egreso' && !allowEgress}
                                    >
                                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${selected ? (isRose ? 'bg-rose-100 dark:bg-rose-900/40' : 'bg-emerald-100 dark:bg-emerald-900/40') : 'bg-white dark:bg-slate-900'}`}>
                                            <Icon size={17} />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-xs font-black">{option.title}</span>
                                            <span className="mt-0.5 block text-[10px] font-semibold leading-tight opacity-75">{option.description}</span>
                                        </span>
                                        {selected && <Check size={15} className="ml-auto shrink-0" />}
                                    </button>
                                );
                            })}
                        </div>
                    </fieldset>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <SupervisorSelect
                            label="Presentación"
                            ariaLabel="Seleccionar presentación del movimiento"
                            value={inputUnit === 'bultos' ? 'cajas' : inputUnit}
                            onChange={handleUnitChange}
                            options={[
                                { value: 'unidades', label: 'Unidades' },
                                { value: 'cajas', label: 'Cajas / Bultos' },
                            ]}
                        />
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Cantidad de {unitLabel}
                            <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                inputMode="decimal"
                                value={quantityInput}
                                onChange={event => { setQuantityInput(event.target.value); clearFormError(); }}
                                aria-label={`Cantidad de ${unitLabel}`}
                                className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            />
                        </label>
                    </div>

                    {inputUnit !== 'unidades' ? (
                        <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                            {packageLabel}
                            <input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                value={unitsPerPackage}
                                onChange={event => { setUnitsPerPackage(event.target.value); clearFormError(); }}
                                aria-label={packageLabel}
                                className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            />
                            <span className="mt-1 block text-[10px] font-semibold normal-case tracking-normal text-slate-400">Se usa para calcular cuántas unidades reales entran o salen.</span>
                        </label>
                    ) : (
                        <div className="-mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                            Se registrará unidad por unidad.
                        </div>
                    )}

                    {isEgress && (
                        <SupervisorSelect
                            label="Motivo del egreso"
                            ariaLabel="Seleccionar motivo del egreso"
                            value={reasonCategory}
                            onChange={(value) => { setReasonCategory(value); clearFormError(); }}
                            options={EGRESS_REASONS}
                        />
                    )}

                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        {isEgress ? 'Describe por qué sale *' : 'Describe por qué entra *'}
                        <textarea
                            required
                            rows="2"
                            value={reason}
                            onChange={event => { setReason(event.target.value); clearFormError(); }}
                            maxLength={240}
                            placeholder={isEgress ? 'Ej.: Producto dañado durante la manipulación' : 'Ej.: Compra recibida del proveedor'}
                            className="mt-1.5 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                        />
                    </label>

                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Referencia (opcional)
                        <input
                            type="text"
                            value={lotReference}
                            onChange={event => setLotReference(event.target.value)}
                            maxLength={128}
                            placeholder="Ej.: Factura, lote o nota interna"
                            className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                        />
                    </label>

                    <div className={`rounded-2xl border p-3 ${stockWillBeNegative ? 'border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/20' : 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'}`}>
                        <div className="flex items-center justify-between gap-3 text-xs font-bold">
                            <span className="text-slate-500 dark:text-slate-400">Stock después del movimiento</span>
                            <span className={stockWillBeNegative ? 'text-rose-600' : isEgress ? 'text-rose-600' : 'text-emerald-600'}>
                                {hasValidNumbers ? formatNumber(projectedStock) : '—'}
                            </span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold text-slate-400">
                            Actual: {formatNumber(stock)} · {isEgress ? 'Sale' : 'Entra'}: {hasValidNumbers ? formatNumber(unitsDelta) : '—'} unidades
                        </p>
                        {stockWillBeNegative && <p className="mt-1 text-[11px] font-bold text-rose-600">No hay stock suficiente para este egreso.</p>}
                    </div>

                    {formError && (
                        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <span>{formError}</span>
                        </div>
                    )}

                    <div className="flex gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                        <button
                            type="button"
                            onClick={resetAndClose}
                            disabled={isSubmitting}
                            className="min-h-11 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !remoteAvailable}
                            className={`min-h-11 flex-1 rounded-2xl px-4 text-xs font-black text-white shadow-lg transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${isEgress ? 'bg-rose-500 shadow-rose-500/20 hover:bg-rose-600' : 'bg-emerald-500 shadow-emerald-500/20 hover:bg-emerald-600'}`}
                        >
                            {isSubmitting ? 'Enviando a la caja...' : <><Check size={14} className="mr-1 inline" /> {movementTitle}</>}
                        </button>
                    </div>
                    <p className="text-center text-[10px] font-semibold text-slate-400">{movementDescription}</p>
                </form>
            </div>
        </div>
    );
}
