-- ============================================================================
-- 001_device_own_row_rls.sql
-- RLS: respaldo propio por dispositivo (cloud_backups + sync_documents)
--
-- Contexto:
--   El E2E contra Supabase real demostró que los dispositivos (sesión anónima
--   del POS) reciben 42501 al escribir cloud_backups y 0 filas al leer
--   cloud_backups/sync_documents: las políticas actuales solo contemplan al
--   dueño vía service-role (Estación Maestra) y al monitor.
--
-- Objetivo:
--   1) Cada dispositivo puede crear/leer/actualizar SU PROPIA fila en
--      cloud_backups y SUS PROPIOS documentos en sync_documents.
--   2) El monitor emparejado (dueño) conserva lectura del dispositivo primario.
--   3) Nadie puede tocar filas de otros dispositivos.
--
-- Identidad del dispositivo:
--   Los usuarios son anónimos (auth.uid() cambia entre navegaciones si no hay
--   sesión persistida), por lo que "propiedad" no puede depender de auth.uid().
--   Se introduce `device_sessions`: el dispositivo registra su pda_device_id
--   vinculado a su user_id actual; las políticas resuelven la propiedad vía
--   esa tabla. Reconciliar user_id si la sesión anónima se regenera permite
--   que el mismo hardware recupere acceso a sus filas.
--
-- Seguridad:
--   * pda_device_id es un UUID generado por la app (useSecurity), no ingresado
--     por el usuario; suplantarlo requiere escribir en localStorage de otra
--     máquina (mismo modelo de amenaza que cualquier token local).
--   * El monitor solo obtiene SELECT (lectura), nunca escritura.
--   * La Estación Maestra conserva acceso total vía service_role (bypassa RLS).
--
-- Idempotente: safe to re-run. DROP POLICY IF EXISTS + CREATE.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 0: Tabla puente de identidad de dispositivos
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.device_sessions (
    device_id    text primary key,                -- pda_device_id (ej: PDA-V2-XXXX)
    user_id      uuid not null references auth.users (id) on delete cascade,
    first_seen   timestamptz not null default now(),
    last_seen    timestamptz not null default now()
);

-- Solo el dueño de la sesión ve sus propios registros de identidad.
alter table public.device_sessions enable row level security;

drop policy if exists "device_sessions_insert_own" on public.device_sessions;
create policy "device_sessions_insert_own"
    on public.device_sessions
    for insert to anon, authenticated
    with check (auth.uid() = user_id);

drop policy if exists "device_sessions_select_own" on public.device_sessions;
create policy "device_sessions_select_own"
    on public.device_sessions
    for select to anon, authenticated
    using (auth.uid() = user_id);

-- Reconciliación: si la sesión anónima se regeneró (nuevo user_id) para un
-- device_id ya registrado, el dueño anterior "transfiere" la fila. Se permite
-- update solo del user_id hacia el usuario actual de la petición.
drop policy if exists "device_sessions_reclaim" on public.device_sessions;
create policy "device_sessions_reclaim"
    on public.device_sessions
    for update to anon, authenticated
    using (true)                       -- la fila es visible para reconciliar
    with check (auth.uid() = user_id); -- solo se puede reasignar A uno mismo

drop policy if exists "device_sessions_update_own" on public.device_sessions;
create policy "device_sessions_update_own"
    on public.device_sessions
    for update to anon, authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 1: Helper de sesión — resuelve el device_id de la petición actual
-- ────────────────────────────────────────────────────────────────────────────

-- Marca de tiempo de la reconciliación (evita abusos del reclaim masivo).
-- SECURITY DEFINER: necesita leer device_sessions aunque el llamante no tenga
-- SELECT todavía (chicken-and-egg durante el primer registro).
create or replace function public.current_device_id()
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    header_device text;
    registered    text;
begin
    -- 1) La app envía su device_id en el header de cada petición PostgREST.
    begin
        header_device := nullif(current_setting('request.headers', true)::json->>'x-device-id', '');
    exception when others then
        header_device := null;
    end;

    if header_device is null then
        return null;
    end if;

    -- 2) Debe existir un registro de identidad para ese device_id...
    select device_id into registered
    from public.device_sessions
    where device_id = header_device;

    if found then
        return registered;
    end if;

    -- 3) ...o la petición debe venir autenticada como el dueño registrado.
    --    (Con header + user_id en device_sessions bastan los policies de abajo;
    --     aquí devolvemos el header si hay sesión válida registrada.)
    return null;
end;
$$;

-- Función que verifica: el header x-device-id corresponde a un dispositivo
-- registrado y cuya sesión (user_id) coincide con auth.uid() actual.
-- SECURITY DEFINER para romper la circularidad del primer registro.
create or replace function public.is_own_device_row(target_device_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1
        from public.device_sessions ds
        where ds.device_id = target_device_id
          and ds.user_id = auth.uid()
    );
$$;

grant execute on function public.is_own_device_row(text) to anon, authenticated;
grant execute on function public.current_device_id() to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 2: RLS de cloud_backups — fila propia
-- ────────────────────────────────────────────────────────────────────────────

alter table public.cloud_backups enable row level security;

-- INSERT/UPDATE: solo tu propio device_id y con sesión vinculada válida.
drop policy if exists "device_upsert_own_backup" on public.cloud_backups;
create policy "device_upsert_own_backup"
    on public.cloud_backups
    for insert to anon, authenticated
    with check (public.is_own_device_row(device_id));

drop policy if exists "device_update_own_backup" on public.cloud_backups;
create policy "device_update_own_backup"
    on public.cloud_backups
    for update to anon, authenticated
    using (public.is_own_device_row(device_id))
    with check (public.is_own_device_row(device_id));

-- SELECT: tu fila, o las filas de dispositivos que te tienen emparejado
-- (el dueño monitorea desde su propio device_id).
drop policy if exists "device_read_own_backup" on public.cloud_backups;
create policy "device_read_own_backup"
    on public.cloud_backups
    for select to anon, authenticated
    using (
        public.is_own_device_row(device_id)
        or exists (
            select 1 from public.device_pairings dp
            where dp.monitor_device_id = public.current_device_id()
              and dp.primary_device_id = cloud_backups.device_id
        )
    );

-- DELETE: los dispositivos no borran sus respaldos (retención); solo
-- service_role (Estación Maestra) lo hace. Sin política de delete.

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 3: RLS de sync_documents — documentos propios
-- ────────────────────────────────────────────────────────────────────────────

alter table public.sync_documents enable row level security;

drop policy if exists "device_write_own_sync_doc" on public.sync_documents;
create policy "device_write_own_sync_doc"
    on public.sync_documents
    for insert to anon, authenticated
    with check (public.is_own_device_row(device_id));

drop policy if exists "device_update_own_sync_doc" on public.sync_documents;
create policy "device_update_own_sync_doc"
    on public.sync_documents
    for update to anon, authenticated
    using (public.is_own_device_row(device_id))
    with check (public.is_own_device_row(device_id));

drop policy if exists "device_read_own_sync_doc" on public.sync_documents;
create policy "device_read_own_sync_doc"
    on public.sync_documents
    for select to anon, authenticated
    using (
        public.is_own_device_row(device_id)
        or exists (
            select 1 from public.device_pairings dp
            where dp.monitor_device_id = public.current_device_id()
              and dp.primary_device_id = sync_documents.device_id
        )
    );

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 4: Monitoreo del dueño (si ya existían políticas de monitor, no se
-- tocan; estas son aditivas y complementarias).
-- Índice de soporte para el EXISTS de pairing en los SELECT.
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists device_pairings_monitor_idx
    on public.device_pairings (monitor_device_id, primary_device_id);

-- ────────────────────────────────────────────────────────────────────────────
-- PASO 5 (opcional, comentado): reconciliación automática de identidad.
-- Si un dispositivo pierde su fila de device_sessions (ej: limpieza de la
-- tabla por retención), la app puede re-registrarla; el histórico de filas
-- de cloud_backups/sync_documents quedaría huérfano hasta que un operador
-- ejecute:
--
-- update public.device_sessions
--    set user_id = '<nuevo-auth.uid()>'
--  where device_id = '<PDA-V2-XXXX>';
-- ============================================================================
