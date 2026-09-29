# Luoyao Space Architecture

## 1. Product boundary

Luoyao Space is a Personal AI OS with a persistent relationship personality.

The system is divided into:

- **Brain** — understands the user, relationship, context and goals.
- **Agent OS** — plans and executes work through tools.
- **Runtime** — turns intelligence into realtime voice, avatar and device interaction.
- **Clients** — present the same identity on different devices.

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
  |                          +---- Persona
  |                          +---- Conversation Director
  |                          +---- Proactive
  |
  +---- Task / Agent ------> Agent OS
  |                          |
  |                          +---- Planner
  |                          +---- Tool Runtime
  |                          +---- Permissions
  |                          +---- Approvals
  |
  +---- Realtime ----------> Runtime
                             |
                             +---- VAD / ASR / LLM / TTS
                             +---- Barge-in
                             +---- Avatar
                             +---- Device sessions

Everything emits domain events.
Events update memory, tasks, relationship and connected clients.
```

## 3. Service boundaries

```
services/
  gateway/          API, auth, sessions
  brain/            conversation orchestration
  memory/           memory storage and retrieval
  relationship/     relationship state
  agent/            planning and agent loop
  task/             durable task state machine
  proactive/        scheduled outreach
  realtime/         realtime audio session
  tool-runtime/     capability execution
  device-runtime/   connected device sessions
  sync/             cross-device event/state synchronization
```

A service boundary is an ownership boundary, not a requirement to deploy every service separately on day one.

## 4. Unified capability model

Every executable capability exposes:

- capability id
- input schema
- output schema
- risk level
- required permissions
- supported runtimes
- backend implementation

Example:

```text
computer.run_command
browser.open
filesystem.read
github.create_pr
device.set_volume
home.light.turn_on
```

Backends may use MCP, HTTP, WebSocket, native OS APIs, SSH or other adapters.

## 5. Autonomy

- Level 0 — conversation only
- Level 1 — proactive reminders
- Level 2 — low-risk execution
- Level 3 — computer control
- Level 4 — autonomous multi-step planning

Permissions remain independently enforceable even at higher autonomy.

## 6. Event model

Core events:

```text
conversation.created
conversation.updated
memory.created
relationship.changed
emotion.changed
task.created
task.started
task.progress
task.completed
task.failed
tool.started
tool.completed
device.connected
device.disconnected
avatar.emotion
notification.requested
```

Events are durable where required and are the synchronization mechanism between brain, agent and runtimes.

## 7. External runtime compatibility

External realtime/device implementations are treated as runtime adapters rather than product architecture.

Their useful protocol, audio, device, MCP and avatar concepts are isolated behind Luoyao Space interfaces so the product does not become coupled to any one external project's application/server topology.

Target:

```
runtimes/
  realtime-device/
    protocol/
    audio/
    session/
    device/
    tools/
```

The runtime can eventually be replaced or supplemented without changing Brain or Agent OS.

## 8. Source attribution

Third-party-derived runtime work is tracked separately from original Luoyao Space code. See [`source-attribution.md`](./source-attribution.md) for the provenance rules and current map. Actual adapted files must carry a source-attribution header; independently rewritten files use a design-reference header.
