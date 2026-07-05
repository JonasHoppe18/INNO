-- Lifecycle columns on mail_threads
alter table public.mail_threads
  add column if not exists waiting_reason text
    check (waiting_reason in ('customer', 'third_party')),
  add column if not exists wake_at timestamptz,
  add column if not exists close_pending boolean not null default false,
  add column if not exists attention_reason text
    check (attention_reason in ('new', 'customer_replied', 'wake_timer', 'approve_close')),
  add column if not exists status_changed_at timestamptz not null default now();

-- Workspace auto-close configuration
alter table public.workspaces
  add column if not exists auto_close_days integer not null default 4,
  add column if not exists auto_close_mode text not null default 'approve'
    check (auto_close_mode in ('auto', 'approve'));

-- Backfill: normalize legacy status values (case-insensitive)
update public.mail_threads set
  status = case lower(coalesce(status, ''))
    when 'new' then 'needs_attention'
    when 'open' then 'needs_attention'
    when 'pending' then 'waiting_customer'
    when 'waiting' then 'waiting_customer'
    when 'solved' then 'resolved'
    when 'resolved' then 'resolved'
    when 'blocked' then 'blocked'
    when 'needs_attention' then 'needs_attention'
    when 'waiting_customer' then 'waiting_customer'
    when 'waiting_third_party' then 'waiting_third_party'
    else 'needs_attention'
  end,
  waiting_reason = case lower(coalesce(status, ''))
    when 'pending' then 'customer'
    when 'waiting' then 'customer'
    else waiting_reason
  end,
  attention_reason = case lower(coalesce(status, ''))
    when 'new' then 'new'
    when 'open' then 'customer_replied'
    else attention_reason
  end;

-- Stale-thread archival: a legacy open/new thread that's already been read
-- and hasn't seen any activity in 30+ days is dead weight, not real queue
-- work — surfacing it as needs_attention would flood day-one production
-- queues with abandoned threads instead of giving teams an honest inbox
-- zero. Archive these to resolved instead. Never destructive: the thread
-- stays visible under Resolved/View all, and a customer reply reopens it to
-- needs_attention via the normal reopen transition (statusOnInboundCustomerMessage).
-- Scoped to unread_count = 0 (never touches a thread still carrying an
-- unread customer message) and only threads this migration itself just
-- classified as needs_attention (so canonical waiting/resolved/blocked
-- threads are untouched).
update public.mail_threads
set
  status = 'resolved',
  attention_reason = null,
  waiting_reason = null,
  close_pending = false
where
  status = 'needs_attention'
  and coalesce(unread_count, 0) = 0
  and last_message_at is not null
  and last_message_at < now() - interval '30 days';

-- Queue count performance: partial index on the hot query
create index if not exists mail_threads_needs_attention_idx
  on public.mail_threads (workspace_id, mailbox_id)
  where status = 'needs_attention' or close_pending = true;

create index if not exists mail_threads_wake_at_idx
  on public.mail_threads (wake_at)
  where wake_at is not null;

-- ---------------------------------------------------------------------------
-- Post-merge verification (do NOT run against prod during this branch's dev
-- session — run this manually after the migration has been applied):
--
--   select status, count(*) from public.mail_threads group by status order by 2 desc;
--
-- Expected: only these five values appear —
--   needs_attention, waiting_customer, waiting_third_party, resolved, blocked
-- ---------------------------------------------------------------------------
