-- A valid offline lease permits local POS use only. Every cloud write still
-- requires the active server-side account membership; this closes the existing
-- own-device RLS policies, which previously ignored account_devices.revoked.

create or replace function public.is_active_or_unlinked_device(target_device_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select public.is_own_device_row(target_device_id)
       and (
           not exists (
               select 1 from public.account_devices ad
                where ad.device_id = target_device_id
           )
           or exists (
               select 1 from public.account_devices ad
                where ad.device_id = target_device_id
                  and ad.revoked = false
           )
       );
$$;

revoke all on function public.is_active_or_unlinked_device(text) from public;
grant execute on function public.is_active_or_unlinked_device(text) to anon, authenticated;

drop policy if exists "device_write_own_sync_doc" on public.sync_documents;
create policy "device_write_own_sync_doc"
    on public.sync_documents
    for insert to anon, authenticated
    with check (public.is_active_or_unlinked_device(device_id));

drop policy if exists "device_update_own_sync_doc" on public.sync_documents;
create policy "device_update_own_sync_doc"
    on public.sync_documents
    for update to anon, authenticated
    using (public.is_active_or_unlinked_device(device_id))
    with check (public.is_active_or_unlinked_device(device_id));

drop policy if exists "device_read_own_sync_doc" on public.sync_documents;
create policy "device_read_own_sync_doc"
    on public.sync_documents
    for select to anon, authenticated
    using (
        public.is_active_or_unlinked_device(device_id)
        or exists (
            select 1 from public.device_pairings dp
            where dp.monitor_device_id = public.current_device_id()
              and dp.primary_device_id = sync_documents.device_id
        )
    );

-- Apply the same revocation rule to per-device cloud backups.
drop policy if exists "device_upsert_own_backup" on public.cloud_backups;
create policy "device_upsert_own_backup"
    on public.cloud_backups
    for insert to anon, authenticated
    with check (public.is_active_or_unlinked_device(device_id));

drop policy if exists "device_update_own_backup" on public.cloud_backups;
create policy "device_update_own_backup"
    on public.cloud_backups
    for update to anon, authenticated
    using (public.is_active_or_unlinked_device(device_id))
    with check (public.is_active_or_unlinked_device(device_id));

drop policy if exists "device_read_own_backup" on public.cloud_backups;
create policy "device_read_own_backup"
    on public.cloud_backups
    for select to anon, authenticated
    using (
        public.is_active_or_unlinked_device(device_id)
        or exists (
            select 1 from public.device_pairings dp
            where dp.monitor_device_id = public.current_device_id()
              and dp.primary_device_id = cloud_backups.device_id
        )
    );
