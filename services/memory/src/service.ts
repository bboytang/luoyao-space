import { consolidateMemory } from "./consolidation";
import { rankMemories, type MemoryRecord, type RankedMemory } from "./ranking";
import { validateEmbedding, type EmbeddingProvider } from "./embedding";
import { decideMemoryWrite, type MemoryWriteSignals } from "./write-policy";
import type { CreateMemoryInput, MemoryRepository } from "./repository";

export interface MemoryEventSink {
  emit(event: {
    type: "memory.created" | "memory.updated" | "memory.deleted";
    userId: string;
    companionId: string;
    data: Record<string, unknown>;
  }): Promise<void>;
}

export interface RememberCandidateInput extends MemoryWriteSignals {
  userId: string;
  companionId: string;
  relationshipRelevance?: number;
  projectRelevance?: number;
  createdAt?: string;
}

export type RememberCandidateResult =
  | { action: "skip"; reason: string }
  | { action: "skip_duplicate"; reason: string; memory: MemoryRecord }
  | { action: "store"; reason: string; memory: MemoryRecord }
  | { action: "replace_existing"; reason: string; memory: MemoryRecord; replacedMemoryId: string }
  | { action: "keep_both"; reason: string; memory: MemoryRecord };

export interface MemoryService {
  remember(input: CreateMemoryInput): Promise<MemoryRecord>;
  rememberCandidate(input: RememberCandidateInput): Promise<RememberCandidateResult>;
  replace(input: {
    userId: string;
    companionId: string;
    memoryId: string;
    update: CreateMemoryInput;
  }): Promise<MemoryRecord>;
  remove(input: {
    userId: string;
    companionId: string;
    memoryId: string;
  }): Promise<void>;
  recall(input: {
    userId: string;
    companionId: string;
    query: string;
    limit: number;
    now: string;
    relationshipWeight?: number;
    projectWeight?: number;
  }): Promise<RankedMemory[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryService(
  repository: MemoryRepository,
  embedding?: EmbeddingProvider,
  events?: MemoryEventSink,
): MemoryService {
  async function emit(event: Parameters<MemoryEventSink["emit"]>[0]): Promise<void> {
    if (events) await events.emit(event);
  }

  return {
    async remember(input) {
      const memory = await repository.create(input);
      await emit({
        type: "memory.created",
        userId: memory.userId,
        companionId: memory.companionId,
        data: { memoryId: memory.id, kind: memory.kind, importance: memory.importance },
      });
      return memory;
    },

    async rememberCandidate(input) {
      const decision = decideMemoryWrite(input);
      if (decision.action === "skip") {
        return { action: "skip", reason: decision.reason };
      }

      const createdAt = input.createdAt ?? nowIso();
      const vector = embedding
        ? (await embedding.embed({ text: input.userMessage })).vector
        : undefined;

      if (vector) validateEmbedding(vector);

      const candidates = await repository.findCandidates({
        userId: input.userId,
        companionId: input.companionId,
        query: input.userMessage,
        queryEmbedding: vector,
        limit: 20,
        now: createdAt,
        relationshipWeight: 1,
        projectWeight: 1,
      });

      const consolidation = consolidateMemory(
        {
          kind: decision.kind,
          content: input.userMessage.trim(),
          importance: decision.importance,
          embeddingScore: candidates[0]?.embeddingScore,
        },
        candidates,
      );

      const base: CreateMemoryInput = {
        userId: input.userId,
        companionId: input.companionId,
        kind: decision.kind,
        content: input.userMessage.trim(),
        importance: decision.importance,
        relationshipRelevance: input.relationshipRelevance ?? 0,
        projectRelevance: input.projectRelevance ?? 0,
        createdAt,
        ...(vector ? { embedding: vector } : {}),
      };

      if (consolidation.action === "skip_duplicate" && consolidation.existingId) {
        const existing = candidates.find((memory) => memory.id === consolidation.existingId);
        if (!existing) throw new Error("Consolidation target not found");
        return {
          action: "skip_duplicate",
          reason: consolidation.reason,
          memory: existing,
        };
      }

      if (consolidation.action === "replace_existing" && consolidation.existingId) {
        const memory = await this.replace({
          userId: input.userId,
          companionId: input.companionId,
          memoryId: consolidation.existingId,
          update: base,
        });
        return {
          action: "replace_existing",
          reason: consolidation.reason,
          memory,
          replacedMemoryId: consolidation.existingId,
        };
      }

      const memory = await this.remember(base);
      return {
        action: consolidation.action === "keep_both" ? "keep_both" : "store",
        reason: consolidation.reason,
        memory,
      };
    },

    async replace(input) {
      const memory = await repository.replace(input);
      await emit({
        type: "memory.updated",
        userId: memory.userId,
        companionId: memory.companionId,
        data: { memoryId: memory.id, kind: memory.kind, importance: memory.importance },
      });
      return memory;
    },

    async remove(input) {
      await repository.remove(input);
      await emit({
        type: "memory.deleted",
        userId: input.userId,
        companionId: input.companionId,
        data: { memoryId: input.memoryId },
      });
    },

    async recall(input) {
      const queryEmbedding = embedding
        ? (await embedding.embed({ text: input.query })).vector
        : undefined;

      if (queryEmbedding) validateEmbedding(queryEmbedding);

      const candidates = await repository.findCandidates({
        userId: input.userId,
        companionId: input.companionId,
        query: input.query,
        queryEmbedding,
        limit: Math.max(input.limit * 4, input.limit),
        now: input.now,
        relationshipWeight: input.relationshipWeight ?? 1,
        projectWeight: input.projectWeight ?? 1,
      });

      const ranked = rankMemories(candidates, {
        now: input.now,
        query: input.query,
        relationshipWeight: input.relationshipWeight ?? 1,
        projectWeight: input.projectWeight ?? 1,
      }).slice(0, input.limit);

      await repository.markAccessed(
        ranked.map((memory) => memory.id),
        input.now,
      );

      return ranked;
    },
  };
}
