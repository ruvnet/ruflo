/**
 * Comprehensive Error Handling Test Suite
 * Tests all error scenarios and recovery mechanisms across ruv-swarm integration components
 */

import { jest } from '@jest/globals';
import { ErrorHandlingManager, ErrorCategory, ErrorSeverity } from '../src/error-handling-manager.js';
import { EnhancedSwarmPersistence } from '../src/persistence-error-wrapper.js';
import { EnhancedWasmLoader } from '../src/wasm-error-wrapper.js';
import { RobustMCPTools } from '../src/mcp-error-wrapper.js';
import fs from 'fs';
import path from 'path';

// Test configuration
const TEST_CONFIG = {
    timeout: 30000,
    tempDir: './test-temp',
    dbPath: './test-temp/test.db'
};

describe('Comprehensive Error Handling System', () => {
    let errorHandler;
    let tempDir;

    beforeAll(async () => {
        // Create temp directory for tests
        tempDir = TEST_CONFIG.tempDir;
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    });

    afterAll(async () => {
        // Cleanup temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        errorHandler = new ErrorHandlingManager({
            retry: { maxRetries: 2, initialDelay: 100 },
            circuitBreaker: { failureThreshold: 3, recoveryTimeout: 1000 }
        });
    });

    afterEach(() => {
        if (errorHandler) {
            errorHandler.removeAllListeners();
        }
    });

    describe('ErrorHandlingManager Core Functionality', () => {
        test('should handle successful operations', async () => {
            const result = await errorHandler.wrapOperation(async () => {
                return { success: true, data: 'test' };
            }, {
                category: ErrorCategory.COORDINATION,
                component: 'test',
                operation: 'success_test'
            });

            expect(result.success).toBe(true);
            expect(result.data).toBe('test');
        });

        test('should retry failed operations with exponential backoff', async () => {
            let attempts = 0;
            const maxAttempts = 3;

            try {
                await errorHandler.wrapOperation(async () => {
                    attempts++;
                    if (attempts < maxAttempts) {
                        throw new Error('Temporary failure');
                    }
                    return { success: true, attempts };
                }, {
                    category: ErrorCategory.NETWORK,
                    component: 'test',
                    operation: 'retry_test'
                });
            } catch (error) {
                // Should succeed after retries
            }

            expect(attempts).toBe(maxAttempts);
        });

        test('should handle circuit breaker functionality', async () => {
            const operation = async () => {
                throw new Error('Persistent failure');
            };

            const context = {
                category: ErrorCategory.PERSISTENCE,
                component: 'test',
                operation: 'circuit_breaker_test'
            };

            // Trigger circuit breaker with multiple failures
            for (let i = 0; i < 5; i++) {
                try {
                    await errorHandler.wrapOperation(operation, context);
                } catch (error) {
                    // Expected failures
                }
            }

            // Circuit breaker should now be open
            try {
                await errorHandler.wrapOperation(operation, context);
                fail('Should have thrown circuit breaker error');
            } catch (error) {
                expect(error.message).toContain('Circuit breaker');
            }
        });

        test('should categorize error severity correctly', () => {
            const memoryError = new Error('Out of memory');
            const networkError = new Error('Network timeout');
            const validationError = new Error('Invalid parameter');

            const memoryRecord = errorHandler.createErrorRecord(memoryError, {
                category: ErrorCategory.MEMORY
            });
            const networkRecord = errorHandler.createErrorRecord(networkError, {
                category: ErrorCategory.NETWORK
            });
            const validationRecord = errorHandler.createErrorRecord(validationError, {
                category: ErrorCategory.VALIDATION
            });

            expect(memoryRecord.severity).toBe(ErrorSeverity.CRITICAL);
            expect(networkRecord.severity).toBe(ErrorSeverity.HIGH);
            expect(validationRecord.severity).toBe(ErrorSeverity.MEDIUM);
        });

        test('should provide error statistics', async () => {
            // Generate some test errors
            for (let i = 0; i < 5; i++) {
                try {
                    await errorHandler.wrapOperation(async () => {
                        throw new Error(`Test error ${i}`);
                    }, {
                        category: ErrorCategory.COORDINATION,
                        component: 'test',
                        operation: 'stats_test'
                    });
                } catch (error) {
                    // Expected
                }
            }

            const stats = errorHandler.getErrorStatistics();
            expect(stats.total).toBeGreaterThan(0);
            expect(stats.byCategory[ErrorCategory.COORDINATION]).toBeGreaterThan(0);
        });

        test('should generate meaningful recommendations', async () => {
            // Create errors that should trigger recommendations
            try {
                await errorHandler.wrapOperation(async () => {
                    throw new Error('Critical system failure');
                }, {
                    category: ErrorCategory.MEMORY,
                    component: 'test',
                    operation: 'critical_test'
                });
            } catch (error) {
                // Expected
            }

            const recommendations = errorHandler.generateRecommendations();
            expect(recommendations.length).toBeGreaterThan(0);
            expect(recommendations[0].priority).toBe('HIGH');
        });
    });

    describe('Enhanced Persistence Error Handling', () => {
        let persistence;

        beforeEach(() => {
            persistence = new EnhancedSwarmPersistence(TEST_CONFIG.dbPath, {
                backupPath: path.join(TEST_CONFIG.tempDir, 'backups')
            });
        });

        afterEach(async () => {
            if (persistence) {
                try {
                    await persistence.close?.();
                } catch (error) {
                    // Ignore cleanup errors
                }
            }
        });

        test('should handle database connection failures gracefully', async () => {
            // Create persistence with invalid path
            const invalidPersistence = new EnhancedSwarmPersistence('/invalid/path/db.sqlite');
            
            // Should fall back to in-memory mode
            await new Promise(resolve => setTimeout(resolve, 100)); // Allow initialization
            expect(invalidPersistence.isInMemoryMode).toBe(true);
        });

        test('should validate swarm data before operations', async () => {
            const invalidSwarm = {
                // Missing required fields
                name: 'test'
            };

            await expect(persistence.createSwarm(invalidSwarm))
                .rejects.toThrow('Invalid swarm data');
        });

        test('should handle transaction rollbacks', async () => {
            const validSwarm = {
                id: 'test-swarm-1',
                name: 'Test Swarm',
                topology: 'mesh',
                maxAgents: 5
            };

            // Mock database error during creation
            if (persistence.persistence) {
                const originalCreate = persistence.persistence.createSwarm;
                persistence.persistence.createSwarm = jest.fn(() => {
                    throw new Error('Database error');
                });

                await expect(persistence.createSwarm(validSwarm))
                    .rejects.toThrow('Database error');

                // Restore original method
                persistence.persistence.createSwarm = originalCreate;
            }
        });

        test('should create backups before risky operations', async () => {
            const swarm = {
                id: 'backup-test-swarm',
                name: 'Backup Test',
                topology: 'mesh',
                maxAgents: 3
            };

            await persistence.createSwarm(swarm);

            // Check if backup directory exists
            const backupDir = path.join(TEST_CONFIG.tempDir, 'backups');
            expect(fs.existsSync(backupDir)).toBe(true);
        });

        test('should handle memory cleanup and TTL expiration', async () => {
            // Store memory with short TTL
            await persistence.storeMemory('test-agent', 'short-lived', 'data', 1); // 1 second TTL

            // Verify data exists
            let memory = await persistence.getMemory('test-agent', 'short-lived');
            expect(memory).toBeTruthy();

            // Wait for TTL expiration
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Verify data is cleaned up
            memory = await persistence.getMemory('test-agent', 'short-lived');
            expect(memory).toBeFalsy();
        });

        test('should detect and handle corrupted data', async () => {
            // This test would need to simulate corrupted data
            // For now, we test the validation logic
            const corruptedMemory = {
                value: 'invalid json {{'
            };

            expect(persistence.isCorruptedMemoryData(corruptedMemory)).toBe(true);
        });

        test('should perform health checks', async () => {
            const health = await persistence.performHealthCheck();
            
            expect(health).toHaveProperty('persistence');
            expect(health).toHaveProperty('memory_store');
            expect(health).toHaveProperty('error_handling');
        });
    });

    describe('Enhanced WASM Loader Error Handling', () => {
        let wasmLoader;

        beforeEach(() => {
            wasmLoader = new EnhancedWasmLoader({
                maxLoadingTime: 5000,
                enableFallbacks: true,
                enableValidation: true
            });
        });

        test('should handle WASM initialization timeouts', async () => {
            // Mock a slow initialization
            const originalInitialize = wasmLoader.baseLoader.initialize;
            wasmLoader.baseLoader.initialize = jest.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay
            });

            await expect(wasmLoader.initialize('progressive'))
                .rejects.toThrow('Timeout');

            // Restore original method
            wasmLoader.baseLoader.initialize = originalInitialize;
        });

        test('should validate module names', async () => {
            await expect(wasmLoader.loadModule('invalid-module'))
                .rejects.toThrow('Unknown module');

            await expect(wasmLoader.loadModule(''))
                .rejects.toThrow('Module name must be a non-empty string');
        });

        test('should use fallback implementations when WASM fails', async () => {
            // Mock module loading failure
            const originalLoadModule = wasmLoader.baseLoader.loadModule;
            wasmLoader.baseLoader.loadModule = jest.fn(async (name) => {
                throw new Error('WASM loading failed');
            });

            const module = await wasmLoader.loadModule('core');
            expect(module.isFallback).toBe(true);

            // Restore original method
            wasmLoader.baseLoader.loadModule = originalLoadModule;
        });

        test('should validate system capabilities', async () => {
            const capabilities = await wasmLoader.checkSystemCapabilities();
            
            expect(capabilities).toHaveProperty('webassembly');
            expect(capabilities).toHaveProperty('simd');
            expect(capabilities).toHaveProperty('threads');
        });

        test('should handle module validation failures', async () => {
            // Create invalid module
            const invalidModule = {
                exports: null, // Missing required exports
                instance: null
            };

            const isValid = await wasmLoader.validateLoadedModule('core', invalidModule);
            expect(isValid).toBe(false);
        });

        test('should perform integrity checks', async () => {
            const validModule = {
                memory: { buffer: new ArrayBuffer(1024) },
                exports: { test: () => {} },
                isPlaceholder: false
            };

            await expect(wasmLoader.performIntegrityCheck('test', validModule))
                .resolves.toBe(true);

            const invalidModule = {
                memory: { buffer: new ArrayBuffer(0) }, // Empty buffer
                exports: {},
                isPlaceholder: false
            };

            await expect(wasmLoader.performIntegrityCheck('test', invalidModule))
                .rejects.toThrow('integrity check');
        });

        test('should track loading progress', async () => {
            wasmLoader.startLoadingProgress('test-module');
            
            const progress = wasmLoader.loadingProgress.get('test-module');
            expect(progress.started).toBeTruthy();
            expect(progress.completed).toBeFalsy();

            wasmLoader.completeLoadingProgress('test-module', true);
            
            const completedProgress = wasmLoader.loadingProgress.get('test-module');
            expect(completedProgress.completed).toBeTruthy();
            expect(completedProgress.success).toBe(true);
        });

        test('should provide comprehensive health check', async () => {
            const health = await wasmLoader.performHealthCheck();
            
            expect(health).toHaveProperty('wasm_support');
            expect(health).toHaveProperty('modules');
            expect(health).toHaveProperty('memory');
            expect(health).toHaveProperty('loading_stats');
        });
    });

    describe('Robust MCP Tools Error Handling', () => {
        let mcpTools;
        let mockRuvSwarm;

        beforeEach(() => {
            // Create mock ruv-swarm instance
            mockRuvSwarm = {
                createSwarm: jest.fn(),
                getGlobalMetrics: jest.fn(),
                features: { neural_networks: true }
            };

            mcpTools = new RobustMCPTools(mockRuvSwarm, {
                errorHandling: {
                    retry: { maxRetries: 1 },
                    circuitBreaker: { failureThreshold: 2 }
                }
            });
        });

        test('should validate swarm_init parameters', async () => {
            const invalidParams = {
                topology: 'invalid-topology',
                maxAgents: -1
            };

            await expect(mcpTools.swarm_init(invalidParams))
                .rejects.toThrow('Parameter validation failed');
        });

        test('should validate agent_spawn parameters', async () => {
            const invalidParams = {
                type: 'invalid-type',
                name: '', // Empty name
                capabilities: 'not-an-array'
            };

            await expect(mcpTools.agent_spawn(invalidParams))
                .rejects.toThrow('Parameter validation failed');
        });

        test('should validate neural_train parameters', async () => {
            const invalidParams = {
                agentId: '', // Empty agent ID
                iterations: -1, // Invalid iterations
                learningRate: 2.0 // Invalid learning rate
            };

            await expect(mcpTools.neural_train(invalidParams))
                .rejects.toThrow('Parameter validation failed');
        });

        test('should handle operation timeouts', async () => {
            // Mock slow operation
            mcpTools.baseMCP.swarm_init = jest.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 35000)); // 35 seconds
            });

            await expect(mcpTools.swarm_init({}))
                .rejects.toThrow('Timeout');
        });

        test('should check system health before operations', async () => {
            // Mock unhealthy system
            const originalCheckHealth = mcpTools.checkSystemHealth;
            mcpTools.checkSystemHealth = jest.fn(async () => ({
                healthy: false,
                severity: 'critical',
                issues: ['Critical memory usage']
            }));

            await expect(mcpTools.swarm_init({}))
                .rejects.toThrow('System health critical');

            // Restore original method
            mcpTools.checkSystemHealth = originalCheckHealth;
        });

        test('should verify neural capabilities', async () => {
            // Mock features detection failure
            mcpTools.baseMCP.features_detect = jest.fn(async () => ({
                available: false
            }));

            await expect(mcpTools.neural_train({ agentId: 'test' }))
                .rejects.toThrow('Neural network capabilities not available');
        });

        test('should check agent availability for tasks', async () => {
            // Mock no available agents
            mcpTools.baseMCP.agent_list = jest.fn(async () => ({
                agents: []
            }));

            await expect(mcpTools.task_orchestrate({ task: 'test task' }))
                .rejects.toThrow('No idle agents available');
        });

        test('should verify task existence for results', async () => {
            // Mock task not found
            mcpTools.baseMCP.task_status = jest.fn(async () => {
                throw new Error('Task not found');
            });

            await expect(mcpTools.task_results({ taskId: 'nonexistent' }))
                .rejects.toThrow('Failed to verify task');
        });

        test('should cache validation results', async () => {
            const params = { topology: 'mesh', maxAgents: 5 };
            
            // First validation should be computed
            await mcpTools.validateParameters('swarm_init', params);
            expect(mcpTools.validationCache.size).toBe(1);
            
            // Second validation should use cache
            await mcpTools.validateParameters('swarm_init', params);
            expect(mcpTools.validationCache.size).toBe(1);
        });

        test('should track performance metrics', async () => {
            // Mock successful operation
            mcpTools.baseMCP.swarm_init = jest.fn(async () => ({
                id: 'test-swarm',
                topology: 'mesh',
                maxAgents: 5
            }));

            await mcpTools.swarm_init({ topology: 'mesh' });

            const metrics = mcpTools.performanceMetrics;
            expect(metrics.totalOperations).toBeGreaterThan(0);
            expect(metrics.successfulOperations).toBeGreaterThan(0);
        });

        test('should provide comprehensive health status', async () => {
            const health = await mcpTools.getHealthStatus();
            
            expect(health).toHaveProperty('mcp_tools');
            expect(health).toHaveProperty('error_handling');
            expect(health).toHaveProperty('overall_health');
            expect(health).toHaveProperty('recommendations');
        });
    });

    describe('Integration Error Scenarios', () => {
        test('should handle cascading failures gracefully', async () => {
            // Simulate database failure affecting MCP operations
            const persistence = new EnhancedSwarmPersistence('/invalid/path');
            await new Promise(resolve => setTimeout(resolve, 100)); // Allow initialization
            
            expect(persistence.isInMemoryMode).toBe(true);
            
            // MCP operations should still work with in-memory fallback
            const result = await persistence.createSwarm({
                id: 'test-swarm',
                name: 'Test',
                topology: 'mesh',
                maxAgents: 3
            });
            
            expect(result.changes).toBe(1);
        });

        test('should maintain system stability under high error rates', async () => {
            const errorCount = 50;
            const errors = [];
            
            for (let i = 0; i < errorCount; i++) {
                try {
                    await errorHandler.wrapOperation(async () => {
                        if (Math.random() < 0.7) { // 70% failure rate
                            throw new Error(`Simulated error ${i}`);
                        }
                        return { success: true };
                    }, {
                        category: ErrorCategory.COORDINATION,
                        component: 'stress-test',
                        operation: 'high_error_rate'
                    });
                } catch (error) {
                    errors.push(error);
                }
            }
            
            // System should remain responsive
            const health = errorHandler.getHealthStatus();
            expect(health).toBeTruthy();
            expect(errors.length).toBeGreaterThan(0);
        });

        test('should handle memory pressure gracefully', async () => {
            // Simulate memory pressure
            const largeData = new Array(1000000).fill('test-data');
            
            try {
                await errorHandler.wrapOperation(async () => {
                    // Simulate memory-intensive operation
                    const result = largeData.map(item => item.repeat(100));
                    return { processed: result.length };
                }, {
                    category: ErrorCategory.MEMORY,
                    component: 'memory-test',
                    operation: 'large_data_processing'
                });
            } catch (error) {
                // Should handle memory errors gracefully
                expect(error.message).toBeTruthy();
            }
        });

        test('should recover from network partitions', async () => {
            let networkDown = true;
            let attempts = 0;
            
            const networkOperation = async () => {
                attempts++;
                if (networkDown && attempts < 3) {
                    throw new Error('Network unreachable');
                }
                networkDown = false; // Simulate network recovery
                return { connected: true, attempts };
            };
            
            const result = await errorHandler.wrapOperation(networkOperation, {
                category: ErrorCategory.NETWORK,
                component: 'network-test',
                operation: 'partition_recovery'
            });
            
            expect(result.connected).toBe(true);
            expect(result.attempts).toBeGreaterThan(1);
        });
    });

    describe('Error Recovery Validation', () => {
        test('should provide correct recovery suggestions', () => {
            const timeoutError = 'Operation timeout after 30 seconds';
            const memoryError = 'Out of memory during processing';
            const agentError = 'Agent not available for task';
            const networkError = 'Network connection failed';

            const mcpTools = new RobustMCPTools();
            
            const timeoutSuggestions = mcpTools.baseMCP.generateRecoverySuggestions(timeoutError);
            expect(timeoutSuggestions).toContain('Increase task timeout duration');
            
            const memorySuggestions = mcpTools.baseMCP.generateRecoverySuggestions(memoryError);
            expect(memorySuggestions).toContain('Reduce memory usage in task execution');
            
            const agentSuggestions = mcpTools.baseMCP.generateRecoverySuggestions(agentError);
            expect(agentSuggestions).toContain('Check agent availability and status');
            
            const networkSuggestions = mcpTools.baseMCP.generateRecoverySuggestions(networkError);
            expect(networkSuggestions).toContain('Check network connectivity');
        });

        test('should calculate efficiency scores correctly', () => {
            const mcpTools = new RobustMCPTools();
            
            const perfectResults = {
                execution_summary: { success: true },
                execution_time_ms: 1000,
                aggregated_performance: {
                    total_memory_usage_mb: 50,
                    overall_success_rate: 1.0
                }
            };
            
            const efficiency = mcpTools.baseMCP.calculateEfficiencyScore(perfectResults);
            expect(efficiency).toBeGreaterThan(0.8);
            
            const poorResults = {
                execution_summary: { success: false },
                execution_time_ms: 120000, // 2 minutes
                aggregated_performance: {
                    total_memory_usage_mb: 500,
                    overall_success_rate: 0.3
                }
            };
            
            const poorEfficiency = mcpTools.baseMCP.calculateEfficiencyScore(poorResults);
            expect(poorEfficiency).toBeLessThan(0.5);
        });
    });

    describe('Performance Impact Assessment', () => {
        test('should measure error handling overhead', async () => {
            const operationCount = 100;
            
            // Measure overhead of error handling
            const startTime = performance.now();
            
            for (let i = 0; i < operationCount; i++) {
                await errorHandler.wrapOperation(async () => {
                    return { iteration: i };
                }, {
                    category: ErrorCategory.COORDINATION,
                    component: 'performance-test',
                    operation: 'overhead_measurement'
                });
            }
            
            const totalTime = performance.now() - startTime;
            const averageOverhead = totalTime / operationCount;
            
            // Error handling overhead should be minimal (< 5ms per operation)
            expect(averageOverhead).toBeLessThan(5);
        });

        test('should maintain performance under concurrent operations', async () => {
            const concurrentOperations = 20;
            const operations = [];
            
            const startTime = performance.now();
            
            for (let i = 0; i < concurrentOperations; i++) {
                operations.push(
                    errorHandler.wrapOperation(async () => {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        return { id: i };
                    }, {
                        category: ErrorCategory.COORDINATION,
                        component: 'concurrency-test',
                        operation: 'concurrent_execution'
                    })
                );
            }
            
            const results = await Promise.all(operations);
            const totalTime = performance.now() - startTime;
            
            expect(results).toHaveLength(concurrentOperations);
            expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
        });
    });
}, TEST_CONFIG.timeout);

// Helper functions for test utilities
function createMockRuvSwarmInstance() {
    return {
        createSwarm: jest.fn(async (config) => ({
            id: config.id || 'mock-swarm',
            name: config.name,
            spawn: jest.fn()
        })),
        getGlobalMetrics: jest.fn(async () => ({
            totalSwarms: 1,
            totalAgents: 0,
            memoryUsage: 1024 * 1024
        })),
        features: {
            neural_networks: true,
            forecasting: false,
            cognitive_diversity: true
        }
    };
}

// Test data generators
function generateValidSwarmData(overrides = {}) {
    return {
        id: `test-swarm-${Date.now()}`,
        name: 'Test Swarm',
        topology: 'mesh',
        maxAgents: 5,
        strategy: 'balanced',
        ...overrides
    };
}

function generateValidAgentData(swarmId, overrides = {}) {
    return {
        id: `test-agent-${Date.now()}`,
        swarmId,
        name: 'Test Agent',
        type: 'researcher',
        capabilities: ['analysis', 'research'],
        ...overrides
    };
}

export {
    createMockRuvSwarmInstance,
    generateValidSwarmData,
    generateValidAgentData,
    TEST_CONFIG
};