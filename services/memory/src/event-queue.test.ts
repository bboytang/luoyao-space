import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import type { DomainEvent } from "../../../packages/protocol/src/events";
import { MemoryEventWorker } from "./event-worker";
import type { MemoryObservability } from "./observability";
import {
  PostgresMemoryEventQueue,
  type MemoryEventQueue,
} from "./event-queue";

const databaseUrl = process.env.DATABASE_URL;

function event(id = "00000000-0000-0000-0000-000000000101"): DomainEvent {
  return {
    id,
    type: "memory.write.requested",
    version: 1,
    occurredAt: "2026-09-30T04:00:00.000Z",
    userId: "u1",
    companionId: "c1",
    source: "conversation",
    data: {
      userMessage: "我喜欢无糖茶",
      signals: { containsStablePreference: true },
    },
  };
}

describe("PostgresMemoryEventQueue", () => {
  it("enqueues idempotently and preserves the event payload", async () => {
    const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({ rows: [] }));
    const queue = new PostgresMemoryEventQueue({ query });

    await queue.enqueue(event());

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT (event_id) DO NOTHING");
    expect(query.mock.calls[0]?.[1]?.[2]).toBe(JSON.stringify(event()));
  });

  it.skipIf(!databaseUrl)("claims concurrently with one active lease owner", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const migration = await readFile(
      new URL("../../../database/migrations/004_create_memory_event_queue.sql", import.meta.url),
      "utf8",
    );
    await pool.query(migration);

    const queueA = new PostgresMemoryEventQueue(pool);
    const queueB = new PostgresMemoryEventQueue(pool);
    const queued = event("00000000-0000-0000-0000-000000000102");
    await queueA.enqueue(queued);

    const [a, b] = await Promise.all([
      queueA.claim({
        workerId: "worker-a",
        now: "2026-09-30T04:00:01.000Z",
        leaseMs: 60_000,
      }),
      queueB.claim({
        workerId: "worker-b",
        now: "2026-09-30T04:00:01.000Z",
        leaseMs: 60_000,
      }),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(a?.lockedBy ?? b?.lockedBy).toMatch(/^worker-[ab]$/);

    const activeOwner = a?.lockedBy === "worker-a" ? queueA : queueB;
    const activeWorker = a?.lockedBy === "worker-a" ? "worker-a" : "worker-b";
    const blocked = await (activeOwner === queueA ? queueB : queueA).claim({
      workerId: activeWorker === "worker-a" ? "worker-b" : "worker-a",
      now: "2026-09-30T04:00:30.000Z",
      leaseMs: 60_000,
    });
    expect(blocked).toBeUndefined();

    await pool.query("DELETE FROM memory_event_queue WHERE event_id=$1::uuid", [queued.id]);
    await pool.end();
  });

  it.skipIf(!databaseUrl)("reclaims an expired lease and completes exactly once", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const migration = await readFile(
      new URL("../../../database/migrations/004_create_memory_event_queue.sql", import.meta.url),
      "utf8",
    );
    await pool.query(migration);

    const queue = new PostgresMemoryEventQueue(pool);
    const queued = event("00000000-0000-0000-0000-000000000103");
    await queue.enqueue(queued);

    const first = await queue.claim({
      workerId: "worker-a",
      now: "2026-09-30T04:00:01.000Z",
      leaseMs: 60_000,
    });
    expect(first?.attempts).toBe(1);

    const takeover = await queue.claim({
      workerId: "worker-b",
      now: "2026-09-30T04:01:02.000Z",
      leaseMs: 60_000,
    });
    expect(takeover?.lockedBy).toBe("worker-b");
    expect(takeover?.attempts).toBe(2);

    expect(await queue.complete({
      eventId: queued.id,
      workerId: "worker-a",
      now: "2026-09-30T04:01:03.000Z",
    })).toBe(false);

    expect(await queue.complete({
      eventId: queued.id,
      workerId: "worker-b",
      now: "2026-09-30T04:01:04.000Z",
    })).toBe(true);

    expect(await queue.claim({
      workerId: "worker-c",
      now: "2026-09-30T04:02:00.000Z",
      leaseMs: 60_000,
    })).toBeUndefined();

    await pool.query("DELETE FROM memory_event_queue WHERE event_id=$1::uuid", [queued.id]);
    await pool.end();
  });
});

describe("MemoryEventWorker", () => {
  function queueStub(overrides?: Partial<MemoryEventQueue>): MemoryEventQueue {
    return {
      enqueue: vi.fn(async () => undefined),
      claim: vi.fn(async () => undefined),
      complete: vi.fn(async () => true),
      retry: vi.fn(async () => true),
      ...overrides,
    };
  }

  function observabilityStub(): {
    observability: MemoryObservability;
    increment: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
  } {
    const increment = vi.fn();
    const observe = vi.fn();
    return {
      observability: { increment, observe },
      increment,
      observe,
    };
  }

  it("processes a claimed memory write and acknowledges it", async () => {
    const claimed = {
      eventId: event().id,
      eventType: event().type,
      payload: event(),
      attempts: 1,
      lockedBy: "worker-1",
      lockedAt: "2026-09-30T04:00:01.000Z",
    };
    const queue = queueStub({
      claim: vi.fn(async () => claimed),
    });
    const rememberCandidate = vi.fn(async () => ({
      action: "store" as const,
      reason: "stable_preference",
      memory: {
        id: "m1",
        userId: "u1",
        companionId: "c1",
        kind: "preference" as const,
        content: "我喜欢无糖茶",
        importance: 0.75,
        relationshipRelevance: 0,
        projectRelevance: 0,
        createdAt: "2026-09-30T04:00:00.000Z",
      },
    }));

    const { observability, increment, observe } = observabilityStub();

    const worker = new MemoryEventWorker({
      queue,
      memory: { rememberCandidate },
      workerId: "worker-1",
      now: () => "2026-09-30T04:00:02.000Z",
      observability,
    });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(rememberCandidate).toHaveBeenCalledOnce();
    expect(queue.complete).toHaveBeenCalledWith({
      eventId: claimed.eventId,
      workerId: "worker-1",
      now: "2026-09-30T04:00:02.000Z",
    });
    expect(increment).toHaveBeenCalledWith("memory_event_worker_claimed", 1, {
      event_type: "memory.write.requested",
    });
    expect(increment).toHaveBeenCalledWith("memory_event_worker_completed", 1, {
      event_type: "memory.write.requested",
    });
    expect(observe).toHaveBeenCalledWith(
      "memory_event_worker_processing_duration_ms",
      0,
      { event_type: "memory.write.requested" },
    );
  });

  it("requeues failed processing with exponential backoff", async () => {
    const claimed = {
      eventId: event("00000000-0000-0000-0000-000000000104").id,
      eventType: "memory.write.requested",
      payload: event("00000000-0000-0000-0000-000000000104"),
      attempts: 2,
      lockedBy: "worker-1",
      lockedAt: "2026-09-30T04:00:01.000Z",
    };
    const queue = queueStub({
      claim: vi.fn(async () => claimed),
    });
    const rememberCandidate = vi.fn(async () => {
      throw new Error("temporary memory failure");
    });

    const { observability, increment, observe } = observabilityStub();

    const worker = new MemoryEventWorker({
      queue,
      memory: { rememberCandidate },
      workerId: "worker-1",
      now: () => "2026-09-30T04:00:02.000Z",
      observability,
    });

    await expect(worker.runOnce()).rejects.toThrow("temporary memory failure");
    expect(queue.retry).toHaveBeenCalledWith({
      eventId: claimed.eventId,
      workerId: "worker-1",
      error: "temporary memory failure",
      availableAt: "2026-09-30T04:00:04.000Z",
      now: "2026-09-30T04:00:02.000Z",
    });
    expect(increment).toHaveBeenCalledWith("memory_event_worker_failed", 1, {
      event_type: "memory.write.requested",
    });
    expect(increment).toHaveBeenCalledWith("memory_event_worker_retried", 1, {
      event_type: "memory.write.requested",
      attempts: 2,
    });
    expect(observe).toHaveBeenCalledWith(
      "memory_event_worker_processing_duration_ms",
      0,
      { event_type: "memory.write.requested" },
    );
  });
});
