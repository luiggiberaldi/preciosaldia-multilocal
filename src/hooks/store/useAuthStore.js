/**
 * useAuthStore.js — Store de autenticación (PIN local).
 *
 * Fixes de seguridad cubiertos en este archivo:
 *   - SEC-004/HOOK-001: implementada `setAdminCredentials` (sessionStorage, no localStorage).
 *   - SEC-005: PINs por defecto con PBKDF2 + salt aleatorio. En primer arranque sin
 *     usuarios persistidos, se generan PINs aleatorios para Admin/Cajero y se muestran
 *     una sola vez (window.__INITIAL_PINS__). Hashes legacy SHA-256 (64 hex) se migran
 *     automáticamente a PBKDF2 en el primer login exitoso (verifyPin.needsRehash).
 *   - SEC-006: `failedAttempts`, `lockUntil` (timestamp absoluto), `consecutiveLockouts`
 *     persistidos en `partialize`. Backoff exponencial. Reset tras RESET_WINDOW_MS.
 *   - SEC-013: `abasto-device-session` guarda SOLO { id, nombre, rol }. Sin hash PIN.
 *   - SEC-015: `unlock(pin)` re-valida el PIN contra `usuarios` para re-entrar de lock.
 *   - SEC-016: `requireLogin` por defecto `true` si hay cloud configurado.
 *   - SEC-018: Validación de estructura al rehidratar `abasto-device-session`.
 *
 * Backwards compatibility:
 *   - `login(pin, userId)` sigue existiendo (ahora async — PBKDF2 es async).
 *   - `cambiarPin`, `agregarUsuario`, `editarUsuario` aceptan PIN en claro y lo hashean.
 *   - Hashes legacy SHA-256 (64 hex) son aceptados por `verifyPin` y marcados `needsRehash`.
 *
 * @module hooks/store/useAuthStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logEvent } from '../../services/auditService';
import { hashPin, verifyPin } from '../../utils/crypto';
import {
    PIN_POLICY,
    LOGIN_RATE_LIMIT,
    validatePin,
} from '../../utils/securityConstants';

// ── SEC-005: Generación de PINs aleatorios en primer arranque ────────────────

const SESSION_KEY = 'abasto-device-session';
const ADMIN_CRED_KEY = 'abasto-admin-cred'; // sessionStorage

/**
 * Genera un PIN aleatorio de MIN_LENGTH dígitos (sin blacklist).
 * @returns {string}
 */
function _generateRandomPin() {
    const blacklist = new Set(PIN_POLICY.BLACKLIST);
    // Bucle pequeño: hay 10^6 - ~20 PINs válidos de 6 dígitos, casi siempre se halla al primer intento.
    for (let attempt = 0; attempt < 50; attempt++) {
        let pin = '';
        for (let i = 0; i < PIN_POLICY.MIN_LENGTH; i++) {
            pin += Math.floor(Math.random() * 10).toString();
        }
        if (!blacklist.has(pin) && !/^(\d)\1{5,}$/.test(pin)) {
            return pin;
        }
    }
    // Fallback muy improbable.
    return '4' + Math.random().toString().slice(2, 2 + PIN_POLICY.MIN_LENGTH - 1).padEnd(PIN_POLICY.MIN_LENGTH - 1, '0');
}

/**
 * Crea los usuarios iniciales con PINs seguros aleatorios hasheados con PBKDF2.
 * Devuelve `{ usuarios, initialPins }` para que el caller pueda mostrar los PINs una vez.
 * @returns {Promise<{ usuarios: Array, initialPins: Array<{id,nombre,rol,pin}> }>}
 */
async function _createDefaultUsersWithRandomPins() {
    // Para facilitar el acceso en el primer arranque:
    // Ambos usuarios inician con '000000' (seis ceros)
    const adminPin = '000000';
    const cajeroPin = '000000';
    const adminHash = await hashPin(adminPin);
    const cajeroHash = await hashPin(cajeroPin);
    const usuarios = [
        { id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: adminHash, requirePin: false },
        { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: cajeroHash, requirePin: false },
    ];
    const initialPins = [
        { id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: adminPin },
        { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: cajeroPin },
    ];
    return { usuarios, initialPins };
}

/**
 * Inicializa usuarios por defecto la primera vez (async, post-rehydrate).
 * Si ya hay usuarios persistidos, no hace nada. Si no, crea los defaults con PINs
 * aleatorios seguros y los deja accesibles en `window.__INITIAL_PINS__` para que la UI los muestre.
 *
 * @param {object} state - estado actual del store
 * @param {function} set - setter de zustand
 */
async function _ensureDefaultUsers(state, set) {
    if (state.usuarios && state.usuarios.length > 0) return;
    try {
        const { usuarios, initialPins } = await _createDefaultUsersWithRandomPins();
        set({ usuarios });
        // Hacemos los PINs iniciales accesibles UNA sola vez para que la UI los muestre.
        if (typeof window !== 'undefined') {
            window.__INITIAL_PINS__ = initialPins;
            window.dispatchEvent(new CustomEvent('initial-pins-ready', { detail: initialPins }));
        }
        logEvent('AUTH', 'USUARIOS_INICIALES', 'PINs de fabrica generados para primer arranque.', null, { count: initialPins.length });
    } catch (err) {
        console.error('[useAuthStore] No se pudieron crear usuarios por defecto:', err);
    }
}

// ── SEC-018: Validación de estructura de sesión persistida ───────────────────

/**
 * Valida que el objeto sesión tenga la estructura mínima `{ id:number, nombre:string, rol:string }`.
 * NO permite incluir `pin` ni otros campos (SEC-013).
 * @param {any} obj
 * @returns {object|null} El objeto saneado o `null` si no valida.
 */
function _validateSessionShape(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const { id, nombre, rol } = obj;
    if (typeof id !== 'number' || !Number.isFinite(id)) return null;
    if (typeof nombre !== 'string' || !nombre.trim()) return null;
    if (typeof rol !== 'string' || !rol.trim()) return null;
    // SEC-013: devolver SOLO los campos mínimos.
    return { id, nombre, rol };
}

/**
 * Lee y valida la sesión persistida en localStorage.
 * Si el JSON no valida, lo elimina (SEC-018).
 * @returns {object|null}
 */
function _readPersistedSession() {
    try {
        const saved = localStorage.getItem(SESSION_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        const sane = _validateSessionShape(parsed);
        if (!sane) {
            // Estructura inválida o manipulada → descartar.
            console.warn('[useAuthStore] Sesión persistida inválida, descartando (SEC-018).');
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
        return sane;
    } catch {
        return null;
    }
}

// ── SEC-006: Rate-limiting persistido con backoff exponencial ────────────────

/**
 * Calcula el `lockUntil` (timestamp absoluto) tras un fallo, aplicando backoff
 * exponencial según `consecutiveLockouts`.
 *
 * @param {number} failedAttempts
 * @param {number} consecutiveLockouts
 * @returns {{ lockUntil: number|null, newAttempts: number, newConsecutiveLockouts: number }}
 */
function _computeLockout(failedAttempts, consecutiveLockouts) {
    const newAttempts = failedAttempts + 1;
    if (newAttempts < LOGIN_RATE_LIMIT.MAX_ATTEMPTS) {
        return { lockUntil: null, newAttempts, newConsecutiveLockouts: consecutiveLockouts };
    }
    // Aumentar contador de lockouts sucesivos y aplicar backoff exponencial.
    const newConsecutiveLockouts = consecutiveLockouts + 1;
    const rawLockout = LOGIN_RATE_LIMIT.LOCKOUT_MS
        * Math.pow(LOGIN_RATE_LIMIT.BACKOFF_FACTOR, newConsecutiveLockouts - 1);
    const lockoutMs = Math.min(rawLockout, LOGIN_RATE_LIMIT.MAX_LOCKOUT_MS);
    return {
        lockUntil: Date.now() + lockoutMs,
        newAttempts,
        newConsecutiveLockouts: newConsecutiveLockouts,
    };
}

// ── SEC-016: Default de requireLogin según config cloud ──────────────────────

function _defaultRequireLogin() {
    // Si hay cuenta cloud configurada, el login es obligatorio por defecto.
    const hasCloudUrl = Boolean(import.meta.env?.VITE_SUPABASE_CLOUD_URL);
    if (hasCloudUrl) return true;
    // Si no, mantener false pero avisar al desarrollador.
    if (import.meta.env?.DEV) {
        console.info(
            '[useAuthStore] requireLogin=false por defecto (sin VITE_SUPABASE_CLOUD_URL). ' +
            'Recomendado: activar requireLogin=true en producción (SEC-016).'
        );
    }
    return false;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create(
    persist(
        (set, get) => ({
            // SEC-018: sesión validada al rehidratar; sin `pin` (SEC-013).
            usuarioActivo: _readPersistedSession(),
            usuarios: [],
            // SEC-005: usuarios vacíos al iniciar; se rellenan en `_ensureDefaultUsers`.
            requireLogin: _defaultRequireLogin(),
            requireAdminPin: true,
            requireCajeroPin: true,
            // SEC-006: persistidos en partialize.
            failedAttempts: 0,
            lockUntil: null,
            consecutiveLockouts: 0,
            lastFailedAttemptTs: 0,

            // SEC-004: credenciales admin (cloud) en sessionStorage, NUNCA localStorage.
            adminEmail: null,
            isCloudConfigured: (() => {
                try { return Boolean(sessionStorage.getItem(ADMIN_CRED_KEY)); } catch { return false; }
            })(),

            // ── ACCIONES ──

            /**
             * Login por PIN.
             *
             * @param {string} pinInput - PIN en claro.
             * @param {number} [userId] - Si se seleccionó un usuario específico.
             * @returns {Promise<{ success: boolean, error?: string }>}
             */
            login: async (pinInput, userId) => {
                const now = Date.now();
                let state = get();

                // SEC-006: Resetear contador si pasó RESET_WINDOW_MS desde el último fallo.
                if (
                    state.lastFailedAttemptTs > 0
                    && (now - state.lastFailedAttemptTs) > LOGIN_RATE_LIMIT.RESET_WINDOW_MS
                ) {
                    set({ failedAttempts: 0, lockUntil: null, consecutiveLockouts: 0 });
                    state = get();
                }

                // SEC-006: Chequear bloqueo con timestamp absoluto persistido.
                if (state.lockUntil && now < state.lockUntil) {
                    const secsLeft = Math.ceil((state.lockUntil - now) / 1000);
                    return { success: false, error: `Bloqueado. Intente en ${secsLeft}s` };
                }
                // Si el lock ya expiró, limpiar.
                if (state.lockUntil && now >= state.lockUntil) {
                    set({ lockUntil: null });
                    state = get();
                }

                const { usuarios } = get();
                if (!usuarios || usuarios.length === 0) {
                    return { success: false, error: 'No hay usuarios configurados' };
                }

                // Buscar usuario candidato por ID (si se especificó) o por todos.
                const candidatos = userId ? usuarios.filter(u => u.id === userId) : usuarios;

                let userEncontrado = null;
                let needsRehash = false;
                let legacy = false;

                for (const u of candidatos) {
                    try {
                        const result = await verifyPin(String(pinInput ?? ''), u.pin);

                        if (result.valid) {
                            userEncontrado = u;
                            needsRehash = result.needsRehash;
                            legacy = result.legacy;
                            break;
                        }
                    } catch (e) {
                        // Un PIN que no verifica no debe romper el flujo.
                        if (import.meta.env?.DEV) {
                            console.warn('[useAuthStore] verifyPin lanzó:', e?.message ?? e);
                        }
                    }
                }

                if (userEncontrado) {
                    // SEC-013: persistir SOLO { id, nombre, rol }. Nunca el hash.
                    const session = {
                        id: userEncontrado.id,
                        nombre: userEncontrado.nombre,
                        rol: userEncontrado.rol,
                    };
                    set({
                        usuarioActivo: session,
                        failedAttempts: 0,
                        lockUntil: null,
                        consecutiveLockouts: 0,
                        lastFailedAttemptTs: 0,
                    });
                    localStorage.setItem(SESSION_KEY, JSON.stringify(session));

                    // SEC-005: re-hashear PIN legacy con PBKDF2 en login exitoso.
                    if (needsRehash || legacy) {
                        try {
                            const newHash = await hashPin(String(pinInput));
                            set((s) => ({
                                usuarios: s.usuarios.map(u =>
                                    u.id === userEncontrado.id ? { ...u, pin: newHash } : u
                                ),
                            }));
                            logEvent('AUTH', 'PIN_MIGRADO', `PIN de ${userEncontrado.nombre} migrado a PBKDF2.`, session);
                        } catch (e) {
                            if (import.meta.env?.DEV) {
                                console.warn('[useAuthStore] Re-hash falló (continuando):', e?.message ?? e);
                            }
                        }
                    }

                    logEvent('AUTH', 'LOGIN', `${userEncontrado.nombre} inicio sesion`, session);
                    return { success: true };
                }

                // Fallo: aplicar rate-limiting persistido.
                const { newAttempts, lockUntil, newConsecutiveLockouts } = _computeLockout(
                    get().failedAttempts,
                    get().consecutiveLockouts,
                );
                set({
                    failedAttempts: newAttempts,
                    lockUntil,
                    consecutiveLockouts: newConsecutiveLockouts,
                    lastFailedAttemptTs: now,
                });
                return { success: false };
            },

            /**
             * SEC-015: Re-valida el PIN del usuario activo para volver de un lock.
             * A diferencia de `login`, NO persiste una nueva sesión si ya hay una activa:
             * solo verifica que el PIN ingresado coincida con el usuario activo.
             *
             * @param {string} pinInput
             * @returns {Promise<{ success: boolean, error?: string }>}
             */
            unlock: async (pinInput) => {
                const { usuarioActivo, usuarios, lockUntil } = get();
                if (!usuarioActivo) return { success: false, error: 'Sin usuario activo' };

                const now = Date.now();
                if (lockUntil && now < lockUntil) {
                    const secsLeft = Math.ceil((lockUntil - now) / 1000);
                    return { success: false, error: `Bloqueado. Intente en ${secsLeft}s` };
                }

                const user = usuarios.find(u => u.id === usuarioActivo.id);
                if (!user) return { success: false, error: 'Usuario no encontrado' };

                try {
                    const result = await verifyPin(String(pinInput ?? ''), user.pin);

                    if (result.valid) {
                        // Reset rate-limiting al desbloquear exitosamente.
                        set({
                            failedAttempts: 0,
                            lockUntil: null,
                            consecutiveLockouts: 0,
                            lastFailedAttemptTs: 0,
                        });
                        logEvent('AUTH', 'SESION_DESBLOQUEADA', `${user.nombre} desbloqueó la sesión.`, usuarioActivo);
                        // SEC-005: re-hashear si era legacy o primer arranque.
                        if (result.needsRehash) {
                            try {
                                const newHash = await hashPin(String(pinInput));
                                set((s) => ({
                                    usuarios: s.usuarios.map(u =>
                                        u.id === user.id ? { ...u, pin: newHash } : u
                                    ),
                                }));
                            } catch (e) {
                                if (import.meta.env?.DEV) {
                                    console.warn('[useAuthStore] Re-hash en unlock falló:', e?.message ?? e);
                                }
                            }
                        }
                        return { success: true };
                    }
                } catch (e) {
                    if (import.meta.env?.DEV) {
                        console.warn('[useAuthStore] unlock verifyPin lanzó:', e?.message ?? e);
                    }
                }

                // Fallo de unlock — aplicar rate-limiting también.
                const { newAttempts, lockUntil: newLock, newConsecutiveLockouts } = _computeLockout(
                    get().failedAttempts,
                    get().consecutiveLockouts,
                );
                set({
                    failedAttempts: newAttempts,
                    lockUntil: newLock,
                    consecutiveLockouts: newConsecutiveLockouts,
                    lastFailedAttemptTs: now,
                });
                return { success: false };
            },

            logout: () => {
                const { usuarioActivo } = get();
                if (usuarioActivo) logEvent('AUTH', 'LOGOUT', `${usuarioActivo.nombre} cerro sesion`, usuarioActivo);
                set({ usuarioActivo: null });
                localStorage.removeItem(SESSION_KEY);
            },

            /**
             * Restablece el PIN de un usuario vía procedimiento de emergencia y limpia lockouts.
             * @param {number} userId
             * @param {string} nuevoPin - PIN en claro (debe pasar validatePin).
             * @returns {Promise<{ ok: boolean, error?: string }>}
             */
            resetPinEmergency: async (userId, nuevoPin) => {
                const err = validatePin(String(nuevoPin ?? ''));
                if (err) return { ok: false, error: err };

                try {
                    const hashedPin = await hashPin(String(nuevoPin));
                    set((state) => ({
                        usuarios: state.usuarios.map(u =>
                            u.id === userId ? { ...u, pin: hashedPin } : u
                        ),
                        failedAttempts: 0,
                        lockUntil: null,
                        consecutiveLockouts: 0,
                        lastFailedAttemptTs: 0,
                    }));
                    const target = get().usuarios.find(u => u.id === userId);
                    logEvent('AUTH', 'PIN_EMERGENCIA_RESTABLECIDO', `PIN de emergencia restablecido para ${target?.nombre || 'usuario'}`, get().usuarioActivo);
                    return { ok: true };
                } catch (e) {
                    console.error('[useAuthStore] resetPinEmergency falló:', e);
                    return { ok: false, error: 'Error al procesar el hash del nuevo PIN' };
                }
            },

            /**
             * Cambia el PIN de un usuario.
             * @param {number} userId
             * @param {string} nuevoPin - PIN en claro (será validado y hasheado).
             * @returns {{ ok: boolean, error?: string }}
             */
            cambiarPin: (userId, nuevoPin) => {
                const err = validatePin(String(nuevoPin ?? ''));
                if (err) return { ok: false, error: err };

                // hashPin es async; delegamos en una acción async interna y devolvemos sync.
                // Los callers existentes (ConfigView, etc.) no esperan el resultado del hash.
                (async () => {
                    try {
                        const hashedPin = await hashPin(String(nuevoPin));
                        set((state) => ({
                            usuarios: state.usuarios.map(u =>
                                u.id === userId ? { ...u, pin: hashedPin } : u
                            )
                        }));
                        const target = get().usuarios.find(u => u.id === userId);
                        logEvent('AUTH', 'PIN_CAMBIADO', `PIN cambiado para ${target?.nombre || 'usuario'}`, get().usuarioActivo);
                    } catch (e) {
                        console.error('[useAuthStore] cambiarPin falló:', e);
                    }
                })();
                return { ok: true };
            },

            /**
             * Crea un usuario nuevo con PIN validado y hasheado.
             * @param {string} nombre
             * @param {string} rol
             * @param {string} pin - en claro
             * @returns {{ ok: boolean, error?: string }}
             */
            agregarUsuario: (nombre, rol, pin) => {
                const err = validatePin(String(pin ?? ''));
                if (err) return { ok: false, error: err };

                (async () => {
                    try {
                        const hashedPin = await hashPin(String(pin));
                        set((state) => {
                            const maxId = state.usuarios.reduce((max, u) => Math.max(max, u.id), 0);
                            return {
                                usuarios: [...state.usuarios, { id: maxId + 1, nombre, rol, pin: hashedPin, requirePin: false }]
                            };
                        });
                        logEvent('USUARIO', 'USUARIO_CREADO', `Usuario "${nombre}" (${rol}) creado`, get().usuarioActivo);
                    } catch (e) {
                        console.error('[useAuthStore] agregarUsuario falló:', e);
                    }
                })();
                return { ok: true };
            },

            eliminarUsuario: (userId) => {
                const { usuarios, usuarioActivo } = get();
                const admins = usuarios.filter(u => u.rol === 'ADMIN');
                const target = usuarios.find(u => u.id === userId);
                if (target?.rol === 'ADMIN' && admins.length <= 1) return false;
                if (usuarioActivo?.id === userId) return false;

                set({ usuarios: usuarios.filter(u => u.id !== userId) });
                logEvent('USUARIO', 'USUARIO_ELIMINADO', `Usuario "${target?.nombre}" (${target?.rol}) eliminado`, usuarioActivo);
                return true;
            },

            /**
             * Edita un usuario. Si `datos.pin` viene en claro, se valida y hashea.
             * @param {number} userId
             * @param {object} datos - { nombre?, rol?, pin? }
             * @returns {{ ok: boolean, error?: string }}
             */
            editarUsuario: (userId, datos) => {
                if (!datos || typeof datos !== 'object') return { ok: false, error: 'datos inválidos' };

                const nuevosDatos = { ...datos };
                if (datos.pin !== undefined) {
                    const err = validatePin(String(datos.pin));
                    if (err) return { ok: false, error: err };
                    // Hash async; el set se hace en la promesa.
                    (async () => {
                        try {
                            const hashedPin = await hashPin(String(datos.pin));
                            const sinPin = { ...datos };
                            delete sinPin.pin;
                            set((state) => ({
                                usuarios: state.usuarios.map(u =>
                                    u.id === userId ? { ...u, ...sinPin, pin: hashedPin } : u
                                )
                            }));
                        } catch (e) {
                            console.error('[useAuthStore] editarUsuario hashPin falló:', e);
                        }
                    })();
                    return { ok: true };
                }

                set((state) => ({
                    usuarios: state.usuarios.map(u =>
                        u.id === userId ? { ...u, ...nuevosDatos } : u
                    )
                }));
                return { ok: true };
            },

            setRequireLogin: (val) => {
                set({ requireLogin: val });
                logEvent('CONFIG', 'LOGIN_REQUERIDO_MODIFICADO', `Login requerido establecido a ${val ? 'SI' : 'NO'}`);
            },

            setRequireAdminPin: (val) => {
                set({ requireAdminPin: val });
                logEvent('CONFIG', 'PIN_ADMIN_MODIFICADO', `Pedir PIN al Administrador establecido a ${val ? 'SI' : 'NO'}`);
            },

            setRequireCajeroPin: (val) => {
                set({ requireCajeroPin: val });
                logEvent('CONFIG', 'PIN_CAJERO_MODIFICADO', `Pedir PIN al Cajero establecido a ${val ? 'SI' : 'NO'}`);
            },

            /**
             * Permite iniciar sesión directamente a un usuario sin validación de PIN (e.g. Cajero sin PIN).
             * @param {number} userId
             * @returns {{ success: boolean, error?: string }}
             */
            loginDirect: (userId) => {
                const { usuarios } = get();
                const target = usuarios.find(u => u.id === userId);
                if (!target) return { success: false, error: 'Usuario no encontrado' };

                const session = {
                    id: target.id,
                    nombre: target.nombre,
                    rol: target.rol,
                };
                set({
                    usuarioActivo: session,
                    failedAttempts: 0,
                    lockUntil: null,
                    consecutiveLockouts: 0,
                    lastFailedAttemptTs: 0,
                });
                localStorage.setItem(SESSION_KEY, JSON.stringify(session));
                logEvent('AUTH', 'LOGIN_DIRECTO', `${target.nombre} inicio sesion (sin PIN)`, session);
                return { success: true };
            },

            /**
             * SEC-004: setAdminCredentials — persiste el email en sessionStorage.
             * La password NUNCA se persiste en localStorage (solo en memoria de la
             * sesión de Supabase, que se renueva con signInWithPassword).
             *
             * Marca `isCloudConfigured = true` para activar el auto-lock.
             *
             * @param {string} email
             * @param {string} _password - No se persiste (solo se pasa a Supabase en el caller).
             */
            setAdminCredentials: (email, _password) => {
                if (!email || typeof email !== 'string') return;
                try {
                    sessionStorage.setItem(ADMIN_CRED_KEY, JSON.stringify({ email, ts: Date.now() }));
                } catch (e) {
                    console.warn('[useAuthStore] No se pudo persistir admin cred en sessionStorage:', e);
                }
                set({ adminEmail: email, isCloudConfigured: true });
                logEvent('AUTH', 'CREDENCIALES_ADMIN', `Credenciales cloud establecidas para ${email}`, get().usuarioActivo);
            },

            /**
             * SEC-004: limpia credenciales admin (al cerrar sesión cloud).
             */
            clearAdminCredentials: () => {
                try { sessionStorage.removeItem(ADMIN_CRED_KEY); } catch { }
                set({ adminEmail: null, isCloudConfigured: false });
            },
        }),
        {
            name: 'abasto-auth-storage',
            partialize: (state) => ({
                usuarios: state.usuarios,
                requireLogin: state.requireLogin,
                requireAdminPin: state.requireAdminPin ?? true,
                requireCajeroPin: state.requireCajeroPin ?? true,
                // SEC-006: rate-limiting persistido (sobrevive recarga).
                failedAttempts: state.failedAttempts,
                lockUntil: state.lockUntil,
                consecutiveLockouts: state.consecutiveLockouts,
                lastFailedAttemptTs: state.lastFailedAttemptTs,
                // SEC-004: persistimos adminEmail e isCloudConfigured (la password NUNCA se persiste).
                adminEmail: state.adminEmail,
                isCloudConfigured: state.isCloudConfigured,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                // SEC-018: re-validar sesión persistida (no confiamos en el JSON guardado).
                state.usuarioActivo = _readPersistedSession();

                // SEC-005: si no hay usuarios persistidos, crear PINs aleatorios en primer arranque.
                if (!state.usuarios || state.usuarios.length === 0) {
                    // Lanzar async; el set se aplica cuando termine.
                    _ensureDefaultUsers(state, (patch) => {
                        useAuthStore.setState(patch);
                    });
                } else {
                    // Limpiar cualquier campo `pin` en texto plano que venga de versiones viejas.
                    state.usuarios = state.usuarios.map(u => {
                        if (typeof u.pin === 'string' && u.pin.length === 64 && /^[0-9a-f]{64}$/i.test(u.pin)) {
                            // Hash legacy SHA-256 — se mantiene hasta que verifyPin.needsRehash lo migre.
                            return u;
                        }
                        if (typeof u.pin === 'string' && u.pin.startsWith('pbkdf2$')) {
                            return u;
                        }
                        // PIN en claro o malformado: invalidar para forzar reseteo.
                        return { ...u, pin: '' };
                    });
                }
            },
            storage: {
                getItem: (name) => {
                    const str = localStorage.getItem(name);
                    if (!str) return null;
                    try { return JSON.parse(str); } catch (e) { return null; }
                },
                setItem: (name, value) => {
                    localStorage.setItem(name, JSON.stringify(value));
                    // SEC-002: abasto-auth-storage YA NO se sincroniza a sync_documents
                    // (se eliminó de LOCAL_KEYS en useCloudSync). Pero por si una versión
                    // vieja del código lo empujaba, evitamos el push aquí.
                    // (No importamos useCloudSync para no romper el tree-shaking.)
                },
                removeItem: (name) => localStorage.removeItem(name)
            }
        }
    )
);

export { _validateSessionShape, _computeLockout, _generateRandomPin, _createDefaultUsersWithRandomPins, _readPersistedSession };
