# Model Router

The product must not depend on a single model provider.

Logical model classes:

- realtime
- fast_chat
- reasoning
- embedding
- vision

A provider adapter exposes a common interface.

Example configuration:

```yaml
models:
  realtime:
    provider: openai-compatible
  fast_chat:
    provider: openai-compatible
  reasoning:
    provider: openai-compatible
  embedding:
    provider: local
```

Routing decisions can depend on latency, cost, task type, privacy requirements and availability.
