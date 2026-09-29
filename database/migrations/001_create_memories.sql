CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  companion_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  relationship_relevance DOUBLE PRECISION NOT NULL DEFAULT 0,
  project_relevance DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ,
  embedding VECTOR(1536)
);

CREATE INDEX IF NOT EXISTS memories_owner_created_idx
  ON memories (user_id, companion_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memories_owner_kind_idx
  ON memories (user_id, companion_id, kind);

CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
