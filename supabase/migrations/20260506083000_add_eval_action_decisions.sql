ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS action_decision JSONB,
  ADD COLUMN IF NOT EXISTS post_action_reply TEXT,
  ADD COLUMN IF NOT EXISTS post_action_quality JSONB,
  ADD COLUMN IF NOT EXISTS post_action_decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS eval_results_post_action_decided_at_idx
  ON public.eval_results(post_action_decided_at DESC);
