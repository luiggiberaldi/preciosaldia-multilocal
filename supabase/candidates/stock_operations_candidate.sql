-- 006_stock_operations_candidate.sql
-- CANDIDATE ONLY: not applied to any Supabase project.
--
-- This migration is intentionally fail-closed until an administrator supplies
-- and verifies the authorization helper that maps auth.uid() to an active
-- account/device/business membership. Do not replace it with client-supplied
-- owner_id claims or expose service-role credentials in the application.
--
-- Contract sketch: callers submit a complete sale/void event plus immutable
-- operations. One transaction validates scope, preserves ID collisions,
-- inserts the event and operations, and returns a stable receipt on replay.
-- Production integration must also establish approved baseline/epoch handling,
-- atomic local financial domains, and an authorized rollout plan.

create table if not exists public.stock_operation_events (
    account_id      text not null,
    business_id     text not null,
    epoch_id        text not null,
    event_kind      text not null check (event_kind in ('SALE', 'VOID')),
    event_id        text not null,
    sale_id         text not null,
    revision        text not null check (revision ~ '^[a-f0-9]{64}$'),
    payload         jsonb not null check (jsonb_typeof(payload) = 'object'),
    receipt_id      uuid not null default gen_random_uuid(),
    accepted_at     timestamptz not null default now(),
    primary key (account_id, business_id, epoch_id, event_kind, event_id),
    unique (receipt_id)
);

create table if not exists public.stock_operations (
    account_id          text not null,
    business_id         text not null,
    epoch_id            text not null,
    operation_id        text not null,
    event_kind          text not null check (event_kind in ('SALE', 'VOID')),
    event_id            text not null,
    sale_id             text not null,
    product_id          text not null,
    delta_units         numeric(40, 0) not null check (delta_units <> 0),
    sale_operation_id   text,
    device_id           text not null,
    actor_id            text not null,
    content             jsonb not null check (jsonb_typeof(content) = 'object'),
    accepted_at         timestamptz not null default now(),
    primary key (account_id, business_id, epoch_id, operation_id),
    foreign key (account_id, business_id, epoch_id, event_kind, event_id)
        references public.stock_operation_events
            (account_id, business_id, epoch_id, event_kind, event_id),
    check (
        (event_kind = 'SALE' and delta_units < 0 and sale_operation_id is null)
        or (event_kind = 'VOID' and delta_units > 0 and sale_operation_id is not null)
    )
);

create index if not exists stock_operations_sale_idx
    on public.stock_operations (account_id, business_id, epoch_id, sale_id);

create table if not exists public.stock_operation_conflicts (
    conflict_id     bigint generated always as identity primary key,
    account_id      text not null,
    business_id     text not null,
    epoch_id        text not null,
    subject_kind    text not null check (subject_kind in ('EVENT', 'OPERATION', 'VOID')),
    subject_id      text not null,
    existing_value  jsonb not null,
    incoming_value  jsonb not null,
    observed_at     timestamptz not null default now()
);

create table if not exists public.stock_voided_sales (
    account_id      text not null,
    business_id     text not null,
    epoch_id        text not null,
    sale_id         text not null,
    event_kind      text not null default 'VOID' check (event_kind = 'VOID'),
    void_event_id   text not null,
    created_at      timestamptz not null default now(),
    primary key (account_id, business_id, epoch_id, sale_id),
    unique (account_id, business_id, epoch_id, void_event_id),
    foreign key (account_id, business_id, epoch_id, event_kind, void_event_id)
        references public.stock_operation_events
            (account_id, business_id, epoch_id, event_kind, event_id)
);

-- No direct client DML: the production RPC must lock authorization and all
-- uniqueness scopes, compare canonical immutable content, insert collision
-- evidence rather than overwriting, validate all VOID references/lines, write
-- a VOID claim, then insert event+operations in one database transaction.
alter table public.stock_operation_events enable row level security;
alter table public.stock_operations enable row level security;
alter table public.stock_operation_conflicts enable row level security;
alter table public.stock_voided_sales enable row level security;

revoke all on public.stock_operation_events from anon, authenticated;
revoke all on public.stock_operations from anon, authenticated;
revoke all on public.stock_operation_conflicts from anon, authenticated;
revoke all on public.stock_voided_sales from anon, authenticated;

-- Deliberately no policies or RPC grants are created here. Production work
-- must define a security-reviewed membership helper and a SECURITY DEFINER
-- submission function with a pinned search_path and explicit grants.

comment on table public.stock_operation_events is
    'Unapplied candidate: immutable event receipt journal; direct client access disabled.';
comment on table public.stock_operations is
    'Unapplied candidate: immutable stock operation rows scoped by account/business/epoch.';
comment on table public.stock_operation_conflicts is
    'Unapplied candidate: append-only evidence for conflicting event/operation variants.';
comment on table public.stock_voided_sales is
    'Unapplied candidate: one void claim per scoped sale; use only inside submission RPC transaction.';
