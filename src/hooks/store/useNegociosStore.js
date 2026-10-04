/**
 * useNegociosStore.js — Registro de negocios (Fase 1 multi-negocio).
 *
 * Store zustand persistido con clave GLOBAL (`pda-negocios-registry`, sin
 * prefijo de negocio): es la fuente de verdad de qué negocios existen y cuál
 * está activo.
 *
 * Cada negocio: { id, nombre, rif, direccion, telefono, createdAt }.
 * Los datos fiscales (rif/dirección/teléfono) alimentan los recibos vía
 * `syncFiscalMirror()` (ver utils/negocioContext.js).
 *
 * Cambiar de negocio activo recarga la app a propósito: es la forma más
 * segura de rehidratar TODOS los stores/contextos desde el namespace correcto
 * y garantizar cero fuga de datos entre negocios (decisión documentada en
 * bitácora — Fase 1).
 *
 * @module hooks/store/useNegociosStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    NEGOCIOS_REGISTRY_KEY,
    NEGOCIO_KEY_PREFIX,
    setNegocioActivoId,
    syncFiscalMirror,
} from '../../utils/negocioContext';
import { logEvent } from '../../services/auditService';
import { buildBusinessRegistryDoc, BUSINESS_REGISTRY_DOC_KEY } from '../../utils/businessRegistry';

/**
 * Publica el registro de negocios a la nube (documento GLOBAL).
 * Fire-and-forget: un fallo del push jamás debe romper la gestión.
 */
function _pushBusinessRegistry() {
    try {
        import('../useCloudSync.js')
            .then((cs) => {
                if (typeof cs?.queueCloudSync !== 'function') return;
                const { negocios } = useNegociosStore.getState();
                cs.queueCloudSync(BUSINESS_REGISTRY_DOC_KEY, buildBusinessRegistryDoc(negocios));
            })
            .catch(() => {});
    } catch { /* silenciar: el push nunca rompe el flujo */ }
}

function _newId() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return `neg-${crypto.randomUUID().slice(0, 8)}`;
        }
    } catch { /* noop */ }
    return `neg-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function _sanitizeDatos(datos) {
    const d = datos && typeof datos === 'object' ? datos : {};
    return {
        nombre: String(d.nombre ?? '').trim(),
        rif: String(d.rif ?? '').trim(),
        direccion: String(d.direccion ?? '').trim(),
        telefono: String(d.telefono ?? '').trim(),
    };
}

/**
 * Borra los datos namespaced de un negocio (IndexedDB + claves auth en
 * localStorage). Se usa al eliminar un negocio para no dejar huérfanos.
 * @param {string} negocioId
 */
async function _purgeNegocioData(negocioId) {
    if (!negocioId) return;
    const prefix = `${NEGOCIO_KEY_PREFIX}${negocioId}:`;
    try {
        const { default: localforage } = await import('localforage');
        const keys = await localforage.keys();
        for (const k of keys) {
            if (typeof k === 'string' && k.startsWith(prefix)) {
                try { await localforage.removeItem(k); } catch { /* noop */ }
            }
        }
    } catch { /* noop */ }
    try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) doomed.push(k);
        }
        doomed.forEach((k) => { try { localStorage.removeItem(k); } catch { /* noop */ } });
    } catch { /* noop */ }
}

export const useNegociosStore = create(
    persist(
        (set, get) => ({
            negocios: [],
            negocioActivoId: null,

            /** @returns {object|null} el negocio activo */
            getNegocioActivo: () => {
                const { negocios, negocioActivoId } = get();
                return negocios.find((n) => n.id === negocioActivoId) ?? null;
            },

            /**
             * Crea un negocio. El nombre es obligatorio.
             * @param {{nombre:string, rif?:string, direccion?:string, telefono?:string}} datos
             * @returns {{ ok: boolean, id?: string, error?: string }}
             */
            crearNegocio: (datos) => {
                const clean = _sanitizeDatos(datos);
                if (!clean.nombre) return { ok: false, error: 'El nombre del negocio es obligatorio' };
                const negocio = { ...clean, id: _newId(), createdAt: new Date().toISOString() };
                set((s) => ({ negocios: [...s.negocios, negocio] }));
                try { logEvent('NEGOCIO', 'NEGOCIO_CREADO', `Negocio "${negocio.nombre}" creado`, null); } catch { /* noop */ }
                _pushBusinessRegistry();
                return { ok: true, id: negocio.id };
            },

            /**
             * FAILOVER-003: Crea un negocio con un ID específico (para recuperar
             * datos de la nube atados a un ID que no existe localmente).
             * Solo usar para recuperación; el ID debe tener formato neg-*.
             */
            importarNegocioConId: (id, datos) => {
                const clean = _sanitizeDatos(datos);
                if (!clean.nombre) return { ok: false, error: 'El nombre del negocio es obligatorio' };
                if (!id || !String(id).startsWith('neg-')) return { ok: false, error: 'ID de negocio inválido' };
                const { negocios } = get();
                if (negocios.some((n) => n.id === id)) return { ok: false, error: 'Ya existe un negocio con ese ID' };
                const negocio = { ...clean, id: String(id), createdAt: new Date().toISOString(), importadoDeNube: true };
                set((s) => ({ negocios: [...s.negocios, negocio] }));
                try { logEvent('NEGOCIO', 'NEGOCIO_IMPORTADO', `Negocio "${negocio.nombre}" importado con ID ${id}`, null); } catch { /* noop */ }
                _pushBusinessRegistry();
                return { ok: true, id: negocio.id };
            },

            /**
             * Actualiza los datos (fiscales) de un negocio. Si es el activo,
             * refresca el espejo fiscal para que los recibos lo reflejen.
             */
            actualizarNegocio: (id, datos) => {
                const { negocios, negocioActivoId } = get();
                if (!negocios.some((n) => n.id === id)) return { ok: false, error: 'Negocio no encontrado' };
                const clean = _sanitizeDatos({ ...negocios.find((n) => n.id === id), ...datos });
                if (!clean.nombre) return { ok: false, error: 'El nombre del negocio es obligatorio' };
                set((s) => ({
                    negocios: s.negocios.map((n) => (n.id === id ? { ...n, ...clean } : n)),
                }));
                if (id === negocioActivoId) syncFiscalMirror();
                try { logEvent('NEGOCIO', 'NEGOCIO_ACTUALIZADO', `Datos de "${clean.nombre}" actualizados`, null); } catch { /* noop */ }
                _pushBusinessRegistry();
                return { ok: true };
            },

            /**
             * Elimina un negocio y purga sus datos namespaced. No permite
             * eliminar el último ni el activo (hay que cambiar primero).
             */
            eliminarNegocio: async (id) => {
                const { negocios, negocioActivoId } = get();
                const target = negocios.find((n) => n.id === id);
                if (!target) return { ok: false, error: 'Negocio no encontrado' };
                if (negocios.length <= 1) return { ok: false, error: 'No se puede eliminar el único negocio' };
                if (id === negocioActivoId) return { ok: false, error: 'Cambia de negocio antes de eliminar este' };
                await _purgeNegocioData(id);
                set((s) => ({ negocios: s.negocios.filter((n) => n.id !== id) }));
                try { logEvent('NEGOCIO', 'NEGOCIO_ELIMINADO', `Negocio "${target.nombre}" eliminado`, null); } catch { /* noop */ }
                _pushBusinessRegistry();
                return { ok: true };
            },

            /**
             * Aplica el registro fusionado que llegó de la nube.
             * No toca el negocio activo: cada equipo mantiene su sede.
             */
            aplicarRegistroRemoto: (merged) => {
                if (!Array.isArray(merged)) return;
                const { negocioActivoId, negocios } = get();
                // Si no cambió nada, no hacer nada (evita ping-pong).
                const same = negocios.length === merged.length &&
                    merged.every((m) => negocios.some((n) => n.id === m.id));
                if (same) return;
                // Conservar el activo aunque el remoto no lo traiga.
                set({ negocios: merged });
                if (negocioActivoId && !merged.some((n) => n.id === negocioActivoId)) {
                    console.warn('[Negocios] El negocio activo no está en el registro remoto');
                }
                try { logEvent('NEGOCIO', 'REGISTRO_SINCRO', `${merged.length} negocios en registro`, null); } catch { /* noop */ }
                // V2.1.42: NO republicar automáticamente. El equipo que recibe
                // no debe sobrescribir el registro con su versión fusionada;
                // solo el equipo que CREA/MODIFICA publica explícitamente.
            },

            /**
             * Cambia el negocio activo y RECARGA la app para rehidratar todos
             * los stores/contextos desde el namespace correcto. La recarga es
             * intencional (ver encabezado del módulo).
             */
            activarNegocio: (id) => {
                const { negocios, negocioActivoId } = get();
                if (id === negocioActivoId) return { ok: true };
                const target = negocios.find((n) => n.id === id);
                if (!target) return { ok: false, error: 'Negocio no encontrado' };
                setNegocioActivoId(id);
                set({ negocioActivoId: id });
                syncFiscalMirror();
                try { logEvent('NEGOCIO', 'NEGOCIO_CAMBIADO', `Negocio activo: "${target.nombre}"`, null); } catch { /* noop */ }
                if (typeof window !== 'undefined') {
                    // Dar un tick para que el persist escriba el registro antes de recargar.
                    setTimeout(() => window.location.reload(), 60);
                }
                return { ok: true };
            },
        }),
        {
            name: NEGOCIOS_REGISTRY_KEY,
            // El registro es GLOBAL por diseño: se persiste directo en
            // localStorage, sin pasar por el router de storageService.
            partialize: (state) => ({
                negocios: state.negocios,
                negocioActivoId: state.negocioActivoId,
            }),
            // V2.1.42: NO publicar automáticamente al rehidratar. La publicación
            // automática causaba que equipos con registro incompleto sobrescribieran
            // el registro completo de otros equipos (LWW). Solo se publica por
            // acción explícita: abrir Mis Sedes, botón Publicar, o CRUD.
        }
    )
);
