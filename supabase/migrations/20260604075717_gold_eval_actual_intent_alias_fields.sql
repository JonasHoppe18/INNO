-- Phase 2.3: preserve raw and normalized intent labels in gold eval results.
--
-- This is eval-only metadata. actual_intent keeps the normalized label for
-- backwards compatibility with existing reports.

alter table public.gold_eval_results
  add column if not exists actual_intent_raw text;

alter table public.gold_eval_results
  add column if not exists actual_intent_normalized text;
