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


## Runtime contract

The router owns provider selection; Brain owns conversation behavior. Brain does not select a concrete provider or model name.

Provider selection follows this order:

1. use the configured provider when it supports the requested model class;
2. otherwise use another available provider supporting that class;
3. if none exists, fail explicitly with a routing error.

A provider failure is not silently converted into a successful response. Retry/failover policy belongs above the provider call so the system can distinguish transient availability from model output errors.

The M2 real-voice external-data path selects exactly one Brain model provider
explicitly. It does not use the general router's available-provider fallback
to send a voice turn to another external destination without separate approval.
`MemoryIsolatedVoiceModel` constructs provider-allowed context before routing.
