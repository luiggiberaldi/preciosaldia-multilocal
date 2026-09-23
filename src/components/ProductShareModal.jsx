import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Copy, Share2, Check, Smartphone, Building2, Wallet } from 'lucide-react';
import { formatBs, formatUsd, smartCashRounding } from '../utils/calculatorUtils';
import CustomSelect from './CustomSelect';

export const ProductShareModal = ({ isOpen, onClose, product, rates, accounts, streetRate }) => {
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [config, setConfig] = useState({
        showUsdt: true,
        showEfectivo: true,
        showBs: true,
        showRefBcv: false,
        showRefEuro: false
    });

    // Auto-seleccionar primera cuenta al abrir
    useEffect(() => {
        if (isOpen && accounts.length > 0 && !selectedAccountId) {
            setSelectedAccountId(accounts[0].id);
        }
    }, [isOpen, accounts]);

    if (!product) return null;

    // Cálculos
    const valBs = product.priceUsdt * (rates?.bcv?.price || 1);

    // Lógica Street Rate (Calibrada)
    // Si hay tasa calibrada (>0), el precio efectivo es Bs / TasaCalibrada
    // Si no, asumimos paridad 1:1 con USDT (Precio Efectivo = Precio USDT)
    const valEfectivo = streetRate > 0
        ? smartCashRounding(valBs / streetRate)
        : Math.ceil(product.priceUsdt); // Si no calibra, mantenemos techo simple o redondeo

    // Presets
    const applyPreset = (type) => {
        switch (type) {
            case 'fiscal':
                setConfig({ showUsdt: false, showEfectivo: false, showBs: true, showRefBcv: true, showRefEuro: false });
                break;
            case 'market':
                setConfig({ showUsdt: true, showEfectivo: true, showBs: true, showRefBcv: false, showRefEuro: false });
                break;
            case 'efectivo':
                setConfig({ showUsdt: false, showEfectivo: true, showBs: false, showRefBcv: false, showRefEuro: false });
                break;
        }
    };

    const generateMessage = () => {
        const lines = [];
        lines.push(`*${product.name.toUpperCase()}*`); // Uppercase for better visibility
        lines.push('');

        lines.push('PRECIO:'); // Plain text header
        if (config.showUsdt) lines.push(`USDT: ${formatUsd(product.priceUsdt)}`);
        if (config.showEfectivo) lines.push(`Efectivo: $${valEfectivo}`);
        if (config.showBs) lines.push(`Bs: ${formatBs(valBs)}`);

        // Referencias explícitas
        if (config.showRefBcv) {
            const refBcv = rates?.bcv?.price ? valBs / rates.bcv.price : product.priceUsdt;
            lines.push(`Ref. BCV: $${formatUsd(refBcv).replace('$', '')}`);
        }
        if (config.showRefEuro) {
            const refEur = rates?.euro?.price ? valBs / rates.euro.price : product.priceUsdt;
            lines.push(`Ref. Euro: €${formatUsd(refEur).replace('$', '').replace('€', '')}`);
        }

        lines.push('');

        if (selectedAccountId) {
            const acc = accounts.find(a => a.id === selectedAccountId);
            if (acc) {
                // Support both structures just in case
                const d = acc.data || acc;

                lines.push(`DATOS DE PAGO:`);
                lines.push(`*${acc.alias || 'Cuenta'}*`);

                if (acc.type === 'pago_movil') {
                    lines.push(`Banco: ${d.bankName || d.bank || 'Banco'}`);
                    lines.push(`Tel: ${d.phone}`);
                    lines.push(`CI: ${d.docId || d.id}`);
                } else if (acc.type === 'transfer' || acc.type === 'transferencia') {
                    lines.push(`Banco: ${d.bankName || d.bank || ''}`);
                    lines.push(`Cuenta: ${d.accountNumber}`);
                    lines.push(`Titular: ${d.holder}`);
                    lines.push(`CI/RIF: ${d.docId || d.id}`);
                } else if (acc.type === 'binance') {
                    lines.push(`Email: ${d.email}`);
                    if (d.payId) lines.push(`ID: ${d.payId}`);
                }
            }
        }

        return lines.join('\n');
    };

    const handleShare = async () => {
        const text = generateMessage();

        // Helper: Convert DataURL to File
        const dataURLtoFile = (dataurl, filename) => {
            let arr = dataurl.split(','), mimeMatch = arr[0].match(/:(.*?);/),
                mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream',
                bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
            while (n--) u8arr[n] = bstr.charCodeAt(n);
            return new File([u8arr], filename, { type: mime });
        };

        try {
            // Check if Web Share API is available and supports files
            if (navigator.share && product.image) {
                // FASE 3 (Egress): product.image puede ser un data URI (imágenes
                // viejas/offline) o una URL de Supabase Storage (nuevas). Soportar
                // ambos: si es data URI se decodifica local; si es URL se descarga.
                const filename = `${product.name.replace(/\s+/g, '_')}.webp`;
                let imageFile;
                if (product.image.startsWith('data:')) {
                    imageFile = dataURLtoFile(product.image, filename);
                } else {
                    const resp = await fetch(product.image);
                    const blob = await resp.blob();
                    imageFile = new File([blob], filename, { type: blob.type || 'image/webp' });
                }

                if (navigator.canShare && navigator.canShare({ files: [imageFile] })) {
                    await navigator.share({
                        text: text,
                        files: [imageFile],
                    });
                    return; // Succesfully shared
                }
            }
        } catch (error) {
            console.error("Error sharing with image:", error);
            // Fallback will execute below
        }

        // Standard Fallback (WhatsApp Text Only)
        const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Cotización Flash">
            <div className="space-y-6">

                {/* 1. Presets */}
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Modo de Cotización</label>
                    <div className="flex gap-2">
                        <button onClick={() => applyPreset('market')} className="flex-1 py-2 px-3 bg-brand-light dark:bg-surface-800/20 text-brand-dark dark:text-brand rounded-xl text-xs font-bold border border-surface-200 dark:border-surface-800 hover:bg-brand-light transition-colors">
                            🚀 Mercado
                        </button>
                        <button onClick={() => applyPreset('fiscal')} className="flex-1 py-2 px-3 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 hover:bg-slate-100 transition-colors">
                            🏛️ Fiscal
                        </button>
                        <button onClick={() => applyPreset('efectivo')} className="flex-1 py-2 px-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-bold border border-emerald-100 dark:border-emerald-800 hover:bg-emerald-100 transition-colors">
                            💵 Efectivo
                        </button>
                    </div>
                </div>

                {/* 2. Toggles Manuales (Oculto por defecto o visible sutilmente) */}
                <div className="flex flex-wrap gap-2">
                    {Object.keys(config).map(key => (
                        <button
                            key={key}
                            onClick={() => setConfig(prev => ({ ...prev, [key]: !prev[key] }))}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${config[key]
                                ? 'bg-brand/10 border-brand text-brand-dark'
                                : 'bg-transparent border-slate-200 dark:border-slate-700 text-slate-400'
                                }`}
                        >
                            {key.replace('show', '').replace('RefBcv', 'DolarBcv').replace('RefEuro', 'EuroBcv')}
                        </button>
                    ))}
                </div>

                {/* 3. Selector de Cuenta */}
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Cuenta Receptora</label>
                    {accounts.length === 0 ? (
                        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs text-slate-500 text-center">
                            No tienes cuentas guardadas aún.
                        </div>
                    ) : (
                        <CustomSelect
                            value={selectedAccountId}
                            onChange={setSelectedAccountId}
                            options={[
                                { value: '', label: '-- Sin datos bancarios --' },
                                ...accounts.map(acc => ({
                                    value: acc.id,
                                    label: `${acc.type === 'pago_movil' ? '📱' : acc.type === 'binance' ? '🟡' : '🏦'} ${acc.alias}`
                                }))
                            ]}
                        />
                    )}
                </div>

                {/* 4. Previsualización Simplificada */}
                <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                    <p className="text-[10px] text-slate-400 mb-1 uppercase font-bold">Vista Previa Mensaje:</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                        {generateMessage()}
                    </p>
                </div>

                {/* 5. Acción */}
                <button
                    onClick={handleShare}
                    className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white py-4 rounded-2xl font-black uppercase tracking-wider shadow-lg shadow-green-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                    <Share2 size={20} /> Enviar WhatsApp
                </button>

            </div>
        </Modal>
    );
};
