# Luoyao Space Roadmap

> This document records implementation state, not aspirations. Status must follow the current repository and verified CI.

## Current state

### Foundation — implemented

- [x] Monorepo TypeScript foundation
- [x] CI typecheck + tests
- [x] Protocol package
- [x] Model Router abstraction
- [x] Conversation orchestration
- [x] Conversation Director / behavior policy direction
- [x] Memory ranking
- [x] Memory write policy
- [x] Memory consolidation
- [x] Memory repository abstraction
- [x] PostgreSQL/pgvector memory repository
- [x] Embedding provider abstraction
- [x] Relationship state model
- [x] Proactive engine foundations
- [x] Capability registry
- [x] Risk levels and autonomy levels
- [x] Permission authorization
- [x] Execution Gate
- [x] Structured tool execution errors
- [x] Agent Planner
- [x] Task state machine
- [x] Task approval flow
- [x] Task pause/resume/wait-user controls
- [x] Task step execution integration
- [x] In-memory TaskRepository
- [x] Task versioning / optimistic concurrency
- [x] Task execution lease contract and in-memory claim implementation
- [x] Realtime protocol/runtime foundations
- [x] XiaoZhi provenance/source-attribution rules

## Current implementation phase: durable Task OS

### Immediate sequence

1. [x] Versioned Task model
2. [x] Repository abstraction
3. [x] Optimistic concurrency
4. [x] Execution lease
5. [x] Persistence-boundary state transition enforcement
6. [x] Versioned task progress without status change
7. [x] PostgreSQL TaskRepository
8. [x] Durable task lifecycle/audit event publisher
9. [x] Refactor Task Runner to persist every step transition
10. [x] Restart/resume from persisted task state
11. [x] Production concurrency tests against PostgreSQL

## Next major phases

### Memory OS productionization

- [x] durable event consumer/queue
- [x] automatic embedding generation on writes
- [x] exact embedding-dimension enforcement
- [x] stronger memory observability
- [x] memory lifecycle/retention policy
- [x] project memory aggregation

### Agent OS productionization

- [ ] durable planner/executor loop
- [ ] worker orchestration
- [ ] retries/backoff
- [ ] cancellation propagation
- [ ] task timeout/dead-letter policy
- [ ] audit trail
- [ ] approval UI/API
- [ ] browser/terminal/filesystem/GitHub adapters
- [ ] computer-control runtime

### Realtime productionization

- [ ] provider adapters
- [ ] streaming audio integration
- [ ] true end-to-end barge-in
- [ ] interruption recovery
- [ ] session reconnection/resume
- [ ] realtime observability
- [ ] device capability negotiation

### Device / Avatar / Sync

- [ ] cross-device session state
- [ ] device registry
- [ ] presence
- [ ] avatar emotion runtime
- [ ] web client
- [ ] mobile clients
- [ ] desktop runtime
- [ ] ESP32 / IoT runtime integration

### Proactive Companion

- [ ] durable scheduler
- [ ] habit-aware scheduling
- [ ] notification delivery adapters
- [ ] follow-up memory
- [ ] contact-frequency safeguards
- [ ] multi-modal proactive actions

### Production hardening

- [ ] authentication and authorization integration
- [ ] secret management
- [ ] database migration pipeline
- [ ] structured logs
- [ ] metrics/tracing
- [ ] rate limiting
- [ ] idempotency
- [ ] disaster recovery
- [ ] backup/restore verification
- [ ] security review
- [ ] load/concurrency testing

## Rules

- Do not call an item complete without code/tests and, where applicable, migration/runtime verification.
- CI must be checked after meaningful changes.
- Failed CI is recorded and fixed; do not hide intermediate failures.
- Architecture changes should be recorded as ADRs when they affect ownership, persistence, security or protocol contracts.
