-- Add per-intent auto-send configuration to agent_automation
alter table agent_automation
  add column if not exists auto_send_intents text[] not null default '{}';
