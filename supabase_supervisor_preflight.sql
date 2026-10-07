-- PRE-FLIGHT SOLO LECTURA — MODO SUPERVISOR
-- Ejecutar manualmente en el proyecto Supabase de sincronización.
-- Este script NO modifica tablas, políticas, grants ni funciones.
-- Copiar los resultados de las consultas 1-5 para diseñar la migración v2.

-- 1) RLS habilitada en las tablas sensibles.
SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('device_pairings', 'sync_documents', 'cloud_backups')
ORDER BY c.relname;

-- 2) Permisos efectivos declarados para anon/authenticated.
SELECT
    grantee,
    table_schema,
    table_name,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('device_pairings', 'sync_documents', 'cloud_backups')
ORDER BY table_name, grantee, privilege_type;

-- 3) Políticas RLS actuales. Revisar especialmente USING/WITH CHECK true
--    o referencias que solo comprueben la existencia de un pairing.
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('device_pairings', 'sync_documents', 'cloud_backups')
ORDER BY tablename, policyname;

-- 4) Funciones de pairing y si están marcadas SECURITY DEFINER.
SELECT
    p.oid::regprocedure AS function_signature,
    p.prosecdef AS security_definer,
    p.proleakproof AS leakproof,
    pg_get_userbyid(p.proowner) AS owner_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'generate_pairing_token',
      'pair_monitor_device',
      'unpair_monitor'
  )
ORDER BY p.oid::regprocedure::text;

-- 5) Columnas de device_pairings para comprobar si existe versionado,
--    hash del token, estado, intentos y revocación.
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'device_pairings'
ORDER BY ordinal_position;

-- 6) Publicación Realtime. Solo inspección.
SELECT
    schemaname,
    tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('device_pairings', 'sync_documents')
ORDER BY tablename;
