create table if not exists public.tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tracking_number text not null,
  normalized_tracking_number text not null,
  carrier text,
  tracking_url text,
  direction text not null default 'unknown'
    check (direction in ('outbound', 'return', 'unknown')),
  status text not null default 'unknown'
    check (status in (
      'pending',
      'label_created',
      'in_transit',
      'out_for_delivery',
      'pickup_ready',
      'delivered',
      'returned_to_sender',
      'exception',
      'lookup_error',
      'unknown'
    )),
  status_text text,
  tracking_snapshot jsonb not null default '{}'::jsonb,
  lookup_source text,
  lookup_detail text,
  last_checked_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracking_snapshots_workspace_tracking_unique
    unique (workspace_id, normalized_tracking_number)
);

create index if not exists tracking_snapshots_workspace_status_idx
  on public.tracking_snapshots (workspace_id, status, last_checked_at desc);

create index if not exists tracking_snapshots_workspace_checked_idx
  on public.tracking_snapshots (workspace_id, last_checked_at desc);

create or replace function public.tracking_snapshots_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tracking_snapshots_touch_updated_at
  on public.tracking_snapshots;

create trigger trg_tracking_snapshots_touch_updated_at
before update on public.tracking_snapshots
for each row
execute function public.tracking_snapshots_touch_updated_at();

alter table public.tracking_snapshots enable row level security;

drop policy if exists tracking_snapshots_service_role
  on public.tracking_snapshots;
drop policy if exists tracking_snapshots_select_scoped
  on public.tracking_snapshots;
drop policy if exists tracking_snapshots_modify_scoped
  on public.tracking_snapshots;

create policy tracking_snapshots_service_role
on public.tracking_snapshots
for all
to service_role
using (true)
with check (true);

create policy tracking_snapshots_select_scoped
on public.tracking_snapshots
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = tracking_snapshots.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy tracking_snapshots_modify_scoped
on public.tracking_snapshots
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = tracking_snapshots.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = tracking_snapshots.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
