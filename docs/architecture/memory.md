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
