import { createClient } from '@supabase/supabase-js';

// DB Cloud/Sync P2P: proyecto "preciosaldia rebranding" (sodgzkablshladvbtnes).
// La URL/key reales vienen de VITE_SUPABASE_CLOUD_URL / _KEY en .env.
// (Refs viejos fgzwmwrugerptfqfrsjd / ewwszyzzvoweudholmbf quedaron obsoletos.)
const useSupervisorE2EStaging = import.meta.env.VITE_SUPERVISOR_E2E_STAGING === 'true';
const supabaseUrl = useSupervisorE2EStaging
    ? (import.meta.env.VITE_SUPABASE_STAGING_URL || 'https://tdfcpwctvumbdjmifypd.supabase.co')
    : (import.meta.env.VITE_SUPABASE_CLOUD_URL || import.meta.env.VITE_SUPABASE_URL || 'https://sodgzkablshladvbtnes.supabase.co');
const supabaseKey = useSupervisorE2EStaging
    ? import.meta.env.VITE_SUPABASE_STAGING_KEY
    : (import.meta.env.VITE_SUPABASE_CLOUD_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY);

if (useSupervisorE2EStaging && !supabaseKey) {
    throw new Error('Falta VITE_SUPABASE_STAGING_KEY para ejecutar E2E contra staging');
}

export const supabaseCloud = createClient(supabaseUrl, supabaseKey, {
    auth: {
        // La sesión identifica al dispositivo ante RLS; no contiene PINs del POS.
        // Debe persistir para que una recarga no pierda el vínculo del monitor.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
    },
});
