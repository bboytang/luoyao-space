import { rankMemories, type RankedMemory } from "./ranking";
import type { MemoryRepository } from "./repository";
import type { EmbeddingProvider } from "./embedding";

export interface MemoryService {
  remember(input: Parameters<MemoryRepository["create"]>[0]): Promise<ReturnType<MemoryRepository["create"]> extends Promise<infer T> ? T : never>;
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

export function createMemoryService(repository: MemoryRepository, embedding?: EmbeddingProvider): MemoryService {
  return {
    remember(input) {
      return repository.create(input);
    },

    async recall(input) {
      const queryEmbedding = embedding\n        ? (await embedding.embed({ text: input.query })).vector\n        : undefined;\n\n      const candidates = await repository.findCandidates({
        userId: input.userId,
        companionId: input.companionId,
        query: input.query,
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
