CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  companion_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'PENDING',
      'PLANNING',
      'WAITING_APPROVAL',
      'RUNNING',
      'WAITING_USER',
      'COMPLETED',
      'FAILED',
      'PAUSED',
      'CANCELLED'
    )
  ),
  plan JSONB NOT NULL,
  current_step INTEGER NOT NULL CHECK (current_step >= 0),
  requires_approval BOOLEAN NOT NULL,
  approval_status TEXT CHECK (
    approval_status IS NULL OR approval_status IN ('PENDING', 'APPROVED', 'REJECTED')
  ),
  device_id TEXT,
  execution_context JSONB,
  result JSONB,
  error TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  execution_lease_id TEXT,
  execution_lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_owner_updated_idx
  ON tasks (user_id, companion_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS tasks_running_lease_idx
  ON tasks (status, execution_lease_expires_at)
  WHERE status = 'RUNNING';
