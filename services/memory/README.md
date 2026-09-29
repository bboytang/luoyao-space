# Memory Service

Owns structured long-term memory.

The storage model distinguishes:

- facts
- events
- episodes
- preferences
- emotion
- relationship
- shared history
- projects
- goals
- tasks
- decisions

Retrieval is a hybrid of semantic relevance, recency, importance and context.


## Ranking contract

The ranking layer is deterministic and storage-independent. It combines semantic relevance, recency, importance, relationship relevance and project relevance. Each input signal is bounded between zero and one; malformed numeric values are clamped before scoring.

The storage adapter is responsible for fetching candidate memories. The ranking layer is responsible only for ordering those candidates.


## Production storage boundary

`PostgresMemoryRepository` implements the storage contract through an injected `SqlClient`; it does not couple the Memory service to an ORM or PostgreSQL client package. The schema is defined in `database/migrations/001_create_memories.sql` and uses pgvector with a 1536-dimensional embedding column.

The repository owns tenant-scoped candidate retrieval and optional pgvector similarity. The Memory Service owns over-fetching, application ranking, final limits, and access timestamps.

Embeddings are optional at the repository boundary. Without a query embedding, retrieval falls back to parameterized text containment and creation-time ordering. Semantic retrieval should be supplied by an upstream embedding provider.

All user-controlled SQL values are parameterized, and every query is scoped by both `user_id` and `companion_id`.

### Consolidation

Before a selected write becomes durable, the consolidation layer can classify it as an exact duplicate, a replacement candidate, an unrelated new memory, or a memory that should coexist with an existing record.

The current policy only permits automatic replacement for durable fact, preference, and decision memories when the new candidate is at least as important as a highly similar existing record. Storage mutation remains outside this pure policy layer.
