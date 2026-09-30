import type { DomainEvent } from "../../../packages/protocol/src/events";
import {
  consumeMemoryWriteRequested,
  type MemoryWriteRequestedEvent,
} from "./event-consumer";
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
}

export class MemoryEventWorker {
  private readonly now: () => string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: (attempts: number) => number;

  constructor(private readonly options: MemoryEventWorkerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseMs = options.leaseMs ?? 60_000;
    this.retryDelayMs = options.retryDelayMs ?? ((attempts) => Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1)));

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
      return true;
    } catch (error) {
      await this.options.queue.retry({
        eventId: claimed.eventId,
        workerId: this.options.workerId,
        error: error instanceof Error ? error.message : String(error),
        availableAt: new Date(
          Date.parse(this.now()) + this.retryDelayMs(claimed.attempts),
        ).toISOString(),
        now: this.now(),
      });
      throw error;
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
