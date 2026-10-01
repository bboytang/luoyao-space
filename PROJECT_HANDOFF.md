# Luoyao Project Handoff

**Repository:** `bboytang/luoyao-space`  
**Primary branch:** `main`  
**Purpose:** This document is the durable handoff context for continuing Luoyao development in another coding agent (including Codex).

> **Source of truth:** The repository is authoritative. When chat history and repository code/docs disagree, inspect the current repository, tests, configuration, migrations, and CI before making a decision.

---

## Development Execution Protocol

This protocol coordinates ChatGPT architecture review and Codex implementation without relying on chat history as durable project memory. It governs execution; it does not replace the architecture decisions in `docs/architecture-direction.md`, `ARCHITECTURE.md`, or `docs/architecture-guardrails.md`.

### 1. Source of truth

Decision authority, in descending order:

1. repository source-of-truth documents;
2. the current explicitly approved task specification;
3. current implementation facts;
4. historical chat context.

Verify what the code currently does before making implementation claims. If chat memory conflicts with current repository facts, use the repository and report the conflict. If implementation facts conflict with normative architecture documents, report the discrepancy rather than silently changing the architecture. Critical architecture constraints must live in the repository, not only in chat context.

### 2. Permanent product/platform guardrail

The accepted priority remains **iOS > Windows > Android > macOS > IoT / electronic devices > Web**. Web must not become the product architecture center. A single task must not change the established **Shared Core + Platform Adapter Layer + Native Hosts/Clients** direction.

Apply the existing authoritative rules in `docs/architecture-direction.md`, `ARCHITECTURE.md`, and `docs/architecture-guardrails.md`; do not create a conflicting second set of architecture guardrails here.

### 3. Role separation

- **ChatGPT / architecture-review role:** milestone planning, architecture decisions, risk review, review of Codex results, and deciding whether work advances to the next milestone.
- **Codex / implementation role:** inspect repository facts, implement the approved task, run targeted and local validation, use Git/GitHub/CI when authorized, and report evidence and unresolved risks.
- **Repository:** durable project memory and source of truth.
- **CI:** final machine-verifiable integration gate.

### 4. Task execution rules

For every implementation task:

1. Read only source-of-truth documents relevant to the task; do not reread the entire repository without a concrete reason.
2. Inspect current code before making implementation assumptions.
3. Keep changes narrowly scoped to the approved task.
4. Do not opportunistically refactor unrelated modules.
5. Do not change product direction or architecture unless explicitly authorized by the task.
6. Prefer targeted tests during implementation.
7. Before committing or pushing, pass the task-required targeted validation and repository-required full local gates, confirm that all changes stay within the approved scope, and confirm that the escalation rule has not been triggered.
8. Approval of an implementation task normally authorizes Codex to implement, validate, commit, and push within that task's scope. An explicit `read-only`, `no commit`, or `no push` restriction overrides this default authorization.
9. Stop after completing the requested scope; do not automatically begin the next milestone.
10. If unexpected architecture, security, data-integrity, compatibility, or scope issues appear, stop expansion, report them, and request a decision instead of silently widening the task.

Each approved implementation task should normally produce one logical commit, not a push after every small edit. Check the corresponding CI after pushing. If CI fails and the cause and fix are clearly within the original approved scope, fix it, repeat the required validation, commit, and push again. If a fix would expand scope or trigger the architecture, shared-protocol, database, security, platform, or other escalation conditions, stop and request a decision.

### 5. Tool/plugin usage

Available development tools may include GitHub, Superpowers, Context7, and Codex Security. Use a tool only when it materially improves the current task; do not invoke every tool mechanically. Repository code and documents remain authoritative for project-specific facts, and tool output must not silently override established architecture.

- **GitHub:** repository, CI, pull-request, and issue facts.
- **Superpowers:** planning, test-driven development, and systematic debugging when appropriate.
- **Context7:** current external library, framework, and API documentation; not a substitute for reading repository code.
- **Codex Security:** primarily security-sensitive boundaries and audits.

### 6. Efficient validation strategy

The normal implementation loop is:

```text
approved task -> inspect relevant code -> implement -> targeted validation
  -> full local gates -> review -> one logical commit -> push -> CI final verification
```

For an approved implementation task, its approval supplies commit/push authorization within scope unless explicitly restricted; apply the validation and escalation checks above. Do not push after every tiny edit merely to use CI as a local debugger. Diagnose and fix CI failures before continuing unrelated development.

### 7. Standard Codex handoff format

Default to a compact end-of-task report using applicable fields:

```text
Task:
HEAD:
Scope completed:
Files changed:
Targeted validation:
Full local gates:
Database/integration validation:
Git status:
Commit:
Push:
CI:
Risks / unresolved issues:
Decision needed:
Recommended next action:
```

Omit fields that genuinely do not apply. Do not dump long command logs unless a command failed, exact output is needed for diagnosis, or the reviewer requests it. Report facts and evidence rather than lengthy narration.

### 8. Escalation rule

Return to ChatGPT/architecture review before continuing when architecture boundaries, a public/shared protocol, database migration/history semantics, security/auth/permission boundaries, or platform priority would change; when significant scope expansion is required; when local tests and CI disagree without an explained environmental cause; or when multiple materially different implementation choices exist.

Routine implementation details within an approved design do not require repeated architecture review.

### 9. Context-efficiency rule

Avoid restating stable project history in every task. Prefer references to repository source-of-truth documents, current HEAD, current task ID/milestone, changed files, test evidence, and unresolved decisions. Minimize duplicated context without losing correctness or continuity.

---

## 1. Product identity

Luoyao is **Luoyao Space Personal AI OS**.

It is not architecturally an "AI girlfriend app", and it must not evolve into a Web-first chat application by accident.

The same Luoyao identity/runtime is intended to participate across:

- iOS
- Windows
- Android
- macOS
- IoT / electronic devices
- Web

Devices are runtimes/nodes, not separate product brains.

---

## 2. Platform priority — HARD REQUIREMENT

The accepted product priority is:

**iOS > Windows > Android > macOS > IoT / electronic devices > Web**

This is a product priority, not a statement that lower-priority platforms are unimportant.

### Critical rule

**Do NOT design Luoyao as a Web product that will later be ported to native platforms.**

Web is intentionally the lowest product priority and exists primarily as:

1. reference host;
2. rapid integration-test environment;
3. demo;
4. debugging/observability surface;
5. validation environment for platform-neutral runtime behavior.

The canonical architecture decision is in:

- `docs/architecture-direction.md`

---

## 3. Target architecture

### Shared Core + Native UI / Native platform hosts

Target shape:

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
                     IoT / Embedded Devices
                              |
                    Native / Rust / C / C++
                              |
                             Web
                     Reference / Demo / Test
```

The important invariant is the boundary, not the exact framework.

### Core layers

#### Protocol Core

Platform-neutral contracts:

- `AudioFrame`
- protocol messages/events
- serialization
- session IDs
- device IDs
- capabilities
- transport-independent protocol semantics

No DOM/browser/native UI dependencies.

#### Runtime Core

Reusable Luoyao behavior:

- realtime session state
- conversation state
- streaming lifecycle
- audio scheduling
- playback timeline semantics
- lip-sync timeline
- avatar state
- state machines
- cancellation
- errors/recovery
- lifecycle semantics
- device/node state
- capability-driven behavior

#### Platform Adapter Layer

Platform-specific implementations:

- microphone capture
- audio playback
- networking
- storage
- permissions
- notifications
- lifecycle mapping
- graphics/rendering
- sensors/device controls

Platform concepts must not leak into Core unless deliberately modeled as a cross-platform capability.

---

## 4. Device / Node architecture

IoT is a first-class architectural constraint from the beginning.

A participating node/device should be modeled around:

- `deviceId`
- platform/device type
- capabilities
- audio input
- audio output
- display/avatar capability
- camera capability
- sensors
- connectivity
- lifecycle/state

Core behavior must be **capability-driven**.

Never assume every node has:

- a screen
- an avatar
- a camera
- a keyboard
- touch UI
- a browser

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

Avatar is a capability, not a mandatory property of every node.

---

## 5. Realtime architecture already implemented

The project has built a substantial provider-neutral realtime foundation.

### Important components

- `RealtimeClient`
- `RealtimeSession`
- `AudioFrame`
- `PcmLipSyncAnalyzer`
- `PcmPlaybackTimeline`
- `LipSyncPlaybackTimeline`
- `RealtimeAvatarController`
- `AvatarRuntime`
- `AvatarRenderer`
- `AvatarLipSyncDriver`
- `AvatarRenderLoop`
- `AppLifecycle`
- `PcmVoiceActivityDetector`
- `RealtimeBargeInController`
- `RealtimeBargeInInput`

These are architectural building blocks, not justification for expanding Web-specific product behavior.

---

## 6. Audio timing invariant

This is a critical architectural rule:

> **Network arrival time is NOT playback presentation time.**

The intended pipeline is:

```
AudioFrame
    |
    v
PcmLipSyncAnalyzer
    |
    v
LipSyncSample
    |
    v
PcmPlaybackTimeline
    |
    v
PlaybackSchedule
    |
    v
LipSyncPlaybackTimeline
    |
    v
AvatarLipSyncDriver
    |
    v
AvatarRenderLoop
    |
    v
Actual Avatar Renderer
```

The actual playback clock belongs to the platform audio implementation.

Do not put playback timestamps into the wire-level `AudioFrame` merely to solve presentation timing.

Current `AudioFrame` binary protocol has no timestamp.

PCM playback scheduling is provider/platform neutral. Opus must be decoded before crossing the PCM playback-timeline boundary.

---

## 7. Current binary audio protocol

The binary frame has a fixed 18-byte header:

- magic: 4 bytes — `LYA1`
- codec: 1 byte
- sample rate: 4 bytes
- channels: 1 byte
- sequence: 4 bytes
- payload length: 4 bytes
- payload

There is intentionally no timestamp field.

`AudioFrame` contains:

```ts
interface AudioFrame {
  kind: "audio";
  codec: "opus" | "pcm_s16le";
  sampleRate: number;
  channels: number;
  sequence: number;
  payload: Uint8Array;
}
```

---

## 8. Current lip-sync implementation

`PcmLipSyncAnalyzer`:

- accepts PCM16;
- computes RMS;
- derives normalized mouth openness;
- derives duration from sample count / channels / sample rate.

Current openness calculation is approximately:

```
openness = min(1, rms * 4)
```

`LipSyncSample` contains:

- sequence
- openness
- durationSeconds

`LipSyncPlaybackTimeline` maps lip-sync cues onto the actual playback schedule and supports sampling, clipping, clamping, pruning, and reset.

---

## 9. Current browser playback implementation

`apps/web/src/browser-audio.ts` contains the browser reference implementation.

Important properties already implemented:

- uses `AudioContext`;
- schedules PCM with `PcmPlaybackTimeline`;
- uses actual `AudioBufferSourceNode.onended` for idle detection;
- tracks pending sources;
- uses playback generations to reject stale callbacks;
- serializes playback operations;
- rolls back playback scheduling if `source.start()` fails;
- only adds lip-sync cues after successful playback start;
- exposes playback time and mouth-open sampling;
- stop/cleanup resets timelines and waiters.

This is a **Web adapter/reference implementation**, not the product architecture.

---

## 10. Browser capture / VAD

Browser PCM capture has been hardened around lifecycle races:

- in-flight start is tracked;
- stop waits for an in-flight start;
- cleanup occurs on failure;
- lifecycle generations prevent stale callbacks;
- capture can restart.

Provider-neutral PCM16 VAD includes:

- RMS detection;
- onset threshold;
- offset threshold;
- onset debounce;
- release debounce;
- hysteresis;
- reset/configuration tests.

---

## 11. Barge-in architecture

### Client

The client has:

- `RealtimeBargeInController`
- `RealtimeBargeInInput`
- automatic VAD-triggered interruption
- manual interruption
- session-level input gating

The session gates audio input behind an active barge-in operation so that the old response is interrupted before subsequent input audio is sent.

### Session lifecycle

`RealtimeSession` includes:

- connection serialization;
- listening start/stop serialization;
- abort serialization;
- interrupt serialization;
- terminal close semantics;
- barge-in waiter settlement on close;
- stale lifecycle protection.

Close now rejects an outstanding barge-in waiter and waits for the interrupt operation to settle.

### Server

`services/realtime/src/session-service.ts` implements barge-in queue handoff:

1. capture the current queue/pipeline;
2. mark queue handoff;
3. hand off the queue generation;
4. abort the old controller;
5. await old pipeline completion;
6. verify session/queue are still current;
7. create a new controller;
8. resume processing on the same queue;
9. send `{ type: "barge_in", state: "ready" }`.

The server also has generation isolation for audio queues.

---

## 12. Important server concurrency fix

A significant race was found in the WebSocket connection layer:

Previously, each incoming string control message could spawn its handler independently, allowing concurrent control operations.

This was fixed so control messages are serialized in arrival order while audio remains independent.

Commit:

`1debd4a3f1dfac374c7864a0b816ad01c6e5e0a2`

Commit message:

`fix: serialize realtime control messages`

A regression test was then added:

`6685d8b8334e0f79484b04129893e9f7bb89f4d9`

Commit message:

`test: serialize concurrent control messages`

The regression test blocks the first control handler, sends a second control message, verifies the second does not run early, then releases the first and verifies arrival order.

---

## 13. Historical CI blocker — resolved

This section records the CI state at the time of the original handoff. It is historical context, not the current development blocker; check current HEAD and its CI before acting.

At the time this handoff was written, the latest CI for:

`6685d8b8334e0f79484b04129893e9f7bb89f4d9`

is **RED**.

Workflow run:

- run id: `36807219129`
- attempt: 2
- job id: `110197857288`

Observed result:

- `pnpm typecheck`: **passed**
- `pnpm test`: **failed**
- build did not proceed because the test gate failed

The failed test run was reproduced; this is not currently safe to treat as a one-off flake.

### Action required at that time

**Do not add new product features.**

First:

1. inspect the exact failing `pnpm test` assertion/output;
2. identify the real cause;
3. make the smallest coherent fix;
4. add/adjust regression coverage if appropriate;
5. commit the fix;
6. wait for CI;
7. proceed only after CI is green.

The previous attempt to retrieve job logs through the available GitHub connector did not expose the exact failure output. Therefore, **do not invent the failing assertion or assume its cause**.

---

## 14. CI development rule — HARD REQUIREMENT

The project uses CI as a development gate.

### Rule

> **Do not blindly pile on code while CI is red.**

Workflow:

1. Check current HEAD CI.
2. If CI is red: fix only the failure.
3. If CI is running: wait/check; do not start unrelated feature work.
4. Only after CI is explicitly green: start the next coherent development batch.
5. Keep each batch logically scoped.
6. Prefer one logical change per commit so failures remain attributable.

CI green is the gate **between coherent development batches**, not a requirement to stop after every tiny edit.

If CI status cannot be retrieved, say so explicitly. Never interpret absence of CI information as green.

---

## 15. Implementation phase at the original handoff

The roadmap describes the project as being in the **durable Task OS** phase, with Memory OS productionization also completed/checked.

The next major roadmap areas are:

### Realtime productionization

- provider adapters
- streaming audio
- true end-to-end barge-in
- interruption recovery
- session reconnection/resume
- observability
- device capability negotiation

### Device / Avatar / Sync

- cross-device session state
- device registry
- presence
- avatar emotion runtime
- web client
- mobile clients
- desktop runtime
- ESP32 / IoT runtime integration

### Later

- Proactive Companion
- production hardening

The roadmap must be interpreted together with `docs/architecture-direction.md`, not independently.

---

## 16. Future development direction

The correct long-term sequence is architectural, not Web-feature-driven.

### Stage A — Stabilize current Core and realtime contracts

First make the existing provider-neutral runtime reliable:

- protocol correctness
- realtime state machines
- cancellation
- barge-in
- interruption recovery
- playback scheduling
- lifecycle
- tests
- observability

Do not prematurely move this logic into a Web-only implementation.

### Stage B — Device / capability model

Establish first-class node/device concepts:

- device identity
- platform/device type
- capability declaration
- audio input/output capabilities
- display/avatar capability
- camera/sensor capability
- connectivity
- lifecycle/state
- capability negotiation

The core must work for both a rich phone and a minimal IoT voice node.

### Stage C — Cross-device synchronization

Build:

- device registry
- presence
- cross-device session state
- session/node ownership semantics
- capability-aware routing
- recovery/reconnection

### Stage D — Native platform hosts

Implement according to priority:

1. iOS
2. Windows
3. Android
4. macOS
5. IoT / embedded
6. Web as reference/demo/test

Native UI belongs to each platform.

### Stage E — Avatar runtime

Keep:

- emotion
- expression
- speaking
- mouth-open
- activity

in reusable runtime state.

Rendering remains behind `AvatarRenderer`.

A device without display/avatar must still function correctly.

### Stage F — Proactive Companion

Only after the underlying runtime/device/session architecture is sufficiently stable:

- proactive behavior
- scheduling
- contextual actions
- background behavior
- user-configurable autonomy

### Stage G — Production hardening

- observability
- resilience
- reconnect/resume
- security
- performance
- storage durability
- migration strategy
- platform lifecycle edge cases
- device fleet behavior
- release/upgrade compatibility

---

## 17. Rust migration policy

Long-term preferred direction:

**Shared Core → incrementally toward Rust**

Rust is appropriate for:

- protocol handling
- realtime state machines
- audio processing/timing
- concurrency
- device/runtime logic
- embedded-capable shared components

### Do NOT do this

Do not rewrite the existing TypeScript runtime into Rust merely because Rust is the long-term target.

### Correct migration strategy

1. stabilize current behavior;
2. establish clear boundaries;
3. lock behavior down with tests;
4. identify components whose boundaries are mature;
5. migrate incrementally;
6. keep platform adapters thin;
7. justify migration by actual cross-platform/embedded needs.

---

## 18. Architecture anti-drift rules

Every future change should be checked against these questions.

### Platform

- Does this respect **iOS > Windows > Android > macOS > IoT > Web**?
- Is Web convenience accidentally deciding the architecture?

### Core

- Can this behavior live in platform-neutral Core?
- If yes, why is it being implemented inside `apps/web` or another platform host?

### Native

- Is native UI/system integration kept at the platform edge?
- Are platform concepts leaking into Core unnecessarily?

### IoT

- Does the design assume a screen/avatar/camera/browser?
- Can a capability-less or audio-only node still participate?

### Realtime

- Are network arrival time and playback presentation time being confused?
- Does the design preserve provider-neutral audio boundaries?
- Are cancellation and interruption semantics explicit?

### Avatar

- Is avatar state reusable?
- Is rendering behind `AvatarRenderer`?
- Can a node exist without an avatar?

### Rust

- Is there a concrete reason to migrate this component now?
- Are its boundaries and behavioral tests already mature?

### CI

- Is HEAD green?
- If not, is this change strictly fixing the failure?
- Are unrelated changes being avoided?

---

## 19. Repository documents to read before coding

A new coding agent should read these first:

1. `docs/architecture-direction.md`
2. `ARCHITECTURE.md`
3. `ROADMAP.md`
4. this file: `PROJECT_HANDOFF.md`

Then inspect:

- current Git HEAD;
- current CI status;
- current tests;
- relevant runtime code;
- migrations/configuration where applicable.

If the chat history says something different from the repository, **the repository wins after inspection**.

---

## 20. Expected behavior from the next coding agent

Before making changes:

1. Read this handoff.
2. Read `docs/architecture-direction.md`.
3. Check current HEAD and CI.
4. If CI is red, diagnose/fix the existing failure only.
5. Do not begin a new feature batch until CI is green.
6. State what the next significant step is for before doing it.
7. Make small, coherent changes.
8. Add regression tests for behavioral fixes.
9. Commit logically when authorized under the Development Execution Protocol.
10. Verify CI before moving to the next batch.
11. Never silently change the platform priority or architectural center.
12. Never turn Web into the product center because it is easier to implement.

---

## 21. User requirements / working style

The project owner expects:

- development to continue rather than stopping at plans;
- each significant step to begin with a short explanation of what the step is for;
- proactive detection of architecture drift and bugs;
- repository state to be treated as the source of truth;
- no blind accumulation of code;
- CI to be respected as a gate;
- architecture to remain aligned with the accepted platform direction;
- future-proof design rather than short-term Web convenience;
- continuity when the project is moved between ChatGPT conversations or coding agents.

The most important operational requirement is:

> **Do not let the project slowly drift away from the agreed architecture while implementing individual features.**

When uncertain, stop and inspect the repository architecture documents and current implementation before choosing a direction.

---

## 22. One-line handoff summary

> **Build one Luoyao Core with native platform hosts, capability-driven devices, Web as reference/test/demo rather than product center, and move toward Rust incrementally only after boundaries and behavior are stable; check current HEAD, CI, and the approved task before proceeding.**
