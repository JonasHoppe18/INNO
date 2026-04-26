create table if not exists public.workspace_member_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  thread_id uuid references public.mail_threads(id) on delete cascade,
  message_id uuid references public.mail_messages(id) on delete cascade,
  kind text not null default 'internal_note_mention',
  title text,
  body text,
  is_read boolean not null default false,
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint workspace_member_notifications_kind_check
    check (kind in ('internal_note_mention')),
  constraint workspace_member_notifications_unique
    unique (recipient_user_id, message_id, kind)
);

create index if not exists workspace_member_notifications_recipient_idx
  on public.workspace_member_notifications(recipient_user_id, is_read, created_at desc);

create index if not exists workspace_member_notifications_workspace_idx
  on public.workspace_member_notifications(workspace_id, created_at desc);

create index if not exists workspace_member_notifications_thread_idx
  on public.workspace_member_notifications(thread_id, created_at desc);
