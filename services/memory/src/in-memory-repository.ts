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
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.records.set(id, record);
    return record;
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

  async markAccessed(memoryIds: readonly string[], accessedAt: string): Promise<void> {
    for (const id of memoryIds) {
      const record = this.records.get(id);
      if (!record) continue;
      this.records.set(id, { ...record, lastAccessedAt: accessedAt });
    }
  }
}
