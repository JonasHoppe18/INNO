-- Do not send CSAT surveys until a workspace explicitly enables them.
-- Existing rows keep their current value; this only changes the default for
-- newly inserted workspace settings rows.
alter table public.workspace_customer_satisfaction_settings
  alter column enabled set default false;
