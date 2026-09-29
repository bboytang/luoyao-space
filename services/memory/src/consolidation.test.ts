import { describe, expect, it } from "vitest";
import { consolidateMemory } from "./consolidation";

const existing = {
  id: "m1",
  userId: "u1",
  companionId: "c1",
  kind: "preference" as const,
  content: "喜欢短回复",
  importance: 0.7,
  relationshipRelevance: 0,
  projectRelevance: 0,
  createdAt: "2026-09-29T00:00:00.000Z",
  embeddingScore: 0.96,
};

describe("memory consolidation", () => {
  it("skips exact duplicates", () => {
    expect(consolidateMemory(
      { kind: "preference", content: "喜欢短回复", importance: 0.8 },
      [existing],
    )).toMatchObject({ action: "skip_duplicate", existingId: "m1" });
  });

  it("replaces a similar durable memory when the candidate is stronger", () => {
    expect(consolidateMemory(
      { kind: "preference", content: "现在更喜欢非常短的回复", importance: 0.9, embeddingScore: 0.95 },
      [existing],
    )).toMatchObject({ action: "replace_existing", existingId: "m1" });
  });

  it("keeps a stronger existing memory", () => {
    expect(consolidateMemory(
      { kind: "preference", content: "回复简短一些就好", importance: 0.5, embeddingScore: 0.94 },
      [existing],
    )).toMatchObject({ action: "keep_both", existingId: "m1" });
  });

  it("stores unrelated memories", () => {
    const unrelatedExisting = { ...existing, embeddingScore: 0.2 };
    expect(consolidateMemory(
      { kind: "preference", content: "喜欢早上聊天", importance: 0.7, embeddingScore: 0.2 },
      [unrelatedExisting],
    )).toEqual({ action: "store", reason: "no_similar_memory" });
  });
});
