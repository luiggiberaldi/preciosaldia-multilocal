import React, { useState, useEffect } from 'react';
import { Users, UserPlus, KeyRound, Shield, ShoppingCart, Trash2, Edit2, Check, X } from 'lucide-react';
import { storageService } from '../../utils/storageService';
import { showToast } from '../Toast';
import { SUPERVISOR_REMOTE_MUTATIONS_ENABLED } from '../../config/supervisorPolicy';
import { sendSupervisorCommand } from '../../services/supervisorCommandService';
import SupervisorSelect from './SupervisorSelect';

export default function RemoteUsersManager({ targetDeviceId }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [showPinModal, setShowPinModal] = useState(false);
    const [newPin, setNewPin] = useState('');

    const [formUser, setFormUser] = useState({
        nombre: '',
        rol: 'CAJERO',
        pin: '',
        bypassPin: false
    });

    const loadUsers = async () => {
        try {
            setLoading(true);
            const savedCatalog = await storageService.getItem('bodega_users_catalog_v1', []);
            if (Array.isArray(savedCatalog) && savedCatalog.length > 0) {
                setUsers(savedCatalog);
            } else {
                const savedAuth = await storageService.getItem('abasto-auth-storage', null);
                if (savedAuth?.state?.usuarios) {
                    setUsers(savedAuth.state.usuarios);
                } else {
                    setUsers([]);
                }
            }
        } catch (e) {
            console.error('[RemoteUsersManager] Error cargando catálogo de usuarios:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
        const handleUpdate = () => loadUsers();
        window.addEventListener('app_storage_update', handleUpdate);
        return () => window.removeEventListener('app_storage_update', handleUpdate);
    }, []);

    const sendUserCommand = async (payload) => {
        if (!SUPERVISOR_REMOTE_MUTATIONS_ENABLED) {
            showToast('Las mutaciones remotas están temporalmente deshabilitadas por seguridad', 'warning');
            return false;
        }

        if (!targetDeviceId) {
            showToast('No hay conexión con la caja registradora', 'error');
            return;
        }

        try {
            const typeByAction = {
                add: 'supervisor.user.create',
                change_pin: 'supervisor.user.pin.change',
                edit: 'supervisor.user.update',
                delete: 'supervisor.user.delete',
            };
            const type = typeByAction[payload.action];
            if (!type) {
                showToast('Acción de usuario no permitida', 'error');
                return false;
            }

            const result = await sendSupervisorCommand({
                type,
                targetDeviceId,
                payload: {
                    ...payload,
                    patch: payload.action === 'edit'
                        ? { nombre: payload.nombre, rol: payload.rol, bypassPin: payload.bypassPin }
                        : undefined,
                },
            });
            if (!result.ok) {
                showToast(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return false;
            }

            const ack = await result.ackPromise;
            if (!ack?.ok) {
                showToast(ack?.error || 'La caja no confirmó la orden de usuario', 'error');
                return false;
            }

            showToast('👤 Orden de usuario confirmada en la caja', 'success');
            return true;
        } catch (e) {
            console.error('[RemoteUsersManager] Error enviando orden:', e);
            showToast('Error enviando orden a la caja', 'error');
            return false;
        }
    };

    const handleAddUser = async (e) => {
        e.preventDefault();
        if (!formUser.nombre.trim()) {
            showToast('Ingresa un nombre para el usuario', 'error');
            return;
        }

        await sendUserCommand({
            action: 'add',
            nombre: formUser.nombre.trim(),
            rol: formUser.rol,
            newPin: formUser.pin || '000000',
            bypassPin: formUser.bypassPin
        });

        setShowAddModal(false);
        setFormUser({ nombre: '', rol: 'CAJERO', pin: '', bypassPin: false });
    };

    const handleResetPin = async (e) => {
        e.preventDefault();
        if (!newPin || newPin.length < 4) {
            showToast('El nuevo PIN debe tener al menos 4 dígitos', 'error');
            return;
        }

        await sendUserCommand({
            action: 'change_pin',
            userId: selectedUser.id,
            newPin: newPin
        });

        setShowPinModal(false);
        setSelectedUser(null);
        setNewPin('');
    };

    const handleDeleteUser = async (user) => {
        if (!window.confirm(`¿Estás seguro de eliminar el usuario ${user.nombre} remotamente?`)) return;

        await sendUserCommand({
            action: 'delete',
            userId: user.id
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm">
                <div>
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-500" />
                        <span>Cajeros y Personal</span>
                    </h3>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">Gestión remota de usuarios y reseteo de claves de acceso</p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95"
                >
                    <UserPlus className="w-4 h-4" />
                    <span>Agregar Cajero</span>
                </button>
            </div>

            {/* List */}
            {loading ? (
                <div className="p-8 text-center text-slate-500 font-bold">Cargando personal de la caja...</div>
            ) : users.length === 0 ? (
                <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <p className="text-slate-500 font-bold text-sm">No se encontraron usuarios registrados en la caja.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {users.map(u => {
                        const isAdmin = u.rol === 'ADMIN';
                        return (
                            <div key={u.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl space-y-3 shadow-sm">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2.5 rounded-xl ${isAdmin ? 'bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'}`}>
                                            {isAdmin ? <Shield className="w-5 h-5" /> : <ShoppingCart className="w-5 h-5" />}
                                        </div>
                                        <div>
                                            <h4 className="font-black text-slate-800 dark:text-white text-sm">{u.nombre}</h4>
                                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${isAdmin ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
                                                {isAdmin ? 'Administrador' : 'Cajero'}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    {/* Action buttons */}
                                    <div className="flex items-center gap-1">
                                        <button
                                            title="Resetear PIN"
                                            onClick={() => { setSelectedUser(u); setShowPinModal(true); }}
                                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg transition-colors"
                                        >
                                            <KeyRound className="w-4 h-4" />
                                        </button>
                                        {!isAdmin && (
                                            <button
                                                title="Eliminar usuario"
                                                onClick={() => handleDeleteUser(u)}
                                                className="p-2 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal: Agregar Usuario */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-black text-slate-800 dark:text-white">Nuevo Usuario / Cajero</h3>
                            <button onClick={() => setShowAddModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
                        </div>
                        <form onSubmit={handleAddUser} className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400">Nombre</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Ej: Pedro Pérez"
                                    value={formUser.nombre}
                                    onChange={e => setFormUser({ ...formUser, nombre: e.target.value })}
                                    className="w-full mt-1 p-3 bg-slate-50 dark:bg-slate-800 border rounded-xl font-bold text-sm"
                                />
                            </div>
                            <SupervisorSelect
                                label="Rol"
                                ariaLabel="Seleccionar rol del usuario"
                                value={formUser.rol}
                                onChange={(rol) => setFormUser({ ...formUser, rol })}
                                options={[
                                    { value: 'CAJERO', label: 'Cajero' },
                                    { value: 'ADMIN', label: 'Administrador' },
                                ]}
                            />
                            <div>
                                <label className="text-xs font-bold text-slate-400">PIN Inicial (4-6 dígitos)</label>
                                <input
                                    type="password"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={formUser.pin}
                                    onChange={e => setFormUser({ ...formUser, pin: e.target.value })}
                                    className="w-full mt-1 p-3 bg-slate-50 dark:bg-slate-800 border rounded-xl font-bold text-sm text-center tracking-widest"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 font-bold text-sm rounded-xl">Cancelar</button>
                                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white font-bold text-sm rounded-xl">Crear en Caja</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Reset PIN */}
            {showPinModal && selectedUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-black text-slate-800 dark:text-white">Resetear PIN de {selectedUser.nombre}</h3>
                            <button onClick={() => setShowPinModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
                        </div>
                        <form onSubmit={handleResetPin} className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400">Nuevo PIN de Acceso</label>
                                <input
                                    type="password"
                                    required
                                    maxLength={6}
                                    placeholder="123456"
                                    value={newPin}
                                    onChange={e => setNewPin(e.target.value)}
                                    className="w-full mt-1 p-3 bg-slate-50 dark:bg-slate-800 border rounded-xl font-bold text-sm text-center tracking-widest"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button type="button" onClick={() => setShowPinModal(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 font-bold text-sm rounded-xl">Cancelar</button>
                                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white font-bold text-sm rounded-xl">Guardar PIN</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
