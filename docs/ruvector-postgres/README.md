# RuVector PostgreSQL (Repository Assets)

## Implementation Status

- Status: `Partially Implemented`.
- This directory provides Docker, SQL, scripts, and examples for local RuVector PostgreSQL experimentation.
- It is not a managed production deployment; behavior depends on the Docker image and local environment.

## What Exists In This Repo

- `docker-compose.yml` with:
  - `postgres` service (`ruvnet/ruvector-postgres:latest`)
  - optional `pgadmin` profile
  - `scripts/init-db.sql` mounted on container initialization
- `scripts/init-db.sql` with:
  - explicit `CREATE EXTENSION ... VERSION '0.1.0'`
  - `claude_flow` schema
  - core tables and HNSW indexes
  - helper SQL functions
- Operational scripts:
  - `scripts/test-connection.sh`
  - `scripts/run-migrations.sh`
  - `tests/benchmark.sh`
- SQL examples under `examples/*.sql`

## Quick Start (Using Existing Assets)

```bash
# From repository root
docker-compose -f docs/ruvector-postgres/docker-compose.yml up -d

# Verify extension and schema
docker exec ruvector-postgres \
  psql -U claude -d claude_flow \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname = 'ruvector';"
```

## Quick Start (Generate Fresh Assets From CLI)

```bash
cd v3/@claude-flow/cli
npm install
npm run build

# Generate scaffold
node bin/cli.js ruvector setup --output /tmp/ruvector-postgres
```

The setup command writes:

- `docker-compose.yml`
- `README.md`
- `scripts/init-db.sql`

## SQL Surface Summary

### Tables (created by `scripts/init-db.sql`)

- `claude_flow.embeddings`
- `claude_flow.patterns`
- `claude_flow.agents`
- `claude_flow.trajectories`
- `claude_flow.hyperbolic_embeddings`
- `claude_flow.graph_nodes`
- `claude_flow.graph_edges`

### Representative Functions

- `claude_flow.search_similar(...)`
- `claude_flow.search_patterns(...)`
- `claude_flow.find_agents(...)`
- `claude_flow.hyperbolic_search(...)`
- `claude_flow.ruvector_info()`

### Import Path

```bash
# Generate SQL from JSON
node v3/@claude-flow/cli/bin/cli.js ruvector import --input memory-export.json --output import.sql

# Execute manually against container
docker exec -i ruvector-postgres psql -U claude -d claude_flow < import.sql
```

## Validation Scripts

```bash
# Connection and feature checks
bash docs/ruvector-postgres/scripts/test-connection.sh

# SQL migration files from plugin integration path
bash docs/ruvector-postgres/scripts/run-migrations.sh

# Local benchmark harness
bash docs/ruvector-postgres/tests/benchmark.sh
```

## Evidence

- Compose services and init mount: `docs/ruvector-postgres/docker-compose.yml:14`, `docs/ruvector-postgres/docker-compose.yml:26`, `docs/ruvector-postgres/docker-compose.yml:37`
- Extension setup: `docs/ruvector-postgres/scripts/init-db.sql:21`
- Core tables: `docs/ruvector-postgres/scripts/init-db.sql:41`, `docs/ruvector-postgres/scripts/init-db.sql:122`
- HNSW indexes: `docs/ruvector-postgres/scripts/init-db.sql:128`, `docs/ruvector-postgres/scripts/init-db.sql:156`
- Setup command outputs: `v3/@claude-flow/cli/src/commands/ruvector/setup.ts:739`, `v3/@claude-flow/cli/src/commands/ruvector/setup.ts:750`
- Import command upsert behavior: `v3/@claude-flow/cli/src/commands/ruvector/import.ts:91`, `v3/@claude-flow/cli/src/commands/ruvector/import.ts:95`
- Import `--from-memory` limitation: `v3/@claude-flow/cli/src/commands/ruvector/import.ts:246`, `v3/@claude-flow/cli/src/commands/ruvector/import.ts:250`

## Known Limitations

- Benchmark numbers in comments/scripts are not treated as verified repository benchmarks.
- Script compatibility depends on RuVector image capabilities; some commands may degrade to warnings if functions are unavailable.
- CLI bin execution requires `v3/@claude-flow/cli` to be built first (`dist` artifacts).
