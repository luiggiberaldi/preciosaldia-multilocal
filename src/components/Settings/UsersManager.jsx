import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { showToast } from '../Toast';
import { verifyPin } from '../../utils/crypto';
import { PIN_POLICY } from '../../utils/securityConstants';
import {
    UserPlus, Trash2, KeyRound, Shield, ShoppingCart,
    Crown, X, Check, Eye, EyeOff, AlertTriangle, Edit2, Lock, Unlock
} from 'lucide-react';

const ROLE_CONFIG = {
    ADMIN: {
        label: 'Administrador',
        gradient: 'from-brand to-brand-dark',
        bg: 'bg-brand-light dark:bg-surface-800/20',
        text: 'text-brand-dark dark:text-brand',
        border: 'border-surface-300 dark:border-surface-800/40',
        icon: Shield,
    },
    CAJERO: {
        label: 'Cajero',
        gradient: 'from-emerald-500 to-teal-500',
        bg: 'bg-emerald-50 dark:bg-emerald-900/20',
        text: 'text-emerald-600 dark:text-emerald-400',
        border: 'border-emerald-200 dark:border-emerald-800/40',
        icon: ShoppingCart,
    }
};

function PinInput({ value, onChange, label, length = 6, showDigits = false }) {
    const digits = (value || '').padEnd(length, '').slice(0, length).split('');

    const handleChange = (index, digit) => {
        if (!/^\d?$/.test(digit)) return;
        const newDigits = [...digits];
        newDigits[index] = digit;
        onChange(newDigits.join('').replace(/ /g, ''));

        if (digit && index < length - 1) {
            const next = document.getElementById(`pin-${label}-${index + 1}`);
            next?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            const prev = document.getElementById(`pin-${label}-${index - 1}`);
            prev?.focus();
        }
    };

    return (
        <div className="flex gap-2 justify-center">
            {Array.from({ length }).map((_, i) => (
                <input
                    key={i}
                    id={`pin-${label}-${i}`}
                    type={showDigits ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={1}
                    value={digits[i]?.trim() || ''}
                    onChange={e => handleChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className="w-10 h-12 text-center text-lg font-black bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-brand focus:ring-2 focus:ring-brand/30 outline-none text-slate-800 dark:text-white transition-all"
                />
            ))}
        </div>
    );
}

// ─── User Row ──────────────────────────────────────
function UserRow({ user, currentUserId, onChangePin, onDelete, onEditName, onTogglePin, triggerHaptic }) {
    const roleConf = ROLE_CONFIG[user.rol] || ROLE_CONFIG.CAJERO;
    const RoleIcon = roleConf.icon;
    const isCurrentUser = user.id === currentUserId;
    const isAdmin = user.rol === 'ADMIN';
    const requirePin = user.requirePin !== false;

    return (
        <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isCurrentUser ? 'bg-brand-light/50 dark:bg-surface-800/10 border-surface-300/50 dark:border-surface-800/30' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
            {/* Avatar */}
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${roleConf.gradient} flex items-center justify-center shrink-0 shadow-sm relative`}>
                <span className="text-white font-black text-lg">{(user.nombre || 'U')[0].toUpperCase()}</span>
                {isAdmin && (
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                        <Crown size={12} className="text-yellow-400 fill-yellow-400 drop-shadow-sm" />
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{user.nombre}</p>
                    {isCurrentUser && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-brand-light dark:bg-surface-800/30 text-brand px-1.5 py-0.5 rounded-full">Tu</span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <RoleIcon size={10} className={roleConf.text} />
                    <span className={`text-[9px] font-black uppercase tracking-wider ${roleConf.text}`}>
                        {roleConf.label}
                    </span>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
                <button
                    onClick={() => { triggerHaptic?.(); onTogglePin(user); }}
                    className={`px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold flex items-center gap-1.5 transition-all border active:scale-95 ${requirePin
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                    }`}
                    title={requirePin ? 'PIN Requerido — Clic para desactivar' : 'Acceso Directo (Sin PIN) — Clic para requerir PIN'}
                >
                    {requirePin ? <Lock size={12} /> : <Unlock size={12} />}
                    <span>{requirePin ? 'Con PIN' : 'Sin PIN'}</span>
                </button>

                <button
                    onClick={() => { triggerHaptic?.(); onChangePin(user); }}
                    className="p-2 rounded-lg text-slate-400 hover:text-brand hover:bg-brand-light dark:hover:bg-surface-800/20 transition-all active:scale-90"
                    title="Cambiar PIN"
                >
                    <KeyRound size={16} />
                </button>
                <button
                    onClick={() => { triggerHaptic?.(); onEditName(user); }}
                    className="p-2 rounded-lg text-slate-400 hover:text-brand hover:bg-brand-light dark:hover:bg-surface-800/20 transition-all active:scale-90"
                    title="Editar Nombre"
                >
                    <Edit2 size={16} />
                </button>
                {!isCurrentUser && (
                    <button
                        onClick={() => { triggerHaptic?.(); onDelete(user); }}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all active:scale-90"
                        title="Eliminar"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════ MAIN
export default function UsersManager({ triggerHaptic }) {
    const { usuarios, usuarioActivo, agregarUsuario, eliminarUsuario, cambiarPin, editarUsuario } = useAuthStore();

    // States
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('CAJERO');
    const [newPin, setNewPin] = useState('');

    const [changePinUser, setChangePinUser] = useState(null);
    const [changePinStep, setChangePinStep] = useState(1); // 1 = actual, 2 = nuevo, 3 = confirmar
    const [currentPinValue, setCurrentPinValue] = useState('');
    const [pinValue, setPinValue] = useState('');
    const [confirmPinValue, setConfirmPinValue] = useState('');
    const [showPin, setShowPin] = useState(false);

    const [deleteUser, setDeleteUser] = useState(null);

    const [editNameUser, setEditNameUser] = useState(null);
    const [editNameValue, setEditNameValue] = useState('');

    const [showEmergencyConfigModal, setShowEmergencyConfigModal] = useState(false);
    const [emergencyKeyInput, setEmergencyKeyInput] = useState('');
    const [emergencyKeyConfirm, setEmergencyKeyConfirm] = useState('');
    const [showEmergencyKeyText, setShowEmergencyKeyText] = useState(false);

    const isWeakPin = (pin) => {
        if (!pin || pin.length < 6) return false;
        const weakPatterns = ['123456', '654321', '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999'];
        return weakPatterns.includes(pin) || /^(\d)\1{5}$/.test(pin);
    };

    // Auto-avance inteligente al escribir 6 dígitos
    useEffect(() => {
        if (!changePinUser) return;

        if (changePinStep === 1 && currentPinValue.length === PIN_POLICY.MIN_LENGTH) {
            const timer = setTimeout(() => { handleNextStep1(); }, 150);
            return () => clearTimeout(timer);
        }
        if (changePinStep === 2 && pinValue.length === PIN_POLICY.MIN_LENGTH) {
            const timer = setTimeout(() => { handleNextStep2(); }, 150);
            return () => clearTimeout(timer);
        }
        if (changePinStep === 3 && confirmPinValue.length === PIN_POLICY.MIN_LENGTH) {
            const timer = setTimeout(() => { handleChangePin(); }, 150);
            return () => clearTimeout(timer);
        }
    }, [currentPinValue, pinValue, confirmPinValue, changePinStep, changePinUser]);

    // ─── Handlers ────────────────────────────────────
    const handleAdd = () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        if (!newName.trim()) return showToast('Ingresa un nombre', 'error');
        if (newPin.length !== requiredLen) return showToast(`El PIN debe tener ${requiredLen} dígitos`, 'error');
        if (usuarios.some(u => u.pin === newPin)) return showToast('Ese PIN ya esta en uso', 'error');

        agregarUsuario(newName.trim(), newRole, newPin);
        showToast(`Usuario "${newName.trim()}" creado`, 'success');
        triggerHaptic?.();
        setNewName('');
        setNewRole('CAJERO');
        setNewPin('');
        setShowAddForm(false);
    };

    const handleNextStep1 = async () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        if (currentPinValue.length !== requiredLen) {
            return showToast(`El PIN debe tener ${requiredLen} dígitos`, 'error');
        }

        const userInDb = usuarios.find(u => u.id === changePinUser.id);
        if (!userInDb) return showToast('Usuario no encontrado', 'error');

        try {
            const check = await verifyPin(currentPinValue, userInDb.pin);
            if (!check.valid) {
                return showToast('El PIN actual es incorrecto', 'error');
            }
            setChangePinStep(2);
            setShowPin(false);
            triggerHaptic?.();
        } catch (e) {
            showToast('Error al verificar el PIN', 'error');
        }
    };

    const handleNextStep2 = () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        if (pinValue.length !== requiredLen) {
            return showToast(`El PIN debe tener ${requiredLen} dígitos`, 'error');
        }
        
        if (pinValue === currentPinValue) {
            return showToast('El nuevo PIN no puede ser igual al actual', 'warning');
        }

        setChangePinStep(3);
        setShowPin(false);
        triggerHaptic?.();
    };

    const handleChangePin = () => {
        const requiredLen = PIN_POLICY.MIN_LENGTH;
        
        if (pinValue !== confirmPinValue) {
            return showToast('Los PINs no coinciden', 'error');
        }

        if (usuarios.some(u => u.id !== changePinUser.id && u.pin === pinValue)) {
            return showToast('Ese PIN ya está en uso', 'error');
        }

        const res = cambiarPin(changePinUser.id, pinValue);
        if (res && res.error) {
            return showToast(res.error, 'error');
        }

        showToast(`PIN de ${changePinUser.nombre} actualizado`, 'success');
        triggerHaptic?.();
        
        // Reset
        setChangePinUser(null);
        setChangePinStep(1);
        setCurrentPinValue('');
        setPinValue('');
        setConfirmPinValue('');
        setShowPin(false);
    };

    const handleDelete = () => {
        const result = eliminarUsuario(deleteUser.id);
        if (result === false) {
            showToast('No se puede eliminar este usuario', 'error');
        } else {
            showToast(`"${deleteUser.nombre}" eliminado`, 'success');
            triggerHaptic?.();
        }
        setDeleteUser(null);
    };

    const handleEditName = () => {
        if (!editNameValue.trim()) return showToast('Ingresa un nombre válido', 'error');
        editarUsuario(editNameUser.id, { nombre: editNameValue.trim() });
        showToast(`Nombre actualizado a ${editNameValue.trim()}`, 'success');
        triggerHaptic?.();
        setEditNameUser(null);
        setEditNameValue('');
    };

    return (
        <div className="space-y-4">
            {/* User List */}
            <div className="space-y-2">
                {usuarios.map(user => (
                    <UserRow
                        key={user.id}
                        user={user}
                        currentUserId={usuarioActivo?.id}
                        onChangePin={u => {
                            setChangePinUser(u);
                            setPinValue('');
                            setConfirmPinValue('');
                            setCurrentPinValue('');
                            setShowPin(false);
                            const isSelf = u.id === usuarioActivo?.id;
                            const isBypass = u.requirePin === false || (!isSelf && usuarioActivo?.rol === 'ADMIN');
                            setChangePinStep(isBypass ? 2 : 1);
                        }}
                        onEditName={u => { setEditNameUser(u); setEditNameValue(u.nombre); }}
                        onTogglePin={u => {
                            const newStatus = u.requirePin === false;
                            editarUsuario(u.id, { requirePin: newStatus });
                            showToast(newStatus ? `PIN activado para ${u.nombre}` : `Acceso directo activado para ${u.nombre}`, 'success');
                        }}
                        onDelete={u => setDeleteUser(u)}
                        triggerHaptic={triggerHaptic}
                    />
                ))}
            </div>

            {/* ─── Clave Maestra de Emergencia Section ────────────────────── */}
            <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 my-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
                            <Shield size={20} />
                        </div>
                        <div>
                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                Clave Maestra de Emergencia
                            </h4>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                Permite restablecer PINs pulsando 7 veces el logo en el login
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            const existing = localStorage.getItem('pda_emergency_pin') || '';
                            setEmergencyKeyInput(existing);
                            setEmergencyKeyConfirm(existing);
                            setShowEmergencyKeyText(false);
                            setShowEmergencyConfigModal(true);
                            triggerHaptic?.();
                        }}
                        className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold text-[11px] rounded-xl transition-all border border-amber-500/20"
                    >
                        Configurar
                    </button>
                </div>
            </div>

            {/* Add Button / Form */}
            {!showAddForm ? (
                <button
                    onClick={() => { triggerHaptic?.(); setShowAddForm(true); }}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-brand-light dark:bg-surface-800/20 text-brand-dark dark:text-brand font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-brand-light dark:hover:bg-surface-800/40 transition-colors active:scale-[0.98] border border-dashed border-indigo-300 dark:border-surface-700"
                >
                    <UserPlus size={16} /> Agregar Usuario
                </button>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-surface-300 dark:border-surface-800/40 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                            <UserPlus size={16} className="text-brand" /> Nuevo Usuario
                        </h4>
                        <button onClick={() => setShowAddForm(false)} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Nombre</label>
                        <input
                            type="text"
                            placeholder="Ej: Maria, Juan"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                            autoFocus
                        />
                    </div>

                    {/* Role Selector */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Rol</label>
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(ROLE_CONFIG).map(([key, conf]) => {
                                const Icon = conf.icon;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => setNewRole(key)}
                                        className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all border flex items-center justify-center gap-2 ${newRole === key
                                            ? `${conf.bg} ${conf.border} ${conf.text} shadow-sm`
                                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <Icon size={14} /> {conf.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* PIN */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-2">PIN de {PIN_POLICY.MIN_LENGTH} dígitos</label>
                        <PinInput value={newPin} onChange={setNewPin} label="new" length={PIN_POLICY.MIN_LENGTH} />
                    </div>

                    {/* Submit */}
                    <button
                        onClick={handleAdd}
                        disabled={!newName.trim() || newPin.length !== PIN_POLICY.MIN_LENGTH}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-brand hover:bg-brand-dark disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] shadow-md shadow-primary/20 disabled:shadow-none"
                    >
                        <Check size={16} /> Crear Usuario
                    </button>
                </div>
            )}

            {/* ─── Change PIN Modal ────────────────────── */}
            {changePinUser && (
                <div 
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" 
                    onClick={() => { 
                        setChangePinUser(null); 
                        setChangePinStep(1);
                        setCurrentPinValue(''); 
                        setPinValue(''); 
                        setConfirmPinValue(''); 
                        setShowPin(false);
                    }}
                >
                    <div 
                        className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 transition-all border border-slate-105 dark:border-slate-800" 
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Cabecera */}
                        <div className="text-center mb-5">
                            <div className={`w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br ${ROLE_CONFIG[changePinUser.rol]?.gradient || 'from-slate-500 to-slate-600'} flex items-center justify-center mb-3 shadow-lg relative`}>
                                <span className="text-white font-black text-2xl">{(changePinUser.nombre || 'U')[0].toUpperCase()}</span>
                                {changePinUser.rol === 'ADMIN' && (
                                    <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                                        <Crown size={14} className="text-yellow-400 fill-yellow-400 drop-shadow-sm" />
                                    </div>
                                )}
                            </div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Cambiar PIN</h3>
                            <p className="text-xs font-semibold text-slate-400 mt-0.5">{changePinUser.nombre} · {ROLE_CONFIG[changePinUser.rol]?.label}</p>

                            {/* Badge de paso activo */}
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-light dark:bg-surface-800/30 rounded-full mt-3 border border-indigo-200/50 dark:border-surface-700/50">
                                <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand">
                                    {changePinStep === 1 && 'Paso 1 de 3: Identidad'}
                                    {changePinStep === 2 && 'Paso 2 de 3: Nuevo PIN'}
                                    {changePinStep === 3 && 'Paso 3 de 3: Confirmación'}
                                </span>
                            </div>

                            {/* Indicador de pasos visual */}
                            <div className="flex justify-center gap-1.5 mt-3">
                                {[1, 2, 3].map(step => (
                                    <div
                                        key={step}
                                        className={`h-1.5 rounded-full transition-all duration-300 ${
                                            changePinStep === step
                                                ? 'w-7 bg-brand'
                                                : changePinStep > step
                                                    ? 'w-2.5 bg-emerald-500'
                                                    : 'w-2.5 bg-slate-200 dark:bg-slate-700'
                                        }`}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Contenido según el paso */}
                        <div className="min-h-[100px] flex flex-col justify-center animate-in fade-in slide-in-from-right-2 duration-200">
                            {changePinStep === 1 && (
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black text-slate-400 block text-center tracking-wider">PIN Actual</label>
                                    <PinInput
                                        value={currentPinValue}
                                        onChange={setCurrentPinValue}
                                        label="current"
                                        length={PIN_POLICY.MIN_LENGTH}
                                        showDigits={showPin}
                                    />
                                    <p className="text-[10px] text-slate-400 text-center font-medium">Ingresa tu PIN actual para verificar tu identidad</p>
                                </div>
                            )}

                            {changePinStep === 2 && (
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black text-slate-400 block text-center tracking-wider">Nuevo PIN</label>
                                    <PinInput
                                        value={pinValue}
                                        onChange={setPinValue}
                                        label="change"
                                        length={PIN_POLICY.MIN_LENGTH}
                                        showDigits={showPin}
                                    />
                                    {isWeakPin(pinValue) ? (
                                        <p className="text-[10px] text-amber-500 font-bold text-center mt-1 animate-in fade-in">
                                            ⚠️ Este PIN es muy fácil de adivinar
                                        </p>
                                    ) : (
                                        <p className="text-[10px] text-slate-400 text-center font-medium">Elige 6 dígitos seguros para tu perfil</p>
                                    )}
                                </div>
                            )}

                            {changePinStep === 3 && (
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black text-slate-400 block text-center tracking-wider">Confirmar Nuevo PIN</label>
                                    <PinInput
                                        value={confirmPinValue}
                                        onChange={setConfirmPinValue}
                                        label="confirm"
                                        length={PIN_POLICY.MIN_LENGTH}
                                        showDigits={showPin}
                                    />
                                    <p className="text-[10px] text-slate-400 text-center font-medium">Vuelve a escribir el PIN para confirmar</p>
                                </div>
                            )}
                        </div>

                        {/* Control de visibilidad */}
                        <div className="flex items-center justify-center gap-2 my-4">
                            <button
                                onClick={() => setShowPin(!showPin)}
                                className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1.5 transition-all bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 rounded-full border border-slate-200/60 dark:border-slate-700/60 active:scale-95 shadow-sm"
                            >
                                {showPin ? <EyeOff size={13} className="text-slate-500" /> : <Eye size={13} className="text-slate-500" />}
                                <span>{showPin ? 'Ocultar Dígitos' : 'Mostrar Dígitos'}</span>
                            </button>
                        </div>

                        {/* Botones de acción */}
                        <div className="flex gap-2.5">
                            {changePinStep === 1 && (
                                <>
                                    <button
                                        onClick={() => {
                                            setChangePinUser(null);
                                            setChangePinStep(1);
                                            setCurrentPinValue('');
                                            setPinValue('');
                                            setConfirmPinValue('');
                                            setShowPin(false);
                                        }}
                                        className="flex-1 py-3 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleNextStep1}
                                        disabled={currentPinValue.length !== PIN_POLICY.MIN_LENGTH}
                                        className="flex-1 py-3 text-xs font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none shadow-md shadow-brand/20"
                                    >
                                        Continuar
                                    </button>
                                </>
                            )}

                            {changePinStep === 2 && (
                                <>
                                    <button
                                        onClick={() => { setChangePinStep(1); setShowPin(false); }}
                                        className="flex-1 py-3 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                                    >
                                        Atrás
                                    </button>
                                    <button
                                        onClick={handleNextStep2}
                                        disabled={pinValue.length !== PIN_POLICY.MIN_LENGTH}
                                        className="flex-1 py-3 text-xs font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none shadow-md shadow-brand/20"
                                    >
                                        Continuar
                                    </button>
                                </>
                            )}

                            {changePinStep === 3 && (
                                <>
                                    <button
                                        onClick={() => { setChangePinStep(2); setShowPin(false); }}
                                        className="flex-1 py-3 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                                    >
                                        Atrás
                                    </button>
                                    <button
                                        onClick={handleChangePin}
                                        disabled={confirmPinValue.length !== PIN_POLICY.MIN_LENGTH}
                                        className="flex-1 py-3 text-xs font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none shadow-md shadow-brand/20"
                                    >
                                        Guardar PIN
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Delete Confirmation ─────────────────── */}
            {deleteUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setDeleteUser(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200 text-center" onClick={e => e.stopPropagation()}>
                        <div className="w-14 h-14 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4">
                            <AlertTriangle size={28} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Eliminar Usuario</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                            ¿Seguro que deseas eliminar a <strong>"{deleteUser.nombre}"</strong>? Esta accion no se puede deshacer.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteUser(null)}
                                className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDelete}
                                className="flex-1 py-3 text-sm font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 active:scale-95 transition-all"
                            >
                                Si, eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Edit Name Modal ────────────────────── */}
            {editNameUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setEditNameUser(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="text-center mb-6">
                            <div className={`w-14 h-14 mx-auto rounded-xl bg-gradient-to-br ${ROLE_CONFIG[editNameUser.rol]?.gradient || 'from-slate-500 to-slate-600'} flex items-center justify-center mb-3`}>
                                <span className="text-white font-black text-2xl">{(editNameUser.nombre || 'U')[0].toUpperCase()}</span>
                            </div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Cambiar Nombre</h3>
                            <p className="text-xs text-slate-400 mt-1">{editNameUser.rol}</p>
                        </div>

                        <div className="mb-6">
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5 ml-1">Nuevo Nombre</label>
                            <input
                                autoFocus
                                type="text"
                                value={editNameValue}
                                onChange={e => setEditNameValue(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-brand/30 outline-none text-slate-800 dark:text-white transition-all text-center"
                                placeholder="..."
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setEditNameUser(null)}
                                className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleEditName}
                                disabled={!editNameValue.trim()}
                                className="flex-1 py-3 text-sm font-bold text-white bg-brand rounded-xl hover:bg-brand-dark active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Modal Personalizado: Clave Maestra de Emergencia ─── */}
            {showEmergencyConfigModal && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setShowEmergencyConfigModal(false)}
                >
                    <div
                        className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="text-center mb-5">
                            <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-3">
                                <Shield size={24} />
                            </div>
                            <h3 className="text-base font-bold text-slate-800 dark:text-white">Clave Maestra de Emergencia</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Establece una clave secreta para la autorización de recuperación de PINs de los usuarios.
                            </p>
                        </div>

                        <div className="mb-5 space-y-3">
                            <div>
                                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5 ml-1">Nueva Clave Secreta</label>
                                <div className="relative">
                                    <input
                                        autoFocus
                                        type={showEmergencyKeyText ? "text" : "password"}
                                        value={emergencyKeyInput}
                                        onChange={e => setEmergencyKeyInput(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl pl-4 pr-11 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500/30 outline-none text-slate-800 dark:text-white transition-all text-center tracking-wider"
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowEmergencyKeyText(!showEmergencyKeyText)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                    >
                                        {showEmergencyKeyText ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5 ml-1">Confirmar Clave Secreta</label>
                                <div className="relative">
                                    <input
                                        type={showEmergencyKeyText ? "text" : "password"}
                                        value={emergencyKeyConfirm}
                                        onChange={e => setEmergencyKeyConfirm(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-2xl pl-4 pr-11 py-3 text-sm font-bold focus:ring-2 focus:ring-amber-500/30 outline-none text-slate-800 dark:text-white transition-all text-center tracking-wider"
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowEmergencyKeyText(!showEmergencyKeyText)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                                    >
                                        {showEmergencyKeyText ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => {
                                    const val = emergencyKeyInput.trim();
                                    const confirmVal = emergencyKeyConfirm.trim();

                                    if (val !== confirmVal) {
                                        return showToast('Las claves no coinciden', 'error');
                                    }
                                    if (val.length > 0 && val.length < 6) {
                                        return showToast('La clave debe tener al menos 6 caracteres', 'error');
                                    }
                                    if (!val) {
                                        localStorage.removeItem('pda_emergency_pin');
                                        showToast('Clave de Emergencia restablecida al valor por defecto', 'success');
                                    } else {
                                        localStorage.setItem('pda_emergency_pin', val);
                                        showToast('Clave Maestra de Emergencia actualizada', 'success');
                                    }
                                    triggerHaptic?.();
                                    setShowEmergencyConfigModal(false);
                                }}
                                className="w-full py-3 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-2xl active:scale-95 transition-all shadow-md shadow-amber-500/20"
                            >
                                Guardar Clave
                            </button>

                            <button
                                onClick={() => {
                                    localStorage.removeItem('pda_emergency_pin');
                                    setEmergencyKeyInput('');
                                    showToast('Clave restablecida al valor por defecto', 'info');
                                    triggerHaptic?.();
                                    setShowEmergencyConfigModal(false);
                                }}
                                className="w-full py-2.5 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800/60 rounded-2xl transition-all"
                            >
                                Restablecer por Defecto
                            </button>

                            <button
                                onClick={() => setShowEmergencyConfigModal(false)}
                                className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors mt-1"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
