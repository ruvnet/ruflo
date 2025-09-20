import { 
  WebSocketCoordinator, 
  WebSocketSwarmIntegration, 
  WebSocketClient,
  SwarmCoordinator 
} from '../coordination/index.js';
import { MemoryManager } from '../memory/manager.js';
import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';

/**
 * Example demonstrating the WebSocket coordination system
 * This shows how to set up real-time communication between agents
 */

async function setupWebSocketCoordination() {
  const logger = new Logger('WebSocketExample');
  const eventBus = EventBus.getInstance();
  
  // Initialize memory manager
  const memoryManager = new MemoryManager({
    backend: 'sqlite',
    namespace: 'websocket-example',
    cacheSizeMB: 50,
    syncOnExit: true,
    maxEntries: 10000,
    ttlMinutes: 60
  }, eventBus, logger);

  await memoryManager.initialize();

  // 1. Create and start WebSocket coordinator (server)
  const wsCoordinator = new WebSocketCoordinator({
    port: 8080,
    host: '0.0.0.0',
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000,
    maxConnections: 100,
    enableTopologyAware: true,
    topologyConstraints: 'mesh',
    enableMessagePersistence: true
  }, eventBus, memoryManager);

  // 2. Create swarm coordinator for agent orchestration
  const swarmCoordinator = new SwarmCoordinator({
    maxAgents: 20,
    maxConcurrentTasks: 10,
    enableMonitoring: true,
    enableWorkStealing: true,
    coordinationStrategy: 'hybrid'
  });

  // 3. Create WebSocket-Swarm integration
  const wsIntegration = new WebSocketSwarmIntegration({
    port: 8080,
    host: '0.0.0.0',
    enableSwarmIntegration: true,
    enableTaskBroadcast: true,
    enableAgentDiscovery: true,
    enableHealthReporting: true,
    taskUpdateInterval: 5000,
    agentStatusInterval: 10000
  }, eventBus, memoryManager);

  // 4. Start all systems
  console.log('🚀 Starting WebSocket coordination system...');
  
  await wsCoordinator.start();
  await swarmCoordinator.start();
  await wsIntegration.initialize(swarmCoordinator);

  console.log('✅ WebSocket coordination system started');
  console.log(`📡 WebSocket server listening on ws://localhost:8080`);

  // 5. Set up event listeners for monitoring
  wsCoordinator.on('client-connected', (data) => {
    console.log(`🔗 Agent connected: ${data.agentId} (client: ${data.clientId})`);
  });

  wsCoordinator.on('client-disconnected', (data) => {
    console.log(`❌ Agent disconnected: ${data.agentId} (client: ${data.clientId})`);
  });

  wsIntegration.on('agent-connected', (data) => {
    console.log(`🤖 Agent registered with swarm: ${data.agentId}`);
  });

  // 6. Create sample agents
  await createSampleAgents(wsCoordinator, swarmCoordinator);

  // 7. Demonstrate coordination capabilities
  await demonstrateCoordination(wsCoordinator, swarmCoordinator);

  return {
    wsCoordinator,
    swarmCoordinator,
    wsIntegration,
    memoryManager
  };
}

async function createSampleAgents(wsCoordinator: WebSocketCoordinator, swarmCoordinator: SwarmCoordinator) {
  console.log('\n🤖 Creating sample agents...');

  // Create different types of agents
  const agentConfigs = [
    {
      agentId: 'researcher-01',
      type: 'researcher' as const,
      capabilities: ['web-search', 'data-analysis', 'report-generation'],
      port: 8080
    },
    {
      agentId: 'coder-01', 
      type: 'coder' as const,
      capabilities: ['javascript', 'typescript', 'python', 'code-review'],
      port: 8080
    },
    {
      agentId: 'analyst-01',
      type: 'analyst' as const, 
      capabilities: ['data-processing', 'visualization', 'statistics'],
      port: 8080
    },
    {
      agentId: 'coordinator-01',
      type: 'coordinator' as const,
      capabilities: ['task-management', 'resource-allocation', 'monitoring'],
      port: 8080
    }
  ];

  const clients: WebSocketClient[] = [];

  for (const config of agentConfigs) {
    // Register agent with swarm
    await swarmCoordinator.registerAgent(
      config.agentId,
      config.type,
      config.capabilities
    );

    // Create WebSocket client for the agent
    const client = new WebSocketClient({
      url: `ws://localhost:${config.port}`,
      agentId: config.agentId,
      capabilities: config.capabilities,
      heartbeatInterval: 15000,
      reconnection: true,
      reconnectionAttempts: 5
    });

    // Set up agent message handlers
    setupAgentHandlers(client, config.agentId, config.type);

    // Connect to coordination system
    await client.connect();
    clients.push(client);

    console.log(`✅ Agent ${config.agentId} (${config.type}) connected`);
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`🎉 Created ${clients.length} sample agents`);
  return clients;
}

function setupAgentHandlers(client: WebSocketClient, agentId: string, agentType: string) {
  // Handle task assignments
  client.onMessage('task-assigned', async (message) => {
    console.log(`📋 ${agentId} received task: ${message.payload.task.description}`);
    
    // Simulate task processing
    await simulateTaskProcessing(message.payload.task);
    
    // Report task completion
    await client.send('swarm-coordinator', {
      type: 'task-update',
      taskId: message.payload.task.id,
      status: 'completed',
      result: {
        completedBy: agentId,
        completedAt: new Date().toISOString(),
        summary: `Task completed by ${agentType} agent`
      }
    });
  });

  // Handle direct messages from other agents
  client.on('message', (message) => {
    if (message.payload.type === 'collaboration-request') {
      console.log(`🤝 ${agentId} received collaboration request from ${message.payload.from}`);
      
      // Respond to collaboration request
      client.send(message.payload.from, {
        type: 'collaboration-response',
        from: agentId,
        response: 'accepted',
        capabilities: client['config'].capabilities
      });
    }
  });

  // Handle broadcast messages
  client.on('message', (message) => {
    if (message.payload.eventType === 'agent-registered') {
      console.log(`📢 ${agentId} learned about new agent: ${message.payload.data.agentId}`);
    }
  });

  // Send periodic status updates
  setInterval(async () => {
    await client.sendHeartbeat({
      status: 'active',
      currentLoad: Math.random() * 100,
      availableCapabilities: client['config'].capabilities,
      timestamp: Date.now()
    });
  }, 30000);
}

async function simulateTaskProcessing(task: any): Promise<void> {
  // Simulate different processing times based on task type
  const processingTime = {
    'research': 2000,
    'implementation': 5000,
    'analysis': 3000,
    'coordination': 1000,
    'default': 2500
  };

  const delay = processingTime[task.type as keyof typeof processingTime] || processingTime.default;
  await new Promise(resolve => setTimeout(resolve, delay));
}

async function demonstrateCoordination(wsCoordinator: WebSocketCoordinator, swarmCoordinator: SwarmCoordinator) {
  console.log('\n🚀 Demonstrating coordination capabilities...');

  // Wait a bit for agents to fully connect
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 1. Create a complex objective that requires multiple agents
  console.log('📋 Creating multi-agent objective...');
  const objectiveId = await swarmCoordinator.createObjective(
    'Build a comprehensive market analysis dashboard with real-time data visualization',
    'development'
  );

  // 2. Execute the objective
  console.log('⚡ Executing objective...');
  await swarmCoordinator.executeObjective(objectiveId);

  // 3. Monitor progress
  console.log('📊 Monitoring progress...');
  
  const progressMonitor = setInterval(async () => {
    const swarmStatus = swarmCoordinator.getSwarmStatus();
    const wsStats = wsCoordinator.getConnectionStats();
    
    console.log(`\n📈 Progress Update:
    - Objectives: ${swarmStatus.objectives}
    - Tasks: ${swarmStatus.tasks.completed}/${swarmStatus.tasks.total} completed
    - Active Agents: ${swarmStatus.agents.idle + swarmStatus.agents.busy}
    - WebSocket Connections: ${wsStats.activeConnections}
    - Messages Exchanged: ${wsStats.totalMessages}`);

    // Stop monitoring when objective is complete
    const objective = swarmCoordinator.getObjectiveStatus(objectiveId);
    if (objective && objective.status === 'completed') {
      clearInterval(progressMonitor);
      console.log('\n🎉 Objective completed successfully!');
      
      // Demonstrate real-time messaging
      await demonstrateRealTimeMessaging(wsCoordinator);
    }
  }, 3000);

  // Set timeout to prevent infinite monitoring
  setTimeout(() => {
    clearInterval(progressMonitor);
    console.log('\n⏰ Monitoring timeout reached');
  }, 30000);
}

async function demonstrateRealTimeMessaging(wsCoordinator: WebSocketCoordinator) {
  console.log('\n💬 Demonstrating real-time messaging...');

  // Get connected agents
  const connectedAgents = wsCoordinator.getConnectedAgents();
  
  if (connectedAgents.length < 2) {
    console.log('❌ Need at least 2 agents for messaging demo');
    return;
  }

  // 1. Direct messaging between agents
  console.log('📞 Direct messaging between agents...');
  try {
    const response = await wsCoordinator.sendMessageWithResponse(
      'coordinator-demo',
      connectedAgents[0].agentId,
      {
        type: 'collaboration-request',
        from: 'demo-system',
        message: 'Would you like to collaborate on the next task?',
        urgency: 'high'
      },
      5000
    );
    console.log('✅ Received response:', response);
  } catch (error) {
    console.log('❌ Direct messaging failed:', error);
  }

  // 2. Broadcast messaging
  console.log('📢 Broadcasting announcement to all agents...');
  const deliveredCount = await wsCoordinator.broadcastMessage(
    'demo-system',
    {
      type: 'system-announcement',
      message: 'System maintenance scheduled for tonight at 2 AM UTC',
      priority: 'high',
      timestamp: Date.now()
    }
  );
  console.log(`✅ Broadcast delivered to ${deliveredCount} agents`);

  // 3. Health check
  console.log('🏥 Performing health check...');
  const health = await wsCoordinator.getHealthStatus();
  console.log('Health Status:', {
    healthy: health.healthy,
    activeConnections: health.metrics?.activeConnections,
    totalMessages: health.metrics?.totalMessages,
    uptime: health.metrics?.uptime ? Math.round(health.metrics.uptime / 1000) + 's' : 'unknown'
  });
}

async function cleanupExample(components: any) {
  console.log('\n🧹 Cleaning up example...');
  
  try {
    await components.wsIntegration.shutdown();
    await components.swarmCoordinator.stop();
    await components.wsCoordinator.stop();
    await components.memoryManager.shutdown();
    
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
}

// Main execution
async function main() {
  console.log('🎯 WebSocket Coordination System Example');
  console.log('========================================\n');

  try {
    const components = await setupWebSocketCoordination();
    
    // Run for a while then cleanup
    setTimeout(async () => {
      await cleanupExample(components);
      process.exit(0);
    }, 60000); // Run for 1 minute

  } catch (error) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Export for use in other modules
export {
  setupWebSocketCoordination,
  createSampleAgents,
  demonstrateCoordination,
  demonstrateRealTimeMessaging
};

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}