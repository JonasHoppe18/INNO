create table if not exists public.return_tracking_shipments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete set null,
  mail_thread_id uuid not null references public.mail_threads(id) on delete cascade,
  source_message_id uuid references public.mail_messages(id) on delete set null,
  return_case_id uuid references public.return_cases(id) on delete set null,
  customer_email text,
  customer_name text,
  order_number text,
  shopify_order_id text,
  tracking_number text not null,
  normalized_tracking_number text not null,
  carrier text,
  status text not null default 'return_tracking_pending'
    check (status in (
      'return_tracking_pending',
      'return_in_transit',
      'return_delivered',
      'return_exception',
      'refund_pending',
      'refund_completed',
      'unknown'
    )),
  source text not null default 'customer_message'
    check (source in ('customer_message')),
  verification text not null default 'unverified'
    check (verification in ('unverified')),
  detected_context text,
  suggested_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint return_tracking_shipments_workspace_tracking_unique
    unique (workspace_id, normalized_tracking_number)
);

create index if not exists return_tracking_shipments_workspace_status_idx
  on public.return_tracking_shipments (workspace_id, status, updated_at desc);

create index if not exists return_tracking_shipments_thread_idx
  on public.return_tracking_shipments (mail_thread_id, updated_at desc);

create index if not exists return_tracking_shipments_return_case_idx
  on public.return_tracking_shipments (return_case_id, updated_at desc)
  where return_case_id is not null;

create index if not exists return_tracking_shipments_shop_tracking_idx
  on public.return_tracking_shipments (shop_id, normalized_tracking_number)
  where shop_id is not null;

create or replace function public.return_tracking_shipments_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_return_tracking_shipments_touch_updated_at
  on public.return_tracking_shipments;

create trigger trg_return_tracking_shipments_touch_updated_at
before update on public.return_tracking_shipments
for each row
execute function public.return_tracking_shipments_touch_updated_at();

alter table public.return_tracking_shipments enable row level security;

drop policy if exists return_tracking_shipments_service_role
  on public.return_tracking_shipments;
drop policy if exists return_tracking_shipments_select_scoped
  on public.return_tracking_shipments;
drop policy if exists return_tracking_shipments_modify_scoped
  on public.return_tracking_shipments;

create policy return_tracking_shipments_service_role
on public.return_tracking_shipments
for all
to service_role
using (true)
with check (true);

create policy return_tracking_shipments_select_scoped
on public.return_tracking_shipments
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = return_tracking_shipments.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy return_tracking_shipments_modify_scoped
on public.return_tracking_shipments
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = return_tracking_shipments.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = return_tracking_shipments.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
