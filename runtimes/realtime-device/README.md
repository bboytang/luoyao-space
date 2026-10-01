# Realtime Device Runtime

The Realtime Device Runtime is the platform-neutral Device Session and realtime voice client layer. A device session does not require a microphone, speaker, display, or Avatar.

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

`DeviceSessionClient` is the canonical v2 admission path. Transport open only permits it to send the shared `DeviceSessionHelloV2`; `connect()` resolves and the client becomes operational only after `device.accepted`. A machine-readable `device.rejected` rejects `connect()` and closes the transport. The hello's supported and currently available capabilities are distinct; only server-negotiated capabilities activate optional audio/Avatar adapters. A terminated client cannot resume: reconnect by creating a new client and transport, which receives a new server transport-session ID.

`RealtimeSession` retains the development-period v1 voice path used by the Web reference host until M1-D. When composed by `DeviceSessionClient` after v2 acceptance, it reuses the existing cancel/barge-in ordering without sending a v1 hello. The v1 capability strings in `capabilities.ts` do not define v2 device capabilities.

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
