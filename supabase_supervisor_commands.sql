-- COMANDOS AUTORIZADOS DEL MODO SUPERVISOR
--
-- Esta migración NO habilita todavía las mutaciones en el frontend.
-- El flag SUPERVISOR_REMOTE_MUTATIONS_ENABLED debe permanecer en false hasta
-- validar la caja receptora y los tests E2E.
--
-- Reemplaza el Broadcast público system_commands por una tabla RLS donde:
-- - solo el monitor vinculado puede crear comandos mediante RPC;
-- - solo la caja vinculada puede recibirlos y confirmar su resultado;
-- - cada command_id es idempotente;
-- - cada orden tiene TTL, actor, target y payload tipado;
-- - no hay CRUD anónimo ni escritura directa desde el cliente.

BEGIN;

-- Extensiones aditivas para contratos y observabilidad de Fases 5–9.
ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_device_pairings_last_seen
    ON public.device_pairings (last_seen_at DESC)
    WHERE last_seen_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.supervisor_commands (
    command_id       TEXT PRIMARY KEY,
    target_device_id TEXT NOT NULL,
    actor_auth_id    UUID NOT NULL,
    command_type     TEXT NOT NULL CHECK (command_type IN (
        'supervisor.rate.set',
        'supervisor.product.create',
        'supervisor.product.update',
        'supervisor.product.delete',
        'supervisor.user.create',
        'supervisor.user.pin.change',
        'supervisor.user.update',
        'supervisor.user.delete',
        'supervisor.shift.close',
        'supervisor.shift.reopen',
        'supervisor.inventory.batch.adjust'
    )),
    payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
    schema_version   INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    issued_at        TIMESTAMPTZ NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
    ack_payload      JSONB,
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supervisor_commands_ttl_check CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_commands_target_status
    ON public.supervisor_commands (target_device_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supervisor_commands_actor
    ON public.supervisor_commands (actor_auth_id, created_at DESC);

ALTER TABLE public.supervisor_commands
    ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.supervisor_commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.supervisor_commands FROM anon, authenticated;
GRANT SELECT ON TABLE public.supervisor_commands TO authenticated;

DROP POLICY IF EXISTS "supervisor_commands_authorized_read" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_authorized_read"
    ON public.supervisor_commands
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.target_device_id
              AND dp.revoked_at IS NULL
              AND dp.monitor_auth_id IS NOT NULL
              AND (
                  dp.owner_auth_id = auth.uid()
                  OR dp.monitor_auth_id = auth.uid()
              )
        )
    );

-- El monitor crea comandos únicamente por esta función.
CREATE OR REPLACE FUNCTION public.create_supervisor_command(
    p_command_id       TEXT,
    p_target_device_id TEXT,
    p_command_type     TEXT,
    p_payload          JSONB,
    p_issued_at        TIMESTAMPTZ,
    p_expires_at       TIMESTAMPTZ
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_existing public.supervisor_commands%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF p_command_id IS NULL OR length(trim(p_command_id)) < 8 OR length(trim(p_command_id)) > 128 THEN
        RAISE EXCEPTION 'command_id inválido';
    END IF;

    IF p_command_type IS NULL OR p_command_type NOT IN (
        'supervisor.rate.set',
        'supervisor.product.create',
        'supervisor.product.update',
        'supervisor.product.delete',
        'supervisor.user.create',
        'supervisor.user.pin.change',
        'supervisor.user.update',
        'supervisor.user.delete',
        'supervisor.shift.close',
        'supervisor.shift.reopen',
        'supervisor.inventory.batch.adjust'
    ) THEN
        RAISE EXCEPTION 'Tipo de comando no permitido';
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'Payload inválido';
    END IF;

    IF p_command_type = 'supervisor.rate.set' THEN
        IF p_payload->>'rateMode' NOT IN ('bcv', 'euro', 'usdt', 'manual')
           OR (
               p_payload->>'rateMode' = 'manual'
               AND (
                   (p_payload->>'customRate') IS NULL
                   OR NOT ((p_payload->>'customRate') ~ '^[0-9]+([.][0-9]+)?$')
                   OR (p_payload->>'customRate')::numeric <= 0
               )
           ) THEN
            RAISE EXCEPTION 'Payload de tasa inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.create' THEN
        IF jsonb_typeof(p_payload->'product') <> 'object'
           OR coalesce(p_payload->'product'->>'id', '') = ''
           OR coalesce(p_payload->'product'->>'name', '') = '' THEN
            RAISE EXCEPTION 'Payload de producto inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.update' THEN
        IF coalesce(p_payload->>'productId', '') = ''
           OR jsonb_typeof(p_payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de producto inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.delete' THEN
        IF coalesce(p_payload->>'productId', '') = '' THEN
            RAISE EXCEPTION 'Producto inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.inventory.batch.adjust' THEN
        IF p_payload->>'direction' <> 'ingreso'
           OR coalesce(p_payload->>'productId', '') = ''
           OR p_payload->>'inputUnit' NOT IN ('unidades', 'cajas', 'bultos')
           OR (p_payload->>'quantityInput') IS NULL
           OR NOT ((p_payload->>'quantityInput') ~ '^[0-9]+([.][0-9]+)?$')
           OR (p_payload->>'quantityInput')::numeric <= 0
           OR (p_payload->>'unitsPerPackage') IS NULL
           OR NOT ((p_payload->>'unitsPerPackage') ~ '^[0-9]+([.][0-9]+)?$')
           OR (p_payload->>'unitsPerPackage')::numeric <= 0
           OR (p_payload->>'expectedStock') IS NULL
           OR NOT ((p_payload->>'expectedStock') ~ '^[0-9]+([.][0-9]+)?$')
           OR (p_payload->>'expectedStock')::numeric < 0
           OR length(trim(coalesce(p_payload->>'reason', ''))) = 0
           OR length(p_payload->>'reason') > 240 THEN
            RAISE EXCEPTION 'Payload de ingreso por lote inválido';
        END IF;
    ELSIF p_command_type LIKE 'supervisor.user.%' THEN
        RAISE EXCEPTION 'Gestión remota de usuarios requiere un flujo de credencial segura';
    ELSIF p_command_type IN ('supervisor.shift.close', 'supervisor.shift.reopen') THEN
        IF coalesce(p_payload->>'shiftId', '') = ''
           OR coalesce(p_payload->>'cierreId', '') = ''
           OR length(p_payload->>'shiftId') > 128
           OR length(p_payload->>'cierreId') > 128 THEN
            RAISE EXCEPTION 'Turno o cierre inválido';
        END IF;
    END IF;

    -- Validar la duración contra issued_at, no contra now()+60s:
    -- la petición tarda algunos milisegundos en llegar y la comparación
    -- anterior rechazaba comandos legítimos en el límite del TTL.
    IF p_issued_at < now() - interval '2 minutes'
       OR p_issued_at > now() + interval '2 minutes'
       OR p_expires_at <= p_issued_at
       OR p_expires_at - p_issued_at > interval '60 seconds'
       OR p_expires_at <= now() THEN
        RAISE EXCEPTION 'Ventana temporal inválida';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(p_target_device_id)
          AND dp.revoked_at IS NULL
          AND dp.monitor_auth_id = v_actor
    ) THEN
        RAISE EXCEPTION 'Monitor no autorizado para esa caja';
    END IF;

    SELECT *
    INTO v_existing
    FROM public.supervisor_commands
    WHERE command_id = trim(p_command_id)
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.actor_auth_id <> v_actor
           OR v_existing.target_device_id <> trim(p_target_device_id)
           OR v_existing.command_type <> p_command_type
           OR v_existing.payload <> p_payload THEN
            RAISE EXCEPTION 'command_id ya utilizado con otro payload';
        END IF;

        RETURN json_build_object(
            'command_id', v_existing.command_id,
            'status', v_existing.status,
            'created_at', v_existing.created_at
        );
    END IF;

    INSERT INTO public.supervisor_commands (
        command_id,
        target_device_id,
        actor_auth_id,
        command_type,
        payload,
        issued_at,
        expires_at
    ) VALUES (
        trim(p_command_id),
        trim(p_target_device_id),
        v_actor,
        p_command_type,
        p_payload,
        p_issued_at,
        p_expires_at
    );

    RETURN json_build_object(
        'command_id', trim(p_command_id),
        'status', 'pending',
        'created_at', now()
    );
END;
$$;

-- La caja confirma aplicado/rechazado/fallido. El monitor no puede auto-aprobarse.
CREATE OR REPLACE FUNCTION public.ack_supervisor_command(
    p_command_id    TEXT,
    p_status        TEXT,
    p_ack_payload   JSONB DEFAULT '{}'::jsonb,
    p_error_message TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_command public.supervisor_commands%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF p_status NOT IN ('applied', 'rejected', 'failed') THEN
        RAISE EXCEPTION 'Estado ACK inválido';
    END IF;

    SELECT sc.*
    INTO v_command
    FROM public.supervisor_commands sc
    JOIN public.device_pairings dp
      ON dp.primary_device_id = sc.target_device_id
     AND dp.owner_auth_id = v_actor
     AND dp.revoked_at IS NULL
    WHERE sc.command_id = p_command_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comando no encontrado o monitor no autorizado';
    END IF;

    IF v_command.status <> 'pending' THEN
        RETURN json_build_object('command_id', p_command_id, 'status', v_command.status);
    END IF;

    IF v_command.expires_at <= now() THEN
        UPDATE public.supervisor_commands
        SET status = 'failed',
            error_message = 'Comando expirado antes del ACK',
            updated_at = now()
        WHERE command_id = p_command_id;

        RETURN json_build_object('command_id', p_command_id, 'status', 'failed');
    END IF;

    UPDATE public.supervisor_commands
    SET status = p_status,
        ack_payload = COALESCE(p_ack_payload, '{}'::jsonb),
        error_message = p_error_message,
        updated_at = now()
    WHERE command_id = p_command_id;

    RETURN json_build_object('command_id', p_command_id, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ack_supervisor_command(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ack_supervisor_command(text, text, jsonb, text) TO authenticated;

ALTER TABLE public.supervisor_commands REPLICA IDENTITY DEFAULT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'supervisor_commands'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.supervisor_commands;
    END IF;
END $$;

COMMIT;
