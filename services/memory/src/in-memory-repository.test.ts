import { describe, expect, it } from "vitest";
import { InMemoryMemoryRepository } from "./in-memory-repository";

describe("InMemoryMemoryRepository", () => {
  it("isolates memories by user and companion", async () => {
    const repository = new InMemoryMemoryRepository();

    await repository.create({
      userId: "u1",
      companionId: "c1",
      kind: "fact",
      content: "shared history",
    });
    await repository.create({
      userId: "u2",
      companionId: "c1",
      kind: "fact",
      content: "shared history",
    });

    const result = await repository.findCandidates({
      userId: "u1",
      companionId: "c1",
      query: "shared",
      limit: 10,
      now: "2026-09-30T00:00:00Z",
      relationshipWeight: 1,
      projectWeight: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe("u1");
  });

  it("creates defaults and records access timestamps", async () => {
    const repository = new InMemoryMemoryRepository();

    const created = await repository.create({
      userId: "u1",
      companionId: "c1",
      kind: "preference",
      content: "喜欢短回复",
    });

    expect(created.importance).toBe(0.5);
    expect(created.relationshipRelevance).toBe(0);
    expect(created.projectRelevance).toBe(0);

    await repository.markAccessed([created.id], "2026-09-30T00:00:00Z");

    const result = await repository.findCandidates({
      userId: "u1",
      companionId: "c1",
      query: "短回复",
      limit: 10,
      now: "2026-09-30T00:00:00Z",
      relationshipWeight: 1,
      projectWeight: 1,
    });

    expect(result[0].lastAccessedAt).toBe("2026-09-30T00:00:00Z");
  });

  it("does not return more candidates than requested", async () => {
    const repository = new InMemoryMemoryRepository();

    for (let i = 0; i < 3; i += 1) {
      await repository.create({
        userId: "u1",
        companionId: "c1",
        kind: "event",
        content: "project event",
      });
    }

    const result = await repository.findCandidates({
      userId: "u1",
      companionId: "c1",
      query: "project",
      limit: 2,
      now: "2026-09-30T00:00:00Z",
      relationshipWeight: 1,
      projectWeight: 1,
    });

    expect(result).toHaveLength(2);
  });
});
