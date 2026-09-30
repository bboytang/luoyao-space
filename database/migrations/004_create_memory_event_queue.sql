CREATE TABLE IF NOT EXISTS memory_event_queue (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_event_queue_claim_idx
  ON memory_event_queue (status, available_at, created_at);

CREATE INDEX IF NOT EXISTS memory_event_queue_processing_idx
  ON memory_event_queue (status, locked_at);
