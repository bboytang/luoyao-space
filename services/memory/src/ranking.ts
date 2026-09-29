export type MemoryKind =
  | "fact"
  | "event"
  | "episode"
  | "preference"
  | "emotion"
  | "relationship"
  | "shared_history"
  | "project"
  | "goal"
  | "task"
  | "decision";

export interface MemoryRecord {
  id: string;
  userId: string;
  companionId: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  relationshipRelevance: number;
  projectRelevance: number;
  createdAt: string;
  lastAccessedAt?: string;
  embeddingScore?: number;
}

export interface MemoryRetrievalContext {
  now: string;
  query: string;
  relationshipWeight: number;
  projectWeight: number;
}

export interface RankedMemory extends MemoryRecord {
  score: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function recencyScore(createdAt: string, now: string): number {
  if (!Number.isFinite(new Date(createdAt).getTime()) || !Number.isFinite(new Date(now).getTime())) {
    return 0;
  }
  const ageMs = Math.max(0, new Date(now).getTime() - new Date(createdAt).getTime());
  const ageDays = ageMs / 86_400_000;
  return Math.exp(-ageDays / 30);
}

export function rankMemories(
  memories: readonly MemoryRecord[],
  context: MemoryRetrievalContext,
): RankedMemory[] {
  return memories
    .map((memory) => {
      const semantic = clamp(memory.embeddingScore ?? 0);
      const recency = recencyScore(memory.createdAt, context.now);
      const importance = clamp(memory.importance);
      const relationship = clamp(memory.relationshipRelevance);
      const project = clamp(memory.projectRelevance);

      const score =
        semantic * 0.40 +
        recency * 0.20 +
        importance * 0.20 +
        relationship * 0.10 * clamp(context.relationshipWeight) +
        project * 0.10 * clamp(context.projectWeight);

      return { ...memory, score };
    })
    .sort((a, b) => b.score - a.score);
}
