-- STAGING E2E — AUTORIZACIÓN GENERAL DEL INGRESO DEL SUPERVISOR
-- Proyecto: tdfcpwctvumbdjmifypd
-- Solo contiene dispositivos sintéticos e2e-*.
-- La tabla allowlist se conserva como fixture/compatibilidad, pero el guardia
-- autoriza por pairing activo para simular la política general de producción.
-- No ejecutar en producción.
-- ROLLBACK: DROP TRIGGER IF EXISTS supervisor_income_pairing_guard ON public.supervisor_commands;
-- DROP FUNCTION IF EXISTS public.enforce_supervisor_income_command();
-- DROP TABLE IF EXISTS public.supervisor_canary_allowlist;

BEGIN;

CREATE TABLE IF NOT EXISTS public.supervisor_canary_allowlist (
    primary_device_id TEXT PRIMARY KEY,
    monitor_device_id TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'M2 staging canary',
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

DROP POLICY IF EXISTS staging_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist;
CREATE POLICY staging_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist
    FOR SELECT
    TO postgres
    USING (primary_device_id LIKE 'e2e-%');

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
    -- Staging replica la Fase 6: ingreso y tasas, cada uno con su flag de cliente.
    -- Egreso, productos, cierres y usuarios deben fallar en backend.
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

INSERT INTO public.supervisor_canary_allowlist (
    primary_device_id,
    monitor_device_id,
    purpose,
    enabled,
    expires_at
) VALUES (
    'e2e-primary-device',
    'e2e-monitor-device',
    'M2 staging synthetic canary',
    true,
    now() + interval '30 days'
)
ON CONFLICT (primary_device_id) DO UPDATE SET
    monitor_device_id = EXCLUDED.monitor_device_id,
    purpose = EXCLUDED.purpose,
    enabled = EXCLUDED.enabled,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

COMMIT;
