import type { DomainEvent } from "../../../packages/protocol/src/events";
import {
  consumeMemoryWriteRequested,
  type MemoryWriteRequestedEvent,
} from "./event-consumer";
import type { MemoryObservability } from "./observability";
import type { MemoryService } from "./service";
import type {
  MemoryEventQueue,
  QueuedMemoryEvent,
} from "./event-queue";

export interface MemoryEventWorkerOptions {
  queue: MemoryEventQueue;
  memory: Pick<MemoryService, "rememberCandidate">;
  workerId: string;
  now?: () => string;
  leaseMs?: number;
  retryDelayMs?: (attempts: number) => number;
  observability?: MemoryObservability;
}

export class MemoryEventWorker {
  private readonly now: () => string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: (attempts: number) => number;
  private readonly observability: MemoryObservability;

  constructor(private readonly options: MemoryEventWorkerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseMs = options.leaseMs ?? 60_000;
    this.retryDelayMs = options.retryDelayMs ?? ((attempts) => Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1)));
    this.observability = options.observability ?? {
      increment() {},
      observe() {},
    };

    if (!options.workerId.trim()) {
      throw new Error("Memory event workerId must not be empty");
    }
  }

  async runOnce(): Promise<boolean> {
    const claimed = await this.options.queue.claim({
      workerId: this.options.workerId,
      now: this.now(),
      leaseMs: this.leaseMs,
    });

    if (!claimed) return false;

    this.observability.increment("memory_event_worker_claimed", 1, {
      event_type: claimed.eventType,
    });

    const startedAt = Date.parse(this.now());

    try {
      await this.process(claimed);
      const completed = await this.options.queue.complete({
        eventId: claimed.eventId,
        workerId: this.options.workerId,
        now: this.now(),
      });
      if (!completed) {
        throw new Error("Memory event completion lost worker ownership");
      }

      this.observability.increment("memory_event_worker_completed", 1, {
        event_type: claimed.eventType,
      });
      this.observeProcessingDuration(claimed, startedAt);
      return true;
    } catch (error) {
      this.observability.increment("memory_event_worker_failed", 1, {
        event_type: claimed.eventType,
      });

      await this.options.queue.retry({
        eventId: claimed.eventId,
        workerId: this.options.workerId,
        error: error instanceof Error ? error.message : String(error),
        availableAt: new Date(
          Date.parse(this.now()) + this.retryDelayMs(claimed.attempts),
        ).toISOString(),
        now: this.now(),
      });

      this.observability.increment("memory_event_worker_retried", 1, {
        event_type: claimed.eventType,
        attempts: claimed.attempts,
      });
      this.observeProcessingDuration(claimed, startedAt);
      throw error;
    }
  }

  private observeProcessingDuration(
    claimed: QueuedMemoryEvent,
    startedAt: number,
  ): void {
    const finishedAt = Date.parse(this.now());
    if (Number.isFinite(startedAt) && Number.isFinite(finishedAt)) {
      this.observability.observe(
        "memory_event_worker_processing_duration_ms",
        Math.max(0, finishedAt - startedAt),
        { event_type: claimed.eventType },
      );
    }
  }

  private async process(claimed: QueuedMemoryEvent): Promise<void> {
    if (claimed.eventType !== "memory.write.requested") {
      throw new Error(`Unsupported memory event type: ${claimed.eventType}`);
    }

    const event = claimed.payload as MemoryWriteRequestedEvent & DomainEvent;
    await consumeMemoryWriteRequested(event, this.options.memory);
  }
}
