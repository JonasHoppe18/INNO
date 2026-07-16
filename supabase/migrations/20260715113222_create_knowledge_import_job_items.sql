-- PII-free per-job ledger for idempotent Zendesk history imports.
-- One row per external ticket allows retries to skip completed work and lets
-- cursor/job counters be recounted from durable outcomes after interruptions.
create table if not exists public.knowledge_import_job_items (
  job_id uuid not null
    references public.knowledge_import_jobs(id) on delete cascade,
  external_ticket_id text not null,
  outcome text not null
    constraint knowledge_import_job_items_outcome_check
    check (outcome in ('inserted', 'refreshed', 'skipped', 'dropped')),
  reason text,
  processed_at timestamptz not null default now(),
  primary key (job_id, external_ticket_id)
);

comment on table public.knowledge_import_job_items is
  'PII-free per-job Zendesk import ledger used to make retries idempotent and rebuild cursor/job outcome counts.';

comment on column public.knowledge_import_job_items.external_ticket_id is
  'Stable provider ticket identifier; never stores message content.';

comment on column public.knowledge_import_job_items.reason is
  'Optional short outcome reason/code only; must not contain message bodies or other PII.';

comment on column public.knowledge_import_job_items.processed_at is
  'Time the ticket outcome was durably recorded for retry and recount purposes.';

create index if not exists knowledge_import_job_items_job_outcome_idx
  on public.knowledge_import_job_items (job_id, outcome);

-- PostgREST privileges are separate from RLS. The dedicated importer only
-- needs to append immutable outcomes and recount them.
grant select, insert
  on table public.knowledge_import_job_items
  to service_role;

alter table public.knowledge_import_job_items enable row level security;

drop policy if exists knowledge_import_job_items_service_role
  on public.knowledge_import_job_items;

create policy knowledge_import_job_items_service_role
on public.knowledge_import_job_items
for all
to service_role
using (true)
with check (true);
