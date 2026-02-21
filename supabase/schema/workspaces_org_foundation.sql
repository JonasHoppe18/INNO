-- Workspace + Clerk Organization foundation (idempotent)
-- Safe for legacy users without organizations.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text,
  name text,
  created_at timestamptz not null default now()
);

-- clerk_org_id must stay nullable for legacy users.
alter table public.workspaces
  alter column clerk_org_id drop not null;

create unique index if not exists workspaces_clerk_org_id_unique_not_null
  on public.workspaces (clerk_org_id)
  where clerk_org_id is not null;

create table if not exists public.workspace_members (
  workspace_id uuid not null,
  clerk_user_id text not null,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  constraint workspace_members_pkey primary key (workspace_id, clerk_user_id),
  constraint workspace_members_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id)
);

create index if not exists workspace_members_clerk_user_id_idx
  on public.workspace_members (clerk_user_id);

alter table public.shops
  add column if not exists workspace_id uuid;

alter table public.integrations
  add column if not exists workspace_id uuid;

create index if not exists shops_workspace_id_idx
  on public.shops (workspace_id);

create index if not exists integrations_workspace_id_idx
  on public.integrations (workspace_id);

-- Add foreign keys only if they do not exist.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shops_workspace_id_fkey'
  ) then
    alter table public.shops
      add constraint shops_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'integrations_workspace_id_fkey'
  ) then
    alter table public.integrations
      add constraint integrations_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id);
  end if;
end $$;

-- RLS cleanup + stable policies for workspace reads.
alter table public.workspace_members enable row level security;
alter table public.shops enable row level security;

-- Drop all legacy/experimental policies on workspace_members to avoid recursion.
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_members'
  loop
    execute format('drop policy if exists %I on public.workspace_members', p.policyname);
  end loop;
end $$;

create policy workspace_members_select_self
on public.workspace_members
for select
to authenticated
using (
  clerk_user_id = auth.jwt() ->> 'sub'
);

drop policy if exists shops_select_workspace_members on public.shops;

create policy shops_select_workspace_members
on public.shops
for select
to authenticated
using (
  (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = shops.workspace_id
        and wm.clerk_user_id = auth.jwt() ->> 'sub'
    )
  )
  or owner_user_id::text = coalesce(auth.jwt() ->> 'supabase_user_id', '')
);

-- Agent automation should be shared per workspace (when workspace_id is set).
-- Keep one newest row per workspace, then enforce uniqueness for non-null workspace_id.
with ranked as (
  select
    user_id,
    workspace_id,
    row_number() over (
      partition by workspace_id
      order by updated_at desc nulls last, created_at desc nulls last
    ) as rn
  from public.agent_automation
  where workspace_id is not null
)
delete from public.agent_automation a
using ranked r
where a.user_id = r.user_id
  and r.rn > 1;

create unique index if not exists agent_automation_workspace_unique_not_null
  on public.agent_automation (workspace_id)
  where workspace_id is not null;
