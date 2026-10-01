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

For a first physical iPhone development test, a separate default-off mode accepts
a 64-character random hex token from the WSS handshake Authorization header,
then still performs the M1-B authorized-device check. Configure
`REALTIME_PHYSICAL_DEV_MODE=1`, `REALTIME_PHYSICAL_DEV_TOKEN`,
`REALTIME_PHYSICAL_DEV_USER_ID`, and `REALTIME_PHYSICAL_DEV_DEVICE_ID`. This
mode is forbidden in production, requires a loopback listener, and is mutually
exclusive with the older loopback development bypass. Realtime itself stays
behind a trusted TLS reverse proxy; see
[first physical iPhone test](../../docs/deployment/physical-iphone.md).

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
the principal. The adapter fails closed without admitted identity. M2-B routes
accepted voice turns through Brain's `respondToConversation`, a real PostgreSQL
Memory service, an explicitly named initial-only relationship snapshot, a
replaceable model router, and real ASR/TTS providers. This initial snapshot is
not persistent relationship history or a complete persona/safety system.
The service rejects inbound and outbound PCM16 frames whose metadata or
sample alignment differs from the negotiated format.

## Explicit real voice configuration (M2-B / M2-D1)

The default demo providers never make external API calls. Real voice always
selects `REALTIME_LLM_PROVIDER=brain`; ASR, the Brain model, and TTS are
independent explicit selections. Each selected provider is validated at
startup, and an unavailable provider fails closed rather than falling back to
another external data destination. No new external provider is registered by
M2-D1: OpenAI remains the only implemented external adapter for each stage.
To select the existing OpenAI-backed server-side path, set:

`REALTIME_ASR_PROVIDER=openai`, `REALTIME_LLM_PROVIDER=brain`,
`REALTIME_TTS_PROVIDER=openai`, `REALTIME_BRAIN_MODEL_PROVIDER=openai`,
`REALTIME_RELATIONSHIP_MODE=initial`, `OPENAI_ASR_MODEL`,
`OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`,
`REALTIME_COMPANION_ID`, `DATABASE_URL`, and credentials. The existing
`OPENAI_API_KEY` remains a shared credential default. Alternatively,
`OPENAI_ASR_API_KEY`, `OPENAI_BRAIN_API_KEY`, and `OPENAI_TTS_API_KEY` may supply
independent stage credentials. Optional provider endpoints are
`OPENAI_ASR_URL` and `OPENAI_BASE_URL`; `OPENAI_BRAIN_BASE_URL` and
`OPENAI_TTS_BASE_URL` may override the latter per stage. The PostgreSQL schema
must already have been migrated with `pnpm db:migrate`. Partial or unsupported
real selections fail at startup; direct Realtime-to-OpenAI LLM generation
remains only in explicit legacy v1 development mode, never the v2 real voice path.

This does not add production authentication. The default v2 admission still
fails closed without a trusted principal and device authorizer; the explicit
loopback development identity remains the only bundled admission path.

External data flow for this opt-in configuration:

- ASR receives the current turn's 24 kHz mono PCM16 audio (base64-encoded over
  the provider's transcription WebSocket), selected model and optional language.
- Brain's external model receives only the current transcript and static Luoyao
  response instructions derived from the current behavior policy. It receives
  no user/device/session IDs, relationship snapshot, or retrieved long-term
  memory. `MemoryIsolatedVoiceModel` constructs a fresh allowlist object and
  Brain-owned Luoyao response instructions before any model provider is selected;
  the OpenAI adapter constructs its outbound body only from that object.
- TTS receives the generated reply text, selected model and voice. Its raw
  speech PCM is aligned at the provider boundary and emitted as 24 kHz mono
  little-endian signed PCM16. Empty, silent or malformed responses fail.

Retrieving memory is **not** permission to disclose it. A later privacy design
must explicitly classify retrieved memories and apply a disclosure policy
before provider-allowed context is constructed. M2-B conservatively excludes
all retrieved long-term memory from external model requests.

`pnpm realtime:smoke:live` is an explicit paid-provider smoke path, guarded by
`M2B_LIVE_SMOKE=1` and the real configuration above plus a loopback development
identity (`REALTIME_DEV_MODE=1`, `REALTIME_DEV_USER_ID`, `REALTIME_DEV_DEVICE_ID`).
It uses the selected TTS adapter to synthesize a repository-safe test phrase at runtime, then checks real ASR,
Brain/model, TTS and non-silent output. It is not part of `pnpm test` or CI,
does not save recordings, and does not test production authentication.

## Target pipeline

audio input
-> ASR
-> Luoyao Brain (personality, relationship, memory, safety, response generation)
-> sentence segmentation
-> TTS
-> audio output

Automatic VAD is not part of M2-B; the first real voice slice uses explicit
push-to-talk turn boundaries. A direct
speech-to-speech path that bypasses Brain is not the approved architecture.

Supports:

- streaming
- interruption / barge-in
- abort
- session state
- emotion events
- runtime adapters
