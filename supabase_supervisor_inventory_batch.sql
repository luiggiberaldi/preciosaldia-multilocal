-- MIGRACIÓN FUTURA: INGRESO/EGRESO DE STOCK POR LOTE DEL SUPERVISOR
--
-- No ejecutar hasta aprobar los gates R1, R2, M1 y M2.
-- Esta migración amplía el allowlist del comando existente para ingreso y egreso;
-- no habilita
-- el flag frontend ni aplica movimientos por sí sola.
--
-- ROLLBACK: ejecutar la migración de contención que retire el tipo del
-- allowlist y dejar SUPERVISOR_REMOTE_MUTATIONS_ENABLED en false.

BEGIN;

ALTER TABLE public.supervisor_commands
    DROP CONSTRAINT IF EXISTS supervisor_commands_command_type_check;

ALTER TABLE public.supervisor_commands
    ADD CONSTRAINT supervisor_commands_command_type_check
    CHECK (command_type IN (
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
    ));

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
           OR (p_payload->>'rateMode' = 'manual' AND (
                (p_payload->>'customRate') IS NULL
                OR NOT ((p_payload->>'customRate') ~ '^[0-9]+([.][0-9]+)?$')
                OR (p_payload->>'customRate')::numeric <= 0
           )) THEN
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
    ELSIF p_command_type LIKE 'supervisor.user.%' THEN
        RAISE EXCEPTION 'Gestión remota de usuarios requiere un flujo de credencial segura';
    ELSIF p_command_type IN ('supervisor.shift.close', 'supervisor.shift.reopen') THEN
        IF coalesce(p_payload->>'shiftId', '') = ''
           OR coalesce(p_payload->>'cierreId', '') = ''
           OR length(p_payload->>'shiftId') > 128
           OR length(p_payload->>'cierreId') > 128 THEN
            RAISE EXCEPTION 'Turno o cierre inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.inventory.batch.adjust' THEN
        IF p_payload->>'direction' NOT IN ('ingreso', 'egreso')
           OR (p_payload->>'direction' = 'egreso'
               AND p_payload->>'reasonCategory' NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'))
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
    END IF;

    IF p_issued_at < now() - interval '2 minutes'
       OR p_issued_at > now() + interval '2 minutes'
       OR p_expires_at <= p_issued_at
       OR p_expires_at > now() + interval '60 seconds' THEN
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

REVOKE ALL ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) TO authenticated;

COMMIT;
