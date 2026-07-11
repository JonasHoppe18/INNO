-- Full-history import: job-level counters for the estimate/progress UI.
alter table public.knowledge_import_jobs
  add column if not exists total_count integer;

comment on column public.knowledge_import_jobs.total_count is
  'Estimated total tickets in scope for this import job (from Zendesk search count at job creation).';

alter table public.knowledge_import_jobs
  add column if not exists dropped_count integer not null default 0;

comment on column public.knowledge_import_jobs.dropped_count is
  'Tickets dropped because PII redaction failed (never stored raw).';
