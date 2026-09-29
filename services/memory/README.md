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
