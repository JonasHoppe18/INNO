CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  run_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT,
  model TEXT,
  strong_model TEXT,
  judge_model TEXT,
  pipeline_version TEXT DEFAULT 'legacy',
  total_items INT DEFAULT 0,
  processed_items INT DEFAULT 0,
  error_count INT DEFAULT 0,
  last_error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS eval_runs_shop_id_idx ON eval_runs(shop_id);
CREATE INDEX IF NOT EXISTS eval_runs_status_idx ON eval_runs(status);
CREATE INDEX IF NOT EXISTS eval_runs_created_at_idx ON eval_runs(created_at DESC);
