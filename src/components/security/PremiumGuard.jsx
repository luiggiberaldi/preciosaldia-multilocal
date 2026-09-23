import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Lock, Copy, Check, Star, Sparkles, Send, Store, CreditCard, Gift, BarChart3, Bell, Volume2, Search, Cloud, Package, FileText, Share2, Users } from 'lucide-react';
import { useSecurity } from '../../hooks/useSecurity';
import { Modal } from '../Modal';

export default function PremiumGuard({ children, featureName = "Esta función", isShop = false }) {
    const { deviceId, isPremium, loading, unlockApp, activateDemo, demoUsed } = useSecurity();
    const [inputCode, setInputCode] = useState('');
    const [error, setError] = useState(false);
    const [success, setSuccess] = useState(false);
    const [copied, setCopied] = useState(false);
    const [demoLoading, setDemoLoading] = useState(false);
    const qrCanvasRef = useRef(null);

    useEffect(() => {
        if (deviceId && qrCanvasRef.current) {
            QRCode.toCanvas(
                qrCanvasRef.current,
                deviceId,
                {
                    width: 140,
                    margin: 1.5,
                    color: {
                        dark: '#1e293b', // slate-800
                        light: '#ffffff'
                    }
                },
                (err) => {
                    if (err) console.error('[PremiumGuard] QR canvas error:', err);
                }
            );
        }
    }, [deviceId, isPremium, loading]);

    // Estado para Modales
    const [messageModal, setMessageModal] = useState({ open: false, isSuccess: false, title: '', content: '' });

    if (loading) return <div className="p-10 text-center text-slate-400">Verificando licencia...</div>;
    if (isPremium) return children;

    // --- Handlers ---
    const handleUnlock = async (e) => {
        e.preventDefault();
        const result = await unlockApp(inputCode);
        if (result.success) {
            setSuccess(true);
            setError(false);
        } else {
            setError(true);
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
            setTimeout(() => setError(false), 2000);
        }
    };

    const handleActivateDemo = async () => {
        setDemoLoading(true);
        const result = await activateDemo();
        setDemoLoading(false);

        if (result.success) {
            setMessageModal({
                open: true,
                isSuccess: true,
                title: 'Periodo de Prueba Activado',
                content: 'Disfruta de todas las funciones de la versión completa durante 3 días. Aprovecha al máximo la herramienta.'
            });
        } else if (result.status === 'DEMO_USED') {
            setMessageModal({
                open: true,
                isSuccess: false,
                title: 'Prueba no disponible',
                content: 'El periodo de prueba ya fue utilizado en este dispositivo. Contacta a soporte para adquirir tu licencia comercial.'
            });
        } else if (result.status === 'RPC_NOT_FOUND') {
            setMessageModal({
                open: true,
                isSuccess: false,
                title: 'Error de Configuración',
                content: 'Las funciones de activación no están instaladas en el servidor. Por favor contacta al administrador del sistema para resolver este problema.'
            });
        } else if (result.status === 'SERVER_ERROR') {
            setMessageModal({
                open: true,
                isSuccess: false,
                title: 'Sin Conexión',
                content: 'No se pudo conectar con el servidor de activación. Verifica tu conexión a internet e inténtalo de nuevo.'
            });
        }
    };

    const copyToClipboard = () => {
        if (typeof window !== 'undefined') {
            navigator.clipboard.writeText(deviceId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const openWhatsApp = () => {
        const message = `Hola! Quiero adquirir una licencia Premium para PreciosAlDía Bodega. Mi ID de instalación es: ${deviceId}`;
        const url = `https://wa.me/584124051793?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    // --- Config por variante ---
    let title, message, Icon, iconColor, benefits;

    if (isShop) {
        title = <span>PreciosAlDía <span className="text-brand dark:text-brand font-black">Business</span></span>;
        message = "Optimiza las ventas, el inventario y las cuentas de tu negocio.";
        Icon = Store;
        iconColor = "text-brand dark:text-brand animate-pulse";
        benefits = (
            <>
                <BenefitItem icon={<CreditCard size={15} className="text-brand" />} text="Punto de Venta Multimoneda ($, Bs, COP)" />
                <BenefitItem icon={<Package size={15} className="text-brand" />} text="Control de Inventario y Alertas de Stock" />
                <BenefitItem icon={<Users size={15} className="text-brand" />} text="Registro de Clientes y Cuentas por Cobrar" />
                <BenefitItem icon={<FileText size={15} className="text-brand" />} text="Arqueos de Caja y Reportes en PDF" />
                <BenefitItem icon={<Share2 size={15} className="text-brand" />} text="Envío de Recibos Digitales por WhatsApp" />
                <BenefitItem icon={<Cloud size={15} className="text-brand" />} text="Sincronización y Respaldo en la Nube" />
            </>
        );
    } else {
        title = <span>PreciosAlDía <span className="text-brand dark:text-brand font-black">Premium</span></span>;
        message = <span>Se requiere una suscripción activa para usar <strong>{featureName}</strong>.</span>;
        Icon = Lock;
        iconColor = "text-brand";
        benefits = (
            <>
                <BenefitItem icon={<CreditCard size={15} className="text-brand" />} text="Acceso Completo al Punto de Venta" />
                <BenefitItem icon={<Package size={15} className="text-brand" />} text="Gestión de Inventario y Stock" />
                <BenefitItem icon={<Users size={15} className="text-brand" />} text="Registro de Cuentas de Clientes" />
                <BenefitItem icon={<FileText size={15} className="text-brand" />} text="Reportes Históricos en PDF" />
                <BenefitItem icon={<Cloud size={15} className="text-brand" />} text="Respaldo de Información en la Nube" />
                <BenefitItem icon={<Check size={15} className="text-emerald-500" />} text="Soporte Técnico de Alta Prioridad" />
            </>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center h-full p-2 text-center overflow-hidden px-4">
            <style>{`
                @media (max-height: 600px) {
                    .benefits-list { display: none; }
                }
            `}</style>

            <div className="w-full max-w-[320px] sm:max-w-sm max-h-[95%] overflow-y-auto scrollbar-hide rounded-[2rem] p-4 pb-6 relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-tone-lg">

                {/* Decorative Background */}
                <div className="absolute top-0 right-0 -mr-16 -mt-16 w-32 h-32 bg-accent-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-32 h-32 bg-brand/10 dark:bg-brand/5 rounded-full blur-3xl pointer-events-none" />

                {/* Icon & Title */}
                <div className="mb-2 relative z-10">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 shadow-tone-sm">
                        <Icon className={iconColor} size={24} strokeWidth={2} />
                    </div>
                    <h2 className="text-xl font-black mb-1 tracking-tight text-slate-900 dark:text-white leading-tight">
                        {title}
                    </h2>
                    <p className="text-xs font-medium leading-tight text-slate-500 dark:text-slate-400 px-1">
                        {message}
                    </p>
                </div>

                {/* Benefits */}
                <div className="benefits-list space-y-1 mb-3 text-left relative z-10 px-1">
                    {benefits}
                </div>

                {/* CTA: Solicitar Licencia */}
                <button
                    onClick={openWhatsApp}
                    className="w-full bg-brand hover:bg-brand-dark text-white dark:text-slate-950 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 mb-2 transition-all shadow-lg shadow-brand/20 hover:-translate-y-0.5 active:scale-95 text-sm"
                >
                    <Send size={16} className="fill-white dark:fill-slate-950" />
                    <span>Solicitar Licencia</span>
                </button>

                {/* CTA: Probar gratis 3 días */}
                <button
                    onClick={handleActivateDemo}
                    disabled={demoUsed || demoLoading}
                    className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 mb-3 text-sm font-bold transition-all border active:scale-95
                        ${demoUsed
                            ? 'bg-slate-100 dark:bg-slate-800/40 text-slate-400 dark:text-slate-600 border-transparent cursor-not-allowed'
                            : 'bg-brand-light dark:bg-slate-800/20 text-brand-dark dark:text-brand border-brand/20 dark:border-slate-800/30 hover:bg-brand-light/70 dark:hover:bg-slate-800/30'
                        }`}
                >
                    <Gift size={16} />
                    <span>{demoUsed ? 'Demo ya utilizada' : demoLoading ? 'Activando...' : 'Probar gratis 3 días'}</span>
                </button>

                {/* Device ID */}
                <div className="bg-slate-50/50 dark:bg-slate-900/50 rounded-xl p-2.5 mb-3 border border-slate-200 dark:border-slate-800/60">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5 font-bold leading-tight">Tu ID de Instalación</p>
                    <div className="flex items-center justify-between gap-2">
                        <code className="text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-slate-200 tracking-tight break-all pr-1 select-all">
                            {deviceId}
                        </code>
                        <button
                            onClick={copyToClipboard}
                            type="button"
                            className="p-1.5 bg-white dark:bg-slate-800 hover:scale-105 shadow-tone-sm border border-slate-200 dark:border-slate-750 rounded-lg transition-all text-slate-400 dark:text-slate-300 hover:text-brand hover:border-brand"
                            title="Copiar ID"
                        >
                            {copied ? <Check size={14} className="text-brand" /> : <Copy size={14} />}
                        </button>
                    </div>
                </div>

                {/* QR de Activación */}
                <div className="border-t border-slate-200 dark:border-slate-800/80 pt-3 flex flex-col items-center">
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-1.5 font-bold uppercase tracking-wider leading-tight">
                        Escanear para Activar o Verificar
                    </p>
                    <div className="p-2 bg-white border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm mb-1.5">
                        <canvas ref={qrCanvasRef} />
                    </div>
                    <p className="text-[9px] text-slate-400 leading-normal max-w-[240px]">
                        Escanea este código QR desde la estación maestra para activar la licencia de este dispositivo.
                    </p>
                </div>

                {/* Modal de Mensajes */}
                <Modal
                    isOpen={messageModal.open}
                    onClose={() => setMessageModal({ ...messageModal, open: false })}
                    title={messageModal.title}
                >
                    <div className="text-center py-4">
                        <p className="text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
                            {messageModal.content}
                        </p>
                        <button
                            onClick={() => {
                                setMessageModal({ ...messageModal, open: false });
                                if (messageModal.isSuccess) window.location.reload();
                            }}
                            className="w-full py-3 bg-brand hover:bg-brand-dark text-white dark:text-slate-950 font-bold rounded-xl shadow-lg shadow-brand/20 active:scale-95 transition-all"
                        >
                            Entendido
                        </button>
                    </div>
                </Modal>

            </div>
        </div>
    );
}

function BenefitItem({ icon, text }) {
    return (
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm">
                {icon}
            </div>
            <span>{text}</span>
        </div>
    );
}
