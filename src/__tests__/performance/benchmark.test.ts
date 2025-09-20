/**
 * Performance Benchmark Tests for Claude Flow MCP System
 * Testing performance characteristics, scalability limits, and optimization effectiveness
 */

import { jest } from '@jest/globals';
import { SwarmCoordinator } from '../../swarm/coordinator.js';
import { RealMemoryManager } from '../../memory/real-memory-manager.js';
import { 
  createTempDir, 
  cleanupTempDir, 
  PerformanceMeasure, 
  MemoryTracker,
  StressTestHelper,
  TestConfigBuilder,
  generateTestMemoryData,
  generateTestAgents,
  generateTestTasks
} from '../helpers/test-utils.js';
import path from 'path';

describe('Claude Flow MCP Performance Benchmarks', () => {
  let coordinator: SwarmCoordinator;
  let memoryManager: RealMemoryManager;
  let testDir: string;
  let performanceMeasure: PerformanceMeasure;
  let memoryTracker: MemoryTracker;
  
  beforeAll(async () => {
    testDir = await createTempDir('performance-test');
    performanceMeasure = new PerformanceMeasure();
    memoryTracker = new MemoryTracker();
  });

  afterAll(async () => {
    await cleanupTempDir(testDir);
  });

  beforeEach(async () => {
    const config = new TestConfigBuilder()
      .withMemoryConfig({
        persistenceDir: path.join(testDir, 'memory'),
        sessionId: 'performance-test'
      })
      .withSwarmConfig({
        maxAgents: 20,
        strategy: 'adaptive'
      })
      .withLoggingConfig({
        level: 'error' // Reduce logging overhead in performance tests
      })
      .build();

    memoryManager = new RealMemoryManager(config.memory);
    await memoryManager.initialize();

    coordinator = new SwarmCoordinator({
      ...config.swarm,
      memoryManager,
      logging: config.logging
    });
    await coordinator.initialize();

    performanceMeasure.reset();
    memoryTracker.reset();
  });

  afterEach(async () => {
    if (coordinator) {
      await coordinator.shutdown();
    }
    if (memoryManager) {
      await memoryManager.clearNamespace('default');
    }
  });

  describe('Memory System Performance', () => {
    it('should handle high-volume memory operations efficiently', async () => {
      const operationCount = 1000;
      const batchSize = 50;
      
      performanceMeasure.start('memory-bulk-operations');
      memoryTracker.snapshot();

      // Bulk store operations
      performanceMeasure.start('bulk-store');
      const testData = generateTestMemoryData(operationCount);
      
      for (let i = 0; i < testData.length; i += batchSize) {
        const batch = testData.slice(i, i + batchSize);
        const storePromises = batch.map(data => memoryManager.store(data));
        await Promise.all(storePromises);
        
        if (i % 200 === 0) {
          memoryTracker.snapshot();
        }
      }
      
      const storeTime = performanceMeasure.end('bulk-store');
      console.log(`Bulk store (${operationCount} items): ${storeTime.toFixed(2)}ms`);

      // Bulk retrieve operations
      performanceMeasure.start('bulk-retrieve');
      const retrievePromises = testData.map(data => 
        memoryManager.retrieve(data.key, data.namespace)
      );
      const retrieveResults = await Promise.all(retrievePromises);
      const retrieveTime = performanceMeasure.end('bulk-retrieve');
      
      console.log(`Bulk retrieve (${operationCount} items): ${retrieveTime.toFixed(2)}ms`);

      // Bulk query operations
      performanceMeasure.start('bulk-query');
      const queryResults = await memoryManager.query({
        namespace: 'test',
        limit: operationCount
      });
      const queryTime = performanceMeasure.end('bulk-query');
      
      console.log(`Bulk query (${operationCount} items): ${queryTime.toFixed(2)}ms`);

      const totalTime = performanceMeasure.end('memory-bulk-operations');
      const memoryDelta = memoryTracker.getDelta();

      // Performance assertions
      expect(retrieveResults.length).toBe(operationCount);
      expect(queryResults.results.length).toBe(operationCount);
      
      // Store performance targets
      expect(storeTime / operationCount).toBeLessThan(5); // < 5ms per store
      expect(retrieveTime / operationCount).toBeLessThan(2); // < 2ms per retrieve
      expect(queryTime).toBeLessThan(100); // < 100ms for bulk query
      
      // Memory usage should be reasonable
      expect(memoryDelta.heapUsed).toBeLessThan(100 * 1024 * 1024); // < 100MB
      
      console.log(`Total memory operations: ${totalTime.toFixed(2)}ms`);
      console.log(`Memory delta: ${JSON.stringify(memoryDelta, null, 2)}`);
    });

    it('should demonstrate vector search performance scaling', async () => {
      const documentCounts = [100, 500, 1000, 2000];
      const searchQueries = [
        'machine learning algorithms neural networks',
        'database optimization performance indexing',
        'javascript frontend react components',
        'system architecture microservices scalability'
      ];

      const scalingResults: Array<{
        documentCount: number;
        indexingTime: number;
        searchTime: number;
        resultsCount: number;
      }> = [];

      for (const docCount of documentCounts) {
        performanceMeasure.start(`indexing-${docCount}`);
        
        // Generate documents with rich text content
        const documents = [];
        for (let i = 0; i < docCount; i++) {
          const content = [
            'machine learning algorithms neural networks deep learning',
            'database optimization performance indexing query tuning',
            'javascript frontend react components user interface',
            'system architecture microservices scalability cloud computing'
          ][i % 4];
          
          documents.push({
            key: `doc-${i}`,
            value: {
              title: `Document ${i}`,
              content: `${content} document ${i} specialized content`,
              metadata: { index: i, category: ['ml', 'db', 'fe', 'arch'][i % 4] }
            },
            namespace: 'vector-test',
            tags: ['document', 'vector-search', `doc-${i}`]
          });
        }

        // Store documents (triggers vector indexing)
        const storePromises = documents.map(doc => memoryManager.store(doc));
        await Promise.all(storePromises);
        
        const indexingTime = performanceMeasure.end(`indexing-${docCount}`);

        // Perform vector searches
        performanceMeasure.start(`search-${docCount}`);
        const searchPromises = searchQueries.map(query =>
          memoryManager.query({
            semanticSearch: query,
            namespace: 'vector-test',
            limit: 10
          })
        );
        
        const searchResults = await Promise.all(searchPromises);
        const searchTime = performanceMeasure.end(`search-${docCount}`);
        
        const totalResults = searchResults.reduce((sum, result) => sum + result.results.length, 0);
        
        scalingResults.push({
          documentCount: docCount,
          indexingTime,
          searchTime,
          resultsCount: totalResults
        });

        // Clear for next iteration
        await memoryManager.clearNamespace('vector-test');
      }

      // Analyze scaling characteristics
      console.log('Vector Search Scaling Results:');
      scalingResults.forEach(result => {
        console.log(`${result.documentCount} docs: indexing=${result.indexingTime.toFixed(2)}ms, search=${result.searchTime.toFixed(2)}ms, results=${result.resultsCount}`);
      });

      // Performance assertions
      scalingResults.forEach(result => {
        // Indexing should scale reasonably (not exponentially)
        expect(result.indexingTime / result.documentCount).toBeLessThan(10); // < 10ms per document
        
        // Search should remain fast regardless of collection size
        expect(result.searchTime).toBeLessThan(200); // < 200ms for all searches
        
        // Should return relevant results
        expect(result.resultsCount).toBeGreaterThan(0);
      });

      // Check that search time doesn't increase exponentially
      const firstResult = scalingResults[0];
      const lastResult = scalingResults[scalingResults.length - 1];
      const searchTimeRatio = lastResult.searchTime / firstResult.searchTime;
      
      expect(searchTimeRatio).toBeLessThan(5); // Search time shouldn't increase more than 5x
    });

    it('should handle memory pressure and compression efficiently', async () => {
      const largeItemCount = 100;
      const itemSize = 50 * 1024; // 50KB each
      
      performanceMeasure.start('memory-pressure-test');
      memoryTracker.snapshot();

      // Store large items to trigger compression
      const largeItems = [];
      for (let i = 0; i < largeItemCount; i++) {
        const largeData = {
          key: `large-item-${i}`,
          value: {
            id: i,
            data: 'x'.repeat(itemSize),
            metadata: { size: itemSize, index: i }
          },
          namespace: 'large-data',
          category: 'memory-pressure'
        };
        largeItems.push(largeData);
      }

      // Store items and measure compression
      performanceMeasure.start('compression-store');
      const storePromises = largeItems.map(item => memoryManager.store(item));
      await Promise.all(storePromises);
      const storeTime = performanceMeasure.end('compression-store');

      memoryTracker.snapshot();

      // Trigger maintenance for compression optimization
      performanceMeasure.start('maintenance');
      await memoryManager.performMaintenance();
      const maintenanceTime = performanceMeasure.end('maintenance');

      // Retrieve compressed items
      performanceMeasure.start('compression-retrieve');
      const retrievePromises = largeItems.map(item => 
        memoryManager.retrieve(item.key, item.namespace)
      );
      const retrieveResults = await Promise.all(retrievePromises);
      const retrieveTime = performanceMeasure.end('compression-retrieve');

      const totalTime = performanceMeasure.end('memory-pressure-test');
      const memoryStats = memoryManager.getStats();
      const memoryDelta = memoryTracker.getDelta();

      // Verify compression effectiveness
      expect(retrieveResults.length).toBe(largeItemCount);
      expect(retrieveResults.every(r => r !== null)).toBe(true);
      
      // Compression should be working
      expect(memoryStats.storage.compressionRatio).toBeGreaterThan(0.1);
      
      // Performance should be reasonable despite large data
      expect(storeTime / largeItemCount).toBeLessThan(20); // < 20ms per large item
      expect(retrieveTime / largeItemCount).toBeLessThan(10); // < 10ms per retrieval
      expect(maintenanceTime).toBeLessThan(1000); // < 1s for maintenance
      
      console.log(`Memory pressure test: ${totalTime.toFixed(2)}ms total`);
      console.log(`Compression ratio: ${(memoryStats.storage.compressionRatio * 100).toFixed(1)}%`);
      console.log(`Memory delta: ${(memoryDelta.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    });
  });

  describe('Swarm Coordination Performance', () => {
    it('should handle high-throughput agent spawning and task assignment', async () => {
      const agentCount = 50;
      const taskCount = 200;
      
      performanceMeasure.start('swarm-throughput-test');
      memoryTracker.snapshot();

      // Spawn agents in batches
      performanceMeasure.start('agent-spawning');
      const agentConfigs = generateTestAgents(agentCount);
      const batchSize = 10;
      const spawnedAgents = [];

      for (let i = 0; i < agentConfigs.length; i += batchSize) {
        const batch = agentConfigs.slice(i, i + batchSize);
        const spawnPromises = batch.map(config => coordinator.spawnAgent(config));
        const batchResults = await Promise.all(spawnPromises);
        spawnedAgents.push(...batchResults);
        
        memoryTracker.snapshot();
      }
      
      const spawnTime = performanceMeasure.end('agent-spawning');
      console.log(`Agent spawning (${agentCount} agents): ${spawnTime.toFixed(2)}ms`);

      // Generate and queue tasks
      performanceMeasure.start('task-queuing');
      const taskConfigs = generateTestTasks(taskCount);
      const queuePromises = taskConfigs.map(task => coordinator.queueTask(task));
      await Promise.all(queuePromises);
      const queueTime = performanceMeasure.end('task-queuing');
      
      console.log(`Task queuing (${taskCount} tasks): ${queueTime.toFixed(2)}ms`);

      // Measure assignment performance
      performanceMeasure.start('task-assignment');
      const assignmentPromises = [];
      const tasks = await coordinator.listTasks();
      
      for (let i = 0; i < Math.min(tasks.length, spawnedAgents.length * 2); i++) {
        const task = tasks[i];
        const agent = spawnedAgents[i % spawnedAgents.length];
        assignmentPromises.push(coordinator.assignTask(agent, task));
      }
      
      await Promise.all(assignmentPromises);
      const assignmentTime = performanceMeasure.end('task-assignment');
      
      console.log(`Task assignment: ${assignmentTime.toFixed(2)}ms`);

      const totalTime = performanceMeasure.end('swarm-throughput-test');
      const swarmMetrics = await coordinator.getMetrics();
      const memoryDelta = memoryTracker.getDelta();

      // Performance assertions
      expect(spawnedAgents.length).toBe(agentCount);
      expect(swarmMetrics.totalTasks).toBe(taskCount);
      
      // Performance targets
      expect(spawnTime / agentCount).toBeLessThan(50); // < 50ms per agent
      expect(queueTime / taskCount).toBeLessThan(5); // < 5ms per task
      expect(assignmentTime / assignmentPromises.length).toBeLessThan(10); // < 10ms per assignment
      
      // Memory usage should be reasonable
      expect(memoryDelta.heapUsed).toBeLessThan(200 * 1024 * 1024); // < 200MB
      
      console.log(`Swarm throughput test: ${totalTime.toFixed(2)}ms total`);
      console.log(`Final metrics: ${JSON.stringify(swarmMetrics, null, 2)}`);
    });

    it('should demonstrate coordination efficiency under different strategies', async () => {
      const strategies = ['adaptive', 'parallel', 'sequential'] as const;
      const taskCount = 50;
      const agentCount = 10;
      
      const strategyResults: Array<{
        strategy: string;
        setupTime: number;
        coordinationTime: number;
        throughput: number;
        memoryUsage: number;
      }> = [];

      for (const strategy of strategies) {
        await coordinator.shutdown();
        
        performanceMeasure.start(`${strategy}-setup`);
        memoryTracker.reset();
        
        coordinator = new SwarmCoordinator({
          mode: 'distributed',
          strategy,
          maxAgents: agentCount + 5,
          topology: 'mesh',
          memoryManager,
          logging: { level: 'error' }
        });
        await coordinator.initialize();
        
        // Spawn agents
        const agents = [];
        for (let i = 0; i < agentCount; i++) {
          const agentId = await coordinator.spawnAgent({
            type: ['coder', 'tester', 'researcher'][i % 3] as any,
            name: `${strategy}-agent-${i}`
          });
          agents.push(agentId);
        }
        
        const setupTime = performanceMeasure.end(`${strategy}-setup`);
        memoryTracker.snapshot();

        // Coordinate tasks
        performanceMeasure.start(`${strategy}-coordination`);
        const startTime = Date.now();
        
        // Queue tasks
        const tasks = [];
        for (let i = 0; i < taskCount; i++) {
          const task = {
            id: `${strategy}-task-${i}`,
            type: ['code', 'test', 'research'][i % 3] as any,
            description: `${strategy} strategy task ${i}`,
            priority: ['low', 'medium', 'high'][i % 3] as any,
            estimatedDuration: 1000 + (i * 100)
          };
          tasks.push(task);
          await coordinator.queueTask(task);
        }

        // Let strategy coordinate assignments
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const coordinationTime = performanceMeasure.end(`${strategy}-coordination`);
        const actualDuration = Date.now() - startTime;
        const throughput = taskCount / (actualDuration / 1000); // tasks per second
        
        const finalMemory = memoryTracker.snapshot();
        const memoryDelta = memoryTracker.getDelta();

        strategyResults.push({
          strategy,
          setupTime,
          coordinationTime,
          throughput,
          memoryUsage: memoryDelta.heapUsed
        });

        console.log(`${strategy} strategy: setup=${setupTime.toFixed(2)}ms, coordination=${coordinationTime.toFixed(2)}ms, throughput=${throughput.toFixed(2)} tasks/s`);
      }

      // Analyze strategy performance
      console.log('\nStrategy Performance Comparison:');
      strategyResults.forEach(result => {
        console.log(`${result.strategy}: ${result.coordinationTime.toFixed(2)}ms coordination, ${result.throughput.toFixed(2)} tasks/s, ${(result.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
      });

      // Performance assertions
      strategyResults.forEach(result => {
        expect(result.setupTime).toBeLessThan(5000); // < 5s setup
        expect(result.coordinationTime).toBeLessThan(2000); // < 2s coordination
        expect(result.throughput).toBeGreaterThan(10); // > 10 tasks/s
        expect(result.memoryUsage).toBeLessThan(100 * 1024 * 1024); // < 100MB
      });

      // Adaptive should generally perform well
      const adaptiveResult = strategyResults.find(r => r.strategy === 'adaptive');
      expect(adaptiveResult?.throughput).toBeGreaterThan(20); // Adaptive should be efficient
    });

    it('should handle concurrent swarm operations stress test', async () => {
      const stressTest = new StressTestHelper()
        .setConcurrency(20)
        .setDuration(30000); // 30 seconds

      // Add various swarm operations
      stressTest
        .addOperation(async () => {
          const agentId = await coordinator.spawnAgent({
            type: ['coder', 'tester'][Math.floor(Math.random() * 2)] as any,
            name: `stress-agent-${Date.now()}`
          });
          return agentId;
        })
        .addOperation(async () => {
          const task = {
            id: `stress-task-${Date.now()}-${Math.random()}`,
            type: 'code' as const,
            description: 'Stress test task',
            priority: 'medium' as const
          };
          await coordinator.queueTask(task);
          return task.id;
        })
        .addOperation(async () => {
          const agents = await coordinator.listAgents();
          return agents.length;
        })
        .addOperation(async () => {
          const tasks = await coordinator.listTasks();
          return tasks.length;
        })
        .addOperation(async () => {
          const metrics = await coordinator.getMetrics();
          return metrics.totalTasks;
        });

      performanceMeasure.start('stress-test');
      memoryTracker.reset();
      
      const results = await stressTest.run();
      
      const stressTime = performanceMeasure.end('stress-test');
      const memoryDelta = memoryTracker.getDelta();

      console.log('Stress Test Results:');
      console.log(`Total operations: ${results.totalOperations}`);
      console.log(`Successful operations: ${results.successfulOperations}`);
      console.log(`Failed operations: ${results.failedOperations}`);
      console.log(`Average latency: ${results.averageLatency.toFixed(2)}ms`);
      console.log(`Operations per second: ${results.operationsPerSecond.toFixed(2)}`);
      console.log(`Error count: ${results.errors.length}`);
      console.log(`Memory delta: ${(memoryDelta.heapUsed / 1024 / 1024).toFixed(2)}MB`);

      // Stress test assertions
      expect(results.totalOperations).toBeGreaterThan(1000); // Should handle many operations
      expect(results.successfulOperations / results.totalOperations).toBeGreaterThan(0.95); // > 95% success rate
      expect(results.averageLatency).toBeLessThan(100); // < 100ms average latency
      expect(results.operationsPerSecond).toBeGreaterThan(50); // > 50 ops/sec
      expect(results.errors.length / results.totalOperations).toBeLessThan(0.05); // < 5% error rate
      
      // Memory should not grow excessively
      expect(memoryDelta.heapUsed).toBeLessThan(500 * 1024 * 1024); // < 500MB
    });
  });

  describe('Integrated System Performance', () => {
    it('should demonstrate end-to-end workflow performance', async () => {
      const workflowSize = {
        agents: 15,
        tasks: 75,
        memories: 200,
        phases: 5
      };
      
      performanceMeasure.start('e2e-workflow');
      memoryTracker.reset();

      // Phase 1: Setup and initialization
      performanceMeasure.start('phase-1-setup');
      
      // Store workflow context in memory
      const workflowContext = {
        id: 'performance-workflow',
        objective: 'Test end-to-end performance',
        phases: Array.from({ length: workflowSize.phases }, (_, i) => ({
          id: `phase-${i}`,
          name: `Performance Phase ${i}`,
          tasks: workflowSize.tasks / workflowSize.phases
        }))
      };
      
      await memoryManager.store({
        key: 'workflow-context',
        value: workflowContext,
        namespace: 'workflow',
        tags: ['performance', 'e2e']
      });
      
      const setupTime = performanceMeasure.end('phase-1-setup');
      memoryTracker.snapshot();

      // Phase 2: Agent spawning
      performanceMeasure.start('phase-2-agents');
      
      const agents = [];
      const agentTypes = ['coder', 'tester', 'researcher', 'analyst', 'coordinator'] as const;
      
      for (let i = 0; i < workflowSize.agents; i++) {
        const agentId = await coordinator.spawnAgent({
          type: agentTypes[i % agentTypes.length],
          name: `performance-agent-${i}`,
          capabilities: ['performance-testing', agentTypes[i % agentTypes.length]]
        });
        agents.push(agentId);
        
        // Store agent info in memory
        await memoryManager.store({
          key: `agent-${agentId}`,
          value: { id: agentId, type: agentTypes[i % agentTypes.length], spawned: Date.now() },
          namespace: 'agents',
          tags: ['performance', 'workflow-agent']
        });
      }
      
      const agentTime = performanceMeasure.end('phase-2-agents');
      memoryTracker.snapshot();

      // Phase 3: Memory operations
      performanceMeasure.start('phase-3-memory');
      
      const memoryData = generateTestMemoryData(workflowSize.memories);
      const memoryPromises = memoryData.map(data => memoryManager.store({
        ...data,
        namespace: 'workflow-data',
        tags: [...data.tags, 'performance', 'workflow']
      }));
      
      await Promise.all(memoryPromises);
      
      const memoryTime = performanceMeasure.end('phase-3-memory');
      memoryTracker.snapshot();

      // Phase 4: Task coordination
      performanceMeasure.start('phase-4-tasks');
      
      const taskPromises = [];
      for (let i = 0; i < workflowSize.tasks; i++) {
        const task = {
          id: `performance-task-${i}`,
          type: agentTypes[i % agentTypes.length] as any,
          description: `Performance workflow task ${i}`,
          priority: ['low', 'medium', 'high'][i % 3] as any,
          estimatedDuration: 1000 + (i * 50),
          metadata: {
            workflow: 'performance-workflow',
            phase: Math.floor(i / (workflowSize.tasks / workflowSize.phases))
          }
        };
        
        taskPromises.push(coordinator.queueTask(task));
      }
      
      await Promise.all(taskPromises);
      
      // Assign tasks to agents
      const tasks = await coordinator.listTasks();
      const assignmentPromises = tasks.slice(0, agents.length * 2).map((task, index) => {
        const agent = agents[index % agents.length];
        return coordinator.assignTask(agent, task);
      });
      
      await Promise.all(assignmentPromises);
      
      const taskTime = performanceMeasure.end('phase-4-tasks');
      memoryTracker.snapshot();

      // Phase 5: Queries and analysis
      performanceMeasure.start('phase-5-analysis');
      
      // Perform various analysis queries
      const analysisPromises = [
        memoryManager.query({ namespace: 'workflow-data', limit: 50 }),
        memoryManager.query({ namespace: 'agents', tags: ['workflow-agent'] }),
        memoryManager.query({ semanticSearch: 'performance testing workflow', limit: 20 }),
        coordinator.getMetrics(),
        coordinator.listAgents(),
        coordinator.listTasks({ sortBy: 'priority' })
      ];
      
      const analysisResults = await Promise.all(analysisPromises);
      
      const analysisTime = performanceMeasure.end('phase-5-analysis');
      
      const totalTime = performanceMeasure.end('e2e-workflow');
      const finalMemory = memoryTracker.getDelta();
      const swarmMetrics = await coordinator.getMetrics();
      const memoryStats = memoryManager.getStats();

      // Performance reporting
      console.log('\nEnd-to-End Workflow Performance:');
      console.log(`Setup: ${setupTime.toFixed(2)}ms`);
      console.log(`Agent spawning: ${agentTime.toFixed(2)}ms (${workflowSize.agents} agents)`);
      console.log(`Memory operations: ${memoryTime.toFixed(2)}ms (${workflowSize.memories} items)`);
      console.log(`Task coordination: ${taskTime.toFixed(2)}ms (${workflowSize.tasks} tasks)`);
      console.log(`Analysis queries: ${analysisTime.toFixed(2)}ms`);
      console.log(`Total workflow: ${totalTime.toFixed(2)}ms`);
      console.log(`Memory usage: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

      // Performance assertions
      expect(agents.length).toBe(workflowSize.agents);
      expect(swarmMetrics.totalTasks).toBe(workflowSize.tasks);
      expect(memoryStats.storage.totalMemories).toBeGreaterThan(workflowSize.memories);
      
      // Performance targets for integrated workflow
      expect(totalTime).toBeLessThan(30000); // < 30 seconds total
      expect(agentTime / workflowSize.agents).toBeLessThan(100); // < 100ms per agent
      expect(memoryTime / workflowSize.memories).toBeLessThan(20); // < 20ms per memory item
      expect(taskTime / workflowSize.tasks).toBeLessThan(50); // < 50ms per task
      expect(analysisTime).toBeLessThan(1000); // < 1s for analysis
      
      // Memory efficiency
      expect(finalMemory.heapUsed).toBeLessThan(300 * 1024 * 1024); // < 300MB
      expect(memoryStats.performance.averageRetrievalTime).toBeLessThan(10); // < 10ms avg retrieval
      
      // System stability
      expect(analysisResults.every(result => result !== null)).toBe(true);
      expect(swarmMetrics.activeAgents).toBe(workflowSize.agents);
    });

    it('should validate performance regression thresholds', async () => {
      // Define performance baselines (these would be updated as system improves)
      const performanceBaselines = {
        memoryStore: 5, // ms per operation
        memoryRetrieve: 2, // ms per operation
        memoryQuery: 100, // ms for 1000 items
        vectorSearch: 50, // ms for semantic search
        agentSpawn: 50, // ms per agent
        taskQueue: 5, // ms per task
        taskAssign: 10, // ms per assignment
        memoryUsagePerOperation: 1024, // bytes per operation
        maxMemoryGrowth: 100 * 1024 * 1024 // 100MB max growth
      };

      const testScale = {
        memoryOperations: 500,
        agents: 20,
        tasks: 100
      };

      const regressionResults: Record<string, { actual: number; baseline: number; passed: boolean }> = {};

      // Test memory operations
      performanceMeasure.start('regression-memory-store');
      const memoryData = generateTestMemoryData(testScale.memoryOperations);
      for (const data of memoryData) {
        await memoryManager.store(data);
      }
      const memoryStoreTime = performanceMeasure.end('regression-memory-store');
      const memoryStoreAvg = memoryStoreTime / testScale.memoryOperations;
      
      regressionResults.memoryStore = {
        actual: memoryStoreAvg,
        baseline: performanceBaselines.memoryStore,
        passed: memoryStoreAvg <= performanceBaselines.memoryStore
      };

      // Test memory retrieval
      performanceMeasure.start('regression-memory-retrieve');
      for (const data of memoryData.slice(0, 100)) {
        await memoryManager.retrieve(data.key, data.namespace);
      }
      const memoryRetrieveTime = performanceMeasure.end('regression-memory-retrieve');
      const memoryRetrieveAvg = memoryRetrieveTime / 100;
      
      regressionResults.memoryRetrieve = {
        actual: memoryRetrieveAvg,
        baseline: performanceBaselines.memoryRetrieve,
        passed: memoryRetrieveAvg <= performanceBaselines.memoryRetrieve
      };

      // Test vector search
      performanceMeasure.start('regression-vector-search');
      await memoryManager.query({
        semanticSearch: 'test data generated content',
        namespace: 'test',
        limit: 20
      });
      const vectorSearchTime = performanceMeasure.end('regression-vector-search');
      
      regressionResults.vectorSearch = {
        actual: vectorSearchTime,
        baseline: performanceBaselines.vectorSearch,
        passed: vectorSearchTime <= performanceBaselines.vectorSearch
      };

      // Test agent spawning
      performanceMeasure.start('regression-agent-spawn');
      const agents = [];
      for (let i = 0; i < testScale.agents; i++) {
        const agentId = await coordinator.spawnAgent({
          type: ['coder', 'tester'][i % 2] as any,
          name: `regression-agent-${i}`
        });
        agents.push(agentId);
      }
      const agentSpawnTime = performanceMeasure.end('regression-agent-spawn');
      const agentSpawnAvg = agentSpawnTime / testScale.agents;
      
      regressionResults.agentSpawn = {
        actual: agentSpawnAvg,
        baseline: performanceBaselines.agentSpawn,
        passed: agentSpawnAvg <= performanceBaselines.agentSpawn
      };

      // Test task operations
      performanceMeasure.start('regression-task-queue');
      const tasks = generateTestTasks(testScale.tasks);
      for (const task of tasks) {
        await coordinator.queueTask(task);
      }
      const taskQueueTime = performanceMeasure.end('regression-task-queue');
      const taskQueueAvg = taskQueueTime / testScale.tasks;
      
      regressionResults.taskQueue = {
        actual: taskQueueAvg,
        baseline: performanceBaselines.taskQueue,
        passed: taskQueueAvg <= performanceBaselines.taskQueue
      };

      // Generate regression report
      console.log('\n🚨 Performance Regression Test Results:');
      let passedCount = 0;
      let totalCount = 0;

      for (const [metric, result] of Object.entries(regressionResults)) {
        totalCount++;
        if (result.passed) passedCount++;
        
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        const improvement = result.actual < result.baseline ? 
          `(${(((result.baseline - result.actual) / result.baseline) * 100).toFixed(1)}% faster)` : 
          `(${(((result.actual - result.baseline) / result.baseline) * 100).toFixed(1)}% slower)`;
        
        console.log(`${status} ${metric}: ${result.actual.toFixed(2)}ms vs ${result.baseline}ms baseline ${improvement}`);
      }

      console.log(`\nOverall: ${passedCount}/${totalCount} tests passed (${((passedCount/totalCount)*100).toFixed(1)}%)`);

      // Memory usage check
      const memoryStats = memoryManager.getStats();
      const memoryGrowth = memoryStats.storage.totalSize;
      const memoryWithinLimits = memoryGrowth <= performanceBaselines.maxMemoryGrowth;
      
      console.log(`Memory usage: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB ${memoryWithinLimits ? '✅' : '❌'}`);

      // Assertions for regression test
      expect(passedCount / totalCount).toBeGreaterThan(0.8); // At least 80% of tests should pass
      expect(memoryWithinLimits).toBe(true);
      
      // Critical metrics should never regress significantly
      expect(regressionResults.memoryStore.actual).toBeLessThan(performanceBaselines.memoryStore * 2);
      expect(regressionResults.vectorSearch.actual).toBeLessThan(performanceBaselines.vectorSearch * 2);
      expect(regressionResults.agentSpawn.actual).toBeLessThan(performanceBaselines.agentSpawn * 2);
    });
  });
});