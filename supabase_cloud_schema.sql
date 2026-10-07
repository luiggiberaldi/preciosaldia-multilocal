-- ============================================================
-- Supabase Cloud Sync Schema (CANÓNICO para cloud_backups)
-- Proyecto: sodgzkablshladvbtnes ("preciosaldia rebranding", el que apunta
--           VITE_SUPABASE_CLOUD_URL). Refs viejos fgzwmwrugerptfqfrsjd /
--           ewwszyzzvoweudholmbf están obsoletos.
-- Identificador: device_id (auth.uid()::text == device_id)
-- ============================================================
-- ISSUES cubiertos: INFRA-002 / SEC-002 / SEC-003 / INFRA-014 / INFRA-015
--
-- Este archivo es el schema CANÓNICO para cloud_backups y sync_documents.
-- Si db_estacion_maestra_setup.sql difiere, este gana (INFRA-014).
-- Es idempotente: todas las políticas usan DROP POLICY IF EXISTS antes de CREATE.

-- ── 1. sync_documents ────────────────────────────────────────
-- Almacena cada clave de datos del dispositivo para P2P en tiempo real.
-- Un dispositivo puede tener múltiples documentos (productos, ventas, clientes, etc.)

CREATE TABLE IF NOT EXISTS public.sync_documents (
    id          BIGSERIAL PRIMARY KEY,
    device_id   TEXT NOT NULL,
    collection  TEXT NOT NULL CHECK (collection IN ('store', 'local')),
    doc_id      TEXT NOT NULL,
    data        JSONB NOT NULL DEFAULT '{}',
    -- INFRA-002: opcionalmente permitir filtrar por owner_id cuando un JWT
    -- de Supabase Auth emita auth.uid() distinto al device_id (escenario
    -- multi-dispositivo por usuario autenticado).
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (device_id, collection, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_documents_device_id ON public.sync_documents (device_id);

-- Realtime: necesario para suscripciones WebSocket.
-- EGRESS: DEFAULT (no FULL) — el cliente (useCloudSync.js) solo lee payload.new,
-- nunca payload.old, así que REPLICA IDENTITY FULL solo duplicaba bytes en cada
-- broadcast de Realtime sin aportar nada. Ver supabase_egress_optimization.sql.
ALTER TABLE public.sync_documents REPLICA IDENTITY DEFAULT;

-- ── 2. cloud_backups ─────────────────────────────────────────
-- Backup completo del dispositivo (blob JSON con toda la data).
-- INFRA-014: schema canónico — id UUID + device_id TEXT.
-- Una fila por device_id (UNIQUE en device_id).

CREATE TABLE IF NOT EXISTS public.cloud_backups (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     TEXT NOT NULL UNIQUE,
    -- DEPRECATED (INFRA-015): password_hash. Usar Supabase Auth.
    -- Si se mantiene, exigir salt + argon2/bcrypt. NO usarlo para login.
    password_hash TEXT,
    backup_data   JSONB NOT NULL DEFAULT '{}',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INFRA-015: índice en email si en el futuro se añade columna email.
-- Hoy no existe esa columna; este índice queda como placeholder comentado.
-- Si se añade `email TEXT` a cloud_backups, descomentar:
-- CREATE INDEX IF NOT EXISTS idx_cloud_backups_email ON public.cloud_backups(email);

-- ── 3. RLS estricta (INFRA-002 / SEC-002) ────────────────────
-- Patrón: auth.uid()::text debe matchear el device_id de la fila.
-- Esto exige que el cliente Supabase se instancie con un JWT donde
-- `sub` (auth.uid()) == device_id. Para auth anónima pura sin JWT,
-- el dispositivo debe registrarse con `signInWithPassword` usando
-- device_id como "email" (ej: `PDA-XXXX@app.local`) y el code de
-- activación como password (validado vía RPC verify_activation_code
-- en el trigger de registro).

ALTER TABLE public.sync_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_backups  ENABLE ROW LEVEL SECURITY;

-- sync_documents: permitir si auth.uid()::text == device_id O == payload->>'owner_id'.
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

-- cloud_backups: solo el dueño del dispositivo.
DROP POLICY IF EXISTS "cloud_backups_open"               ON public.cloud_backups;
DROP POLICY IF EXISTS "cloud_backups_device_isolation"  ON public.cloud_backups;

CREATE POLICY "cloud_backups_device_isolation" ON public.cloud_backups
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = device_id)
    WITH CHECK (auth.uid()::text = device_id);

-- ── 4. Función de limpieza automática (opcional) ──────────────
-- Elimina sync_documents con más de 30 días sin actualización.
-- Programar con pg_cron (extension) si se desea.

-- CREATE OR REPLACE FUNCTION public.purge_old_sync_documents()
-- RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
--   DELETE FROM public.sync_documents
--   WHERE updated_at < NOW() - INTERVAL '30 days';
-- $$;
--
-- SELECT cron.schedule('purge_sync_docs', '0 3 * * *', 'SELECT public.purge_old_sync_documents();');
