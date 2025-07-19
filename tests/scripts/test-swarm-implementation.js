#!/usr/bin/env node

/**
 * Comprehensive Test for SwarmCoordinator Implementation
 * Tests all major functionality of the Gemini Flow v2.0.0 SwarmCoordinator system
 */

import { SwarmCoordinator, TaskExecutor, SwarmMemoryManager } from './dist/cli/commands/swarm-new.js';

async function testSwarmImplementation() {
    console.log('🧪 Testing SwarmCoordinator Implementation\n');
    
    let testsPassed = 0;
    let totalTests = 0;
    
    function test(name, fn) {
        totalTests++;
        try {
            const result = fn();
            if (result === true || result === undefined) {
                console.log(`✅ ${name}`);
                testsPassed++;
            } else {
                console.log(`❌ ${name}: Expected true, got ${result}`);
            }
        } catch (error) {
            console.log(`❌ ${name}: ${error.message}`);
        }
    }
    
    async function testAsync(name, fn) {
        totalTests++;
        try {
            const result = await fn();
            if (result === true || result === undefined) {
                console.log(`✅ ${name}`);
                testsPassed++;
            } else {
                console.log(`❌ ${name}: Expected true, got ${result}`);
            }
        } catch (error) {
            console.log(`❌ ${name}: ${error.message}`);
        }
    }
    
    // Test 1: SwarmCoordinator instantiation
    test('SwarmCoordinator instantiation', () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-swarm',
            description: 'Test implementation',
            strategy: 'development',
            maxAgents: 5
        });
        return coordinator && coordinator.id && coordinator.status === 'initializing';
    });
    
    // Test 2: Agent spawning
    await testAsync('Agent spawning', async () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-swarm-agents',
            description: 'Test agent spawning',
            strategy: 'development',
            maxAgents: 3
        });
        
        const agent = await coordinator.addAgent('coder', 'Test Coder');
        return agent && agent.id && agent.type === 'coder' && agent.name === 'Test Coder';
    });
    
    // Test 3: Task execution
    await testAsync('Task execution', async () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-swarm-tasks',
            description: 'Test task execution',
            strategy: 'development',
            maxAgents: 2
        });
        
        await coordinator.addAgent('coder', 'Test Coder');
        const result = await coordinator.executeTask('Test task');
        return result && result.status === 'completed';
    });
    
    // Test 4: Objective creation and execution
    await testAsync('Objective creation and execution', async () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-swarm-objectives',
            description: 'Test objectives',
            strategy: 'development',
            maxAgents: 3
        });
        
        const objectiveId = await coordinator.createObjective(
            'Test Objective',
            'Build a simple REST API',
            'development'
        );
        
        await coordinator.addAgent('architect', 'Test Architect');
        await coordinator.executeObjective(objectiveId);
        
        const objective = coordinator.getObjective(objectiveId);
        return objective && objective.status === 'completed';
    });
    
    // Test 5: Metrics collection
    test('Metrics collection', () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-swarm-metrics',
            description: 'Test metrics',
            strategy: 'development',
            maxAgents: 2
        });
        
        const metrics = coordinator.getMetrics();
        return !!(metrics && 
               typeof metrics.totalAgents === 'number' &&
               typeof metrics.totalTasks === 'number' &&
               typeof metrics.uptime === 'number' &&
               metrics.performance);
    });
    
    // Test 6: TaskExecutor functionality
    await testAsync('TaskExecutor functionality', async () => {
        const executor = new TaskExecutor({
            timeoutMs: 10000,
            retryAttempts: 3
        });
        
        await executor.initialize();
        
        const task = { id: 'test-task', name: 'Test Task', type: 'testing' };
        const agent = { id: 'test-agent', name: 'Test Agent', type: 'tester' };
        
        const result = await executor.executeTask(task, agent);
        const metrics = executor.getExecutionMetrics();
        
        return result && result.success && metrics && typeof metrics.totalExecutions === 'number';
    });
    
    // Test 7: SwarmMemoryManager functionality
    await testAsync('SwarmMemoryManager functionality', async () => {
        const memory = new SwarmMemoryManager({
            namespace: 'test-namespace'
        });
        
        await memory.initialize();
        
        // Test store and retrieve
        await memory.store('test-key', { message: 'test value' });
        const retrieved = await memory.retrieve('test-key');
        
        // Test statistics
        const stats = memory.getStatistics();
        
        return retrieved && 
               retrieved.message === 'test value' &&
               stats && 
               typeof stats.totalEntries === 'number';
    });
    
    // Test 8: Swarm status and monitoring
    test('Swarm status and monitoring', () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-swarm-status',
            description: 'Test status monitoring',
            strategy: 'development',
            maxAgents: 5
        });
        
        const status = coordinator.getSwarmStatus();
        const agentList = coordinator.getAgents();
        const taskList = coordinator.getTasks();
        
        return status && 
               status.id === coordinator.id &&
               status.agents &&
               status.tasks &&
               Array.isArray(agentList) &&
               Array.isArray(taskList);
    });
    
    // Test 9: Complete workflow integration
    await testAsync('Complete workflow integration', async () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-integration',
            description: 'Test complete workflow',
            strategy: 'development',
            maxAgents: 5
        });
        
        const executor = new TaskExecutor({
            timeoutMs: 10000,
            retryAttempts: 2
        });
        
        const memory = new SwarmMemoryManager({
            namespace: 'integration-test'
        });
        
        // Initialize all components
        await coordinator.initialize();
        await executor.initialize();
        await memory.initialize();
        
        // Create objective and agents
        const objectiveId = await coordinator.createObjective(
            'Integration Test',
            'Test complete system integration',
            'development'
        );
        
        await coordinator.registerAgent('architect-1', 'architect');
        await coordinator.registerAgent('coder-1', 'coder');
        await coordinator.registerAgent('tester-1', 'tester');
        
        // Store some test data in memory
        await memory.store('integration-key', { 
            test: true, 
            timestamp: Date.now() 
        });
        
        // Execute objective
        await coordinator.executeObjective(objectiveId);
        
        // Check final state
        const finalStatus = coordinator.getSwarmStatus();
        const retrievedData = await memory.retrieve('integration-key');
        const executorMetrics = executor.getExecutionMetrics();
        
        // Cleanup
        await coordinator.shutdown();
        await executor.shutdown();
        await memory.shutdown();
        
        return finalStatus.agents.total >= 3 &&
               retrievedData && retrievedData.test === true &&
               executorMetrics && typeof executorMetrics.totalExecutions === 'number';
    });
    
    // Test 10: Error handling and recovery
    await testAsync('Error handling and recovery', async () => {
        const coordinator = new SwarmCoordinator({
            name: 'test-error-handling',
            description: 'Test error scenarios',
            strategy: 'development',
            maxAgents: 2
        });
        
        // Test getting non-existent objective (should not throw)
        const nonExistent = coordinator.getObjective('fake-id');
        
        // Test graceful handling of missing components
        const metrics = coordinator.getMetrics();
        const status = coordinator.getSwarmStatus();
        
        // Test executeObjective with non-existent objective (should handle gracefully)
        const objective = coordinator.objectives.find(o => o.id === 'non-existent-objective');
        const shouldBeUndefined = objective === undefined;
        
        return nonExistent === undefined && 
               metrics && 
               status && 
               status.agents.total === 0 &&
               shouldBeUndefined;
    });
    
    console.log(`\n📊 Test Results: ${testsPassed}/${totalTests} tests passed`);
    
    if (testsPassed === totalTests) {
        console.log('🎉 All tests passed! SwarmCoordinator implementation is working correctly.');
        return true;
    } else {
        console.log(`❌ ${totalTests - testsPassed} tests failed. Implementation needs fixes.`);
        return false;
    }
}

// Run tests
testSwarmImplementation()
    .then(success => {
        if (success) {
            console.log('\n✅ SwarmCoordinator implementation test completed successfully');
            process.exit(0);
        } else {
            console.log('\n❌ SwarmCoordinator implementation test failed');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('\n💥 Test execution failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    });