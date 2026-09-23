-- ============================================================
-- SQL SETUP: Monitoreo Remoto en Tiempo Real (Solo Lectura por QR)
-- ============================================================

-- 1. Crear la tabla de emparejamientos
CREATE TABLE IF NOT EXISTS public.device_pairings (
    id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    primary_device_id  TEXT NOT NULL UNIQUE,     -- El equipo de caja (licencia activa)
    monitor_device_id  TEXT UNIQUE,              -- El celular del dueño (monitor)
    pairing_token      TEXT,                      -- Token de enlace temporal
    token_expires_at   TIMESTAMPTZ,               -- Expiración del token
    paired_at          TIMESTAMPTZ,               -- Fecha de vinculación
    created_at         TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.device_pairings ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Allow public read access to pairings" ON public.device_pairings;
CREATE POLICY "Allow public read access to pairings"
    ON public.device_pairings FOR SELECT
    TO anon, authenticated
    USING (
        -- Solo permite consultar si el token está activo o si el registro ya está emparejado
        (pairing_token IS NOT NULL AND token_expires_at > now())
        OR (monitor_device_id IS NOT NULL)
    );

-- SEC-010: El rol anon no tiene permiso para escribir directamente en la tabla.
-- Toda la escritura se delega en las funciones RPC con SECURITY DEFINER.
DROP POLICY IF EXISTS "Allow write access to own pairing" ON public.device_pairings;

-- 2. Función RPC para generar token de emparejamiento (Caja)
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_token TEXT;
BEGIN
    -- Generar un token alfanumérico corto de 6 caracteres
    v_token := upper(substring(md5(random()::text) from 1 for 6));
    
    -- Insertar o actualizar el registro
    INSERT INTO public.device_pairings (primary_device_id, pairing_token, token_expires_at)
    VALUES (p_device_id, v_token, now() + interval '5 minutes')
    ON CONFLICT (primary_device_id)
    DO UPDATE SET 
        pairing_token = v_token,
        token_expires_at = now() + interval '5 minutes',
        monitor_device_id = NULL,
        paired_at = NULL;
        
    RETURN v_token;
END;
$$;

-- 3. Función RPC para emparejar el celular del dueño (Monitor)
CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token TEXT, p_monitor_device_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_pairing RECORD;
BEGIN
    -- Buscar token válido y no expirado
    SELECT * INTO v_existing_pairing 
    FROM public.device_pairings 
    WHERE upper(pairing_token) = upper(p_token) AND token_expires_at > now();
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El código QR ha expirado o es inválido.');
    END IF;
    
    -- Verificar si ya hay otro monitor vinculado
    IF v_existing_pairing.monitor_device_id IS NOT NULL AND v_existing_pairing.monitor_device_id <> p_monitor_device_id THEN
        RETURN json_build_object('success', false, 'message', 'Límite de dispositivos alcanzado (Máximo 2).');
    END IF;
    
    -- Actualizar con el ID del monitor
    UPDATE public.device_pairings
    SET 
        monitor_device_id = p_monitor_device_id,
        paired_at = now()
    WHERE id = v_existing_pairing.id;
    
    RETURN json_build_object('success', true, 'primary_device_id', v_existing_pairing.primary_device_id);
END;
$$;

-- 4. Función RPC para desvincular un monitor
CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.device_pairings
    SET 
        monitor_device_id = NULL,
        pairing_token = NULL,
        token_expires_at = NULL,
        paired_at = NULL
    WHERE primary_device_id = p_device_id OR monitor_device_id = p_device_id;
END;
$$;

-- 5. Otorgar permisos explícitos a los roles 'anon' y 'authenticated'
-- Esto soluciona el error 401 / permission denied al conectar dispositivos sin login.
-- SEC-010: Revocar permisos CRUD de escritura directos para anon y authenticated en device_pairings.
GRANT SELECT ON public.device_pairings TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.device_pairings FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_documents TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.generate_pairing_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(TEXT) TO anon, authenticated;

-- 6. Política RLS para permitir a usuarios anónimos (cajas y monitores) leer y escribir sus propios documentos de vinculación activa
DROP POLICY IF EXISTS "sync_documents_monitor_access" ON public.sync_documents;
DROP POLICY IF EXISTS "sync_documents_anon_write" ON public.sync_documents;

CREATE POLICY "sync_documents_anon_access" ON public.sync_documents
    FOR ALL
    TO anon
    USING (
        EXISTS (
            SELECT 1 FROM public.device_pairings
            WHERE device_pairings.primary_device_id = sync_documents.device_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.device_pairings
            WHERE device_pairings.primary_device_id = sync_documents.device_id
        )
    );

-- 7. Asegurar que las tablas estén registradas en la publicación de realtime para transmisión en tiempo real
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'sync_documents'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_documents;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'device_pairings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.device_pairings;
    END IF;
END $$;


