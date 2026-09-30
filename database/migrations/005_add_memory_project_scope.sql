ALTER TABLE memories ADD COLUMN IF NOT EXISTS project_id TEXT;

CREATE INDEX IF NOT EXISTS memories_project_scope_idx
  ON memories (user_id, companion_id, project_id, created_at DESC)
  WHERE project_id IS NOT NULL;
