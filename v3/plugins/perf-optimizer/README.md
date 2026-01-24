# @claude-flow/plugin-performance-optimizer

A comprehensive performance optimization plugin combining sparse inference for efficient trace analysis with graph neural networks for dependency chain optimization. The plugin enables intelligent bottleneck detection, memory leak identification, N+1 query detection, and bundle size optimization while providing explainable recommendations based on historical performance patterns.

## Installation

### npm

```bash
npm install @claude-flow/plugin-performance-optimizer
```

### CLI

```bash
npx @claude-flow/cli@latest plugins install @claude-flow/plugin-performance-optimizer
```

## Quick Start

```typescript
import { PerfOptimizerPlugin } from '@claude-flow/plugin-performance-optimizer';

// Initialize the plugin
const plugin = new PerfOptimizerPlugin();
await plugin.initialize();

// Detect performance bottlenecks
const bottlenecks = await plugin.detectBottlenecks({
  traceData: {
    format: 'otlp',
    spans: traceSpans,
    metrics: performanceMetrics
  },
  analysisScope: ['cpu', 'memory', 'database'],
  threshold: {
    latencyP95: 500,  // 500ms
    throughput: 1000,
    errorRate: 0.01
  }
});

console.log('Detected bottlenecks:', bottlenecks);
```

## Available MCP Tools

### 1. `perf/bottleneck-detect`

Detect performance bottlenecks using GNN-based dependency analysis.

```typescript
// Example usage via MCP
const result = await mcp.call('perf/bottleneck-detect', {
  traceData: {
    format: 'chrome_devtools',
    spans: chromeTraceSpans,
    metrics: { renderTime: 150, scriptTime: 200 }
  },
  analysisScope: ['cpu', 'render', 'network'],
  threshold: {
    latencyP95: 100,
    throughput: 60
  }
});
```

**Returns:** List of identified bottlenecks with severity, location, and recommended fixes.

### 2. `perf/memory-analyze`

Analyze memory usage patterns and detect potential leaks.

```typescript
const result = await mcp.call('perf/memory-analyze', {
  heapSnapshot: '/path/to/heap-snapshot.heapsnapshot',
  timeline: memoryTimelineData,
  analysis: ['leak_detection', 'retention_analysis', 'gc_pressure'],
  compareBaseline: '/path/to/baseline-snapshot.heapsnapshot'
});
```

**Returns:** Memory analysis report with leak candidates, retention chains, and optimization suggestions.

### 3. `perf/query-optimize`

Detect N+1 queries and suggest database optimizations.

```typescript
const result = await mcp.call('perf/query-optimize', {
  queries: [
    { sql: 'SELECT * FROM users WHERE id = ?', duration: 5, resultSize: 1 },
    { sql: 'SELECT * FROM orders WHERE user_id = ?', duration: 3, resultSize: 10 }
  ],
  patterns: ['n_plus_1', 'missing_index', 'slow_join'],
  suggestIndexes: true
});
```

**Returns:** Detected query anti-patterns with suggested batch alternatives and index recommendations.

### 4. `perf/bundle-optimize`

Analyze and optimize JavaScript bundle size.

```typescript
const result = await mcp.call('perf/bundle-optimize', {
  bundleStats: '/path/to/webpack-stats.json',
  analysis: ['tree_shaking', 'code_splitting', 'duplicate_deps', 'large_modules'],
  targets: {
    maxSize: 250,  // 250KB
    maxChunks: 10
  }
});
```

**Returns:** Bundle analysis with optimization recommendations for tree shaking, code splitting, and dependency deduplication.

### 5. `perf/config-optimize`

Suggest optimal configurations based on workload patterns using SONA learning.

```typescript
const result = await mcp.call('perf/config-optimize', {
  workloadProfile: {
    type: 'api',
    metrics: { requestsPerSecond: 1000, avgLatency: 50 },
    constraints: { maxMemory: '4GB', maxCpu: 4 }
  },
  configSpace: {
    poolSize: { type: 'number', range: [10, 100], current: 25 },
    cacheSize: { type: 'number', range: [100, 1000], current: 200 }
  },
  objective: 'latency'
});
```

**Returns:** Optimized configuration values with expected performance improvements.

## Configuration Options

```typescript
interface PerfOptimizerConfig {
  // WASM memory limit (default: 2GB)
  memoryLimit: number;

  // Analysis timeout in seconds (default: 300)
  analysisTimeout: number;

  // Enable SONA learning for configuration optimization
  enableSONALearning: boolean;

  // Supported trace formats
  supportedFormats: ('otlp' | 'chrome_devtools' | 'jaeger' | 'zipkin')[];

  // Performance thresholds for alerting
  thresholds: {
    latencyP95: number;
    throughput: number;
    errorRate: number;
  };
}
```

## Performance Targets

| Metric | Target | Improvement vs Baseline |
|--------|--------|------------------------|
| Trace analysis (1M spans) | <5s | 24x faster |
| Memory analysis (1GB heap) | <30s | 10x faster |
| Query pattern detection (10K queries) | <1s | 600x faster |
| Bundle analysis (10MB) | <10s | 6x faster |
| Config optimization | <1min convergence | 1440x+ faster |

## Security Considerations

- **Trace Data Sanitization**: Automatically sanitizes sensitive data (passwords, tokens, cookies) from trace data before processing
- **Query Parse-Only**: SQL queries are parsed and analyzed but never executed
- **WASM Sandboxing**: All analysis runs in isolated WASM sandbox with 2GB memory limit and no network access
- **Path Validation**: Bundle stats paths are validated to prevent path traversal attacks
- **Input Validation**: All inputs validated with Zod schemas to prevent injection attacks

### Input Limits

| Input | Limit |
|-------|-------|
| Max spans per trace | 1,000,000 |
| Max query size | 10KB |
| Max queries per batch | 10,000 |
| Max heap snapshot size | 1GB |
| CPU time limit | 300 seconds |

## Dependencies

- `ruvector-sparse-inference-wasm` - Efficient sparse performance trace processing
- `ruvector-gnn-wasm` - Dependency chain analysis and critical path detection
- `micro-hnsw-wasm` - Similar performance pattern matching
- `ruvector-fpga-transformer-wasm` - Fast transformer inference for trace analysis
- `sona` - Learning optimal configurations from historical data

## Supported Formats

| Category | Formats |
|----------|---------|
| Tracing | OpenTelemetry, Jaeger, Zipkin, Chrome DevTools |
| Profiling | Chrome CPU Profile, Node.js Profile, pprof |
| Memory | Chrome Heap Snapshot, Node.js Heap |
| Bundles | Webpack Stats, Vite Stats, Rollup |

## License

MIT
