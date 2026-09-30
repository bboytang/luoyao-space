CREATE TABLE IF NOT EXISTS agent_tasks (
  task_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  companion_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  plan JSONB NOT NULL,
  current_step INTEGER NOT NULL,
  requires_approval BOOLEAN NOT NULL,
  approval_status TEXT,
  device_id TEXT,
  execution_context JSONB,
  result JSONB,
  error TEXT,
  version BIGINT NOT NULL DEFAULT 1,
  execution_lease_id TEXT,
  execution_lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_tasks_owner_updated_idx
  ON agent_tasks (user_id, companion_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS agent_tasks_owner_status_idx
  ON agent_tasks (user_id, companion_id, status);

CREATE INDEX IF NOT EXISTS agent_tasks_execution_lease_idx
  ON agent_tasks (status, execution_lease_expires_at)
  WHERE status = 'RUNNING';
