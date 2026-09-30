# Luoyao Space Engineering Rules

## 1. Source of truth

The repository is the durable source of truth.

When chat history and repository state disagree, verify the repository before changing code.

For implementation status, prefer this evidence order:

1. current source code
2. tests
3. migrations/configuration
4. latest CI
5. documentation

Documentation must not claim capabilities that the code does not provide.

## 2. Every implementation step

For each meaningful implementation step:

1. state what the step is for
2. inspect the current repository state
3. make the smallest coherent change
4. run/verify relevant tests
5. inspect the latest GitHub Actions result
6. only then mark the step complete

## 3. CI policy

The required baseline is:

```
pnpm typecheck
pnpm test
```

GitHub Actions is the authoritative remote verification.

Never report "CI is green" without checking the latest relevant run.

Intermediate failed runs are acceptable during development, but they must be fixed and the succeeding run must be verified.

## 4. Persistence

Durable state must have:

- explicit ownership
- stable identifiers
- versioning where concurrent writes are possible
- scoped reads by user/companion
- optimistic concurrency where appropriate
- idempotent mutation semantics where possible
- migration coverage
- failure/recovery behavior

Task execution must not depend on process memory for durable progress.

## 5. Task execution safety

Every executable task step must pass the capability execution gate.

Required checks include:

- capability identity
- user/device binding
- supported runtime
- risk/autonomy constraints
- required permissions
- approval requirements

Approval is not a replacement for authorization.

Task progress should be persisted at lifecycle boundaries and, eventually, after every executable step.

## 6. Security

Never place:

- API keys
- access tokens
- passwords
- private infrastructure credentials
- production secrets

in source, tests, documentation or chat output.

Use environment/configuration injection and secret-management infrastructure.

Sensitive task/tool inputs should not be copied blindly into audit events.

## 7. Concurrency

Any durable mutable object that may be touched by multiple workers needs an explicit concurrency strategy.

Current Task strategy:

- monotonically increasing version
- compare-and-swap update
- execution lease for step claiming
- explicit concurrency errors

Database implementations must preserve these semantics.

## 8. Event-driven boundaries

Use domain events to decouple ownership boundaries.

Example:

```
Conversation
  -> memory.write.requested
  -> Memory Consumer
  -> MemoryService
```

The existence of a protocol event does not imply a durable event bus. Durable delivery, retries and ordering must be implemented explicitly.

## 9. Tests

Tests should cover:

- happy path
- invalid input
- authorization denial
- concurrency conflicts
- state-transition violations
- failure recovery
- detached/mutation safety
- deterministic time/id injection where useful

Do not weaken production invariants merely to make a fixture pass.

## 10. External code and licenses

XiaoZhi and other external projects may be used as references or sources only under their applicable licenses.

For adapted code, preserve source attribution.

For independently rewritten code, record the design reference without falsely claiming copied provenance.

Bundled third-party assets have their own licensing terms and must be reviewed separately.

## 11. Architecture changes

Record significant decisions as ADRs when they affect:

- service ownership
- persistence model
- security/permissions
- event contracts
- external protocol compatibility
- provider abstraction
- client/device architecture

Avoid speculative microservices. A logical service boundary does not require immediate separate deployment.

## 12. Product behavior

Natural companion behavior is evaluated over conversations, not isolated responses.

Do not force:

- empathy on every turn
- advice on every turn
- relationship language on every turn
- a question on every turn
- artificial self-disclosure

Use stable personality with variable contextual expression.

Luoyao must not fabricate real-world experiences as facts. Explicit roleplay is a separate interaction mode.

## 13. Change discipline

Prefer small, reviewable commits.

A commit should have one coherent purpose.

After changing a shared protocol/type, search for all affected fixtures and consumers before declaring the change complete.
