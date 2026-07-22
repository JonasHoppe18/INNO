-- Tie every new eval result to its worker job and make one result per input
-- item a database invariant. Recovery/browser workers may overlap, so
-- application-level checks alone cannot prevent duplicate rows.

alter table public.eval_results
  add column if not exists eval_run_id uuid references public.eval_runs(id) on delete cascade,
  add column if not exists source_item_key text;

create index if not exists eval_results_eval_run_id_idx
  on public.eval_results (eval_run_id, created_at);

-- PostgreSQL permits multiple NULL pairs, so historical rows remain valid while
-- all new worker rows (which set both values) are strictly idempotent.
create unique index if not exists eval_results_run_item_unique
  on public.eval_results (eval_run_id, source_item_key);
