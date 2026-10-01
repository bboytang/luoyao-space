# PostgreSQL migration deployment runbook

This runbook covers the six SQL migrations in `database/migrations/manifest.ts`. The manifest's full filenames are immutable IDs and its array is the execution order. `pnpm db:migrate` is the only repository migration entry point. It uses one PostgreSQL connection, an advisory lock, per-migration transactions, SHA-256 checksums, and `schema_migrations` in the target schema. CI exercises a fresh PostgreSQL 17 + pgvector database and a no-op rerun.

This is **not** an automatic existing-database adoption tool. No production database has been inspected or baselined by this repository work.

## Prerequisites and trust boundary

- Use PostgreSQL 17 with the pgvector extension package available on the server. Confirm the actual server version and available `vector` version for the target database; the CI image is `pgvector/pgvector:pg17`. The SQL also requests `pgcrypto`.
- `001_create_memories.sql` contains `CREATE EXTENSION IF NOT EXISTS vector` and `pgcrypto`. PostgreSQL requires elevated privileges to install an untrusted extension; `pgcrypto` is trusted in the standard PostgreSQL distribution, while the local pgvector 0.8.6 package reports `superuser=true, trusted=false`. A restricted migration role can run the existing SQL only after an authorized operator has installed unavailable/untrusted extensions in that database, or when the hosting provider explicitly grants equivalent installation authority. `IF NOT EXISTS` does **not** verify the version or definition of an already installed extension. Check both extensions' installed version and schema before proceeding. See the [PostgreSQL 17 CREATE EXTENSION documentation](https://www.postgresql.org/docs/17/sql-createextension.html) and [trusted-extension list](https://www.postgresql.org/docs/17/contrib.html).
- Use a dedicated migration role with the privileges needed to create/alter objects in the target schema; do not give the runtime application role those DDL/extension privileges. Install extensions only in schemas where untrusted roles cannot create objects. Review database-level `CREATE` permission separately from schema-level `CREATE` permission.
- The historical SQL uses unqualified table, index, type and extension names. The **first existing schema** in `search_path` is the target for new objects and history. Set and inspect an explicit path containing the intended target schema and the schema holding `vector`; do not rely on the default `"$user", public` path. Keep untrusted writable schemas out of the path. The runner rejects temporary/system target schemas, but it cannot decide which ordinary schema the operator intended. See [PostgreSQL 17 schema and search-path rules](https://www.postgresql.org/docs/17/ddl-schemas.html).
- The operator must stop concurrent application DDL and establish a maintenance/deployment window. The advisory lock serializes this runner with itself, not arbitrary SQL clients.

Read-only preflight examples (with `DATABASE_URL` injected by the deployment secret manager, not committed):

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'SHOW server_version'
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'SHOW search_path'
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'SELECT current_schema() AS target_schema'
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT name, default_version FROM pg_available_extensions WHERE name IN ('vector', 'pgcrypto')"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT extname, extversion, extnamespace::regnamespace AS extension_schema FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')"
```

## Fresh database / empty target schema

1. Provision the target database/schema and roles. Have an authorized operator preinstall extensions when the migration role cannot create them. Verify that the `vector` type/operator class will be visible in the chosen `search_path`.
2. Confirm that the intended target schema has no existing user relations and no `schema_migrations` table. The runner conservatively rejects any non-empty target schema without history. If it is not empty, use the existing-database procedure below; do not force the fresh path.
3. Take the deployment snapshot/backup required by the environment. Set `DATABASE_URL` and an explicit `search_path` for the migration process (for example, via `PGOPTIONS='-c search_path=luoyao,extensions'` after both schema names and privileges have been verified).
4. Run `pnpm db:migrate`. All manifest entries must apply in the listed order. Run it again and require `0 applied` with every existing entry skipped. Then run the repository's typecheck, tests and build gates before starting application processes.
5. Inspect the state as described below. Preserve the migration logs and backup reference with the deployment record.

Each SQL file and its history insert commit together. A failure rolls back that file, but earlier committed files remain; there is no automatic down-migration.

## Existing database without history: operator-controlled adoption only

Absence of `schema_migrations` does **not** prove that the six SQL files have never run. The runner refuses a non-empty target schema without history, and it does not create the history table in that case. An empty history table with existing migration objects is also refused. Do not delete objects or history merely to make the runner proceed.

1. Freeze writes and DDL. Record the database identity, target schema, extension versions/schemas, application release, and any prior deployment or SQL execution evidence.
2. Create a consistent full-database backup (for example, `pg_dump -Fc`) and verify restoration into an isolated clone. A schema-only dump is useful for comparison but is **not** a data backup. See [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).
3. On the clone, inventory tables, columns/types/defaults/nullability, constraints, indexes, data dependencies and extensions. Compare the actual schema and historical deployment evidence against **each full filename in manifest order**, including both distinct `002_*.sql` files. `CREATE ... IF NOT EXISTS` succeeding is not proof of equivalence.
4. If the operator can prove an exact, contiguous applied prefix and independently verify the corresponding schema, prepare a reviewed, deployment-specific baseline transaction. It must use the same `schema_migrations` shape, each exact manifest ID, the SHA-256 digest of that immutable SQL file, and an `applied_at` value supported by deployment evidence. Compute digests from the exact release files; obtain a second review of the evidence and SQL. Hold the runner's advisory lock (`pg_advisory_lock(1789660832)` on the same database, released after commit) and prevent concurrent DDL while recording the baseline. **There is no repository command that guesses or inserts baseline rows.**
5. Rehearse the reviewed transaction and `pnpm db:migrate` on the restored clone first. Only then repeat the approved procedure on the target and verify it. If historical application time or schema equivalence cannot be established, do **not** invent timestamps, checksums or history rows: stop for an explicit remediation/architecture decision.

The runner checks history IDs as a contiguous manifest prefix, verifies recorded checksums, and compares migration-owned tables, column types/nullability/defaults, constraints and index definitions for applied versus pending migrations. These catalog checks do not establish historical provenance or verify data, ownership, grants, triggers, row-level security or extension implementation. They do not replace the operator's full schema/data review before a baseline.

## Existing database with history

Do not edit applied SQL, reorder the manifest, remove history rows or backfill gaps. A checksum mismatch, unknown/non-prefix history ID, malformed history table, or known schema/history structural mismatch is a stop condition. Investigate against backup and deployment records; repair only under a separately reviewed plan. A migration present in history but absent from the actual schema must not be silently replayed.

## Post-deployment verification and recovery

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'SELECT current_schema() AS target_schema'
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'SELECT migration_id, checksum, applied_at FROM schema_migrations ORDER BY applied_at, migration_id'
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT extname, extversion, extnamespace::regnamespace AS extension_schema FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')"
sha256sum database/migrations/*.sql
```

Compare the returned IDs and checksums to the release's manifest and SQL bytes by **full filename**, not just the row count or shell glob order. A second `pnpm db:migrate` is an execution command, not a read-only status check: run it only within the controlled migration window after checking the recorded state, and require `0 applied` with all current manifest entries skipped. Verify representative application reads/writes before ending the maintenance window.

If deployment fails, leave history intact and stop application rollout. The failing migration's transaction is rolled back, but earlier migrations may have committed. Do not run ad hoc inverse SQL or delete history rows. Assess the committed prefix and either fix forward under review or restore the verified backup, including both schema and data, using the environment's recovery procedure. Re-run the read-only inventory and migration-state checks after recovery.
