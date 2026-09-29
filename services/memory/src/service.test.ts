import { describe, expect, it, vi } from "vitest";
import { createMemoryService } from "./service";
import type { MemoryRepository } from "./repository";
import type { MemoryRecord } from "./ranking";

describe("MemoryService", () => {
  it("overfetches candidates, ranks them, limits results, and marks selected memories accessed", async () => {
    const records: MemoryRecord[] = [
      {
        id: "m1", userId: "u1", companionId: "c1", kind: "fact",
        content: "project alpha", importance: 1, relationshipRelevance: 0,
        projectRelevance: 1, createdAt: "2026-09-29T00:00:00Z",
        embeddingScore: 0.9,
      },
      {
        id: "m2", userId: "u1", companionId: "c1", kind: "fact",
        content: "project beta", importance: 0.1, relationshipRelevance: 0,
        projectRelevance: 0, createdAt: "2026-01-01T00:00:00Z",
        embeddingScore: 0.1,
      },
    ];

    const repository: MemoryRepository = {
      create: vi.fn(),
      findCandidates: vi.fn(async () => records),
      markAccessed: vi.fn(async () => {}),
    };

    const service = createMemoryService(repository);

    const result = await service.recall({
      userId: "u1",
      companionId: "c1",
      query: "project",
      limit: 1,
      now: "2026-09-30T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
    expect(repository.findCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", companionId: "c1", limit: 4 }),
    );
    expect(repository.markAccessed).toHaveBeenCalledWith(
      ["m1"],
      "2026-09-30T00:00:00Z",
    );
  });

  it("preserves empty recall without attempting access updates", async () => {
    const repository: MemoryRepository = {
      create: vi.fn(),
      findCandidates: vi.fn(async () => []),
      markAccessed: vi.fn(async () => {}),
    };

    const service = createMemoryService(repository);

    await expect(
      service.recall({
        userId: "u1",
        companionId: "c1",
        query: "missing",
        limit: 4,
        now: "2026-09-30T00:00:00Z",
      }),
    ).resolves.toEqual([]);

    expect(repository.markAccessed).not.toHaveBeenCalled();
  });
});
