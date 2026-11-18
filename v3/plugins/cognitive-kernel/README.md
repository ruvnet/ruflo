# @claude-flow/plugin-cognitive-kernel

<!-- adr-356:quickstart:start -->
**@claude-flow/plugin-cognitive-kernel** — A Ruflo plugin that gives agents MCP tools for working memory, attention control, meta-cognitive monitoring, task scaffolding and cognitive-load management.

**Supported environments:** Node.js 18+ · ESM

## Quickstart

```bash
npm install @claude-flow/plugin-cognitive-kernel
```

```js
import { cognitiveKernelTools, AttentionFiltersSchema } from '@claude-flow/plugin-cognitive-kernel';

console.log('tools:', cognitiveKernelTools.map((t) => t.name).join(', '));
const check = AttentionFiltersSchema.safeParse({ includePatterns: ['src/**'] });
console.log('valid input:', check.success);
```

Expected output:

```text
tools: cognition/working-memory, cognition/attention-control, cognition/meta-monitor, cognition/scaffold, cognition/cognitive-load
valid input: true
```

Install it into a Ruflo project with [`@claude-flow/cli`](https://www.npmjs.com/package/@claude-flow/cli): `npx @claude-flow/cli@latest plugins install -n @claude-flow/plugin-cognitive-kernel`.
<!-- adr-356:quickstart:end -->

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-cognitive-kernel.svg)](https://www.npmjs.com/package/@claude-flow/plugin-cognitive-kernel)
[![license](https://img.shields.io/npm/l/@claude-flow/plugin-cognitive-kernel.svg)](https://github.com/ruvnet/claude-flow/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-cognitive-kernel.svg)](https://www.npmjs.com/package/@claude-flow/plugin-cognitive-kernel)

A cutting-edge cognitive augmentation plugin combining the Cognitum Gate Kernel with SONA self-optimizing architecture to provide LLMs with enhanced cognitive capabilities. The plugin enables dynamic working memory, attention control mechanisms, meta-cognitive self-monitoring, and cognitive scaffolding while maintaining low latency through WASM acceleration.

## Installation

### npm

```bash
npm install @claude-flow/plugin-cognitive-kernel
```

### CLI

```bash
npx claude-flow plugins install --name @claude-flow/plugin-cognitive-kernel
```

## Quick Start

```typescript
import { CognitiveKernelPlugin } from '@claude-flow/plugin-cognitive-kernel';

// Initialize the plugin
const plugin = new CognitiveKernelPlugin();
await plugin.initialize();

// Allocate working memory for a complex reasoning task
const memorySlot = await plugin.workingMemory({
  action: 'allocate',
  slot: {
    id: 'current-problem',
    content: { problem: 'Design authentication system', context: {...} },
    priority: 0.9,
    decay: 0.05
  },
  capacity: 7  // Miller's number
});

// Control attention for focused analysis
await plugin.attentionControl({
  mode: 'focus',
  targets: [
    { entity: 'security-requirements', weight: 0.8, duration: 300 },
    { entity: 'user-experience', weight: 0.6, duration: 300 }
  ],
  filters: {
    includePatterns: ['auth*', 'security*', 'token*'],
    noveltyBias: 0.3
  }
});

console.log('Cognitive context established');
```

## Available MCP Tools

### 1. `cognition/working-memory`

Manage dynamic working memory slots for complex reasoning tasks.

```typescript
const result = await mcp.call('cognition/working-memory', {
  action: 'allocate',
  slot: {
    id: 'task-context',
    content: {
      goal: 'Refactor authentication module',
      constraints: ['maintain backward compatibility', 'improve security'],
      progress: []
    },
    priority: 0.8,
    decay: 0.1
  },
  capacity: 7,
  consolidationTarget: 'episodic'
});
```

**Actions:** `allocate`, `update`, `retrieve`, `clear`, `consolidate`

**Returns:** Memory slot state with current contents and decay status.

### 2. `cognition/attention-control`

Control cognitive attention and information filtering.

```typescript
const result = await mcp.call('cognition/attention-control', {
  mode: 'selective',
  targets: [
    { entity: 'error-handling', weight: 0.9, duration: 600 },
    { entity: 'input-validation', weight: 0.7, duration: 600 }
  ],
  filters: {
    includePatterns: ['error*', 'exception*', 'validation*'],
    excludePatterns: ['deprecated*', 'legacy*'],
    noveltyBias: 0.5
  }
});
```

**Modes:** `focus`, `diffuse`, `selective`, `divided`, `sustained`

**Returns:** Attention state with active targets and filter configuration.

### 3. `cognition/meta-monitor`

Meta-cognitive monitoring of reasoning quality and self-reflection.

```typescript
const result = await mcp.call('cognition/meta-monitor', {
  monitoring: [
    'confidence_calibration',
    'reasoning_coherence',
    'goal_tracking',
    'error_detection'
  ],
  reflection: {
    trigger: 'on_uncertainty',
    depth: 'medium'
  },
  interventions: true
});
```

**Returns:** Meta-cognitive assessment with confidence scores, detected issues, and suggested interventions.

### 4. `cognition/scaffold`

Provide cognitive scaffolding for complex reasoning tasks.

```typescript
const result = await mcp.call('cognition/scaffold', {
  task: {
    description: 'Design a distributed caching system',
    complexity: 'complex',
    domain: 'distributed-systems'
  },
  scaffoldType: 'decomposition',
  adaptivity: {
    fading: true,
    monitoring: true
  }
});
```

**Scaffold Types:** `decomposition`, `analogy`, `worked_example`, `socratic`, `metacognitive_prompting`, `chain_of_thought`

**Returns:** Structured scaffolding with step-by-step guidance adapted to task complexity.

### 5. `cognition/cognitive-load`

Monitor and balance cognitive load during reasoning.

```typescript
const result = await mcp.call('cognition/cognitive-load', {
  assessment: {
    intrinsic: 0.7,    // Task complexity
    extraneous: 0.3,   // Presentation complexity
    germane: 0.5       // Learning investment
  },
  optimization: 'reduce_extraneous',
  threshold: 0.8
});
```

**Optimizations:** `reduce_extraneous`, `chunk_intrinsic`, `maximize_germane`, `balanced`

**Returns:** Load assessment with optimization recommendations and intervention triggers.

## Configuration Options

```typescript
interface CognitiveKernelConfig {
  // Maximum working memory slots (default: 7, Miller's number)
  maxWorkingMemorySlots: number;

  // Memory limit in MB (default: 256)
  memoryLimit: number;

  // CPU time limit per operation in seconds (default: 10)
  cpuTimeLimit: number;

  // Enable session isolation (default: true)
  sessionIsolation: boolean;

  // Scaffold fading configuration
  scaffolding: {
    enableFading: boolean;
    fadingRate: number;
  };

  // Meta-cognitive intervention thresholds
  metaCognition: {
    confidenceThreshold: number;
    coherenceThreshold: number;
    autoIntervene: boolean;
  };
}
```

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Working memory operations | <1ms per slot | 10x faster than naive cache |
| Attention steering | <5ms for reallocation | 10x faster than context rebuild |
| Meta-cognitive check | <10ms per assessment | Novel capability |
| Memory consolidation | <100ms batch | 10x faster than full reindex |
| Scaffold generation | <50ms per step | Novel capability |

## Cognitive Theories Implemented

| Theory | Implementation |
|--------|----------------|
| Baddeley's Working Memory | Multi-component memory system with phonological loop, visuospatial sketchpad, and episodic buffer |
| Cognitive Load Theory | Intrinsic/extraneous/germane load management |
| Metacognition | Self-monitoring, error detection, and regulation |
| Zone of Proximal Development | Adaptive scaffolding with gradual fading |
| Dual Process Theory | Fast/slow thinking modes |

## Security Considerations

- **Session Isolation**: Each cognitive session has isolated working memory with session-specific encryption keys (AES-256-GCM)
- **Secure Clearing**: Working memory is securely cleared and overwritten (zero-fill) at session end
- **Prompt Injection Prevention**: Scaffold content is sanitized to remove potential prompt injection patterns (special tokens, control sequences)
- **Input Validation**: All inputs validated with Zod schemas with strict limits
- **Rate Limiting**: Prevents abuse of cognitive resources
- **Content Filtering**: Memory content scanned for sensitive data patterns before storage

### WASM Security Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Memory Limit | 256MB | Sufficient for cognitive operations |
| CPU Time per Operation | 10 seconds | Prevent runaway processing |
| No Network Access | Enforced | Prevent data exfiltration |
| Session Isolation | Enforced | Per-session WASM instances |
| Secure Memory Clear | Zero-fill on exit | Prevent memory forensics |

### Input Limits

| Constraint | Limit |
|------------|-------|
| Working memory slots | 20 max |
| Memory limit | 256MB |
| CPU time per operation | 10 seconds |
| Attention targets | 50 max |
| Scaffold description | 5,000 characters |

### Rate Limits

| Tool | Requests/Minute | Max Concurrent |
|------|-----------------|----------------|
| `working-memory` | 120 | 10 |
| `attention-control` | 60 | 5 |
| `meta-monitor` | 60 | 5 |
| `scaffold` | 30 | 3 |
| `cognitive-load` | 60 | 5 |

## Dependencies

- `cognitum-gate-kernel` - Core cognitive kernel for memory gating and attention control
- `sona` - Self-Optimizing Neural Architecture for adaptive cognition
- `ruvector-attention-wasm` - Multi-head attention for cognitive focus
- `ruvector-nervous-system-wasm` - Coordination between cognitive subsystems
- `micro-hnsw-wasm` - Fast retrieval for episodic memory

## Use Cases

1. **Complex Reasoning**: Support multi-step reasoning with working memory persistence
2. **Research Synthesis**: Maintain focus across long document analysis sessions
3. **Learning Enhancement**: Adaptive scaffolding for skill acquisition
4. **Error Prevention**: Meta-cognitive monitoring catches reasoning errors before output
5. **Context Management**: Intelligent attention control for managing long contexts

## Related Plugins

| Plugin | Description | Synergy |
|--------|-------------|---------|
| [@claude-flow/plugin-neural-coordination](https://www.npmjs.com/package/@claude-flow/plugin-neural-coordination) | Multi-agent coordination | Cognitive kernel provides enhanced reasoning for coordinated agents |
| [@claude-flow/plugin-hyperbolic-reasoning](https://www.npmjs.com/package/@claude-flow/plugin-hyperbolic-reasoning) | Hierarchical reasoning | Combines hierarchical structure with cognitive scaffolding |
| [@claude-flow/plugin-quantum-optimizer](https://www.npmjs.com/package/@claude-flow/plugin-quantum-optimizer) | Quantum-inspired optimization | Optimizes cognitive resource allocation and attention scheduling |

## Architecture

```
+------------------+     +----------------------+     +------------------+
|    LLM Input     |---->|  Cognitive Kernel    |---->|  Enhanced Output |
|   (Prompts)      |     |  (WASM Accelerated)  |     |  (Augmented)     |
+------------------+     +----------------------+     +------------------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
       +------+------+     +-------+-------+    +------+------+
       | Cognitum    |     |    SONA       |    | Attention   |
       | Gate Kernel |     | Self-Optimize |    | Control     |
       +-------------+     +---------------+    +-------------+
              |                    |                    |
              +--------------------+--------------------+
                                   |
                           +-------+-------+
                           | Working Memory |
                           | (HNSW Index)   |
                           +---------------+
```

## License

MIT

<!-- adr-356:footer:start -->
---

Built by [rUv](https://ruv.io) · [ruv.io](https://ruv.io) · [Source](https://github.com/ruvnet/ruflo/tree/main/v3/plugins/cognitive-kernel)
<!-- adr-356:footer:end -->
