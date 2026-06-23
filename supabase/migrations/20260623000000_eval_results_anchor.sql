-- Eval rubric + sample-filtering support.
--
-- Adds anchor classification + judge-flag storage to eval_results so the eval
-- harness can (a) exclude non-comparable action anchors from headline averages
-- and (b) record machine-countable hard-cap failure modes per result.
--
--   anchor_class            comparable | action_required | non_comparable_anchor
--   excluded_from_aggregate true for non_comparable_anchor rows
--   judge_flags             { fabrication, unsupported_availability,
--                             language_mismatch, wrong_direction,
--                             unnecessary_escalation }
--
-- Backward compatible: existing rows default to comparable / not-excluded /
-- null flags, so prior runs aggregate exactly as before.

alter table eval_results
  add column if not exists anchor_class text not null default 'comparable',
  add column if not exists excluded_from_aggregate boolean not null default false,
  add column if not exists judge_flags jsonb;

-- Guard against typos in callers; keep the set closed.
alter table eval_results
  drop constraint if exists eval_results_anchor_class_check;
alter table eval_results
  add constraint eval_results_anchor_class_check
  check (anchor_class in ('comparable', 'action_required', 'non_comparable_anchor'));

-- Fast filtering of the comparable subset for headline aggregates.
create index if not exists eval_results_anchor_class_idx
  on eval_results (anchor_class);
