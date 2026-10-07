/**
 * tests/cloudError.test.js — Tests del clasificador de errores de nube (BACKUP-ERR).
 *
 * Cubre los errores reales detectados en E2E contra Supabase:
 *  - 42501: RLS bloquea al dispositivo (hallazgo del round-trip real).
 *  - PGRST204: columna inexistente (bug size_bytes corregido en 7d06e1b).
 *  - NETWORK: fetch TypeError sin conexión.
 *  - 401/403/404/5xx y fallback genérico.
 */

import { describe, it, expect } from 'vitest';
import { describeCloudError, describeCloudErrorShort } from '../src/utils/cloudError';

describe('describeCloudError — códigos PostgREST/Supabase', () => {
    it('42501 (RLS): explica permisos y recomienda exportar archivo', () => {
        const err = {
            code: '42501',
            message: 'new row violates row-level security policy for table "cloud_backups"',
        };
        const info = describeCloudError(err);
        expect(info.code).toBe('42501');
        expect(info.title).toMatch(/RLS|Permisos/i);
        expect(info.detail).toMatch(/cloud_backups/);
        expect(info.hint).toMatch(/Exportar Backup/i);
        expect(info.technical).toContain('42501');
    });

    it('PGRST204 (columna inexistente): nombra la columna y pide migración', () => {
        const err = {
            code: 'PGRST204',
            message: "Could not find the 'size_bytes' column of 'cloud_backups' in the schema cache",
        };
        const info = describeCloudError(err);
        expect(info.code).toBe('PGRST204');
        expect(info.title).toMatch(/Esquema/i);
        expect(info.detail).toContain('size_bytes');
        expect(info.hint).toMatch(/migraci/i);
    });

    it('42501 detectado por mensaje sin code (variante PostgREST)', () => {
        const info = describeCloudError(new Error('violation of row-level security policy'));
        expect(info.code).toBe('42501');
    });

    it('42P01 (tabla faltante)', () => {
        const info = describeCloudError({
            code: '42P01',
            message: 'relation "public.sync_documents" does not exist',
        });
        expect(info.code).toBe('42P01');
        expect(info.hint).toMatch(/soporte/i);
    });

    it('23505 (duplicado)', () => {
        const info = describeCloudError({ code: '23505', message: 'duplicate key value' });
        expect(info.code).toBe('23505');
        expect(info.title).toMatch(/duplicad/i);
    });

    it('PGRST116 (0 o varias filas en single/maybeSingle)', () => {
        const info = describeCloudError({ code: 'PGRST116', message: 'multiple (or no) rows returned' });
        expect(info.code).toBe('PGRST116');
    });
});

describe('describeCloudError — HTTP y red', () => {
    it('401/403: sesión inválida', () => {
        const info = describeCloudError({ status: 403, message: 'Forbidden' });
        expect(info.title).toMatch(/Sesión/i);
        expect(info.hint).toMatch(/sesión/i);
    });

    it('404: recurso no encontrado', () => {
        const info = describeCloudError({ status: 404, message: 'Not Found' });
        expect(info.code).toBe('404');
    });

    it('5xx: error del servidor', () => {
        const info = describeCloudError({ status: 503, message: 'Service Unavailable' });
        expect(info.title).toMatch(/servidor/i);
        expect(info.hint).toMatch(/datos locales no se vieron afectados/i);
    });

    it('fetch TypeError: red caída', () => {
        const info = describeCloudError(new TypeError('Failed to fetch'));
        expect(info.code).toBe('NETWORK');
        expect(info.title).toMatch(/conexión/i);
    });

    it('mensaje de red sin TypeError también se detecta', () => {
        const info = describeCloudError({ message: 'network error al cargar' });
        expect(info.code).toBe('NETWORK');
    });
});

describe('describeCloudError — casos límite', () => {
    it('null/undefined/vacío cae en genérico sin lanzar', () => {
        for (const input of [null, undefined, '', 42, {}]) {
            const info = describeCloudError(input);
            expect(info.title).toBeTruthy();
            expect(info.hint).toBeTruthy();
            expect(info.technical).toBeTruthy();
        }
    });

    it('string plano se trata como mensaje', () => {
        const info = describeCloudError('algo raro pasó');
        expect(info.technical).toContain('algo raro pasó');
        expect(info.code).toBe('UNKNOWN');
    });

    it('describeCloudErrorShort devuelve una sola línea con título + hint', () => {
        const short = describeCloudErrorShort({ code: '42501', message: 'row-level security' });
        expect(short).not.toContain('\n');
        expect(short).toMatch(/RLS|Permisos/i);
        expect(short).toMatch(/Exportar Backup/i);
    });
});
