/**
 * RuVector PostgreSQL Bridge - Type Definitions
 *
 * Comprehensive TypeScript types for the RuVector PostgreSQL vector database
 * integration, supporting advanced neural search, attention mechanisms,
 * graph pattern networks, and hyperbolic embeddings.
 *
 * @module @claude-flow/plugins/integrations/ruvector
 * @version 1.0.0
 */

// ============================================================================
// Connection Configuration
// ============================================================================

/**
 * SSL configuration options for secure PostgreSQL connections.
 */
export interface SSLConfig {
  /** Enable SSL connection */
  readonly enabled: boolean;
  /** Reject unauthorized certificates */
  readonly rejectUnauthorized?: boolean;
  /** Path to CA certificate file */
  readonly ca?: string;
  /** Path to client certificate file */
  readonly cert?: string;
  /** Path to client key file */
  readonly key?: string;
  /** Server name for SNI */
  readonly servername?: string;
}

/**
 * Connection pool configuration for managing database connections.
 */
export interface PoolConfig {
  /** Minimum number of connections to maintain */
  readonly min: number;
  /** Maximum number of connections allowed */
  readonly max: number;
  /** Time in milliseconds before idle connections are closed */
  readonly idleTimeoutMs?: number;
  /** Time in milliseconds to wait for a connection from the pool */
  readonly acquireTimeoutMs?: number;
  /** Time in milliseconds to wait for connection creation */
  readonly createTimeoutMs?: number;
  /** Number of times to retry failed connections */
  readonly createRetryIntervalMs?: number;
  /** Whether to destroy connections after use */
  readonly destroyTimeoutMs?: number;
  /** Maximum time a connection can be reused (in milliseconds) */
  readonly maxLifetimeMs?: number;
  /** Whether to validate connections on acquire */
  readonly validateOnAcquire?: boolean;
}

/**
 * Retry configuration for handling transient failures.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  readonly maxAttempts: number;
  /** Initial delay between retries in milliseconds */
  readonly initialDelayMs: number;
  /** Maximum delay between retries in milliseconds */
  readonly maxDelayMs: number;
  /** Backoff multiplier for exponential backoff */
  readonly backoffMultiplier: number;
  /** Whether to add jitter to retry delays */
  readonly jitter?: boolean;
  /** Specific error codes that should trigger a retry */
  readonly retryableErrors?: string[];
}

/**
 * Primary configuration for RuVector PostgreSQL connection.
 */
export interface RuVectorConfig {
  /** PostgreSQL host address */
  readonly host: string;
  /** PostgreSQL port (default: 5432) */
  readonly port: number;
  /** Database name */
  readonly database: string;
  /** Database user */
  readonly user: string;
  /** Database password */
  readonly password: string;
  /** SSL configuration */
  readonly ssl?: boolean | SSLConfig;
  /** Connection pool size (shorthand for pool.max) */
  readonly poolSize?: number;
  /** Detailed pool configuration */
  readonly pool?: PoolConfig;
  /** Connection timeout in milliseconds */
  readonly connectionTimeoutMs?: number;
  /** Query timeout in milliseconds */
  readonly queryTimeoutMs?: number;
  /** Statement timeout in milliseconds */
  readonly statementTimeoutMs?: number;
  /** Idle in transaction session timeout */
  readonly idleInTransactionSessionTimeoutMs?: number;
  /** Application name for pg_stat_activity */
  readonly applicationName?: string;
  /** Schema to use (default: 'public') */
  readonly schema?: string;
  /** Retry configuration for transient failures */
  readonly retry?: RetryConfig;
  /** Enable query logging */
  readonly logging?: boolean | LogLevel;
  /** Custom connection string (overrides other options) */
  readonly connectionString?: string;
  /** pgvector extension schema */
  readonly vectorSchema?: string;
  /** Default vector dimensions */
  readonly defaultDimensions?: number;
  /** Enable prepared statements caching */
  readonly preparedStatements?: boolean;
  /** Keep-alive configuration */
  readonly keepAlive?: boolean | KeepAliveConfig;
}

/**
 * Keep-alive configuration for long-lived connections.
 */
export interface KeepAliveConfig {
  /** Enable TCP keep-alive */
  readonly enabled: boolean;
  /** Initial delay before sending keep-alive probes (ms) */
  readonly initialDelayMs?: number;
}

/**
 * Log levels for query logging.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'trace';

// ============================================================================
// Vector Operations
// ============================================================================

/**
 * Distance/similarity metrics for vector operations.
 */
export type DistanceMetric =
  | 'cosine'          // Cosine similarity (1 - cosine distance)
  | 'euclidean'       // L2 distance
  | 'dot'             // Inner product (dot product)
  | 'hamming'         // Hamming distance for binary vectors
  | 'manhattan'       // L1 distance
  | 'chebyshev'       // L-infinity distance
  | 'jaccard'         // Jaccard similarity
  | 'minkowski'       // Generalized Minkowski distance
  | 'bray_curtis'     // Bray-Curtis dissimilarity
  | 'canberra'        // Canberra distance
  | 'mahalanobis'     // Mahalanobis distance
  | 'correlation';    // Correlation distance

/**
 * Index types supported by RuVector/pgvector.
 */
export type VectorIndexType =
  | 'hnsw'            // Hierarchical Navigable Small World
  | 'ivfflat'         // Inverted File with Flat vectors
  | 'ivfpq'           // Inverted File with Product Quantization
  | 'flat'            // Brute force (no index)
  | 'diskann';        // Disk-based ANN

/**
 * Options for vector similarity search operations.
 */
export interface VectorSearchOptions {
  /** Query vector (required) */
  readonly query: number[] | Float32Array;
  /** Number of results to return (k-nearest neighbors) */
  readonly k: number;
  /** Distance metric to use */
  readonly metric: DistanceMetric;
  /** Metadata filters (column name -> value) */
  readonly filter?: Record<string, unknown>;
  /** SQL WHERE clause for additional filtering */
  readonly whereClause?: string;
  /** Parameters for the WHERE clause */
  readonly whereParams?: unknown[];
  /** Minimum similarity threshold (0-1 for cosine, varies for others) */
  readonly threshold?: number;
  /** Maximum distance threshold */
  readonly maxDistance?: number;
  /** Include vector in results */
  readonly includeVector?: boolean;
  /** Include metadata in results */
  readonly includeMetadata?: boolean;
  /** Columns to select from the table */
  readonly selectColumns?: string[];
  /** Table name to search in */
  readonly tableName?: string;
  /** Vector column name (default: 'embedding') */
  readonly vectorColumn?: string;
  /** HNSW ef_search parameter for recall/speed tradeoff */
  readonly efSearch?: number;
  /** IVF probes parameter */
  readonly probes?: number;
  /** Enable query vector normalization */
  readonly normalize?: boolean;
  /** Timeout for this specific query in milliseconds */
  readonly timeoutMs?: number;
  /** Use approximate search (faster but less accurate) */
  readonly approximate?: boolean;
  /** Reranking options for multi-stage retrieval */
  readonly rerank?: RerankOptions;
}

/**
 * Reranking options for multi-stage retrieval.
 */
export interface RerankOptions {
  /** Enable reranking */
  readonly enabled: boolean;
  /** Model to use for reranking */
  readonly model?: string;
  /** Number of candidates to fetch before reranking */
  readonly candidates?: number;
  /** Cross-encoder scoring */
  readonly crossEncoder?: boolean;
}

/**
 * Options for batch vector operations.
 */
export interface BatchVectorOptions {
  /** Batch of query vectors */
  readonly queries: Array<number[] | Float32Array>;
  /** Number of results per query */
  readonly k: number;
  /** Distance metric */
  readonly metric: DistanceMetric;
  /** Shared filter for all queries */
  readonly filter?: Record<string, unknown>;
  /** Process queries in parallel */
  readonly parallel?: boolean;
  /** Maximum concurrent queries */
  readonly concurrency?: number;
  /** Table name */
  readonly tableName?: string;
  /** Vector column name */
  readonly vectorColumn?: string;
}

/**
 * Result from a vector search operation.
 */
export interface VectorSearchResult {
  /** Unique identifier of the result */
  readonly id: string | number;
  /** Similarity/distance score */
  readonly score: number;
  /** Distance value (inverse of similarity for some metrics) */
  readonly distance?: number;
  /** Result vector (if includeVector is true) */
  readonly vector?: number[];
  /** Associated metadata */
  readonly metadata?: Record<string, unknown>;
  /** Rank in the result set (1-indexed) */
  readonly rank?: number;
  /** Retrieval timestamp */
  readonly retrievedAt?: Date;
}

/**
 * Options for inserting vectors.
 */
export interface VectorInsertOptions {
  /** Table name */
  readonly tableName: string;
  /** Vector column name */
  readonly vectorColumn?: string;
  /** Vectors to insert */
  readonly vectors: Array<{
    id?: string | number;
    vector: number[] | Float32Array;
    metadata?: Record<string, unknown>;
  }>;
  /** Upsert mode (update on conflict) */
  readonly upsert?: boolean;
  /** Conflict column(s) for upsert */
  readonly conflictColumns?: string[];
  /** Skip invalid vectors instead of failing */
  readonly skipInvalid?: boolean;
  /** Batch size for bulk inserts */
  readonly batchSize?: number;
  /** Return inserted IDs */
  readonly returning?: boolean;
}

/**
 * Options for updating vectors.
 */
export interface VectorUpdateOptions {
  /** Table name */
  readonly tableName: string;
  /** Vector column name */
  readonly vectorColumn?: string;
  /** ID of the vector to update */
  readonly id: string | number;
  /** New vector value */
  readonly vector?: number[] | Float32Array;
  /** Updated metadata */
  readonly metadata?: Record<string, unknown>;
  /** Partial metadata update (merge with existing) */
  readonly mergeMetadata?: boolean;
}

/**
 * Options for creating a vector index.
 */
export interface VectorIndexOptions {
  /** Table name */
  readonly tableName: string;
  /** Column name */
  readonly columnName: string;
  /** Index type */
  readonly indexType: VectorIndexType;
  /** Index name (auto-generated if not provided) */
  readonly indexName?: string;
  /** Distance metric for the index */
  readonly metric?: DistanceMetric;
  /** HNSW M parameter (max connections per layer) */
  readonly m?: number;
  /** HNSW ef_construction parameter */
  readonly efConstruction?: number;
  /** IVF lists parameter */
  readonly lists?: number;
  /** Create index concurrently (non-blocking) */
  readonly concurrent?: boolean;
  /** Replace existing index if it exists */
  readonly replace?: boolean;
}

// ============================================================================
// Attention Mechanisms (39 Types)
// ============================================================================

/**
 * All 39 attention mechanism types supported by RuVector.
 *
 * These mechanisms enable sophisticated neural search and pattern matching
 * directly within PostgreSQL using RuVector's attention functions.
 */
export type AttentionMechanism =
  // Core Attention Types
  | 'multi_head'              // Multi-Head Attention (Transformer)
  | 'self_attention'          // Self-Attention
  | 'cross_attention'         // Cross-Attention between two sequences
  | 'sparse_attention'        // Sparse Attention (BigBird, Longformer)
  | 'linear_attention'        // Linear Attention (O(n) complexity)
  | 'local_attention'         // Local/Sliding Window Attention
  | 'global_attention'        // Global Attention tokens

  // Efficient Attention Variants
  | 'flash_attention'         // Flash Attention (memory-efficient)
  | 'flash_attention_v2'      // Flash Attention V2 (improved)
  | 'memory_efficient'        // Memory-Efficient Attention
  | 'chunk_attention'         // Chunked Attention processing
  | 'sliding_window'          // Sliding Window Attention
  | 'dilated_attention'       // Dilated/Strided Attention
  | 'block_sparse'            // Block-Sparse Attention

  // Advanced Attention Patterns
  | 'relative_position'       // Relative Position Attention (T5, XLNet)
  | 'rotary_position'         // Rotary Position Embedding (RoPE)
  | 'alibi'                   // Attention with Linear Biases
  | 'causal'                  // Causal/Masked Attention (GPT-style)
  | 'bidirectional'           // Bidirectional Attention (BERT-style)
  | 'axial'                   // Axial Attention (2D decomposition)

  // Specialized Attention Types
  | 'performer'               // FAVOR+ (Performers)
  | 'linformer'               // Linformer (low-rank projection)
  | 'reformer'                // LSH Attention (Reformer)
  | 'synthesizer'             // Synthesizer (learned patterns)
  | 'routing'                 // Routing Attention (mixture of experts)
  | 'mixture_of_experts'      // MoE Attention

  // Graph and Structured Attention
  | 'graph_attention'         // Graph Attention (GAT)
  | 'hyperbolic_attention'    // Hyperbolic Attention (hierarchies)
  | 'spherical_attention'     // Spherical Attention
  | 'toroidal_attention'      // Toroidal Attention (periodic)

  // Temporal and Sequential
  | 'temporal_attention'      // Time-aware Attention
  | 'recurrent_attention'     // Recurrent Attention (LSTM-style)
  | 'state_space'             // State Space Model Attention (S4, Mamba)

  // Multi-Modal Attention
  | 'cross_modal'             // Cross-Modal Attention
  | 'perceiver'               // Perceiver IO Attention
  | 'flamingo'                // Flamingo-style Attention

  // Retrieval-Augmented
  | 'retrieval_attention'     // Retrieval-Augmented Attention
  | 'knn_attention'           // k-NN Augmented Attention
  | 'memory_augmented';       // External Memory Attention

/**
 * Configuration for attention mechanism operations.
 */
export interface AttentionConfig {
  /** Attention mechanism type */
  readonly mechanism: AttentionMechanism;
  /** Number of attention heads */
  readonly numHeads: number;
  /** Dimension of each attention head */
  readonly headDim: number;
  /** Total embedding dimension (numHeads * headDim) */
  readonly embedDim?: number;
  /** Dropout rate for attention weights */
  readonly dropout?: number;
  /** Whether to use bias in projections */
  readonly useBias?: boolean;
  /** Scale factor for attention scores */
  readonly scale?: number;
  /** Causal masking for autoregressive attention */
  readonly causal?: boolean;
  /** Maximum sequence length */
  readonly maxSeqLen?: number;
  /** Mechanism-specific parameters */
  readonly params?: AttentionParams;
}

/**
 * Mechanism-specific attention parameters.
 */
export interface AttentionParams {
  // Sparse Attention
  /** Block size for sparse attention */
  readonly blockSize?: number;
  /** Number of global tokens */
  readonly numGlobalTokens?: number;
  /** Number of random attention tokens */
  readonly numRandomTokens?: number;

  // Sliding Window
  /** Window size for local attention */
  readonly windowSize?: number;
  /** Dilation rate for dilated attention */
  readonly dilationRate?: number;

  // Relative Position
  /** Maximum relative distance */
  readonly maxRelativePosition?: number;
  /** Number of buckets for relative positions */
  readonly numBuckets?: number;

  // RoPE
  /** Base frequency for rotary embeddings */
  readonly ropeBase?: number;
  /** Whether to apply RoPE to keys as well */
  readonly ropeKeys?: boolean;

  // Linear Attention
  /** Feature map type for linear attention */
  readonly featureMap?: 'elu' | 'relu' | 'softmax' | 'exp' | 'fourier';
  /** Number of random features for approximation */
  readonly numFeatures?: number;

  // Flash Attention
  /** Block size for flash attention tiles */
  readonly flashBlockSize?: number;
  /** Enable memory-efficient backward pass */
  readonly checkpointing?: boolean;

  // Graph Attention
  /** Number of graph attention layers */
  readonly numLayers?: number;
  /** Edge feature dimension */
  readonly edgeDim?: number;
  /** Aggregation method */
  readonly aggregation?: 'mean' | 'sum' | 'max' | 'attention';

  // Hyperbolic
  /** Curvature parameter for hyperbolic space */
  readonly curvature?: number;

  // MoE
  /** Number of experts */
  readonly numExperts?: number;
  /** Top-k experts to route to */
  readonly topK?: number;
  /** Load balancing loss coefficient */
  readonly loadBalanceLoss?: number;
}

/**
 * Input for attention computation.
 */
export interface AttentionInput {
  /** Query vectors [batch, seq_len, dim] */
  readonly query: number[][] | Float32Array[];
  /** Key vectors [batch, seq_len, dim] */
  readonly key: number[][] | Float32Array[];
  /** Value vectors [batch, seq_len, dim] */
  readonly value: number[][] | Float32Array[];
  /** Attention mask [batch, seq_len] or [batch, 1, seq_len, seq_len] */
  readonly mask?: boolean[][] | number[][];
  /** Position IDs for positional encoding */
  readonly positionIds?: number[];
  /** Key-value cache for incremental decoding */
  readonly kvCache?: KVCache;
}

/**
 * Key-value cache for efficient incremental attention.
 */
export interface KVCache {
  /** Cached key vectors */
  readonly keys: number[][];
  /** Cached value vectors */
  readonly values: number[][];
  /** Current sequence position */
  readonly seqPos: number;
  /** Maximum cache size */
  readonly maxSize?: number;
}

/**
 * Output from attention computation.
 */
export interface AttentionOutput {
  /** Output vectors [batch, seq_len, dim] */
  readonly output: number[][];
  /** Attention weights [batch, num_heads, seq_len, seq_len] */
  readonly attentionWeights?: number[][][][];
  /** Updated KV cache */
  readonly kvCache?: KVCache;
  /** Computation statistics */
  readonly stats?: AttentionStats;
}

/**
 * Statistics from attention computation.
 */
export interface AttentionStats {
  /** Computation time in milliseconds */
  readonly computeTimeMs: number;
  /** Memory usage in bytes */
  readonly memoryBytes: number;
  /** FLOPs performed */
  readonly flops?: number;
  /** Sparsity ratio (for sparse attention) */
  readonly sparsity?: number;
  /** Number of tokens processed */
  readonly tokensProcessed: number;
}

// ============================================================================
// Graph Neural Network (GNN) Layers
// ============================================================================

/**
 * GNN layer types supported by RuVector.
 */
export type GNNLayerType =
  | 'gcn'           // Graph Convolutional Network
  | 'gat'           // Graph Attention Network
  | 'gat_v2'        // GAT v2 (improved attention)
  | 'sage'          // GraphSAGE (sampling and aggregation)
  | 'gin'           // Graph Isomorphism Network
  | 'mpnn'          // Message Passing Neural Network
  | 'edge_conv'     // EdgeConv (dynamic graph)
  | 'point_conv'    // PointConv (point cloud)
  | 'transformer'   // Graph Transformer
  | 'pna'           // Principal Neighbourhood Aggregation
  | 'film'          // Feature-wise Linear Modulation
  | 'rgcn'          // Relational GCN
  | 'hgt'           // Heterogeneous Graph Transformer
  | 'han'           // Heterogeneous Attention Network
  | 'metapath';     // MetaPath-based aggregation

/**
 * Aggregation methods for GNN message passing.
 */
export type GNNAggregation =
  | 'mean'
  | 'sum'
  | 'max'
  | 'min'
  | 'attention'
  | 'lstm'
  | 'softmax'
  | 'power_mean'
  | 'std'
  | 'var';

/**
 * Configuration for a GNN layer.
 */
export interface GNNLayer {
  /** Layer type */
  readonly type: GNNLayerType;
  /** Input feature dimension */
  readonly inputDim: number;
  /** Output feature dimension */
  readonly outputDim: number;
  /** Hidden dimension (for multi-layer projections) */
  readonly hiddenDim?: number;
  /** Number of attention heads (for attention-based layers) */
  readonly numHeads?: number;
  /** Dropout rate */
  readonly dropout?: number;
  /** Aggregation method */
  readonly aggregation?: GNNAggregation;
  /** Whether to add self-loops */
  readonly addSelfLoops?: boolean;
  /** Whether to normalize by degree */
  readonly normalize?: boolean;
  /** Whether to use bias */
  readonly useBias?: boolean;
  /** Activation function */
  readonly activation?: ActivationFunction;
  /** Layer-specific parameters */
  readonly params?: GNNLayerParams;
}

/**
 * Activation functions for GNN layers.
 */
export type ActivationFunction =
  | 'relu'
  | 'gelu'
  | 'silu'
  | 'swish'
  | 'leaky_relu'
  | 'elu'
  | 'selu'
  | 'tanh'
  | 'sigmoid'
  | 'softmax'
  | 'none';

/**
 * Layer-specific GNN parameters.
 */
export interface GNNLayerParams {
  // GAT parameters
  /** Negative slope for LeakyReLU in GAT */
  readonly negativeSlope?: number;
  /** Concatenate or average heads */
  readonly concat?: boolean;
  /** Edge attention dimension */
  readonly edgeAttnDim?: number;

  // GraphSAGE parameters
  /** Neighborhood sampling size */
  readonly sampleSize?: number;
  /** Sampling strategy */
  readonly samplingStrategy?: 'uniform' | 'importance' | 'layer';

  // GIN parameters
  /** Epsilon for GIN update */
  readonly eps?: number;
  /** Whether epsilon is learnable */
  readonly trainEps?: boolean;

  // EdgeConv parameters
  /** k for k-NN graph construction */
  readonly k?: number;
  /** Dynamic graph update */
  readonly dynamic?: boolean;

  // PNA parameters
  /** Scalers for PNA */
  readonly scalers?: ('identity' | 'amplification' | 'attenuation')[];
  /** Aggregators for PNA */
  readonly aggregators?: GNNAggregation[];

  // RGCN parameters
  /** Number of relation types */
  readonly numRelations?: number;
  /** Basis decomposition dimension */
  readonly numBases?: number;

  // HGT/HAN parameters
  /** Node types */
  readonly nodeTypes?: string[];
  /** Edge types */
  readonly edgeTypes?: string[];
  /** Metapaths for aggregation */
  readonly metapaths?: string[][];

  // Multi-layer/Transformer parameters
  /** Number of layers for multi-layer GNN */
  readonly numLayers?: number;
}

/**
 * Graph data structure for GNN operations.
 */
export interface GraphData {
  /** Node features [num_nodes, feature_dim] */
  readonly nodeFeatures: number[][];
  /** Edge index [2, num_edges] (source, target) */
  readonly edgeIndex: [number[], number[]];
  /** Edge features [num_edges, edge_feature_dim] (optional) */
  readonly edgeFeatures?: number[][];
  /** Edge weights [num_edges] (optional) */
  readonly edgeWeights?: number[];
  /** Node labels (for supervised learning) */
  readonly nodeLabels?: number[];
  /** Graph labels (for graph classification) */
  readonly graphLabels?: number[];
  /** Batch index for mini-batching */
  readonly batch?: number[];
  /** Node type indices (for heterogeneous graphs) */
  readonly nodeTypes?: number[];
  /** Edge type indices (for heterogeneous graphs) */
  readonly edgeTypes?: number[];
}

/**
 * Output from GNN forward pass.
 */
export interface GNNOutput {
  /** Node embeddings [num_nodes, output_dim] */
  readonly nodeEmbeddings: number[][];
  /** Graph embedding (pooled) [batch_size, output_dim] */
  readonly graphEmbedding?: number[];
  /** Attention weights (for attention-based layers) */
  readonly attentionWeights?: number[][];
  /** Edge predictions (for link prediction) */
  readonly edgePredictions?: number[];
  /** Computation statistics */
  readonly stats?: GNNStats;
}

/**
 * Statistics from GNN computation.
 */
export interface GNNStats {
  /** Forward pass time in milliseconds */
  readonly forwardTimeMs: number;
  /** Number of nodes processed */
  readonly numNodes: number;
  /** Number of edges processed */
  readonly numEdges: number;
  /** Memory usage in bytes */
  readonly memoryBytes: number;
  /** Number of message passing iterations */
  readonly numIterations: number;
}

// ============================================================================
// Hyperbolic Embeddings
// ============================================================================

/**
 * Hyperbolic space models supported by RuVector.
 */
export type HyperbolicModel =
  | 'poincare'      // Poincare ball model
  | 'lorentz'       // Lorentz/Hyperboloid model
  | 'klein'         // Klein disk model
  | 'half_space';   // Upper half-space model

/**
 * Configuration for hyperbolic embeddings.
 */
export interface HyperbolicEmbedding {
  /** Hyperbolic space model */
  readonly model: HyperbolicModel;
  /** Curvature parameter (negative for hyperbolic space) */
  readonly curvature: number;
  /** Embedding dimension */
  readonly dimension: number;
  /** Whether curvature is learnable */
  readonly learnCurvature?: boolean;
  /** Manifold-specific parameters */
  readonly params?: HyperbolicParams;
}

/**
 * Hyperbolic space parameters.
 */
export interface HyperbolicParams {
  // Poincare Ball
  /** Maximum norm for Poincare ball (< 1) */
  readonly maxNorm?: number;
  /** Epsilon for numerical stability */
  readonly eps?: number;

  // Lorentz
  /** Time dimension index */
  readonly timeDim?: number;

  // Optimization
  /** Riemannian optimizer type */
  readonly optimizer?: 'rsgd' | 'radam' | 'ramsgrad';
  /** Learning rate for hyperbolic parameters */
  readonly learningRate?: number;
  /** Burnin period for initialization */
  readonly burninPeriod?: number;
}

/**
 * Hyperbolic distance functions.
 */
export type HyperbolicDistance =
  | 'poincare_distance'      // Geodesic distance in Poincare ball
  | 'lorentz_distance'       // Geodesic distance in Lorentz model
  | 'poincare_2_lorentz'     // Map Poincare to Lorentz
  | 'lorentz_2_poincare'     // Map Lorentz to Poincare
  | 'hyperbolic_midpoint'    // Geodesic midpoint
  | 'hyperbolic_centroid';   // Frechet mean on manifold

/**
 * Input for hyperbolic operations.
 */
export interface HyperbolicInput {
  /** Points in hyperbolic space */
  readonly points: number[][];
  /** Target points (for distance computation) */
  readonly targets?: number[][];
  /** Tangent vectors (for parallel transport) */
  readonly tangentVectors?: number[][];
  /** Base point for tangent space operations */
  readonly basePoint?: number[];
}

/**
 * Output from hyperbolic operations.
 */
export interface HyperbolicOutput {
  /** Computed embeddings/transformed points */
  readonly embeddings: number[][];
  /** Distances (if computed) */
  readonly distances?: number[];
  /** Geodesic paths (if requested) */
  readonly geodesics?: number[][][];
  /** Curvature values (if learned) */
  readonly curvature?: number;
}

/**
 * Operations available for hyperbolic embeddings.
 */
export type HyperbolicOperation =
  | 'embed'                  // Project Euclidean to hyperbolic
  | 'project'                // Project back to Euclidean
  | 'distance'               // Compute geodesic distance
  | 'midpoint'               // Compute geodesic midpoint
  | 'centroid'               // Compute Frechet mean
  | 'parallel_transport'     // Transport vectors along geodesic
  | 'log_map'                // Logarithmic map to tangent space
  | 'exp_map'                // Exponential map from tangent space
  | 'mobius_add'             // Mobius addition
  | 'mobius_matvec'          // Mobius matrix-vector multiplication
  | 'gyration';              // Gyration operation

// ============================================================================
// SQL Function Types (53+ Functions)
// ============================================================================

/**
 * RuVector SQL function categories.
 */
export type RuVectorFunctionCategory =
  | 'vector'           // Vector operations
  | 'index'            // Index management
  | 'attention'        // Attention mechanisms
  | 'gnn'              // Graph pattern networks
  | 'hyperbolic'       // Hyperbolic geometry
  | 'embedding'        // Embedding operations
  | 'distance'         // Distance/similarity functions
  | 'aggregation'      // Vector aggregation
  | 'normalization'    // Normalization functions
  | 'quantization'     // Vector quantization
  | 'utility'          // Utility functions
  | 'admin';           // Administrative functions

/**
 * Vector operation SQL functions.
 */
export interface VectorFunctions {
  // Core Vector Operations
  'ruvector.vector_add': VectorBinaryOp;
  'ruvector.vector_sub': VectorBinaryOp;
  'ruvector.vector_mul': VectorScalarOp;
  'ruvector.vector_div': VectorScalarOp;
  'ruvector.vector_neg': VectorUnaryOp;
  'ruvector.vector_dot': VectorBinaryScalarOp;
  'ruvector.vector_cross': VectorBinaryOp;
  'ruvector.vector_norm': VectorNormOp;
  'ruvector.vector_normalize': VectorUnaryOp;
  'ruvector.vector_scale': VectorScalarOp;
  'ruvector.vector_lerp': VectorLerpOp;
  'ruvector.vector_slerp': VectorSlerpOp;

  // Distance Functions
  'ruvector.cosine_distance': DistanceFunction;
  'ruvector.cosine_similarity': DistanceFunction;
  'ruvector.euclidean_distance': DistanceFunction;
  'ruvector.l2_distance': DistanceFunction;
  'ruvector.manhattan_distance': DistanceFunction;
  'ruvector.l1_distance': DistanceFunction;
  'ruvector.hamming_distance': DistanceFunction;
  'ruvector.jaccard_distance': DistanceFunction;
  'ruvector.inner_product': DistanceFunction;
  'ruvector.dot_product': DistanceFunction;

  // Aggregation Functions
  'ruvector.vector_avg': VectorAggregateOp;
  'ruvector.vector_sum': VectorAggregateOp;
  'ruvector.vector_min': VectorAggregateOp;
  'ruvector.vector_max': VectorAggregateOp;
  'ruvector.vector_centroid': VectorAggregateOp;
  'ruvector.vector_median': VectorAggregateOp;
}

/**
 * Index management SQL functions.
 */
export interface IndexFunctions {
  'ruvector.create_hnsw_index': CreateIndexOp;
  'ruvector.create_ivfflat_index': CreateIndexOp;
  'ruvector.drop_index': DropIndexOp;
  'ruvector.reindex': ReindexOp;
  'ruvector.index_stats': IndexStatsOp;
  'ruvector.set_ef_search': SetParamOp;
  'ruvector.set_probes': SetParamOp;
}

/**
 * Attention SQL functions.
 */
export interface AttentionFunctions {
  'ruvector.multi_head_attention': AttentionOp;
  'ruvector.self_attention': AttentionOp;
  'ruvector.cross_attention': CrossAttentionOp;
  'ruvector.flash_attention': FlashAttentionOp;
  'ruvector.linear_attention': LinearAttentionOp;
  'ruvector.sparse_attention': SparseAttentionOp;
  'ruvector.compute_attention_weights': AttentionWeightsOp;
}

/**
 * GNN SQL functions.
 */
export interface GNNFunctions {
  'ruvector.gcn_layer': GNNLayerOp;
  'ruvector.gat_layer': GNNLayerOp;
  'ruvector.sage_layer': GNNLayerOp;
  'ruvector.message_passing': MessagePassingOp;
  'ruvector.aggregate_neighbors': AggregateOp;
  'ruvector.graph_pooling': PoolingOp;
}

/**
 * Hyperbolic SQL functions.
 */
export interface HyperbolicFunctions {
  'ruvector.poincare_distance': HyperbolicDistanceOp;
  'ruvector.lorentz_distance': HyperbolicDistanceOp;
  'ruvector.exp_map': ExpMapOp;
  'ruvector.log_map': LogMapOp;
  'ruvector.mobius_add': MobiusOp;
  'ruvector.parallel_transport': TransportOp;
  'ruvector.hyperbolic_centroid': HyperbolicCentroidOp;
}

/**
 * Embedding SQL functions.
 */
export interface EmbeddingFunctions {
  'ruvector.embed_text': EmbedTextOp;
  'ruvector.embed_batch': EmbedBatchOp;
  'ruvector.embed_image': EmbedImageOp;
  'ruvector.embed_chunk': EmbedChunkOp;
}

/**
 * Quantization SQL functions.
 */
export interface QuantizationFunctions {
  'ruvector.quantize_scalar': QuantizeOp;
  'ruvector.quantize_product': ProductQuantizeOp;
  'ruvector.dequantize': DequantizeOp;
  'ruvector.binary_quantize': BinaryQuantizeOp;
}

/**
 * Utility SQL functions.
 */
export interface UtilityFunctions {
  'ruvector.version': VersionOp;
  'ruvector.config': ConfigOp;
  'ruvector.stats': StatsOp;
  'ruvector.health_check': HealthCheckOp;
  'ruvector.vacuum_vectors': VacuumOp;
  'ruvector.analyze_vectors': AnalyzeOp;
}

// SQL Function Operation Types
type VectorBinaryOp = (a: number[], b: number[]) => number[];
type VectorUnaryOp = (v: number[]) => number[];
type VectorScalarOp = (v: number[], s: number) => number[];
type VectorBinaryScalarOp = (a: number[], b: number[]) => number;
type VectorNormOp = (v: number[], p?: number) => number;
type VectorLerpOp = (a: number[], b: number[], t: number) => number[];
type VectorSlerpOp = (a: number[], b: number[], t: number) => number[];
type VectorAggregateOp = (vectors: number[][]) => number[];
type DistanceFunction = (a: number[], b: number[]) => number;
type CreateIndexOp = (table: string, column: string, options?: VectorIndexOptions) => void;
type DropIndexOp = (indexName: string) => void;
type ReindexOp = (indexName: string) => void;
type IndexStatsOp = (indexName: string) => IndexStats;
type SetParamOp = (value: number) => void;
type AttentionOp = (input: AttentionInput, config: AttentionConfig) => AttentionOutput;
type CrossAttentionOp = (query: number[][], kv: number[][], config: AttentionConfig) => AttentionOutput;
type FlashAttentionOp = (input: AttentionInput, blockSize?: number) => AttentionOutput;
type LinearAttentionOp = (input: AttentionInput, featureMap: string) => AttentionOutput;
type SparseAttentionOp = (input: AttentionInput, pattern: string) => AttentionOutput;
type AttentionWeightsOp = (query: number[][], key: number[][]) => number[][];
type GNNLayerOp = (graph: GraphData, layer: GNNLayer) => GNNOutput;
type MessagePassingOp = (graph: GraphData, aggregation: GNNAggregation) => number[][];
type AggregateOp = (nodeFeatures: number[][], edgeIndex: [number[], number[]], agg: GNNAggregation) => number[][];
type PoolingOp = (nodeFeatures: number[][], batch: number[], method: string) => number[][];
type HyperbolicDistanceOp = (a: number[], b: number[], curvature: number) => number;
type ExpMapOp = (point: number[], tangent: number[], curvature: number) => number[];
type LogMapOp = (point: number[], target: number[], curvature: number) => number[];
type MobiusOp = (a: number[], b: number[], curvature: number) => number[];
type TransportOp = (vector: number[], start: number[], end: number[], curvature: number) => number[];
type HyperbolicCentroidOp = (points: number[][], curvature: number) => number[];
type EmbedTextOp = (text: string, model?: string) => number[];
type EmbedBatchOp = (texts: string[], model?: string) => number[][];
type EmbedImageOp = (imageData: Uint8Array, model?: string) => number[];
type EmbedChunkOp = (text: string, chunkSize: number, overlap: number) => number[][];
type QuantizeOp = (vector: number[], bits: number) => Uint8Array;
type ProductQuantizeOp = (vector: number[], numSubvectors: number, bits: number) => Uint8Array;
type DequantizeOp = (quantized: Uint8Array, originalDim: number) => number[];
type BinaryQuantizeOp = (vector: number[]) => Uint8Array;
type VersionOp = () => string;
type ConfigOp = () => Record<string, unknown>;
type StatsOp = () => RuVectorStats;
type HealthCheckOp = () => HealthStatus;
type VacuumOp = (tableName?: string) => void;
type AnalyzeOp = (tableName?: string) => AnalysisResult;

/**
 * Index statistics.
 */
export interface IndexStats {
  /** Index name */
  readonly indexName: string;
  /** Index type */
  readonly indexType: VectorIndexType;
  /** Number of vectors indexed */
  readonly numVectors: number;
  /** Index size in bytes */
  readonly sizeBytes: number;
  /** Build time in milliseconds */
  readonly buildTimeMs: number;
  /** Last rebuild timestamp */
  readonly lastRebuild: Date;
  /** Index-specific stats */
  readonly params: Record<string, unknown>;
}

/**
 * RuVector statistics.
 */
export interface RuVectorStats {
  /** Version string */
  readonly version: string;
  /** Total vectors stored */
  readonly totalVectors: number;
  /** Total storage size in bytes */
  readonly totalSizeBytes: number;
  /** Number of indices */
  readonly numIndices: number;
  /** Number of tables with vectors */
  readonly numTables: number;
  /** Query statistics */
  readonly queryStats: QueryStats;
  /** Memory statistics */
  readonly memoryStats: MemoryStats;
}

/**
 * Query statistics.
 */
export interface QueryStats {
  /** Total queries executed */
  readonly totalQueries: number;
  /** Average query time in milliseconds */
  readonly avgQueryTimeMs: number;
  /** 95th percentile query time */
  readonly p95QueryTimeMs: number;
  /** 99th percentile query time */
  readonly p99QueryTimeMs: number;
  /** Cache hit rate */
  readonly cacheHitRate: number;
}

/**
 * Memory statistics.
 */
export interface MemoryStats {
  /** Total memory used in bytes */
  readonly usedBytes: number;
  /** Peak memory usage in bytes */
  readonly peakBytes: number;
  /** Index memory in bytes */
  readonly indexBytes: number;
  /** Cache memory in bytes */
  readonly cacheBytes: number;
}

/**
 * Health status.
 */
export interface HealthStatus {
  /** Overall health status */
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  /** Component statuses */
  readonly components: Record<string, ComponentHealth>;
  /** Last check timestamp */
  readonly lastCheck: Date;
  /** Issues found */
  readonly issues: string[];
}

/**
 * Component health.
 */
export interface ComponentHealth {
  /** Component name */
  readonly name: string;
  /** Health status */
  readonly healthy: boolean;
  /** Latency in milliseconds */
  readonly latencyMs?: number;
  /** Error message if unhealthy */
  readonly error?: string;
}

/**
 * Analysis result from ANALYZE operation.
 */
export interface AnalysisResult {
  /** Table analyzed */
  readonly tableName: string;
  /** Number of rows */
  readonly numRows: number;
  /** Column statistics */
  readonly columnStats: ColumnStats[];
  /** Recommendations */
  readonly recommendations: string[];
}

/**
 * Column statistics.
 */
export interface ColumnStats {
  /** Column name */
  readonly columnName: string;
  /** Data type */
  readonly dataType: string;
  /** Null percentage */
  readonly nullPercent: number;
  /** Distinct values */
  readonly distinctCount: number;
  /** Average value size in bytes */
  readonly avgSizeBytes: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * RuVector event types.
 */
export type RuVectorEventType =
  // Connection Events
  | 'connection:open'
  | 'connection:close'
  | 'connection:error'
  | 'connection:reconnect'
  | 'connection:pool_acquired'
  | 'connection:pool_released'

  // Query Events
  | 'query:start'
  | 'query:complete'
  | 'query:error'
  | 'query:slow'

  // Index Events
  | 'index:created'
  | 'index:dropped'
  | 'index:rebuilt'
  | 'index:progress'

  // Vector Events
  | 'vector:inserted'
  | 'vector:updated'
  | 'vector:deleted'
  | 'vector:batch_complete'

  // Search Events
  | 'search:start'
  | 'search:complete'
  | 'search:cache_hit'
  | 'search:cache_miss'

  // Attention Events
  | 'attention:computed'
  | 'attention:cached'

  // GNN Events
  | 'gnn:forward'
  | 'gnn:message_passing'

  // Hyperbolic Events
  | 'hyperbolic:embed'
  | 'hyperbolic:distance'

  // Admin Events
  | 'admin:vacuum'
  | 'admin:analyze'
  | 'admin:checkpoint';

/**
 * Base event interface.
 */
export interface RuVectorEvent<T extends RuVectorEventType = RuVectorEventType> {
  /** Event type */
  readonly type: T;
  /** Timestamp */
  readonly timestamp: Date;
  /** Event data */
  readonly data: EventDataMap[T];
  /** Source of the event */
  readonly source?: string;
  /** Correlation ID for tracing */
  readonly correlationId?: string;
}

/**
 * Event data type mapping.
 */
export interface EventDataMap {
  'connection:open': ConnectionEventData;
  'connection:close': ConnectionEventData;
  'connection:error': ErrorEventData;
  'connection:reconnect': ConnectionEventData;
  'connection:pool_acquired': PoolEventData;
  'connection:pool_released': PoolEventData;

  'query:start': QueryStartEventData;
  'query:complete': QueryCompleteEventData;
  'query:error': QueryErrorEventData;
  'query:slow': QuerySlowEventData;

  'index:created': IndexEventData;
  'index:dropped': IndexEventData;
  'index:rebuilt': IndexEventData;
  'index:progress': IndexProgressEventData;

  'vector:inserted': VectorEventData;
  'vector:updated': VectorEventData;
  'vector:deleted': VectorEventData;
  'vector:batch_complete': BatchEventData;

  'search:start': SearchStartEventData;
  'search:complete': SearchCompleteEventData;
  'search:cache_hit': CacheEventData;
  'search:cache_miss': CacheEventData;

  'attention:computed': AttentionEventData;
  'attention:cached': CacheEventData;

  'gnn:forward': GNNEventData;
  'gnn:message_passing': GNNEventData;

  'hyperbolic:embed': HyperbolicEventData;
  'hyperbolic:distance': HyperbolicEventData;

  'admin:vacuum': AdminEventData;
  'admin:analyze': AdminEventData;
  'admin:checkpoint': AdminEventData;
}

/**
 * Connection event data.
 */
export interface ConnectionEventData {
  readonly connectionId: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly durationMs?: number;
}

/**
 * Error event data.
 */
export interface ErrorEventData {
  readonly error: Error;
  readonly code?: string;
  readonly detail?: string;
  readonly hint?: string;
}

/**
 * Pool event data.
 */
export interface PoolEventData {
  readonly connectionId: string;
  readonly poolSize: number;
  readonly availableConnections: number;
  readonly waitingClients: number;
}

/**
 * Query start event data.
 */
export interface QueryStartEventData {
  readonly queryId: string;
  readonly sql: string;
  readonly params?: unknown[];
}

/**
 * Query complete event data.
 */
export interface QueryCompleteEventData {
  readonly queryId: string;
  readonly durationMs: number;
  readonly rowCount: number;
  readonly affectedRows?: number;
}

/**
 * Query error event data.
 */
export interface QueryErrorEventData extends QueryStartEventData, ErrorEventData {
  readonly durationMs: number;
}

/**
 * Query slow event data.
 */
export interface QuerySlowEventData extends QueryCompleteEventData {
  readonly threshold: number;
  readonly explain?: string;
}

/**
 * Index event data.
 */
export interface IndexEventData {
  readonly indexName: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly indexType: VectorIndexType;
  readonly durationMs?: number;
}

/**
 * Index progress event data.
 */
export interface IndexProgressEventData {
  readonly indexName: string;
  readonly progress: number;
  readonly phase: string;
  readonly vectorsProcessed: number;
  readonly totalVectors: number;
  readonly estimatedTimeRemainingMs: number;
}

/**
 * Vector event data.
 */
export interface VectorEventData {
  readonly tableName: string;
  readonly vectorId: string | number;
  readonly dimensions: number;
}

/**
 * Batch event data.
 */
export interface BatchEventData {
  readonly tableName: string;
  readonly count: number;
  readonly durationMs: number;
  readonly successCount: number;
  readonly failedCount: number;
}

/**
 * Search start event data.
 */
export interface SearchStartEventData {
  readonly searchId: string;
  readonly tableName: string;
  readonly k: number;
  readonly metric: DistanceMetric;
  readonly hasFilters: boolean;
}

/**
 * Search complete event data.
 */
export interface SearchCompleteEventData {
  readonly searchId: string;
  readonly durationMs: number;
  readonly resultCount: number;
  readonly scannedCount: number;
  readonly cacheHit: boolean;
}

/**
 * Cache event data.
 */
export interface CacheEventData {
  readonly cacheKey: string;
  readonly cacheSize: number;
  readonly ttl?: number;
}

/**
 * Attention event data.
 */
export interface AttentionEventData {
  readonly mechanism: AttentionMechanism;
  readonly seqLen: number;
  readonly numHeads: number;
  readonly durationMs: number;
  readonly memoryBytes: number;
}

/**
 * GNN event data.
 */
export interface GNNEventData {
  readonly layerType: GNNLayerType;
  readonly numNodes: number;
  readonly numEdges: number;
  readonly durationMs: number;
}

/**
 * Hyperbolic event data.
 */
export interface HyperbolicEventData {
  readonly model: HyperbolicModel;
  readonly operation: HyperbolicOperation;
  readonly numPoints: number;
  readonly durationMs: number;
}

/**
 * Admin event data.
 */
export interface AdminEventData {
  readonly operation: string;
  readonly tableName?: string;
  readonly durationMs: number;
  readonly details?: Record<string, unknown>;
}

/**
 * Event handler type.
 */
export type RuVectorEventHandler<T extends RuVectorEventType = RuVectorEventType> =
  (event: RuVectorEvent<T>) => void | Promise<void>;

/**
 * Event emitter interface.
 */
export interface RuVectorEventEmitter {
  on<T extends RuVectorEventType>(event: T, handler: RuVectorEventHandler<T>): () => void;
  off<T extends RuVectorEventType>(event: T, handler: RuVectorEventHandler<T>): void;
  once<T extends RuVectorEventType>(event: T, handler: RuVectorEventHandler<T>): () => void;
  emit<T extends RuVectorEventType>(event: T, data: EventDataMap[T]): void;
  removeAllListeners(event?: RuVectorEventType): void;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Generic result wrapper with success/error discrimination.
 */
export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

/**
 * Async result type alias.
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/**
 * Connection result.
 */
export interface ConnectionResult {
  /** Connection ID */
  readonly connectionId: string;
  /** Whether connection is ready */
  readonly ready: boolean;
  /** Server version */
  readonly serverVersion: string;
  /** RuVector extension version */
  readonly ruVectorVersion: string;
  /** Connection parameters */
  readonly parameters: Record<string, string>;
}

/**
 * Query result wrapper.
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Query rows */
  readonly rows: T[];
  /** Row count */
  readonly rowCount: number;
  /** Affected rows (for INSERT/UPDATE/DELETE) */
  readonly affectedRows?: number;
  /** Query execution time in milliseconds */
  readonly durationMs: number;
  /** Query plan (if EXPLAIN was used) */
  readonly plan?: QueryPlan;
  /** Command type (SELECT, INSERT, etc.) */
  readonly command: string;
}

/**
 * Query execution plan.
 */
export interface QueryPlan {
  /** Plan nodes */
  readonly nodes: PlanNode[];
  /** Total cost estimate */
  readonly totalCost: number;
  /** Actual execution time (if ANALYZE was used) */
  readonly actualTimeMs?: number;
  /** Actual rows returned */
  readonly actualRows?: number;
  /** Peak memory usage */
  readonly peakMemory?: number;
}

/**
 * Query plan node.
 */
export interface PlanNode {
  /** Node type (Seq Scan, Index Scan, etc.) */
  readonly type: string;
  /** Relation name (if applicable) */
  readonly relation?: string;
  /** Index name (if applicable) */
  readonly indexName?: string;
  /** Startup cost */
  readonly startupCost: number;
  /** Total cost */
  readonly totalCost: number;
  /** Estimated rows */
  readonly planRows: number;
  /** Actual rows (if ANALYZE) */
  readonly actualRows?: number;
  /** Actual time (if ANALYZE) */
  readonly actualTimeMs?: number;
  /** Child nodes */
  readonly children?: PlanNode[];
  /** Additional output info */
  readonly output?: string[];
  /** Filter condition */
  readonly filter?: string;
  /** Index condition */
  readonly indexCond?: string;
}

/**
 * Batch operation result.
 */
export interface BatchResult<T = void> {
  /** Total items processed */
  readonly total: number;
  /** Successfully processed items */
  readonly successful: number;
  /** Failed items */
  readonly failed: number;
  /** Results per item (if applicable) */
  readonly results?: T[];
  /** Errors encountered */
  readonly errors?: BatchError[];
  /** Total duration in milliseconds */
  readonly durationMs: number;
  /** Throughput (items per second) */
  readonly throughput: number;
}

/**
 * Batch error.
 */
export interface BatchError {
  /** Index of the failed item */
  readonly index: number;
  /** Error message */
  readonly message: string;
  /** Error code */
  readonly code?: string;
  /** Original input that caused the error */
  readonly input?: unknown;
}

/**
 * Transaction result.
 */
export interface TransactionResult<T = void> {
  /** Transaction ID */
  readonly transactionId: string;
  /** Whether transaction was committed */
  readonly committed: boolean;
  /** Result data (if any) */
  readonly data?: T;
  /** Transaction duration in milliseconds */
  readonly durationMs: number;
  /** Number of queries executed */
  readonly queryCount: number;
}

/**
 * Migration result.
 */
export interface MigrationResult {
  /** Migration name/version */
  readonly name: string;
  /** Whether migration succeeded */
  readonly success: boolean;
  /** Migration direction */
  readonly direction: 'up' | 'down';
  /** Duration in milliseconds */
  readonly durationMs: number;
  /** Affected tables */
  readonly affectedTables: string[];
  /** Error message (if failed) */
  readonly error?: string;
}

/**
 * Bulk search result.
 */
export interface BulkSearchResult {
  /** Results per query */
  readonly results: VectorSearchResult[][];
  /** Total search time in milliseconds */
  readonly totalDurationMs: number;
  /** Average search time per query */
  readonly avgDurationMs: number;
  /** Cache statistics */
  readonly cacheStats: {
    readonly hits: number;
    readonly misses: number;
    readonly hitRate: number;
  };
}

/**
 * Embedding result.
 */
export interface EmbeddingResult {
  /** Embedding vector */
  readonly embedding: number[];
  /** Model used */
  readonly model: string;
  /** Token count */
  readonly tokenCount: number;
  /** Embedding duration in milliseconds */
  readonly durationMs: number;
  /** Dimension */
  readonly dimension: number;
}

/**
 * Batch embedding result.
 */
export interface BatchEmbeddingResult {
  /** Embedding results */
  readonly embeddings: EmbeddingResult[];
  /** Total tokens processed */
  readonly totalTokens: number;
  /** Total duration in milliseconds */
  readonly totalDurationMs: number;
  /** Throughput (tokens per second) */
  readonly throughput: number;
}

// ============================================================================
// Client Interface
// ============================================================================

/**
 * RuVector client configuration options.
 */
export interface RuVectorClientOptions extends RuVectorConfig {
  /** Enable automatic reconnection */
  readonly autoReconnect?: boolean;
  /** Maximum reconnection attempts */
  readonly maxReconnectAttempts?: number;
  /** Event handlers */
  readonly eventHandlers?: Partial<{
    [K in RuVectorEventType]: RuVectorEventHandler<K>;
  }>;
  /** Custom logger */
  readonly logger?: RuVectorLogger;
}

/**
 * Logger interface.
 */
export interface RuVectorLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * RuVector client interface.
 */
export interface IRuVectorClient extends RuVectorEventEmitter {
  // Connection Management
  connect(): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getConnectionInfo(): ConnectionResult | null;

  // Vector Operations
  search(options: VectorSearchOptions): Promise<VectorSearchResult[]>;
  batchSearch(options: BatchVectorOptions): Promise<BulkSearchResult>;
  insert(options: VectorInsertOptions): Promise<BatchResult<string>>;
  update(options: VectorUpdateOptions): Promise<boolean>;
  delete(tableName: string, id: string | number): Promise<boolean>;
  bulkDelete(tableName: string, ids: Array<string | number>): Promise<BatchResult>;

  // Index Management
  createIndex(options: VectorIndexOptions): Promise<void>;
  dropIndex(indexName: string): Promise<void>;
  rebuildIndex(indexName: string): Promise<void>;
  getIndexStats(indexName: string): Promise<IndexStats>;
  listIndices(tableName?: string): Promise<IndexStats[]>;

  // Attention Operations
  computeAttention(input: AttentionInput, config: AttentionConfig): Promise<AttentionOutput>;

  // GNN Operations
  runGNNLayer(graph: GraphData, layer: GNNLayer): Promise<GNNOutput>;
  buildGraph(nodeFeatures: number[][], edges: [number, number][]): GraphData;

  // Hyperbolic Operations
  hyperbolicEmbed(input: HyperbolicInput, config: HyperbolicEmbedding): Promise<HyperbolicOutput>;
  hyperbolicDistance(a: number[], b: number[], config: HyperbolicEmbedding): Promise<number>;

  // Embedding Operations
  embed(text: string, model?: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[], model?: string): Promise<BatchEmbeddingResult>;

  // Transaction Support
  transaction<T>(fn: (tx: IRuVectorTransaction) => Promise<T>): Promise<TransactionResult<T>>;

  // Admin Operations
  vacuum(tableName?: string): Promise<void>;
  analyze(tableName?: string): Promise<AnalysisResult>;
  healthCheck(): Promise<HealthStatus>;
  getStats(): Promise<RuVectorStats>;
}

/**
 * Transaction interface.
 */
export interface IRuVectorTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  insert(options: VectorInsertOptions): Promise<BatchResult<string>>;
  update(options: VectorUpdateOptions): Promise<boolean>;
  delete(tableName: string, id: string | number): Promise<boolean>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a valid distance metric.
 */
export function isDistanceMetric(value: unknown): value is DistanceMetric {
  const metrics = [
    'cosine', 'euclidean', 'dot', 'hamming', 'manhattan',
    'chebyshev', 'jaccard', 'minkowski', 'bray_curtis',
    'canberra', 'mahalanobis', 'correlation'
  ];
  return typeof value === 'string' && metrics.indexOf(value) !== -1;
}

/**
 * Check if a value is a valid attention mechanism.
 */
export function isAttentionMechanism(value: unknown): value is AttentionMechanism {
  const mechanisms = [
    'multi_head', 'self_attention', 'cross_attention', 'sparse_attention',
    'linear_attention', 'local_attention', 'global_attention', 'flash_attention',
    'flash_attention_v2', 'memory_efficient', 'chunk_attention', 'sliding_window',
    'dilated_attention', 'block_sparse', 'relative_position', 'rotary_position',
    'alibi', 'causal', 'bidirectional', 'axial', 'performer', 'linformer',
    'reformer', 'synthesizer', 'routing', 'mixture_of_experts', 'graph_attention',
    'hyperbolic_attention', 'spherical_attention', 'toroidal_attention',
    'temporal_attention', 'recurrent_attention', 'state_space', 'cross_modal',
    'perceiver', 'flamingo', 'retrieval_attention', 'knn_attention', 'memory_augmented'
  ];
  return typeof value === 'string' && mechanisms.indexOf(value) !== -1;
}

/**
 * Check if a value is a valid GNN layer type.
 */
export function isGNNLayerType(value: unknown): value is GNNLayerType {
  const types = [
    'gcn', 'gat', 'gat_v2', 'sage', 'gin', 'mpnn', 'edge_conv',
    'point_conv', 'transformer', 'pna', 'film', 'rgcn', 'hgt', 'han', 'metapath'
  ];
  return typeof value === 'string' && types.indexOf(value) !== -1;
}

/**
 * Check if a value is a valid hyperbolic model.
 */
export function isHyperbolicModel(value: unknown): value is HyperbolicModel {
  const models = ['poincare', 'lorentz', 'klein', 'half_space'];
  return typeof value === 'string' && models.indexOf(value) !== -1;
}

/**
 * Check if a value is a valid vector index type.
 */
export function isVectorIndexType(value: unknown): value is VectorIndexType {
  const types = ['hnsw', 'ivfflat', 'ivfpq', 'flat', 'diskann'];
  return typeof value === 'string' && types.indexOf(value) !== -1;
}

/**
 * Check if a result is successful.
 */
export function isSuccess<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success === true;
}

/**
 * Check if a result is an error.
 */
export function isError<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return result.success === false;
}

// ============================================================================
// Factory Types
// ============================================================================

/**
 * Factory function for creating RuVector clients.
 */
export type RuVectorClientFactory = (options: RuVectorClientOptions) => IRuVectorClient;

/**
 * Plugin registration type for the RuVector integration.
 */
export interface RuVectorPluginRegistration {
  /** Plugin name */
  readonly name: 'ruvector';
  /** Plugin version */
  readonly version: string;
  /** Client factory */
  readonly createClient: RuVectorClientFactory;
  /** Supported features */
  readonly features: RuVectorFeature[];
}

/**
 * RuVector feature flags.
 */
export type RuVectorFeature =
  | 'vector_search'
  | 'hnsw_index'
  | 'ivf_index'
  | 'attention'
  | 'gnn'
  | 'hyperbolic'
  | 'quantization'
  | 'batch_operations'
  | 'transactions'
  | 'streaming'
  | 'caching';

// ============================================================================
// Export Aggregation
// ============================================================================

/**
 * All SQL functions aggregated.
 */
export interface RuVectorSQLFunctions
  extends VectorFunctions,
    IndexFunctions,
    AttentionFunctions,
    GNNFunctions,
    HyperbolicFunctions,
    EmbeddingFunctions,
    QuantizationFunctions,
    UtilityFunctions {}

/**
 * Namespace export for module organization.
 */
export namespace RuVector {
  export type Config = RuVectorConfig;
  export type Client = IRuVectorClient;
  export type ClientOptions = RuVectorClientOptions;
  export type SearchOptions = VectorSearchOptions;
  export type SearchResult = VectorSearchResult;
  export type Attention = AttentionMechanism;
  export type AttentionCfg = AttentionConfig;
  export type GNN = GNNLayerType;
  export type GNNLayerCfg = GNNLayer;
  export type Hyperbolic = HyperbolicModel;
  export type HyperbolicCfg = HyperbolicEmbedding;
  export type Event = RuVectorEventType;
  export type EventData<T extends RuVectorEventType> = EventDataMap[T];
  export type Feature = RuVectorFeature;
}
