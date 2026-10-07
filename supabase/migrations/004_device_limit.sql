-- ============================================================================
-- 004_device_limit.sql
-- Límite de 6 equipos por cuenta de dueño.
--
-- Contexto:
--   Hasta 003, cualquier dispositivo con sesión de dueño podía vincularse a
--   la cuenta sin tope (upsert directo a account_devices desde el cliente).
--   Para la prueba con el primer cliente se fija un máximo de 6 equipos por
--   cuenta, aplicado EN EL SERVIDOR para que no dependa del cliente.
--
-- Diseño (aditivo; no toca tablas ni políticas existentes):
--   1) `register_account_device(p_device_id, p_alias)`: SECURITY DEFINER.
--      El dueño (auth.uid()) registra su dispositivo actual. Re-vincular un
--      equipo ya conocido no consume cupo; un equipo nuevo con la cuenta
--      llena (6 activos) falla con 'LIMIT_REACHED' para que el cliente
--      muestre el mensaje de límite en vez de un error genérico.
--   2) Se parchea `redeem_pairing_code` con la misma regla (el flujo de
--      códigos está oculto de la UI por ahora, pero la DB no queda sin tope).
--
-- Idempotente: safe to re-run.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 1: RPC register_account_device
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.register_account_device(p_device_id text, p_alias text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_otros_activos int;
begin
    if v_user_id is null then
        raise exception 'Sin sesión';
    end if;
    if p_device_id is null or p_device_id = '' or length(p_device_id) > 120 then
        raise exception 'Dispositivo inválido';
    end if;

    -- Equipos activos de la cuenta SIN contar este: re-vincular un equipo ya
    -- conocido (activo o revocado que vuelve) no abre un cupo fantasma; un
    -- equipo nuevo con 6 ya activos se rechaza.
    select count(*) into v_otros_activos
      from public.account_devices
     where user_id = v_user_id
       and revoked = false
       and device_id <> p_device_id;

    if v_otros_activos >= 6 then
        raise exception 'LIMIT_REACHED';
    end if;

    insert into public.account_devices (user_id, device_id, alias)
    values (v_user_id, p_device_id, nullif(p_alias, ''))
    on conflict (user_id, device_id) do update
       set revoked = false,
           last_seen = now(),
           alias = coalesce(excluded.alias, public.account_devices.alias);
end;
$$;

-- La función es SECURITY DEFINER pero solo toca las filas del dueño que
-- llama (auth.uid()); no expone ni modifica nada de otras cuentas.
revoke all on function public.register_account_device(text, text) from public;
grant execute on function public.register_account_device(text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 2: mismo tope en redeem_pairing_code
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.redeem_pairing_code(p_code text, p_device_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_otros_activos int;
begin
    if p_code is null or p_device_id is null or length(p_device_id) > 120 then
        raise exception 'Parámetros inválidos';
    end if;

    select user_id into v_user_id
      from public.pairing_codes
     where code = p_code
       and used_at is null
       and expires_at > now()
     for update skip locked;

    if v_user_id is null then
        raise exception 'Código inválido o expirado';
    end if;

    update public.pairing_codes set used_at = now() where code = p_code;

    -- Tope de 6 equipos por cuenta (misma regla que register_account_device).
    select count(*) into v_otros_activos
      from public.account_devices
     where user_id = v_user_id
       and revoked = false
       and device_id <> p_device_id;

    if v_otros_activos >= 6 then
        raise exception 'LIMIT_REACHED';
    end if;

    insert into public.account_devices (user_id, device_id)
    values (v_user_id, p_device_id)
    on conflict (user_id, device_id) do update
       set revoked = false,
           last_seen = now();

    -- Purga oportunista de códigos viejos del mismo dueño.
    delete from public.pairing_codes
     where user_id = v_user_id
       and (used_at is not null or expires_at < now() - interval '1 day');

    return v_user_id;
end;
$$;

revoke all on function public.redeem_pairing_code(text, text) from public;
grant execute on function public.redeem_pairing_code(text, text) to anon, authenticated;
