CREATE TABLE IF NOT EXISTS task_event_log (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  companion_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  session_id TEXT,
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS task_event_log_task_time_idx
  ON task_event_log (task_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS task_event_log_owner_time_idx
  ON task_event_log (user_id, companion_id, occurred_at DESC);
