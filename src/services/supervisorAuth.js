import { supabaseCloud } from '../config/supabaseCloud';

/**
 * Obtiene la sesión persistida o crea una sesión anónima de dispositivo.
 * La sesión de Supabase no contiene PINs ni datos del POS; solo identifica
 * temporalmente al dispositivo ante las políticas RLS del proyecto cloud.
 *
 * El proveedor Anonymous debe estar habilitado en Supabase antes de activar
 * las RPC/RLS nuevas del Supervisor.
 */
export async function ensureSupervisorSession() {
    if (!supabaseCloud?.auth) {
        return { session: null, error: new Error('Supabase Auth no está disponible') };
    }

    try {
        const { data: sessionData, error: sessionError } = await supabaseCloud.auth.getSession();
        if (sessionError) return { session: null, error: sessionError };
        if (sessionData?.session) return { session: sessionData.session, error: null };

        const { data, error } = await supabaseCloud.auth.signInAnonymously();
        if (error || !data?.session) {
            return {
                session: null,
                error: error || new Error('No se pudo crear la sesión del dispositivo'),
            };
        }

        return { session: data.session, error: null };
    } catch (error) {
        return { session: null, error };
    }
}

export function isSupervisorSessionReady(session) {
    return Boolean(session?.user?.id);
}
