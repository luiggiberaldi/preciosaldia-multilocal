-- =================================================================================
-- REFORZAMIENTO DE SEGURIDAD SUPABASE (RLS HARDENING)
-- =================================================================================
-- ISSUES cubiertos: INFRA-002 / SEC-002 / SEC-003 / SEC-010 / INFRA-015
--
-- Ejecuta este script en el "SQL Editor" del panel de Supabase.
-- Es idempotente: usa DROP POLICY IF EXISTS antes de CREATE POLICY.
-- Schema canónico para cloud_backups: ver supabase_cloud_schema.sql (INFRA-014).

-- ─────────────────────────────────────────────────────────────────────────────────
-- A) EJECUTAR EN: Base de Datos de Sincronización (Proyecto sodgzkablshladvbtnes,
--    "preciosaldia rebranding" — refs viejos fgzwmwrugerptfqfrsjd / ewwszyzzvoweudholmbf obsoletos)
-- ─────────────────────────────────────────────────────────────────────────────────
-- Asegura que las tablas existan con el schema canónico antes de aplicar RLS.
-- (Si ya existen con schema distinto, ejecutar migración manual.)

-- 1. sync_documents: solo el dispositivo autenticado lee/escribe sus propias filas.
ALTER TABLE public.sync_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_documents_open"               ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_device_isolation"  ON public.sync_documents;

CREATE POLICY "sync_documents_device_isolation" ON public.sync_documents
    FOR ALL
    TO authenticated
    USING (
        auth.uid()::text = device_id
        OR auth.uid()::text = (payload->>'owner_id')
    )
    WITH CHECK (
        auth.uid()::text = device_id
        OR auth.uid()::text = (payload->>'owner_id')
    );

-- 2. cloud_backups: solo el dueño del dispositivo.
ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cloud_backups_open"               ON public.cloud_backups;
DROP POLICY IF EXISTS "cloud_backups_device_isolation"  ON public.cloud_backups;

CREATE POLICY "cloud_backups_device_isolation" ON public.cloud_backups
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = device_id)
    WITH CHECK (auth.uid()::text = device_id);

-- 3. Revocar acceso anónimo: el rol `anon` NO debe tener SELECT.
--    Solo `authenticated` y `service_role` pueden leer/escribir.
REVOKE SELECT ON public.sync_documents FROM anon;
REVOKE SELECT ON public.cloud_backups  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sync_documents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.cloud_backups  FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────────
-- B) EJECUTAR EN: Base de Datos de Licencias (Proyecto jjbzevntreoxpuofgkyi)
-- ─────────────────────────────────────────────────────────────────────────────────
-- 1. Tabla licenses: NUNCA exponer SELECT USING(true) (SEC-003).
--    El cliente debe usar la RPC verify_activation_code (más abajo) que solo
--    devuelve booleano, sin exponer la tabla.

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "licenses_open"              ON public.licenses;
DROP POLICY IF EXISTS "licenses_device_read"       ON public.licenses;
DROP POLICY IF EXISTS "licenses_device_isolation"  ON public.licenses;
DROP POLICY IF EXISTS "licenses_admin_write"       ON public.licenses;

-- SEC-003: NO crear política SELECT USING(true).
-- Solo service_role (panel de admin de Supabase o Edge Functions autenticadas)
-- puede leer la tabla completa. authenticated y anon quedan fuera.
CREATE POLICY "licenses_admin_only" ON public.licenses
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. RPC verify_activation_code(p_device_id, p_code) RETURNS boolean
--    Valida un código de activación sin exponer la fila. SEC-003.
--    - SECURITY DEFINER: se ejecuta con los privilegios del owner (que SÍ puede
--      leer licenses), no del caller.
--    - Solo devuelve true/false. Nunca devuelve el código ni otros campos.

CREATE OR REPLACE FUNCTION public.verify_activation_code(
    p_device_id TEXT,
    p_code      TEXT
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.licenses
        WHERE device_id = p_device_id
          AND code      = p_code
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > NOW())
    );
$$;

-- Permisos: cualquier rol (incluido anon) puede ejecutar la RPC, pero solo
-- recibe un booleano. La tabla licenses sigue siendo inaccesible para anon.
GRANT EXECUTE ON FUNCTION public.verify_activation_code(TEXT, TEXT) TO anon, authenticated;

-- 3. Hardening: column-level. Aunque la RLS falle por una mala política futura,
--    el code nunca debe salir por SELECT directo.
REVOKE SELECT (code) ON public.licenses FROM anon, authenticated;
