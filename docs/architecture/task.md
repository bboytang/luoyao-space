# Task Engine

The Task Engine owns durable execution state. Conversation may create or update a task, but task execution is represented independently from chat messages.

## Lifecycle

`PENDING → PLANNING → RUNNING`

Approval-required work uses:

`PLANNING → WAITING_APPROVAL → RUNNING`

Execution may enter:

- `WAITING_USER`
- `PAUSED`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

## Approval boundary

`WAITING_APPROVAL → RUNNING` is a state transition, not proof of authorization.

Before executing a capability, the execution layer must independently verify:

1. task approval state
2. autonomy level
3. risk level
4. required permissions
5. target device scope
6. capability-specific safety constraints

Approval and permission checks must not be inferred from task status alone.

## Device scope

A task may target a specific device. Device-scoped permissions are evaluated against that target `deviceId`; permissions granted to another device must never satisfy the check.

## Events

Task lifecycle changes should emit versioned domain events, including approval requested/approved/rejected, started/progress, paused/resumed, completed/failed, and cancelled.

## Recovery

Tasks are durable and may resume after process or device interruption. The current step and execution context must be persisted before relying on them for recovery.

## Separation

The Task Engine does not own:

- persona
- relationship state
- long-term memory
- realtime audio transport
- model selection

Those systems consume task events or provide context to planning/execution.
