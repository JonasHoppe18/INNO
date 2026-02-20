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
