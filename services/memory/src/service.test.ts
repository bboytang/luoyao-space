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
      replace: vi.fn(),
      remove: vi.fn(async () => {}),
      findCandidates: vi.fn(async () => records),
      markAccessed: vi.fn(async () => {}),
    };
    const service = createMemoryService(repository);

    const result = await service.recall({
      userId: "u1", companionId: "c1", query: "project", limit: 1,
      now: "2026-09-30T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
    expect(repository.findCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", companionId: "c1", limit: 4 }),
    );
    expect(repository.markAccessed).toHaveBeenCalledWith(
      ["m1"], "2026-09-30T00:00:00Z",
    );
  });

  it("preserves empty recall without attempting access updates", async () => {
    const repository: MemoryRepository = {
      create: vi.fn(), replace: vi.fn(), remove: vi.fn(async () => {}),
      findCandidates: vi.fn(async () => []), markAccessed: vi.fn(async () => {}),
    };
    const service = createMemoryService(repository);

    await expect(service.recall({
      userId: "u1", companionId: "c1", query: "missing", limit: 4,
      now: "2026-09-30T00:00:00Z",
    })).resolves.toEqual([]);

    expect(repository.markAccessed).not.toHaveBeenCalled();
  });

  it("applies write policy before persistence and emits memory.created", async () => {
    const repository: MemoryRepository = {
      create: vi.fn(async (input) => ({
        id: "m1",
        userId: input.userId,
        companionId: input.companionId,
        kind: input.kind,
        content: input.content,
        importance: input.importance ?? 0.5,
        relationshipRelevance: input.relationshipRelevance ?? 0,
        projectRelevance: input.projectRelevance ?? 0,
        createdAt: input.createdAt ?? "2026-09-30T00:00:00Z",
      })),
      replace: vi.fn(),
      remove: vi.fn(),
      findCandidates: vi.fn(async () => []),
      markAccessed: vi.fn(),
    };
    const emitted: string[] = [];
    const service = createMemoryService(repository, undefined, {
      async emit(event) { emitted.push(event.type); },
    });

    const skipped = await service.rememberCandidate({
      userId: "u1", companionId: "c1", userMessage: "普通闲聊",
    });
    expect(skipped.action).toBe("skip");
    expect(repository.create).not.toHaveBeenCalled();

    const stored = await service.rememberCandidate({
      userId: "u1", companionId: "c1", userMessage: "我喜欢无糖茶",
      containsStablePreference: true,
    });
    expect(stored.action).toBe("store");
    if (stored.action !== "store") throw new Error("expected stored memory");
    expect(stored.memory.kind).toBe("preference");
    expect(repository.create).toHaveBeenCalledOnce();
    expect(emitted).toEqual(["memory.created"]);
  });

  it("replaces a similar durable memory and emits memory.updated", async () => {
    const existing: MemoryRecord = {
      id: "m1", userId: "u1", companionId: "c1", kind: "preference",
      content: "我喜欢无糖茶", importance: 0.7, relationshipRelevance: 0,
      projectRelevance: 0, createdAt: "2026-09-29T00:00:00Z", embeddingScore: 0.97,
    };
    const repository: MemoryRepository = {
      create: vi.fn(),
      replace: vi.fn(async (input) => ({
        ...existing,
        content: input.update.content,
        importance: input.update.importance ?? 0.5,
        embeddingScore: undefined,
      })),
      remove: vi.fn(),
      findCandidates: vi.fn(async () => [existing]),
      markAccessed: vi.fn(),
    };
    const emitted: string[] = [];
    const service = createMemoryService(repository, undefined, {
      async emit(event) { emitted.push(event.type); },
    });

    const result = await service.rememberCandidate({
      userId: "u1", companionId: "c1",
      userMessage: "我现在更喜欢无糖咖啡",
      containsStablePreference: true,
    });

    expect(result.action).toBe("replace_existing");
    if (result.action !== "replace_existing") throw new Error("expected replacement");
    expect(result.memory.content).toBe("我现在更喜欢无糖咖啡");
    expect(repository.replace).toHaveBeenCalledOnce();
    expect(emitted).toEqual(["memory.updated"]);
  });

  it("emits memory.deleted when removing a memory", async () => {
    const repository: MemoryRepository = {
      create: vi.fn(), replace: vi.fn(), remove: vi.fn(async () => {}),
      findCandidates: vi.fn(async () => []), markAccessed: vi.fn(),
    };
    const emitted: string[] = [];
    const service = createMemoryService(repository, undefined, {
      async emit(event) { emitted.push(event.type); },
    });

    await service.remove({ userId: "u1", companionId: "c1", memoryId: "m1" });

    expect(repository.remove).toHaveBeenCalledWith({
      userId: "u1", companionId: "c1", memoryId: "m1",
    });
    expect(emitted).toEqual(["memory.deleted"]);
  });

  it("automatically embeds direct writes when a provider is configured", async () => {
    const repository: MemoryRepository = {
      create: vi.fn(async (input) => ({
        id: "m-direct",
        userId: input.userId,
        companionId: input.companionId,
        kind: input.kind,
        content: input.content,
        importance: input.importance ?? 0.5,
        relationshipRelevance: input.relationshipRelevance ?? 0,
        projectRelevance: input.projectRelevance ?? 0,
        createdAt: input.createdAt ?? "2026-09-30T00:00:00Z",
      })),
      replace: vi.fn(),
      remove: vi.fn(),
      findCandidates: vi.fn(async () => []),
      markAccessed: vi.fn(),
    };
    const embed = vi.fn(async ({ text }: { text: string }) => ({
      providerId: "test-provider",
      vector: [0.1, 0.2, 0.3],
    }));

    const service = createMemoryService(repository, {
      id: "test-provider",
      embed,
    });

    await service.remember({
      userId: "u1",
      companionId: "c1",
      kind: "fact",
      content: "喜欢短回复",
    });

    expect(embed).toHaveBeenCalledWith({ text: "喜欢短回复" });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: [0.1, 0.2, 0.3] }),
    );
  });

  it("automatically embeds replacement writes without replacing an explicit vector", async () => {
    const existing: MemoryRecord = {
      id: "m1", userId: "u1", companionId: "c1", kind: "fact",
      content: "旧内容", importance: 0.5, relationshipRelevance: 0,
      projectRelevance: 0, createdAt: "2026-09-30T00:00:00Z",
    };
    const repository: MemoryRepository = {
      create: vi.fn(),
      replace: vi.fn(async (input) => ({
        ...existing,
        content: input.update.content,
      })),
      remove: vi.fn(),
      findCandidates: vi.fn(async () => []),
      markAccessed: vi.fn(),
    };
    const embed = vi.fn(async () => ({
      providerId: "test-provider",
      vector: [0.4, 0.5, 0.6],
    }));
    const service = createMemoryService(repository, { id: "test-provider", embed });

    await service.replace({
      userId: "u1",
      companionId: "c1",
      memoryId: "m1",
      update: {
        userId: "u1",
        companionId: "c1",
        kind: "fact",
        content: "新内容",
      },
    });

    expect(embed).toHaveBeenCalledWith({ text: "新内容" });
    expect(repository.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ embedding: [0.4, 0.5, 0.6] }),
      }),
    );
  });

});
