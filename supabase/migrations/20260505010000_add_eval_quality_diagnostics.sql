ALTER TABLE public.eval_results
  ADD COLUMN IF NOT EXISTS overall_10 INT CHECK (overall_10 BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS send_ready BOOLEAN,
  ADD COLUMN IF NOT EXISTS primary_gap TEXT,
  ADD COLUMN IF NOT EXISTS missing_for_10 JSONB,
  ADD COLUMN IF NOT EXISTS likely_root_cause TEXT;

CREATE INDEX IF NOT EXISTS eval_results_overall_10_idx
  ON public.eval_results(overall_10);

CREATE INDEX IF NOT EXISTS eval_results_likely_root_cause_idx
  ON public.eval_results(likely_root_cause);
