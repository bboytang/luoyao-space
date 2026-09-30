import { validateEmbedding } from "./embedding";
import type { MemoryKind, MemoryRecord } from "./ranking";
import type { CreateMemoryInput, MemoryCandidateQuery, MemoryRepository } from "./repository";

export interface SqlQueryResult<Row> {
  rows: Row[];
}

export interface SqlClient {
  query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
}

interface MemoryRow {
  id: string;
  user_id: string;
  companion_id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  relationship_relevance: number;
  project_relevance: number;
  project_id: string | null;
  created_at: string;
  last_accessed_at: string | null;
  embedding_score: number | null;
}

function toRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    companionId: row.companion_id,
    kind: row.kind,
    content: row.content,
    importance: Number(row.importance),
    relationshipRelevance: Number(row.relationship_relevance),
    projectRelevance: Number(row.project_relevance),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    createdAt: row.created_at,
    ...(row.last_accessed_at ? { lastAccessedAt: row.last_accessed_at } : {}),
    ...(row.embedding_score !== null ? { embeddingScore: Number(row.embedding_score) } : {}),
  };
}

function vectorLiteral(vector: readonly number[]): string {
  validateEmbedding(vector);
  return "[" + vector.join(",") + "]";
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly client: SqlClient) {}

  async create(input: CreateMemoryInput): Promise<MemoryRecord> {
    const result = await this.client.query<MemoryRow>(
      "INSERT INTO memories (user_id, companion_id, kind, content, importance, relationship_relevance, project_relevance, created_at, embedding) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,now()),$9::vector) RETURNING id,user_id,companion_id,kind,content,importance,relationship_relevance,project_relevance,project_id,created_at::text,last_accessed_at::text,NULL::double precision AS embedding_score",
      [
        input.userId,
        input.companionId,
        input.kind,
        input.content,
        input.importance ?? 0.5,
        input.relationshipRelevance ?? 0,
        input.projectRelevance ?? 0,
        input.createdAt ?? null,
        input.embedding ? vectorLiteral(input.embedding) : null,
        input.projectId ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Memory insert returned no row");
    return toRecord(row);
  }

  async replace(input: { userId: string; companionId: string; memoryId: string; update: CreateMemoryInput }): Promise<MemoryRecord> {
    const result = await this.client.query<MemoryRow>(
      "UPDATE memories SET kind=$4,content=$5,importance=$6,relationship_relevance=$7,project_relevance=$8,created_at=COALESCE($9::timestamptz,now()),embedding=$10::vector,project_id=$11 WHERE id=$1::uuid AND user_id=$2 AND companion_id=$3 RETURNING id,user_id,companion_id,kind,content,importance,relationship_relevance,project_relevance,created_at::text,last_accessed_at::text,NULL::double precision AS embedding_score",
      [input.memoryId,input.userId,input.companionId,input.update.kind,input.update.content,input.update.importance ?? 0.5,input.update.relationshipRelevance ?? 0,input.update.projectRelevance ?? 0,input.update.createdAt ?? null,input.update.embedding ? vectorLiteral(input.update.embedding) : null,input.update.projectId ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Memory not found");
    return toRecord(row);
  }

  async remove(input: { userId: string; companionId: string; memoryId: string }): Promise<void> {
    await this.client.query(
      "DELETE FROM memories WHERE id=$1::uuid AND user_id=$2 AND companion_id=$3",
      [input.memoryId,input.userId,input.companionId],
    );
  }

  async findCandidates(query: MemoryCandidateQuery): Promise<MemoryRecord[]> {
    const embedding = query.queryEmbedding ? vectorLiteral(query.queryEmbedding) : null;
    const result = await this.client.query<MemoryRow>(
      "SELECT id,user_id,companion_id,kind,content,importance,relationship_relevance,project_relevance,created_at::text,last_accessed_at::text,CASE WHEN $6::vector IS NULL OR embedding IS NULL THEN 0 ELSE 1-(embedding <=> $6::vector) END AS embedding_score FROM memories WHERE user_id=$1 AND companion_id=$2 AND ($6::vector IS NOT NULL OR $3 = '' OR content ILIKE '%' || $3 || '%') ORDER BY CASE WHEN $6::vector IS NULL OR embedding IS NULL THEN 0 ELSE 1-(embedding <=> $6::vector) END DESC, created_at DESC LIMIT $4",
      [query.userId, query.companionId, query.query.trim(), query.limit, query.now, embedding],
    );
    return result.rows.map(toRecord);
  }

  async findProjectMemories(input: { userId: string; companionId: string; projectId: string; limit: number }): Promise<MemoryRecord[]> {
    const result = await this.client.query<MemoryRow>(
      "SELECT id,user_id,companion_id,kind,content,importance,relationship_relevance,project_relevance,project_id,created_at::text,last_accessed_at::text,NULL::double precision AS embedding_score FROM memories WHERE user_id=$1 AND companion_id=$2 AND project_id=$3 ORDER BY importance DESC, created_at DESC LIMIT $4",
      [input.userId, input.companionId, input.projectId, input.limit],
    );
    return result.rows.map(toRecord);
  }

  async markAccessed(memoryIds: readonly string[], accessedAt: string): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.client.query(
      "UPDATE memories SET last_accessed_at=$2::timestamptz WHERE id=ANY($1::uuid[])",
      [memoryIds, accessedAt],
    );
  }
}
