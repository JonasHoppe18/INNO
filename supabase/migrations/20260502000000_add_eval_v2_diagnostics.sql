ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS proposed_actions JSONB,
  ADD COLUMN IF NOT EXISTS human_reply TEXT,
  ADD COLUMN IF NOT EXISTS zendesk_ticket_id TEXT,
  ADD COLUMN IF NOT EXISTS verifier_confidence FLOAT,
  ADD COLUMN IF NOT EXISTS sources JSONB,
  ADD COLUMN IF NOT EXISTS routing_hint TEXT,
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

CREATE INDEX IF NOT EXISTS eval_results_pipeline_version_idx
  ON eval_results(pipeline_version);

CREATE INDEX IF NOT EXISTS eval_results_zendesk_ticket_id_idx
  ON eval_results(zendesk_ticket_id);
