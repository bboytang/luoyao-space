import { describe, expect, it, vi } from "vitest";
import { aggregateProjectMemories } from "./project-aggregation";
import type { MemoryRecord } from "./ranking";
import type { MemoryRepository } from "./repository";

describe("aggregateProjectMemories", () => {
  it("aggregates only the requested project scope", async () => {
    const memories: MemoryRecord[] = [{
      id: "m1", userId: "u1", companionId: "c1", kind: "project", projectId: "p1",
      content: "Luoyao Space", importance: 0.9, relationshipRelevance: 0,
      projectRelevance: 1, createdAt: "2026-09-30T00:00:00Z",
    }];
    const repository: MemoryRepository = {
      create: vi.fn(), replace: vi.fn(), remove: vi.fn(), findCandidates: vi.fn(), markAccessed: vi.fn(),
      findProjectMemories: vi.fn(async (input) => input.projectId === "p1" ? memories : []),
    };

    const result = await aggregateProjectMemories(repository, {
      userId: "u1", companionId: "c1", projectId: " p1 ", limit: 10,
    });

    expect(result).toEqual({ projectId: "p1", memoryCount: 1, memories });
    expect(repository.findProjectMemories).toHaveBeenCalledWith({
      userId: "u1", companionId: "c1", projectId: "p1", limit: 10,
    });
  });

  it("rejects an empty project id", async () => {
    const repository = { findProjectMemories: vi.fn() } as unknown as MemoryRepository;
    await expect(aggregateProjectMemories(repository, {
      userId: "u1", companionId: "c1", projectId: "  ",
    })).rejects.toThrow("projectId is required");
    expect(repository.findProjectMemories).not.toHaveBeenCalled();
  });
});
