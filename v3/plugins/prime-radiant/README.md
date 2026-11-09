# @claude-flow/plugin-prime-radiant

<!-- adr-356:quickstart:start -->
**@claude-flow/plugin-prime-radiant** — A Ruflo plugin that gives agents MCP tools to check coherence, verify consensus, gate memory writes and run spectral, causal and topological analysis, to catch contradictions and hallucinations.

**Supported environments:** Node.js 20+ · ESM

## Quickstart

```bash
npm install @claude-flow/plugin-prime-radiant
```

```js
import { primeRadiantTools, PrimeRadiantConfigSchema } from '@claude-flow/plugin-prime-radiant';

console.log('tools:', primeRadiantTools.map((t) => t.name).join(', '));
const check = PrimeRadiantConfigSchema.safeParse({});
console.log('valid input:', check.success);
```

Expected output:

```text
tools: pr_coherence_check, pr_spectral_analyze, pr_causal_infer, pr_consensus_verify, pr_quantum_topology, pr_memory_gate
valid input: true
```

Install it into a Ruflo project with [`@claude-flow/cli`](https://www.npmjs.com/package/@claude-flow/cli): `npx @claude-flow/cli@latest plugins install -n @claude-flow/plugin-prime-radiant`.
<!-- adr-356:quickstart:end -->

**Mathematical AI that catches contradictions, verifies consensus, and prevents hallucinations before they cause problems.**

## What is this?

This plugin brings advanced mathematical techniques to Claude Flow for ensuring AI reliability:

- **Coherence Checking** - Detect when information contradicts itself before storing it
- **Consensus Verification** - Mathematically verify that multiple agents actually agree
- **Hallucination Prevention** - Catch inconsistent RAG results before they reach users
- **Stability Analysis** - Monitor swarm health using spectral graph theory
- **Causal Inference** - Understand cause-and-effect, not just correlations

Think of it as a mathematical "sanity check" layer that catches logical inconsistencies that traditional validation misses.

## Installation

```bash
npm install @claude-flow/plugin-prime-radiant
```

---

## Practical Examples

### 🟢 Basic: Check if Information is Consistent

Before storing facts, check if they contradict each other:

```typescript
const result = await mcp.call('pr_coherence_check', {
  vectors: [
    embedding("The project deadline is Friday"),
    embedding("We have two more weeks"),
    embedding("The deadline was moved to next month")
  ],
  threshold: 0.3
});

// Result
{
  coherent: false,
  energy: 0.72,  // High energy = contradiction
  violations: ["Statement 3 contradicts statements 1-2"],
  confidence: 0.28
}
```

**Energy levels explained:**
- `0.0-0.1` = Fully consistent, safe to store
- `0.1-0.3` = Minor inconsistencies, warning zone
- `0.3-0.7` = Significant contradictions, needs review
- `0.7-1.0` = Major contradictions, reject

### 🟢 Basic: Verify Multi-Agent Consensus

Check if agents actually agree or just appear to:

```typescript
const consensus = await mcp.call('pr_consensus_verify', {
  agentStates: [
    { agentId: 'researcher', embedding: [...], vote: true },
    { agentId: 'analyst', embedding: [...], vote: true },
    { agentId: 'reviewer', embedding: [...], vote: false }
  ],
  consensusThreshold: 0.8
});

// Result
{
  consensusAchieved: true,
  agreementRatio: 0.87,
  coherenceEnergy: 0.12,  // Low = they genuinely agree
  spectralStability: true
}
```

### 🟡 Intermediate: Analyze Swarm Stability

Monitor if your agent swarm is working together effectively:

```typescript
const stability = await mcp.call('pr_spectral_analyze', {
  adjacencyMatrix: [
    [0, 1, 1, 0, 0],
    [1, 0, 1, 1, 0],
    [1, 1, 0, 1, 1],
    [0, 1, 1, 0, 1],
    [0, 0, 1, 1, 0]
  ],
  analyzeType: 'stability'
});

// Result
{
  stable: true,
  spectralGap: 0.25,      // Higher = more stable
  stabilityIndex: 0.78,
  eigenvalues: [2.73, 0.73, -0.73, -2.73, 0],
  clustering: 0.6         // How well agents cluster
}
```

**What to watch for:**
- `spectralGap < 0.1` = Unstable, agents may desynchronize
- `stabilityIndex < 0.5` = Warning, coordination issues likely

### 🟡 Intermediate: Causal Inference

Understand cause-and-effect relationships in your system:

```typescript
const causal = await mcp.call('pr_causal_infer', {
  treatment: 'agent_count',
  outcome: 'task_completion_time',
  graph: {
    nodes: ['agent_count', 'coordination_overhead', 'task_completion_time', 'task_complexity'],
    edges: [
      ['agent_count', 'task_completion_time'],
      ['agent_count', 'coordination_overhead'],
      ['coordination_overhead', 'task_completion_time'],
      ['task_complexity', 'agent_count'],
      ['task_complexity', 'task_completion_time']
    ]
  }
});

// Result
{
  causalEffect: -0.35,  // Adding agents REDUCES completion time
  confounders: ['task_complexity'],  // This affects both
  interventionValid: true,
  backdoorPaths: [['agent_count', 'task_complexity', 'task_completion_time']]
}
```

### 🟠 Advanced: Memory Gate (Auto-Reject Contradictions)

Automatically block contradictory information from being stored:

```typescript
const result = await mcp.call('pr_memory_gate', {
  entry: {
    key: 'project-status',
    content: 'Project is on track for Friday deadline',
    embedding: embedding("Project is on track for Friday deadline")
  },
  contextEmbeddings: [
    embedding("Deadline extended to next month"),  // Already stored
    embedding("Team requested more time")          // Already stored
  ],
  thresholds: {
    warn: 0.3,
    reject: 0.7
  }
});

// Result
{
  action: 'reject',  // Blocked from storage
  energy: 0.82,
  reason: 'Contradicts existing information about deadline',
  existingConflicts: ['Deadline extended to next month']
}
```

### 🟠 Advanced: Prevent RAG Hallucinations

Filter contradictory documents before they confuse the AI:

```typescript
// Hook automatically runs before RAG retrieval
// If retrieved docs contradict each other, it filters to the most coherent subset

const context = await rag.retrieve('What is the project deadline?');

// If docs were contradictory:
{
  documents: [...],  // Filtered to consistent subset
  coherenceFiltered: true,
  originalCount: 5,
  filteredCount: 3,
  removedForCoherence: ['doc-4', 'doc-5'],
  originalCoherenceEnergy: 0.68
}
```

### 🔴 Expert: Quantum Topology Analysis

Analyze the structure of your vector space using persistent homology:

```typescript
const topology = await mcp.call('pr_quantum_topology', {
  points: embeddings,  // Array of embedding vectors
  maxDimension: 2
});

// Result
{
  bettiNumbers: {
    b0: 3,   // 3 connected components (clusters)
    b1: 1,   // 1 loop (circular relationship)
    b2: 0    // No voids
  },
  persistenceDiagram: [...],  // Birth-death pairs
  significantFeatures: [
    { dimension: 0, persistence: 0.8, interpretation: 'Strong cluster' },
    { dimension: 1, persistence: 0.3, interpretation: 'Weak cyclical pattern' }
  ]
}
```

**What this tells you:**
- `b0` = Number of distinct concept clusters
- `b1` = Cyclical relationships (A→B→C→A)
- `b2` = Higher-dimensional voids (rare in practice)

### 🟣 Exotic: Real-Time Swarm Health Dashboard

Monitor your multi-agent swarm in real-time:

```typescript
// Run periodically to track swarm health
async function monitorSwarmHealth() {
  const adjacency = await getSwarmAdjacencyMatrix();

  const health = await mcp.call('pr_spectral_analyze', {
    adjacencyMatrix: adjacency,
    analyzeType: 'stability'
  });

  if (!health.stable) {
    console.warn('⚠️ Swarm instability detected!');
    console.log('Spectral gap:', health.spectralGap);
    console.log('Stability index:', health.stabilityIndex);

    // Trigger rebalancing
    await swarm.rebalance();
  }

  if (health.spectralGap < 0.1) {
    console.warn('⚠️ Communication breakdown risk');
    // Add redundant connections
    await swarm.addRedundancy();
  }
}

// Monitor every 30 seconds
setInterval(monitorSwarmHealth, 30000);
```

### 🟣 Exotic: Coherent Knowledge Base

Build a knowledge base that mathematically cannot contain contradictions:

```typescript
class CoherentKnowledgeBase {
  async store(fact: string, embedding: number[]) {
    // Check against all existing knowledge
    const existing = await this.getAllEmbeddings();

    const check = await mcp.call('pr_coherence_check', {
      vectors: [...existing, embedding],
      threshold: 0.3
    });

    if (check.energy > 0.7) {
      throw new Error(`Fact contradicts existing knowledge: ${check.violations[0]}`);
    }

    if (check.energy > 0.3) {
      console.warn(`Warning: Minor inconsistency detected (energy: ${check.energy})`);
    }

    // Safe to store
    await this.db.store(fact, embedding, { coherenceEnergy: check.energy });
  }

  async query(question: string) {
    const results = await this.db.search(question);

    // Verify retrieved results are consistent with each other
    const embeddings = results.map(r => r.embedding);
    const coherence = await mcp.call('pr_coherence_check', {
      vectors: embeddings,
      threshold: 0.3
    });

    if (coherence.energy > 0.5) {
      // Filter to most coherent subset
      return this.filterToCoherent(results, coherence);
    }

    return results;
  }
}
```

---

## 6 Mathematical Engines

| Engine | What It Does | Use Case |
|--------|--------------|----------|
| **Cohomology** | Measures contradiction using Sheaf Laplacian | Memory validation, fact-checking |
| **Spectral** | Analyzes stability via eigenvalues | Swarm health, network topology |
| **Causal** | Do-calculus for cause-effect reasoning | Root cause analysis, optimization |
| **Quantum** | Persistent homology for structure | Clustering, pattern discovery |
| **Category** | Morphism and functor operations | Schema transformations |
| **HoTT** | Homotopy Type Theory proofs | Formal verification |

---

## Hooks (Automatic Integration)

| Hook | When It Runs | What It Does |
|------|--------------|--------------|
| `pr/pre-memory-store` | Before memory storage | Blocks contradictory entries |
| `pr/pre-consensus` | Before consensus voting | Validates proposal consistency |
| `pr/post-swarm-task` | After swarm tasks | Analyzes stability metrics |
| `pr/pre-rag-retrieval` | Before RAG results | Filters inconsistent documents |

---

## Configuration

```yaml
# claude-flow.config.yaml
plugins:
  prime-radiant:
    enabled: true
    config:
      coherence:
        warnThreshold: 0.3    # Warn above this energy
        rejectThreshold: 0.7  # Block above this energy
        cacheEnabled: true
      spectral:
        stabilityThreshold: 0.1
        maxMatrixSize: 1000
      causal:
        maxBackdoorPaths: 10
```

---

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Coherence check | <5ms | Per validation |
| Spectral analysis | <20ms | Up to 100x100 matrix |
| Causal inference | <10ms | Per query |
| Quantum topology | <50ms | Per computation |
| Memory overhead | <10MB | Including WASM |

---

## License

MIT

<!-- adr-356:footer:start -->
---

Built by [rUv](https://ruv.io) · [ruv.io](https://ruv.io) · [Source](https://github.com/ruvnet/ruflo/tree/main/v3/plugins/prime-radiant)
<!-- adr-356:footer:end -->
