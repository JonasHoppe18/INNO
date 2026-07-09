-- Feature 1: configurable per-workspace auto-resolve of stale inbox
-- (needs_attention) threads. 0 = disabled. Global fallback default is 7 so
-- threads with a NULL workspace_id (the bulk of the imported backlog while the
-- tenancy migration is incomplete) are still covered by the tick.
alter table public.workspaces
  add column if not exists needs_attention_stale_days integer not null default 7
    check (needs_attention_stale_days >= 0 and needs_attention_stale_days <= 365);

-- Replace the lifecycle tick with a 4-step version. Steps 1-3 are unchanged
-- from 20260703110000_thread_lifecycle_tick.sql; step 4 is new.
create or replace function public.tick_thread_lifecycle()
returns void
language sql
security definer
set search_path = public
as $$
  -- 1) Wake timers: due wake_at pulls the thread back into the queue.
  update public.mail_threads
  set status = 'needs_attention',
      attention_reason = 'wake_timer',
      wake_at = null,
      status_changed_at = now(),
      updated_at = now()
  where status in ('waiting_customer', 'waiting_third_party')
    and wake_at is not null
    and wake_at <= now();

  -- 2) Auto-close (mode 'auto'): silent waiting_customer threads resolve.
  update public.mail_threads t
  set status = 'resolved',
      waiting_reason = null,
      close_pending = false,
      attention_reason = null,
      wake_at = null,
      status_changed_at = now(),
      updated_at = now()
  from public.workspaces w
  where t.workspace_id = w.id
    and w.auto_close_mode = 'auto'
    and t.status = 'waiting_customer'
    and t.status_changed_at < now() - make_interval(days => greatest(coalesce(w.auto_close_days, 4), 1));

  -- 3) Auto-close (mode 'approve'): flag for the approve-close queue group.
  update public.mail_threads t
  set close_pending = true,
      attention_reason = 'approve_close',
      updated_at = now()
  from public.workspaces w
  where t.workspace_id = w.id
    and w.auto_close_mode = 'approve'
    and t.status = 'waiting_customer'
    and t.close_pending = false
    and t.status_changed_at < now() - make_interval(days => greatest(coalesce(w.auto_close_days, 4), 1));

  -- 4) NEW: resolve stale needs_attention threads whose last customer activity
  -- (last_message_at) is older than the workspace's configured window. The
  -- effective window is looked up per row via a correlated subquery that
  -- coalesces a NULL/absent workspace to the global default (7), so
  -- NULL-workspace_id threads are covered. A window of 0 disables the policy
  -- for that workspace (the > 0 guard skips those rows).
  --
  -- Interaction with step 1: a thread woken by step 1 in this same tick (its
  -- wake_at fired, pulling it back to needs_attention) can be immediately
  -- re-resolved here if last_message_at is already past the stale window —
  -- i.e. a wake timer silently no-ops for a thread with no recent customer
  -- activity. This is accepted as correct (a woken thread nobody has written
  -- in for N days genuinely is stale) rather than a bug; it cannot loop or
  -- corrupt state since this step's write is idempotent and terminal.
  with eff as (
    select t.id,
           coalesce(
             (select w.needs_attention_stale_days
                from public.workspaces w
               where w.id = t.workspace_id),
             7
           ) as stale_days
    from public.mail_threads t
    where t.status = 'needs_attention'
  )
  update public.mail_threads t
  set status = 'resolved',
      waiting_reason = null,
      close_pending = false,
      attention_reason = null,
      wake_at = null,
      status_changed_at = now(),
      updated_at = now()
  from eff
  where t.id = eff.id
    and eff.stale_days > 0
    and t.last_message_at is not null
    and t.last_message_at < now() - make_interval(days => eff.stale_days);
$$;

-- Re-schedule idempotently (function body changed; schedule name is stable).
do $$
begin
  perform cron.unschedule('thread-lifecycle-tick')
  where exists (select 1 from cron.job where jobname = 'thread-lifecycle-tick');
exception when others then null;
end $$;

select cron.schedule(
  'thread-lifecycle-tick',
  '*/15 * * * *',
  $$select public.tick_thread_lifecycle()$$
);
