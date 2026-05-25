-- Workspace-level soft blocklist for inbound email senders.

create table if not exists public.workspace_email_blocklist (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  matcher_type text not null check (matcher_type in ('email', 'domain')),
  matcher_value text not null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_email_blocklist_workspace_matcher_unique
  on public.workspace_email_blocklist (workspace_id, matcher_type, lower(btrim(matcher_value)));

create index if not exists workspace_email_blocklist_workspace_active_idx
  on public.workspace_email_blocklist (workspace_id, is_active, updated_at desc);

alter table public.workspace_email_blocklist enable row level security;

drop policy if exists workspace_email_blocklist_select_scoped on public.workspace_email_blocklist;
drop policy if exists workspace_email_blocklist_modify_scoped on public.workspace_email_blocklist;

create policy workspace_email_blocklist_select_scoped
on public.workspace_email_blocklist
for select
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_blocklist.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy workspace_email_blocklist_modify_scoped
on public.workspace_email_blocklist
for all
to authenticated
using (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_blocklist.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  workspace_id is not null
  and exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_blocklist.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
