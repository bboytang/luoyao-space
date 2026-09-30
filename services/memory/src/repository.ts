import type { MemoryKind, MemoryRecord } from "./ranking";

export interface CreateMemoryInput {
  userId: string;
  companionId: string;
  kind: MemoryKind;
  content: string;
  importance?: number;
  relationshipRelevance?: number;
  projectRelevance?: number;
  projectId?: string;
  createdAt?: string;
  embedding?: readonly number[];
}

export interface MemoryCandidateQuery {
  userId: string;
  companionId: string;
  query: string;
  queryEmbedding?: readonly number[];
  limit: number;
  now: string;
  relationshipWeight: number;
  projectWeight: number;
}

export interface MemoryRepository {
  create(input: CreateMemoryInput): Promise<MemoryRecord>;
  replace(input: { userId: string; companionId: string; memoryId: string; update: CreateMemoryInput }): Promise<MemoryRecord>;
  remove(input: { userId: string; companionId: string; memoryId: string }): Promise<void>;
  findCandidates(query: MemoryCandidateQuery): Promise<MemoryRecord[]>;
  markAccessed(memoryIds: readonly string[], accessedAt: string): Promise<void>;
  findProjectMemories?(input: { userId: string; companionId: string; projectId: string; limit: number }): Promise<MemoryRecord[]>;
}
