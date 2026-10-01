import type { PoolClient } from "pg";
import { migrationIds } from "./manifest";

type MigrationId = (typeof migrationIds)[number];
type Artifacts = {
  tables?: readonly string[];
  indexes?: readonly string[];
  constraints?: readonly string[];
  columns?: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

// These are the objects created by the immutable SQL files, not an alternative migration order.
// Extend this catalog check when adding a migration that changes the expected schema.
const artifacts: Record<MigrationId, Artifacts> = {
  "001_create_memories.sql": {
    tables: ["memories"],
    indexes: ["memories_pkey", "memories_owner_created_idx", "memories_owner_kind_idx", "memories_embedding_idx"],
    constraints: ["memories_pkey"],
    columns: { memories: {
      id: "uuid", user_id: "text", companion_id: "text", kind: "text", content: "text",
      importance: "double precision", relationship_relevance: "double precision",
      project_relevance: "double precision", created_at: "timestamp with time zone",
      last_accessed_at: "timestamp with time zone", embedding: "vector(1536)",
    } },
  },
  "002_create_agent_tasks.sql": {
    tables: ["agent_tasks"],
    indexes: ["agent_tasks_pkey", "agent_tasks_owner_updated_idx", "agent_tasks_owner_status_idx", "agent_tasks_execution_lease_idx"],
    constraints: ["agent_tasks_pkey"],
    columns: { agent_tasks: {
      task_id: "text", user_id: "text", companion_id: "text", goal: "text", status: "text",
      plan: "jsonb", current_step: "integer", requires_approval: "boolean", approval_status: "text",
      device_id: "text", execution_context: "jsonb", result: "jsonb", error: "text",
      version: "bigint", execution_lease_id: "text",
      execution_lease_expires_at: "timestamp with time zone",
      created_at: "timestamp with time zone", updated_at: "timestamp with time zone",
    } },
  },
  "002_create_tasks.sql": {
    tables: ["tasks"],
    indexes: ["tasks_pkey", "tasks_owner_updated_idx", "tasks_running_lease_idx"],
    constraints: ["tasks_pkey", "tasks_status_check", "tasks_current_step_check", "tasks_approval_status_check", "tasks_version_check"],
    columns: { tasks: {
      task_id: "text", user_id: "text", companion_id: "text", goal: "text", status: "text",
      plan: "jsonb", current_step: "integer", requires_approval: "boolean", approval_status: "text",
      device_id: "text", execution_context: "jsonb", result: "jsonb", error: "text",
      version: "integer", execution_lease_id: "text",
      execution_lease_expires_at: "timestamp with time zone",
      created_at: "timestamp with time zone", updated_at: "timestamp with time zone",
    } },
  },
  "003_create_task_event_log.sql": {
    tables: ["task_event_log"],
    indexes: ["task_event_log_pkey", "task_event_log_task_time_idx", "task_event_log_owner_time_idx"],
    constraints: ["task_event_log_pkey"],
    columns: { task_event_log: {
      event_id: "uuid", task_id: "text", user_id: "text", companion_id: "text",
      event_type: "text", event_version: "integer", occurred_at: "timestamp with time zone",
      source: "text", session_id: "text", data: "jsonb",
    } },
  },
  "004_create_memory_event_queue.sql": {
    tables: ["memory_event_queue"],
    indexes: ["memory_event_queue_pkey", "memory_event_queue_claim_idx", "memory_event_queue_processing_idx"],
    constraints: ["memory_event_queue_pkey", "memory_event_queue_status_check", "memory_event_queue_attempts_check"],
    columns: { memory_event_queue: {
      event_id: "uuid", event_type: "text", payload: "jsonb", status: "text",
      attempts: "integer", available_at: "timestamp with time zone",
      locked_at: "timestamp with time zone", locked_by: "text", last_error: "text",
      processed_at: "timestamp with time zone", created_at: "timestamp with time zone",
      updated_at: "timestamp with time zone",
    } },
  },
  "005_add_memory_project_scope.sql": {
    indexes: ["memories_project_scope_idx"],
    columns: { memories: { project_id: "text" } },
  },
};

const indexDefinitions: Readonly<Record<string, string>> = {
  memories_pkey: "CREATE UNIQUE INDEX memories_pkey ON memories USING btree (id)",
  memories_owner_created_idx: "CREATE INDEX memories_owner_created_idx ON memories USING btree (user_id, companion_id, created_at DESC)",
  memories_owner_kind_idx: "CREATE INDEX memories_owner_kind_idx ON memories USING btree (user_id, companion_id, kind)",
  memories_embedding_idx: "CREATE INDEX memories_embedding_idx ON memories USING hnsw (embedding vector_cosine_ops) WHERE (embedding IS NOT NULL)",
  agent_tasks_pkey: "CREATE UNIQUE INDEX agent_tasks_pkey ON agent_tasks USING btree (task_id)",
  agent_tasks_owner_updated_idx: "CREATE INDEX agent_tasks_owner_updated_idx ON agent_tasks USING btree (user_id, companion_id, updated_at DESC)",
  agent_tasks_owner_status_idx: "CREATE INDEX agent_tasks_owner_status_idx ON agent_tasks USING btree (user_id, companion_id, status)",
  agent_tasks_execution_lease_idx: "CREATE INDEX agent_tasks_execution_lease_idx ON agent_tasks USING btree (status, execution_lease_expires_at) WHERE (status = 'RUNNING'::text)",
  tasks_pkey: "CREATE UNIQUE INDEX tasks_pkey ON tasks USING btree (task_id)",
  tasks_owner_updated_idx: "CREATE INDEX tasks_owner_updated_idx ON tasks USING btree (user_id, companion_id, updated_at DESC)",
  tasks_running_lease_idx: "CREATE INDEX tasks_running_lease_idx ON tasks USING btree (status, execution_lease_expires_at) WHERE (status = 'RUNNING'::text)",
  task_event_log_pkey: "CREATE UNIQUE INDEX task_event_log_pkey ON task_event_log USING btree (event_id)",
  task_event_log_task_time_idx: "CREATE INDEX task_event_log_task_time_idx ON task_event_log USING btree (task_id, occurred_at)",
  task_event_log_owner_time_idx: "CREATE INDEX task_event_log_owner_time_idx ON task_event_log USING btree (user_id, companion_id, occurred_at DESC)",
  memory_event_queue_pkey: "CREATE UNIQUE INDEX memory_event_queue_pkey ON memory_event_queue USING btree (event_id)",
  memory_event_queue_claim_idx: "CREATE INDEX memory_event_queue_claim_idx ON memory_event_queue USING btree (status, available_at, created_at)",
  memory_event_queue_processing_idx: "CREATE INDEX memory_event_queue_processing_idx ON memory_event_queue USING btree (status, locked_at)",
  memories_project_scope_idx: "CREATE INDEX memories_project_scope_idx ON memories USING btree (user_id, companion_id, project_id, created_at DESC) WHERE (project_id IS NOT NULL)",
};

const constraintDefinitions: Readonly<Record<string, string>> = {
  memories_pkey: "PRIMARY KEY (id)",
  agent_tasks_pkey: "PRIMARY KEY (task_id)",
  tasks_pkey: "PRIMARY KEY (task_id)",
  tasks_status_check: "CHECK ((status = ANY (ARRAY['PENDING'::text, 'PLANNING'::text, 'WAITING_APPROVAL'::text, 'RUNNING'::text, 'WAITING_USER'::text, 'COMPLETED'::text, 'FAILED'::text, 'PAUSED'::text, 'CANCELLED'::text])))",
  tasks_current_step_check: "CHECK ((current_step >= 0))",
  tasks_approval_status_check: "CHECK (((approval_status IS NULL) OR (approval_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]))))",
  tasks_version_check: "CHECK ((version > 0))",
  task_event_log_pkey: "PRIMARY KEY (event_id)",
  memory_event_queue_pkey: "PRIMARY KEY (event_id)",
  memory_event_queue_status_check: "CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text])))",
  memory_event_queue_attempts_check: "CHECK ((attempts >= 0))",
};

const notNullColumns = new Set([
  "memories.id", "memories.user_id", "memories.companion_id", "memories.kind",
  "memories.content", "memories.importance", "memories.relationship_relevance",
  "memories.project_relevance", "memories.created_at",
  "agent_tasks.task_id", "agent_tasks.user_id", "agent_tasks.companion_id",
  "agent_tasks.goal", "agent_tasks.status", "agent_tasks.plan", "agent_tasks.current_step",
  "agent_tasks.requires_approval", "agent_tasks.version", "agent_tasks.created_at", "agent_tasks.updated_at",
  "tasks.task_id", "tasks.user_id", "tasks.companion_id", "tasks.goal", "tasks.status",
  "tasks.plan", "tasks.current_step", "tasks.requires_approval", "tasks.version",
  "tasks.created_at", "tasks.updated_at",
  "task_event_log.event_id", "task_event_log.task_id", "task_event_log.user_id",
  "task_event_log.companion_id", "task_event_log.event_type", "task_event_log.event_version",
  "task_event_log.occurred_at", "task_event_log.source", "task_event_log.data",
  "memory_event_queue.event_id", "memory_event_queue.event_type", "memory_event_queue.payload",
  "memory_event_queue.status", "memory_event_queue.attempts", "memory_event_queue.available_at",
  "memory_event_queue.created_at", "memory_event_queue.updated_at",
]);

const columnDefaults: Readonly<Record<string, string>> = {
  "memories.id": "gen_random_uuid()",
  "memories.importance": "0.5",
  "memories.relationship_relevance": "0",
  "memories.project_relevance": "0",
  "memories.created_at": "now()",
  "agent_tasks.version": "1",
  "task_event_log.event_id": "gen_random_uuid()",
  "memory_event_queue.status": "'pending'::text",
  "memory_event_queue.attempts": "0",
  "memory_event_queue.available_at": "now()",
  "memory_event_queue.created_at": "now()",
  "memory_event_queue.updated_at": "now()",
};

export type SchemaCatalog = {
  relations: Map<string, string>;
  indexes: Map<string, string>;
  constraints: Map<string, string>;
  columns: Map<string, { type: string; notNull: boolean; defaultExpr: string | null }>;
};

export async function assertHistoryTableShape(client: PoolClient, schema: string): Promise<void> {
  const result = await client.query<{
    attname: string;
    data_type: string;
    attnotnull: boolean;
    default_expr: string | null;
  }>(`
    SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relname = 'schema_migrations'
      AND a.attnum > 0 AND NOT a.attisdropped
  `, [schema]);
  const columns = new Map(result.rows.map((row) => [row.attname, row]));
  for (const [name, type] of [
    ["migration_id", "text"],
    ["checksum", "text"],
    ["applied_at", "timestamp with time zone"],
  ] as const) {
    const column = columns.get(name);
    if (!column || column.data_type !== type || !column.attnotnull ||
        (name === "applied_at" && column.default_expr !== "now()")) {
      throw new Error(`Migration history table schema mismatch: ${name}`);
    }
  }
  const primaryKey = await client.query<{ definition: string }>(`
    SELECT pg_catalog.pg_get_constraintdef(k.oid) AS definition
    FROM pg_catalog.pg_constraint AS k
    JOIN pg_catalog.pg_class AS c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = 'schema_migrations' AND k.contype = 'p'
  `, [schema]);
  if (primaryKey.rows.length !== 1 || primaryKey.rows[0]?.definition !== "PRIMARY KEY (migration_id)") {
    throw new Error("Migration history table schema mismatch: migration_id primary key");
  }
}

export async function readSchemaCatalog(client: PoolClient, schema: string): Promise<SchemaCatalog> {
  const relations = await client.query<{ relname: string; relkind: string }>(`
    SELECT c.relname, c.relkind
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'i', 'I')
  `, [schema]);
  const indexes = await client.query<{ index_name: string; definition: string }>(`
    SELECT c.relname AS index_name,
           pg_catalog.replace(pg_catalog.pg_get_indexdef(c.oid), pg_catalog.quote_ident($1) || '.', '') AS definition
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind IN ('i', 'I')
  `, [schema]);
  const constraints = await client.query<{ constraint_name: string; definition: string }>(`
    SELECT c.conname AS constraint_name, pg_catalog.pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.connamespace
    WHERE n.nspname = $1
  `, [schema]);
  const columns = await client.query<{
    table_name: string; column_name: string; data_type: string;
    not_null: boolean; default_expr: string | null;
  }>(`
    SELECT c.relname AS table_name, a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS not_null,
           pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped
  `, [schema]);
  return {
    relations: new Map(relations.rows.map((row) => [row.relname, row.relkind])),
    indexes: new Map(indexes.rows.map((row) => [row.index_name, row.definition])),
    constraints: new Map(constraints.rows.map((row) => [row.constraint_name, row.definition])),
    columns: new Map(columns.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      { type: row.data_type, notNull: row.not_null, defaultExpr: row.default_expr },
    ])),
  };
}

export function assertSchemaMatchesHistory(catalog: SchemaCatalog, appliedCount: number): void {
  const expectedColumns = new Set<string>();
  const ownedTables = new Set<string>();
  for (const [index, id] of migrationIds.entries()) {
    const expected = artifacts[id];
    const applied = index < appliedCount;
    for (const name of expected.tables ?? []) {
      if (applied) ownedTables.add(name);
      const actual = catalog.relations.get(name);
      if (applied ? actual !== "r" : actual !== undefined) {
        throw new Error(`Schema/history mismatch: table ${name} is ${actual ?? "missing"} for ${id}`);
      }
    }
    for (const name of expected.indexes ?? []) {
      const actual = catalog.relations.get(name);
      const definition = catalog.indexes.get(name);
      if (applied ? actual !== "i" || definition !== indexDefinitions[name] : actual !== undefined) {
        throw new Error(`Schema/history mismatch: index ${name} is ${actual ?? "missing"} for ${id}`);
      }
    }
    for (const name of expected.constraints ?? []) {
      const actual = catalog.constraints.get(name);
      if (applied ? actual !== constraintDefinitions[name] : actual !== undefined) {
        throw new Error(`Schema/history mismatch: constraint ${name} is ${actual ?? "missing"} for ${id}`);
      }
    }
    for (const [table, columns] of Object.entries(expected.columns ?? {})) {
      for (const [column, type] of Object.entries(columns)) {
        const key = `${table}.${column}`;
        if (applied) expectedColumns.add(key);
        const actual = catalog.columns.get(key);
        if (applied
          ? !actual || actual.type !== type || actual.notNull !== notNullColumns.has(key) ||
            actual.defaultExpr !== (columnDefaults[key] ?? null)
          : actual !== undefined) {
          throw new Error(`Schema/history mismatch: ${key} is ${actual?.type ?? "missing"}, expected ${applied ? type : "absent"} for ${id}`);
        }
      }
    }
  }
  for (const key of catalog.columns.keys()) {
    if (ownedTables.has(key.slice(0, key.indexOf("."))) && !expectedColumns.has(key)) {
      throw new Error(`Schema/history mismatch: untracked column ${key}`);
    }
  }
}
