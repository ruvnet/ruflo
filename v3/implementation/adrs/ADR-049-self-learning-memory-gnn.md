# ADR-049: Self-Learning Memory with GNN & RuVector Integration

**Status:** Implemented
**Date:** 2026-02-08
**Authors:** RuvNet, Claude Flow Team
**Supersedes:** None
**Related:** ADR-048 (Auto Memory Integration), ADR-006 (Unified Memory), ADR-009 (Hybrid Memory Backend)

## Context

ADR-048 established the AutoMemoryBridge for bidirectional sync between Claude Code auto memory files and AgentDB. While this successfully bridges the two systems, it operates as a **passive store** — insights are recorded but the system does not learn from them. Three gaps exist:

1. **No learning pipeline**: The `@claude-flow/neural` package has a fully implemented `NeuralLearningSystem` with SONA, ReasoningBank (4-step RETRIEVE/JUDGE/DISTILL/CONSOLIDATE pipeline), and PatternLearner — but these are completely disconnected from the memory bridge.

2. **No knowledge graph**: `MemoryEntry.references` supports graph relationships between entries, but nothing constructs or queries a graph from them. Insights are flat lists without structural understanding.

3. **No agent scoping**: Claude Code supports 3-scope agent memory directories (project, local, user) for per-agent knowledge isolation, but the bridge only handles the project-level auto memory directory.

## Decision

Extend the AutoMemoryBridge with three new modules:

### 1. LearningBridge (`learning-bridge.ts`)

Connects insights to the neural learning pipeline:

```
Insight Recorded → Begin Trajectory → Record Steps
Insight Accessed → Boost Confidence → Record Step
Consolidate      → Complete Trajectories → JUDGE/DISTILL/CONSOLIDATE
Time Passes      → Decay Confidences
```

- **Optional dependency**: `@claude-flow/neural` is loaded dynamically; when unavailable, all learning operations degrade to no-ops (confidence remains static).
- **Confidence lifecycle**: Entries gain confidence when accessed (+0.03 per access, capped at 1.0) and lose confidence over time (-0.005/hour, floored at 0.1).
- **Consolidation**: Triggered during session-end sync. Completes accumulated trajectories, runs the ReasoningBank pipeline, and updates entry metadata.

### 2. MemoryGraph (`memory-graph.ts`)

Builds an in-memory knowledge graph from entry references and similarity:

```
Build from Backend → Add Nodes → Add Reference Edges
                                → Add Similarity Edges (HNSW)
Compute PageRank   → Power Iteration (d=0.85, convergence=1e-6)
Detect Communities → Label Propagation
Rank with Graph    → alpha * vectorScore + (1-alpha) * normalizedPageRank
```

- **Pure TypeScript**: PageRank via power iteration and community detection via label propagation — no external graph libraries.
- **Graph-aware curation**: `curateIndex()` can prioritize high-PageRank entries for MEMORY.md, ensuring the most connected/influential insights appear first.
- **Edge types**: `reference` (from `MemoryEntry.references`), `similar` (from HNSW search), `temporal`, `co-accessed`, `causal`.

### 3. AgentMemoryScope (`agent-memory-scope.ts`)

Maps Claude Code's 3-scope agent memory system:

```
project: <gitRoot>/.claude/agent-memory/<agentName>/
local:   <gitRoot>/.claude/agent-memory-local/<agentName>/
user:    ~/.claude/agent-memory/<agentName>/
```

- **Knowledge transfer**: High-confidence insights (>0.8) can be transferred between agent scopes, enabling cross-agent learning.
- **Path sanitization**: Agent names are sanitized to prevent path traversal.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code Session                      │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Auto Memory      │  │  Agent Memory     │                │
│  │  (MEMORY.md)      │  │  (3-scope dirs)   │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                      │                           │
│  ┌────────▼──────────────────────▼─────────┐                │
│  │           AutoMemoryBridge               │                │
│  │  ┌──────────────┐  ┌─────────────────┐  │                │
│  │  │ LearningBridge│  │  MemoryGraph    │  │                │
│  │  │  (optional    │  │  (PageRank +    │  │                │
│  │  │   neural)     │  │   communities)  │  │                │
│  │  └──────┬────────┘  └──────┬──────────┘  │                │
│  │         │                  │              │                │
│  │  ┌──────▼──────────────────▼──────────┐  │                │
│  │  │          AgentDB (HNSW)            │  │                │
│  │  │     150x-12,500x faster search     │  │                │
│  │  └────────────────────────────────────┘  │                │
│  └──────────────────────────────────────────┘                │
│           │                                                   │
│  ┌────────▼─────────────────┐                                │
│  │  @claude-flow/neural     │  (optional peer dependency)    │
│  │  - NeuralLearningSystem  │                                │
│  │  - SONA + ReasoningBank  │                                │
│  │  - PatternLearner        │                                │
│  └──────────────────────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

## Integration Points

### AutoMemoryBridge modifications (+70 lines)

- `config.learning?: LearningBridgeConfig` — enables learning
- `config.graph?: MemoryGraphConfig` — enables graph
- `recordInsight()` → calls `learningBridge.onInsightRecorded()`
- `syncToAutoMemory()` → calls `learningBridge.consolidate()` first
- `curateIndex()` → uses `graph.getTopNodes()` for section ordering
- `importFromAutoMemory()` → builds graph from imported entries
- `destroy()` → calls `learningBridge.destroy()`

### Hooks integration

- `session-start` → `importFromAutoMemory()`, build graph
- `session-end` → `consolidate()`, `syncToAutoMemory()`, `curateIndex()`
- `post-task` → `recordInsight()` for task learnings

## Performance Targets

| Operation | Target | Rationale |
|-----------|--------|-----------|
| Graph build (1k nodes) | <200ms | Startup cost, amortized over session |
| PageRank (1k nodes) | <100ms | Power iteration converges fast |
| Consolidation | <500ms | Batch trajectory completion |
| Confidence decay (1k entries) | <50ms | Simple arithmetic per entry |
| Knowledge transfer (20 entries) | <100ms | Query + store operations |

## Testing Strategy

- **TDD London School**: All dependencies mocked (IMemoryBackend, NeuralLearningSystem)
- **Graceful degradation**: Tests verify no-op behavior when `@claude-flow/neural` unavailable
- **Existing tests preserved**: 73 AutoMemoryBridge tests must remain green
- **Target**: 100+ new tests across 3 modules

## File Summary

| Action | File | Lines | Tests |
|--------|------|-------|-------|
| CREATE | `memory/src/learning-bridge.ts` | 453 | — |
| CREATE | `memory/src/learning-bridge.test.ts` | 723 | 56 |
| CREATE | `memory/src/memory-graph.ts` | 392 | — |
| CREATE | `memory/src/memory-graph.test.ts` | 732 | 60 |
| CREATE | `memory/src/agent-memory-scope.ts` | 300 | — |
| CREATE | `memory/src/agent-memory-scope.test.ts` | 613 | 30 |
| MODIFY | `memory/src/auto-memory-bridge.ts` | 953 (+70) | 73 |
| MODIFY | `memory/src/types.ts` | +35 | — |
| MODIFY | `memory/src/index.ts` | +15 | — |

**Total: 219 tests passing in 385ms across 4 test suites**

## Implementation Status

### Phase 1: LearningBridge -- COMPLETED
- [x] `LearningBridge` class with neuralLoader injection (453 lines)
- [x] Trajectory tracking (insight → trajectory mapping)
- [x] Confidence boost on access + time-based decay
- [x] Consolidation pipeline (JUDGE/DISTILL/CONSOLIDATE)
- [x] Pattern search via ReasoningBank
- [x] 56 tests passing (54ms)

### Phase 2: MemoryGraph -- COMPLETED
- [x] `MemoryGraph` class with PageRank + label propagation (392 lines)
- [x] Graph construction from MemoryEntry.references
- [x] Similarity edge auto-creation via HNSW search
- [x] Graph-aware ranking (alpha-blended vector + PageRank)
- [x] BFS neighbor traversal with depth control
- [x] 60 tests passing (24ms)

### Phase 3: AgentMemoryScope -- COMPLETED
- [x] 3-scope path resolution with traversal protection (300 lines)
- [x] `createAgentBridge()` factory for scoped bridges
- [x] `transferKnowledge()` with confidence filtering + content-hash dedup
- [x] `listAgentScopes()` for scope discovery
- [x] 30 tests passing (22ms)

### Phase 4: Integration -- COMPLETED
- [x] AutoMemoryBridge config extended with `learning` and `graph` options
- [x] Wired learningBridge into recordInsight, syncToAutoMemory, destroy
- [x] Wired memoryGraph into importFromAutoMemory, curateIndex
- [x] All exports added to index.ts and types.ts
- [x] 73 existing AutoMemoryBridge tests still passing (no regressions)

## Consequences

### Positive
- Insights now trigger learning trajectories, improving curation over time
- PageRank identifies the most structurally important insights for MEMORY.md
- Agent-scoped memory enables per-agent knowledge isolation and transfer
- Fully optional: all new features degrade gracefully when dependencies unavailable

### Negative
- Additional complexity in AutoMemoryBridge (~70 lines)
- Graph construction adds startup latency (~200ms for 1k entries)
- `@claude-flow/neural` becomes an optional peer dependency

### Risks
- Neural system changes may require LearningBridge updates (mitigated by dynamic import + try/catch)
- Large graphs (>5k nodes) may impact memory usage (mitigated by maxNodes cap)
