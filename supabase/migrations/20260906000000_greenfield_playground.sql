-- Greenfield internal playground storage only.
-- This is intentionally separate from mail_threads, mail_messages, drafts,
-- draft_generations, and all production support conversation state.

create extension if not exists pgcrypto;

create table if not exists public.greenfield_playground_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_clerk_user_id text not null,
  customer_email text,
  title text not null default 'New conversation',
  conversation_context_json jsonb default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.greenfield_playground_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.greenfield_playground_sessions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_clerk_user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  trace_json jsonb default null,
  created_at timestamptz not null default now()
);

create index if not exists greenfield_playground_sessions_scope_idx
  on public.greenfield_playground_sessions (workspace_id, owner_clerk_user_id, updated_at desc);
create index if not exists greenfield_playground_messages_session_idx
  on public.greenfield_playground_messages (session_id, created_at asc);

create or replace function public.greenfield_playground_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_greenfield_playground_sessions_updated_at
  on public.greenfield_playground_sessions;
create trigger trg_greenfield_playground_sessions_updated_at
before update on public.greenfield_playground_sessions
for each row execute function public.greenfield_playground_touch_updated_at();

alter table public.greenfield_playground_sessions enable row level security;
alter table public.greenfield_playground_messages enable row level security;

drop policy if exists greenfield_playground_sessions_service_role on public.greenfield_playground_sessions;
create policy greenfield_playground_sessions_service_role on public.greenfield_playground_sessions
  for all to service_role using (true) with check (workspace_id is not null);
drop policy if exists greenfield_playground_sessions_scoped_read on public.greenfield_playground_sessions;
create policy greenfield_playground_sessions_scoped_read on public.greenfield_playground_sessions
  for select to authenticated using (
    owner_clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = greenfield_playground_sessions.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  );

drop policy if exists greenfield_playground_messages_service_role on public.greenfield_playground_messages;
create policy greenfield_playground_messages_service_role on public.greenfield_playground_messages
  for all to service_role using (true) with check (workspace_id is not null);
drop policy if exists greenfield_playground_messages_scoped_read on public.greenfield_playground_messages;
create policy greenfield_playground_messages_scoped_read on public.greenfield_playground_messages
  for select to authenticated using (
    owner_clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = greenfield_playground_messages.workspace_id
        and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
    )
  );

comment on table public.greenfield_playground_sessions is
  'Internal greenfield support-agent playground sessions; never customer mail or production conversation state.';
comment on table public.greenfield_playground_messages is
  'Internal greenfield playground messages and sanitized traces; never written to mail_messages.';
