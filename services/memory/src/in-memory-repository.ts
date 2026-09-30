import type { MemoryRecord } from "./ranking";
import type {
  CreateMemoryInput,
  MemoryCandidateQuery,
  MemoryRepository,
} from "./repository";

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly records = new Map<string, MemoryRecord>();

  async create(input: CreateMemoryInput): Promise<MemoryRecord> {
    const id = `memory-${this.records.size + 1}`;
    const record: MemoryRecord = {
      id,
      userId: input.userId,
      companionId: input.companionId,
      kind: input.kind,
      content: input.content,
      importance: input.importance ?? 0.5,
      relationshipRelevance: input.relationshipRelevance ?? 0,
      projectRelevance: input.projectRelevance ?? 0,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.records.set(id, record);
    return record;
  }

  async replace(input: { userId: string; companionId: string; memoryId: string; update: CreateMemoryInput }): Promise<MemoryRecord> {
    const existing = this.records.get(input.memoryId);
    if (!existing || existing.userId !== input.userId || existing.companionId !== input.companionId) {
      throw new Error("Memory not found");
    }
    const record: MemoryRecord = {
      ...existing,
      kind: input.update.kind,
      content: input.update.content,
      importance: input.update.importance ?? existing.importance,
      relationshipRelevance: input.update.relationshipRelevance ?? existing.relationshipRelevance,
      projectRelevance: input.update.projectRelevance ?? existing.projectRelevance,
      ...(input.update.projectId ? { projectId: input.update.projectId } : existing.projectId ? { projectId: existing.projectId } : {}),
      createdAt: input.update.createdAt ?? new Date().toISOString(),
    };
    this.records.set(input.memoryId, record);
    return record;
  }

  async remove(input: { userId: string; companionId: string; memoryId: string }): Promise<void> {
    const existing = this.records.get(input.memoryId);
    if (existing && existing.userId === input.userId && existing.companionId === input.companionId) {
      this.records.delete(input.memoryId);
    }
  }

  async findCandidates(query: MemoryCandidateQuery): Promise<MemoryRecord[]> {
    const normalized = query.query.trim().toLowerCase();

    return [...this.records.values()]
      .filter(
        (record) =>
          record.userId === query.userId &&
          record.companionId === query.companionId &&
          (normalized.length === 0 ||
            record.content.toLowerCase().includes(normalized)),
      )
      .slice(0, query.limit);
  }

  async findProjectMemories(input: { userId: string; companionId: string; projectId: string; limit: number }): Promise<MemoryRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.userId === input.userId && record.companionId === input.companionId && record.projectId === input.projectId)
      .sort((a, b) => b.importance - a.importance || b.createdAt.localeCompare(a.createdAt))
      .slice(0, input.limit);
  }

  async markAccessed(memoryIds: readonly string[], accessedAt: string): Promise<void> {
    for (const id of memoryIds) {
      const record = this.records.get(id);
      if (!record) continue;
      this.records.set(id, { ...record, lastAccessedAt: accessedAt });
    }
  }
}
