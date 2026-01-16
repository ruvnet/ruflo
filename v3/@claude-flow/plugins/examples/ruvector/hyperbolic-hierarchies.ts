/**
 * RuVector PostgreSQL Bridge - Hyperbolic Embeddings Example
 *
 * This example demonstrates:
 * - Embedding file tree structures in hyperbolic space
 * - Embedding class hierarchies with Poincare ball model
 * - Calculating hierarchy-aware distances
 * - Comparing Euclidean vs hyperbolic representations
 *
 * Run with: npx ts-node examples/ruvector/hyperbolic-hierarchies.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/hyperbolic-hierarchies
 */

import {
  createRuVectorBridge,
  type RuVectorBridge,
} from '../../src/integrations/ruvector/index.js';

import {
  PoincareBall,
  PoincareEmbedding,
  type HyperbolicConfig,
  type HierarchyNode,
} from '../../src/integrations/ruvector/hyperbolic.js';

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
  hyperbolicDim: 32,
  curvature: -1.0, // Negative curvature for hyperbolic space
};

// ============================================================================
// Sample Hierarchical Data
// ============================================================================

/**
 * File system tree structure.
 */
const fileTree: HierarchyNode = {
  id: 'root',
  name: '/',
  children: [
    {
      id: 'src',
      name: 'src',
      children: [
        {
          id: 'components',
          name: 'components',
          children: [
            { id: 'button', name: 'Button.tsx', children: [] },
            { id: 'input', name: 'Input.tsx', children: [] },
            { id: 'modal', name: 'Modal.tsx', children: [] },
            {
              id: 'forms',
              name: 'forms',
              children: [
                { id: 'login-form', name: 'LoginForm.tsx', children: [] },
                { id: 'signup-form', name: 'SignupForm.tsx', children: [] },
              ],
            },
          ],
        },
        {
          id: 'services',
          name: 'services',
          children: [
            { id: 'auth-service', name: 'auth.ts', children: [] },
            { id: 'api-service', name: 'api.ts', children: [] },
            { id: 'storage-service', name: 'storage.ts', children: [] },
          ],
        },
        {
          id: 'utils',
          name: 'utils',
          children: [
            { id: 'format', name: 'format.ts', children: [] },
            { id: 'validate', name: 'validate.ts', children: [] },
          ],
        },
      ],
    },
    {
      id: 'tests',
      name: 'tests',
      children: [
        { id: 'unit', name: 'unit', children: [
          { id: 'auth-test', name: 'auth.test.ts', children: [] },
          { id: 'api-test', name: 'api.test.ts', children: [] },
        ]},
        { id: 'integration', name: 'integration', children: [
          { id: 'e2e-test', name: 'e2e.test.ts', children: [] },
        ]},
      ],
    },
    {
      id: 'config',
      name: 'config',
      children: [
        { id: 'tsconfig', name: 'tsconfig.json', children: [] },
        { id: 'eslint', name: '.eslintrc.js', children: [] },
      ],
    },
  ],
};

/**
 * Class inheritance hierarchy (TypeScript/OOP).
 */
const classHierarchy: HierarchyNode = {
  id: 'object',
  name: 'Object',
  children: [
    {
      id: 'error',
      name: 'Error',
      children: [
        {
          id: 'validation-error',
          name: 'ValidationError',
          children: [
            { id: 'field-error', name: 'FieldValidationError', children: [] },
            { id: 'schema-error', name: 'SchemaValidationError', children: [] },
          ],
        },
        {
          id: 'http-error',
          name: 'HttpError',
          children: [
            { id: 'not-found', name: 'NotFoundError', children: [] },
            { id: 'unauthorized', name: 'UnauthorizedError', children: [] },
            { id: 'forbidden', name: 'ForbiddenError', children: [] },
          ],
        },
        { id: 'database-error', name: 'DatabaseError', children: [] },
      ],
    },
    {
      id: 'base-service',
      name: 'BaseService',
      children: [
        {
          id: 'crud-service',
          name: 'CrudService',
          children: [
            { id: 'user-service', name: 'UserService', children: [] },
            { id: 'product-service', name: 'ProductService', children: [] },
          ],
        },
        { id: 'auth-svc', name: 'AuthService', children: [] },
        { id: 'cache-svc', name: 'CacheService', children: [] },
      ],
    },
    {
      id: 'base-controller',
      name: 'BaseController',
      children: [
        { id: 'user-controller', name: 'UserController', children: [] },
        { id: 'auth-controller', name: 'AuthController', children: [] },
      ],
    },
  ],
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Flatten hierarchy to list with depth information.
 */
function flattenHierarchy(
  node: HierarchyNode,
  depth: number = 0,
  parent: string | null = null
): Array<{ node: HierarchyNode; depth: number; parent: string | null }> {
  const result: Array<{ node: HierarchyNode; depth: number; parent: string | null }> = [
    { node, depth, parent },
  ];

  for (const child of node.children) {
    result.push(...flattenHierarchy(child, depth + 1, node.id));
  }

  return result;
}

/**
 * Find path between two nodes in hierarchy.
 */
function findPath(root: HierarchyNode, targetId: string): string[] | null {
  if (root.id === targetId) return [root.id];

  for (const child of root.children) {
    const childPath = findPath(child, targetId);
    if (childPath) return [root.id, ...childPath];
  }

  return null;
}

/**
 * Calculate tree distance (number of edges in path).
 */
function treeDistance(root: HierarchyNode, id1: string, id2: string): number {
  const path1 = findPath(root, id1) || [];
  const path2 = findPath(root, id2) || [];

  // Find lowest common ancestor
  let lcaDepth = 0;
  while (
    lcaDepth < path1.length &&
    lcaDepth < path2.length &&
    path1[lcaDepth] === path2[lcaDepth]
  ) {
    lcaDepth++;
  }

  // Distance = path from node1 to LCA + path from LCA to node2
  return (path1.length - lcaDepth) + (path2.length - lcaDepth);
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Hyperbolic Embeddings Example');
  console.log('============================================================\n');

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
  });

  // Initialize Poincare ball model
  const poincare = new PoincareBall({
    dimension: config.hyperbolicDim,
    curvature: config.curvature,
    epsilon: 1e-6,
  });

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL\n');

    // ========================================================================
    // 1. Embed File Tree Structure
    // ========================================================================
    console.log('1. Embedding File Tree in Hyperbolic Space');
    console.log('   ' + '-'.repeat(50));

    const fileEmbedding = new PoincareEmbedding({
      dimension: config.hyperbolicDim,
      curvature: config.curvature,
      learningRate: 0.01,
    });

    // Train embeddings on file hierarchy
    console.log('   Training Poincare embeddings for file tree...');
    const startTrain = performance.now();
    await fileEmbedding.train(fileTree, { epochs: 100, batchSize: 16 });
    const trainTime = performance.now() - startTrain;
    console.log(`   Training completed in ${trainTime.toFixed(0)}ms`);

    // Get embeddings for all nodes
    const flatFiles = flattenHierarchy(fileTree);
    console.log(`\n   Embedded ${flatFiles.length} nodes`);

    // Show embedding norms (closer to 1 = deeper in hierarchy)
    console.log('\n   Embedding norms by depth (closer to 1 = deeper):');
    const depthGroups = new Map<number, Array<{ name: string; norm: number }>>();

    for (const { node, depth } of flatFiles) {
      const embedding = fileEmbedding.getEmbedding(node.id);
      if (embedding) {
        const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
        if (!depthGroups.has(depth)) depthGroups.set(depth, []);
        depthGroups.get(depth)?.push({ name: node.name, norm });
      }
    }

    depthGroups.forEach((nodes, depth) => {
      const avgNorm = nodes.reduce((s, n) => s + n.norm, 0) / nodes.length;
      const samples = nodes.slice(0, 3).map(n => n.name).join(', ');
      console.log(`     Depth ${depth}: avg norm = ${avgNorm.toFixed(4)} (${samples}${nodes.length > 3 ? '...' : ''})`);
    });
    console.log();

    // ========================================================================
    // 2. Hyperbolic Distance vs Tree Distance
    // ========================================================================
    console.log('2. Comparing Hyperbolic Distance to Tree Distance');
    console.log('   ' + '-'.repeat(50));

    const testPairs = [
      ['button', 'input'],           // Same directory
      ['button', 'login-form'],      // Nearby (components)
      ['button', 'auth-service'],    // Different subtrees
      ['button', 'auth-test'],       // Far apart (src vs tests)
      ['root', 'login-form'],        // Root to deep node
    ];

    console.log('   Node Pair                 | Tree Dist | Hyperbolic Dist | Correlation');
    console.log('   ' + '-'.repeat(75));

    for (const [id1, id2] of testPairs) {
      const treeDist = treeDistance(fileTree, id1, id2);
      const emb1 = fileEmbedding.getEmbedding(id1);
      const emb2 = fileEmbedding.getEmbedding(id2);

      if (emb1 && emb2) {
        const hypDist = poincare.distance(emb1, emb2);
        const node1 = flatFiles.find(f => f.node.id === id1)?.node.name || id1;
        const node2 = flatFiles.find(f => f.node.id === id2)?.node.name || id2;
        const pairName = `${node1} <-> ${node2}`;

        console.log(
          `   ${pairName.padEnd(25)} | ${treeDist.toString().padStart(9)} | ` +
          `${hypDist.toFixed(4).padStart(15)} | ` +
          `${treeDist > 0 ? (hypDist / treeDist).toFixed(3) : 'N/A'}`
        );
      }
    }
    console.log();

    // ========================================================================
    // 3. Embed Class Hierarchy
    // ========================================================================
    console.log('3. Embedding Class Inheritance Hierarchy');
    console.log('   ' + '-'.repeat(50));

    const classEmbedding = new PoincareEmbedding({
      dimension: config.hyperbolicDim,
      curvature: config.curvature,
      learningRate: 0.01,
    });

    console.log('   Training Poincare embeddings for class hierarchy...');
    await classEmbedding.train(classHierarchy, { epochs: 100, batchSize: 16 });

    const flatClasses = flattenHierarchy(classHierarchy);
    console.log(`   Embedded ${flatClasses.length} classes`);

    // Show class hierarchy with embeddings
    console.log('\n   Class hierarchy with embedding norms:');
    for (const { node, depth } of flatClasses) {
      const emb = classEmbedding.getEmbedding(node.id);
      const norm = emb ? Math.sqrt(emb.reduce((s, v) => s + v * v, 0)) : 0;
      const indent = '  '.repeat(depth);
      console.log(`     ${indent}${node.name} (norm: ${norm.toFixed(4)})`);
    }
    console.log();

    // ========================================================================
    // 4. Find Nearest Ancestors and Descendants
    // ========================================================================
    console.log('4. Finding Nearest Ancestors and Descendants');
    console.log('   ' + '-'.repeat(50));

    const queryClass = 'not-found'; // NotFoundError
    const queryEmb = classEmbedding.getEmbedding(queryClass);

    if (queryEmb) {
      // Find classes by hyperbolic distance
      const distances = flatClasses
        .filter(c => c.node.id !== queryClass)
        .map(({ node }) => {
          const emb = classEmbedding.getEmbedding(node.id);
          if (!emb) return null;
          return {
            id: node.id,
            name: node.name,
            distance: poincare.distance(queryEmb, emb),
            isAncestor: findPath(classHierarchy, queryClass)?.includes(node.id) ?? false,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .sort((a, b) => a.distance - b.distance);

      console.log(`   Query: ${queryClass} (NotFoundError)`);
      console.log('\n   Nearest by hyperbolic distance:');
      distances.slice(0, 5).forEach((d, i) => {
        const relation = d.isAncestor ? '[ancestor]' : '';
        console.log(`     ${i + 1}. ${d.name} - distance: ${d.distance.toFixed(4)} ${relation}`);
      });

      console.log('\n   Actual ancestors (by tree structure):');
      const ancestors = findPath(classHierarchy, queryClass) || [];
      ancestors.slice(0, -1).forEach((id, i) => {
        const node = flatClasses.find(c => c.node.id === id);
        if (node) {
          const emb = classEmbedding.getEmbedding(id);
          const dist = emb ? poincare.distance(queryEmb, emb) : 0;
          console.log(`     ${i + 1}. ${node.node.name} - distance: ${dist.toFixed(4)}`);
        }
      });
    }
    console.log();

    // ========================================================================
    // 5. Hyperbolic Operations
    // ========================================================================
    console.log('5. Hyperbolic Space Operations');
    console.log('   ' + '-'.repeat(50));

    const emb1 = classEmbedding.getEmbedding('error');
    const emb2 = classEmbedding.getEmbedding('validation-error');

    if (emb1 && emb2) {
      // Hyperbolic midpoint (Mobius gyromidpoint)
      const midpoint = poincare.mobius_add(
        poincare.scalar_mult(0.5, emb1),
        poincare.scalar_mult(0.5, emb2)
      );
      const midNorm = Math.sqrt(midpoint.reduce((s, v) => s + v * v, 0));

      console.log('   Midpoint between Error and ValidationError:');
      console.log(`     Norm of midpoint: ${midNorm.toFixed(4)}`);
      console.log(`     Distance to Error: ${poincare.distance(midpoint, emb1).toFixed(4)}`);
      console.log(`     Distance to ValidationError: ${poincare.distance(midpoint, emb2).toFixed(4)}`);

      // Exponential and logarithmic maps
      console.log('\n   Exponential map (tangent space -> hyperbolic):');
      const tangentVector = Array.from({ length: config.hyperbolicDim }, () => Math.random() * 0.1);
      const mapped = poincare.exp_map(tangentVector, emb1);
      const mappedNorm = Math.sqrt(mapped.reduce((s, v) => s + v * v, 0));
      console.log(`     Input tangent vector norm: ${Math.sqrt(tangentVector.reduce((s, v) => s + v * v, 0)).toFixed(4)}`);
      console.log(`     Mapped point norm: ${mappedNorm.toFixed(4)}`);
    }
    console.log();

    // ========================================================================
    // 6. Store in PostgreSQL with Hyperbolic Distance
    // ========================================================================
    console.log('6. Storing Hyperbolic Embeddings in PostgreSQL');
    console.log('   ' + '-'.repeat(50));

    // Create collection for class embeddings
    await bridge.createCollection('class_hierarchy_embeddings', {
      dimensions: config.hyperbolicDim,
      distanceMetric: 'euclidean', // Use Euclidean for storage, compute hyperbolic distance separately
      indexType: 'hnsw',
    });

    // Store embeddings
    for (const { node, depth, parent } of flatClasses) {
      const emb = classEmbedding.getEmbedding(node.id);
      if (emb) {
        await bridge.insert('class_hierarchy_embeddings', {
          id: node.id,
          embedding: emb,
          metadata: {
            name: node.name,
            depth,
            parent,
            isLeaf: node.children.length === 0,
          },
        });
      }
    }

    console.log(`   Stored ${flatClasses.length} hyperbolic embeddings`);

    // Query and re-rank with hyperbolic distance
    const queryId = 'unauthorized';
    const queryHypEmb = classEmbedding.getEmbedding(queryId);

    if (queryHypEmb) {
      // Get candidates using Euclidean distance (fast approximation)
      const candidates = await bridge.search('class_hierarchy_embeddings', queryHypEmb, {
        k: 10,
        includeMetadata: true,
      });

      // Re-rank with hyperbolic distance
      const reranked = candidates
        .map(c => {
          const hypDist = poincare.distance(queryHypEmb, c.embedding);
          return { ...c, hyperbolicDistance: hypDist };
        })
        .sort((a, b) => a.hyperbolicDistance - b.hyperbolicDistance);

      console.log(`\n   Query: ${queryId} (UnauthorizedError)`);
      console.log('   Results re-ranked by hyperbolic distance:');
      reranked.slice(0, 5).forEach((r, i) => {
        console.log(`     ${i + 1}. ${r.metadata?.name} (hyp dist: ${r.hyperbolicDistance.toFixed(4)})`);
      });
    }

    // ========================================================================
    // 7. Euclidean vs Hyperbolic Comparison
    // ========================================================================
    console.log('\n7. Euclidean vs Hyperbolic Distance Comparison');
    console.log('   ' + '-'.repeat(50));

    // Compare how well each distance metric preserves hierarchy
    let euclideanCorrelation = 0;
    let hyperbolicCorrelation = 0;
    let comparisons = 0;

    for (const { node: node1 } of flatClasses) {
      for (const { node: node2 } of flatClasses) {
        if (node1.id >= node2.id) continue;

        const emb1 = classEmbedding.getEmbedding(node1.id);
        const emb2 = classEmbedding.getEmbedding(node2.id);
        if (!emb1 || !emb2) continue;

        const treeDist = treeDistance(classHierarchy, node1.id, node2.id);
        const eucDist = Math.sqrt(emb1.reduce((s, v, i) => s + Math.pow(v - emb2[i], 2), 0));
        const hypDist = poincare.distance(emb1, emb2);

        // Spearman-like correlation (rank agreement)
        if (treeDist > 0) {
          euclideanCorrelation += eucDist / treeDist;
          hyperbolicCorrelation += hypDist / treeDist;
          comparisons++;
        }
      }
    }

    euclideanCorrelation /= comparisons;
    hyperbolicCorrelation /= comparisons;

    console.log('   Distance metric quality (lower = better preserves tree structure):');
    console.log(`     Euclidean: ${euclideanCorrelation.toFixed(4)}`);
    console.log(`     Hyperbolic: ${hyperbolicCorrelation.toFixed(4)}`);
    console.log(`     Improvement: ${((euclideanCorrelation / hyperbolicCorrelation - 1) * 100).toFixed(1)}%`);

    // ========================================================================
    // Done
    // ========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('Hyperbolic embeddings example completed!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await bridge.disconnect();
    console.log('\nDisconnected from PostgreSQL.');
  }
}

main().catch(console.error);
