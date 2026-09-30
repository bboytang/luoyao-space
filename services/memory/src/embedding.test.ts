import { describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSION, EmbeddingError, validateEmbedding } from "./embedding";

describe("embedding contract", () => {
  it("accepts finite non-empty vectors", () => {
    expect(() => validateEmbedding(Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => index / EMBEDDING_DIMENSION))).not.toThrow();
  });

  it("rejects empty or non-finite vectors", () => {
    expect(() => validateEmbedding([])).toThrow(EmbeddingError);
    expect(() => validateEmbedding(Array(EMBEDDING_DIMENSION - 1).fill(0))).toThrow(
      /exactly 1536 dimensions/,
    );
    expect(() => validateEmbedding(Array(EMBEDDING_DIMENSION + 1).fill(0))).toThrow(
      /exactly 1536 dimensions/,
    );
    const nonFinite = Array(EMBEDDING_DIMENSION).fill(0);
    nonFinite[1] = Number.NaN;
    expect(() => validateEmbedding(nonFinite)).toThrow(EmbeddingError);
    const infinite = Array(EMBEDDING_DIMENSION).fill(0);
    infinite[1] = Number.POSITIVE_INFINITY;
    expect(() => validateEmbedding(infinite)).toThrow(EmbeddingError);
  });
});
