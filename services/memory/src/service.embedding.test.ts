import { describe, expect, it, vi } from "vitest";
import { createMemoryService } from "./service";
import type { MemoryRepository } from "./repository";

describe("MemoryService embeddings", () => {
  it("embeds the query before repository candidate retrieval", async () => {
    const findCandidates = vi.fn(async () => []);
    const repository: MemoryRepository = {
      create: vi.fn(),
      replace: vi.fn(),
      remove: vi.fn(async () => {}),
      findCandidates,
      markAccessed: vi.fn(async () => {}),
    };
    const embedding = {
      id: "test-embedding",
      embed: vi.fn(async () => ({
        providerId: "test-embedding",
        vector: [0.1, 0.2, 0.3],
      })),
    };

    const service = createMemoryService(repository, embedding);

    await service.recall({
      userId: "u1",
      companionId: "c1",
      query: "project",
      limit: 4,
      now: "2026-09-30T00:00:00Z",
    });

    expect(embedding.embed).toHaveBeenCalledWith({ text: "project" });
    expect(findCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "project",
        queryEmbedding: [0.1, 0.2, 0.3],
      }),
    );
  });

  it("rejects invalid provider vectors before repository retrieval", async () => {
    const findCandidates = vi.fn(async () => []);
    const repository: MemoryRepository = {
      create: vi.fn(),
      replace: vi.fn(),
      remove: vi.fn(async () => {}),
      findCandidates,
      markAccessed: vi.fn(async () => {}),
    };
    const embedding = {
      id: "bad",
      embed: vi.fn(async () => ({
        providerId: "bad",
        vector: [Number.NaN],
      })),
    };
    const service = createMemoryService(repository, embedding);

    await expect(
      service.recall({
        userId: "u1",
        companionId: "c1",
        query: "project",
        limit: 4,
        now: "2026-09-30T00:00:00Z",
      }),
    ).rejects.toThrow("Embedding must contain finite values");

    expect(findCandidates).not.toHaveBeenCalled();
  });

  it("keeps lexical retrieval available without an embedding provider", async () => {
    const findCandidates = vi.fn(async () => []);
    const repository: MemoryRepository = {
      create: vi.fn(),
      replace: vi.fn(),
      remove: vi.fn(async () => {}),
      findCandidates,
      markAccessed: vi.fn(async () => {}),
    };

    const service = createMemoryService(repository);

    await service.recall({
      userId: "u1",
      companionId: "c1",
      query: "project",
      limit: 4,
      now: "2026-09-30T00:00:00Z",
    });

    expect(findCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        queryEmbedding: undefined,
      }),
    );
  });
});
