-- Track when KB entries were last verified against their source
ALTER TABLE agent_knowledge
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT now();

-- Index for finding stale entries efficiently
CREATE INDEX IF NOT EXISTS agent_knowledge_last_verified_idx
  ON agent_knowledge(shop_id, last_verified_at);

-- Backfill: mark all existing entries as verified now
UPDATE agent_knowledge SET last_verified_at = now() WHERE last_verified_at IS NULL;
