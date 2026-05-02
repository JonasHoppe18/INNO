CREATE TABLE IF NOT EXISTS eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  thread_id UUID,
  run_label TEXT NOT NULL,
  model TEXT NOT NULL,
  ticket_subject TEXT,
  ticket_body TEXT,
  draft_content TEXT,
  pipeline_version TEXT DEFAULT 'legacy',
  proposed_actions JSONB,
  human_reply TEXT,
  zendesk_ticket_id TEXT,
  verifier_confidence FLOAT,
  sources JSONB,
  routing_hint TEXT,
  latency_ms INTEGER,
  correctness INT CHECK (correctness BETWEEN 1 AND 5),
  completeness INT CHECK (completeness BETWEEN 1 AND 5),
  tone INT CHECK (tone BETWEEN 1 AND 5),
  actionability INT CHECK (actionability BETWEEN 1 AND 5),
  overall INT CHECK (overall BETWEEN 1 AND 5),
  reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eval_results_shop_id_idx ON eval_results(shop_id);
CREATE INDEX IF NOT EXISTS eval_results_run_label_idx ON eval_results(run_label);
CREATE INDEX IF NOT EXISTS eval_results_created_at_idx ON eval_results(created_at DESC);
CREATE INDEX IF NOT EXISTS eval_results_pipeline_version_idx ON eval_results(pipeline_version);
CREATE INDEX IF NOT EXISTS eval_results_zendesk_ticket_id_idx ON eval_results(zendesk_ticket_id);
