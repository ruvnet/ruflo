# ADR-042: Gas Town & Beads Analysis - Lessons for Claude Flow V3

## Status
**Research** - Comparative Analysis (2026-01-24)

## Date
2026-01-24

## Authors
- Architecture Research Team

## Context

Steve Yegge released [Gas Town](https://github.com/steveyegge/gastown) on January 1, 2026, a multi-agent orchestration system built on top of [Beads](https://github.com/steveyegge/beads), his git-backed issue tracker. This ADR analyzes these systems and identifies lessons applicable to Claude Flow V3.

## Source Material

- [Welcome to Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) - Steve Yegge, Jan 2026
- [Gas Town GitHub](https://github.com/steveyegge/gastown) - 75k lines of Go
- [Beads GitHub](https://github.com/steveyegge/beads) - 225k lines of Go, 11.1k stars

## Gas Town Architecture Summary

### Core Philosophy

Gas Town operates on the principle that **sessions are ephemeral cattle; agents are persistent identities**. This is the inverse of how most orchestrators work.

| Concept | Gas Town | Claude Flow V3 |
|---------|----------|----------------|
| Session Persistence | Cattle (disposable) | Cattle (disposable) |
| Agent Identity | Pets (persistent in Git) | Pets (persistent in memory) |
| Work Storage | Git-backed Beads | AgentDB + SQLite |
| Orchestration | Hierarchical (Mayor → Workers) | Hierarchical/Mesh hybrid |

### The MEOW Stack (Molecular Expression of Work)

```
Formulas (TOML) → Protomolecules → Molecules → Wisps
     ↓                  ↓              ↓          ↓
 Templates         Classes        Instances   Ephemeral
```

1. **Beads** - Atomic work units (issues) stored in Git as JSONL
2. **Epics** - Beads with children, forming tree structures
3. **Molecules** - Chained beads forming workflows (Turing-complete)
4. **Protomolecules** - Templates for molecules with variable substitution
5. **Formulas** - TOML source for workflows, "cooked" into protomolecules
6. **Wisps** - Ephemeral beads for orchestration (not persisted to Git)

### Worker Roles

| Role | Function | Claude Flow Equivalent |
|------|----------|----------------------|
| **Mayor** | Main coordinator, concierge | `hierarchical-coordinator` |
| **Polecats** | Ephemeral workers for swarms | Task tool agents |
| **Refinery** | Merge Queue manager | N/A (opportunity) |
| **Witness** | Polecat supervisor | `swarm-memory-manager` |
| **Deacon** | Daemon beacon, patrol runner | Daemon workers |
| **Dogs** | Deacon's helpers | Background workers |
| **Crew** | Long-lived personal workers | Named agents |
| **Overseer** | Human operator | User |

### Key Innovations

#### 1. GUPP (Gastown Universal Propulsion Principle)
"If there is work on your hook, YOU MUST RUN IT."

Every worker has a persistent "hook" (a special bead) where work is queued. This ensures:
- Work survives agent crashes
- Automatic continuation on restart
- Durable workflow execution

#### 2. Nondeterministic Idempotence (NDI)
Unlike Temporal's deterministic replay, Gas Town achieves durability through:
- Persistent agent identities (Beads in Git)
- Persistent hooks (Beads in Git)
- Persistent molecules (chains of Beads)

Even if the path is nondeterministic, the outcome is guaranteed as long as you keep throwing agents at it.

#### 3. Convoys
Work-order/ticketing system that wraps slung work into trackable units.
- Every `gt sling` creates a Convoy
- Dashboards show convoy progress
- Multiple swarms can "attack" a convoy before completion

#### 4. Patrols
Ephemeral workflows (wisps) that run in loops for Refinery, Witness, and Deacon.
- Exponential backoff when no work
- Wake on mutating commands
- Self-sustaining orchestration

#### 5. Seance
Workers can communicate with their predecessors via Claude Code's `/resume` feature.
- Useful for handoff continuity
- Recovers lost context from crashed sessions

## Comparison: Gas Town vs Claude Flow V3

### Similarities

| Feature | Gas Town | Claude Flow V3 |
|---------|----------|----------------|
| Multi-agent orchestration | ✅ | ✅ |
| Hierarchical coordination | ✅ Mayor-led | ✅ Queen-led |
| Persistent memory | ✅ Git + SQLite | ✅ AgentDB + SQLite |
| Workflow definitions | ✅ Formulas (TOML) | ✅ YAML workflows |
| Background workers | ✅ Dogs, Patrols | ✅ 12 daemon workers |
| Swarm support | ✅ Polecats | ✅ Task tool agents |
| Real-time messaging | ✅ tmux + mail | ✅ MCP tools |

### Differences

| Aspect | Gas Town | Claude Flow V3 |
|--------|----------|----------------|
| **Primary UI** | tmux | CLI + MCP |
| **Language** | Go | TypeScript |
| **Data Plane** | Git JSONL | AgentDB vectors |
| **Conflict Resolution** | Refinery agent | Manual/hooks |
| **Work Units** | Beads (hash IDs) | Tasks/Todos |
| **Workflow Format** | TOML Formulas | YAML templates |
| **Session Model** | Persistent hooks | Session restore |
| **Search** | SQLite FTS | HNSW vectors |

### Gas Town Advantages

1. **Git-native persistence** - All state survives anything
2. **Merge Queue (Refinery)** - Dedicated agent for conflict resolution
3. **Convoy tracking** - First-class work-order system
4. **Formula marketplace** - Mol Mall for sharing workflows
5. **Seance** - Talk to previous sessions

### Claude Flow V3 Advantages

1. **Vector search** - optimized semantic search
2. **Neural learning** - SONA, MoE, pattern learning
3. **MCP integration** - Standard protocol support
4. **Plugin ecosystem** - 18+ plugins with 50+ MCP tools
5. **Multi-model** - Haiku/Sonnet/Opus routing
6. **Cloud-native** - No tmux dependency

## Lessons for Claude Flow V3

### High Priority Adoptions

#### 1. Implement GUPP-like Propulsion
Create persistent "hooks" for agents that survive session crashes:

```typescript
interface AgentHook {
  agentId: string;
  molecule: string; // Current workflow chain
  position: number; // Current step
  lastCheckpoint: Date;
}
```

**Implementation**: Store in AgentDB, check on session restore.

#### 2. Add Convoy/Work-Order Tracking
Wrap slung work into trackable units:

```typescript
interface Convoy {
  id: string;
  name: string;
  trackedTasks: string[];
  status: 'active' | 'landed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
}
```

**Benefit**: Better visibility into swarm progress.

#### 3. Refinery Agent for Merge Queue
Dedicated agent to handle git conflicts in multi-agent work:

```typescript
// New agent type
{
  name: 'refinery',
  role: 'Intelligent merge conflict resolution',
  responsibilities: [
    'Process merge queue one-at-a-time',
    'Reimplement changes against new baseline',
    'Escalate irreconcilable conflicts'
  ]
}
```

#### 4. Patrol System for Self-Healing
Implement patrol loops for critical workers:

```typescript
interface Patrol {
  worker: string;
  steps: PatrolStep[];
  backoffMs: number;
  maxBackoffMs: number;
}
```

### Medium Priority Adoptions

#### 5. Formula-like Workflow Templates
Enhance YAML workflows with variable substitution:

```yaml
# Formula equivalent
name: feature-workflow
variables:
  - feature_name
  - branch_prefix
steps:
  - id: design
    description: "Design ${feature_name}"
  - id: implement
    depends: [design]
    description: "Implement ${feature_name}"
```

#### 6. Wisp-like Ephemeral Work
Add ephemeral task mode that doesn't persist to Git:

```typescript
const wisp = await taskCreate({
  ...task,
  ephemeral: true, // Don't persist after completion
  squashSummary: true // Compress to single line
});
```

#### 7. Seance-like Session Communication
Enable agents to query previous session context:

```typescript
// hooks session-restore with predecessor query
await hooks.sessionRestore({
  sessionId: 'previous',
  query: 'What was the status of the auth refactor?'
});
```

### Lower Priority Adoptions

#### 8. tmux Integration (Optional)
For power users who want terminal-native orchestration:

```bash
npx claude-flow tmux attach --mayor
npx claude-flow tmux crew cycle
```

#### 9. Mol Mall Equivalent
Marketplace for workflow templates:

```bash
npx claude-flow formulas search "release"
npx claude-flow formulas install @community/release-workflow
```

## Architectural Insights

### Why Git-Backed State?

Yegge's insight: **"Sessions are cattle, agents are pets, work is permanent."**

Git provides:
- Infinite history
- Branch-based isolation
- Merge semantics
- Distributed sync
- Cryptographic integrity

Claude Flow uses AgentDB for vectors, but could add Git-backed audit logs for critical state.

### Why Molecules Work

Molecules solve the "LLM context window" problem by:
1. Breaking work into atomic steps
2. Each step has clear acceptance criteria
3. Progress is checkpointed in persistent storage
4. Any agent can resume at any step

This is why Gas Town can run million-step workflows (MAKER 20-disc Hanoi).

### The 8 Stages of AI-Assisted Coding

Yegge's evolution chart is useful for positioning:

| Stage | Description | Tool |
|-------|-------------|------|
| 1 | Zero AI | Manual coding |
| 2 | IDE agent, permissions on | Cursor, Copilot |
| 3 | IDE agent, YOLO mode | Trust enabled |
| 4 | IDE wide agent | Full screen agent |
| 5 | CLI single agent | Claude Code |
| 6 | CLI multi-agent | 3-5 parallel |
| 7 | 10+ agents, hand-managed | Power user |
| 8 | Building orchestrator | Gas Town, Claude Flow |

**Claude Flow V3 targets Stage 7-8 users.**

## Recommendations

### Immediate (This Sprint)

1. **Add convoy tracking** to swarm operations
2. **Implement session hooks** for crash recovery
3. **Document patrol patterns** in CLAUDE.md

### Near-Term (Next Month)

4. **Create refinery agent** for merge queue
5. **Add formula templating** to workflows
6. **Implement wisp mode** for ephemeral orchestration

### Long-Term (Q2 2026)

7. **Git audit log** for critical state
8. **Formula marketplace** integration
9. **tmux integration** for power users

## Conclusion

Gas Town represents a significant advancement in multi-agent orchestration, particularly in:
- **Durability**: Git-backed everything
- **Self-healing**: GUPP + Patrols
- **Scalability**: 20-30+ concurrent agents

Claude Flow V3 has advantages in:
- **Intelligence**: Vector search, neural learning
- **Ecosystem**: MCP, plugins, multi-model
- **Accessibility**: No tmux requirement

The ideal system would combine Gas Town's durability guarantees with Claude Flow's intelligence features.

## References

- [Gas Town GitHub](https://github.com/steveyegge/gastown)
- [Beads GitHub](https://github.com/steveyegge/beads)
- [Welcome to Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04)
- [A Day in Gas Town](https://www.dolthub.com/blog/2026-01-15-a-day-in-gas-town/)
- [Gas Town Decoded](https://www.alilleybrinker.com/mini/gas-town-decoded/)
- [Hacker News Discussion](https://news.ycombinator.com/item?id=46458936)
