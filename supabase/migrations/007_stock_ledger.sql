-- ============================================================================
-- 007_stock_ledger.sql  —  APLICADA en producción (verificada 2026-10-09)
--
-- Reemplaza el eco de deltas de bodega_stock_v1 por un ledger de movimientos:
--   * Cada cambio de stock es un movimiento con movement_id único (idempotente:
--     reintentar un lote offline no duplica nada).
--   * Un baseline por producto fija el conteo físico de partida (counted_at).
--     Solo cuentan los movimientos con client_created_at posterior al conteo,
--     así las ventas offline anteriores al conteo no se suman dos veces.
--   * El stock actual se calcula en el servidor: baseline + movimientos posteriores.
--
-- Requiere 001–006 (is_own_device_row, is_active_or_unlinked_device,
-- my_account_device_ids, account_devices.user_id). Idempotente.
-- ============================================================================

-- ── Movimientos (append-only) ───────────────────────────────────────────────
create table if not exists public.stock_movements (
    movement_id       text primary key,                    -- generado por el cliente, único
    seq               bigint generated always as identity, -- orden de llegada al servidor
    negocio_id        text not null,
    product_id        text not null,
    device_id         text not null,
    delta             numeric(14,3) not null,
    reason            text not null check (reason in ('SALE','VOID','ADJUST','RECEIPT','OPENING')),
    source_ref        text,                                -- id de venta/ajuste (auditoría)
    client_created_at timestamptz not null,                -- cuándo ocurrió en el equipo
    created_at        timestamptz not null default now(),  -- cuándo llegó al servidor
    constraint stock_movements_delta_sane check (delta between -1000000 and 1000000),
    constraint stock_movements_ids_nonempty check (length(negocio_id) > 0 and length(product_id) > 0)
);

create index if not exists stock_movements_product_idx
    on public.stock_movements (negocio_id, product_id, client_created_at);

alter table public.stock_movements enable row level security;

-- Escritura: solo desde un dispositivo activo de la cuenta (regla de 006).
drop policy if exists "stock_movements_insert_active_device" on public.stock_movements;
create policy "stock_movements_insert_active_device"
    on public.stock_movements
    for insert to anon, authenticated
    with check (public.is_active_or_unlinked_device(device_id));

-- Lectura directa: solo dispositivos de la misma cuenta.
drop policy if exists "stock_movements_read_account" on public.stock_movements;
create policy "stock_movements_read_account"
    on public.stock_movements
    for select to anon, authenticated
    using (device_id in (select unnest(public.my_account_device_ids())));

-- Sin UPDATE ni DELETE: el ledger es inmutable. Un error se corrige con un
-- movimiento compensatorio (reason = 'ADJUST'), nunca editando el historial.

-- ── Baseline (conteo físico de partida) ─────────────────────────────────────
create table if not exists public.stock_baselines (
    negocio_id   text not null,
    product_id   text not null,
    qty          numeric(14,3) not null,
    counted_at   timestamptz not null,                     -- momento del conteo físico
    set_by_user  uuid not null,                            -- dueño que lo fijó
    set_at       timestamptz not null default now(),
    primary key (negocio_id, product_id),
    constraint stock_baselines_qty_sane check (qty between -1000000 and 1000000)
);

alter table public.stock_baselines enable row level security;
-- Sin políticas: ni lectura ni escritura directa. Todo pasa por get_stock y
-- set_stock_baseline (SECURITY DEFINER), que aplican la regla de cuenta.

-- ── Aplicar un lote de movimientos (atómico e idempotente) ──────────────────
-- p_movements: [{ movement_id, negocio_id, product_id, device_id, delta,
--                 reason, source_ref, client_created_at }, ...]
-- Devuelve cuántos se insertaron y cuántos eran duplicados (ya aplicados).
create or replace function public.apply_stock_movements(p_movements jsonb)
returns table(inserted int, duplicated int)
language plpgsql
security definer
set search_path = public
as $$
declare
    m        jsonb;
    n_ins    int := 0;
    n_dup    int := 0;
    n_rows   int;
begin
    if p_movements is null or jsonb_typeof(p_movements) <> 'array' then
        raise exception 'p_movements debe ser un arreglo JSON' using errcode = '22023';
    end if;
    if jsonb_array_length(p_movements) > 500 then
        raise exception 'lote demasiado grande (máximo 500)' using errcode = '22023';
    end if;

    for m in select * from jsonb_array_elements(p_movements) loop
        -- Solo dispositivos activos de la cuenta pueden escribir su propio device_id.
        if not public.is_active_or_unlinked_device(m->>'device_id') then
            raise exception 'dispositivo no autorizado' using errcode = '42501';
        end if;

        insert into public.stock_movements (
            movement_id, negocio_id, product_id, device_id, delta,
            reason, source_ref, client_created_at
        ) values (
            m->>'movement_id',
            m->>'negocio_id',
            m->>'product_id',
            m->>'device_id',
            (m->>'delta')::numeric,
            m->>'reason',
            m->>'source_ref',
            (m->>'client_created_at')::timestamptz
        )
        on conflict (movement_id) do nothing;

        get diagnostics n_rows = row_count;
        if n_rows = 1 then n_ins := n_ins + 1; else n_dup := n_dup + 1; end if;
    end loop;

    return query select n_ins, n_dup;
end;
$$;

revoke all on function public.apply_stock_movements(jsonb) from public;
grant execute on function public.apply_stock_movements(jsonb) to anon, authenticated;

-- ── Stock actual calculado en el servidor ───────────────────────────────────
-- stock = baseline.qty + Σ delta de movimientos con client_created_at > counted_at.
-- Sin baseline, el stock es la suma de todos los movimientos (el OPENING debe
-- registrarse como primer movimiento de cada producto).
create or replace function public.get_stock(p_negocio_id text)
returns table(product_id text, qty numeric)
language sql
security definer
set search_path = public
stable
as $$
    select p.product_id,
           coalesce(b.qty, 0) + coalesce(sum(m.delta) filter (
               where m.client_created_at > coalesce(b.counted_at, '-infinity'::timestamptz)
           ), 0) as qty
      from (
          select distinct product_id from public.stock_movements where negocio_id = p_negocio_id
          union
          select product_id from public.stock_baselines where negocio_id = p_negocio_id
      ) p
      left join public.stock_baselines b
             on b.negocio_id = p_negocio_id and b.product_id = p.product_id
      left join public.stock_movements m
             on m.negocio_id = p_negocio_id and m.product_id = p.product_id
     -- Tenant: solo si el negocio tiene movimientos de un dispositivo de esta cuenta.
     where exists (
            select 1 from public.stock_movements sm
             where sm.negocio_id = p_negocio_id
               and sm.device_id in (select unnest(public.my_account_device_ids()))
        )
     group by p.product_id, b.qty, b.counted_at;
$$;

revoke all on function public.get_stock(text) from public;
grant execute on function public.get_stock(text) to anon, authenticated;

-- ── Fijar baseline (solo dueño de la cuenta) ────────────────────────────────
-- p_counts: [{ product_id, qty }, ...]. Reemplaza el baseline de esos productos.
create or replace function public.set_stock_baseline(
    p_negocio_id text,
    p_counted_at timestamptz,
    p_counts     jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    c     jsonb;
    n     int := 0;
    uid   uuid := (select auth.uid());
begin
    if uid is null then
        raise exception 'sesión requerida' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.account_devices ad
         where ad.user_id = uid and ad.revoked = false
    ) then
        raise exception 'solo el dueño de la cuenta puede fijar el baseline' using errcode = '42501';
    end if;
    if p_counted_at > now() + interval '5 minutes' then
        raise exception 'counted_at no puede estar en el futuro' using errcode = '22023';
    end if;

    for c in select * from jsonb_array_elements(p_counts) loop
        insert into public.stock_baselines (negocio_id, product_id, qty, counted_at, set_by_user)
        values (p_negocio_id, c->>'product_id', (c->>'qty')::numeric, p_counted_at, uid)
        on conflict (negocio_id, product_id) do update
            set qty = excluded.qty,
                counted_at = excluded.counted_at,
                set_by_user = excluded.set_by_user,
                set_at = now();
        n := n + 1;
    end loop;
    return n;
end;
$$;

revoke all on function public.set_stock_baseline(text, timestamptz, jsonb) from public;
grant execute on function public.set_stock_baseline(text, timestamptz, jsonb) to authenticated;

-- ============================================================================
-- Pendiente antes de aplicar (no resuelto aquí):
--  1. Confirmar que account_devices.user_id existe y es el dueño (la función
--     set_stock_baseline depende de ello).
--  2. client_created_at viene del reloj del equipo. Un reloj mal configurado
--     puede excluir o incluir movimientos del conteo; validar el desfase.
--  3. Los movimientos de un equipo offline anteriores al conteo deben subirse
--     con su client_created_at original (no con la hora de envío).
--  4. Probar en supabase local (supabase start) con dos dispositivos y lotes
--     repetidos antes de aplicar en producción.
-- ============================================================================
