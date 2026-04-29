-- Add routing_hint to draft_previews for auto/review/block from v2 action-decision stage
ALTER TABLE draft_previews ADD COLUMN IF NOT EXISTS routing_hint TEXT DEFAULT 'review'
  CHECK (routing_hint IN ('auto', 'review', 'block'));
