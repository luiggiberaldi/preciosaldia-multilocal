-- PRODUCCIÓN — AUTORIZACIÓN GENERAL DEL INGRESO REMOTO DEL SUPERVISOR
--
-- Objetivo:
-- - permitir el ingreso remoto a cualquier par caja/Supervisor correctamente vinculado;
-- - exigir sesión Auth, pairing activo, identidad del monitor y ACK;
-- - mantener cualquier egreso remoto bloqueado en backend.
--
-- La tabla supervisor_canary_allowlist se conserva por compatibilidad y rollback,
-- pero deja de ser el mecanismo de autorización general. No se usan IDs reales
-- dentro de esta función y no se modifica stock al aplicar la migración.
--
-- ROLLBACK:
-- 1) apagar VITE_SUPERVISOR_REMOTE_INCOME_ENABLED;
-- 2) confirmar 0 comandos pending;
-- 3) DROP TRIGGER IF EXISTS supervisor_income_pairing_guard ON public.supervisor_commands;
-- 4) DROP FUNCTION IF EXISTS public.enforce_supervisor_income_command();
-- 5) restaurar la RPC income-only anterior desde el backup revisado;

BEGIN;

CREATE TABLE IF NOT EXISTS public.supervisor_canary_allowlist (
    primary_device_id TEXT PRIMARY KEY,
    monitor_device_id TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'M5 income canary',
    enabled BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supervisor_canary_allowlist_primary_id_check
        CHECK (length(trim(primary_device_id)) BETWEEN 8 AND 128),
    CONSTRAINT supervisor_canary_allowlist_monitor_id_check
        CHECK (length(trim(monitor_device_id)) BETWEEN 8 AND 128),
    CONSTRAINT supervisor_canary_allowlist_purpose_check
        CHECK (length(trim(purpose)) BETWEEN 1 AND 160),
    CONSTRAINT supervisor_canary_allowlist_expiry_check
        CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_canary_allowlist_active
    ON public.supervisor_canary_allowlist (enabled, expires_at);

ALTER TABLE public.supervisor_canary_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_canary_allowlist FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.supervisor_canary_allowlist FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS supervisor_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist;
CREATE POLICY supervisor_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist
    FOR SELECT
    TO postgres
    USING (true);

DROP TRIGGER IF EXISTS supervisor_canary_income_guard
    ON public.supervisor_commands;
DROP TRIGGER IF EXISTS supervisor_income_pairing_guard
    ON public.supervisor_commands;
DROP FUNCTION IF EXISTS public.enforce_supervisor_canary_command();

CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Fase 6: se permite ingreso y ajuste de tasa por separado.
    -- Egreso, productos, cierres y usuarios continúan bloqueados por backend.
    IF NEW.command_type = 'supervisor.rate.set' THEN
        IF coalesce(NEW.payload->>'rateMode', '') NOT IN ('bcv', 'euro', 'usdt', 'manual')
           OR (
                NEW.payload->>'rateMode' = 'manual'
                AND (
                    NULLIF(trim(NEW.payload->>'customRate'), '') IS NULL
                    OR (NEW.payload->>'customRate') !~ '^[0-9]+([.][0-9]+)?$'
                    OR (NEW.payload->>'customRate')::numeric <= 0
                )
           ) THEN
            RAISE EXCEPTION 'Payload de tasa inválido';
        END IF;
    ELSIF NEW.command_type <> 'supervisor.inventory.batch.adjust'
       OR coalesce(NEW.payload->>'direction', '') <> 'ingreso' THEN
        RAISE EXCEPTION 'Solo ingreso y tasas remotas están habilitados';
    END IF;

    -- Autorización general: cualquier monitor con pairing activo puede operar
    -- únicamente sobre su propia caja. No depende de una allowlist de IDs.
    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(NEW.target_device_id)
          AND dp.monitor_device_id IS NOT NULL
          AND dp.monitor_device_id <> dp.primary_device_id
          AND dp.monitor_device_id <> trim(NEW.target_device_id)
          AND dp.monitor_auth_id = NEW.actor_auth_id
          AND dp.revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Monitor no vinculado o no autorizado para esa caja';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER supervisor_income_pairing_guard
    BEFORE INSERT ON public.supervisor_commands
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_supervisor_income_command();

REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command() FROM PUBLIC, anon, authenticated;

COMMIT;
