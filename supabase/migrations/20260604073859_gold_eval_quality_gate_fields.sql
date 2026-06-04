-- Phase 2.2: manual quality-gate fields for gold eval cases.
--
-- These fields record the human pre-import benchmark review verdict. They are
-- eval-only metadata and do not affect customer-facing behavior.

alter table public.gold_eval_cases
  add column if not exists benchmark_status text;

alter table public.gold_eval_cases
  add column if not exists manual_reviewed boolean not null default false;

alter table public.gold_eval_cases
  add column if not exists review_notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gold_eval_cases_benchmark_status_check'
  ) then
    alter table public.gold_eval_cases
      add constraint gold_eval_cases_benchmark_status_check
      check (
        benchmark_status is null
        or benchmark_status in ('READY_FULL', 'READY_PARTIAL', 'NEEDS_REVIEW', 'EXCLUDE')
      );
  end if;
end$$;
