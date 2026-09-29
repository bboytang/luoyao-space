import { describe, expect, it } from "vitest";
import { EmbeddingError, validateEmbedding } from "./embedding";

describe("embedding contract", () => {
  it("accepts finite non-empty vectors", () => {
    expect(() => validateEmbedding([0, 0.5, -1])).not.toThrow();
  });

  it("rejects empty or non-finite vectors", () => {
    expect(() => validateEmbedding([])).toThrow(EmbeddingError);
    expect(() => validateEmbedding([0, Number.NaN])).toThrow(EmbeddingError);
    expect(() => validateEmbedding([0, Number.POSITIVE_INFINITY])).toThrow(
      EmbeddingError,
    );
  });
});
