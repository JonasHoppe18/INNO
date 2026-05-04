-- Track whether v2 draft previews are adopted, edited, or rejected by agents.
ALTER TABLE public.draft_previews
  ADD COLUMN IF NOT EXISTS final_sent_text TEXT,
  ADD COLUMN IF NOT EXISTS edit_classification TEXT,
  ADD COLUMN IF NOT EXISTS edit_delta_pct FLOAT,
  ADD COLUMN IF NOT EXISTS adopted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

ALTER TABLE public.draft_previews
  DROP CONSTRAINT IF EXISTS draft_previews_edit_classification_check;

ALTER TABLE public.draft_previews
  ADD CONSTRAINT draft_previews_edit_classification_check
  CHECK (
    edit_classification IS NULL
    OR edit_classification IN ('no_edit', 'minor_edit', 'major_edit')
  );

CREATE INDEX IF NOT EXISTS draft_previews_outcome_created_at_idx
  ON public.draft_previews(outcome, created_at DESC);
