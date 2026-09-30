export const EMBEDDING_DIMENSION = 1536;

export interface EmbeddingProvider {
  readonly id: string;
  embed(input: { text: string; signal?: AbortSignal }): Promise<EmbeddingResult>;
}

export interface EmbeddingResult {
  providerId: string;
  modelId?: string;
  vector: readonly number[];
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function validateEmbedding(vector: readonly number[]): void {
  if (vector.length !== EMBEDDING_DIMENSION) {
    throw new EmbeddingError(
      `Embedding must contain exactly ${EMBEDDING_DIMENSION} dimensions`,
    );
  }
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new EmbeddingError("Embedding must contain finite values");
  }
}
