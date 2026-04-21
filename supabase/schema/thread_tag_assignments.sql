CREATE TABLE IF NOT EXISTS thread_tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES workspace_tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ai', 'manual')),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(thread_id, tag_id)
);

CREATE INDEX IF NOT EXISTS thread_tag_assignments_thread_idx
  ON thread_tag_assignments(thread_id);

CREATE INDEX IF NOT EXISTS thread_tag_assignments_tag_idx
  ON thread_tag_assignments(tag_id);
