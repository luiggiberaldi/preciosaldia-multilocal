-- =================================================================================
-- PREPARATIVOS PARA LA NUEVA BASE DE DATOS Y ESTACIÓN MAESTRA (TASAS AL DIA 2.0)
-- =================================================================================
-- ISSUES cubiertos: INFRA-002 / SEC-002 / SEC-003 / SEC-010 / INFRA-014 / INFRA-015
--
-- Ejecuta este script SQL en tu NUEVA base de datos de Supabase en el panel "SQL Editor".
-- Así quedará todo preparado para el registro de correos, licenciamiento y acceso
-- desde la futura Estación Maestra.
--
-- Schema canónico de cloud_backups: ver supabase_cloud_schema.sql (INFRA-014).
-- Este archivo se alinea con aquel: id UUID + device_id TEXT + UNIQUE(device_id).

-- 1. Tabla: cloud_backups -> (Almacena los respaldos en vivo del usuario)
--    INFRA-014: schema unificado con supabase_cloud_schema.sql.
CREATE TABLE IF NOT EXISTS public.cloud_backups (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id     TEXT NOT NULL UNIQUE,                       -- INFRA-014: PK moved to UUID; device_id UNIQUE.
    email         TEXT UNIQUE,                                -- opcional; si se usa, crear índice (ver abajo).
    -- DEPRECATED (INFRA-015): password_hash. Usar Supabase Auth.
    -- Si se mantiene, exigir formato `argon2$...$salt$hash`. NO aceptar texto plano.
    password_hash TEXT,
    backup_data   JSONB NOT NULL,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- INFRA-015: índice en email (descomentado — antes estaba comentado).
CREATE INDEX IF NOT EXISTS idx_cloud_backups_email ON public.cloud_backups(email);

-- 2. Tabla: cloud_licenses -> (Para manejar Licencia Permanente y Por Días desde la Estación Maestra)
CREATE TABLE IF NOT EXISTS public.cloud_licenses (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,                     -- El correo asocia a la persona con su licencia
    device_id       TEXT NOT NULL,
    license_type    TEXT NOT NULL DEFAULT 'trial',            -- Valores: 'trial', 'days', 'permanent'
    days_remaining  INTEGER DEFAULT 15,
    business_name   TEXT,
    phone           TEXT,
    is_active       BOOLEAN DEFAULT true,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_licenses_device_id ON public.cloud_licenses(device_id);

-- 3. Habilitar Seguridad Básica (Row Level Security - RLS)
ALTER TABLE public.cloud_backups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_licenses ENABLE ROW LEVEL SECURITY;

-- INFRA-002 / SEC-010: eliminar políticas USING(true) previas.
DROP POLICY IF EXISTS "Permitir todo a cloud_backups"   ON public.cloud_backups;
DROP POLICY IF EXISTS "Permitir todo a cloud_licenses"  ON public.cloud_licenses;

-- cloud_backups: solo el dueño del dispositivo.
DROP POLICY IF EXISTS "cloud_backups_device_isolation" ON public.cloud_backups;
CREATE POLICY "cloud_backups_device_isolation" ON public.cloud_backups
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = device_id)
    WITH CHECK (auth.uid()::text = device_id);

-- cloud_licenses: SELECT solo para el dueño del dispositivo. Quitar SELECT USING(true).
-- Escritura solo por service_role (Estación Maestra vía backend).
CREATE POLICY "cloud_licenses_device_read" ON public.cloud_licenses
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = device_id);

CREATE POLICY "cloud_licenses_admin_write" ON public.cloud_licenses
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 4. Tabla: account_devices -> (Controla qué dispositivos están activos por cuenta, máximo 2)
CREATE TABLE IF NOT EXISTS public.account_devices (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email         TEXT NOT NULL,
    device_id     TEXT NOT NULL,
    device_alias  TEXT DEFAULT 'Dispositivo',
    last_seen     TIMESTAMPTZ DEFAULT NOW(),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(email, device_id)
);

ALTER TABLE public.account_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo a account_devices"          ON public.account_devices;
DROP POLICY IF EXISTS "account_devices_device_isolation"         ON public.account_devices;

-- INFRA-002: account_devices filtrado por auth.uid()::text == user_id (mapea a device_id).
CREATE POLICY "account_devices_device_isolation" ON public.account_devices
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = device_id)
    WITH CHECK (auth.uid()::text = device_id);

CREATE POLICY "account_devices_admin_write" ON public.account_devices
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. RPC verify_activation_code (SEC-003): valida sin exponer la tabla cloud_licenses.
--    Mismo patrón que en supabase_rls_hardening.sql para `licenses`.
CREATE OR REPLACE FUNCTION public.verify_activation_code(
    p_device_id TEXT,
    p_code      TEXT
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.cloud_licenses
        WHERE device_id = p_device_id
          AND is_active = true
          AND (
            license_type = 'permanent'
            OR (license_type = 'days' AND days_remaining > 0)
          )
    );
$$;

GRANT EXECUTE ON FUNCTION public.verify_activation_code(TEXT, TEXT) TO anon, authenticated;

-- =================================================================================
-- RECORDATORIOS IMPORTANTES PARA SUPABASE DASHBOARD:
-- 1. Ve a "Authentication" -> "Providers" -> Activa "Email".
-- 2. Asegúrate de habilitar "Confirm Email" / "Email Verification".
-- 3. Ajusta los "Redirect URLs" (Settings -> Auth -> URL Configuration)
--    Agrega todas las direcciones desde las que se usará la app. Por ejemplo:
--      http://localhost:5173/*       (Para pruebas locales)
--      https://<worker>.workers.dev/* (Para la app final en Cloudflare — INFRA-010)
--    Supabase solo permitirá redireccionar a los dominios listados ahí.
-- 4. (INFRA-001) Si las anon keys están comprometidas en el historial de git,
--    rotarlas en Settings → API → "Rotate anon key" y ejecutar
--    scripts/rotate-secrets.md + scripts/purge-history.sh.
-- =================================================================================
