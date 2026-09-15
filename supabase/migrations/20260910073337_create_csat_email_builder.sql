-- CSAT email builder foundation.
-- This migration is intentionally additive. It does not change the existing
-- support_feedback analytics contract or any current email send flow.

create extension if not exists pgcrypto;

create table if not exists public.csat_email_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'CSAT survey email',
  subject text not null default 'How was your support experience?',
  preview_text text not null default '',
  editor_json jsonb not null,
  rendered_html text not null default '',
  rendered_text text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 0 check (version >= 0),
  published_version integer,
  created_by_clerk_user_id text,
  updated_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create table if not exists public.csat_email_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.csat_email_templates(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  subject text not null,
  preview_text text not null default '',
  editor_json jsonb not null,
  rendered_html text not null default '',
  rendered_text text not null default '',
  status text not null default 'archived' check (status in ('published', 'archived')),
  published_by_clerk_user_id text,
  published_at timestamptz not null default now(),
  unique (workspace_id, version)
);

create unique index if not exists csat_email_template_versions_one_published
  on public.csat_email_template_versions (workspace_id)
  where status = 'published';

create index if not exists csat_email_template_versions_workspace_idx
  on public.csat_email_template_versions (workspace_id, version desc);

create table if not exists public.csat_thank_you_configs (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  messages jsonb not null default '{}'::jsonb,
  updated_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.csat_survey_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz,
  consumed_at timestamptz,
  test_mode boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, thread_id)
);

create index if not exists csat_survey_tokens_workspace_idx
  on public.csat_survey_tokens (workspace_id, created_at desc);

alter table public.csat_email_templates enable row level security;
alter table public.csat_email_template_versions enable row level security;
alter table public.csat_thank_you_configs enable row level security;
alter table public.csat_survey_tokens enable row level security;

revoke all on public.csat_email_templates from anon, authenticated;
revoke all on public.csat_email_template_versions from anon, authenticated;
revoke all on public.csat_thank_you_configs from anon, authenticated;
revoke all on public.csat_survey_tokens from anon, authenticated;

grant select on public.csat_email_templates to authenticated;
grant select on public.csat_email_template_versions to authenticated;
grant select on public.csat_thank_you_configs to authenticated;
grant all on public.csat_email_templates to service_role;
grant all on public.csat_email_template_versions to service_role;
grant all on public.csat_thank_you_configs to service_role;
grant all on public.csat_survey_tokens to service_role;

create policy csat_email_templates_service_role
  on public.csat_email_templates for all to service_role
  using (true) with check (true);
create policy csat_email_templates_select_workspace_members
  on public.csat_email_templates for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = csat_email_templates.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

create policy csat_email_template_versions_service_role
  on public.csat_email_template_versions for all to service_role
  using (true) with check (true);
create policy csat_email_template_versions_select_workspace_members
  on public.csat_email_template_versions for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = csat_email_template_versions.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

create policy csat_thank_you_configs_service_role
  on public.csat_thank_you_configs for all to service_role
  using (true) with check (true);
create policy csat_thank_you_configs_select_workspace_members
  on public.csat_thank_you_configs for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = csat_thank_you_configs.workspace_id
      and wm.clerk_user_id = coalesce(auth.jwt() ->> 'sub', '')
  ));

create policy csat_survey_tokens_service_role
  on public.csat_survey_tokens for all to service_role
  using (true) with check (true);
