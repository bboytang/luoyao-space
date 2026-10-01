# Luoyao Architecture Guardrails

> Status: Normative
>
> This document is a compact set of non-negotiable architecture constraints for Luoyao development.
> For detailed rationale and architecture definitions, see `docs/architecture-direction.md` and `ARCHITECTURE.md`.

## 1. Platform Priority

The product platform priority is:

**iOS > Windows > Android > macOS > IoT > Web**

This is a product priority, not a statement that lower-priority platforms are unimportant.

Luoyao MUST NOT be designed as a Web product that is later ported to native platforms.

## 2. Shared Core First

Platform-independent product behavior belongs in the shared Core.

The intended shape is:

```text
Luoyao Core
    |
Platform Adapter Layer
    |
iOS / Windows / Android / macOS / IoT / Web
```

Native UI frameworks and browser APIs MUST NOT become the center of product architecture.

## 3. Native Hosts and Platform Adapters

Each target platform owns its native UI and platform-specific integrations.

Platform adapters may own:

- microphone and audio I/O
- playback
- networking
- storage
- permissions
- notifications
- lifecycle integration
- graphics/rendering
- device sensors and controls

Platform-specific concepts MUST NOT leak into Core unless they are deliberately modeled as cross-platform capabilities.

## 4. Web Is a Reference Host

Web is intentionally the lowest product priority.

The Web implementation is primarily:

1. reference implementation
2. rapid integration-test environment
3. demo surface
4. debugging/observability surface

Browser-specific APIs such as `AudioContext`, `MediaStream`, `AudioWorklet`, DOM rendering, and browser lifecycle handling MUST remain in the Web adapter/host.

Do not expand Web-specific product behavior merely because it is currently the easiest platform to implement.

## 5. IoT Is First-Class

IoT is an architectural constraint from the beginning, not a later port.

A device/node is capability-driven and may expose:

- device identity
- platform/device type
- capabilities
- audio input/output
- display/avatar
- camera
- sensors
- connectivity
- lifecycle/state

Core MUST NOT assume that every node has a screen, avatar, camera, keyboard, browser, touch UI, or any other specific presentation capability.

## 6. Realtime Audio Timing

Network arrival time MUST NOT be treated as playback presentation time.

The conceptual synchronization pipeline is:

```text
AudioFrame
  -> Audio/LipSync Analysis
  -> Playback Timeline
  -> LipSync Playback Timeline
  -> Avatar LipSync Driver
  -> Avatar Runtime
  -> Platform Renderer
```

Playback timing is determined by the actual platform playback clock.

Protocol/audio-frame wire formats MUST NOT gain timestamps merely to compensate for incorrect playback timing assumptions.

## 7. Avatar Boundary

Avatar state and behavior belong to reusable runtime logic.

Rendering belongs outside Core/runtime abstractions:

```text
AvatarRuntime
  -> AvatarRenderer
  -> Native / GPU / DOM renderer
```

An avatar is a capability, not a requirement of every device.

## 8. Lifecycle Boundary

Lifecycle semantics MUST remain platform-neutral in reusable runtime code.

Native hosts map native lifecycle events into the shared lifecycle contract.

## 9. Provider-Neutral Realtime Boundaries

Realtime abstractions MUST remain provider-neutral.

Examples include:

- `RealtimeAudioInput`
- `RealtimeAudioOutput`
- playback timeline abstractions
- `AvatarRenderer`

Provider-specific SDKs or browser-specific APIs belong at the adapter boundary.

## 10. Rust Migration

The long-term shared-core direction is Rust where it provides clear cross-platform/runtime value.

Do NOT rewrite the existing TypeScript runtime into Rust prematurely.

First stabilize:

- boundaries
- behavior
- contracts
- tests
- platform separation

Then migrate incrementally when the boundary is mature and the migration has a concrete benefit.

## 11. Source of Truth

When chat history, assumptions, or remembered plans conflict with the repository:

**the repository and its current code/tests/configuration are authoritative.**

Before making an architectural decision, inspect:

1. current code
2. tests
3. migrations/configuration when relevant
4. current CI
5. architecture/roadmap documents

Do not rely on remembered conversation state when repository evidence is available.

## 12. CI Development Gate

CI is a gate between coherent development batches.

- If CI is **red**, fix the failure before adding unrelated implementation.
- If CI is **running**, wait for the result before starting unrelated implementation.
- Proceed with new implementation only after CI is explicitly **green**.
- A coherent development batch should normally produce one logical commit.
- Do not blindly stack code on top of an unverified failure.

## 13. Architecture Drift Check

Before starting a significant change, verify:

- Does it respect **iOS > Windows > Android > macOS > IoT > Web**?
- Is platform-independent behavior in Core?
- Is native/platform-specific behavior at the adapter/host boundary?
- Does it avoid making Web the architectural center?
- Does it preserve capability-driven device design?
- Does it preserve provider-neutral realtime boundaries?
- Does it preserve playback-clock-based audio timing?
- Does it keep avatar rendering outside reusable runtime logic?
- Does it preserve platform-neutral lifecycle semantics?
- Does it avoid premature Rust migration?
- Is the current CI state known and respected?

If a proposed implementation violates one of these constraints, stop and resolve the architectural conflict before adding code.

## 14. Priority of Architectural Rules

When constraints appear to conflict, resolve them in this order:

1. Product architecture and platform direction
2. Core/platform boundary
3. Device capability model
4. Realtime correctness and lifecycle semantics
5. Provider/platform adapter details
6. Convenience of the current implementation

Local implementation convenience MUST NOT override a higher-level architectural constraint.
