# Luoyao Space Architecture Decisions

> Durable record of decisions that should survive chat/session changes.
> Current code and tests remain the final authority for implementation status.

## ADR-001 — Luoyao Space is a Personal AI OS

Luoyao is the companion/personality layer, while the product as a whole is a Personal AI OS.

The system therefore includes conversation, memory, relationship, proactive behavior, durable tasks/projects, tool execution, permissions, realtime voice, devices, avatar and synchronization.

We do not collapse these concerns into a single "AI girlfriend" service.

## ADR-002 — Service boundaries are ownership boundaries

Logical domains have explicit ownership:

- Brain owns conversation orchestration and behavior.
- Memory owns memory policy, retrieval and persistence.
- Relationship owns relationship state.
- Agent plans work.
- Task owns durable task lifecycle and execution progress.
- Tool Runtime owns capabilities, authorization and the final execution gate.
- Realtime owns audio sessions and streaming.
- Device Runtime owns device sessions/capabilities.
- Sync owns cross-device synchronization.

A logical boundary does not require a separately deployed microservice.

## ADR-003 — Conversation does not directly write the Memory database

Memory writes are event-driven:

```
Conversation
  -> memory.write.requested
  -> Memory Consumer
  -> Write Policy
  -> Consolidation
  -> Repository
```

This keeps conversation orchestration independent from memory persistence and allows durable delivery/retry infrastructure to be added later.

The protocol event does not itself imply that a durable Event Bus already exists.

## ADR-004 — Durable tasks use versioned optimistic concurrency

Agent tasks carry a monotonically increasing `version`.

Persistence updates use compare-and-swap semantics:

```
expectedVersion == storedVersion
    -> update and increment version
otherwise
    -> concurrency conflict
```

Task execution also uses an execution lease so competing workers cannot simultaneously claim the same executable step.

Database-backed implementations must preserve these semantics.

## ADR-005 — Approval never bypasses authorization

Risk levels and autonomy levels are separate controls.

The execution path is:

```
Planner
  -> Task
  -> Approval when required
  -> Execution Gate
  -> Capability
  -> Backend
```

Approval may satisfy an approval requirement, but the final Execution Gate must still validate user/device binding, supported runtime, autonomy and required permissions.

## ADR-006 — Devices are runtimes, not separate brains

Web, mobile, desktop and IoT/ESP32 clients present the same Luoyao identity.

Device Runtime handles session/runtime concerns. Persona, relationship, memory and durable task state remain server-side domain concerns.

## ADR-007 — Model selection is provider-neutral

Brain decides behavioral policy. Model Router decides which provider/model implements a requested model class.

Supported classes include realtime, fast_chat, reasoning, embedding and vision.

Provider failures must be explicit; a failed provider call must not silently become a successful response.

## ADR-008 — Realtime is a runtime boundary

Realtime owns VAD, ASR, streaming LLM integration, TTS, audio framing, session lifecycle and barge-in/abort.

Realtime does not own long-term memory, relationship state, persona policy or durable task state.

## ADR-009 — XiaoZhi is a runtime/protocol reference, not the product architecture

XiaoZhi concepts may inform realtime/device implementation where useful, but Luoyao interfaces and ownership boundaries remain authoritative.

Adapted source must preserve attribution and license information. Independently rewritten code records the design reference without claiming copied provenance. Third-party bundled assets require separate license review.

## ADR-010 — Repository state outranks chat history

When chat history conflicts with the repository, verify:

1. current source
2. tests
3. migrations/configuration
4. latest CI
5. documentation

Implementation status is never inferred solely from a previous conversation.

For meaningful changes, the implementation workflow is:

1. state the purpose of the step
2. inspect current state
3. make a coherent change
4. run relevant tests
5. inspect the latest GitHub Actions result
6. only then mark the step complete
