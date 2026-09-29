/**
 * negocioContext.test.js — Tests unitarios del núcleo multi-negocio (Fase 1).
 *
 * Cubren el router de storage, el router de auth, los doc IDs de sync cloud
 * y el espejo fiscal. La prueba de aislamiento simula dos negocios y verifica
 * que sus claves físicas no se cruzan.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    NEGOCIO_KEY_PREFIX,
    DEFAULT_NEGOCIO_ID,
    GLOBAL_STORAGE_KEYS,
    getNegocioActivoId,
    setNegocioActivoId,
    isGlobalKey,
    isNegocioKey,
    routeStorageKey,
    routeAuthKey,
    toCloudDocId,
    parseCloudDocId,
    syncFiscalMirror,
    NEGOCIOS_REGISTRY_KEY,
    isDocForActiveBusiness,
} from '../src/utils/negocioContext';

const NEG_A = 'neg-a1';
const NEG_B = 'neg-b2';

beforeEach(() => {
    localStorage.clear();
    setNegocioActivoId(null);
});

describe('router de storage', () => {
    it('antepone nb_<id>: a las claves de datos del negocio activo', () => {
        setNegocioActivoId(NEG_A);
        expect(routeStorageKey('bodega_products_v1')).toBe(`nb_${NEG_A}:bodega_products_v1`);
        expect(routeStorageKey('bodega_sales_v1')).toBe(`nb_${NEG_A}:bodega_sales_v1`);
    });

    it('no toca las claves globales (tasas, registro, identidad, espejo fiscal)', () => {
        setNegocioActivoId(NEG_A);
        for (const key of [
            'pda-negocios-registry',
            'pda_device_id',
            'monitor_rates_v12',
            'bodega_custom_rate',
            'street_rate_bs',
            'business_name',
            'business_rif',
            'premium_token',
            'theme',
        ]) {
            expect(isGlobalKey(key)).toBe(true);
            expect(routeStorageKey(key)).toBe(key);
        }
    });

    it('es idempotente: una clave ya namespaced no se vuelve a prefijar', () => {
        setNegocioActivoId(NEG_A);
        const once = routeStorageKey('bodega_products_v1');
        expect(routeStorageKey(once)).toBe(once);
        expect(isNegocioKey(once)).toBe(true);
    });

    it('sin negocio activo deja la clave intacta (ventana del primer boot)', () => {
        expect(getNegocioActivoId()).toBeNull();
        expect(routeStorageKey('bodega_products_v1')).toBe('bodega_products_v1');
    });
});

describe('router de auth (PINs/usuarios/sesión)', () => {
    it('SIEMPRE namespacing, incluso claves que serían globales en storage', () => {
        setNegocioActivoId(NEG_A);
        expect(routeAuthKey('abasto-auth-storage')).toBe(`nb_${NEG_A}:abasto-auth-storage`);
        expect(routeAuthKey('abasto-device-session')).toBe(`nb_${NEG_A}:abasto-device-session`);
    });

    it('es idempotente', () => {
        setNegocioActivoId(NEG_A);
        const once = routeAuthKey('abasto-auth-storage');
        expect(routeAuthKey(once)).toBe(once);
    });
});

describe('doc IDs de sync cloud', () => {
    it('toCloudDocId genera nb_<id>:<clave> y parseCloudDocId lo invierte', () => {
        setNegocioActivoId(NEG_A);
        const docId = toCloudDocId('bodega_products_v1');
        expect(docId).toBe(`nb_${NEG_A}:bodega_products_v1`);
        expect(parseCloudDocId(docId)).toEqual({ negocioId: NEG_A, key: 'bodega_products_v1' });
    });

    it('las claves globales quedan sin prefijo en la nube', () => {
        setNegocioActivoId(NEG_A);
        expect(toCloudDocId('monitor_rates_v12')).toBe('monitor_rates_v12');
        expect(parseCloudDocId('monitor_rates_v12')).toEqual({ negocioId: null, key: 'monitor_rates_v12' });
    });
});

describe('aislamiento entre dos negocios', () => {
    it('las claves físicas de A y B no se cruzan', () => {
        setNegocioActivoId(NEG_A);
        const keyA = routeStorageKey('bodega_products_v1');
        const authA = routeAuthKey('abasto-auth-storage');
        const docA = toCloudDocId('bodega_sales_v1');

        setNegocioActivoId(NEG_B);
        const keyB = routeStorageKey('bodega_products_v1');
        const authB = routeAuthKey('abasto-auth-storage');
        const docB = toCloudDocId('bodega_sales_v1');

        expect(keyA).not.toBe(keyB);
        expect(authA).not.toBe(authB);
        expect(docA).not.toBe(docB);
        expect(keyA.startsWith(`${NEGOCIO_KEY_PREFIX}${NEG_A}:`)).toBe(true);
        expect(keyB.startsWith(`${NEGOCIO_KEY_PREFIX}${NEG_B}:`)).toBe(true);
        // Ninguna clave de A contiene el id de B ni viceversa.
        expect(keyA).not.toContain(NEG_B);
        expect(keyB).not.toContain(NEG_A);
    });
});

describe('filtro de documentos cloud (isDocForActiveBusiness)', () => {
    it('acepta docs del negocio activo y globales', () => {
        setNegocioActivoId(NEG_A);
        expect(isDocForActiveBusiness(`nb_${NEG_A}:bodega_products_v1`)).toBe(true);
        expect(isDocForActiveBusiness('monitor_rates_v12')).toBe(true);
        expect(isDocForActiveBusiness('bodega_custom_rate')).toBe(true);
    });

    it('rechaza docs de otro negocio', () => {
        setNegocioActivoId(NEG_A);
        expect(isDocForActiveBusiness(`nb_${NEG_B}:bodega_products_v1`)).toBe(false);
        expect(isDocForActiveBusiness(`nb_${NEG_B}:bodega_sales_v1`)).toBe(false);
    });

    it('rechaza docs legacy sin prefijo que no sean globales', () => {
        setNegocioActivoId(NEG_A);
        expect(isDocForActiveBusiness('bodega_products_v1')).toBe(false);
        expect(isDocForActiveBusiness('bodega_sales_v1')).toBe(false);
    });

    it('nunca acepta abasto-auth-storage (SEC-002)', () => {
        setNegocioActivoId(NEG_A);
        expect(isDocForActiveBusiness('abasto-auth-storage')).toBe(false);
        expect(isDocForActiveBusiness(`nb_${NEG_A}:abasto-auth-storage`)).toBe(false);
    });
});

describe('espejo fiscal', () => {
    it('vuelca los datos del negocio activo a business_*', () => {
        const negocio = {
            id: DEFAULT_NEGOCIO_ID,
            nombre: 'Bodega El Sol',
            rif: 'J-12345678-9',
            direccion: 'Calle 1',
            telefono: '04120000000',
        };
        localStorage.setItem(
            NEGOCIOS_REGISTRY_KEY,
            JSON.stringify({ state: { negocios: [negocio], negocioActivoId: negocio.id } })
        );
        setNegocioActivoId(negocio.id);
        syncFiscalMirror();
        expect(localStorage.getItem('business_name')).toBe('Bodega El Sol');
        expect(localStorage.getItem('business_rif')).toBe('J-12345678-9');
        expect(localStorage.getItem('business_direccion')).toBe('Calle 1');
        expect(localStorage.getItem('business_telefono')).toBe('04120000000');
    });

    it('no hace nada si no hay registro', () => {
        syncFiscalMirror();
        expect(localStorage.getItem('business_name')).toBeNull();
    });

    it('business_* es global en el router (el espejo no se namespacing)', () => {
        expect(GLOBAL_STORAGE_KEYS.has('business_name')).toBe(true);
        expect(GLOBAL_STORAGE_KEYS.has('business_rif')).toBe(true);
    });
});
