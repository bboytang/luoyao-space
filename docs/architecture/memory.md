# Memory OS

Memory is not one vector table.

## Classes

- personal facts
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

## Retrieval

Memory retrieval should combine:

1. semantic relevance
2. recency
3. importance
4. relationship relevance
5. project relevance
6. current conversation context

The embedding provider is replaceable.

## Project memory

Long-running projects are first-class memory:

```
Project
  -> decisions
  -> files
  -> tasks
  -> milestones
  -> deployments
  -> unresolved questions
```

This lets Luoyao continue work across conversations and devices.

## Memory write policy

Memory persistence is selective. Ordinary conversation is not automatically promoted to long-term memory.

The write policy considers:

- explicit user requests to remember something
- stable preferences
- durable personal facts
- decisions
- project context
- high-significance emotion
- high-significance relationship context
- high-significance tasks

The policy returns either a store decision with a bounded importance score or an explicit skip reason.

The policy is intentionally separate from repository writes. Future layers can add deduplication, conflict detection, correction, deletion, retention, and user-visible memory controls before a selected candidate is persisted.

This prevents the memory database from becoming a transcript archive and keeps long-term memory intentional.
