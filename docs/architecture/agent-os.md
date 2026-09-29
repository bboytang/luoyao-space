# Agent OS

Agent OS turns goals into durable, permission-aware execution.

## Task lifecycle

```
PENDING
  -> PLANNING
  -> WAITING_APPROVAL
  -> RUNNING
  -> WAITING_USER
  -> RUNNING
  -> COMPLETED

Failure paths:
FAILED / PAUSED / CANCELLED
```

## Task record

```
task_id
user_id
companion_id
goal
status
plan
current_step
created_at
updated_at
requires_approval
approval_status
device_id
execution_context
result
error
```

## Execution

The planner chooses capabilities, but the runtime enforces:

- authentication
- permission
- risk level
- device scope
- approval policy
- audit logging

The model never directly bypasses these controls.
