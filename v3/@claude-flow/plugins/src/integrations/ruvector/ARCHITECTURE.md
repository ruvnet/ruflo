# RuVector PostgreSQL Bridge Plugin Architecture

## Document Information

| Property | Value |
|----------|-------|
| Version | 1.0.0 |
| Status | Draft |
| Author | Claude Flow Architecture Team |
| Last Updated | 2026-01-16 |
| ADR References | ADR-006 (Unified Memory), ADR-009 (Hybrid Memory Backend) |

---

## 1. Executive Summary

The RuVector PostgreSQL Bridge plugin provides a high-performance integration layer between Claude-Flow v3 and PostgreSQL databases enhanced with RuVector extensions. This plugin exposes 53+ SQL functions for vector operations, 39 attention mechanisms, Graph Neural Network (GNN) layers, hyperbolic embeddings, and self-learning capabilities through MCP tools.

### Key Capabilities

- **Vector Operations**: Similarity search, clustering, quantization (optimized)
- **Attention Mechanisms**: Multi-head, self-attention, cross-attention, sparse variants
- **Graph Processing**: GNN layers, message passing, node/edge embeddings
- **Hyperbolic Geometry**: Poincare ball, Lorentz model for hierarchical data
- **Self-Learning**: Query optimization, index tuning, pattern recognition

---

## 2. System Context (C4 Level 1)

```
+------------------------------------------------------------------+
|                        Claude Code / MCP Client                   |
+------------------------------------------------------------------+
                                |
                                | MCP Protocol (stdio/HTTP/WebSocket)
                                v
+------------------------------------------------------------------+
|                    Claude-Flow v3 MCP Server                      |
|  +------------------------------------------------------------+  |
|  |                 RuVector PostgreSQL Bridge                  |  |
|  |  +----------------+  +----------------+  +---------------+  |  |
|  |  | Connection     |  | Tool           |  | Query         |  |  |
|  |  | Pool Manager   |  | Registry       |  | Executor      |  |  |
|  |  +----------------+  +----------------+  +---------------+  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
                                |
                                | pg Protocol (libpq/node-postgres)
                                v
+------------------------------------------------------------------+
|                    PostgreSQL + RuVector Extensions               |
|  +------------------+  +------------------+  +----------------+   |
|  | pg_ruvector      |  | pg_ruvector_gnn  |  | pg_ruvector    |   |
|  | (vectors)        |  | (graph ops)      |  | _attention     |   |
|  +------------------+  +------------------+  +----------------+   |
+------------------------------------------------------------------+
```

---

## 3. Container Architecture (C4 Level 2)

### 3.1 Plugin Container Structure

```
@claude-flow/plugins/src/integrations/ruvector/
|
+-- index.ts                    # Plugin entry point & exports
+-- plugin.ts                   # Main plugin class (extends BasePlugin)
+-- ARCHITECTURE.md             # This document
|
+-- core/
|   +-- connection-manager.ts   # PostgreSQL connection pooling
|   +-- query-executor.ts       # Query execution with metrics
|   +-- schema-manager.ts       # Extension & schema management
|   +-- types.ts                # Core type definitions
|
+-- sql/
|   +-- index.ts                # SQL function registry
|   +-- vector-functions.ts     # 15+ vector similarity functions
|   +-- graph-functions.ts      # 12+ graph-aware query functions
|   +-- pattern-functions.ts    # 10+ pattern matching functions
|   +-- index-functions.ts      # 8+ index management functions
|   +-- aggregate-functions.ts  # 8+ vector aggregation functions
|
+-- attention/
|   +-- index.ts                # Attention mechanism registry
|   +-- multi-head.ts           # Multi-head attention (8 variants)
|   +-- self-attention.ts       # Self-attention (6 variants)
|   +-- cross-attention.ts      # Cross-attention (5 variants)
|   +-- sparse-attention.ts     # Sparse attention (10 variants)
|   +-- linear-attention.ts     # Linear attention (5 variants)
|   +-- flash-attention.ts      # Flash Attention v2 integration
|   +-- types.ts                # Attention type definitions
|
+-- gnn/
|   +-- index.ts                # GNN layer registry
|   +-- graph-conv.ts           # Graph convolution layers
|   +-- message-passing.ts      # Message passing networks
|   +-- node-embeddings.ts      # Node embedding generation
|   +-- edge-embeddings.ts      # Edge embedding generation
|   +-- pooling.ts              # Graph pooling operations
|   +-- types.ts                # GNN type definitions
|
+-- hyperbolic/
|   +-- index.ts                # Hyperbolic embedding registry
|   +-- poincare.ts             # Poincare ball model
|   +-- lorentz.ts              # Lorentz (hyperboloid) model
|   +-- distance.ts             # Distance calculations
|   +-- operations.ts           # Mobius operations
|   +-- types.ts                # Hyperbolic type definitions
|
+-- learning/
|   +-- index.ts                # Self-learning registry
|   +-- query-optimizer.ts      # Query plan optimization
|   +-- index-tuner.ts          # Index parameter tuning
|   +-- pattern-recognizer.ts   # Pattern recognition engine
|   +-- statistics-collector.ts # Usage statistics collection
|   +-- types.ts                # Learning type definitions
|
+-- mcp/
|   +-- index.ts                # MCP tool registration
|   +-- vector-tools.ts         # Vector operation tools
|   +-- attention-tools.ts      # Attention mechanism tools
|   +-- gnn-tools.ts            # GNN operation tools
|   +-- hyperbolic-tools.ts     # Hyperbolic embedding tools
|   +-- admin-tools.ts          # Administration tools
```

---

## 4. Component Architecture (C4 Level 3)

### 4.1 Core Components

#### 4.1.1 Connection Manager

```typescript
/**
 * PostgreSQL Connection Pool Manager
 *
 * Manages connection lifecycle, health checks, and load balancing
 * for PostgreSQL instances with RuVector extensions.
 */
interface IConnectionManager {
  // Connection lifecycle
  initialize(config: ConnectionConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Connection acquisition
  acquire(): Promise<PooledConnection>;
  release(connection: PooledConnection): void;

  // Health monitoring
  healthCheck(): Promise<HealthCheckResult>;
  getStats(): ConnectionPoolStats;

  // Extension management
  ensureExtensions(): Promise<ExtensionStatus[]>;
}

interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: SSLConfig;
  pool: {
    min: number;           // Default: 2
    max: number;           // Default: 10
    idleTimeout: number;   // Default: 30000ms
    acquireTimeout: number; // Default: 5000ms
  };
  extensions: {
    ruvector: boolean;
    ruvector_gnn?: boolean;
    ruvector_attention?: boolean;
  };
}
```

**Design Decisions**:
- Uses `pg` (node-postgres) for PostgreSQL connectivity
- Connection pooling with configurable min/max connections
- Automatic reconnection with exponential backoff
- Health checks verify extension availability

#### 4.1.2 Query Executor

```typescript
/**
 * Query Executor with Metrics Collection
 *
 * Executes SQL queries with timing, caching, and error handling.
 */
interface IQueryExecutor {
  // Query execution
  execute<T>(query: string, params?: unknown[]): Promise<QueryResult<T>>;
  executeMany<T>(queries: BatchQuery[]): Promise<QueryResult<T>[]>;

  // Prepared statements
  prepare(name: string, query: string): Promise<PreparedStatement>;
  executePrepared<T>(name: string, params?: unknown[]): Promise<QueryResult<T>>;

  // Transaction support
  beginTransaction(): Promise<Transaction>;

  // Metrics
  getQueryStats(): QueryStatistics;
  resetStats(): void;
}

interface QueryResult<T> {
  rows: T[];
  rowCount: number;
  fields: FieldInfo[];
  duration: number;
  fromCache: boolean;
}
```

**Design Decisions**:
- Query result caching with configurable TTL
- Automatic query plan analysis for optimization hints
- Prepared statement reuse for repeated queries
- Comprehensive metrics collection

### 4.2 SQL Functions Module

#### 4.2.1 Vector Functions (15+)

| Function | Description | SQL Signature |
|----------|-------------|---------------|
| `rv_similarity` | Cosine similarity | `rv_similarity(vector, vector) -> float` |
| `rv_distance` | Euclidean distance | `rv_distance(vector, vector) -> float` |
| `rv_inner_product` | Inner product | `rv_inner_product(vector, vector) -> float` |
| `rv_l1_distance` | Manhattan distance | `rv_l1_distance(vector, vector) -> float` |
| `rv_l2_distance` | L2 distance | `rv_l2_distance(vector, vector) -> float` |
| `rv_cosine_distance` | Cosine distance | `rv_cosine_distance(vector, vector) -> float` |
| `rv_normalize` | L2 normalization | `rv_normalize(vector) -> vector` |
| `rv_add` | Vector addition | `rv_add(vector, vector) -> vector` |
| `rv_subtract` | Vector subtraction | `rv_subtract(vector, vector) -> vector` |
| `rv_multiply` | Scalar multiplication | `rv_multiply(vector, float) -> vector` |
| `rv_dimensions` | Get dimensions | `rv_dimensions(vector) -> int` |
| `rv_slice` | Vector slicing | `rv_slice(vector, int, int) -> vector` |
| `rv_concat` | Vector concatenation | `rv_concat(vector, vector) -> vector` |
| `rv_quantize` | Quantization | `rv_quantize(vector, int) -> bytea` |
| `rv_dequantize` | Dequantization | `rv_dequantize(bytea, int) -> vector` |

```typescript
interface VectorFunctions {
  // Similarity/Distance
  similarity(a: Float32Array, b: Float32Array): Promise<number>;
  distance(a: Float32Array, b: Float32Array, metric: DistanceMetric): Promise<number>;

  // Operations
  normalize(v: Float32Array): Promise<Float32Array>;
  add(a: Float32Array, b: Float32Array): Promise<Float32Array>;
  subtract(a: Float32Array, b: Float32Array): Promise<Float32Array>;
  multiply(v: Float32Array, scalar: number): Promise<Float32Array>;

  // Transformations
  quantize(v: Float32Array, bits: 4 | 8 | 16): Promise<Uint8Array>;
  dequantize(data: Uint8Array, bits: 4 | 8 | 16): Promise<Float32Array>;
}

type DistanceMetric = 'euclidean' | 'cosine' | 'manhattan' | 'inner_product';
```

#### 4.2.2 Graph-Aware Functions (12+)

| Function | Description | SQL Signature |
|----------|-------------|---------------|
| `rv_graph_neighbors` | K-nearest neighbors | `rv_graph_neighbors(id, k) -> setof record` |
| `rv_graph_similarity` | Graph-based similarity | `rv_graph_similarity(id1, id2) -> float` |
| `rv_graph_cluster` | Graph clustering | `rv_graph_cluster(table, k) -> setof record` |
| `rv_graph_pagerank` | PageRank scores | `rv_graph_pagerank(table) -> setof record` |
| `rv_graph_connected` | Connected components | `rv_graph_connected(table) -> setof record` |
| `rv_graph_shortest_path` | Shortest path | `rv_graph_shortest_path(table, id1, id2) -> path` |
| `rv_graph_community` | Community detection | `rv_graph_community(table) -> setof record` |
| `rv_graph_centrality` | Node centrality | `rv_graph_centrality(table, metric) -> setof record` |
| `rv_graph_embedding` | Graph embedding | `rv_graph_embedding(table) -> setof vector` |
| `rv_graph_walk` | Random walk | `rv_graph_walk(table, start, steps) -> path` |
| `rv_graph_subgraph` | Subgraph extraction | `rv_graph_subgraph(table, nodes) -> table` |
| `rv_graph_metrics` | Graph statistics | `rv_graph_metrics(table) -> record` |

#### 4.2.3 Pattern Matching Functions (10+)

| Function | Description | SQL Signature |
|----------|-------------|---------------|
| `rv_pattern_search` | Pattern similarity search | `rv_pattern_search(vector, table, k) -> setof record` |
| `rv_pattern_match` | Exact pattern match | `rv_pattern_match(pattern, table) -> setof record` |
| `rv_pattern_cluster` | Pattern clustering | `rv_pattern_cluster(table, k) -> setof record` |
| `rv_pattern_detect` | Anomaly detection | `rv_pattern_detect(table, threshold) -> setof record` |
| `rv_pattern_frequent` | Frequent patterns | `rv_pattern_frequent(table, min_support) -> setof record` |
| `rv_pattern_sequence` | Sequence pattern mining | `rv_pattern_sequence(table, max_gap) -> setof record` |
| `rv_pattern_associate` | Association rules | `rv_pattern_associate(table, confidence) -> setof record` |
| `rv_pattern_timeseries` | Time series patterns | `rv_pattern_timeseries(table, window) -> setof record` |
| `rv_pattern_similarity_join` | Similarity join | `rv_pattern_similarity_join(t1, t2, threshold) -> setof record` |
| `rv_pattern_deduplicate` | Near-duplicate detection | `rv_pattern_deduplicate(table, threshold) -> setof record` |

#### 4.2.4 Index Management Functions (8+)

| Function | Description | SQL Signature |
|----------|-------------|---------------|
| `rv_index_create` | Create HNSW index | `rv_index_create(table, column, config) -> void` |
| `rv_index_drop` | Drop index | `rv_index_drop(index_name) -> void` |
| `rv_index_rebuild` | Rebuild index | `rv_index_rebuild(index_name) -> void` |
| `rv_index_stats` | Index statistics | `rv_index_stats(index_name) -> record` |
| `rv_index_tune` | Auto-tune parameters | `rv_index_tune(index_name) -> record` |
| `rv_index_validate` | Validate index integrity | `rv_index_validate(index_name) -> boolean` |
| `rv_index_compact` | Compact index | `rv_index_compact(index_name) -> void` |
| `rv_index_analyze` | Analyze query performance | `rv_index_analyze(query) -> record` |

### 4.3 Attention Mechanisms Module (39 Total)

#### 4.3.1 Multi-Head Attention (8 variants)

```typescript
interface MultiHeadAttention {
  // Standard implementations
  standard(query: Tensor, key: Tensor, value: Tensor, config: MHAConfig): Promise<Tensor>;
  scaled(query: Tensor, key: Tensor, value: Tensor, config: MHAConfig): Promise<Tensor>;

  // Optimized variants
  flashAttention(query: Tensor, key: Tensor, value: Tensor, config: FlashConfig): Promise<Tensor>;
  memoryEfficient(query: Tensor, key: Tensor, value: Tensor, config: MEConfig): Promise<Tensor>;

  // Specialized variants
  rotary(query: Tensor, key: Tensor, value: Tensor, config: RoPEConfig): Promise<Tensor>;
  alibi(query: Tensor, key: Tensor, value: Tensor, config: ALiBiConfig): Promise<Tensor>;
  grouped(query: Tensor, key: Tensor, value: Tensor, config: GQAConfig): Promise<Tensor>;
  multiQuery(query: Tensor, key: Tensor, value: Tensor, config: MQAConfig): Promise<Tensor>;
}

interface MHAConfig {
  numHeads: number;
  headDim: number;
  dropout?: number;
  causal?: boolean;
  maxSeqLen?: number;
}
```

| Variant | Description | Use Case |
|---------|-------------|----------|
| `mha_standard` | Standard multi-head attention | General purpose |
| `mha_scaled` | Scaled dot-product attention | Transformer default |
| `mha_flash` | Flash Attention v2 | Long sequences (CPU-optimized) |
| `mha_memory_efficient` | Memory-efficient attention | Large batch sizes |
| `mha_rotary` | Rotary position embeddings (RoPE) | Position-aware attention |
| `mha_alibi` | Attention with Linear Biases | Extrapolation to longer sequences |
| `mha_grouped` | Grouped-Query Attention (GQA) | Reduced KV cache |
| `mha_multi_query` | Multi-Query Attention (MQA) | Single KV head |

#### 4.3.2 Self-Attention (6 variants)

| Variant | Description | Complexity |
|---------|-------------|------------|
| `self_standard` | Standard self-attention | O(n^2) |
| `self_causal` | Causal (autoregressive) | O(n^2) |
| `self_bidirectional` | Bidirectional | O(n^2) |
| `self_local` | Local window attention | O(n * w) |
| `self_sliding` | Sliding window | O(n * w) |
| `self_dilated` | Dilated attention | O(n * w) |

#### 4.3.3 Cross-Attention (5 variants)

| Variant | Description | Use Case |
|---------|-------------|----------|
| `cross_standard` | Standard cross-attention | Encoder-decoder |
| `cross_memory` | Memory-augmented | External memory |
| `cross_perceiver` | Perceiver-style | Variable-length inputs |
| `cross_latent` | Latent cross-attention | Latent space mapping |
| `cross_adaptive` | Adaptive cross-attention | Dynamic routing |

#### 4.3.4 Sparse Attention (10 variants)

| Variant | Description | Pattern |
|---------|-------------|---------|
| `sparse_strided` | Strided attention | Fixed stride |
| `sparse_fixed` | Fixed pattern | Predefined mask |
| `sparse_random` | Random attention | Sampled positions |
| `sparse_local_global` | Local + global tokens | Longformer-style |
| `sparse_bigbird` | BigBird pattern | Random + local + global |
| `sparse_longformer` | Longformer pattern | Sliding + global |
| `sparse_axial` | Axial attention | Row/column decomposition |
| `sparse_star` | Star transformer | Global token hub |
| `sparse_cluster` | Cluster attention | Learned clusters |
| `sparse_routing` | Routing attention | Top-k selection |

#### 4.3.5 Linear Attention (5 variants)

| Variant | Description | Complexity |
|---------|-------------|------------|
| `linear_standard` | Linear attention | O(n) |
| `linear_performer` | Performer (FAVOR+) | O(n) |
| `linear_rfa` | Random Feature Attention | O(n) |
| `linear_cosformer` | Cosine-reweighted | O(n) |
| `linear_nystrom` | Nystrom approximation | O(n * m) |

### 4.4 GNN Layers Module

#### 4.4.1 Graph Convolution Layers

```typescript
interface GraphConvolutionLayers {
  // Standard layers
  gcn(features: Tensor, adjacency: SparseTensor, weights: Tensor): Promise<Tensor>;
  graphSAGE(features: Tensor, adjacency: SparseTensor, config: SAGEConfig): Promise<Tensor>;
  gat(features: Tensor, adjacency: SparseTensor, config: GATConfig): Promise<Tensor>;
  gin(features: Tensor, adjacency: SparseTensor, config: GINConfig): Promise<Tensor>;

  // Advanced layers
  edgeConv(features: Tensor, edges: Tensor, config: EdgeConvConfig): Promise<Tensor>;
  gatv2(features: Tensor, adjacency: SparseTensor, config: GATv2Config): Promise<Tensor>;
  pna(features: Tensor, adjacency: SparseTensor, config: PNAConfig): Promise<Tensor>;
}
```

| Layer | Description | Reference |
|-------|-------------|-----------|
| `GCN` | Graph Convolutional Network | Kipf & Welling (2016) |
| `GraphSAGE` | Sample and Aggregate | Hamilton et al. (2017) |
| `GAT` | Graph Attention Network | Velickovic et al. (2018) |
| `GATv2` | Improved GAT | Brody et al. (2021) |
| `GIN` | Graph Isomorphism Network | Xu et al. (2019) |
| `EdgeConv` | Edge Convolution | Wang et al. (2019) |
| `PNA` | Principal Neighbourhood Aggregation | Corso et al. (2020) |

#### 4.4.2 Message Passing Networks

```typescript
interface MessagePassingNetwork {
  // Core operations
  propagate(
    nodeFeatures: Tensor,
    edgeIndex: Tensor,
    edgeFeatures?: Tensor
  ): Promise<Tensor>;

  // Message functions
  message(source: Tensor, target: Tensor, edge?: Tensor): Promise<Tensor>;
  aggregate(messages: Tensor, index: Tensor, method: AggregateMethod): Promise<Tensor>;
  update(nodeFeatures: Tensor, aggregated: Tensor): Promise<Tensor>;
}

type AggregateMethod = 'sum' | 'mean' | 'max' | 'min' | 'attention' | 'lstm';
```

#### 4.4.3 Node/Edge Embeddings

```typescript
interface EmbeddingGenerator {
  // Node embeddings
  node2vec(adjacency: SparseTensor, config: Node2VecConfig): Promise<Tensor>;
  deepwalk(adjacency: SparseTensor, config: DeepWalkConfig): Promise<Tensor>;
  struc2vec(adjacency: SparseTensor, config: Struc2VecConfig): Promise<Tensor>;

  // Edge embeddings
  edgeEmbedding(nodeEmbeddings: Tensor, edgeIndex: Tensor, method: EdgeMethod): Promise<Tensor>;

  // Subgraph embeddings
  subgraphEmbedding(nodeEmbeddings: Tensor, subgraphNodes: number[]): Promise<Float32Array>;
}

type EdgeMethod = 'hadamard' | 'average' | 'l1' | 'l2' | 'concat';
```

### 4.5 Hyperbolic Embeddings Module

#### 4.5.1 Poincare Ball Model

```typescript
interface PoincareBallOperations {
  // Core operations (curvature c = -1 default)
  expMap(v: Float32Array, base?: Float32Array): Promise<Float32Array>;
  logMap(point: Float32Array, base?: Float32Array): Promise<Float32Array>;

  // Distance
  distance(a: Float32Array, b: Float32Array): Promise<number>;

  // Mobius operations
  mobiusAdd(a: Float32Array, b: Float32Array): Promise<Float32Array>;
  mobiusScalarMul(r: number, v: Float32Array): Promise<Float32Array>;
  mobiusMatVecMul(M: Float32Array[], v: Float32Array): Promise<Float32Array>;

  // Transformations
  euclideanToPoincare(v: Float32Array): Promise<Float32Array>;
  poincareToEuclidean(v: Float32Array): Promise<Float32Array>;

  // Aggregation
  centroid(points: Float32Array[], weights?: number[]): Promise<Float32Array>;
  midpoint(a: Float32Array, b: Float32Array): Promise<Float32Array>;

  // Utilities
  norm(v: Float32Array): Promise<number>;
  project(v: Float32Array): Promise<Float32Array>;
  isInBall(v: Float32Array): Promise<boolean>;
}
```

#### 4.5.2 Lorentz (Hyperboloid) Model

```typescript
interface LorentzModelOperations {
  // Core operations
  expMap(v: Float32Array, base?: Float32Array): Promise<Float32Array>;
  logMap(point: Float32Array, base?: Float32Array): Promise<Float32Array>;

  // Distance (Minkowski inner product based)
  distance(a: Float32Array, b: Float32Array): Promise<number>;
  minkowskiInnerProduct(a: Float32Array, b: Float32Array): Promise<number>;

  // Transformations
  lorentzToPoincare(v: Float32Array): Promise<Float32Array>;
  poincareToLorentz(v: Float32Array): Promise<Float32Array>;

  // Lorentz operations
  lorentzBoost(v: Float32Array, velocity: Float32Array): Promise<Float32Array>;
  parallelTransport(v: Float32Array, from: Float32Array, to: Float32Array): Promise<Float32Array>;

  // Utilities
  lorentzNorm(v: Float32Array): Promise<number>;
  projectToHyperboloid(v: Float32Array): Promise<Float32Array>;
}
```

#### 4.5.3 Distance Calculations

| Function | Model | Formula |
|----------|-------|---------|
| `poincare_distance` | Poincare | d(x,y) = arcosh(1 + 2||x-y||^2 / ((1-||x||^2)(1-||y||^2))) |
| `lorentz_distance` | Lorentz | d(x,y) = arcosh(-<x,y>_L) |
| `klein_distance` | Klein | d(x,y) = arcosh(1 - 2<x,y> / ((1-||x||^2)(1-||y||^2)))^(1/2) |
| `halfplane_distance` | Upper half-plane | d(x,y) = 2 * arcsinh(||x-y|| / (2*sqrt(x_n * y_n))) |

### 4.6 Self-Learning Module

#### 4.6.1 Query Optimizer

```typescript
interface QueryOptimizer {
  // Query analysis
  analyzeQuery(sql: string): Promise<QueryAnalysis>;
  suggestOptimizations(sql: string): Promise<Optimization[]>;

  // Learning
  recordExecution(query: string, plan: QueryPlan, duration: number): Promise<void>;
  learnFromHistory(): Promise<LearningReport>;

  // Optimization application
  rewrite(sql: string): Promise<string>;
  selectIndex(query: string, available: Index[]): Promise<Index | null>;
}

interface QueryAnalysis {
  complexity: 'low' | 'medium' | 'high';
  estimatedCost: number;
  bottlenecks: Bottleneck[];
  recommendations: string[];
  vectorOperations: VectorOperation[];
}

interface Optimization {
  type: 'index' | 'rewrite' | 'parallel' | 'cache';
  description: string;
  expectedSpeedup: number;
  sql?: string;
}
```

#### 4.6.2 Index Tuner

```typescript
interface IndexTuner {
  // Analysis
  analyzeWorkload(queries: QueryLog[]): Promise<WorkloadAnalysis>;
  recommendIndexes(analysis: WorkloadAnalysis): Promise<IndexRecommendation[]>;

  // HNSW tuning
  tuneHNSW(indexName: string): Promise<HNSWParams>;
  estimateHNSWParams(dataSize: number, dimensions: number, queryPattern: QueryPattern): HNSWParams;

  // IVF tuning
  tuneIVF(indexName: string): Promise<IVFParams>;
  estimateIVFParams(dataSize: number, dimensions: number): IVFParams;

  // Monitoring
  monitorPerformance(indexName: string): Promise<PerformanceMetrics>;
}

interface HNSWParams {
  m: number;              // Max connections per layer (default: 16)
  efConstruction: number; // Construction search depth (default: 200)
  efSearch: number;       // Query search depth (default: 100)
  ml: number;            // Level multiplier (default: 1/ln(M))
}
```

#### 4.6.3 Pattern Recognizer

```typescript
interface PatternRecognizer {
  // Query pattern detection
  detectQueryPatterns(queries: Query[]): Promise<QueryPattern[]>;
  classifyQuery(sql: string): Promise<QueryClassification>;

  // Data pattern detection
  detectDataPatterns(vectors: Float32Array[]): Promise<DataPattern[]>;
  detectAnomalies(vectors: Float32Array[], threshold: number): Promise<Anomaly[]>;

  // Learning
  trainOnPatterns(patterns: Pattern[]): Promise<void>;
  predictPattern(query: string): Promise<PatternPrediction>;
}

interface QueryPattern {
  id: string;
  template: string;
  frequency: number;
  avgDuration: number;
  vectorOperations: string[];
}
```

---

## 5. Data Flow Diagrams

### 5.1 Vector Similarity Search Flow

```
+-------------+     +-----------------+     +------------------+
|   Client    |     |  RuVector       |     |   PostgreSQL     |
|   Request   | --> |  Bridge Plugin  | --> |   + RuVector     |
+-------------+     +-----------------+     +------------------+
      |                    |                        |
      | 1. MCP Tool Call   |                        |
      | (vector_search)    |                        |
      |                    |                        |
      |              2. Validate input              |
      |              3. Get connection              |
      |                    |                        |
      |                    | 4. Execute query       |
      |                    | SELECT * FROM items   |
      |                    | ORDER BY embedding    |
      |                    | <=> $1 LIMIT $2       |
      |                    |----------------------->|
      |                    |                        |
      |                    | 5. HNSW index scan    |
      |                    |<-----------------------|
      |                    |                        |
      |              6. Transform results          |
      |              7. Update metrics             |
      |<-------------------|                        |
      | 8. MCP Response    |                        |
```

### 5.2 Attention Mechanism Flow

```
+-------------+     +-----------------+     +------------------+
|   Input     |     |   Attention     |     |   PostgreSQL     |
|   Tensors   | --> |   Module        | --> |   UDF Execution  |
+-------------+     +-----------------+     +------------------+
      |                    |                        |
      | Q, K, V tensors    |                        |
      |                    |                        |
      |              1. Select variant              |
      |              2. Prepare parameters          |
      |                    |                        |
      |                    | 3. Execute UDF         |
      |                    | rv_attention_mha(      |
      |                    |   $Q, $K, $V, $config  |
      |                    | )                      |
      |                    |----------------------->|
      |                    |                        |
      |                    | 4. SIMD computation   |
      |                    | (in-database)         |
      |                    |<-----------------------|
      |                    |                        |
      |              5. Return attention output    |
      |<-------------------|                        |
```

### 5.3 Self-Learning Flow

```
+-------------+     +-----------------+     +------------------+
|   Query     |     |   Learning      |     |   Statistics     |
|   Execution | --> |   Module        | --> |   Storage        |
+-------------+     +-----------------+     +------------------+
      |                    |                        |
      | Query + Results    |                        |
      |                    |                        |
      |              1. Record execution           |
      |              2. Extract features           |
      |                    |                        |
      |                    | 3. Store statistics   |
      |                    |----------------------->|
      |                    |                        |
      |              4. Analyze patterns           |
      |              5. Update models              |
      |                    |                        |
      |              6. Generate recommendations   |
      |<-------------------|                        |
```

---

## 6. Interface Definitions

### 6.1 Plugin Interface

```typescript
import { BasePlugin } from '@claude-flow/plugins';

export class RuVectorPostgreSQLBridgePlugin extends BasePlugin {
  // Metadata
  static readonly PLUGIN_NAME = 'ruvector-postgresql-bridge';
  static readonly VERSION = '1.0.0';

  // Components
  private connectionManager: ConnectionManager;
  private queryExecutor: QueryExecutor;
  private sqlFunctions: SQLFunctionRegistry;
  private attentionMechanisms: AttentionRegistry;
  private gnnLayers: GNNRegistry;
  private hyperbolicOps: HyperbolicRegistry;
  private learningEngine: LearningEngine;

  // Plugin lifecycle
  protected async onInitialize(): Promise<void>;
  protected async onShutdown(): Promise<void>;
  protected async onHealthCheck(): Promise<Record<string, HealthStatus>>;

  // Extension registration
  registerMCPTools(): MCPToolDefinition[];
  registerHooks(): HookDefinition[];
  registerAgentTypes(): AgentTypeDefinition[];
}
```

### 6.2 MCP Tool Definitions

```typescript
// Vector Operations Tools
interface VectorTools {
  'ruvector:search': {
    input: {
      query: number[];      // Query vector
      table: string;        // Table name
      column: string;       // Vector column
      k: number;           // Number of results
      metric?: string;      // Distance metric
      filter?: string;      // SQL WHERE clause
    };
    output: {
      results: Array<{
        id: string;
        score: number;
        metadata: Record<string, unknown>;
      }>;
      duration: number;
    };
  };

  'ruvector:index:create': {
    input: {
      table: string;
      column: string;
      type: 'hnsw' | 'ivf' | 'flat';
      params?: {
        m?: number;
        efConstruction?: number;
        lists?: number;
      };
    };
    output: {
      indexName: string;
      created: boolean;
    };
  };

  // ... 50+ more tools
}

// Attention Tools
interface AttentionTools {
  'ruvector:attention:mha': {
    input: {
      query: number[][];
      key: number[][];
      value: number[][];
      config: {
        numHeads: number;
        dropout?: number;
        causal?: boolean;
      };
    };
    output: {
      attention: number[][];
      weights?: number[][][];
    };
  };

  // ... more attention tools
}

// GNN Tools
interface GNNTools {
  'ruvector:gnn:propagate': {
    input: {
      features: number[][];
      edgeIndex: number[][];
      layer: 'gcn' | 'gat' | 'sage' | 'gin';
      config: Record<string, unknown>;
    };
    output: {
      features: number[][];
    };
  };

  // ... more GNN tools
}
```

### 6.3 Configuration Schema

```typescript
interface RuVectorBridgeConfig {
  // Connection settings
  connection: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: {
      enabled: boolean;
      ca?: string;
      key?: string;
      cert?: string;
    };
  };

  // Pool settings
  pool: {
    min: number;
    max: number;
    idleTimeout: number;
    acquireTimeout: number;
    maxWaitingClients: number;
  };

  // Feature flags
  features: {
    vectorOperations: boolean;
    attentionMechanisms: boolean;
    gnnLayers: boolean;
    hyperbolicEmbeddings: boolean;
    selfLearning: boolean;
  };

  // Learning settings
  learning: {
    enabled: boolean;
    queryHistorySize: number;
    patternUpdateInterval: number;
    indexTuningEnabled: boolean;
  };

  // Performance settings
  performance: {
    queryTimeout: number;
    cacheEnabled: boolean;
    cacheTTL: number;
    maxBatchSize: number;
  };
}
```

---

## 7. Extension Points

### 7.1 Custom SQL Functions

```typescript
interface SQLFunctionExtension {
  // Register custom function
  registerFunction(definition: CustomFunctionDefinition): void;

  // Function definition
  interface CustomFunctionDefinition {
    name: string;
    args: ArgDefinition[];
    returns: ReturnType;
    implementation: string;  // SQL or PL/pgSQL
    volatile?: boolean;
    parallel?: 'safe' | 'restricted' | 'unsafe';
  }
}
```

### 7.2 Custom Attention Mechanisms

```typescript
interface AttentionExtension {
  // Register custom attention
  registerAttention(definition: CustomAttentionDefinition): void;

  interface CustomAttentionDefinition {
    name: string;
    compute: (query: Tensor, key: Tensor, value: Tensor, config: unknown) => Promise<Tensor>;
    validateConfig: (config: unknown) => boolean;
    estimateComplexity: (seqLen: number, dim: number) => ComplexityEstimate;
  }
}
```

### 7.3 Custom GNN Layers

```typescript
interface GNNExtension {
  // Register custom layer
  registerLayer(definition: CustomLayerDefinition): void;

  interface CustomLayerDefinition {
    name: string;
    message: (source: Tensor, target: Tensor, edge?: Tensor) => Tensor;
    aggregate: (messages: Tensor, index: Tensor) => Tensor;
    update: (node: Tensor, aggregated: Tensor) => Tensor;
  }
}
```

### 7.4 Custom Learning Strategies

```typescript
interface LearningExtension {
  // Register custom optimizer
  registerOptimizer(definition: CustomOptimizerDefinition): void;

  // Register custom tuner
  registerTuner(definition: CustomTunerDefinition): void;

  // Register custom pattern detector
  registerPatternDetector(definition: CustomPatternDetectorDefinition): void;
}
```

---

## 8. Performance Considerations

### 8.1 Connection Pooling

| Configuration | Small Workload | Medium Workload | High Workload |
|---------------|----------------|-----------------|---------------|
| min connections | 2 | 5 | 10 |
| max connections | 10 | 25 | 50 |
| idle timeout | 60s | 30s | 15s |
| acquire timeout | 10s | 5s | 3s |

### 8.2 Index Selection Guide

| Data Size | Dimensions | Query Pattern | Recommended Index |
|-----------|------------|---------------|-------------------|
| < 10K | Any | Any | Flat (exact) |
| 10K - 1M | < 256 | High recall | HNSW (m=16, ef=100) |
| 10K - 1M | >= 256 | Balanced | HNSW (m=32, ef=200) |
| > 1M | < 256 | High throughput | IVF (lists=sqrt(n)) |
| > 1M | >= 256 | Balanced | IVF-HNSW hybrid |

### 8.3 Attention Mechanism Selection

| Sequence Length | Memory Constraint | Recommended |
|-----------------|-------------------|-------------|
| < 512 | None | Standard MHA |
| 512 - 2K | Moderate | Flash Attention |
| 2K - 8K | Strict | Sparse (Longformer) |
| > 8K | Strict | Linear (Performer) |

### 8.4 Memory Optimization

```typescript
// Quantization levels and memory savings
const QUANTIZATION_SAVINGS = {
  'float32': { bits: 32, ratio: 1.0 },
  'float16': { bits: 16, ratio: 0.5 },
  'int8':    { bits: 8,  ratio: 0.25 },
  'int4':    { bits: 4,  ratio: 0.125 },
};

// Recommended quantization by use case
const QUANTIZATION_RECOMMENDATIONS = {
  'similarity_search': 'int8',    // 4x memory reduction, <2% recall loss
  'clustering': 'float16',        // 2x memory reduction, minimal loss
  'exact_match': 'float32',       // No quantization
  'approximate_nn': 'int4',       // 8x memory reduction, ~5% recall loss
};
```

---

## 9. Security Considerations

### 9.1 Connection Security

- TLS/SSL required for production connections
- Certificate validation enabled by default
- Connection string credentials never logged
- Secrets retrieved from environment or secret manager

### 9.2 Query Security

- Parameterized queries only (no string interpolation)
- Input validation via Zod schemas
- SQL injection prevention via prepared statements
- Query timeout enforcement

### 9.3 Data Security

- Vector data encrypted at rest (PostgreSQL TDE)
- Network encryption via TLS 1.3
- Access control via PostgreSQL roles
- Audit logging for sensitive operations

---

## 10. Deployment Architecture

### 10.1 Single Node Deployment

```
+------------------------------------------+
|           Application Server             |
|  +------------------------------------+  |
|  |      Claude-Flow MCP Server        |  |
|  |  +------------------------------+  |  |
|  |  |   RuVector Bridge Plugin     |  |  |
|  |  +------------------------------+  |  |
|  +------------------------------------+  |
+------------------------------------------+
                    |
                    | pg protocol
                    v
+------------------------------------------+
|        PostgreSQL + RuVector             |
|        (Single Instance)                 |
+------------------------------------------+
```

### 10.2 High Availability Deployment

```
+------------------------------------------+
|           Load Balancer                  |
+------------------------------------------+
         |              |              |
         v              v              v
+------------+  +------------+  +------------+
|  MCP       |  |  MCP       |  |  MCP       |
|  Server 1  |  |  Server 2  |  |  Server 3  |
+------------+  +------------+  +------------+
         |              |              |
         +-------+------+-------+------+
                 |              |
                 v              v
         +------------+  +------------+
         |  Primary   |  |  Replica   |
         |  PostgreSQL|  |  PostgreSQL|
         |  + RuVector|  |  + RuVector|
         +------------+  +------------+
```

### 10.3 Distributed Deployment

```
+------------------------------------------+
|           Global Load Balancer           |
+------------------------------------------+
         |                      |
         v                      v
+------------------+   +------------------+
|    Region A      |   |    Region B      |
| +-------------+  |   | +-------------+  |
| |  MCP Pool   |  |   | |  MCP Pool   |  |
| +-------------+  |   | +-------------+  |
|       |          |   |       |          |
|       v          |   |       v          |
| +-------------+  |   | +-------------+  |
| |  PG Cluster |  |   | |  PG Cluster |  |
| |  (Citus)    |  |   | |  (Citus)    |  |
| +-------------+  |   | +-------------+  |
+------------------+   +------------------+
```

---

## 11. Testing Strategy

### 11.1 Unit Tests

- SQL function validation
- Attention mechanism correctness
- GNN layer outputs
- Hyperbolic operations accuracy
- Configuration validation

### 11.2 Integration Tests

- Connection pooling behavior
- Query execution correctness
- MCP tool functionality
- Learning engine feedback loop
- Extension installation/upgrade

### 11.3 Performance Tests

- Vector search latency (p50, p95, p99)
- Attention throughput (tokens/second)
- GNN propagation time
- Index build/query tradeoffs
- Connection pool saturation

### 11.4 Chaos Tests

- Connection failure recovery
- PostgreSQL restart handling
- Extension upgrade during operation
- Memory pressure scenarios
- Network partition behavior

---

## 12. Monitoring and Observability

### 12.1 Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `ruvector_query_duration_seconds` | Histogram | Query execution time |
| `ruvector_pool_connections_active` | Gauge | Active connections |
| `ruvector_pool_connections_idle` | Gauge | Idle connections |
| `ruvector_index_size_bytes` | Gauge | Index storage size |
| `ruvector_attention_tokens_processed` | Counter | Tokens processed |
| `ruvector_learning_patterns_detected` | Counter | Patterns detected |

### 12.2 Logging

```typescript
// Structured log format
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  context: {
    queryId?: string;
    duration?: number;
    rowCount?: number;
    error?: string;
  };
}
```

### 12.3 Tracing

- OpenTelemetry integration
- Distributed trace context propagation
- Span attributes for vector operations
- Query plan visualization

---

## 13. Migration Guide

### 13.1 From pgvector

```sql
-- Convert pgvector to ruvector
ALTER TABLE items
  ALTER COLUMN embedding TYPE ruvector
  USING embedding::ruvector;

-- Rebuild indexes
DROP INDEX IF EXISTS items_embedding_idx;
CREATE INDEX items_embedding_idx ON items
  USING ruvector_hnsw (embedding ruvector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
```

### 13.2 From In-Memory VectorDB

```typescript
// Migrate from AgentDB to PostgreSQL
async function migrate(agentDB: AgentDBBridge, pgBridge: RuVectorBridge) {
  const entries = await agentDB.listAll();

  for (const entry of entries) {
    await pgBridge.insert({
      id: entry.id,
      vector: entry.vector,
      metadata: entry.metadata,
    });
  }
}
```

---

## 14. Appendix

### A. Complete SQL Function Reference

See `/docs/sql-functions-reference.md` for the complete 53+ function reference.

### B. Attention Mechanism Benchmarks

See `/docs/attention-benchmarks.md` for performance comparisons.

### C. GNN Layer Specifications

See `/docs/gnn-specifications.md` for detailed layer documentation.

### D. Hyperbolic Geometry Mathematics

See `/docs/hyperbolic-math.md` for mathematical foundations.

### E. Self-Learning Algorithm Details

See `/docs/learning-algorithms.md` for algorithm descriptions.

---

## 15. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-16 | Architecture Team | Initial architecture document |
