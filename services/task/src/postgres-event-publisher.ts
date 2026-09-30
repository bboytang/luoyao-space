import type { TaskAuditEvent } from "./events";
import type { SqlClient } from "./postgres-repository";
import type { TaskEventPublisher } from "./events";

export class PostgresTaskEventPublisher implements TaskEventPublisher {
  constructor(private readonly client: SqlClient) {}

  async publish(event: TaskAuditEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO task_event_log (
        event_id,task_id,user_id,companion_id,event_type,event_version,
        occurred_at,source,session_id,data
      ) VALUES (
        $1::uuid,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10::jsonb
      )
      ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        event.data.taskId,
        event.userId,
        event.companionId,
        event.type,
        event.version,
        event.occurredAt,
        event.source,
        event.sessionId ?? null,
        JSON.stringify(event.data),
      ],
    );
  }
}
