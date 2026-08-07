-- Keep logo placement predictable across Gmail, Outlook and mobile clients.
alter table public.workspace_customer_satisfaction_settings
  add column if not exists logo_position text not null default 'top-center';

alter table public.workspace_customer_satisfaction_settings
  drop constraint if exists workspace_customer_satisfaction_settings_logo_position_check;

alter table public.workspace_customer_satisfaction_settings
  add constraint workspace_customer_satisfaction_settings_logo_position_check
  check (logo_position in ('top-center', 'top-left', 'footer'));
