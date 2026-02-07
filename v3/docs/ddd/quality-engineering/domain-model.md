# Quality Engineering Domain Model (Truth-Synced)

## Implementation Status

- Status: `Partially Implemented`.
- This document maps conceptual QE entities to current source-level artifacts.
- It is not a generated domain model from runtime aggregates.

## Source-Backed Model Elements

### 1. Configuration Aggregate (Implemented)

- Root config schema: `PluginConfigSchema`
- Fields include:
  - `version`
  - `namespacePrefix`
  - `enabledContexts`
  - `sandbox`
  - `modelRouting`
  - `performanceTargets`

### 2. Context Mapping Model (Implemented)

- Context mapping is represented in plugin code via mapping initialization and lookup logic.
- Context names align with schema defaults (`test-generation`, `coverage-analysis`, `security-compliance`, etc.).

### 3. Tool Contract Model (Implemented Surface, Partial Behavior)

- Tools are registered as MCP contracts (name/description/input schema/handler).
- Handlers for several tools currently return scaffold payloads.

### 4. Hook Contract Model (Implemented Surface)

- Hook definitions exist and are exposed through plugin hook registration methods.

## Conceptual-Only Elements (Aspirational)

The following are design-level concepts and should not be read as fully implemented entity classes in this repository snapshot:

- Rich aggregate roots for `TestCase`, `CoverageReport`, `QualityGate`, `DefectPrediction`, `ChaosExperiment`.
- End-to-end bounded-context orchestration with complete persistent invariants.

## Evidence

- Plugin config schema root: `v3/plugins/agentic-qe/src/schemas.ts:363`
- Enabled context defaults: `v3/plugins/agentic-qe/src/schemas.ts:366`
- Sandbox policy defaults: `v3/plugins/agentic-qe/src/schemas.ts:327`, `v3/plugins/agentic-qe/src/schemas.ts:332`
- Model routing schema: `v3/plugins/agentic-qe/src/schemas.ts:339`
- MCP tools registration entrypoint: `v3/plugins/agentic-qe/src/plugin.ts:838`
- Hook registration entrypoint: `v3/plugins/agentic-qe/src/plugin.ts:1005`
- Scaffold note in handlers: `v3/plugins/agentic-qe/src/plugin.ts:1123`

## Known Limitations

- Domain model classes in this doc are conceptual unless explicitly traceable to TypeScript runtime artifacts.
- Tool behavior completeness varies by handler; review code before assuming production semantics.
