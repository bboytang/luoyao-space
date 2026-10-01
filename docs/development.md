# Development

## Principles

Keep the repository runnable from the beginning.

A service may start as a library/module before becoming a separately deployed process.

## Local layers

1. protocol packages
2. domain services
3. adapters/runtimes
4. clients

Do not introduce infrastructure complexity before the domain contract is stable.

## Testing

Domain logic must have unit tests.

Realtime and runtime adapters should additionally receive integration tests with deterministic mock providers.

## Secrets

Never commit:

- API keys
- database passwords
- device credentials
- OAuth tokens
- session secrets

Use environment variables or a production secret manager.

## Database migrations

Use the [PostgreSQL migration deployment runbook](deployment/database-migrations.md) for fresh deployments, prerequisites, existing-database adoption and recovery. Do not run the fresh-database path against an existing schema without verified migration history.
