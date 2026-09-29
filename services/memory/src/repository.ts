import type { MemoryKind, MemoryRecord } from "./ranking";

export interface CreateMemoryInput {
  userId: string;
  companionId: string;
  kind: MemoryKind;
  content: string;
  importance?: number;
  relationshipRelevance?: number;
  projectRelevance?: number;
  createdAt?: string;
  embedding?: readonly number[];
}

export interface MemoryCandidateQuery {
  userId: string;
  companionId: string;
  query: string;
  limit: number;
  now: string;
  relationshipWeight: number;
  projectWeight: number;
}

export interface MemoryRepository {
  create(input: CreateMemoryInput): Promise<MemoryRecord>;
  findCandidates(query: MemoryCandidateQuery): Promise<MemoryRecord[]>;
  markAccessed(memoryIds: readonly string[], accessedAt: string): Promise<void>;
}
