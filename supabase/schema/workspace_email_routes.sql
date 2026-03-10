-- Lightweight inbound email routing config per workspace.

create table if not exists public.workspace_email_routes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category_key text not null,
  label text not null,
  forward_to_email text,
  mode text not null default 'manual_approval' check (mode in ('manual_approval', 'auto_forward')),
  is_active boolean not null default false,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_email_routes_workspace_category_unique unique (workspace_id, category_key)
);

create index if not exists workspace_email_routes_workspace_idx
  on public.workspace_email_routes (workspace_id, sort_order asc, created_at desc);

alter table public.mail_threads
  add column if not exists classification_key text,
  add column if not exists classification_confidence numeric,
  add column if not exists classification_reason text;

alter table public.mail_threads
  drop constraint if exists mail_threads_classification_key_check;

alter table public.mail_threads
  add constraint mail_threads_classification_key_check
  check (
    classification_key is null
    or length(btrim(classification_key)) > 0
  );

create index if not exists mail_threads_workspace_classification_idx
  on public.mail_threads (workspace_id, classification_key, updated_at desc);

alter table public.workspace_email_routes enable row level security;

drop policy if exists workspace_email_routes_select_scoped on public.workspace_email_routes;
drop policy if exists workspace_email_routes_modify_scoped on public.workspace_email_routes;

create policy workspace_email_routes_select_scoped
on public.workspace_email_routes
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_routes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy workspace_email_routes_modify_scoped
on public.workspace_email_routes
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_routes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_routes.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
