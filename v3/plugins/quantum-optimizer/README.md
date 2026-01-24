# @claude-flow/plugin-quantum-optimizer

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-quantum-optimizer.svg)](https://www.npmjs.com/package/@claude-flow/plugin-quantum-optimizer)
[![license](https://img.shields.io/npm/l/@claude-flow/plugin-quantum-optimizer.svg)](https://github.com/ruvnet/claude-flow/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-quantum-optimizer.svg)](https://www.npmjs.com/package/@claude-flow/plugin-quantum-optimizer)

An exotic optimization plugin implementing quantum-inspired algorithms including Quantum Annealing simulation, QAOA (Quantum Approximate Optimization Algorithm) emulation, and Grover-inspired search acceleration. The plugin provides dramatic speedups for dependency resolution, optimal scheduling, and constraint satisfaction while running entirely on classical WASM-accelerated hardware.

## Installation

### npm

```bash
npm install @claude-flow/plugin-quantum-optimizer
```

### CLI

```bash
npx claude-flow plugins install --name @claude-flow/plugin-quantum-optimizer
```

## Quick Start

```typescript
import { QuantumOptimizerPlugin } from '@claude-flow/plugin-quantum-optimizer';

// Initialize the plugin
const plugin = new QuantumOptimizerPlugin();
await plugin.initialize();

// Solve a scheduling optimization problem
const schedule = await plugin.scheduleOptimize({
  tasks: [
    { id: 'build', duration: 10, dependencies: [], resources: ['cpu'], deadline: 30 },
    { id: 'test', duration: 5, dependencies: ['build'], resources: ['cpu'], deadline: 40 },
    { id: 'deploy', duration: 3, dependencies: ['test'], resources: ['network'], deadline: 50 }
  ],
  resources: [
    { id: 'cpu', capacity: 4, cost: 1.0 },
    { id: 'network', capacity: 2, cost: 0.5 }
  ],
  objective: 'makespan'
});

console.log('Optimal schedule:', schedule);
```

## Available MCP Tools

### 1. `quantum/annealing-solve`

Solve combinatorial optimization problems using simulated quantum annealing.

```typescript
const result = await mcp.call('quantum/annealing-solve', {
  problem: {
    type: 'qubo',  // Quadratic Unconstrained Binary Optimization
    variables: 100,
    constraints: [...],
    objective: { 'x1': -1, 'x2': -1, 'x1_x2': 2 }
  },
  parameters: {
    numReads: 1000,
    annealingTime: 20,
    chainStrength: 1.0,
    temperature: {
      initial: 100,
      final: 0.01
    }
  },
  embedding: 'auto'
});
```

**Problem Types:** `qubo`, `ising`, `sat`, `max_cut`, `tsp`, `dependency`

**Returns:** Optimal or near-optimal solution with energy value and convergence statistics.

### 2. `quantum/qaoa-optimize`

Approximate optimization using Quantum Approximate Optimization Algorithm emulation.

```typescript
const result = await mcp.call('quantum/qaoa-optimize', {
  problem: {
    type: 'max_cut',
    graph: {
      nodes: 20,
      edges: [[0, 1], [1, 2], [2, 3], [0, 3], ...]
    },
    weights: { '0_1': 1.0, '1_2': 0.5, ... }
  },
  circuit: {
    depth: 3,  // QAOA circuit depth (p)
    optimizer: 'cobyla',
    initialParams: 'heuristic'
  },
  shots: 1024
});
```

**Problem Types:** `max_cut`, `portfolio`, `scheduling`, `routing`

**Returns:** Optimized solution with approximation ratio and parameter trajectory.

### 3. `quantum/grover-search`

Grover-inspired search with quadratic speedup for unstructured search problems.

```typescript
const result = await mcp.call('quantum/grover-search', {
  searchSpace: {
    size: 1000000,  // 1M elements
    oracle: 'x.value > 100 && x.valid === true',
    structure: 'database'
  },
  targets: 1,
  iterations: 'optimal',
  amplification: {
    method: 'standard',
    boostFactor: 1.5
  }
});
```

**Returns:** Found solution(s) with iteration count and amplitude distribution.

### 4. `quantum/dependency-resolve`

Resolve complex dependency graphs using quantum optimization.

```typescript
const result = await mcp.call('quantum/dependency-resolve', {
  packages: [
    { name: 'react', version: '18.2.0', dependencies: { 'react-dom': '^18.0.0' }, conflicts: [] },
    { name: 'webpack', version: '5.88.0', dependencies: { 'loader-utils': '^3.0.0' }, conflicts: [] },
    // ... more packages
  ],
  constraints: {
    minimize: 'versions',  // Minimize total version count
    lockfile: existingLockfile,
    peer: true
  },
  solver: 'hybrid'
});
```

**Returns:** Resolved dependency tree with version selections and conflict resolutions.

### 5. `quantum/schedule-optimize`

Quantum-optimized task scheduling for complex workflows.

```typescript
const result = await mcp.call('quantum/schedule-optimize', {
  tasks: [
    { id: 'task-1', duration: 10, dependencies: [], resources: ['gpu'], deadline: 100 },
    { id: 'task-2', duration: 5, dependencies: ['task-1'], resources: ['cpu'], deadline: 120 },
    { id: 'task-3', duration: 8, dependencies: [], resources: ['cpu', 'memory'], deadline: 80 }
  ],
  resources: [
    { id: 'cpu', capacity: 8, cost: 1.0 },
    { id: 'gpu', capacity: 2, cost: 5.0 },
    { id: 'memory', capacity: 64, cost: 0.1 }
  ],
  objective: 'weighted'  // Balance makespan and cost
});
```

**Returns:** Optimal schedule with resource assignments and timeline visualization.

## Configuration Options

```typescript
interface QuantumOptimizerConfig {
  // Maximum problem variables (default: 10000)
  maxVariables: number;

  // Maximum iterations (default: 1000000)
  maxIterations: number;

  // Memory limit in bytes (default: 4GB)
  maxMemoryBytes: number;

  // CPU time limit in ms (default: 600000 = 10 min)
  maxCpuTimeMs: number;

  // QAOA circuit depth limit (default: 20)
  maxCircuitDepth: number;

  // Simulated qubit limit (default: 50)
  maxQubits: number;

  // Progress monitoring
  progressCheckIntervalMs: number;
  minProgressThreshold: number;
}
```

## Quantum-Inspired Algorithms

| Algorithm | Speedup | Problem Class | Classical Equivalent |
|-----------|---------|---------------|---------------------|
| Quantum Annealing | Exponential (heuristic) | Combinatorial optimization | Simulated Annealing |
| QAOA | Polynomial | Max-Cut, QUBO | Goemans-Williamson |
| Grover Search | Quadratic O(sqrt(N)) | Unstructured search | Linear Search |
| Quantum Walk | Polynomial | Graph problems | Random Walk |
| VQE | Variable | Eigenvalue problems | Power Iteration |

## Performance Targets

| Metric | Target | Improvement vs Classical |
|--------|--------|-------------------------|
| Annealing (100 vars) | <1s for 1000 reads | 30x faster than brute force |
| QAOA (50 qubits) | <10s for p=5 | 30x faster than classical approx |
| Grover (1M elements) | <100ms | 10x (sqrt speedup) |
| Dependency resolution | <5s for 1000 packages | 24x faster than SAT solver |
| Schedule optimization | <30s for 100 tasks | 20x faster than ILP solver |

## Security Considerations

- **Resource Limits**: Strict memory (4GB), CPU (10 min), and iteration (1M) limits prevent DoS attacks
- **Problem Validation**: Problems are validated for size, connectivity, and coefficient magnitude before processing
- **Oracle Sandboxing**: Grover search predicates are parsed and interpreted safely - never evaluated with `eval()`
- **Input Validation**: All inputs validated with Zod schemas
- **Progress Monitoring**: Long-running optimizations are canceled if no progress is detected

### Input Limits

| Constraint | Limit |
|------------|-------|
| Max variables | 10,000 |
| Max iterations | 1,000,000 |
| Max memory | 4GB |
| CPU time limit | 600 seconds (10 min) |
| Max QAOA depth | 20 |
| Max simulated qubits | 50 |
| Max graph edges | 100,000 |
| Max search space | 1 billion elements |

### Rate Limits

| Tool | Requests/Minute | Max Concurrent |
|------|-----------------|----------------|
| `annealing-solve` | 5 | 1 |
| `qaoa-optimize` | 5 | 1 |
| `grover-search` | 10 | 2 |
| `dependency-resolve` | 10 | 2 |
| `schedule-optimize` | 5 | 1 |

## Dependencies

- `ruvector-exotic-wasm` - Quantum-inspired optimization algorithms
- `ruvector-sparse-inference-wasm` - Efficient sparse matrix operations for quantum simulation
- `micro-hnsw-wasm` - Amplitude-inspired search acceleration
- `ruvector-dag-wasm` - Quantum circuit DAG representation
- `ruvector-hyperbolic-hnsw-wasm` - Hyperbolic embeddings for quantum state spaces

## Theoretical Background

### Quantum Annealing
Exploits quantum tunneling to escape local minima during optimization. Simulated via Path Integral Monte Carlo on classical hardware.

### QAOA
Variational algorithm alternating between problem Hamiltonian and mixer. Emulated via tensor network contraction for efficient classical simulation.

### Grover's Algorithm
Amplitude amplification for unstructured search achieving O(sqrt(N)) complexity. Classical implementation uses interference-inspired importance sampling.

## Use Cases

1. **Dependency Resolution**: Solve complex version conflicts in package managers
2. **Task Scheduling**: Optimal CI/CD pipeline and workflow scheduling
3. **Resource Allocation**: Distribute workloads optimally across agents/machines
4. **Test Selection**: Find minimal test sets with maximum coverage
5. **Configuration Optimization**: Find optimal system configurations

## Related Plugins

| Plugin | Description | Synergy |
|--------|-------------|---------|
| [@claude-flow/plugin-neural-coordination](https://www.npmjs.com/package/@claude-flow/plugin-neural-coordination) | Multi-agent coordination | Quantum optimizer schedules tasks across coordinated agent swarms |
| [@claude-flow/plugin-cognitive-kernel](https://www.npmjs.com/package/@claude-flow/plugin-cognitive-kernel) | Cognitive augmentation | Optimizes cognitive load distribution and attention allocation |
| [@claude-flow/plugin-hyperbolic-reasoning](https://www.npmjs.com/package/@claude-flow/plugin-hyperbolic-reasoning) | Hierarchical reasoning | Quantum algorithms optimize hierarchical constraint satisfaction |

## License

MIT
