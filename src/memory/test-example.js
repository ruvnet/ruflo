/**
 * Test example for SharedMemory and SwarmMemory
 *
 * Demonstrates basic usage patterns
 */

import { SharedMemory, SwarmMemory, createMemory } from './index.js';

async function testSharedMemory() {
  console.log('=== Testing SharedMemory ===\n');

  const memory = new SharedMemory({
    directory: '.hive-mind',
    cacheSize: 100,
    cacheMemoryMB: 10,
  });

  try {
    await memory.initialize();
    console.log('✓ Initialized SharedMemory');

    // Store some data
    await memory.store('test-key', { message: 'Hello, World!' });
    console.log('✓ Stored test data');

    // Retrieve data
    const retrieved = await memory.retrieve('test-key');
    console.log('✓ Retrieved:', retrieved);

    // Store with TTL
    await memory.store('temp-key', 'Temporary data', {
      ttl: 60, // 60 seconds
      tags: ['temp', 'test'],
    });
    console.log('✓ Stored temporary data with TTL');

    // List entries
    const entries = await memory.list('default', { limit: 10 });
    console.log(`✓ Found ${entries.length} entries`);

    // Get statistics
    const stats = await memory.getStats();
    console.log('✓ Statistics:', stats);

    await memory.close();
    console.log('✓ Closed SharedMemory\n');
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

async function testSwarmMemory() {
  console.log('=== Testing SwarmMemory ===\n');

  const swarm = new SwarmMemory({
    swarmId: 'test-swarm',
    directory: '.swarm',
  });

  try {
    await swarm.initialize();
    console.log('✓ Initialized SwarmMemory');

    // Store agent
    await swarm.storeAgent('agent-1', {
      id: 'agent-1',
      name: 'Test Agent',
      type: 'coder',
      status: 'active',
      capabilities: ['javascript', 'python'],
    });
    console.log('✓ Stored agent');

    // Store task
    await swarm.storeTask('task-1', {
      id: 'task-1',
      description: 'Test task',
      priority: 'high',
      status: 'pending',
      assignedAgents: ['agent-1'],
    });
    console.log('✓ Stored task');

    // Update task status
    await swarm.updateTaskStatus('task-1', 'in_progress');
    console.log('✓ Updated task status');

    // Store pattern
    await swarm.storePattern('pattern-1', {
      id: 'pattern-1',
      type: 'optimization',
      confidence: 0.85,
      data: { strategy: 'parallel' },
    });
    console.log('✓ Stored pattern');

    // Get swarm stats
    const stats = await swarm.getSwarmStats();
    console.log('✓ Swarm statistics:', {
      agents: stats.swarm.agents,
      tasks: stats.swarm.tasks,
      patterns: stats.swarm.patterns,
    });

    await swarm.close();
    console.log('✓ Closed SwarmMemory\n');
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

async function testMemoryFactory() {
  console.log('=== Testing Memory Factory ===\n');

  // Create SharedMemory
  const shared = createMemory({ type: 'shared' });
  console.log('✓ Created SharedMemory via factory');

  // Create SwarmMemory
  const swarm = createMemory({ type: 'swarm', swarmId: 'factory-test' });
  console.log('✓ Created SwarmMemory via factory\n');
}

// Run tests
async function runTests() {
  await testSharedMemory();
  await testSwarmMemory();
  await testMemoryFactory();

  console.log('=== All tests completed ===');
}

// Only run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { testSharedMemory, testSwarmMemory, testMemoryFactory };
