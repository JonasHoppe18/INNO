-- Structured return settings + return cases (workspace scoped)

create table if not exists public.workspace_return_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  return_window_days integer not null default 30,
  return_shipping_mode text not null default 'customer_paid'
    check (return_shipping_mode in ('customer_paid', 'merchant_label', 'pre_printed')),
  return_address text,
  require_original_packaging boolean not null default true,
  require_unused boolean not null default true,
  exchange_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.return_cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid references public.mail_threads(id) on delete set null,
  shopify_order_id text,
  customer_email text,
  reason text,
  status text not null default 'requested'
    check (status in ('requested', 'instructions_sent', 'awaiting_return', 'received', 'refunded', 'rejected')),
  return_shipping_mode text not null default 'customer_paid'
    check (return_shipping_mode in ('customer_paid', 'merchant_label', 'pre_printed')),
  is_eligible boolean,
  eligibility_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists return_cases_workspace_thread_idx
  on public.return_cases (workspace_id, thread_id, updated_at desc);

create index if not exists return_cases_workspace_status_idx
  on public.return_cases (workspace_id, status, updated_at desc);

create table if not exists public.return_case_items (
  id uuid primary key default gen_random_uuid(),
  return_case_id uuid not null references public.return_cases(id) on delete cascade,
  shopify_line_item_id text,
  quantity integer not null default 1,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists return_case_items_case_idx
  on public.return_case_items (return_case_id, created_at desc);

alter table public.workspace_return_settings enable row level security;
alter table public.return_cases enable row level security;
alter table public.return_case_items enable row level security;

drop policy if exists workspace_return_settings_select_scoped on public.workspace_return_settings;
drop policy if exists workspace_return_settings_modify_scoped on public.workspace_return_settings;

create policy workspace_return_settings_select_scoped
on public.workspace_return_settings
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_return_settings.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy workspace_return_settings_modify_scoped
on public.workspace_return_settings
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_return_settings.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_return_settings.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

drop policy if exists return_cases_select_scoped on public.return_cases;
drop policy if exists return_cases_modify_scoped on public.return_cases;

create policy return_cases_select_scoped
on public.return_cases
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = return_cases.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy return_cases_modify_scoped
on public.return_cases
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = return_cases.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = return_cases.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

drop policy if exists return_case_items_select_scoped on public.return_case_items;
drop policy if exists return_case_items_modify_scoped on public.return_case_items;

create policy return_case_items_select_scoped
on public.return_case_items
for select
to authenticated
using (
  exists (
    select 1
    from public.return_cases rc
    join public.workspace_members wm on wm.workspace_id = rc.workspace_id
    where rc.id = return_case_items.return_case_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy return_case_items_modify_scoped
on public.return_case_items
for all
to authenticated
using (
  exists (
    select 1
    from public.return_cases rc
    join public.workspace_members wm on wm.workspace_id = rc.workspace_id
    where rc.id = return_case_items.return_case_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  exists (
    select 1
    from public.return_cases rc
    join public.workspace_members wm on wm.workspace_id = rc.workspace_id
    where rc.id = return_case_items.return_case_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
