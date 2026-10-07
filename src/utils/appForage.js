/**
 * appForage.js — Acceso directo a IndexedDB con routing multi-negocio.
 *
 * Para el código que accede a localforage SIN pasar por storageService
 * (sincronización cloud, backups, importación, recuperación de errores):
 * antepone `nb_<id>:` a las claves de datos del negocio activo, igual que
 * hace storageService. Las claves globales no se tocan.
 *
 * `keys()` devuelve las claves CRUDAS (sin transformar): se usa para
 * administración/migración.
 *
 * @module utils/appForage
 */
import localforage from 'localforage';
import { routeStorageKey } from './negocioContext';

// Misma configuración que storageService (idempotente si ya se aplicó).
localforage.config({
    name: 'BodegaApp',
    storeName: 'bodega_app_data',
    description: 'Almacenamiento local optimizado para PWA de Bodega'
});

export const appForage = {
    getItem: (key) => localforage.getItem(routeStorageKey(key)),
    setItem: (key, value) => localforage.setItem(routeStorageKey(key), value),
    removeItem: (key) => localforage.removeItem(routeStorageKey(key)),
    keys: () => localforage.keys(),
};

export default appForage;
