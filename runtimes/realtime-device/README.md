# Realtime Device Runtime

The Realtime Device Runtime is the transport and session layer for voice-capable devices and realtime clients.

It owns:

- session lifecycle
- control-message protocol
- binary audio framing boundaries
- listening / speaking state
- barge-in / abort semantics
- capability negotiation
- provider-neutral audio pipeline contracts

It does **not** own:

- relationship state
- long-term memory
- persona policy
- model selection policy
- durable tasks
- business-level tool permissions

Those belong to Luoyao Space services.

## Protocol

A realtime connection carries:

1. JSON control messages
2. binary audio frames

The runtime normalizes these into typed events before handing them to Brain, Model Router, or device adapters.

## Session lifecycle

```
CONNECTING
  -> READY
  -> LISTENING
  -> PROCESSING
  -> SPEAKING
  -> READY

Any active state
  -> ABORTING
  -> READY

READY
  -> CLOSING
  -> CLOSED
```

Barge-in is a first-class transition: an incoming user utterance can cancel active speech without destroying the session.

## Provenance

This runtime is a Luoyao Space implementation. Protocol and realtime design research is documented in `docs/architecture/realtime-runtime-research.md`.
