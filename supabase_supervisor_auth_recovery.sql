-- RECUPERACIÓN SEGURA DEL MODO SUPERVISOR
--
-- IMPORTANTE:
-- 1) NO ejecutar antes de desplegar el frontend que usa supervisorAuth.js.
-- 2) En Supabase Dashboard activar Authentication > Providers > Anonymous.
-- 3) Ejecutar primero en staging y conservar un backup de device_pairings y sync_documents.
-- 4) Este script no borra usuarios, ventas, productos ni documentos.
-- 5) Los pairings antiguos deberán volver a vincularse: sus filas se conservan,
--    pero no se consideran autorizadas hasta que una sesión segura las reclame.
--
-- La sesión anónima de Supabase identifica al navegador. El token QR sigue siendo
-- la segunda prueba necesaria para que el monitor pueda vincularse.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Nuevos datos de autorización. Las columnas antiguas se conservan.
ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS owner_auth_id uuid,
    ADD COLUMN IF NOT EXISTS monitor_auth_id uuid,
    ADD COLUMN IF NOT EXISTS token_hash text,
    ADD COLUMN IF NOT EXISTS token_used_at timestamptz,
    ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_device_pairings_owner_auth
    ON public.device_pairings (owner_auth_id);

CREATE INDEX IF NOT EXISTS idx_device_pairings_monitor_auth
    ON public.device_pairings (monitor_auth_id);

CREATE INDEX IF NOT EXISTS idx_device_pairings_token_hash
    ON public.device_pairings (token_hash)
    WHERE token_hash IS NOT NULL;

-- 2) Quitar acceso directo. Las escrituras pasan únicamente por RPC y RLS.
REVOKE ALL ON TABLE public.device_pairings FROM anon, authenticated;
REVOKE ALL ON TABLE public.sync_documents FROM anon;
REVOKE ALL ON TABLE public.cloud_backups FROM anon;

GRANT SELECT ON TABLE public.device_pairings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_documents TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.sync_documents FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.cloud_backups FROM authenticated;

-- No dejar ejecutables las funciones antiguas para clientes públicos.
REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unpair_monitor(text) FROM PUBLIC, anon, authenticated;

-- 3) Políticas RLS: solo sesiones autenticadas y vínculos autorizados.
ALTER TABLE public.device_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to pairings" ON public.device_pairings;
DROP POLICY IF EXISTS "Allow write access to own pairing" ON public.device_pairings;
DROP POLICY IF EXISTS "device_pairings_authenticated_isolation" ON public.device_pairings;
DROP POLICY IF EXISTS "device_pairings_authenticated_read" ON public.device_pairings;

CREATE POLICY "device_pairings_authenticated_read"
    ON public.device_pairings
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = owner_auth_id
        OR auth.uid() = monitor_auth_id
    );

DROP POLICY IF EXISTS "sync_documents_anon_access" ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_open" ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_device_isolation" ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_supervisor_read" ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_primary_write" ON public.sync_documents;

CREATE POLICY "sync_documents_supervisor_read"
    ON public.sync_documents
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = sync_documents.device_id
              AND dp.revoked_at IS NULL
              AND dp.monitor_auth_id IS NOT NULL
              AND (
                  dp.owner_auth_id = auth.uid()
                  OR dp.monitor_auth_id = auth.uid()
              )
        )
    );

CREATE POLICY "sync_documents_primary_write"
    ON public.sync_documents
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = sync_documents.device_id
              AND dp.revoked_at IS NULL
              AND dp.monitor_auth_id IS NOT NULL
              AND dp.owner_auth_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = sync_documents.device_id
              AND dp.revoked_at IS NULL
              AND dp.monitor_auth_id IS NOT NULL
              AND dp.owner_auth_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "cloud_backups_anon_access" ON public.cloud_backups;

-- 4) Generar token: solo una sesión autenticada puede emitirlo para su caja.
-- El token no se guarda en claro; se devuelve una única vez al dispositivo primario.
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token text;
    v_hash text;
    v_owner uuid := auth.uid();
    v_updated integer;
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF p_device_id IS NULL OR length(trim(p_device_id)) < 8 OR length(trim(p_device_id)) > 160 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    -- 24 caracteres hexadecimales: suficiente para un código temporal de QR.
    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
    v_hash := encode(digest(v_token, 'sha256'), 'hex');

    UPDATE public.device_pairings
    SET pairing_token = NULL,
        token_hash = v_hash,
        token_expires_at = now() + interval '5 minutes',
        token_used_at = NULL,
        monitor_device_id = NULL,
        monitor_auth_id = NULL,
        paired_at = NULL,
        revoked_at = NULL,
        owner_auth_id = v_owner
    WHERE primary_device_id = trim(p_device_id)
      AND (
          owner_auth_id IS NULL
          OR owner_auth_id = v_owner
          -- Un vínculo revocado puede ser reclamado por la sesión actual
          -- para volver a vincular físicamente la misma caja.
          OR revoked_at IS NOT NULL
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        INSERT INTO public.device_pairings (
            primary_device_id,
            owner_auth_id,
            token_hash,
            token_expires_at,
            created_at
        )
        VALUES (
            trim(p_device_id),
            v_owner,
            v_hash,
            now() + interval '5 minutes',
            now()
        );
    END IF;

    RETURN v_token;
END;
$$;

-- 5) Consumir token: requiere sesión del monitor y solo puede usarse una vez.
CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token text, p_monitor_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_monitor uuid := auth.uid();
    v_pairing public.device_pairings%ROWTYPE;
BEGIN
    IF v_monitor IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;

    SELECT *
    INTO v_pairing
    FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now()
      AND token_used_at IS NULL
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.');
    END IF;

    IF v_pairing.monitor_auth_id IS NOT NULL
       AND v_pairing.monitor_auth_id <> v_monitor THEN
        RETURN json_build_object('success', false, 'message', 'El vínculo ya está ocupado.');
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULLIF(trim(p_monitor_device_id), ''),
        monitor_auth_id = v_monitor,
        pairing_token = NULL,
        token_hash = NULL,
        token_used_at = now(),
        paired_at = now()
    WHERE id = v_pairing.id;

    RETURN json_build_object(
        'success', true,
        'primary_device_id', v_pairing.primary_device_id
    );
END;
$$;

-- 6) Desvincular: solo el dueño o el monitor de ese vínculo.
CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        monitor_auth_id = NULL,
        pairing_token = NULL,
        token_hash = NULL,
        token_expires_at = NULL,
        token_used_at = NULL,
        paired_at = NULL,
        revoked_at = now()
    WHERE (primary_device_id = trim(p_device_id)
           OR monitor_device_id = trim(p_device_id))
      AND (owner_auth_id = v_actor OR monitor_auth_id = v_actor);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(text) TO authenticated;

COMMIT;

-- VERIFICACIÓN POSTERIOR (solo lectura)
SELECT
    grantee,
    table_name,
    privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('device_pairings', 'sync_documents', 'cloud_backups')
ORDER BY table_name, grantee, privilege_type;

SELECT
    p.oid::regprocedure AS function_signature,
    p.prosecdef AS security_definer,
    p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('generate_pairing_token', 'pair_monitor_device', 'unpair_monitor')
ORDER BY 1;
