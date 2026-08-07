-- Choose whether CSAT copy follows the conversation or a workspace fallback.
alter table public.workspace_customer_satisfaction_settings
  add column if not exists language_mode text not null default 'conversation';

alter table public.workspace_customer_satisfaction_settings
  drop constraint if exists workspace_customer_satisfaction_settings_language_mode_check;

alter table public.workspace_customer_satisfaction_settings
  add constraint workspace_customer_satisfaction_settings_language_mode_check
  check (language_mode in ('conversation', 'workspace', 'en'));
