import type { DomainEvent } from "../../../packages/protocol/src/events";

export interface MemoryQueueClient {
  query<Row = unknown>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface QueuedMemoryEvent {
  eventId: string;
  eventType: string;
  payload: DomainEvent;
  attempts: number;
  lockedBy: string;
  lockedAt: string;
}

interface QueueRow {
  event_id: string;
  event_type: string;
  payload: DomainEvent;
  attempts: number;
  locked_by: string;
  locked_at: string;
}

function toQueued(row: QueueRow): QueuedMemoryEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    payload: row.payload,
    attempts: Number(row.attempts),
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
  };
}

export interface MemoryEventQueue {
  enqueue(event: DomainEvent): Promise<void>;
  claim(input: {
    workerId: string;
    now: string;
    leaseMs: number;
  }): Promise<QueuedMemoryEvent | undefined>;
  complete(input: { eventId: string; workerId: string; now: string }): Promise<boolean>;
  retry(input: {
    eventId: string;
    workerId: string;
    error: string;
    availableAt: string;
    now: string;
  }): Promise<boolean>;
}

export class PostgresMemoryEventQueue implements MemoryEventQueue {
  constructor(private readonly client: MemoryQueueClient) {}

  async enqueue(event: DomainEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_event_queue (
        event_id,event_type,payload,available_at,created_at,updated_at
      ) VALUES ($1::uuid,$2,$3::jsonb,$4::timestamptz,$4::timestamptz,$4::timestamptz)
      ON CONFLICT (event_id) DO NOTHING`,
      [
        event.id,
        event.type,
        JSON.stringify(event),
        event.occurredAt,
      ],
    );
  }

  async claim(input: {
    workerId: string;
    now: string;
    leaseMs: number;
  }): Promise<QueuedMemoryEvent | undefined> {
    if (input.leaseMs <= 0) {
      throw new Error("Memory event leaseMs must be positive");
    }

    const expiredBefore = new Date(Date.parse(input.now) - input.leaseMs).toISOString();

    const result = await this.client.query<QueueRow>(
      `WITH candidate AS (
        SELECT event_id
        FROM memory_event_queue
        WHERE
          (
            status = 'pending'
            AND available_at <= $1::timestamptz
          )
          OR (
            status = 'processing'
            AND locked_at < $2::timestamptz
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE memory_event_queue AS q
      SET
        status = 'processing',
        attempts = q.attempts + 1,
        locked_at = $1::timestamptz,
        locked_by = $3,
        updated_at = $1::timestamptz
      FROM candidate
      WHERE q.event_id = candidate.event_id
      RETURNING q.event_id,q.event_type,q.payload,q.attempts,q.locked_by,q.locked_at::text`,
      [
        input.now,
        expiredBefore,
        input.workerId,
      ],
    );

    const row = result.rows[0];
    return row ? toQueued(row) : undefined;
  }

  async complete(input: {
    eventId: string;
    workerId: string;
    now: string;
  }): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE memory_event_queue
       SET status='completed',
           locked_at=NULL,
           locked_by=NULL,
           processed_at=$3::timestamptz,
           updated_at=$3::timestamptz,
           last_error=NULL
       WHERE event_id=$1::uuid
         AND status='processing'
         AND locked_by=$2
       RETURNING event_id`,
      [input.eventId, input.workerId, input.now],
    );
    return result.rows.length > 0;
  }

  async retry(input: {
    eventId: string;
    workerId: string;
    error: string;
    availableAt: string;
    now: string;
  }): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE memory_event_queue
       SET status='pending',
           locked_at=NULL,
           locked_by=NULL,
           available_at=$3::timestamptz,
           last_error=$4,
           updated_at=$5::timestamptz
       WHERE event_id=$1::uuid
         AND status='processing'
         AND locked_by=$2
       RETURNING event_id`,
      [
        input.eventId,
        input.workerId,
        input.availableAt,
        input.error,
        input.now,
      ],
    );
    return result.rows.length > 0;
  }
}
