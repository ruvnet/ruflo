# Coherence Engine Integration Points (Truth-Synced)

## Implementation Status

- Status: `Partially Implemented`.
- Integration hooks and MCP tool contracts are implemented in plugin source.
- Advanced runtime guarantees depend on external WASM/runtime availability.

## Implemented Integration Paths

### 1. Memory Integration

- During initialization, if memory service exists, the plugin registers a pre-store hook.
- The hook validates coherence and can reject contradictory entries.

### 2. MCP Tool Integration

The plugin exposes MCP tools for:

- coherence checking (`pr_coherence_check`)
- spectral analysis (`pr_spectral_analyze`)
- causal inference (`pr_causal_infer`)
- consensus verification (`pr_consensus_verify`)
- topology analysis (`pr_quantum_topology`)
- memory gate validation (`pr_memory_gate`)

### 3. Hook Integration

The plugin exports hooks for:

- `pre-memory-store`
- `pre-consensus`
- `post-task` (swarm-related)
- `pre-rag-retrieval`

### 4. Hive-Mind and Memory Metrics Integration

When host services are present, post-task hook logic can:

- pull agent states from `hiveMind`
- compute spectral stability
- persist metrics in memory namespace `pr/stability-metrics`

## Evidence

- Initialization + memory pre-store hook registration: `v3/plugins/prime-radiant/src/plugin.ts:649`, `v3/plugins/prime-radiant/src/plugin.ts:655`
- MCP tool registration list: `v3/plugins/prime-radiant/src/plugin.ts:710`, `v3/plugins/prime-radiant/src/plugin.ts:717`
- Hook registration list: `v3/plugins/prime-radiant/src/plugin.ts:724`, `v3/plugins/prime-radiant/src/plugin.ts:729`
- Hook implementations:
  - pre-memory-store: `v3/plugins/prime-radiant/src/plugin.ts:1088`
  - pre-consensus: `v3/plugins/prime-radiant/src/plugin.ts:1122`
  - post-swarm-task: `v3/plugins/prime-radiant/src/plugin.ts:1158`
  - pre-rag-retrieval: `v3/plugins/prime-radiant/src/plugin.ts:1226`
- Swarm stability metric persistence: `v3/plugins/prime-radiant/src/plugin.ts:1198`, `v3/plugins/prime-radiant/src/plugin.ts:1203`

## Known Limitations

- Hook execution depends on host runtime wiring and available services (`memory`, `hiveMind`, etc.).
- Coherence quality depends on bridge implementation mode (real WASM vs mock fallback).
- This document does not claim production-level mathematical validation guarantees.
