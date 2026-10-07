-- ============================================================================
-- 002_customer_additions.sql
--
-- Adiciones propias del PROYECTO SUPABASE DE UN CLIENTE.
-- Se aplica DESPUÉS del esquema base, en este orden:
--   1. supabase_cloud_schema.sql            (sync_documents, cloud_backups)
--   2. supabase_pairing_setup.sql           (device_pairings — ANTES de 001,
--                                            cuyas políticas la referencian)
--   3. supabase/migrations/001_device_own_row_rls.sql   (device_sessions)
--   4. supabase/migrations/002_account_devices.sql      (account_devices, pairing_codes)
--   5. supabase/migrations/003_my_account_device_ids.sql
--   6. supabase/migrations/004_device_limit.sql         (tope 6 equipos)
--   7. ESTE ARCHIVO
--
-- Idempotente: safe to re-run.
-- ============================================================================

-- ── 1. Licencia a nivel de cuenta ──────────────────────────────────────────
-- Una fila por dueño. El Pro es siempre Premium permanente (pago único):
-- no hay tipos demo ni mensual aquí.

create table if not exists public.licenses (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    type       text not null default 'permanent' check (type = 'permanent'),
    status     text not null default 'active'   check (status in ('active', 'revoked')),
    issued_at  timestamptz not null default now(),
    notes      text
);

alter table public.licenses enable row level security;

drop policy if exists "licenses_owner_read" on public.licenses;
create policy "licenses_owner_read"
    on public.licenses
    for select to authenticated
    using (auth.uid() = user_id);

-- ── 2. Función anti-dormida ────────────────────────────────────────────────
-- El despertador (keepalive_fleet.py, cron cada 2 días) la invoca con la
-- anon key. Es una llamada de cómputo real: reinicia el contador de
-- inactividad del tier gratis. No toca ninguna tabla.

create or replace function public.keepalive()
returns timestamptz
language sql
stable
set search_path = public
as $$ select now() $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- ── 3. Versión del esquema (migraciones de flota) ──────────────────────────
-- El script de migraciones de flota aplica SQL a todos los proyectos del
-- directorio y registra aquí la versión aplicada por proyecto.

create table if not exists public.schema_version (
    version    int primary key,
    applied_at timestamptz not null default now()
);

alter table public.schema_version enable row level security;

drop policy if exists "schema_version_owner_read" on public.schema_version;
create policy "schema_version_owner_read"
    on public.schema_version
    for select to authenticated
    using (true);

insert into public.schema_version (version) values (2)
    on conflict (version) do nothing;
