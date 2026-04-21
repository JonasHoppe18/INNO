CREATE TABLE IF NOT EXISTS workspace_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_tags_name_idx
  ON workspace_tags(workspace_id, lower(name));

CREATE INDEX IF NOT EXISTS workspace_tags_workspace_idx
  ON workspace_tags(workspace_id);
