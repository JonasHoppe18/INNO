-- Edit tracking columns for the drafts table.
-- Run this once against Supabase (SQL editor or supabase db push).

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS ai_draft_text       text,
  ADD COLUMN IF NOT EXISTS final_sent_text     text,
  ADD COLUMN IF NOT EXISTS edit_distance       integer,
  ADD COLUMN IF NOT EXISTS edit_delta_pct      numeric,
  ADD COLUMN IF NOT EXISTS edit_classification text
    CHECK (edit_classification IN ('no_edit', 'minor_edit', 'major_edit')),
  ADD COLUMN IF NOT EXISTS ticket_category     text;
