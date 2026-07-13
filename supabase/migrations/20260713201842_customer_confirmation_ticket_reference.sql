-- Customer confirmations are workspace-owned and may be overridden per mailbox.
-- Keep trigger_mode/cooldown_minutes during this compatibility rollout so the
-- previously deployed edge function can continue reading the rows.

alter table public.mail_auto_reply_settings
  add column if not exists include_ticket_number boolean not null default true;

update public.mail_auto_reply_settings
set trigger_mode = 'first_inbound_per_thread',
    include_ticket_number = true;

alter table public.mail_auto_reply_settings
  alter column enabled set default false,
  alter column trigger_mode set default 'first_inbound_per_thread',
  alter column subject_template set default 'We''ve received your message',
  alter column body_text_template set default E'Hi {{customer_first_name}},\n\nThanks for contacting us. We''ve received your message and our support team will get back to you as soon as possible. You can reply directly to this email if you would like to add more information.\n\nBest,\n{{team_name}}';

-- Workspace-owned settings/templates no longer need a legacy auth.users owner.
-- Some environments have already removed this compatibility column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mail_auto_reply_settings'
      and column_name = 'user_id'
  ) then
    alter table public.mail_auto_reply_settings alter column user_id drop not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mail_auto_reply_templates'
      and column_name = 'user_id'
  ) then
    alter table public.mail_auto_reply_templates alter column user_id drop not null;
  end if;
end
$$;

-- Retain only the newest row for each effective scope before enforcing the
-- workspace-default / mailbox-override invariants.
with ranked as (
  select id,
         first_value(id) over (
           partition by workspace_id, mailbox_id
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) as keeper_id,
         row_number() over (
           partition by workspace_id, mailbox_id
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) as row_rank
  from public.mail_auto_reply_settings
  where workspace_id is not null
), duplicates as (
  select id, keeper_id from ranked where row_rank > 1
)
update public.mail_auto_reply_events events
set rule_id = duplicates.keeper_id
from duplicates
where events.rule_id = duplicates.id;

with ranked as (
  select id,
         row_number() over (
           partition by workspace_id, mailbox_id
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) as row_rank
  from public.mail_auto_reply_settings
  where workspace_id is not null
)
delete from public.mail_auto_reply_settings settings
using ranked
where settings.id = ranked.id and ranked.row_rank > 1;

create unique index if not exists mail_auto_reply_settings_workspace_default_uidx
  on public.mail_auto_reply_settings (workspace_id)
  where workspace_id is not null and mailbox_id is null;

create unique index if not exists mail_auto_reply_settings_workspace_mailbox_uidx
  on public.mail_auto_reply_settings (workspace_id, mailbox_id)
  where workspace_id is not null and mailbox_id is not null;

create index if not exists mail_auto_reply_settings_workspace_lookup_idx
  on public.mail_auto_reply_settings (workspace_id, mailbox_id, updated_at desc);

create index if not exists mail_auto_reply_templates_workspace_lookup_idx
  on public.mail_auto_reply_templates (workspace_id, updated_at desc);

create index if not exists mail_auto_reply_events_workspace_thread_idx
  on public.mail_auto_reply_events (workspace_id, thread_id, sent_at desc);

alter table public.mail_auto_reply_settings enable row level security;
alter table public.mail_auto_reply_templates enable row level security;
alter table public.mail_auto_reply_events enable row level security;

-- Remove legacy user-owned policies. Postgres combines permissive policies
-- with OR, so leaving one in place could bypass workspace isolation.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'mail_auto_reply_settings',
        'mail_auto_reply_templates',
        'mail_auto_reply_events'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

drop policy if exists "mail_auto_reply_settings_select_workspace_members"
  on public.mail_auto_reply_settings;
create policy "mail_auto_reply_settings_select_workspace_members"
  on public.mail_auto_reply_settings
  for select
  to authenticated
  using (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = mail_auto_reply_settings.workspace_id
        and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
    )
  );

drop policy if exists "mail_auto_reply_templates_select_workspace_members"
  on public.mail_auto_reply_templates;
create policy "mail_auto_reply_templates_select_workspace_members"
  on public.mail_auto_reply_templates
  for select
  to authenticated
  using (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = mail_auto_reply_templates.workspace_id
        and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
    )
  );

drop policy if exists "mail_auto_reply_events_select_workspace_members"
  on public.mail_auto_reply_events;
create policy "mail_auto_reply_events_select_workspace_members"
  on public.mail_auto_reply_events
  for select
  to authenticated
  using (
    workspace_id is not null
    and exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = mail_auto_reply_events.workspace_id
        and membership.clerk_user_id = (select auth.jwt() ->> 'sub')
    )
  );

comment on column public.mail_auto_reply_settings.include_ticket_number is
  'When true, customer confirmations receive a system-controlled [T-N] subject prefix and Ticket reference footer.';

comment on column public.mail_auto_reply_settings.trigger_mode is
  'Deprecated compatibility field. Runtime behavior is permanently first inbound on a newly created support ticket.';

comment on column public.mail_auto_reply_settings.cooldown_minutes is
  'Deprecated compatibility field. Customer confirmations are emitted at most once, when the support ticket is created.';
