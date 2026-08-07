-- Allow workspaces to choose a custom CSAT delay while keeping the presets backwards compatible.
alter table public.workspace_customer_satisfaction_settings
  add column if not exists send_delay_minutes integer;

alter table public.workspace_customer_satisfaction_settings
  drop constraint if exists workspace_customer_satisfaction_settings_send_delay_check;

alter table public.workspace_customer_satisfaction_settings
  add constraint workspace_customer_satisfaction_settings_send_delay_check
  check (
    send_delay in ('immediately', '1h', '24h', 'custom')
    and (
      (send_delay = 'custom' and send_delay_minutes between 5 and 10080)
      or (send_delay <> 'custom' and send_delay_minutes is null)
    )
  );
