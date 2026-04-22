ALTER TABLE workspace_tags
  ADD COLUMN IF NOT EXISTS ai_prompt TEXT;
