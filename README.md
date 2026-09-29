# Luoyao Space

> A persistent personal AI agent with relationship, memory, realtime voice, tools, devices, and proactive execution.

## Vision

Luoyao Space is not only an AI girlfriend. It is a **Personal AI OS** whose relationship/personality layer is embodied by Luoyao.

Core capabilities:

- persistent identity, personality, relationship and memory
- natural realtime voice with streaming, interruption and barge-in
- long-running tasks and projects
- browser, terminal, filesystem and GitHub tools
- plugins and MCP-compatible capabilities
- permission-aware computer/device control
- proactive outreach and reminders
- unified cloud identity across web, mobile, desktop and IoT runtimes
- digital human / avatar runtime

## Architecture

```
                    LUOYAO SPACE
                         |
                +--------+--------+
                |                 |
              BRAIN            RUNTIME
                |                 |
       +--------+--------+   +----+----+----+
       |        |        |   |         |    |
     Memory  Relation  Agent Voice   Device Sync
       |        |        |   |         |    |
       +--------+--------+   +----+----+----+
                |                 |
                +--------+--------+
                         |
                       Events
```

### Brain

- Memory OS
- Relationship OS
- Persona / Self Model
- Conversation Director
- Agent Planner
- Proactive Engine

### Agent OS

- persistent tasks
- plans and execution state
- tools
- plugins
- approvals
- permissions
- computer control

### Runtime

- realtime audio
- VAD / ASR / TTS
- streaming LLM
- barge-in / abort
- avatar / emotion events
- device sessions
- XiaoZhi / IoT runtime

### Clients

- Web
- iOS / Android
- Desktop
- XiaoZhi / ESP32
- future home / robot runtimes

## Design principles

1. **Runtime is not the brain.** XiaoZhi is treated as a realtime/device runtime source, not the product architecture.
2. **One identity, many runtimes.** Devices share the same user, companion, relationship, memory and task state.
3. **Stable personality, variable expression.** Natural conversation must not force empathy, advice or relationship language on every turn.
4. **Actions require capability + permission.** Tools are unified behind a capability model and gated by autonomy level.
5. **Memory is structured.** Facts, episodes, preferences, emotion, relationship, projects, goals, tasks and decisions are distinct memory classes.
6. **Model-provider agnostic.** Realtime, fast-chat, reasoning and embedding models are routed independently.
7. **Production before demo.** Observability, security, migrations, tests and failure recovery are part of the architecture from day one.

## XiaoZhi reuse policy

We selectively reuse ideas and compatible code from XiaoZhi where appropriate:

- realtime session/protocol concepts
- Opus/audio pipeline
- VAD / ASR / TTS provider abstraction
- sentence streaming
- abort / barge-in
- MCP/device capability architecture
- digital-human runtime/event bridge concepts

We do **not** wholesale copy the XiaoZhi server/product architecture or bundled character assets. Code licensing and asset licensing are reviewed separately.

## Repository layout

```
apps/
services/
packages/
runtimes/
plugins/
database/
infra/
docs/
```

See `docs/architecture/overview.md` for the canonical architecture.
