# Realtime Service

Owns realtime conversational sessions.

## Runtime boundary

The service is intentionally split into:

- `RealtimeSessionService`: provider-neutral session orchestration.
- `DeviceSessionAdmission`: v2 WebSocket admission before media/control handling.
- `WebSocketSessionConnection`: development-period v1 WebSocket adapter.
- `AudioPipeline`: provider-neutral VAD / ASR / LLM / TTS contracts.
- `server.ts`: Node.js WebSocket entrypoint.
- `demo-pipeline.ts`: deterministic local pipeline for protocol and UI integration tests only.

The core session service does not import WebSocket or AI-vendor SDKs.

## Local demo server

Run:

`pnpm realtime:dev`

The server listens on `ws://127.0.0.1:8787` by default.

The default listener requires a trusted-principal provider and device authorizer before accepting a v2 device session. No production credential provider is bundled, so an unconfigured listener rejects admission; a client-supplied device ID or capability is never authentication. The built-in ownership store is single-process only.

For local reference-host development, set `REALTIME_DEV_MODE=1` on a loopback host. Set both `REALTIME_DEV_USER_ID` and `REALTIME_DEV_DEVICE_ID` to allow only that configured identity through v2 admission. To use the legacy v1 Web client temporarily, also set `REALTIME_DEV_V1_COMPAT=1`. Development mode is rejected when `NODE_ENV=production`; v1 compatibility does not add v2 semantics to v1.

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
