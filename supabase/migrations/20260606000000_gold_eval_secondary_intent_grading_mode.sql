-- Phase 2.1: additive corrections to the gold-eval foundation.
--
-- Adds two columns the AceZone seed needs, without touching existing data or any
-- production behavior:
--   - secondary_intents : the non-primary operational needs in a single message
--     (e.g. a refund_request that also carries an exchange_request fallback). Kept
--     separate from expected_intent so intent grading stays single-label.
--   - grading_mode      : whether a case can be graded on message content alone
--     ('content_only') or also needs anonymized order context before facts/action
--     can be graded ('order_context_required'). Until enrichment lands, the latter
--     cases are still useful for intent + retrieval grading.
--
-- gold_knowledge_chunk_ids is intentionally left as jsonb. agent_knowledge.id is a
-- BIGINT, so chunk ids are stored as JSON numbers (e.g. [3758, 3964]) — NOT uuids.
-- jsonb stores them losslessly; there is no uuid cast anywhere in this path. The
-- runner compares ids as normalized strings (String(id)) so number/string JSON
-- shapes match identically and JS never has to hold a bigint as a float.

alter table public.gold_eval_cases
  add column if not exists secondary_intents jsonb not null default '[]'::jsonb;

alter table public.gold_eval_cases
  add column if not exists grading_mode text not null default 'content_only';

-- Constrain grading_mode to the two supported modes. Guard the add so the
-- migration is idempotent across re-runs.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gold_eval_cases_grading_mode_check'
  ) then
    alter table public.gold_eval_cases
      add constraint gold_eval_cases_grading_mode_check
      check (grading_mode in ('content_only', 'order_context_required'));
  end if;
end$$;
