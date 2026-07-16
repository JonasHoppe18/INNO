alter table public.knowledge_import_jobs
  add column if not exists updated_count integer not null default 0;

comment on column public.knowledge_import_jobs.updated_count is
  'Existing provider rows refreshed in place during an idempotent import.';
