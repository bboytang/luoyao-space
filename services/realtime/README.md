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

The Web reference/debug/integration host now uses Device Session v2. It displays a stable browser-local device ID; for loopback development, set `REALTIME_DEV_MODE=1`, `REALTIME_DEV_USER_ID`, and `REALTIME_DEV_DEVICE_ID` (matching that displayed ID) on the server. Do **not** set `REALTIME_DEV_V1_COMPAT` for this host. This explicit development identity is not production authentication: the default remains fail closed, and development mode is rejected when `NODE_ENV=production`.

`REALTIME_DEV_V1_COMPAT=1` remains an explicit development-only path for legacy protocol tests/tools. It is not the Web host's normal path and adds no v2 semantics to v1. This server currently selects realtime voice and PCM16 audio capabilities; it does not negotiate `avatar.dynamic`, so the Web Avatar preview remains local unless server policy explicitly negotiates that capability in a later approved change.

Override with:

- `REALTIME_HOST`
- `REALTIME_PORT`

The demo pipeline emits deterministic Chinese text and a short PCM16 frame. It is **not** a production ASR, LLM, or TTS implementation.

M2-A supplies a narrow trusted Realtime-to-Brain turn seed in `src/brain-context.ts`:
the v2 admission principal provides `userId`, authorization provides
`authorizedDeviceId`, and the server supplies separate transport-session and
conversation IDs. Client-declared IDs and capabilities cannot substitute for
the principal. The adapter fails closed without admitted identity. It does
not yet assemble Brain's relationship, memory, companion, signals, model, or
real ASR/TTS dependencies; that full path belongs to M2-B. Existing provider
factories already permit ASR/TTS implementations to be injected without
changing the audio pipeline, but their default implementations remain demos.
The service rejects inbound and outbound PCM16 frames whose metadata or
sample alignment differs from the negotiated format.

## Target pipeline

audio input
-> ASR
-> Luoyao Brain (personality, relationship, memory, safety, response generation)
-> sentence segmentation
-> TTS
-> audio output

Automatic VAD and real provider/Brain assembly are not part of M2-A; the first
real voice slice may use explicit push-to-talk turn boundaries. A direct
speech-to-speech path that bypasses Brain is not the approved architecture.

Supports:

- streaming
- interruption / barge-in
- abort
- session state
- emotion events
- runtime adapters
