# Quality Engineering Integration Points (Truth-Synced)

## Implementation Status

- Status: `Partially Implemented`.
- Integration contracts are present in plugin interfaces and lifecycle methods.
- Several downstream behaviors remain scaffolded.

## Implemented Integration Contracts

### 1. Plugin Registry Integration

The QE plugin registers tools, hooks, workers, and agents through the host plugin registry interfaces.

### 2. Plugin Context Service Integration

The plugin context exposes optional service slots used by QE:

- `memory`
- `security`
- `embeddings`
- `modelRouter`
- `hiveMind`
- `ui`

### 3. Memory Integration

- Namespaces follow `aqe/v3/*` conventions.
- Initialization attempts to provision namespaces.
- Shutdown cleanup targets temporary namespace(s) such as `aqe/v3/coverage-data`.

### 4. Security Integration

`aqe/security-scan` validates target paths via optional security module hooks before proceeding.

### 5. Interactive Safety Integration

`aqe/chaos-inject` requires user confirmation when `dryRun` is disabled and UI service is available.

## Flow Summary

1. Host loads plugin and calls `register`.
2. Plugin exports MCP tools/hooks/workers/agents contracts.
3. Host calls `initialize` with services/config.
4. Plugin configures mapper/sandbox/namespaces.
5. Tool handlers execute against available services.

## Evidence

- Context service contract: `v3/plugins/agentic-qe/src/plugin.ts:64`, `v3/plugins/agentic-qe/src/plugin.ts:72`
- Registry registration paths: `v3/plugins/agentic-qe/src/plugin.ts:662`, `v3/plugins/agentic-qe/src/plugin.ts:694`
- Initialization and context wiring: `v3/plugins/agentic-qe/src/plugin.ts:709`, `v3/plugins/agentic-qe/src/plugin.ts:725`
- Memory namespace lifecycle: `v3/plugins/agentic-qe/src/plugin.ts:729`, `v3/plugins/agentic-qe/src/plugin.ts:757`
- Security path validation in handler: `v3/plugins/agentic-qe/src/plugin.ts:1158`, `v3/plugins/agentic-qe/src/plugin.ts:1164`
- Chaos confirmation gate: `v3/plugins/agentic-qe/src/plugin.ts:1269`, `v3/plugins/agentic-qe/src/plugin.ts:1276`
- Integration/bridge tests exist: `v3/plugins/agentic-qe/__tests__/bridges.test.ts:1`

## Known Limitations

- Many tool handlers return scaffold payloads (`Full implementation requires agentic-qe package`).
- End-to-end host integration depends on runtime services outside this plugin package.
