-- Greenfield-only continuity state. This is intentionally separate from the
-- V2 case_state_json column, whose shape and lifecycle belong to V2.
alter table public.mail_threads
  add column if not exists greenfield_conversation_context_json jsonb default null;

comment on column public.mail_threads.greenfield_conversation_context_json is
  'Server-owned compact greenfield support continuity state; live order/shipment facts are never persisted here.';
