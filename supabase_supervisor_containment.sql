-- CONTENCIÓN INMEDIATA — MODO SUPERVISOR
-- Ejecutar MANUALMENTE primero en STAGING.
-- Este script NO borra datos, usuarios, ventas, productos ni clientes.
-- Efecto esperado: pausa temporalmente pairing/sync remoto hasta implementar
-- la nueva autorización server-side.

BEGIN;

-- 1) Quitar permisos directos del cliente público anon.
REVOKE ALL ON TABLE public.device_pairings FROM anon;
REVOKE ALL ON TABLE public.sync_documents FROM anon;
REVOKE ALL ON TABLE public.cloud_backups FROM anon;

-- 2) Quitar ejecución pública de las RPC inseguras actuales.
REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unpair_monitor(text) FROM PUBLIC, anon, authenticated;

-- 3) Eliminar políticas públicas/permisivas.
DROP POLICY IF EXISTS "Allow public read access to pairings" ON public.device_pairings;
DROP POLICY IF EXISTS "Allow write access to own pairing" ON public.device_pairings;
DROP POLICY IF EXISTS "sync_documents_anon_access" ON public.sync_documents;
DROP POLICY IF EXISTS "cloud_backups_anon_access" ON public.cloud_backups;

-- 4) Mantener lectura de pairing únicamente para una futura sesión
--    autenticada cuyo UID coincida con primary o monitor.
DROP POLICY IF EXISTS "device_pairings_authenticated_isolation" ON public.device_pairings;
CREATE POLICY "device_pairings_authenticated_isolation"
    ON public.device_pairings
    FOR SELECT
    TO authenticated
    USING (
        auth.uid()::text = primary_device_id
        OR auth.uid()::text = monitor_device_id
    );

COMMIT;

-- VERIFICACIÓN POSTERIOR (también solo lectura)
SELECT
    grantee,
    table_name,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND table_name IN ('device_pairings', 'sync_documents', 'cloud_backups')
ORDER BY table_name, privilege_type;

SELECT
    schemaname,
    tablename,
    policyname,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('device_pairings', 'sync_documents', 'cloud_backups')
ORDER BY tablename, policyname;
