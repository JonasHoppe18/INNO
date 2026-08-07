-- Keep logo sizing as a small, predictable brand setting for CSAT emails.
alter table public.workspace_customer_satisfaction_settings
  add column if not exists logo_size text not null default 'medium';

alter table public.workspace_customer_satisfaction_settings
  drop constraint if exists workspace_customer_satisfaction_settings_logo_size_check;

alter table public.workspace_customer_satisfaction_settings
  add constraint workspace_customer_satisfaction_settings_logo_size_check
  check (logo_size in ('small', 'medium', 'large'));
