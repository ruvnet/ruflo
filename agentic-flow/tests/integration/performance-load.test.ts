/**
 * Performance and Load Testing Integration Tests
 * Tests system performance, scalability, and resource utilization under various load conditions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { IntegrationTestFramework, IntegrationTestContext, measureTime, TestDataFactory } from './test-infrastructure';

describe('Performance and Load Testing Integration', () => {
  let framework: IntegrationTestFramework;
  let testContext: IntegrationTestContext;

  beforeAll(async () => {
    framework = new IntegrationTestFramework();
  });

  afterAll(async () => {
    await framework.cleanup();
  });

  beforeEach(async () => {
    testContext = await framework.createTestContext({
      name: 'Performance and Load Test',
      agents: {
        count: 8,
        types: ['coordinator', 'researcher', 'coder', 'analyst', 'reviewer', 'tester', 'optimizer', 'monitor']
      },
      providers: {
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || 'test-key' }
      },
      enableRealProviders: process.env.RUN_REAL_API_TESTS === 'true',
      timeout: 300000 // 5 minutes for load tests
    });
  });

  afterEach(async () => {
    await testContext.cleanup();
  });

  describe('System Throughput Testing', () => {
    it('should handle high-throughput request processing', async () => {
      const { providers, coordinator } = testContext;
      
      const loadParameters = {
        requestsPerSecond: [10, 50, 100, 200],
        duration: 30000, // 30 seconds per load level
        rampUpTime: 5000 // 5 seconds ramp up
      };

      const throughputResults: any[] = [];
      
      for (const rps of loadParameters.requestsPerSecond) {
        const loadTestMetrics = {
          targetRPS: rps,
          actualRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          responseTimeMs: [] as number[],
          resourceUsage: [] as number[]
        };

        const { duration: testDuration } = await measureTime(async () => {
          const startTime = Date.now();
          const endTime = startTime + loadParameters.duration;
          const interval = 1000 / rps; // ms between requests
          
          const requestPromises: Promise<any>[] = [];
          
          while (Date.now() < endTime) {
            const requestStart = Date.now();
            
            const requestPromise = providers.complete({
              model: 'claude-3-haiku',
              messages: [{ role: 'user', content: `Load test request ${loadTestMetrics.actualRequests}` }],
              maxTokens: 20
            }).then(response => {
              const requestEnd = Date.now();
              loadTestMetrics.successfulRequests++;
              loadTestMetrics.responseTimeMs.push(requestEnd - requestStart);
              return response;
            }).catch(error => {
              loadTestMetrics.failedRequests++;
              return { error };
            });
            
            requestPromises.push(requestPromise);
            loadTestMetrics.actualRequests++;
            
            // Track resource usage periodically
            if (loadTestMetrics.actualRequests % 10 === 0) {
              loadTestMetrics.resourceUsage.push(process.memoryUsage().heapUsed);
            }
            
            // Wait for next request interval
            const nextRequest = Date.now() + interval;
            while (Date.now() < nextRequest) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
          }
          
          // Wait for all requests to complete
          await Promise.allSettled(requestPromises);
        });

        const actualRPS = loadTestMetrics.successfulRequests / (testDuration / 1000);
        const successRate = (loadTestMetrics.successfulRequests / loadTestMetrics.actualRequests) * 100;
        const avgResponseTime = loadTestMetrics.responseTimeMs.reduce((a, b) => a + b, 0) / loadTestMetrics.responseTimeMs.length;
        const p95ResponseTime = loadTestMetrics.responseTimeMs.sort((a, b) => a - b)[Math.floor(loadTestMetrics.responseTimeMs.length * 0.95)];
        
        const throughputResult = {
          targetRPS: rps,
          actualRPS,
          successRate,
          avgResponseTime,
          p95ResponseTime,
          totalRequests: loadTestMetrics.actualRequests,
          memoryUsage: Math.max(...loadTestMetrics.resourceUsage)
        };
        
        throughputResults.push(throughputResult);
        
        framework.recordMetric(testContext.id, `throughput_${rps}rps_actual`, actualRPS);
        framework.recordMetric(testContext.id, `throughput_${rps}rps_success_rate`, successRate);
        framework.recordMetric(testContext.id, `throughput_${rps}rps_avg_latency`, avgResponseTime);
        framework.recordMetric(testContext.id, `throughput_${rps}rps_p95_latency`, p95ResponseTime);
        
        // Cool down between load levels
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      // Analyze throughput scaling
      const maxSuccessfulRPS = Math.max(...throughputResults.map(r => r.actualRPS));
      const degradationPoint = throughputResults.find(r => r.successRate < 95);
      
      expect(maxSuccessfulRPS).toBeGreaterThan(10);
      expect(throughputResults[0].successRate).toBeGreaterThan(90);
      
      framework.recordMetric(testContext.id, 'max_sustainable_rps', maxSuccessfulRPS);
      framework.recordMetric(testContext.id, 'degradation_point_rps', degradationPoint?.targetRPS || maxSuccessfulRPS);
      
      console.log('Throughput Test Results:', throughputResults);
    });

    it('should scale agent coordination under load', async () => {
      const { coordinator } = testContext;
      
      const coordinationLoads = [5, 10, 20, 30]; // Number of concurrent goals
      const coordinationResults: any[] = [];
      
      for (const concurrentGoals of coordinationLoads) {
        const { result: coordination, duration } = await measureTime(async () => {
          const goals = Array.from({ length: concurrentGoals }, (_, i) => 
            TestDataFactory.createGoal(`Concurrent coordination test ${i}`, Math.floor(Math.random() * 5) + 3)
          );
          
          const coordinationMetrics = {
            teamsFormed: 0,
            coordinationTime: [] as number[],
            resourceConflicts: 0,
            successfulCoordinations: 0
          };
          
          const coordinationPromises = goals.map(async (goal, index) => {
            const startTime = Date.now();
            
            try {
              const team = await coordinator.formTeam(goal);
              const endTime = Date.now();
              
              coordinationMetrics.teamsFormed++;
              coordinationMetrics.coordinationTime.push(endTime - startTime);
              coordinationMetrics.successfulCoordinations++;
              
              return { goal, team, success: true };
            } catch (error: any) {
              if (error.message.includes('resource conflict')) {
                coordinationMetrics.resourceConflicts++;
              }
              return { goal, error, success: false };
            }
          });
          
          const results = await Promise.allSettled(coordinationPromises);
          return { results, metrics: coordinationMetrics };
        });
        
        const avgCoordinationTime = coordination.metrics.coordinationTime.reduce((a, b) => a + b, 0) / coordination.metrics.coordinationTime.length;
        const coordinationSuccessRate = (coordination.metrics.successfulCoordinations / concurrentGoals) * 100;
        
        const coordinationResult = {
          concurrentGoals,
          teamsFormed: coordination.metrics.teamsFormed,
          avgCoordinationTime,
          coordinationSuccessRate,
          resourceConflicts: coordination.metrics.resourceConflicts,
          totalDuration: duration
        };
        
        coordinationResults.push(coordinationResult);
        
        framework.recordMetric(testContext.id, `coordination_${concurrentGoals}goals_success_rate`, coordinationSuccessRate);
        framework.recordMetric(testContext.id, `coordination_${concurrentGoals}goals_avg_time`, avgCoordinationTime);
        framework.recordMetric(testContext.id, `coordination_${concurrentGoals}goals_conflicts`, coordination.metrics.resourceConflicts);
      }
      
      // Analyze coordination scaling
      const scalingEfficiency = coordinationResults.map((result, index) => {
        if (index === 0) return 100;
        const baselineTime = coordinationResults[0].avgCoordinationTime;
        const currentTime = result.avgCoordinationTime;
        return (baselineTime / currentTime) * 100;
      });
      
      expect(coordinationResults[0].coordinationSuccessRate).toBeGreaterThan(90);
      expect(scalingEfficiency[scalingEfficiency.length - 1]).toBeGreaterThan(50); // Should maintain at least 50% efficiency
      
      framework.recordMetric(testContext.id, 'coordination_scaling_efficiency', scalingEfficiency[scalingEfficiency.length - 1]);
      
      console.log('Coordination Scaling Results:', coordinationResults);
    });
  });

  describe('Memory and Resource Testing', () => {
    it('should manage memory efficiently under sustained load', async () => {
      const { providers, workflowEngine } = testContext;
      
      const memoryTestParams = {
        duration: 60000, // 1 minute sustained load
        operationsPerSecond: 20,
        monitoringInterval: 1000 // Monitor every second
      };
      
      const memoryMetrics = {
        samples: [] as Array<{ timestamp: number; heapUsed: number; heapTotal: number; external: number }>,
        operations: 0,
        errors: 0
      };
      
      // Start memory monitoring
      const memoryMonitor = setInterval(() => {
        const usage = process.memoryUsage();
        memoryMetrics.samples.push({
          timestamp: Date.now(),
          heapUsed: usage.heapUsed,
          heapTotal: usage.heapTotal,
          external: usage.external
        });
      }, memoryTestParams.monitoringInterval);
      
      const { duration: testDuration } = await measureTime(async () => {
        const startTime = Date.now();
        const endTime = startTime + memoryTestParams.duration;
        
        while (Date.now() < endTime) {
          try {
            // Mix of operations to stress different components
            const operationType = memoryMetrics.operations % 4;
            
            switch (operationType) {
              case 0:
                // Provider operation
                await providers.complete({
                  model: 'claude-3-haiku',
                  messages: [{ role: 'user', content: `Memory test ${memoryMetrics.operations}` }],
                  maxTokens: 10
                });
                break;
              
              case 1:
                // Workflow creation and cleanup
                const workflow = TestDataFactory.createWorkflowDefinition(`Memory Test ${memoryMetrics.operations}`, 'simple');
                const instanceId = await workflowEngine.startWorkflow(workflow, { test: 'memory' });
                setTimeout(() => workflowEngine.cancelWorkflow(instanceId, 'Memory test cleanup').catch(() => {}), 5000);
                break;
              
              case 2:
                // Agent goal setting
                const agent = Array.from(testContext.agents.values())[memoryMetrics.operations % testContext.agents.size];
                await agent.setGoal(`Memory test goal ${memoryMetrics.operations}`, 3);
                break;
              
              case 3:
                // Force garbage collection if available
                if (global.gc) {
                  global.gc();
                }
                break;
            }
            
            memoryMetrics.operations++;
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000 / memoryTestParams.operationsPerSecond));
            
          } catch (error) {
            memoryMetrics.errors++;
          }
        }
      });
      
      clearInterval(memoryMonitor);
      
      // Analyze memory usage
      const heapUsedSamples = memoryMetrics.samples.map(s => s.heapUsed);
      const initialMemory = heapUsedSamples[0];
      const finalMemory = heapUsedSamples[heapUsedSamples.length - 1];
      const peakMemory = Math.max(...heapUsedSamples);
      const memoryGrowth = finalMemory - initialMemory;
      const memoryGrowthPercent = (memoryGrowth / initialMemory) * 100;
      
      // Check for memory leaks (should not grow continuously)
      const firstHalf = heapUsedSamples.slice(0, Math.floor(heapUsedSamples.length / 2));
      const secondHalf = heapUsedSamples.slice(Math.floor(heapUsedSamples.length / 2));
      const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const memoryTrend = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
      
      framework.recordMetric(testContext.id, 'memory_initial_mb', initialMemory / 1024 / 1024);
      framework.recordMetric(testContext.id, 'memory_final_mb', finalMemory / 1024 / 1024);
      framework.recordMetric(testContext.id, 'memory_peak_mb', peakMemory / 1024 / 1024);
      framework.recordMetric(testContext.id, 'memory_growth_percent', memoryGrowthPercent);
      framework.recordMetric(testContext.id, 'memory_trend_percent', memoryTrend);
      framework.recordMetric(testContext.id, 'memory_operations_completed', memoryMetrics.operations);
      framework.recordMetric(testContext.id, 'memory_test_errors', memoryMetrics.errors);
      
      expect(memoryGrowthPercent).toBeLessThan(100); // Less than 100% growth
      expect(memoryTrend).toBeLessThan(50); // Memory trend should be reasonable
      expect(memoryMetrics.errors / memoryMetrics.operations).toBeLessThan(0.1); // Less than 10% error rate
      
      console.log('Memory Test Results:', {
        initialMemoryMB: (initialMemory / 1024 / 1024).toFixed(2),
        finalMemoryMB: (finalMemory / 1024 / 1024).toFixed(2),
        peakMemoryMB: (peakMemory / 1024 / 1024).toFixed(2),
        memoryGrowthPercent: memoryGrowthPercent.toFixed(2),
        memoryTrend: memoryTrend.toFixed(2),
        operations: memoryMetrics.operations,
        errors: memoryMetrics.errors
      });
    });

    it('should handle resource contention gracefully', async () => {
      const { coordinator, agents } = testContext;
      
      const contention = {
        scenarios: [
          { name: 'high_cpu', agentCount: 6, intensity: 'high' },
          { name: 'high_memory', agentCount: 4, intensity: 'medium' },
          { name: 'high_io', agentCount: 8, intensity: 'high' }
        ]
      };
      
      const contentionResults: any[] = [];
      
      for (const scenario of contention.scenarios) {
        const { result: scenarioResult, duration } = await measureTime(async () => {
          const goals = Array.from({ length: scenario.agentCount }, (_, i) => 
            TestDataFactory.createGoal(`${scenario.name} contention test ${i}`, 6)
          );
          
          const contentionMetrics = {
            completedTasks: 0,
            resourceConflicts: 0,
            timeouts: 0,
            avgCompletionTime: 0
          };
          
          const taskPromises = goals.map(async (goal, index) => {
            const startTime = Date.now();
            
            try {
              const team = await coordinator.formTeam(goal);
              const result = await coordinator.executeTask(team.id, {
                type: scenario.name,
                intensity: scenario.intensity,
                duration: 5000 // 5 seconds per task
              });
              
              const completionTime = Date.now() - startTime;
              contentionMetrics.completedTasks++;
              contentionMetrics.avgCompletionTime += completionTime;
              
              return { success: true, completionTime };
            } catch (error: any) {
              if (error.message.includes('resource conflict')) {
                contentionMetrics.resourceConflicts++;
              } else if (error.message.includes('timeout')) {
                contentionMetrics.timeouts++;
              }
              return { success: false, error: error.message };
            }
          });
          
          const results = await Promise.allSettled(taskPromises);
          contentionMetrics.avgCompletionTime = contentionMetrics.avgCompletionTime / contentionMetrics.completedTasks;
          
          return { results, metrics: contentionMetrics };
        });
        
        const successRate = (scenarioResult.metrics.completedTasks / scenario.agentCount) * 100;
        const contentionResult = {
          scenario: scenario.name,
          agentCount: scenario.agentCount,
          successRate,
          completedTasks: scenarioResult.metrics.completedTasks,
          resourceConflicts: scenarioResult.metrics.resourceConflicts,
          timeouts: scenarioResult.metrics.timeouts,
          avgCompletionTime: scenarioResult.metrics.avgCompletionTime,
          totalDuration: duration
        };
        
        contentionResults.push(contentionResult);
        
        framework.recordMetric(testContext.id, `contention_${scenario.name}_success_rate`, successRate);
        framework.recordMetric(testContext.id, `contention_${scenario.name}_conflicts`, scenarioResult.metrics.resourceConflicts);
        framework.recordMetric(testContext.id, `contention_${scenario.name}_avg_time`, scenarioResult.metrics.avgCompletionTime);
      }
      
      // System should handle resource contention gracefully
      const avgSuccessRate = contentionResults.reduce((sum, r) => sum + r.successRate, 0) / contentionResults.length;
      const totalConflicts = contentionResults.reduce((sum, r) => sum + r.resourceConflicts, 0);
      
      expect(avgSuccessRate).toBeGreaterThan(70); // At least 70% success rate under contention
      expect(totalConflicts).toBeLessThan(contentionResults.length * 5); // Reasonable conflict handling
      
      framework.recordMetric(testContext.id, 'resource_contention_avg_success', avgSuccessRate);
      framework.recordMetric(testContext.id, 'resource_contention_total_conflicts', totalConflicts);
      
      console.log('Resource Contention Results:', contentionResults);
    });
  });

  describe('Stress Testing', () => {
    it('should maintain stability under extreme load', async () => {
      const { coordinator, providers, workflowEngine } = testContext;
      
      const stressParams = {
        duration: 120000, // 2 minutes
        maxConcurrentOperations: 50,
        operationTypes: ['provider_requests', 'workflow_starts', 'agent_goals', 'team_formations']
      };
      
      const stressMetrics = {
        operations: new Map<string, { attempted: number; succeeded: number; failed: number }>(),
        errors: [] as Array<{ type: string; message: string; timestamp: number }>,
        systemHealth: [] as Array<{ timestamp: number; memory: number; activeOperations: number }>
      };
      
      // Initialize operation counters
      stressParams.operationTypes.forEach(type => {
        stressMetrics.operations.set(type, { attempted: 0, succeeded: 0, failed: 0 });
      });
      
      // System health monitoring
      const healthMonitor = setInterval(() => {
        stressMetrics.systemHealth.push({
          timestamp: Date.now(),
          memory: process.memoryUsage().heapUsed,
          activeOperations: Array.from(stressMetrics.operations.values()).reduce((sum, op) => sum + (op.attempted - op.succeeded - op.failed), 0)
        });
      }, 2000);
      
      const { duration: testDuration } = await measureTime(async () => {
        const startTime = Date.now();
        const endTime = startTime + stressParams.duration;
        
        const operationQueue: Promise<any>[] = [];
        
        while (Date.now() < endTime) {
          // Maintain maximum concurrent operations
          if (operationQueue.length < stressParams.maxConcurrentOperations) {
            const operationType = stressParams.operationTypes[Math.floor(Math.random() * stressParams.operationTypes.length)];
            const operation = this.createStressOperation(operationType, testContext, stressMetrics);
            
            operationQueue.push(operation);
          }
          
          // Clean up completed operations
          const completedIndices: number[] = [];
          for (let i = 0; i < operationQueue.length; i++) {
            const isCompleted = await Promise.race([
              operationQueue[i].then(() => true).catch(() => true),
              new Promise(resolve => setTimeout(() => resolve(false), 0))
            ]);
            
            if (isCompleted) {
              completedIndices.push(i);
            }
          }
          
          // Remove completed operations (in reverse order to maintain indices)
          completedIndices.reverse().forEach(index => {
            operationQueue.splice(index, 1);
          });
          
          await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
        }
        
        // Wait for remaining operations to complete
        await Promise.allSettled(operationQueue);
      });
      
      clearInterval(healthMonitor);
      
      // Analyze stress test results
      const totalOperations = Array.from(stressMetrics.operations.values()).reduce((sum, op) => sum + op.attempted, 0);
      const totalSuccessful = Array.from(stressMetrics.operations.values()).reduce((sum, op) => sum + op.succeeded, 0);
      const totalFailed = Array.from(stressMetrics.operations.values()).reduce((sum, op) => sum + op.failed, 0);
      const overallSuccessRate = (totalSuccessful / totalOperations) * 100;
      
      const memoryAtStart = stressMetrics.systemHealth[0]?.memory || 0;
      const memoryAtEnd = stressMetrics.systemHealth[stressMetrics.systemHealth.length - 1]?.memory || 0;
      const memoryIncrease = ((memoryAtEnd - memoryAtStart) / memoryAtStart) * 100;
      
      framework.recordMetric(testContext.id, 'stress_test_duration', testDuration);
      framework.recordMetric(testContext.id, 'stress_total_operations', totalOperations);
      framework.recordMetric(testContext.id, 'stress_success_rate', overallSuccessRate);
      framework.recordMetric(testContext.id, 'stress_total_errors', stressMetrics.errors.length);
      framework.recordMetric(testContext.id, 'stress_memory_increase', memoryIncrease);
      
      // System should maintain reasonable performance under stress
      expect(overallSuccessRate).toBeGreaterThan(60); // At least 60% success under extreme stress
      expect(memoryIncrease).toBeLessThan(200); // Memory should not grow excessively
      expect(stressMetrics.errors.length / totalOperations).toBeLessThan(0.4); // Less than 40% error rate
      
      console.log('Stress Test Results:', {
        duration: testDuration,
        totalOperations,
        successRate: overallSuccessRate.toFixed(2) + '%',
        errors: stressMetrics.errors.length,
        memoryIncrease: memoryIncrease.toFixed(2) + '%'
      });
    });

    // Helper method to create stress operations
    createStressOperation(operationType: string, context: IntegrationTestContext, metrics: any): Promise<any> {
      const operation = metrics.operations.get(operationType)!;
      operation.attempted++;
      
      const operationPromise = (async () => {
        try {
          switch (operationType) {
            case 'provider_requests':
              await context.providers.complete({
                model: 'claude-3-haiku',
                messages: [{ role: 'user', content: `Stress test ${operation.attempted}` }],
                maxTokens: 10
              });
              break;
              
            case 'workflow_starts':
              const workflow = TestDataFactory.createWorkflowDefinition(`Stress ${operation.attempted}`, 'simple');
              const instanceId = await context.workflowEngine.startWorkflow(workflow, { stress: true });
              // Cancel after short time to avoid resource buildup
              setTimeout(() => context.workflowEngine.cancelWorkflow(instanceId, 'Stress cleanup').catch(() => {}), 2000);
              break;
              
            case 'agent_goals':
              const agent = Array.from(context.agents.values())[operation.attempted % context.agents.size];
              await agent.setGoal(`Stress goal ${operation.attempted}`, Math.floor(Math.random() * 5) + 1);
              break;
              
            case 'team_formations':
              const goal = TestDataFactory.createGoal(`Stress team ${operation.attempted}`, Math.floor(Math.random() * 5) + 3);
              await context.coordinator.formTeam(goal);
              break;
          }
          
          operation.succeeded++;
        } catch (error: any) {
          operation.failed++;
          metrics.errors.push({
            type: operationType,
            message: error.message,
            timestamp: Date.now()
          });
        }
      })();
      
      return operationPromise;
    }
  });

  describe('Performance Test Metrics and Reporting', () => {
    it('should provide comprehensive performance metrics', () => {
      const metrics = framework.getMetrics(testContext.id);
      const stats = framework.getPerformanceStats(testContext.id);
      
      expect(metrics).toBeDefined();
      expect(stats).toBeDefined();
      
      console.log('\n=== Performance and Load Test Metrics ===');
      console.log('Total Requests:', stats?.requests || 0);
      console.log('Success Rate:', stats?.successRate?.toFixed(2) + '%' || 'N/A');
      console.log('Average Latency:', stats?.latency?.avg?.toFixed(2) + 'ms' || 'N/A');
      console.log('P95 Latency:', stats?.latency?.p95?.toFixed(2) + 'ms' || 'N/A');
      console.log('P99 Latency:', stats?.latency?.p99?.toFixed(2) + 'ms' || 'N/A');
      console.log('Test Duration:', stats?.duration?.toFixed(2) + 'ms' || 'N/A');
      console.log('Memory Usage:', (stats?.resourceUsage?.memory / 1024 / 1024)?.toFixed(2) + 'MB' || 'N/A');
      
      if (metrics?.customMetrics) {
        console.log('\nPerformance-Specific Metrics:');
        const performanceMetrics = Array.from(metrics.customMetrics.entries())
          .filter(([key]) => key.includes('throughput') || key.includes('memory') || key.includes('stress'))
          .sort(([a], [b]) => a.localeCompare(b));
          
        performanceMetrics.forEach(([key, value]) => {
          if (typeof value === 'number') {
            console.log(`  ${key}: ${value.toFixed(2)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        });
      }
      console.log('=========================================\n');
      
      // Validate performance characteristics
      if (metrics?.customMetrics) {
        const throughputMetrics = Array.from(metrics.customMetrics.entries())
          .filter(([key]) => key.includes('throughput') && key.includes('actual'));
        
        if (throughputMetrics.length > 0) {
          const maxThroughput = Math.max(...throughputMetrics.map(([, value]) => value as number));
          framework.recordMetric(testContext.id, 'peak_system_throughput', maxThroughput);
          expect(maxThroughput).toBeGreaterThan(0);
        }
      }
    });
  });
});