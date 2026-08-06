-- Preserve the source of automatic closures so CSAT can respect the
-- "Exclude auto-resolved" workspace setting.
create or replace function public.tick_thread_lifecycle()
returns void
language sql
security definer
set search_path = public
as $$
  update public.mail_threads
  set status = 'needs_attention',
      resolution_source = null,
      attention_reason = 'wake_timer',
      wake_at = null,
      status_changed_at = now(),
      updated_at = now()
  where status in ('waiting_customer', 'waiting_third_party')
    and wake_at is not null
    and wake_at <= now();

  update public.mail_threads t
  set status = 'resolved',
      resolution_source = 'auto',
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
      resolution_source = 'auto',
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
