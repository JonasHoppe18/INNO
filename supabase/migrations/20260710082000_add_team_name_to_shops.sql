-- Keep the production schema aligned with the application and canonical schema.
-- Several mailbox and sending-identity queries use this optional display name.
alter table public.shops
  add column if not exists team_name text;
