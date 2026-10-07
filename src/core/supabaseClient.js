/**
 * supabaseClient.js — Cliente singleton de Supabase para el proyecto "licencias".
 *
 * Fix SEC-021 / HOOK-003: Antes se hardcodeaba una URL real de Supabase y un
 * placeholder `'REEMPLAZAR_CON_TU_ANON_KEY_VERDADERA'` como fallback. Si las
 * variables de entorno faltaban en build, el cliente se creaba con un URL
 * filtrado y una key inválida → todas las llamadas fallaban con 401 silenciosamente.
 *
 * Ahora lanzamos un error claro en boot si falta alguna de las dos variables.
 * El build falla si no se definen (DX mejorada), y en runtime se loguea un
 * mensaje accionable en lugar de 401s misteriosos.
 *
 * @module core/supabaseClient
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// SEC-021: error claro en boot si falta alguna variable.
if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [];
    if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY');
    const msg =
        `[supabaseClient] Configuración incompleta (SEC-021). ` +
        `Faltan variables de entorno: ${missing.join(', ')}. ` +
        `Define estas variables en .env antes de compilar. ` +
        `El cliente de Supabase NO se creará para evitar llamadas con credenciales inválidas.`;
    // En build, lanzar error para que el build falle ruidosamente.
    // En runtime (tests/dev sin .env), loguear y crear un stub vacío que fallará en cada llamada.
    if (import.meta.env?.DEV) {
        console.error(msg);
    } else {
        throw new Error(msg);
    }
}

// Cliente Singleton. Si faltan credenciales y estamos en dev, creamos un stub
// que rechaza todas las llamadas con un error claro (mejor que 401s misteriosos).
export const supabase = (supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: 'sb-licensing-auth-token'
        }
      })
    : new Proxy({}, {
        get() {
            return () => Promise.reject(new Error('[supabaseClient] Sin configurar (SEC-021). Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'));
        },
    });

export default supabase;
