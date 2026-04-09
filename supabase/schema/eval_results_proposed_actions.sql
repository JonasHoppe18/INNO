ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS proposed_actions JSONB;
