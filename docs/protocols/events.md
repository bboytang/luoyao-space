# Domain Events

All cross-service events use a versioned envelope.

```json
{
  "id": "event-id",
  "type": "task.completed",
  "version": 1,
  "occurred_at": "2026-01-01T00:00:00Z",
  "user_id": "user-id",
  "companion_id": "companion-id",
  "session_id": "session-id",
  "source": "task-service",
  "data": {}
}
```

Rules:

- event names are stable public contracts
- payloads are versioned
- consumers must tolerate unknown fields
- sensitive data is minimized
- important events are persisted for replay/audit
