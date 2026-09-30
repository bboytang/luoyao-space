# Luoyao Space Architecture

> Canonical architecture reference. If chat history conflicts with the repository, prefer the repository and the current code.

## 1. Product identity

Luoyao Space is a **Personal AI OS** whose relationship/personality layer is embodied by Luoyao.

It is not merely an AI-girlfriend application. The product combines:

- persistent identity, persona, relationship and memory
- conversation and behavioral policy
- long-running tasks and projects
- tool/capability execution with permissions
- proactive actions
- realtime voice and interruption
- avatar and device runtimes
- cross-device synchronization
- model-provider abstraction

## 2. Canonical topology

```
Client
  |
Gateway / Session
  |
  +---- Conversation ----> Brain
  |                          |
  |                          +---- Memory
  |                          +---- Relationship
  |                          +---- Persona / Self Model
  |                          +---- Conversation Director
  |                          +---- Proactive Engine
  |
  +---- Task / Agent ------> Agent OS
  |                          |
  |                          +---- Planner
  |                          +---- Durable Task State
  |                          +---- Tool Runtime
  |                          +---- Permissions / Approvals
  |
  +---- Realtime ----------> Runtime
                             |
                             +---- VAD / ASR / LLM / TTS
                             +---- Barge-in / Abort
                             +---- Avatar
                             +---- Device Sessions

Domain events connect these ownership boundaries.
```

## 3. Ownership boundaries

| Area | Owns | Must not own |
|---|---|---|
| Gateway | API, auth, sessions | personality or durable business state |
| Brain | conversation orchestration, persona, behavior, memory/relationship decisions | low-level device execution |
| Memory | storage, retrieval, write policy, consolidation | conversation presentation |
| Relationship | relationship state and progression | tool execution |
| Agent | planning and agent loop | direct database ownership outside its domain |
| Task | durable task lifecycle and execution progress | model-provider selection |
| Proactive | scheduling and outreach decisions | device-specific brain logic |
| Tool Runtime | capability registry, permissions, execution gate | relationship state |
| Realtime | audio session, VAD/ASR/TTS pipeline, barge-in | long-term memory or task state |
| Device Runtime | device sessions and runtime capabilities | product identity/brain |
| Sync | cross-device state/event synchronization | independent business logic |

A service boundary is an ownership boundary, not a requirement to deploy every service separately on day one.

## 4. Core domain model

### Persona / Self Model

Separate:

1. who Luoyao is — stable identity/personality
2. what Luoyao currently feels/focuses on — dynamic state

Personality is stable while expression varies by context.

### Conversation Director

Conversation behavior is policy-driven rather than a fixed response template.

Important controls include:

- response length
- action: listen/react/tease/share/ask/comfort/solve/play
- memory use
- self-disclosure
- question probability
- relationship expression
- advice probability
- teasing probability
- emotion and intensity

Human-like behavior does not mean every turn must contain empathy, advice, relationship language or a question.

### Memory OS

Memory classes:

```
Personal Facts
Events
Episodes
Preferences
Emotion
Relationship
Shared History
Projects
Goals
Tasks
Decisions
```

Retrieval combines semantic relevance, recency, importance, relationship relevance and project relevance.

Memory writes are selective:

```
Conversation
  -> memory.write.requested
  -> Memory Event Consumer
  -> Write Policy
  -> Consolidation
  -> Repository
```

Conversation is therefore not directly coupled to the Memory database.

### Relationship OS

Tracks durable relationship state such as:

- familiarity
- trust
- warmth
- intimacy
- interaction frequency
- conversation depth
- user initiative
- shared history
- unresolved topics
- preferred contact style
- preferred response length
- humor compatibility
- emotional safety
- relationship stage

### Agent OS

Task lifecycle:

```
PENDING
  -> PLANNING
  -> WAITING_APPROVAL
  -> RUNNING
  -> WAITING_USER
  -> RUNNING
  -> COMPLETED

Failure / control:
FAILED / PAUSED / CANCELLED
```

Tasks are versioned and use optimistic concurrency. Current repository implementations also support an execution lease to prevent competing workers from claiming the same step concurrently.

Task execution must pass:

```
Planner
  -> Task
  -> Execution Gate
  -> Capability
  -> Backend
```

Approval never bypasses the final permission gate.

### Capability and permission model

Risk levels:

- L0 — read/informational
- L1 — reversible low risk
- L2 — consequential
- L3 — high impact

Autonomy levels:

- 0 — chat only
- 1 — proactive reminders
- 2 — low-risk execution
- 3 — computer control
- 4 — autonomous complex planning

Autonomy does not replace permissions.

## 5. Realtime Runtime

The realtime runtime owns:

- session lifecycle
- JSON control messages
- binary audio framing
- listening/speaking state
- VAD
- ASR
- streaming LLM integration
- TTS
- sentence streaming
- abort/barge-in
- capability negotiation

It does not own:

- relationship
- long-term memory
- persona policy
- durable tasks
- business-level permissions

The realtime pipeline is provider-neutral:

```
VAD -> ASR -> LLM stream -> TTS
```

## 6. Devices and avatar

Devices are runtimes, not separate brains.

The same Luoyao identity can appear on:

- web
- iOS / Android
- desktop
- ESP32 / IoT
- future home or robot runtimes

The avatar is a presentation runtime driven by emotion/expression events:

```
Brain
  -> emotion/expression event
  -> Avatar Runtime
  -> face / animation / voice
```

## 7. Model Router

Model selection is provider-agnostic.

Model classes include:

- realtime
- fast_chat
- reasoning
- embedding
- vision

Brain owns behavior. Model Router owns provider/model selection.

Provider failures must not silently become successful responses.

## 8. Events

The protocol includes domain events such as:

```
conversation.created
conversation.updated
memory.created
memory.write.requested
memory.updated
memory.deleted
relationship.changed
emotion.changed
task.created
task.started
task.progress
task.completed
task.failed
task.paused
task.resumed
task.cancelled
task.approval_requested
task.approved
task.rejected
tool.started
tool.completed
device.connected
device.disconnected
avatar.emotion
notification.requested
```

The event protocol exists today. A fully durable production Event Bus is a separate roadmap item and must not be assumed to exist merely because event types exist.

## 9. External runtime compatibility

XiaoZhi is treated as a realtime/device runtime reference, not as the product architecture.

Useful concepts may be adapted behind Luoyao interfaces:

- realtime session protocol
- Opus/audio pipeline
- VAD / ASR / TTS
- streaming TTS
- abort / barge-in
- MCP/device capability concepts
- avatar/runtime bridges

Third-party source attribution and asset licensing are tracked separately. See `docs/architecture/source-attribution.md`.

## 10. Source of truth

When deciding whether a capability exists:

1. inspect current code
2. inspect tests
3. inspect database migrations/configuration
4. inspect latest CI
5. only then update roadmap/documentation

Never mark a feature complete from design discussion alone.
