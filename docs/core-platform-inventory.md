# Core / Platform Boundary Inventory

**Status:** Working architecture map  
**Date:** 2026-10-01  
**Related decision:** `docs/architecture-direction.md`

This document records the current implementation boundary and the intended direction. It is a migration map, not a requirement to immediately move every file.

## 1. Current high-level boundary

```
apps/web
  |
  +-- Browser adapters
  |     +-- BrowserPcmCapture
  |     +-- BrowserPcmPlayback
  |     +-- BrowserWebSocket
  |
  +-- Web host / UI
  |     +-- main.ts
  |     +-- render loop wiring
  |     +-- controls
  |
  +-- Realtime orchestration currently mixed with Web
        +-- RealtimeClient
        +-- RealtimeAvatarController

runtimes/
  +-- realtime-device
  |     +-- protocol
  |     +-- binary/json codecs
  |     +-- transport contracts
  |     +-- audio I/O contracts
  |     +-- PCM analysis
  |     +-- playback timeline
  |     +-- lip-sync playback timeline
  |     +-- realtime pipeline
  |
  +-- avatar
        +-- AvatarState
        +-- AvatarRuntime
        +-- AvatarRenderer contract
        +-- DOM renderer implementation
```

## 2. Intended ownership

### Core

The following concepts should remain platform-neutral:

- protocol messages
- AudioFrame
- device/session identity
- capability declarations
- transport contracts
- audio input/output contracts
- playback timing semantics
- lip-sync analysis/timeline
- realtime session state
- conversation/realtime orchestration
- avatar state
- avatar renderer contract
- cancellation and lifecycle semantics
- device/node capability model

### Platform adapters

Platform adapters own:

- microphone APIs
- speaker/audio APIs
- browser AudioContext / AudioWorklet
- iOS AVFoundation / audio session
- Windows WASAPI and Windows-specific audio
- Android audio APIs
- macOS CoreAudio
- embedded/IoT hardware drivers
- browser/native WebSocket implementation
- platform lifecycle
- permissions
- notifications
- local storage
- GPU/rendering implementation

### Host/UI

Each product host owns:

- native UI
- navigation
- presentation
- platform-specific user interaction
- platform-specific visual composition

## 3. Current files and target roles

| Current area | Current role | Intended role |
| --- | --- | --- |
| `runtimes/realtime-device/src/protocol.ts` | Protocol | Core |
| `runtimes/realtime-device/src/audio-io.ts` | Audio contracts | Core |
| `runtimes/realtime-device/src/transport.ts` | Transport contract | Core |
| `runtimes/realtime-device/src/websocket-transport.ts` | Generic WebSocket transport | Core-adapter boundary; keep generic |
| `runtimes/realtime-device/src/binary-audio-codec.ts` | Binary protocol codec | Core |
| `runtimes/realtime-device/src/lip-sync.ts` | PCM analysis | Core |
| `runtimes/realtime-device/src/playback-timeline.ts` | Presentation timing | Core |
| `runtimes/realtime-device/src/lip-sync-playback-timeline.ts` | Presentation timing | Core |
| `runtimes/realtime-device/src/pipeline-runner.ts` | Realtime pipeline | Core |
| `runtimes/avatar/src/runtime.ts` | Avatar state/runtime | Core |
| `runtimes/avatar/src/dom-renderer.ts` | DOM renderer | Web adapter |
| `apps/web/src/browser-audio.ts` | Browser audio adapter | Web adapter |
| `apps/web/src/realtime-client.ts` | Mixed host + realtime orchestration | Extract toward Core |
| `apps/web/src/realtime-avatar-controller.ts` | Mixed host + avatar orchestration | Extract toward Core |
| `apps/web/src/avatar-lip-sync.ts` | Adapter wiring | Host/adapter boundary |
| `apps/web/src/avatar-render-loop.ts` | Render scheduling | Host/renderer adapter |
| `apps/web/src/app-lifecycle.ts` | Web lifecycle reference | Shared lifecycle contract + Web implementation |
| `apps/web/src/main.ts` | Web host | Web only |

## 4. Immediate architectural risks

### 4.1 RealtimeClient is still Web-owned

The current realtime session orchestration lives in `apps/web/src/realtime-client.ts`.

That means a future iOS or Windows host would be tempted to implement another client with duplicated logic.

The target is a platform-neutral realtime session client that consumes abstract:

- transport
- audio input
- audio output
- avatar/session sinks
- device capabilities

Web should provide adapters to that client.

### 4.2 RealtimeAvatarController is Web-owned

The controller contains product semantics such as:

- speaking state
- TTS lifecycle
- playback epoch
- close/error behavior

Those are not inherently browser concepts.

The target is a platform-neutral controller/state machine. The Web host should only connect its audio output and renderer to that core.

### 4.3 Capability declarations are currently hard-coded

The current Web realtime hello advertises:

```
audio.pcm_s16le
avatar.dynamic
```

The long-term model must derive capabilities from the actual node/device rather than hard-coding Web capabilities.

This is especially important for IoT devices that may have audio but no display/avatar.

### 4.4 AvatarRuntime still owns a renderer instance

This is acceptable for the current TypeScript implementation and should not be rewritten prematurely.

The architectural invariant is that `AvatarRuntime` depends only on the `AvatarRenderer` contract. Platform hosts choose the renderer implementation.

## 5. Migration sequence

Do not perform a large rewrite.

Use incremental, test-gated extraction:

1. Define device/node capability types in the protocol/core layer.
2. Define a platform-neutral realtime session/client boundary.
3. Move realtime orchestration out of `apps/web`.
4. Make Web provide only transport/audio/avatar adapters.
5. Add tests against the platform-neutral realtime client.
6. Add an iOS host against the same core contracts.
7. Add Windows host.
8. Add Android host.
9. Add macOS host.
10. Add IoT/embedded host(s) based on actual hardware.
11. Keep Web as reference/demo/test host.

At every extraction step, preserve behavior first; optimize the directory structure second.

## 6. Rust migration rule

The long-term shared core may move toward Rust.

Do not migrate a component merely because it is theoretically portable.

A component becomes a Rust migration candidate when:

- its platform-neutral boundary is stable;
- behavior is covered by tests;
- at least one non-Web host needs the shared implementation;
- the cost of duplicating the implementation becomes material.

This prevents a premature rewrite from obscuring architectural problems.

## 7. Architectural invariant

The most important invariant is:

> **Web-specific convenience must never become a dependency of Luoyao Core.**

The second is:

> **A node's capabilities determine what it can do; the core must not assume that every node has a screen, avatar, camera, or even audio input.**

The third is:

> **Network transport, audio presentation, and visual rendering are separate clocks/layers.**

## 8. Next implementation target

The next concrete refactor should be the **platform-neutral realtime session boundary**.

Before implementing it:

- keep CI green;
- add tests first where practical;
- avoid moving unrelated files;
- preserve the existing Web behavior;
- make one logical change per commit.
