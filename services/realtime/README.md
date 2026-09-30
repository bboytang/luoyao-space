# Realtime Service

Owns realtime conversational sessions.

## Runtime boundary

The service is intentionally split into:

- `RealtimeSessionService`: provider-neutral session orchestration.
- `WebSocketSessionConnection`: WebSocket transport adapter.
- `AudioPipeline`: provider-neutral VAD / ASR / LLM / TTS contracts.
- `server.ts`: Node.js WebSocket entrypoint.
- `demo-pipeline.ts`: deterministic local pipeline for protocol and UI integration tests only.

The core session service does not import WebSocket or AI-vendor SDKs.

## Local demo server

Run:

`pnpm realtime:dev`

The server listens on `ws://127.0.0.1:8787` by default.

Override with:

- `REALTIME_HOST`
- `REALTIME_PORT`

The demo pipeline emits deterministic Chinese text and a short PCM16 frame. It is **not** a production ASR, LLM, or TTS implementation.

## Target pipeline

audio input
-> VAD
-> ASR / realtime model
-> streaming response
-> sentence segmentation
-> TTS
-> audio output

Supports:

- streaming
- interruption / barge-in
- abort
- session state
- emotion events
- runtime adapters
