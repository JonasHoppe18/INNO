-- Extend sender rules with explicit destination type/value so rules can target custom inboxes.

alter table public.workspace_email_sender_rules
  add column if not exists destination_type text,
  add column if not exists destination_value text;

alter table public.workspace_email_sender_rules
  drop constraint if exists workspace_email_sender_rules_destination_type_check;

alter table public.workspace_email_sender_rules
  add constraint workspace_email_sender_rules_destination_type_check
  check (
    destination_type is null
    or destination_type in ('classification', 'inbox')
  );

-- Backfill legacy rows that only had destination_key.
update public.workspace_email_sender_rules
set
  destination_type = coalesce(destination_type, 'classification'),
  destination_value = coalesce(destination_value, lower(btrim(destination_key)))
where destination_type is null or destination_value is null;

-- Ensure destination_value is normalized.
update public.workspace_email_sender_rules
set destination_value = lower(btrim(destination_value))
where destination_value is not null;

create index if not exists workspace_email_sender_rules_workspace_destination_idx
  on public.workspace_email_sender_rules (workspace_id, destination_type, destination_value, is_active, updated_at desc);
