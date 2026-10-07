-- ============================================================================
-- 002_account_devices.sql
-- Vinculación de sedes/dispositivos a una CUENTA del dueño en Supabase.
--
-- Contexto:
--   Hasta 001, el sync era por dispositivo: cada pda_device_id sincroniza
--   SUS propios documentos, y el monitor del dueño lee vía device_pairings.
--   Faltaba el concepto de "cuenta": que el dueño abra su cuenta en cualquier
--   dispositivo (otro teléfono, otro país) y vea los datos de todas sus
--   sedes, y que un cambio hecho por el admin se propague a todos.
--
-- Diseño (aditivo; no modifica políticas ni tablas de 001):
--   1) `account_devices`: (user_id, device_id) — qué dispositivos pertenecen
--      a la cuenta del dueño. El user_id es el de Supabase Auth (el dueño se
--      registra con email+contraseña; los dispositivos se vinculan con login
--      o con código de 6 dígitos).
--   2) `pairing_codes`: códigos de un solo uso (expiran en 10 min) para
--      vincular un dispositivo sin escribir la contraseña del dueño en él.
--   3) `redeem_pairing_code(code, device_id)`: SECURITY DEFINER — valida el
--      código y crea el vínculo. Es la única vía para vincular sin sesión.
--   4) Política `sync_documents_account_read`: cualquier dispositivo
--      vinculado a una cuenta (resuelto vía device_sessions, que ya mapea
--      auth.uid() -> device_id) puede LEER los documentos de los demás
--      dispositivos de la MISMA cuenta. Solo lectura; la escritura sigue
--      siendo por dispositivo propio (políticas de 001).
--
-- Seguridad:
--   * Un anon ajeno no llega a nada: su device_id no está en account_devices.
--   * Suplantar un device_id requiere su sesión (mismo modelo de amenaza que
--     device_sessions en 001).
--   * Los códigos son de un solo uso, expiran en 10 min y no revelan nada.
--   * Revocar un dispositivo (revoked=true) le corta la lectura al instante.
--
-- Idempotente: safe to re-run.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 1: tabla account_devices
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.account_devices (
    user_id     uuid not null references auth.users (id) on delete cascade,
    device_id   text not null,                       -- pda_device_id
    business_id text,                                -- sede/negocio principal (opcional)
    alias       text,                                -- "Caja 1", "Teléfono del jefe"
    revoked     boolean not null default false,
    created_at  timestamptz not null default now(),
    last_seen   timestamptz not null default now(),
    primary key (user_id, device_id)
);

create index if not exists account_devices_device_idx
    on public.account_devices (device_id) where revoked = false;

alter table public.account_devices enable row level security;

drop policy if exists "account_devices_owner_all" on public.account_devices;
create policy "account_devices_owner_all"
    on public.account_devices
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 2: tabla pairing_codes (códigos de 6 dígitos, un solo uso)
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.pairing_codes (
    code       text primary key,                      -- "483920"
    user_id    uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at    timestamptz
);

alter table public.pairing_codes enable row level security;

drop policy if exists "pairing_codes_owner_all" on public.pairing_codes;
create policy "pairing_codes_owner_all"
    on public.pairing_codes
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Limpieza: los códigos expirados no se acumulan (los borra el dueño al
-- generar uno nuevo; además esta función los purga al canjear).
create or replace function public.redeem_pairing_code(p_code text, p_device_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
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

-- La función es SECURITY DEFINER pero solo hace lo que el código autoriza:
-- vincular UN device_id a la cuenta dueña del código. No expone nada más.
revoke all on function public.redeem_pairing_code(text, text) from public;
grant execute on function public.redeem_pairing_code(text, text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 3: lectura cruzada entre dispositivos de la misma cuenta
-- ────────────────────────────────────────────────────────────────────────────
-- La identidad del requester se resuelve como en 001: device_sessions mapea
-- auth.uid() -> device_id (la sesión anónima del POS también registra ahí).
-- Si ese device_id pertenece a una cuenta (account_devices, no revocado),
-- el requester puede leer los docs de TODOS los dispositivos de esa cuenta.

drop policy if exists "sync_documents_account_read" on public.sync_documents;
create policy "sync_documents_account_read"
    on public.sync_documents
    for select to anon, authenticated
    using (
        device_id in (
            select ad.device_id
              from public.account_devices ad
             where ad.revoked = false
               and exists (
                       select 1
                         from public.device_sessions ds
                         join public.account_devices mine
                           on mine.device_id = ds.device_id
                          and mine.revoked = false
                        where ds.user_id = auth.uid()
                          and mine.user_id = ad.user_id
                   )
        )
    );
