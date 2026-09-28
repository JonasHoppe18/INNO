-- Durable outbound send state is intentionally separate from mail_messages.
-- mail_messages remains reserved for actual conversation messages and normal
-- composer drafts; an uncertain provider outcome must survive draft cleanup,
-- inbound ingestion, and composer deletion.

create table if not exists public.outbound_send_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.mail_accounts(id) on delete restrict,
  thread_id uuid not null references public.mail_threads(id) on delete restrict,
  operation_type text not null,
  provider text not null,
  request_fingerprint text not null,
  state text not null default 'reserved',
  failure_class text,
  provider_message_id text,
  message_id uuid references public.mail_messages(id) on delete set null,
  provider_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_send_attempts_operation_check
    check (operation_type in ('reply', 'forward')),
  constraint outbound_send_attempts_provider_check
    check (provider in ('gmail', 'outlook', 'smtp')),
  constraint outbound_send_attempts_state_check
    check (state in ('reserved', 'sent', 'failed', 'unknown')),
  constraint outbound_send_attempts_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$')
);

-- A workspace-scoped mailbox/thread pair is required. Legacy records with a
-- NULL workspace remain supported only when both parent records are also NULL;
-- those sends are still constrained by the authenticated user in the API.
create or replace function public.validate_outbound_send_attempt_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  mailbox_workspace_id uuid;
  thread_workspace_id uuid;
  message_workspace_id uuid;
  message_thread_id uuid;
  message_mailbox_id uuid;
begin
  select workspace_id
    into mailbox_workspace_id
    from public.mail_accounts
   where id = new.mailbox_id;

  select workspace_id
    into thread_workspace_id
    from public.mail_threads
   where id = new.thread_id;

  if new.message_id is not null then
    select workspace_id, thread_id, mailbox_id
      into message_workspace_id, message_thread_id, message_mailbox_id
      from public.mail_messages
     where id = new.message_id;

    if new.workspace_id is distinct from message_workspace_id
       or new.thread_id is distinct from message_thread_id
       or new.mailbox_id is distinct from message_mailbox_id then
      raise exception 'Outbound send attempt message is outside its mailbox, thread, or workspace';
    end if;
  end if;

  if new.workspace_id is distinct from mailbox_workspace_id
     or new.workspace_id is distinct from thread_workspace_id then
    raise exception 'Outbound send attempt scope does not match its mailbox and thread';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_outbound_send_attempt_scope
  on public.outbound_send_attempts;
create trigger trg_validate_outbound_send_attempt_scope
before insert or update on public.outbound_send_attempts
for each row execute function public.validate_outbound_send_attempt_scope();

create or replace function public.outbound_send_attempts_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_outbound_send_attempts_touch_updated_at
  on public.outbound_send_attempts;
create trigger trg_outbound_send_attempts_touch_updated_at
before update on public.outbound_send_attempts
for each row execute function public.outbound_send_attempts_touch_updated_at();

create index if not exists outbound_send_attempts_thread_state_idx
  on public.outbound_send_attempts (thread_id, state, updated_at desc);

create index if not exists outbound_send_attempts_workspace_created_idx
  on public.outbound_send_attempts (workspace_id, created_at desc);

-- Different client UUIDs for the same unresolved logical request must still
-- converge on one provider invocation. COALESCE keeps legacy NULL-workspace
-- rows inside the same uniqueness domain.
create unique index if not exists outbound_send_attempts_unresolved_fingerprint_idx
  on public.outbound_send_attempts (
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    mailbox_id,
    thread_id,
    operation_type,
    request_fingerprint
  )
  where state in ('reserved', 'unknown')
     or (state = 'sent' and completed_at is null);

alter table public.outbound_send_attempts enable row level security;

drop policy if exists outbound_send_attempts_service_role
  on public.outbound_send_attempts;
create policy outbound_send_attempts_service_role
on public.outbound_send_attempts
for all
to service_role
using (true)
with check (true);

revoke all on table public.outbound_send_attempts from anon, authenticated;
grant all on table public.outbound_send_attempts to service_role;

comment on table public.outbound_send_attempts is
  'Durable provider-send idempotency state; never treated as a conversation message.';

comment on column public.outbound_send_attempts.request_fingerprint is
  'SHA-256 of the immutable outbound request payload; used to detect edits and remount retries.';
