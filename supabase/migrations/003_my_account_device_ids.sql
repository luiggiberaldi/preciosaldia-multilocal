-- ============================================================================
-- 003_my_account_device_ids.sql
--
-- Función para dispositivos vinculados por CÓDIGO (sin sesión de dueño).
-- Esos dispositivos tienen sesión anónima: no pueden leer account_devices
-- (RLS owner-only), pero sí necesitan saber los device_id hermanos para el
-- pull multi-dispositivo. Esta función SECURITY DEFINER resuelve la cuenta
-- vía device_sessions (como la política sync_documents_account_read) y
-- devuelve solo los device_id de ESA cuenta. No enumera nada ajeno.
--
-- Idempotente: safe to re-run.
-- ============================================================================

create or replace function public.my_account_device_ids()
returns text[]
language sql
security definer
set search_path = public
as $$
    select coalesce(array_agg(ad.device_id), '{}')
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
           );
$$;

revoke all on function public.my_account_device_ids() from public;
grant execute on function public.my_account_device_ids() to anon, authenticated;
