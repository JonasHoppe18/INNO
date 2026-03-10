create extension if not exists pgcrypto;

create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  content text not null,
  category text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_replies_workspace_idx
  on public.saved_replies (workspace_id);

create index if not exists saved_replies_workspace_active_idx
  on public.saved_replies (workspace_id, is_active);

create index if not exists saved_replies_workspace_sort_idx
  on public.saved_replies (workspace_id, sort_order, created_at);

alter table public.saved_replies enable row level security;

drop policy if exists saved_replies_select_scoped on public.saved_replies;
drop policy if exists saved_replies_modify_scoped on public.saved_replies;

create policy saved_replies_select_scoped
on public.saved_replies
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = saved_replies.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);

create policy saved_replies_modify_scoped
on public.saved_replies
for all
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = saved_replies.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
)
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = saved_replies.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  )
);
