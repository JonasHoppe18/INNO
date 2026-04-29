-- Add routing_hint and is_test_mode to draft_previews
-- routing_hint: auto/review/block from v2 action-decision (after automation flag gates)
-- is_test_mode: true when workspace is in test_mode (actions shown but never executed in Shopify)
ALTER TABLE draft_previews ADD COLUMN IF NOT EXISTS routing_hint TEXT DEFAULT 'review'
  CHECK (routing_hint IN ('auto', 'review', 'block'));

ALTER TABLE draft_previews ADD COLUMN IF NOT EXISTS is_test_mode BOOLEAN DEFAULT false;
