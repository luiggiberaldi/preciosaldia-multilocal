import React, { useState, useRef } from 'react';
import { Check, FileText, ChevronDown } from 'lucide-react';

/**
 * TermsOverlay.jsx — Términos y Condiciones (paso 1 del flujo de primer arranque).
 *
 * Orden del flujo (multi-local): Términos → PIN maestro del dueño →
 * configuración del primer negocio (BusinessSetupOverlay) → app.
 * Los términos se aceptan una sola vez por instalación (flag global
 * `pda_terms_accepted`), no por negocio.
 */
export default function TermsOverlay({ onAccept }) {
    const [hasAccepted, setHasAccepted] = useState(
        () => localStorage.getItem('pda_terms_accepted') === 'true'
    );
    const [canAccept, setCanAccept] = useState(false);
    const scrollRef = useRef(null);

    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        // Tolerancia de 15px para scroll al final
        const scrolledToBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 15;
        if (scrolledToBottom && !canAccept) {
            setCanAccept(true);
        }
    };

    const handleAcceptTerms = () => {
        localStorage.setItem('pda_terms_accepted', 'true');
        setHasAccepted(true);
        if (onAccept) onAccept();
    };

    if (hasAccepted) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="w-full max-w-2xl bg-surface-100 border border-surface-200 dark:border-surface-700 rounded-[2rem] shadow-tone-lg overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-500">

                {/* Header */}
                <div className="px-6 py-5 border-b border-surface-200 dark:border-surface-700 bg-surface-200 flex items-center gap-3 shrink-0">
                    <div className="p-2.5 bg-brand rounded-xl shadow-primary-tone">
                        <FileText size={24} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div>
                        <h2 className="font-display text-2xl text-surface-700 tracking-tight leading-tight">Términos y Condiciones</h2>
                        <p className="text-xs text-surface-500 font-medium">Por favor, lee y acepta para continuar</p>
                    </div>
                </div>

                {/* Scroll Indicator */}
                {!canAccept && (
                    <div className="px-6 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 flex items-center gap-2 animate-pulse shrink-0">
                        <ChevronDown size={14} className="text-amber-600 dark:text-amber-400 animate-bounce" />
                        <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                            Desplázate hasta el final para poder aceptar
                        </p>
                    </div>
                )}

                {/* Terms Content */}
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto px-8 py-6 prose prose-sm max-w-none dark:prose-invert"
                    style={{ scrollbarWidth: 'thin' }}
                >
                    <div>
                        <h1 className="font-display text-3xl text-surface-700 mb-2 leading-tight">Términos y Condiciones de Uso — PreciosAlDía</h1>
                        <p className="text-[10px] text-surface-500 font-bold mb-4">Última actualización: Septiembre 2026</p>
                    </div>

                    <hr className="my-4 border-surface-200 dark:border-surface-700" />

                    <div className="space-y-4">
                        <section>
                            <h2 className="font-display text-lg text-surface-700 mb-1.5">1. Aceptación de los Términos</h2>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                Al acceder y utilizar la aplicación <strong>PreciosAlDía</strong> (en adelante, "la Aplicación"), usted acepta estar sujeto a estos Términos y Condiciones. Si no está de acuerdo con alguna parte de estos términos, no debe utilizar la Aplicación.
                            </p>
                        </section>

                        <section>
                            <h2 className="font-display text-lg text-surface-700 mb-1.5">2. Descripción del Servicio</h2>
                            <p className="text-xs text-surface-700 leading-relaxed mb-1.5">
                                PreciosAlDía es una aplicación web progresiva (PWA) de gestión comercial y punto de venta local e inteligente para bodegas y comercios independientes. La Aplicación proporciona:
                            </p>
                            <ul className="text-xs text-surface-700 space-y-1 pl-4 list-disc">
                                <li><strong>Gestión de inventario local</strong> con precios en múltiples monedas (USD, Bolívares, Pesos COP).</li>
                                <li><strong>Punto de venta (POS) ergonómico</strong> para facturación rápida, cálculo de vuelto físico y recibos.</li>
                                <li><strong>Dashboard financiero</strong> con gráficos, estadísticas de ventas e informes de auditoría.</li>
                                <li><strong>Gestión de clientes</strong> con control de cuentas por cobrar (fiados) y alertas de vencimiento.</li>
                                <li><strong>Gestión multi-negocio:</strong> administración de varios negocios independientes desde la misma aplicación, con datos, inventario, ventas, fiados y usuarios totalmente separados por negocio.</li>
                                <li><strong>Sincronización en la nube (Cloud Sync)</strong> en tiempo real mediante base de datos dedicada.</li>
                                <li><strong>Impresión térmica nativa</strong> y generación de etiquetas de precios con calibración física.</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="font-display text-lg text-surface-700 mb-1.5">3. Descargo de Responsabilidad</h2>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">3.1 Información No Vinculante y Tasa Oficial BCV</h3>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                <strong className="text-red-600 dark:text-red-400">TODA LA INFORMACIÓN PROPORCIONADA EN LA APLICACIÓN ES DE REFERENCIA OPERATIVA.</strong> Las conversiones multimoneda utilizan la tasa de cambio de referencia del <strong>Banco Central de Venezuela (BCV)</strong>. Es responsabilidad del Comercio fijar sus precios en Bolívares conforme a las regulaciones vigentes de la <strong>SUNDDE</strong>.
                            </p>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">3.2 Operatividad, Caja y Desvinculación Fiscal SENIAT</h3>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                PreciosAlDía es un software de <strong>control operativo interno y gestión de inventario/caja</strong>. <strong>NO constituye una máquina fiscal ni sustituye a un sistema de facturación fiscal homologado por el SENIAT</strong>. El Comercio es el único responsable de emitir sus facturas fiscales legales exigidas por la ley.
                            </p>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">3.3 Operaciones Financieras y Avances de Efectivo (SUDEBAN)</h3>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                Las funciones de comisiones por avance de efectivo, transferencias bancarias o Pago Móvil son herramientas matemáticas para administración de caja chica. La custodia de dinero real y el cumplimiento de las normativas de la <strong>SUDEBAN</strong> recaen de forma individual en el Comercio.
                            </p>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">3.4 Limitación de Responsabilidad</h3>
                            <p className="text-xs text-surface-700 leading-relaxed mb-1">PreciosAlDía y sus creadores no serán responsables bajo ninguna circunstancia por:</p>
                            <ul className="text-xs text-surface-700 space-y-0.5 pl-4 list-disc">
                                <li>Sanciones tributarias o administrativas impuestas por el SENIAT, SUNDDE o entes reguladores.</li>
                                <li>Discrepancias en el redondeo inteligente de vuelto físico o desbalance de caja por error humano.</li>
                                <li>Cortes de sincronización o incidencias en bases de datos externas de respaldo.</li>
                                <li>La pérdida de datos locales almacenados en el almacenamiento indexado del dispositivo.</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="font-display text-lg text-surface-700 mb-1.5">4. Modelo de Acceso por Roles</h2>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">4.1 PIN Maestro del Dueño</h3>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                El acceso a la Aplicación se protege mediante PIN. En el primer uso, el responsable del dispositivo crea un <strong>PIN maestro de dueño</strong>, que otorga acceso a todos los negocios registrados y a la vista de supervisión consolidada.
                            </p>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">4.2 Usuarios por Negocio</h3>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                Por cada negocio, el dueño puede crear usuarios con rol de <strong>supervisor</strong> o <strong>cajero</strong>, cada uno con su propio PIN y permisos limitados a las funciones de su negocio.
                            </p>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">4.3 Responsabilidad sobre los Accesos</h3>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                El dueño es responsable de la custodia de su PIN maestro y de los PIN que asigne a su personal. PreciosAlDía no se hace responsable por accesos no autorizados derivados del uso indebido o la divulgación de estos PIN.
                            </p>

                            <h3 className="text-xs font-bold text-surface-700 mt-2 mb-1">4.4 Funciones Comerciales</h3>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                Las condiciones de funciones avanzadas o comerciales se informarán oportunamente dentro de la Aplicación.
                            </p>
                        </section>

                        <section>
                            <h2 className="font-display text-lg text-surface-700 mb-1.5">5. Privacidad y Datos</h2>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                PreciosAlDía opera bajo privacidad por diseño. Todos los datos comerciales se guardan localmente en el dispositivo. En caso de activar Cloud Sync, los datos se sincronizan de manera encriptada y segura directamente en los servidores Supabase del cliente. Sus datos jamás serán compartidos ni comercializados.
                            </p>
                            <p className="text-xs text-surface-700 leading-relaxed mt-1.5">
                                Cada negocio registrado mantiene sus datos <strong>aislados</strong> de los demás: el inventario, las ventas, los fiados y los usuarios de un negocio no son visibles ni accesibles desde otro. El acceso a los datos de cada negocio está limitado según el rol del usuario (dueño, supervisor o cajero).
                            </p>
                        </section>

                        <section>
                            <h2 className="font-display text-lg text-surface-700 mb-1.5">6. Ley Aplicable</h2>
                            <p className="text-xs text-surface-700 leading-relaxed">
                                Estos Términos se rigen e interpretan de acuerdo con las leyes comerciales vigentes de la República Bolivariana de Venezuela.
                            </p>
                        </section>

                        <section className="pt-2">
                            <div className="bg-accent border-l-4 border-amber-500 p-3.5 rounded-r-xl bg-slate-50 dark:bg-slate-900/40">
                                <h3 className="font-display text-base text-surface-700 mb-1 font-bold">Aceptación Final</h3>
                                <p className="text-xs text-surface-700 leading-relaxed">
                                    AL CONTINUAR Y REGISTRAR SUS NEGOCIOS, USTED DECLARA HABER LEÍDO, ENTENDIDO Y ACEPTADO ESTOS TÉRMINOS Y CONDICIONES EN SU TOTALIDAD.
                                </p>
                            </div>
                        </section>

                        <div className="text-center pt-2 pb-2">
                            <p className="text-xs font-bold text-surface-700 m-0">
                                PreciosAlDía — Tus Negocios Inteligentes 🇻🇪
                            </p>
                            <p className="text-[10px] text-surface-500 m-0">
                                Tecnología local para el comerciante venezolano
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer with Accept Button */}
                <div className="px-6 py-4 border-t border-surface-200 dark:border-surface-700 bg-surface-200 shrink-0">
                    <button
                        onClick={handleAcceptTerms}
                        disabled={!canAccept}
                        className={`btn w-full ${canAccept ? 'btn-primary' : 'bg-surface-300 dark:bg-surface-700 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-tone-md`}
                    >
                        <Check size={20} strokeWidth={2.5} />
                        <span>{canAccept ? 'Acepto los Términos y Condiciones' : 'Lee hasta el final para aceptar'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
