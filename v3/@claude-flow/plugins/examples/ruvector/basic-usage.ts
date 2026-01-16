/**
 * RuVector PostgreSQL Bridge - Basic Usage Example
 *
 * This example demonstrates fundamental operations:
 * - Connecting to PostgreSQL with pgvector
 * - Creating collections and inserting vectors
 * - Performing similarity searches
 * - Updating and deleting vectors
 *
 * Prerequisites:
 *   - PostgreSQL 14+ with pgvector extension
 *   - Docker: docker compose up -d
 *
 * Run with: npx ts-node examples/ruvector/basic-usage.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/basic-usage
 */

import {
  createRuVectorBridge,
  type RuVectorBridge,
  type VectorRecord,
  type VectorSearchOptions,
} from '../../src/integrations/ruvector/index.js';

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
  dimensions: 384, // Common embedding dimension (e.g., sentence-transformers/all-MiniLM-L6-v2)
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a random embedding vector for demonstration.
 * In production, use a proper embedding model.
 */
function generateRandomEmbedding(dim: number): number[] {
  const embedding = new Array(dim);
  for (let i = 0; i < dim; i++) {
    embedding[i] = Math.random() * 2 - 1; // Range [-1, 1]
  }
  // Normalize to unit length
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map(v => v / magnitude);
}

/**
 * Print search results in a readable format.
 */
function printResults(title: string, results: VectorRecord[]): void {
  console.log(`\n${title}`);
  console.log('='.repeat(50));
  results.forEach((result, i) => {
    console.log(`${i + 1}. ID: ${result.id}`);
    console.log(`   Distance: ${result.distance?.toFixed(4) ?? 'N/A'}`);
    console.log(`   Metadata: ${JSON.stringify(result.metadata)}`);
  });
}

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Basic Usage Example');
  console.log('================================================\n');

  // Create the bridge instance
  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
    poolSize: 5,
  });

  try {
    // ========================================================================
    // 1. Connect to PostgreSQL
    // ========================================================================
    console.log('1. Connecting to PostgreSQL...');
    await bridge.connect();
    console.log('   Connected successfully!\n');

    // ========================================================================
    // 2. Create a Collection
    // ========================================================================
    console.log('2. Creating collection "documents"...');
    await bridge.createCollection('documents', {
      dimensions: config.dimensions,
      distanceMetric: 'cosine',
      indexType: 'hnsw',
      indexParams: {
        m: 16,              // Number of connections per layer
        efConstruction: 64, // Size of dynamic candidate list during construction
      },
    });
    console.log('   Collection created!\n');

    // ========================================================================
    // 3. Insert Vectors
    // ========================================================================
    console.log('3. Inserting vectors...');

    // Sample documents with embeddings
    const documents = [
      { id: 'doc-1', content: 'Introduction to machine learning', category: 'ML' },
      { id: 'doc-2', content: 'Deep learning fundamentals', category: 'DL' },
      { id: 'doc-3', content: 'Natural language processing', category: 'NLP' },
      { id: 'doc-4', content: 'Computer vision basics', category: 'CV' },
      { id: 'doc-5', content: 'Reinforcement learning guide', category: 'RL' },
    ];

    // Insert each document with its embedding
    for (const doc of documents) {
      const embedding = generateRandomEmbedding(config.dimensions);
      await bridge.insert('documents', {
        id: doc.id,
        embedding,
        metadata: {
          content: doc.content,
          category: doc.category,
          createdAt: new Date().toISOString(),
        },
      });
      console.log(`   Inserted: ${doc.id}`);
    }
    console.log('   All vectors inserted!\n');

    // ========================================================================
    // 4. Basic Similarity Search
    // ========================================================================
    console.log('4. Performing similarity search...');

    // Generate a query vector (in production, embed your query text)
    const queryVector = generateRandomEmbedding(config.dimensions);

    const searchOptions: VectorSearchOptions = {
      k: 3,                    // Return top 3 results
      includeMetadata: true,
      includeDistance: true,
    };

    const searchResults = await bridge.search('documents', queryVector, searchOptions);
    printResults('Top 3 Similar Documents', searchResults);

    // ========================================================================
    // 5. Filtered Search
    // ========================================================================
    console.log('\n5. Performing filtered search (category = "ML")...');

    const filteredResults = await bridge.search('documents', queryVector, {
      ...searchOptions,
      filter: {
        category: 'ML',
      },
    });
    printResults('Filtered Results (ML category)', filteredResults);

    // ========================================================================
    // 6. Range Search (by distance threshold)
    // ========================================================================
    console.log('\n6. Performing range search (distance < 0.8)...');

    const rangeResults = await bridge.search('documents', queryVector, {
      k: 10,
      includeMetadata: true,
      includeDistance: true,
      distanceThreshold: 0.8, // Only return results within this distance
    });
    printResults('Range Search Results', rangeResults);

    // ========================================================================
    // 7. Update a Vector
    // ========================================================================
    console.log('\n7. Updating vector "doc-1"...');

    const newEmbedding = generateRandomEmbedding(config.dimensions);
    await bridge.update('documents', 'doc-1', {
      embedding: newEmbedding,
      metadata: {
        content: 'Introduction to machine learning (Updated)',
        category: 'ML',
        updatedAt: new Date().toISOString(),
      },
    });
    console.log('   Vector updated!');

    // Verify the update
    const updatedDoc = await bridge.get('documents', 'doc-1');
    if (updatedDoc) {
      console.log(`   Verified: ${JSON.stringify(updatedDoc.metadata)}`);
    }

    // ========================================================================
    // 8. Batch Insert
    // ========================================================================
    console.log('\n8. Batch inserting 100 vectors...');

    const batchRecords: VectorRecord[] = [];
    for (let i = 0; i < 100; i++) {
      batchRecords.push({
        id: `batch-${i}`,
        embedding: generateRandomEmbedding(config.dimensions),
        metadata: {
          batchIndex: i,
          createdAt: new Date().toISOString(),
        },
      });
    }

    const startTime = performance.now();
    await bridge.insertBatch('documents', batchRecords);
    const duration = performance.now() - startTime;

    console.log(`   Inserted 100 vectors in ${duration.toFixed(2)}ms`);
    console.log(`   Throughput: ${(100 / (duration / 1000)).toFixed(0)} vectors/second`);

    // ========================================================================
    // 9. Get Collection Statistics
    // ========================================================================
    console.log('\n9. Collection statistics...');

    const stats = await bridge.getCollectionStats('documents');
    console.log(`   Total vectors: ${stats.vectorCount}`);
    console.log(`   Dimensions: ${stats.dimensions}`);
    console.log(`   Index type: ${stats.indexType}`);
    console.log(`   Index size: ${(stats.indexSizeBytes / 1024).toFixed(2)} KB`);

    // ========================================================================
    // 10. Delete Vectors
    // ========================================================================
    console.log('\n10. Deleting vectors...');

    // Delete a single vector
    await bridge.delete('documents', 'doc-5');
    console.log('   Deleted: doc-5');

    // Delete multiple vectors
    const idsToDelete = ['batch-0', 'batch-1', 'batch-2'];
    for (const id of idsToDelete) {
      await bridge.delete('documents', id);
    }
    console.log(`   Deleted: ${idsToDelete.join(', ')}`);

    // Verify deletion
    const deletedDoc = await bridge.get('documents', 'doc-5');
    console.log(`   Verification - doc-5 exists: ${deletedDoc !== null}`);

    // ========================================================================
    // 11. Cleanup (Optional)
    // ========================================================================
    console.log('\n11. Cleanup...');

    // Uncomment to drop the collection when done
    // await bridge.dropCollection('documents');
    // console.log('   Collection dropped!');

    console.log('   Skipping collection drop (uncomment to enable)');

    // ========================================================================
    // Done
    // ========================================================================
    console.log('\n' + '='.repeat(50));
    console.log('Basic usage example completed successfully!');
    console.log('='.repeat(50));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    // Always disconnect
    await bridge.disconnect();
    console.log('\nDisconnected from PostgreSQL.');
  }
}

// Run the example
main().catch(console.error);
