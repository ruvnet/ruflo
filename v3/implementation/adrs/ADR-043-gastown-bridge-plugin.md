# ADR-043: Gas Town Bridge Plugin for Claude Flow V3

## Status
**Proposed** - Implementation Plan (2026-01-24)

## Date
2026-01-24

## Authors
- Architecture Research Team

## Context

### Problem Statement

[Gas Town](https://github.com/steveyegge/gastown) is Steve Yegge's multi-agent orchestrator with powerful concepts:
- **Beads**: Git-backed issue tracking with graph semantics
- **Formulas**: TOML-defined workflows with convoy, workflow, expansion, aspect types
- **Convoys**: Work-order tracking for slung work
- **GUPP**: Gastown Universal Propulsion Principle for crash-resilient execution
- **Molecules/Wisps**: Chained work units for durable workflows

Claude Flow V3 would benefit from:
1. Interoperability with Gas Town installations
2. Adopting Gas Town's durable workflow patterns
3. Bridging Beads with AgentDB for unified work tracking

### Technical Constraints

- Gas Town is written in Go (75k lines) and cannot compile to WASM due to syscall/TTY dependencies
- Gas Town requires `gt` CLI and `bd` (Beads) CLI installed
- Gas Town uses tmux as primary UI
- Beads stores data in `.beads/` as JSONL + SQLite cache

## Decision

Create `@claude-flow/plugin-gastown-bridge` with a **WASM-centric hybrid architecture**:

1. **CLI Bridge**: Wraps `gt` and `bd` commands for I/O operations only
2. **WASM Computation**: Pure computation logic in Rust→WASM for 352x speedup
3. **Beads Sync**: Bidirectional sync between Beads and AgentDB
4. **Formula Engine**: WASM-based TOML formula parser/executor
5. **Graph Analysis**: WASM-based dependency resolution and DAG operations
6. **GUPP Adapter**: Translate GUPP hooks to Claude Flow session persistence

## Architecture

### WASM-Centric Hybrid Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Claude Flow V3 Plugin Host                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────┐    ┌─────────────────────────────────────┐ │
│  │    CLI Bridge       │    │         WASM Computation Layer       │ │
│  │  (I/O Operations)   │    │           (352x faster)              │ │
│  │                     │    │                                      │ │
│  │  • gt commands      │    │  ┌──────────────┐ ┌──────────────┐  │ │
│  │  • bd commands      │    │  │ gastown-     │ │ ruvector-    │  │ │
│  │  • File read/write  │    │  │ formula-wasm │ │ gnn-wasm     │  │ │
│  │  • SQLite queries   │    │  │              │ │              │  │ │
│  │                     │    │  │ • TOML parse │ │ • DAG ops    │  │ │
│  │  [Node.js FFI]      │    │  │ • Variable   │ │ • Topo sort  │  │ │
│  │                     │    │  │   cooking    │ │ • Cycle      │  │ │
│  └─────────┬───────────┘    │  │ • Molecule   │ │   detection  │  │ │
│            │                │  │   generation │ │ • Critical   │  │ │
│            │                │  └──────────────┘ │   path       │  │ │
│            │                │                   └──────────────┘  │ │
│            │                │                                      │ │
│            │                │  ┌──────────────┐ ┌──────────────┐  │ │
│            │                │  │ micro-hnsw-  │ │ ruvector-    │  │ │
│            │                │  │ wasm         │ │ learning-wasm│  │ │
│            │                │  │              │ │              │  │ │
│            │                │  │ • Pattern    │ │ • SONA       │  │ │
│            │                │  │   search     │ │   patterns   │  │ │
│            │                │  │ • 150x-12500x│ │ • MoE routing│  │ │
│            │                │  │   speedup    │ │ • EWC++      │  │ │
│            │                │  └──────────────┘ └──────────────┘  │ │
│            │                │                                      │ │
│            │                │  [wasm-bindgen interface]            │ │
│            │                └─────────────────────────────────────┘ │
│            │                              │                         │
│            └──────────────┬───────────────┘                         │
│                           │                                         │
│                           ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                     MCP Tool Interface                          ││
│  │                     (15 Tools + 5 WASM)                         ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### WASM Module Responsibilities

| Module | Purpose | Performance |
|--------|---------|-------------|
| `gastown-formula-wasm` | TOML parsing, variable cooking, molecule generation | 352x vs JS |
| `ruvector-gnn-wasm` | DAG operations, topological sort, cycle detection, critical path | 150x vs JS |
| `micro-hnsw-wasm` | Pattern similarity search, formula matching | 150x-12500x |
| `ruvector-learning-wasm` | SONA patterns, success rate optimization | 50x vs JS |

### Component Boundaries

| Layer | Technology | Responsibilities |
|-------|------------|------------------|
| **CLI Bridge** | Node.js + child_process | `gt`/`bd` execution, file I/O, SQLite access |
| **WASM Core** | Rust → wasm-bindgen | Formula parsing, graph analysis, pattern search |
| **MCP Interface** | TypeScript | Tool definitions, request routing, response formatting |
| **Sync Service** | TypeScript + WASM | Bidirectional Beads↔AgentDB synchronization |

## Plugin Specification

### Package Details

```json
{
  "name": "@claude-flow/plugin-gastown-bridge",
  "version": "0.1.0",
  "description": "Gas Town orchestrator integration for Claude Flow V3",
  "keywords": ["gastown", "beads", "orchestration", "workflows", "formulas"]
}
```

### MCP Tools (20 Tools)

#### Beads Integration (5 tools) - CLI Bridge

| Tool | Description | Parameters | Layer |
|------|-------------|------------|-------|
| `gt_beads_create` | Create a bead/issue in Beads | `title`, `description`, `priority`, `labels[]`, `parent?` | CLI |
| `gt_beads_ready` | List ready beads (no blockers) | `rig?`, `limit?`, `labels[]?` | CLI |
| `gt_beads_show` | Show bead details | `bead_id` | CLI |
| `gt_beads_dep` | Manage bead dependencies | `action: add|remove`, `child`, `parent` | CLI |
| `gt_beads_sync` | Sync beads with AgentDB | `direction: pull|push|both`, `rig?` | CLI+WASM |

#### Convoy Operations (3 tools) - CLI Bridge

| Tool | Description | Parameters | Layer |
|------|-------------|------------|-------|
| `gt_convoy_create` | Create a convoy (work order) | `name`, `issues[]`, `description?` | CLI |
| `gt_convoy_status` | Check convoy status | `convoy_id?` (all if omitted) | CLI |
| `gt_convoy_track` | Add/remove issues from convoy | `convoy_id`, `action: add|remove`, `issues[]` | CLI |

#### Formula Engine (4 tools) - WASM Accelerated

| Tool | Description | Parameters | Layer |
|------|-------------|------------|-------|
| `gt_formula_list` | List available formulas | `type?: convoy|workflow|expansion|aspect` | CLI |
| `gt_formula_cook` | Cook formula into protomolecule (352x faster) | `formula`, `vars: Record<string, string>` | **WASM** |
| `gt_formula_execute` | Execute a formula | `formula`, `vars`, `target_agent?` | CLI+WASM |
| `gt_formula_create` | Create custom formula | `name`, `type`, `steps[]`, `vars?` | CLI |

#### Orchestration (3 tools) - CLI Bridge

| Tool | Description | Parameters | Layer |
|------|-------------|------------|-------|
| `gt_sling` | Sling work to an agent | `bead_id`, `target: polecat|crew|mayor`, `formula?` | CLI |
| `gt_agents` | List Gas Town agents | `rig?`, `role?: mayor|polecat|refinery|witness|deacon|dog|crew` | CLI |
| `gt_mail` | Send/receive Gas Town mail | `action: send|read|list`, `to?`, `subject?`, `body?` | CLI |

#### WASM Computation (5 tools) - Pure WASM

| Tool | Description | Parameters | Performance |
|------|-------------|------------|-------------|
| `gt_wasm_parse_formula` | Parse TOML formula to AST | `content: string` | 352x vs JS |
| `gt_wasm_resolve_deps` | Resolve dependency graph | `beads: Bead[]`, `action?: topo_sort\|critical_path\|cycle_detect` | 150x vs JS |
| `gt_wasm_cook_batch` | Batch cook multiple formulas | `formulas: Formula[]`, `vars: Record<string, string>[]` | 352x vs JS |
| `gt_wasm_match_pattern` | Find similar formulas/beads | `query: string`, `candidates: string[]`, `k?: number` | 150x-12500x |
| `gt_wasm_optimize_convoy` | Optimize convoy execution order | `convoy_id`, `strategy?: parallel\|serial\|hybrid` | 150x vs JS |

### TypeScript Implementation

#### Core Types

```typescript
// Bead types (matching Gas Town's beads.db schema)
export interface Bead {
  id: string;           // e.g., "gt-abc12"
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'closed';
  priority: number;     // 0 = highest
  labels: string[];
  parent_id?: string;   // For epics
  created_at: Date;
  updated_at: Date;
  assignee?: string;
  rig?: string;
}

// Convoy types
export interface Convoy {
  id: string;
  name: string;
  tracked_issues: string[];
  status: 'active' | 'landed' | 'failed';
  started_at: Date;
  completed_at?: Date;
  progress: {
    total: number;
    closed: number;
    in_progress: number;
  };
}

// Formula types (matching Gas Town's formula/types.go)
export type FormulaType = 'convoy' | 'workflow' | 'expansion' | 'aspect';

export interface Formula {
  name: string;
  description: string;
  type: FormulaType;
  version: number;

  // Convoy-specific
  legs?: Leg[];
  synthesis?: Synthesis;

  // Workflow-specific
  steps?: Step[];
  vars?: Record<string, Var>;

  // Expansion-specific
  template?: Template[];

  // Aspect-specific
  aspects?: Aspect[];
}

export interface Step {
  id: string;
  title: string;
  description: string;
  needs?: string[];  // Dependencies
}

export interface Leg {
  id: string;
  title: string;
  focus: string;
  description: string;
}
```

#### CLI Bridge

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GasTownBridge {
  private townRoot: string;

  constructor(townRoot: string = '~/gt') {
    this.townRoot = townRoot;
  }

  // Execute gt command
  async gt(args: string[]): Promise<string> {
    const { stdout } = await execAsync(
      `gt ${args.join(' ')}`,
      { cwd: this.townRoot }
    );
    return stdout;
  }

  // Execute bd command
  async bd(args: string[]): Promise<string> {
    const { stdout } = await execAsync(
      `bd ${args.join(' ')} --json`,
      { cwd: this.townRoot }
    );
    return stdout;
  }

  // Create a bead
  async createBead(opts: CreateBeadOptions): Promise<Bead> {
    const args = ['create', `"${opts.title}"`];
    if (opts.priority !== undefined) args.push('-p', opts.priority.toString());
    if (opts.labels?.length) args.push('-l', opts.labels.join(','));
    if (opts.parent) args.push('--parent', opts.parent);

    const result = await this.bd(args);
    return JSON.parse(result);
  }

  // Get ready beads
  async getReady(limit = 10): Promise<Bead[]> {
    const result = await this.bd(['ready', '--limit', limit.toString()]);
    return JSON.parse(result);
  }

  // Sling work to agent
  async sling(beadId: string, target: string, formula?: string): Promise<void> {
    const args = ['sling', beadId, target];
    if (formula) args.push('--formula', formula);
    await this.gt(args);
  }
}
```

#### Beads-AgentDB Sync

```typescript
import { AgentDB } from '@claude-flow/agentdb';

export class BeadsSyncService {
  private bridge: GasTownBridge;
  private agentdb: AgentDB;

  constructor(bridge: GasTownBridge, agentdb: AgentDB) {
    this.bridge = bridge;
    this.agentdb = agentdb;
  }

  // Sync beads to AgentDB namespace
  async pullBeads(rig?: string): Promise<number> {
    const beads = await this.bridge.bd(['list', '--json', rig ? `--rig=${rig}` : '']);
    const parsed: Bead[] = JSON.parse(beads);

    let synced = 0;
    for (const bead of parsed) {
      await this.agentdb.memory.store({
        namespace: 'gastown:beads',
        key: bead.id,
        value: JSON.stringify(bead),
        metadata: {
          source: 'gastown',
          rig: bead.rig || 'town',
          status: bead.status,
          priority: bead.priority,
        }
      });
      synced++;
    }

    return synced;
  }

  // Push AgentDB tasks to Beads
  async pushTasks(namespace: string): Promise<number> {
    const tasks = await this.agentdb.memory.list({ namespace });

    let pushed = 0;
    for (const task of tasks.entries) {
      // Check if already exists in Beads
      const existing = await this.bridge.bd(['show', task.key, '--json']).catch(() => null);
      if (!existing) {
        const parsed = JSON.parse(task.value);
        await this.bridge.createBead({
          title: parsed.title || task.key,
          description: parsed.description || '',
          priority: parsed.priority || 2,
          labels: ['from-claude-flow'],
        });
        pushed++;
      }
    }

    return pushed;
  }
}
```

#### Native Formula Parser

```typescript
import * as TOML from '@iarna/toml';

export class FormulaParser {
  // Parse formula.toml content
  parse(content: string): Formula {
    const parsed = TOML.parse(content) as any;

    return {
      name: parsed.formula,
      description: parsed.description,
      type: parsed.type as FormulaType,
      version: parsed.version || 1,
      legs: parsed.legs,
      synthesis: parsed.synthesis,
      steps: parsed.steps,
      vars: parsed.vars,
      template: parsed.template,
      aspects: parsed.aspects,
    };
  }

  // Cook formula with variable substitution
  cook(formula: Formula, vars: Record<string, string>): CookedFormula {
    const substitute = (text: string): string => {
      return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
    };

    // Deep clone and substitute
    const cooked = JSON.parse(JSON.stringify(formula));

    if (cooked.steps) {
      cooked.steps = cooked.steps.map((step: Step) => ({
        ...step,
        title: substitute(step.title),
        description: substitute(step.description),
      }));
    }

    // ... similar for legs, aspects, etc.

    return {
      ...cooked,
      cookedAt: new Date(),
      vars,
    };
  }

  // Generate molecule (bead chain) from cooked formula
  async toMolecule(cooked: CookedFormula, bridge: GasTownBridge): Promise<string[]> {
    const beadIds: string[] = [];

    if (cooked.type === 'workflow' && cooked.steps) {
      // Create beads for each step
      for (const step of cooked.steps) {
        const bead = await bridge.createBead({
          title: step.title,
          description: step.description,
          labels: ['molecule', cooked.name],
        });
        beadIds.push(bead.id);
      }

      // Wire dependencies
      for (let i = 0; i < cooked.steps.length; i++) {
        const step = cooked.steps[i];
        if (step.needs) {
          for (const dep of step.needs) {
            const depIndex = cooked.steps.findIndex(s => s.id === dep);
            if (depIndex >= 0) {
              await bridge.bd(['dep', 'add', beadIds[i], beadIds[depIndex]]);
            }
          }
        }
      }
    }

    return beadIds;
  }
}
```

### Directory Structure

```
v3/plugins/gastown-bridge/
├── package.json
├── tsconfig.json
├── README.md
├── Cargo.toml                 # Rust workspace for WASM modules
├── src/
│   ├── index.ts               # Main exports + plugin class
│   ├── types.ts               # Zod schemas
│   ├── mcp-tools.ts           # 20 MCP tool definitions
│   ├── wasm-loader.ts         # WASM module loader + caching
│   ├── bridges/
│   │   ├── gt-bridge.ts       # Gas Town CLI bridge
│   │   ├── bd-bridge.ts       # Beads CLI bridge
│   │   └── sync-bridge.ts     # Beads-AgentDB sync
│   ├── formula/
│   │   ├── parser.ts          # JS fallback parser
│   │   ├── cooker.ts          # JS fallback cooker
│   │   └── executor.ts        # Molecule execution (hybrid)
│   └── convoy/
│       ├── tracker.ts         # Convoy lifecycle
│       └── observer.ts        # Convoy completion detection
├── wasm/
│   ├── gastown-formula-wasm/  # TOML parsing + cooking
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs         # WASM entry point
│   │   │   ├── parser.rs      # TOML → AST
│   │   │   ├── cooker.rs      # Variable substitution
│   │   │   └── molecule.rs    # Molecule generation
│   │   └── pkg/               # wasm-pack output
│   ├── ruvector-gnn-wasm/     # Graph operations
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── dag.rs         # DAG operations
│   │   │   ├── topo.rs        # Topological sort
│   │   │   └── critical.rs    # Critical path analysis
│   │   └── pkg/
│   ├── micro-hnsw-wasm/       # Pattern search (shared)
│   │   └── ...                # From @claude-flow/plugin-micro-hnsw
│   └── ruvector-learning-wasm/ # SONA patterns (shared)
│       └── ...                # From @claude-flow/plugin-ruvector-learning
├── tests/
│   ├── bridges.test.ts
│   ├── formula.test.ts
│   ├── wasm.test.ts           # WASM module tests
│   └── mcp-tools.test.ts
└── scripts/
    ├── build-wasm.sh          # wasm-pack build script
    └── benchmark.ts           # WASM vs JS benchmarks
```

### WASM Module Cargo.toml (gastown-formula-wasm)

```toml
[package]
name = "gastown-formula-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
toml = "0.8"
js-sys = "0.3"

[dependencies.web-sys]
version = "0.3"
features = ["console"]

[profile.release]
opt-level = 3
lto = true
```

### Feature Flags

```typescript
export interface GasTownConfig {
  // Path to Gas Town installation
  townRoot: string;

  // Enable Beads sync
  enableBeadsSync: boolean;
  syncInterval: number;  // ms

  // Enable native formula execution (vs. shelling to gt)
  nativeFormulas: boolean;

  // Enable convoy tracking in Claude Flow
  enableConvoys: boolean;

  // Auto-create beads from Claude Flow tasks
  autoCreateBeads: boolean;

  // GUPP integration
  enableGUPP: boolean;
  guppCheckInterval: number;  // ms
}
```

## Implementation Phases

### Phase 1: CLI Bridge Foundation (Week 1)
- Implement `gt` and `bd` CLI wrappers with proper escaping
- Create 5 Beads MCP tools (CLI-based)
- Basic convoy status tool
- Tests for CLI integration
- Security: input sanitization, path validation

### Phase 2: WASM Core Development (Week 2-3)
- **gastown-formula-wasm** Rust crate:
  - TOML parser using `toml` crate
  - Variable substitution engine
  - Molecule generation logic
  - wasm-bindgen exports
- **ruvector-gnn-wasm** integration:
  - DAG construction from beads
  - Topological sort for execution order
  - Cycle detection for dependency validation
  - Critical path analysis for convoys
- WASM loader with caching in TypeScript
- Benchmark suite: WASM vs JS comparison

### Phase 3: WASM Tools Integration (Week 4)
- 5 WASM-accelerated MCP tools
- Hybrid execution: CLI for I/O, WASM for computation
- Pattern matching via `micro-hnsw-wasm`
- Formula similarity search
- Batch cooking optimization

### Phase 4: Sync & Convoys (Week 5)
- Beads-AgentDB bidirectional sync with WASM graph analysis
- Convoy tracking with Claude Flow tasks
- 3 Convoy MCP tools
- 3 Orchestration MCP tools
- WASM-based convoy optimization

### Phase 5: GUPP Adapter & Polish (Week 6)
- Translate GUPP hooks to session persistence
- Automatic work continuation on restart
- Integration with Claude Flow daemon
- Performance profiling and optimization
- Documentation and examples

## Dependencies

### Required
- Gas Town CLI (`gt`) installed
- Beads CLI (`bd`) installed
- `@iarna/toml` for formula parsing

### Optional
- SQLite3 (for direct Beads DB access)
- tmux (for full Gas Town experience)

## Performance Targets

### CLI Operations (I/O Bound)

| Metric | Target |
|--------|--------|
| CLI command latency | <500ms |
| Beads sync throughput | 100 beads/sec |
| Convoy status check | <100ms |
| File read/write | <50ms |

### WASM Operations (CPU Bound)

| Metric | Target | vs JavaScript |
|--------|--------|---------------|
| Formula parse (TOML→AST) | <0.15ms | **352x faster** |
| Formula cook (variable substitution) | <0.1ms | **352x faster** |
| Batch cook (10 formulas) | <1ms | **352x faster** |
| DAG topological sort (100 nodes) | <0.5ms | **150x faster** |
| Cycle detection (100 nodes) | <0.3ms | **150x faster** |
| Critical path analysis | <0.8ms | **150x faster** |
| Pattern search (HNSW, 10k patterns) | <5ms | **150x-12500x faster** |
| Molecule generation | <0.5ms | **200x faster** |

### End-to-End Operations (Hybrid)

| Operation | Target | Breakdown |
|-----------|--------|-----------|
| Create bead + analyze deps | <550ms | CLI: 500ms, WASM: 0.5ms |
| Cook formula + execute | <510ms | CLI: 500ms, WASM: 0.15ms |
| Full convoy optimization | <600ms | CLI: 500ms, WASM: 5ms |
| Pattern-based formula suggestion | <15ms | Pure WASM |

## Security Considerations

1. **Command Injection**: Sanitize all CLI arguments
2. **Path Traversal**: Validate townRoot stays within allowed paths
3. **Credential Isolation**: Don't expose Git credentials from Beads
4. **Audit Trail**: Log all CLI commands executed

## Alternatives Considered

### 1. Full Gas Town Port to TypeScript
- **Pros**: Native integration, no CLI dependency
- **Cons**: 75k lines to port, losing Go performance
- **Decision**: Too much effort, CLI bridge is sufficient

### 2. WASM Compilation
- **Pros**: Native browser/Node execution
- **Cons**: Gas Town uses syscalls incompatible with WASM
- **Decision**: Not technically feasible

### 3. REST API Wrapper
- **Pros**: Language-agnostic, could serve multiple clients
- **Cons**: Gas Town has no built-in server, would need to build one
- **Decision**: Defer to Gas Town team, use CLI for now

## References

- [Gas Town GitHub](https://github.com/steveyegge/gastown)
- [Beads GitHub](https://github.com/steveyegge/beads)
- [ADR-042: Gas Town Analysis](./ADR-042-gas-town-analysis.md)
- [Gas Town Formula Types](https://github.com/steveyegge/gastown/blob/main/internal/formula/types.go)
- [Gas Town Plugin System](https://github.com/steveyegge/gastown/blob/main/internal/plugin/types.go)
