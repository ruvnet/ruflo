/**
 * SPARC Memory Bank - Usage Examples
 * Demonstrates the complete functionality of the memory system
 */

import {
  MemoryManager,
  MemoryItem,
  MemoryQuery,
  ImportExportManager,
  NamespaceManager
} from '../src';

async function main() {
  console.log('🧠 SPARC Memory Bank - Usage Examples\n');

  // 1. Initialize Memory Manager with SQLite backend
  console.log('1. Initializing Memory Manager...');
  const memoryManager = new MemoryManager({
    backend: 'sqlite',
    backendConfig: {
      path: './claude-flow-memory.db',
      wal: true
    },
    cacheConfig: {
      maxSize: 1000,
      ttl: 3600000, // 1 hour
      strategy: 'lru'
    },
    enableIndexing: true,
    enableNamespaces: true,
    replicationConfig: {
      mode: 'peer-to-peer',
      nodes: [
        { id: 'node1', url: 'http://localhost:3001' },
        { id: 'node2', url: 'http://localhost:3002' }
      ],
      syncInterval: 60000 // 1 minute
    }
  });

  await memoryManager.initialize();
  console.log('✅ Memory Manager initialized\n');

  // 2. Store different types of memory items
  console.log('2. Storing memory items...');
  
  // Agent calibration values
  await memoryManager.store({
    category: 'calibration',
    key: 'react-performance',
    value: {
      bundleSize: { max: 200000, optimal: 150000 },
      renderTime: { max: 16, optimal: 8 },
      memoryUsage: { max: 50000000, optimal: 30000000 }
    },
    metadata: {
      tags: ['react', 'performance', 'frontend'],
      confidence: 0.95,
      source: 'performance-testing'
    }
  });

  // TDD patterns
  await memoryManager.store({
    category: 'test-pattern',
    key: 'london-school-mocking',
    value: {
      pattern: 'Mock all collaborators',
      example: `
        describe('UserService', () => {
          let userService;
          let mockRepository;
          
          beforeEach(() => {
            mockRepository = jest.fn();
            userService = new UserService(mockRepository);
          });
          
          it('should save user', async () => {
            mockRepository.save = jest.fn().mockResolvedValue({ id: 1 });
            await userService.createUser({ name: 'Alice' });
            expect(mockRepository.save).toHaveBeenCalled();
          });
        });
      `,
      benefits: ['Fast tests', 'Isolated units', 'Clear boundaries'],
      drawbacks: ['More setup', 'Brittle to refactoring']
    },
    metadata: {
      tags: ['tdd', 'london-school', 'testing'],
      language: 'javascript'
    }
  });

  // Architectural decisions
  await memoryManager.store({
    category: 'architecture',
    key: 'adr-001-event-sourcing',
    value: {
      title: 'Use Event Sourcing for Audit Trail',
      status: 'accepted',
      context: 'Need complete audit trail of all system changes',
      decision: 'Implement event sourcing pattern',
      consequences: {
        positive: ['Complete audit trail', 'Time travel debugging', 'Event replay'],
        negative: ['Increased complexity', 'Storage requirements']
      }
    },
    metadata: {
      tags: ['architecture', 'event-sourcing', 'audit'],
      date: '2025-01-06',
      author: 'claude-architect'
    }
  });

  console.log('✅ Memory items stored\n');

  // 3. Query memory items
  console.log('3. Querying memory items...');
  
  // Query by category
  const calibrationItems = await memoryManager.query({
    categories: ['calibration']
  });
  console.log(`Found ${calibrationItems.length} calibration items`);

  // Query by tags
  const testingPatterns = await memoryManager.query({
    tags: ['testing']
  });
  console.log(`Found ${testingPatterns.length} testing patterns`);

  // Query with custom filter
  const recentDecisions = await memoryManager.query({
    categories: ['architecture'],
    filter: (item) => {
      const date = new Date(item.metadata?.date || 0);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return date > thirtyDaysAgo;
    }
  });
  console.log(`Found ${recentDecisions.length} recent architectural decisions\n`);

  // 4. Namespace management
  console.log('4. Managing namespaces...');
  
  // Create project-specific namespace
  const projectNamespace = await memoryManager.store({
    category: 'project',
    key: 'ultrasonic-steganography',
    value: {
      name: 'Ultrasonic Steganography',
      description: 'Audio steganography using ultrasonic frequencies',
      status: 'in-progress',
      team: ['alice', 'bob', 'charlie']
    }
  }, 'ultrasonic-project');

  console.log('✅ Project namespace created\n');

  // 5. Vector search for semantic queries
  console.log('5. Vector search example...');
  
  // Store items with vector embeddings
  const indexer = (memoryManager as any).indexer;
  
  const doc1 = 'React performance optimization techniques for large applications';
  const embedding1 = await indexer.generateEmbedding(doc1);
  
  await memoryManager.store({
    category: 'knowledge',
    key: 'react-perf-guide',
    value: doc1,
    vectorEmbedding: embedding1,
    metadata: {
      type: 'guide',
      topic: 'performance'
    }
  });

  const doc2 = 'Testing strategies for microservices architecture';
  const embedding2 = await indexer.generateEmbedding(doc2);
  
  await memoryManager.store({
    category: 'knowledge',
    key: 'microservices-testing',
    value: doc2,
    vectorEmbedding: embedding2,
    metadata: {
      type: 'guide',
      topic: 'testing'
    }
  });

  // Search for similar documents
  const searchQuery = 'How to optimize React application performance';
  const searchEmbedding = await indexer.generateEmbedding(searchQuery);
  
  const similarDocs = await memoryManager.query({
    vectorSearch: {
      embedding: searchEmbedding,
      topK: 5,
      threshold: 0.7
    }
  });

  console.log(`Found ${similarDocs.length} similar documents\n`);

  // 6. Import/Export functionality
  console.log('6. Import/Export example...');
  
  const exportManager = new ImportExportManager();
  
  // Export to JSON
  const snapshot = await memoryManager.export({
    categories: ['calibration', 'test-pattern'],
    format: 'json'
  });
  
  console.log('✅ Exported snapshot to JSON');

  // Export to Markdown
  const markdownExport = await memoryManager.export({
    categories: ['architecture'],
    format: 'markdown'
  });
  
  console.log('✅ Exported architectural decisions to Markdown\n');

  // 7. Time-travel queries
  console.log('7. Time-travel query example...');
  
  const oneHourAgo = Date.now() - 3600000;
  
  const historicalItems = await memoryManager.query({
    asOf: oneHourAgo
  });
  
  console.log(`Found ${historicalItems.length} items from 1 hour ago\n`);

  // 8. Memory statistics
  console.log('8. Memory statistics...');
  
  const stats = await memoryManager.getStats();
  console.log('Memory Stats:', {
    totalItems: stats.backend.totalItems,
    categories: stats.backend.categories,
    cacheHitRate: stats.cache.hitRate,
    cacheSize: stats.cache.itemCount
  });
  console.log('');

  // 9. Conflict resolution example
  console.log('9. CRDT conflict resolution...');
  
  // Simulate concurrent updates
  const item1 = {
    id: 'shared-config',
    category: 'config',
    key: 'app-settings',
    value: { theme: 'light', language: 'en' },
    metadata: { timestamp: Date.now() - 1000 }
  };

  const item2 = {
    id: 'shared-config',
    category: 'config',
    key: 'app-settings',
    value: { theme: 'dark', notifications: true },
    metadata: { timestamp: Date.now() }
  };

  await memoryManager.store(item1);
  const resolved = await memoryManager.store(item2);
  
  console.log('Resolved conflict:', resolved.value);
  console.log('✅ Conflicts resolved using CRDT\n');

  // 10. Cleanup
  console.log('10. Cleaning up...');
  await memoryManager.close();
  console.log('✅ Memory Manager closed\n');

  console.log('🎉 All examples completed successfully!');
}

// Run examples
main().catch(console.error);

/**
 * Advanced Usage Examples
 */

// Example: Creating a custom memory backend
class CustomMemoryBackend {
  // Implement MemoryBackend interface
  async initialize() { /* ... */ }
  async store(item: MemoryItem) { /* ... */ }
  async get(category: string, key: string) { /* ... */ }
  async query(query: MemoryQuery) { /* ... */ }
  async delete(category: string, key: string) { /* ... */ }
  async update(category: string, key: string, updates: any) { /* ... */ }
  async getStats() { /* ... */ }
  async close() { /* ... */ }
}

// Example: Custom conflict resolution
class CustomConflictResolution {
  async resolve(existing: MemoryItem, incoming: MemoryItem): Promise<MemoryItem> {
    // Custom merge logic
    // For example, merge arrays, combine objects, etc.
    return {
      ...existing,
      ...incoming,
      value: this.deepMerge(existing.value, incoming.value)
    };
  }

  private deepMerge(obj1: any, obj2: any): any {
    // Implementation of deep merge
    return { ...obj1, ...obj2 };
  }
}

// Example: Memory-backed agent coordination
class MemoryCoordinator {
  constructor(private memory: MemoryManager) {}

  async registerAgent(agentId: string, capabilities: string[]) {
    await this.memory.store({
      category: 'coordination',
      key: `agent-${agentId}`,
      value: {
        id: agentId,
        capabilities,
        status: 'active',
        lastHeartbeat: Date.now()
      },
      ttl: 300000 // 5 minutes
    }, 'agent-coordination');
  }

  async getActiveAgents(): Promise<any[]> {
    const agents = await this.memory.query({
      categories: ['coordination'],
      namespace: 'agent-coordination'
    });

    return agents
      .filter(a => a.value.status === 'active')
      .map(a => a.value);
  }

  async assignTask(agentId: string, task: any) {
    await this.memory.store({
      category: 'tasks',
      key: `task-${task.id}`,
      value: {
        ...task,
        assignedTo: agentId,
        status: 'assigned',
        assignedAt: Date.now()
      }
    }, 'agent-coordination');
  }
}