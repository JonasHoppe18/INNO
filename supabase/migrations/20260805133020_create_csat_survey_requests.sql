-- CSAT invitations are opaque, one-time links. The raw token is never stored;
-- the app derives it from the workspace/thread pair and a server-side secret.
alter table public.mail_threads
  add column if not exists resolution_source text;

alter table public.support_feedback
  add column if not exists survey_request_id uuid;

create table if not exists public.csat_survey_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'pending' check (
    status in ('pending', 'sending', 'sent', 'responded', 'skipped', 'failed')
  ),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  responded_at timestamptz,
  delivery_provider text,
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint csat_survey_requests_thread_unique unique (thread_id)
);

alter table public.support_feedback
  drop constraint if exists support_feedback_survey_request_id_fkey;
alter table public.support_feedback
  add constraint support_feedback_survey_request_id_fkey
  foreign key (survey_request_id) references public.csat_survey_requests(id) on delete set null;

create index if not exists csat_survey_requests_dispatch_idx
  on public.csat_survey_requests (status, scheduled_for)
  where status in ('pending', 'failed');
create index if not exists csat_survey_requests_workspace_idx
  on public.csat_survey_requests (workspace_id, created_at desc);

alter table public.csat_survey_requests enable row level security;

revoke all on public.csat_survey_requests from anon, authenticated;
grant select on public.csat_survey_requests to authenticated;
grant all on public.csat_survey_requests to service_role;

drop policy if exists csat_survey_requests_service_role on public.csat_survey_requests;
create policy csat_survey_requests_service_role
  on public.csat_survey_requests
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists csat_survey_requests_select_scoped on public.csat_survey_requests;
create policy csat_survey_requests_select_scoped
  on public.csat_survey_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members membership
      where membership.workspace_id = csat_survey_requests.workspace_id
        and membership.clerk_user_id = ((select auth.jwt()) ->> 'sub')
    )
  );
