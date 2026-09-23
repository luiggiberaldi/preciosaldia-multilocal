/**
 * deviceIdentity.js — Registro de identidad del dispositivo en Supabase.
 *
 * Problema que resuelve:
 *   - Las políticas RLS "own-row" (001_device_own_row_rls.sql) necesitan que
 *     el dispositivo esté registrado en `device_sessions` vinculado a su
 *     sesión anónima. Sin ese registro, cloud_backups/sync_documents siguen
 *     bloqueados (42501).
 *
 * Contrato con la migración:
 *   - Tabla: device_sessions(device_id PK, user_id, first_seen, last_seen)
 *   - INSERT con with check (auth.uid() = user_id)
 *   - UPDATE de reconciliación: si el device_id ya existe con OTRO user_id,
 *     la política "reclaim" permite reasignarlo al usuario actual
 *     (with check auth.uid() = user_id).
 *
 * @module utils/deviceIdentity
 */

import { supabaseCloud } from '../config/supabaseCloud';

async function getSessionUserId() {
    try {
        const { data } = await supabaseCloud.auth.getSession();
        return data?.session?.user?.id ?? null;
    } catch {
        return null;
    }
}

/**
 * Registra (o reconcilia) la identidad del dispositivo. Idempotente.
 * Debe llamarse con la sesión ya establecida (ensureSupervisorSession).
 *
 * @param {string} deviceId
 * @returns {Promise<{ok: boolean, registered: boolean, reclaimed: boolean, error: any}>}
 */
export async function ensureDeviceSessionRegistered(deviceId) {
    if (!supabaseCloud || !deviceId) {
        return { ok: false, registered: false, reclaimed: false, error: 'sin supabase o deviceId' };
    }

    const userId = await getSessionUserId();
    if (!userId) {
        return { ok: false, registered: false, reclaimed: false, error: 'sin sesión activa' };
    }

    // 1. INSERT (caso normal: primera vez en esta máquina).
    const { error: insertErr } = await supabaseCloud
        .from('device_sessions')
        .insert({ device_id: deviceId, user_id: userId });

    if (!insertErr) {
        return { ok: true, registered: true, reclaimed: false, error: null };
    }

    // 2. Duplicado (23505): reconciliación. La política "reclaim" permite al
    //    dueño actual (posible nueva sesión anónima) reasignarse la fila.
    if (insertErr?.code === '23505') {
        const { error: updateErr } = await supabaseCloud
            .from('device_sessions')
            .update({ user_id: userId, last_seen: new Date().toISOString() })
            .eq('device_id', deviceId);

        if (!updateErr) {
            return { ok: true, registered: false, reclaimed: true, error: null };
        }
        return { ok: false, registered: false, reclaimed: false, error: updateErr };
    }

    // 3. Otro error (RLS, red, etc.): se reporta; el caller decide.
    return { ok: false, registered: false, reclaimed: false, error: insertErr };
}

export default { ensureDeviceSessionRegistered };
