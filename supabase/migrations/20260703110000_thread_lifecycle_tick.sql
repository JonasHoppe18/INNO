create extension if not exists pg_cron;

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
$$;

-- Re-schedule idempotently
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
