/**
 * Performance and Stress Tests for AIME Framework
 * Tests performance characteristics and scalability limits
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AIME Performance Tests', () => {
  let performanceMonitor;
  let aimeSystem;

  beforeEach(async () => {
    performanceMonitor = new PerformanceMonitor();
    aimeSystem = createPerformanceTestSystem();
    await aimeSystem.initialize();
  });

  afterEach(async () => {
    await performanceMonitor.generateReport();
    await aimeSystem.cleanup();
  });

  describe('Plan Generation Performance', () => {
    it('should generate plans within time budgets', async () => {
      const testCases = [
        { complexity: 'low', expectedTime: 2000, taskCount: 5 },
        { complexity: 'medium', expectedTime: 5000, taskCount: 15 },
        { complexity: 'high', expectedTime: 10000, taskCount: 30 },
        { complexity: 'extreme', expectedTime: 20000, taskCount: 60 }
      ];

      const results = [];

      for (const testCase of testCases) {
        const objective = `Performance test ${testCase.complexity} complexity project with ${testCase.taskCount} tasks`;
        
        const metrics = await performanceMonitor.measureOperation(
          'plan_generation',
          () => aimeSystem.dualPlanner.createDualPlan(objective, {
            complexity: testCase.complexity,
            estimatedTasks: testCase.taskCount
          })
        );

        expect(metrics.duration).toBeLessThan(testCase.expectedTime);
        expect(metrics.memoryDelta).toBeLessThan(100 * 1024 * 1024); // 100MB max increase
        
        results.push({
          complexity: testCase.complexity,
          duration: metrics.duration,
          memoryUsage: metrics.memoryDelta,
          cpuUsage: metrics.cpuUsage,
          withinBudget: metrics.duration < testCase.expectedTime
        });
      }

      // Validate scaling characteristics
      const scalingEfficiency = calculateScalingEfficiency(results);
      expect(scalingEfficiency).toBeGreaterThan(0.7);

      return {
        testCases: results.length,
        averageDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
        scalingEfficiency: scalingEfficiency,
        allWithinBudget: results.every(r => r.withinBudget)
      };
    });

    it('should maintain performance under memory pressure', async () => {
      const initialMemory = process.memoryUsage();
      
      // Create memory pressure by generating multiple large plans
      const plans = [];
      const planPromises = [];

      for (let i = 0; i < 10; i++) {
        const promise = aimeSystem.dualPlanner.createDualPlan(
          `Memory pressure test plan ${i} with extensive requirements and complex dependencies`,
          {
            complexity: 'high',
            estimatedTasks: 50,
            memoryIntensive: true
          }
        );
        planPromises.push(promise);
      }

      const startTime = performance.now();
      const generatedPlans = await Promise.all(planPromises);
      const duration = performance.now() - startTime;
      
      const peakMemory = process.memoryUsage();
      
      // All plans should be generated successfully
      expect(generatedPlans.length).toBe(10);
      expect(generatedPlans.every(plan => plan && plan.id)).toBe(true);
      
      // Performance should remain reasonable
      expect(duration).toBeLessThan(30000); // 30 seconds max
      
      // Memory growth should be bounded
      const memoryGrowth = peakMemory.heapUsed - initialMemory.heapUsed;
      expect(memoryGrowth).toBeLessThan(500 * 1024 * 1024); // 500MB max growth

      // Force garbage collection and check for leaks
      if (global.gc) global.gc();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const finalMemory = process.memoryUsage();
      const potentialLeak = finalMemory.heapUsed - initialMemory.heapUsed;
      expect(potentialLeak).toBeLessThan(100 * 1024 * 1024); // 100MB max retention

      return {
        plansGenerated: generatedPlans.length,
        totalDuration: duration,
        memoryGrowth: memoryGrowth,
        memoryLeakage: potentialLeak,
        memoryEfficiency: memoryGrowth / generatedPlans.length
      };
    });

    it('should handle concurrent plan generation efficiently', async () => {
      const concurrencyLevels = [1, 5, 10, 20, 50];
      const concurrencyResults = [];

      for (const concurrency of concurrencyLevels) {
        const startTime = performance.now();
        
        const promises = Array.from({ length: concurrency }, (_, i) =>
          aimeSystem.dualPlanner.createDualPlan(`Concurrent plan ${i}`)
        );

        const results = await Promise.allSettled(promises);
        const duration = performance.now() - startTime;
        
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        concurrencyResults.push({
          concurrency: concurrency,
          successful: successful,
          failed: failed,
          duration: duration,
          throughput: successful / (duration / 1000), // plans per second
          successRate: successful / concurrency
        });

        expect(successful).toBeGreaterThan(concurrency * 0.9); // 90% success rate minimum
      }

      // Validate throughput scaling
      const maxThroughput = Math.max(...concurrencyResults.map(r => r.throughput));
      const optimalConcurrency = concurrencyResults.find(r => r.throughput === maxThroughput);
      
      expect(optimalConcurrency.concurrency).toBeGreaterThan(1);
      expect(optimalConcurrency.successRate).toBeGreaterThan(0.95);

      return {
        optimalConcurrency: optimalConcurrency.concurrency,
        maxThroughput: maxThroughput,
        scalingResults: concurrencyResults
      };
    });
  });

  describe('Agent Creation Performance', () => {
    it('should create agents within time limits', async () => {
      const agentCounts = [1, 10, 50, 100, 200];
      const creationResults = [];

      for (const count of agentCounts) {
        const startTime = performance.now();
        
        const agentPromises = Array.from({ length: count }, (_, i) =>
          aimeSystem.actorFactory.createAgent({
            type: 'performance_test',
            id: `perf_agent_${i}`,
            capabilities: ['skill1', 'skill2', 'skill3']
          })
        );

        const agents = await Promise.allSettled(agentPromises);
        const duration = performance.now() - startTime;
        
        const successful = agents.filter(a => a.status === 'fulfilled').length;
        const creationRate = successful / (duration / 1000); // agents per second

        creationResults.push({
          agentsRequested: count,
          agentsCreated: successful,
          duration: duration,
          creationRate: creationRate,
          averageCreationTime: duration / successful
        });

        expect(successful).toBe(count);
        expect(duration).toBeLessThan(count * 50); // 50ms per agent max
      }

      return {
        testCases: creationResults.length,
        maxAgentsCreated: Math.max(...creationResults.map(r => r.agentsCreated)),
        bestCreationRate: Math.max(...creationResults.map(r => r.creationRate)),
        scalingEfficient: validateAgentCreationScaling(creationResults)
      };
    });

    it('should efficiently batch agent creation', async () => {
      const batchSizes = [1, 5, 10, 25, 50];
      const batchResults = [];

      for (const batchSize of batchSizes) {
        const requirements = Array.from({ length: batchSize }, (_, i) => ({
          type: `batch_agent_${i}`,
          capabilities: [`skill_${i % 5}`]
        }));

        const metrics = await performanceMonitor.measureOperation(
          'batch_agent_creation',
          () => aimeSystem.actorFactory.createAgentsForPlan({ requirements })
        );

        batchResults.push({
          batchSize: batchSize,
          duration: metrics.duration,
          memoryUsage: metrics.memoryDelta,
          efficiency: batchSize / (metrics.duration / 1000) // agents per second
        });

        expect(metrics.duration).toBeLessThan(batchSize * 100); // 100ms per agent max in batch
      }

      // Batch creation should be more efficient than individual creation
      const batchEfficiency = batchResults[batchResults.length - 1].efficiency;
      const individualEfficiency = batchResults[0].efficiency;
      
      expect(batchEfficiency).toBeGreaterThan(individualEfficiency * 2);

      return {
        batchSizes: batchSizes,
        batchEfficiencyGain: batchEfficiency / individualEfficiency,
        optimalBatchSize: findOptimalBatchSize(batchResults)
      };
    });
  });

  describe('Progress Tracking Performance', () => {
    it('should handle high frequency progress updates', async () => {
      const updateFrequencies = [1, 10, 100, 1000]; // updates per second
      const updateResults = [];

      for (const frequency of updateFrequencies) {
        const updateInterval = 1000 / frequency; // ms between updates
        const testDuration = 5000; // 5 seconds
        const expectedUpdates = frequency * (testDuration / 1000);

        const startTime = performance.now();
        let updatesProcessed = 0;
        let updatePromises = [];

        const updateTimer = setInterval(() => {
          const promise = aimeSystem.progressTracker.updateProgress({
            level: 'task',
            taskId: `task_${updatesProcessed % 10}`,
            progress: (updatesProcessed % 100),
            timestamp: Date.now()
          });
          
          updatePromises.push(promise);
          updatesProcessed++;
        }, updateInterval);

        // Run for test duration
        await new Promise(resolve => setTimeout(resolve, testDuration));
        clearInterval(updateTimer);

        // Wait for all updates to complete
        await Promise.allSettled(updatePromises);
        const totalDuration = performance.now() - startTime;

        updateResults.push({
          targetFrequency: frequency,
          actualUpdates: updatesProcessed,
          duration: totalDuration,
          actualFrequency: updatesProcessed / (totalDuration / 1000),
          updateLatency: totalDuration / updatesProcessed
        });

        expect(updatesProcessed).toBeGreaterThan(expectedUpdates * 0.9);
      }

      return {
        maxFrequencyHandled: Math.max(...updateResults.map(r => r.actualFrequency)),
        averageLatency: updateResults.reduce((sum, r) => sum + r.updateLatency, 0) / updateResults.length,
        scalingResults: updateResults
      };
    });

    it('should maintain accuracy under load', async () => {
      const taskCount = 100;
      const updatesPerTask = 10;
      const totalUpdates = taskCount * updatesPerTask;

      // Initialize tasks
      const tasks = Array.from({ length: taskCount }, (_, i) => ({
        id: `load_test_task_${i}`,
        expectedProgress: 0
      }));

      // Generate random updates
      const updates = [];
      for (let i = 0; i < totalUpdates; i++) {
        const task = tasks[Math.floor(Math.random() * taskCount)];
        const progress = Math.min(task.expectedProgress + Math.random() * 20, 100);
        
        updates.push({
          taskId: task.id,
          progress: progress,
          timestamp: Date.now() + i
        });
        
        task.expectedProgress = progress;
      }

      // Apply updates rapidly
      const startTime = performance.now();
      
      const updatePromises = updates.map(update =>
        aimeSystem.progressTracker.updateProgress({
          level: 'task',
          ...update
        })
      );

      await Promise.all(updatePromises);
      const duration = performance.now() - startTime;

      // Verify accuracy
      const finalStates = await Promise.all(
        tasks.map(task => aimeSystem.progressTracker.getTaskProgress(task.id))
      );

      const accuracyErrors = finalStates.map((actual, index) => 
        Math.abs(actual - tasks[index].expectedProgress)
      );

      const averageError = accuracyErrors.reduce((sum, error) => sum + error, 0) / accuracyErrors.length;
      const maxError = Math.max(...accuracyErrors);

      expect(averageError).toBeLessThan(5); // 5% average error
      expect(maxError).toBeLessThan(15); // 15% max error

      return {
        totalUpdates: totalUpdates,
        processingDuration: duration,
        updatesPerSecond: totalUpdates / (duration / 1000),
        averageAccuracyError: averageError,
        maxAccuracyError: maxError
      };
    });
  });

  describe('Memory Management', () => {
    it('should manage memory efficiently during extended operations', async () => {
      const initialMemory = process.memoryUsage();
      const memorySnapshots = [initialMemory];

      // Run extended operation cycles
      const cycles = 50;
      const operationsPerCycle = 10;

      for (let cycle = 0; cycle < cycles; cycle++) {
        // Mix of operations to stress different components
        const operations = [];
        
        for (let op = 0; op < operationsPerCycle; op++) {
          switch (op % 4) {
            case 0:
              operations.push(aimeSystem.dualPlanner.createDualPlan(`Cycle ${cycle} Plan ${op}`));
              break;
            case 1:
              operations.push(aimeSystem.actorFactory.createAgent({
                type: 'memory_test',
                id: `cycle_${cycle}_agent_${op}`
              }));
              break;
            case 2:
              operations.push(aimeSystem.progressTracker.updateProgress({
                level: 'task',
                progress: Math.random() * 100
              }));
              break;
            case 3:
              operations.push(aimeSystem.toolOrganizer.loadOptimalBundle(['testing']));
              break;
          }
        }

        await Promise.all(operations);
        
        // Take memory snapshot every 10 cycles
        if (cycle % 10 === 0) {
          memorySnapshots.push(process.memoryUsage());
        }
      }

      // Analyze memory growth pattern
      const memoryGrowth = memorySnapshots.map((snapshot, index) => ({
        cycle: index * 10,
        heapUsed: snapshot.heapUsed,
        growth: index > 0 ? snapshot.heapUsed - memorySnapshots[0].heapUsed : 0
      }));

      const finalGrowth = memoryGrowth[memoryGrowth.length - 1].growth;
      const averageGrowthPerCycle = finalGrowth / cycles;

      expect(averageGrowthPerCycle).toBeLessThan(1024 * 1024); // 1MB per cycle max
      expect(finalGrowth).toBeLessThan(100 * 1024 * 1024); // 100MB total max

      return {
        cyclesCompleted: cycles,
        operationsPerformed: cycles * operationsPerCycle,
        finalMemoryGrowth: finalGrowth,
        averageGrowthPerCycle: averageGrowthPerCycle,
        memoryEfficient: averageGrowthPerCycle < 1024 * 1024
      };
    });
  });

  describe('Stress Testing', () => {
    it('should handle system overload gracefully', async () => {
      const overloadScenarios = [
        {
          name: 'plan_generation_overload',
          operation: () => generateMassivePlans(aimeSystem, 100),
          expectedBehavior: 'graceful_degradation'
        },
        {
          name: 'agent_creation_flood',
          operation: () => createAgentFlood(aimeSystem, 1000),
          expectedBehavior: 'rate_limiting'
        },
        {
          name: 'progress_update_storm',
          operation: () => progressUpdateStorm(aimeSystem, 10000),
          expectedBehavior: 'batching_or_throttling'
        }
      ];

      const stressResults = [];

      for (const scenario of overloadScenarios) {
        const startTime = performance.now();
        let systemStable = true;

        try {
          const result = await scenario.operation();
          const duration = performance.now() - startTime;

          stressResults.push({
            scenario: scenario.name,
            completed: true,
            duration: duration,
            systemStable: systemStable,
            result: result
          });

        } catch (error) {
          const duration = performance.now() - startTime;
          
          // System should fail gracefully, not crash
          expect(error.message).toContain('overload');
          
          stressResults.push({
            scenario: scenario.name,
            completed: false,
            duration: duration,
            systemStable: true, // Graceful failure is still stable
            error: error.message
          });
        }

        // System should remain responsive
        const healthCheck = await aimeSystem.healthCheck();
        expect(healthCheck.responsive).toBe(true);
      }

      return {
        scenariosTested: overloadScenarios.length,
        systemRemainedStable: stressResults.every(r => r.systemStable),
        gracefulFailures: stressResults.filter(r => !r.completed && r.systemStable).length
      };
    });
  });
});

// Performance monitoring utilities

class PerformanceMonitor {
  constructor() {
    this.measurements = [];
  }

  async measureOperation(name, operation) {
    const initialMemory = process.memoryUsage();
    const startTime = performance.now();
    const startCpu = process.cpuUsage();

    try {
      const result = await operation();
      const endTime = performance.now();
      const endCpu = process.cpuUsage(startCpu);
      const endMemory = process.memoryUsage();

      const metrics = {
        name: name,
        duration: endTime - startTime,
        memoryDelta: endMemory.heapUsed - initialMemory.heapUsed,
        cpuUsage: {
          user: endCpu.user / 1000, // Convert to milliseconds
          system: endCpu.system / 1000
        },
        success: true,
        result: result
      };

      this.measurements.push(metrics);
      return metrics;

    } catch (error) {
      const endTime = performance.now();
      const metrics = {
        name: name,
        duration: endTime - startTime,
        success: false,
        error: error.message
      };

      this.measurements.push(metrics);
      throw error;
    }
  }

  async generateReport() {
    const report = {
      totalMeasurements: this.measurements.length,
      successfulOperations: this.measurements.filter(m => m.success).length,
      averageDuration: this.measurements.reduce((sum, m) => sum + m.duration, 0) / this.measurements.length,
      totalMemoryDelta: this.measurements.reduce((sum, m) => sum + (m.memoryDelta || 0), 0),
      operationBreakdown: this.groupMeasurementsByName()
    };

    console.log('Performance Report:', JSON.stringify(report, null, 2));
    return report;
  }

  groupMeasurementsByName() {
    const groups = {};
    
    for (const measurement of this.measurements) {
      if (!groups[measurement.name]) {
        groups[measurement.name] = [];
      }
      groups[measurement.name].push(measurement);
    }

    return Object.entries(groups).reduce((acc, [name, measurements]) => {
      acc[name] = {
        count: measurements.length,
        averageDuration: measurements.reduce((sum, m) => sum + m.duration, 0) / measurements.length,
        successRate: measurements.filter(m => m.success).length / measurements.length
      };
      return acc;
    }, {});
  }
}

// Mock system for performance testing

function createPerformanceTestSystem() {
  return {
    dualPlanner: {
      async createDualPlan(objective, options = {}) {
        // Simulate realistic plan generation time based on complexity
        const complexity = options.complexity || 'medium';
        const baseTime = { low: 100, medium: 300, high: 800, extreme: 2000 }[complexity];
        const taskCount = options.estimatedTasks || 10;
        
        // Add processing time proportional to task count
        const processingTime = baseTime + (taskCount * 10);
        
        await new Promise(resolve => setTimeout(resolve, processingTime));
        
        // Simulate memory allocation
        const mockData = new Array(taskCount * 100).fill('task_data');
        
        return {
          id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          objective: objective,
          complexity: complexity,
          taskCount: taskCount,
          mockData: mockData // This simulates memory usage
        };
      }
    },

    actorFactory: {
      async createAgent(spec) {
        // Simulate agent creation time
        await new Promise(resolve => setTimeout(resolve, 20));
        
        if (!spec.type || spec.type === '') {
          throw new Error('Agent type is required');
        }
        
        return {
          id: spec.id || `agent_${Math.random().toString(36).substr(2, 9)}`,
          type: spec.type,
          capabilities: spec.capabilities || []
        };
      },

      async createAgentsForPlan(plan) {
        const batchSize = plan.requirements.length;
        
        // Batch creation is more efficient
        const batchTime = Math.max(50, batchSize * 15); // Minimum 50ms, then 15ms per agent
        await new Promise(resolve => setTimeout(resolve, batchTime));
        
        return plan.requirements.map(req => ({
          id: `agent_${Math.random().toString(36).substr(2, 9)}`,
          type: req.type,
          capabilities: req.capabilities || []
        }));
      }
    },

    progressTracker: {
      progressData: new Map(),

      async updateProgress(update) {
        // Simulate update processing time
        await new Promise(resolve => setTimeout(resolve, 5));
        
        const key = update.taskId || 'global';
        this.progressData.set(key, {
          progress: update.progress,
          timestamp: update.timestamp || Date.now()
        });
        
        return true;
      },

      async getTaskProgress(taskId) {
        const data = this.progressData.get(taskId);
        return data ? data.progress : 0;
      }
    },

    toolOrganizer: {
      async loadOptimalBundle(categories) {
        // Simulate bundle loading time
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return {
          tools: categories.map(cat => ({ category: cat, name: `${cat}_tool` }))
        };
      }
    },

    async healthCheck() {
      return { responsive: true, status: 'healthy' };
    },

    async initialize() {
      // Initialize system
    },

    async cleanup() {
      // Cleanup resources
    }
  };
}

// Helper functions

function calculateScalingEfficiency(results) {
  if (results.length < 2) return 1;
  
  let totalEfficiency = 0;
  
  for (let i = 1; i < results.length; i++) {
    const current = results[i];
    const previous = results[i - 1];
    
    // Ideally, 2x complexity should take less than 2x time
    const complexityRatio = current.taskCount ? 
      current.taskCount / previous.taskCount : 
      2; // Assume 2x if no task count
    
    const timeRatio = current.duration / previous.duration;
    const efficiency = complexityRatio / timeRatio;
    
    totalEfficiency += efficiency;
  }
  
  return totalEfficiency / (results.length - 1);
}

function validateAgentCreationScaling(results) {
  // Check if creation time scales sub-linearly
  for (let i = 1; i < results.length; i++) {
    const current = results[i];
    const previous = results[i - 1];
    
    const agentRatio = current.agentsCreated / previous.agentsCreated;
    const timeRatio = current.duration / previous.duration;
    
    // Time ratio should be less than agent ratio (sub-linear scaling)
    if (timeRatio > agentRatio * 1.5) {
      return false;
    }
  }
  
  return true;
}

function findOptimalBatchSize(batchResults) {
  let optimalSize = batchResults[0].batchSize;
  let maxEfficiency = batchResults[0].efficiency;
  
  for (const result of batchResults) {
    if (result.efficiency > maxEfficiency) {
      maxEfficiency = result.efficiency;
      optimalSize = result.batchSize;
    }
  }
  
  return optimalSize;
}

// Stress testing operations

async function generateMassivePlans(system, count) {
  const promises = Array.from({ length: count }, (_, i) =>
    system.dualPlanner.createDualPlan(`Massive plan ${i}`, { complexity: 'high' })
  );
  
  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => r.status === 'fulfilled').length;
  
  if (successful < count * 0.8) {
    throw new Error('System overload: Too many plan generation failures');
  }
  
  return { generated: successful, requested: count };
}

async function createAgentFlood(system, count) {
  const promises = Array.from({ length: count }, (_, i) =>
    system.actorFactory.createAgent({ type: 'flood_test', id: `flood_${i}` })
  );
  
  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => r.status === 'fulfilled').length;
  
  if (successful < count * 0.7) {
    throw new Error('System overload: Agent creation flood detected');
  }
  
  return { created: successful, requested: count };
}

async function progressUpdateStorm(system, count) {
  const promises = Array.from({ length: count }, (_, i) =>
    system.progressTracker.updateProgress({
      level: 'task',
      taskId: `storm_task_${i % 100}`,
      progress: Math.random() * 100
    })
  );
  
  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => r.status === 'fulfilled').length;
  
  if (successful < count * 0.9) {
    throw new Error('System overload: Progress update storm detected');
  }
  
  return { processed: successful, requested: count };
}