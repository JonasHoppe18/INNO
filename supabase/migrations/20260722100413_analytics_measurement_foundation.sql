-- Minimal, workspace-scoped facts for business analytics.
--
-- Deliberately excluded: customer names, email addresses, shipping addresses,
-- raw Shopify payloads and free-form survey comments. KPI values are derived
-- from these facts instead of being persisted as mutable dashboard snapshots.

create extension if not exists pgcrypto;

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  external_order_id text not null,
  order_number text,
  order_created_at timestamptz not null,
  total_amount numeric(14, 2),
  currency text,
  financial_status text,
  cancelled_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (shop_id, external_order_id),
  constraint commerce_orders_currency_check check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  constraint commerce_orders_total_check check (
    total_amount is null or total_amount >= 0
  )
);

create index if not exists commerce_orders_workspace_created_idx
  on public.commerce_orders (workspace_id, order_created_at desc);

create table if not exists public.commerce_refunds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  external_refund_id text not null,
  external_order_id text not null,
  refunded_at timestamptz not null,
  amount numeric(14, 2),
  currency text,
  synced_at timestamptz not null default now(),
  unique (shop_id, external_refund_id),
  constraint commerce_refunds_currency_check check (
    currency is null or currency ~ '^[A-Z]{3}$'
  ),
  constraint commerce_refunds_amount_check check (
    amount is null or amount >= 0
  )
);

create index if not exists commerce_refunds_workspace_refunded_idx
  on public.commerce_refunds (workspace_id, refunded_at desc);
create index if not exists commerce_refunds_order_idx
  on public.commerce_refunds (shop_id, external_order_id);

create table if not exists public.commerce_refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.commerce_refunds(id) on delete cascade,
  external_line_item_id text,
  external_product_id text,
  quantity integer not null default 1,
  amount numeric(14, 2),
  created_at timestamptz not null default now(),
  constraint commerce_refund_items_quantity_check check (quantity > 0),
  constraint commerce_refund_items_amount_check check (
    amount is null or amount >= 0
  )
);

create index if not exists commerce_refund_items_refund_idx
  on public.commerce_refund_items (refund_id);
create index if not exists commerce_refund_items_product_idx
  on public.commerce_refund_items (external_product_id)
  where external_product_id is not null;

create table if not exists public.ticket_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  occurred_at timestamptz not null default now(),
  constraint ticket_lifecycle_events_type_check check (
    event_type in ('created', 'status_changed', 'resolved', 'reopened', 'escalated')
  )
);

create index if not exists ticket_lifecycle_events_workspace_type_idx
  on public.ticket_lifecycle_events (workspace_id, event_type, occurred_at desc);
create index if not exists ticket_lifecycle_events_thread_idx
  on public.ticket_lifecycle_events (thread_id, occurred_at desc);

create table if not exists public.support_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  reason_category text,
  submitted_at timestamptz not null default now(),
  unique (thread_id)
);

create index if not exists support_feedback_workspace_submitted_idx
  on public.support_feedback (workspace_id, submitted_at desc);

alter table public.commerce_orders enable row level security;
alter table public.commerce_refunds enable row level security;
alter table public.commerce_refund_items enable row level security;
alter table public.ticket_lifecycle_events enable row level security;
alter table public.support_feedback enable row level security;

-- Explicit grants are required for new projects where public-schema tables are
-- no longer exposed to the Data API automatically. The service role writes;
-- authenticated workspace members receive read-only analytics access.
revoke all on public.commerce_orders from anon, authenticated;
revoke all on public.commerce_refunds from anon, authenticated;
revoke all on public.commerce_refund_items from anon, authenticated;
revoke all on public.ticket_lifecycle_events from anon, authenticated;
revoke all on public.support_feedback from anon, authenticated;

grant select on public.commerce_orders to authenticated;
grant select on public.commerce_refunds to authenticated;
grant select on public.commerce_refund_items to authenticated;
grant select on public.ticket_lifecycle_events to authenticated;
grant select on public.support_feedback to authenticated;

grant all on public.commerce_orders to service_role;
grant all on public.commerce_refunds to service_role;
grant all on public.commerce_refund_items to service_role;
grant all on public.ticket_lifecycle_events to service_role;
grant all on public.support_feedback to service_role;

create policy commerce_orders_service_role
  on public.commerce_orders for all to service_role
  using (true) with check (true);
create policy commerce_orders_select_scoped
  on public.commerce_orders for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = commerce_orders.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

create policy commerce_refunds_service_role
  on public.commerce_refunds for all to service_role
  using (true) with check (true);
create policy commerce_refunds_select_scoped
  on public.commerce_refunds for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = commerce_refunds.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

create policy commerce_refund_items_service_role
  on public.commerce_refund_items for all to service_role
  using (true) with check (true);
create policy commerce_refund_items_select_scoped
  on public.commerce_refund_items for select to authenticated
  using (exists (
    select 1
    from public.commerce_refunds cr
    join public.workspace_members wm on wm.workspace_id = cr.workspace_id
    where cr.id = commerce_refund_items.refund_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

create policy ticket_lifecycle_events_service_role
  on public.ticket_lifecycle_events for all to service_role
  using (true) with check (true);
create policy ticket_lifecycle_events_select_scoped
  on public.ticket_lifecycle_events for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ticket_lifecycle_events.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

create policy support_feedback_service_role
  on public.support_feedback for all to service_role
  using (true) with check (true);
create policy support_feedback_select_scoped
  on public.support_feedback for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = support_feedback.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

-- Capture lifecycle transitions centrally so every inbox code path is covered.
-- The trigger function lives outside exposed schemas and cannot be invoked as
-- a public RPC. It stores status facts only; no message or customer content.
create schema if not exists private;

create or replace function private.capture_ticket_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  captured_specific_event boolean := false;
begin
  if new.workspace_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.ticket_lifecycle_events (
      workspace_id, thread_id, event_type, from_status, to_status, occurred_at
    ) values (
      new.workspace_id, new.id, 'created', null, new.status, coalesce(new.created_at, now())
    );
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if lower(coalesce(old.status, '')) in ('resolved', 'solved', 'closed')
    and lower(coalesce(new.status, '')) not in ('resolved', 'solved', 'closed') then
    insert into public.ticket_lifecycle_events (
      workspace_id, thread_id, event_type, from_status, to_status, occurred_at
    ) values (
      new.workspace_id, new.id, 'reopened', old.status, new.status, now()
    );
    captured_specific_event := true;
  end if;

  if lower(coalesce(new.status, '')) in ('resolved', 'solved', 'closed') then
    insert into public.ticket_lifecycle_events (
      workspace_id, thread_id, event_type, from_status, to_status, occurred_at
    ) values (
      new.workspace_id, new.id, 'resolved', old.status, new.status, now()
    );
    captured_specific_event := true;
  end if;

  if lower(coalesce(new.status, '')) = 'blocked'
    and lower(coalesce(old.status, '')) <> 'blocked' then
    insert into public.ticket_lifecycle_events (
      workspace_id, thread_id, event_type, from_status, to_status, occurred_at
    ) values (
      new.workspace_id, new.id, 'escalated', old.status, new.status, now()
    );
    captured_specific_event := true;
  end if;

  if not captured_specific_event then
    insert into public.ticket_lifecycle_events (
      workspace_id, thread_id, event_type, from_status, to_status, occurred_at
    ) values (
      new.workspace_id, new.id, 'status_changed', old.status, new.status, now()
    );
  end if;

  return new;
end;
$$;

revoke all on function private.capture_ticket_lifecycle_event() from public, anon, authenticated;

drop trigger if exists mail_threads_capture_lifecycle on public.mail_threads;
create trigger mail_threads_capture_lifecycle
after insert or update of status on public.mail_threads
for each row execute function private.capture_ticket_lifecycle_event();
