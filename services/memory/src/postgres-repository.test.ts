import { describe, expect, it, vi } from "vitest";
import { PostgresMemoryRepository } from "./postgres-repository";

describe("PostgresMemoryRepository", () => {
  it("creates a memory through parameterized SQL", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        id: "00000000-0000-0000-0000-000000000001",
        user_id: "u1",
        companion_id: "c1",
        kind: "fact",
        content: "喜欢短回复",
        importance: 0.8,
        relationship_relevance: 0.4,
        project_relevance: 0,
        created_at: "2026-09-30T00:00:00.000Z",
        last_accessed_at: null,
        embedding_score: null,
      }],
    }));

    const repository = new PostgresMemoryRepository({ query });

    const memory = await repository.create({
      userId: "u1",
      companionId: "c1",
      kind: "fact",
      content: "喜欢短回复",
      importance: 0.8,
      embedding: [0.1, 0.2],
    });

    expect(memory.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(query).toHaveBeenCalledOnce();
    const values = query.mock.calls[0]?.[1] as readonly unknown[];
    expect(values[0]).toBe("u1");
    expect(values[8]).toBe("[0.1,0.2]");
  });

  it("uses vector similarity when a query embedding is supplied", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresMemoryRepository({ query });

    await repository.findCandidates({
      userId: "u1",
      companionId: "c1",
      query: "project",
      queryEmbedding: [0.1, 0.2],
      limit: 8,
      now: "2026-09-30T00:00:00.000Z",
      relationshipWeight: 1,
      projectWeight: 1,
    });

    const [sql, values] = query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain("embedding <=> $6::vector");
    expect(values[5]).toBe("[0.1,0.2]");
  });

  it("does not issue an update for an empty access set", async () => {
    const query = vi.fn();
    const repository = new PostgresMemoryRepository({ query });

    await repository.markAccessed([], "2026-09-30T00:00:00.000Z");

    expect(query).not.toHaveBeenCalled();
  });
});
