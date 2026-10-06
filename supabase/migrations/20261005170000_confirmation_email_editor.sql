-- Editor drafts are separate from the configuration used by inbound delivery.
create table public.confirmation_email_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid references public.mail_accounts(id) on delete cascade,
  scope_key text generated always as (coalesce(mailbox_id::text, 'workspace')) stored,
  name text not null default 'Customer confirmation',
  subject text not null,
  preview_text text not null default '',
  editor_json jsonb not null,
  status text not null default 'draft' check (status in ('draft','published')),
  version integer not null default 0,
  published_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, scope_key)
);
alter table public.confirmation_email_drafts enable row level security;
revoke all on public.confirmation_email_drafts from anon, authenticated;
grant all on public.confirmation_email_drafts to service_role;

-- Publishing is atomic; it preserves enablement, ticket references and cooldowns.
create function public.publish_confirmation_email(
  p_workspace_id uuid, p_draft_id uuid, p_expected_updated_at timestamptz,
  p_subject text, p_body_text text, p_html_layout text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  draft public.confirmation_email_drafts%rowtype;
  setting public.mail_auto_reply_settings%rowtype;
  inherited public.mail_auto_reply_settings%rowtype;
  target_template_id uuid;
  timestamp_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,0));
  select * into draft from public.confirmation_email_drafts
    where id=p_draft_id and workspace_id=p_workspace_id for update;
  if draft.id is null then raise exception 'Confirmation draft not found'; end if;
  if draft.updated_at is distinct from p_expected_updated_at then
    raise exception 'The draft changed while publishing. Save and publish again';
  end if;
  if draft.mailbox_id is not null and not exists (
    select 1 from public.mail_accounts where id=draft.mailbox_id and workspace_id=p_workspace_id
  ) then raise exception 'Mailbox not found in this workspace'; end if;
  select * into setting from public.mail_auto_reply_settings
    where workspace_id=p_workspace_id and mailbox_id is not distinct from draft.mailbox_id for update;
  select * into inherited from public.mail_auto_reply_settings
    where workspace_id=p_workspace_id and mailbox_id is null;
  target_template_id := setting.template_id;
  -- Shared templates need a copy before one scope can publish its own design.
  if target_template_id is not null and exists (
    select 1 from public.mail_auto_reply_settings other
    where other.workspace_id=p_workspace_id and other.template_id=target_template_id
      and other.mailbox_id is distinct from draft.mailbox_id
  ) then target_template_id := null; end if;
  if target_template_id is null then
    insert into public.mail_auto_reply_templates(workspace_id,name,html_layout,plain_text_fallback)
      values(p_workspace_id,draft.name,p_html_layout,p_body_text) returning id into target_template_id;
  else
    update public.mail_auto_reply_templates set name=draft.name,html_layout=p_html_layout,
      plain_text_fallback=p_body_text,updated_at=timestamp_now
      where id=target_template_id and workspace_id=p_workspace_id;
    if not found then raise exception 'Confirmation template not found'; end if;
  end if;
  if setting.id is null then
    insert into public.mail_auto_reply_settings(workspace_id,mailbox_id,enabled,include_ticket_number,
      subject_template,body_text_template,body_html_template,template_id)
      values(p_workspace_id,draft.mailbox_id,coalesce(inherited.enabled,false),
        coalesce(inherited.include_ticket_number,true),p_subject,p_body_text,'',target_template_id);
  else
    update public.mail_auto_reply_settings set subject_template=p_subject,body_text_template=p_body_text,
      body_html_template='',template_id=target_template_id,updated_at=timestamp_now
      where id=setting.id and workspace_id=p_workspace_id;
  end if;
  update public.confirmation_email_drafts set status='published',version=version+1,
    published_version=version+1,updated_at=timestamp_now where id=draft.id returning * into draft;
  return to_jsonb(draft);
end;
$$;
revoke all on function public.publish_confirmation_email(uuid,uuid,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.publish_confirmation_email(uuid,uuid,timestamptz,text,text,text) to service_role;
