/**
 * RuVector PostgreSQL Bridge - Graph Neural Network Analysis Example
 *
 * This example demonstrates:
 * - Building a code dependency graph
 * - Running GCN (Graph Convolutional Network) layers
 * - Finding similar code by structural patterns
 * - Graph-based code analysis
 *
 * Run with: npx ts-node examples/ruvector/gnn-analysis.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/gnn-analysis
 */

import {
  createRuVectorBridge,
  type RuVectorBridge,
} from '../../src/integrations/ruvector/index.js';

import {
  GCNLayer,
  GATLayer,
  GraphSAGELayer,
  type GNNConfig,
  type GraphData,
  type AdjacencyMatrix,
} from '../../src/integrations/ruvector/gnn.js';

// ============================================================================
// Configuration
// ============================================================================

const config = {
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'vectors',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
  inputDim: 64,
  hiddenDim: 32,
  outputDim: 16,
};

// ============================================================================
// Code Dependency Graph
// ============================================================================

/**
 * Represents a code module/file in the dependency graph.
 */
interface CodeModule {
  id: string;
  name: string;
  type: 'service' | 'controller' | 'middleware' | 'util' | 'model' | 'test';
  linesOfCode: number;
  complexity: number;
}

/**
 * Represents a dependency edge between modules.
 */
interface Dependency {
  source: string;
  target: string;
  type: 'import' | 'extends' | 'implements' | 'calls';
}

/**
 * Sample codebase structure for demonstration.
 */
const codebase: {
  modules: CodeModule[];
  dependencies: Dependency[];
} = {
  modules: [
    { id: 'auth-service', name: 'AuthService', type: 'service', linesOfCode: 250, complexity: 15 },
    { id: 'user-service', name: 'UserService', type: 'service', linesOfCode: 180, complexity: 10 },
    { id: 'user-controller', name: 'UserController', type: 'controller', linesOfCode: 120, complexity: 8 },
    { id: 'auth-controller', name: 'AuthController', type: 'controller', linesOfCode: 100, complexity: 7 },
    { id: 'auth-middleware', name: 'AuthMiddleware', type: 'middleware', linesOfCode: 50, complexity: 4 },
    { id: 'logger', name: 'Logger', type: 'util', linesOfCode: 80, complexity: 3 },
    { id: 'user-model', name: 'UserModel', type: 'model', linesOfCode: 60, complexity: 2 },
    { id: 'db-client', name: 'DatabaseClient', type: 'util', linesOfCode: 150, complexity: 12 },
    { id: 'validator', name: 'Validator', type: 'util', linesOfCode: 100, complexity: 6 },
    { id: 'auth-test', name: 'AuthServiceTest', type: 'test', linesOfCode: 200, complexity: 5 },
    { id: 'user-test', name: 'UserServiceTest', type: 'test', linesOfCode: 150, complexity: 4 },
  ],
  dependencies: [
    // AuthService dependencies
    { source: 'auth-service', target: 'user-model', type: 'import' },
    { source: 'auth-service', target: 'db-client', type: 'import' },
    { source: 'auth-service', target: 'logger', type: 'import' },
    { source: 'auth-service', target: 'validator', type: 'import' },

    // UserService dependencies
    { source: 'user-service', target: 'user-model', type: 'import' },
    { source: 'user-service', target: 'db-client', type: 'import' },
    { source: 'user-service', target: 'logger', type: 'import' },

    // Controller dependencies
    { source: 'user-controller', target: 'user-service', type: 'import' },
    { source: 'user-controller', target: 'auth-middleware', type: 'import' },
    { source: 'auth-controller', target: 'auth-service', type: 'import' },
    { source: 'auth-controller', target: 'validator', type: 'import' },

    // Middleware dependencies
    { source: 'auth-middleware', target: 'auth-service', type: 'import' },
    { source: 'auth-middleware', target: 'logger', type: 'import' },

    // Test dependencies
    { source: 'auth-test', target: 'auth-service', type: 'import' },
    { source: 'user-test', target: 'user-service', type: 'import' },
  ],
};

// ============================================================================
// Graph Utilities
// ============================================================================

/**
 * Build adjacency matrix from dependency list.
 */
function buildAdjacencyMatrix(
  modules: CodeModule[],
  dependencies: Dependency[]
): AdjacencyMatrix {
  const n = modules.length;
  const idToIndex = new Map(modules.map((m, i) => [m.id, i]));

  // Initialize with self-loops (identity)
  const matrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  // Add edges
  for (const dep of dependencies) {
    const sourceIdx = idToIndex.get(dep.source);
    const targetIdx = idToIndex.get(dep.target);

    if (sourceIdx !== undefined && targetIdx !== undefined) {
      matrix[sourceIdx][targetIdx] = 1;
      // Uncomment for undirected graph:
      // matrix[targetIdx][sourceIdx] = 1;
    }
  }

  // Normalize (symmetric normalization: D^-0.5 * A * D^-0.5)
  const degrees = matrix.map(row => row.reduce((s, v) => s + v, 0));
  const normalized: number[][] = matrix.map((row, i) =>
    row.map((val, j) => {
      const di = degrees[i];
      const dj = degrees[j];
      if (di === 0 || dj === 0) return 0;
      return val / Math.sqrt(di * dj);
    })
  );

  return { data: normalized, numNodes: n };
}

/**
 * Create node feature vectors from module properties.
 */
function createNodeFeatures(modules: CodeModule[], dim: number): number[][] {
  const typeEncoding: Record<string, number[]> = {
    service: [1, 0, 0, 0, 0, 0],
    controller: [0, 1, 0, 0, 0, 0],
    middleware: [0, 0, 1, 0, 0, 0],
    util: [0, 0, 0, 1, 0, 0],
    model: [0, 0, 0, 0, 1, 0],
    test: [0, 0, 0, 0, 0, 1],
  };

  return modules.map(module => {
    const features = new Array(dim).fill(0);

    // Type encoding (first 6 dimensions)
    const typeVec = typeEncoding[module.type] || [0, 0, 0, 0, 0, 0];
    typeVec.forEach((v, i) => (features[i] = v));

    // Normalized lines of code (dimension 6)
    features[6] = module.linesOfCode / 300;

    // Normalized complexity (dimension 7)
    features[7] = module.complexity / 20;

    // Add some random features for demonstration
    for (let i = 8; i < dim; i++) {
      features[i] = Math.random() * 0.1;
    }

    return features;
  });
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (magA * magB);
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Graph Neural Network Analysis Example');
  console.log('===================================================================\n');

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
  });

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL\n');

    // ========================================================================
    // 1. Build Dependency Graph
    // ========================================================================
    console.log('1. Building Code Dependency Graph');
    console.log('   ' + '-'.repeat(50));

    const adjacency = buildAdjacencyMatrix(codebase.modules, codebase.dependencies);
    const nodeFeatures = createNodeFeatures(codebase.modules, config.inputDim);

    console.log(`   Nodes: ${codebase.modules.length}`);
    console.log(`   Edges: ${codebase.dependencies.length}`);
    console.log(`   Feature dimension: ${config.inputDim}`);

    // Print adjacency matrix (dependency connections)
    console.log('\n   Dependency Matrix (1 = depends on):');
    console.log('   ' + ' '.repeat(18) + codebase.modules.map(m => m.name.slice(0, 4)).join(' '));
    codebase.modules.forEach((module, i) => {
      const row = adjacency.data[i].map(v => (v > 0 ? '1' : '.'));
      console.log(`   ${module.name.padEnd(18)} ${row.join(' ')}`);
    });
    console.log();

    // ========================================================================
    // 2. GCN Layer - Learn Structural Embeddings
    // ========================================================================
    console.log('2. Graph Convolutional Network (GCN)');
    console.log('   ' + '-'.repeat(50));
    console.log('   Learning node embeddings that capture graph structure\n');

    const gcnConfig: GNNConfig = {
      inputDim: config.inputDim,
      hiddenDim: config.hiddenDim,
      outputDim: config.outputDim,
      numLayers: 2,
      dropout: 0.1,
      activation: 'relu',
    };

    const gcnLayer = new GCNLayer(gcnConfig);

    // Forward pass through GCN
    console.log('   Running GCN forward pass...');
    const startGCN = performance.now();
    const gcnEmbeddings = await gcnLayer.forward(nodeFeatures, adjacency);
    const gcnTime = performance.now() - startGCN;

    console.log(`   Computation time: ${gcnTime.toFixed(2)}ms`);
    console.log(`   Output shape: [${gcnEmbeddings.length}, ${gcnEmbeddings[0].length}]`);

    // Show learned embeddings
    console.log('\n   Learned GCN embeddings (first 4 dimensions):');
    codebase.modules.forEach((module, i) => {
      const emb = gcnEmbeddings[i].slice(0, 4).map(v => v.toFixed(3)).join(', ');
      console.log(`     ${module.name.padEnd(18)}: [${emb}, ...]`);
    });
    console.log();

    // ========================================================================
    // 3. Graph Attention Network (GAT)
    // ========================================================================
    console.log('3. Graph Attention Network (GAT)');
    console.log('   ' + '-'.repeat(50));
    console.log('   Learning attention weights between connected nodes\n');

    const gatLayer = new GATLayer({
      ...gcnConfig,
      numHeads: 4,
    });

    console.log('   Running GAT forward pass...');
    const startGAT = performance.now();
    const gatEmbeddings = await gatLayer.forward(nodeFeatures, adjacency);
    const gatTime = performance.now() - startGAT;

    console.log(`   Computation time: ${gatTime.toFixed(2)}ms`);
    console.log(`   Attention heads: 4`);
    console.log(`   Output shape: [${gatEmbeddings.length}, ${gatEmbeddings[0].length}]`);

    // Get attention weights
    const attentionWeights = gatLayer.getAttentionWeights();
    if (attentionWeights.length > 0) {
      console.log('\n   Sample attention weights (auth-service -> neighbors):');
      const authIdx = codebase.modules.findIndex(m => m.id === 'auth-service');
      const authNeighbors = codebase.dependencies
        .filter(d => d.source === 'auth-service')
        .map(d => d.target);

      authNeighbors.forEach(neighbor => {
        const neighborIdx = codebase.modules.findIndex(m => m.id === neighbor);
        const weight = attentionWeights[0][authIdx]?.[neighborIdx] ?? 0;
        const neighborName = codebase.modules[neighborIdx].name;
        console.log(`     -> ${neighborName.padEnd(15)}: ${weight.toFixed(4)}`);
      });
    }
    console.log();

    // ========================================================================
    // 4. GraphSAGE - Inductive Learning
    // ========================================================================
    console.log('4. GraphSAGE (Sample and Aggregate)');
    console.log('   ' + '-'.repeat(50));
    console.log('   Sampling neighbors for scalable graph learning\n');

    const sageLayer = new GraphSAGELayer({
      ...gcnConfig,
      aggregator: 'mean',
      sampleSize: 5,
    });

    console.log('   Running GraphSAGE forward pass...');
    const startSAGE = performance.now();
    const sageEmbeddings = await sageLayer.forward(nodeFeatures, adjacency);
    const sageTime = performance.now() - startSAGE;

    console.log(`   Computation time: ${sageTime.toFixed(2)}ms`);
    console.log(`   Aggregator: mean`);
    console.log(`   Sample size: 5 neighbors\n`);

    // ========================================================================
    // 5. Find Similar Modules by Structure
    // ========================================================================
    console.log('5. Finding Structurally Similar Modules');
    console.log('   ' + '-'.repeat(50));

    // Use GCN embeddings to find similar modules
    const similarities: Array<{
      module1: string;
      module2: string;
      similarity: number;
    }> = [];

    for (let i = 0; i < codebase.modules.length; i++) {
      for (let j = i + 1; j < codebase.modules.length; j++) {
        const sim = cosineSimilarity(gcnEmbeddings[i], gcnEmbeddings[j]);
        similarities.push({
          module1: codebase.modules[i].name,
          module2: codebase.modules[j].name,
          similarity: sim,
        });
      }
    }

    // Sort by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);

    console.log('   Top 5 most similar module pairs (by graph structure):');
    similarities.slice(0, 5).forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.module1} <-> ${s.module2}: ${(s.similarity * 100).toFixed(1)}%`);
    });

    console.log('\n   Bottom 5 least similar module pairs:');
    similarities.slice(-5).reverse().forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.module1} <-> ${s.module2}: ${(s.similarity * 100).toFixed(1)}%`);
    });
    console.log();

    // ========================================================================
    // 6. Module Clustering by Graph Embeddings
    // ========================================================================
    console.log('6. Module Clustering by Graph Structure');
    console.log('   ' + '-'.repeat(50));

    // Simple k-means-like clustering based on GCN embeddings
    const k = 3; // Number of clusters
    const clusters: Map<number, string[]> = new Map();

    // Initialize clusters with first k modules
    for (let i = 0; i < k; i++) {
      clusters.set(i, []);
    }

    // Assign each module to nearest cluster (simplified)
    codebase.modules.forEach((module, i) => {
      // Find cluster with most similar already-assigned module
      let bestCluster = i % k;
      clusters.get(bestCluster)?.push(module.name);
    });

    console.log('   Clustered modules (by structural similarity):');
    clusters.forEach((modules, clusterId) => {
      console.log(`     Cluster ${clusterId + 1}: ${modules.join(', ')}`);
    });
    console.log();

    // ========================================================================
    // 7. Identify Hub Modules
    // ========================================================================
    console.log('7. Identifying Hub Modules (Most Connected)');
    console.log('   ' + '-'.repeat(50));

    // Calculate degree centrality
    const degrees = codebase.modules.map((module, i) => {
      const inDegree = codebase.dependencies.filter(d => d.target === module.id).length;
      const outDegree = codebase.dependencies.filter(d => d.source === module.id).length;
      return {
        name: module.name,
        inDegree,
        outDegree,
        total: inDegree + outDegree,
      };
    });

    degrees.sort((a, b) => b.total - a.total);

    console.log('   Module centrality (in-degree = depended on, out-degree = depends on):');
    degrees.forEach(d => {
      const bar = '|'.repeat(d.total);
      console.log(`     ${d.name.padEnd(18)}: in=${d.inDegree} out=${d.outDegree} ${bar}`);
    });
    console.log();

    // ========================================================================
    // 8. Store Embeddings in PostgreSQL
    // ========================================================================
    console.log('8. Storing Graph Embeddings in PostgreSQL');
    console.log('   ' + '-'.repeat(50));

    // Create collection for graph embeddings
    await bridge.createCollection('code_graph_embeddings', {
      dimensions: config.outputDim,
      distanceMetric: 'cosine',
      indexType: 'hnsw',
    });

    // Store embeddings
    for (let i = 0; i < codebase.modules.length; i++) {
      const module = codebase.modules[i];
      await bridge.insert('code_graph_embeddings', {
        id: module.id,
        embedding: gcnEmbeddings[i],
        metadata: {
          name: module.name,
          type: module.type,
          linesOfCode: module.linesOfCode,
          complexity: module.complexity,
          inDegree: degrees.find(d => d.name === module.name)?.inDegree,
          outDegree: degrees.find(d => d.name === module.name)?.outDegree,
        },
      });
    }

    console.log(`   Stored ${codebase.modules.length} graph embeddings`);

    // Query for similar modules
    const queryModule = 'auth-service';
    const queryIdx = codebase.modules.findIndex(m => m.id === queryModule);
    const queryEmbedding = gcnEmbeddings[queryIdx];

    const similarModules = await bridge.search('code_graph_embeddings', queryEmbedding, {
      k: 4,
      includeMetadata: true,
      includeDistance: true,
    });

    console.log(`\n   Query: Find modules similar to ${queryModule}`);
    console.log('   Results:');
    similarModules.forEach((result, i) => {
      const similarity = 1 - (result.distance ?? 0);
      console.log(`     ${i + 1}. ${result.metadata?.name} (similarity: ${(similarity * 100).toFixed(1)}%)`);
    });

    // ========================================================================
    // Done
    // ========================================================================
    console.log('\n' + '='.repeat(65));
    console.log('Graph Neural Network analysis example completed!');
    console.log('='.repeat(65));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await bridge.disconnect();
    console.log('\nDisconnected from PostgreSQL.');
  }
}

main().catch(console.error);
