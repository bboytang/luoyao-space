# Luoyao Architecture Direction

**Status:** Accepted  
**Scope:** Long-term product and runtime architecture  
**Last updated:** 2026-10-01

## 1. Product platform priority

Luoyao is a multi-platform product. The intended priority is:

1. **iOS**
2. **Windows**
3. **Android**
4. **macOS**
5. **IoT / electronic devices**
6. **Web**

This ordering is a product priority, not a statement that lower-priority platforms are unimportant.

The architecture MUST NOT be designed as a Web product that is later ported to native platforms.

## 2. Primary architectural decision

Luoyao will use:

> **Shared Core + Native UI / Native platform hosts**

The shared core contains platform-independent product behavior and runtime logic. Each platform owns its native UI and platform-specific system integrations.

We explicitly do **not** make a cross-platform UI framework the center of the product architecture.

### Target shape

```
                         Luoyao Core
                              |
                    Platform Adapter Layer
                              |
        +---------------------+----------------------+
        |                     |                      |
       iOS                 Windows                Android
   Swift / SwiftUI       C# / WinUI             Kotlin / Compose
        |                     |                      |
   Native audio          Native audio           Native audio
   Native graphics       Native graphics        Native graphics
        |                     |                      |
        +---------------------+----------------------+
                              |
                            macOS
                       SwiftUI / AppKit
                              |
                              |
                     IoT / Embedded Devices
                              |
                    Native / Rust / C / C++
                              |
                              |
                             Web
                     Reference / Demo / Test
```

The exact native rendering and system APIs may evolve. The architectural separation is the important invariant.

## 3. Core layers

The long-term core is divided conceptually into three layers.

### 3.1 Protocol Core

Responsible for platform-neutral communication contracts:

- AudioFrame
- protocol messages and events
- serialization
- session identifiers
- device identifiers
- capabilities
- transport-independent protocol semantics

Protocol definitions MUST NOT depend on DOM, browser APIs, or a specific native UI framework.

### 3.2 Runtime Core

Responsible for Luoyao behavior:

- realtime session state
- conversation state
- streaming lifecycle
- audio scheduling
- playback timeline semantics
- lip-sync timeline
- avatar state
- state machines
- cancellation
- error handling and recovery
- lifecycle semantics
- device/node state
- capability-driven behavior

This layer is the main reusable product logic.

### 3.3 Platform Adapter Layer

Responsible for connecting the core to a host platform:

- microphone capture
- audio playback
- WebSocket/network implementation
- storage
- permissions
- notifications
- application lifecycle
- graphics/rendering
- device-specific sensors and controls

Platform adapters MUST NOT leak platform-specific concepts into the core unless those concepts are deliberately modeled as a cross-platform capability.

## 4. Device / Node model

IoT is an architectural constraint from the beginning, not a future afterthought.

Luoyao should eventually model participating clients as **nodes/devices** with:

- deviceId
- platform / device type
- capabilities
- available audio input
- available audio output
- display/avatar capability
- camera capability
- sensors
- connectivity
- device lifecycle/state

A phone, desktop, embedded device, and Web client may therefore participate in the same Luoyao system while exposing different capabilities.

Example:

```
iPhone
  microphone: yes
  speaker: yes
  display: yes
  avatar: yes

IoT voice device
  microphone: yes
  speaker: yes
  display: no
  avatar: no
```

Core behavior MUST be capability-driven where appropriate rather than assuming every node has a screen or avatar.

## 5. Audio architecture

Audio timing is a core concern and MUST remain independent of any particular UI platform.

Important invariant:

> Network arrival time is not playback presentation time.

The intended conceptual pipeline is:

```
AudioFrame
    |
    v
Audio / LipSync Analysis
    |
    v
Playback Timeline
    |
    v
LipSync Playback Timeline
    |
    v
Avatar LipSync Driver
    |
    v
Avatar Runtime
    |
    v
Platform Renderer
```

Platform audio implementations provide the actual playback clock and audio I/O.

The current Web implementation using AudioContext is a platform adapter/reference implementation, not the definition of the product architecture.

## 6. Avatar architecture

Avatar state belongs to the reusable runtime.

Examples of shared state:

- activity
- speaking
- emotion
- expression
- mouthOpen

Rendering does not belong in the core.

The intended boundary is:

```
AvatarRuntime
     |
AvatarRenderer interface
     |
+----+-------------------------------+
|    |               |               |
Web  iOS           Windows        Android
DOM  Native/GPU    Native/GPU     Native/GPU
```

An IoT node may have no avatar at all. Avatar is therefore a **capability**, not a mandatory property of every Luoyao node.

## 7. Lifecycle architecture

Application lifecycle semantics belong in the reusable runtime abstraction where they are platform-neutral.

Platform hosts are responsible for mapping native lifecycle events to the shared lifecycle contract.

A platform-specific lifecycle implementation MUST NOT become the definition of Luoyao's global lifecycle semantics.

The current Web `AppLifecycle` is a reference implementation of this boundary.

## 8. Web's role

Web is intentionally the lowest product priority.

It remains valuable as:

1. a development/reference host;
2. a rapid integration-test environment;
3. a demo;
4. a debugging and observability surface;
5. a way to validate platform-neutral runtime behavior.

Web MUST NOT become the architectural center merely because it is currently the easiest environment to execute.

When functionality is platform-independent, it should live in the core rather than permanently in `apps/web`.

Browser-specific implementations such as `AudioContext`, `MediaStream`, `AudioWorklet`, DOM rendering, and browser lifecycle integration remain in the Web adapter/host.

## 9. Long-term Core implementation direction

The long-term preferred direction is a **Rust-based shared core**, because the project is expected to span:

- iOS
- Windows
- Android
- macOS
- IoT / embedded targets
- WebAssembly/reference Web host

Rust is particularly relevant for:

- protocol handling
- realtime state machines
- audio processing and timing logic
- concurrency
- device/runtime logic
- embedded-capable shared components

However:

> **Do not rewrite the existing TypeScript runtime into Rust prematurely.**

The current TypeScript implementation is the active reference implementation. First establish stable architectural boundaries and behavioral tests. Migrate components incrementally only when the boundaries are mature and the target platform needs justify the migration.

## 10. Current development rules

### Core first

When a capability can be implemented platform-independently, prefer putting it in the core.

### Platform code at the edge

Browser, iOS, Windows, Android, macOS, and IoT-specific APIs belong behind adapters/hosts.

### Do not build Web-first by accident

A Web implementation is allowed to validate a design, but Web convenience MUST NOT determine the core abstraction.

### Preserve provider-neutral boundaries

For example:

- `RealtimeAudioInput`
- `RealtimeAudioOutput`
- `AvatarRenderer`
- playback timeline abstractions

should remain provider/platform-neutral.

### CI gate

Do not stack unrelated changes while CI is red or running.

Workflow:

1. Check current CI.
2. If red, fix only the failure.
3. If running, wait.
4. Proceed with new development only after green.
5. Prefer one logical change per commit so CI results remain attributable.

## 11. Current implementation status

The repository already contains important pieces of the intended architecture:

- `RealtimeClient`
- `AudioFrame`
- `PcmPlaybackTimeline`
- `LipSyncPlaybackTimeline`
- `AvatarRuntime`
- `AvatarRenderer`
- `AvatarLipSyncDriver`
- `AvatarRenderLoop`
- `AppLifecycle`

These should be treated as building blocks for the platform-neutral architecture, not as a reason to expand Web-specific product functionality.

## 12. Decision summary

The long-term direction is:

> **One Luoyao Core, multiple native hosts, capability-driven devices, and Web as a reference host.**

Target platform order:

> **iOS > Windows > Android > macOS > IoT > Web**

Long-term implementation direction:

> **Shared Core → incrementally toward Rust**

UI direction:

> **Native UI per platform**

IoT direction:

> **First-class device/node architecture, not a late add-on**

Current Web direction:

> **Reference implementation, test/demo/debug host — not the product center**
