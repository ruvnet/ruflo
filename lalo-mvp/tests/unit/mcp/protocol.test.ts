/**
 * MCP (Model Control Protocol) Unit Tests
 * Tests for protocol handling, coordination, and message processing
 */

import { MCPHandler, MCPMessage, MCPNode, MCPCoordinator } from '../../../src/mcp';

describe('MCP Protocol Handler', () => {
  let mcpHandler: MCPHandler;
  let mockNode: MCPNode;
  let coordinator: MCPCoordinator;

  beforeEach(() => {
    mockNode = {
      id: 'node-123',
      type: 'agent',
      status: 'active',
      capabilities: ['process', 'coordinate'],
      metadata: { version: '1.0.0' }
    };

    mcpHandler = new MCPHandler({
      nodeId: mockNode.id,
      port: 3001,
      timeout: 5000,
      retryAttempts: 3
    });

    coordinator = new MCPCoordinator({
      topology: 'mesh',
      maxNodes: 10,
      heartbeatInterval: 1000
    });
  });

  describe('Message Processing', () => {
    test('should process coordination messages correctly', async () => {
      const message: MCPMessage = {
        id: 'msg-123',
        type: 'coordination',
        from: 'node-456',
        to: 'node-123',
        data: {
          action: 'sync',
          payload: { state: 'processing' }
        },
        timestamp: new Date()
      };

      const response = await mcpHandler.processMessage(message);

      expect(response).toBeDefined();
      expect(response.status).toBe('acknowledged');
      expect(response.messageId).toBe(message.id);
      expect(response.nodeId).toBe(mockNode.id);
    });

    test('should handle task assignment messages', async () => {
      const taskMessage: MCPMessage = {
        id: 'task-456',
        type: 'task_assignment',
        from: 'coordinator',
        to: mockNode.id,
        data: {
          taskId: 'task-789',
          type: 'analysis',
          priority: 'high',
          deadline: new Date(Date.now() + 60000), // 1 minute from now
          payload: { data: 'test-data' }
        },
        timestamp: new Date()
      };

      const response = await mcpHandler.processMessage(taskMessage);

      expect(response.status).toBe('accepted');
      expect(response.data.taskId).toBe('task-789');

      // Check that task was queued
      const queuedTasks = mcpHandler.getQueuedTasks();
      expect(queuedTasks).toHaveLength(1);
      expect(queuedTasks[0].id).toBe('task-789');
    });

    test('should validate message format', async () => {
      const invalidMessage = {
        id: 'invalid',
        // Missing required fields
        data: { test: 'data' }
      };

      await expect(mcpHandler.processMessage(invalidMessage as any))
        .rejects.toThrow('Invalid message format');
    });

    test('should handle message routing', async () => {
      const routingMessage: MCPMessage = {
        id: 'route-123',
        type: 'routing',
        from: 'node-456',
        to: 'node-789', // Not this node
        data: { route: ['node-123', 'node-789'] },
        timestamp: new Date()
      };

      const forwardSpy = jest.spyOn(mcpHandler, 'forwardMessage');
      await mcpHandler.processMessage(routingMessage);

      expect(forwardSpy).toHaveBeenCalledWith(routingMessage, 'node-789');
    });
  });

  describe('Node Registration and Discovery', () => {
    test('should register node with coordinator', async () => {
      const registerSpy = jest.spyOn(coordinator, 'registerNode');

      await mcpHandler.registerWithCoordinator(coordinator, mockNode);

      expect(registerSpy).toHaveBeenCalledWith(mockNode);

      const registeredNodes = coordinator.getNodes();
      expect(registeredNodes).toContainEqual(mockNode);
    });

    test('should handle node discovery', async () => {
      await coordinator.registerNode(mockNode);

      const discoveredNodes = await mcpHandler.discoverNodes();
      expect(discoveredNodes).toContainEqual(expect.objectContaining({
        id: mockNode.id,
        type: mockNode.type
      }));
    });

    test('should update node status', async () => {
      await coordinator.registerNode(mockNode);

      await mcpHandler.updateNodeStatus('processing');

      const updatedNode = coordinator.getNode(mockNode.id);
      expect(updatedNode.status).toBe('processing');
    });

    test('should handle node deregistration', async () => {
      await coordinator.registerNode(mockNode);
      expect(coordinator.getNodes()).toHaveLength(1);

      await mcpHandler.deregister();

      expect(coordinator.getNodes()).toHaveLength(0);
    });
  });

  describe('Heartbeat and Health Monitoring', () => {
    test('should send heartbeat messages', async () => {
      const heartbeatSpy = jest.spyOn(coordinator, 'receiveHeartbeat');

      mcpHandler.startHeartbeat(coordinator);

      // Wait for heartbeat interval
      await global.testUtils.delay(1100);

      expect(heartbeatSpy).toHaveBeenCalledWith(mockNode.id, expect.any(Object));

      mcpHandler.stopHeartbeat();
    });

    test('should detect unhealthy nodes', async () => {
      const unhealthyNode = {
        id: 'unhealthy-node',
        type: 'agent',
        status: 'active',
        capabilities: [],
        lastHeartbeat: new Date(Date.now() - 10000) // 10 seconds ago
      };

      coordinator.registerNode(unhealthyNode);

      const healthCheck = coordinator.performHealthCheck();
      const unhealthyNodes = healthCheck.unhealthyNodes;

      expect(unhealthyNodes).toContainEqual(expect.objectContaining({
        id: 'unhealthy-node'
      }));
    });

    test('should handle node recovery', async () => {
      const recoveringNode = {
        id: 'recovering-node',
        type: 'agent',
        status: 'error',
        capabilities: [],
        metadata: {}
      };

      coordinator.registerNode(recoveringNode);

      // Simulate recovery
      await coordinator.handleNodeRecovery('recovering-node');

      const recoveredNode = coordinator.getNode('recovering-node');
      expect(recoveredNode.status).toBe('active');
    });
  });

  describe('Load Balancing and Task Distribution', () => {
    test('should distribute tasks based on node capacity', async () => {
      const nodes = [
        { id: 'node-1', capabilities: ['process'], load: 0.2 },
        { id: 'node-2', capabilities: ['process'], load: 0.8 },
        { id: 'node-3', capabilities: ['process'], load: 0.1 }
      ];

      nodes.forEach(node => coordinator.registerNode(node));

      const task = {
        id: 'task-123',
        type: 'process',
        priority: 'medium',
        estimatedLoad: 0.3
      };

      const selectedNode = coordinator.selectNodeForTask(task);

      // Should select node-3 (lowest load)
      expect(selectedNode.id).toBe('node-3');
    });

    test('should handle task priority in distribution', async () => {
      const highPriorityTask = {
        id: 'urgent-task',
        type: 'analysis',
        priority: 'high',
        deadline: new Date(Date.now() + 30000)
      };

      const lowPriorityTask = {
        id: 'normal-task',
        type: 'analysis',
        priority: 'low',
        deadline: new Date(Date.now() + 300000)
      };

      coordinator.queueTask(lowPriorityTask);
      coordinator.queueTask(highPriorityTask);

      const nextTask = coordinator.getNextTask();
      expect(nextTask.id).toBe('urgent-task'); // High priority first
    });

    test('should balance load across available nodes', async () => {
      const nodes = Array(5).fill(null).map((_, i) => ({
        id: `node-${i}`,
        capabilities: ['process'],
        load: 0,
        maxLoad: 1.0
      }));

      nodes.forEach(node => coordinator.registerNode(node));

      const tasks = Array(10).fill(null).map((_, i) => ({
        id: `task-${i}`,
        type: 'process',
        estimatedLoad: 0.2
      }));

      tasks.forEach(task => {
        const selectedNode = coordinator.selectNodeForTask(task);
        coordinator.assignTaskToNode(task, selectedNode.id);
      });

      // Check that load is distributed
      const nodeLoads = coordinator.getNodes().map(n => n.load);
      const maxLoad = Math.max(...nodeLoads);
      const minLoad = Math.min(...nodeLoads);

      expect(maxLoad - minLoad).toBeLessThan(0.5); // Load should be balanced
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle message processing errors', async () => {
      const faultyMessage: MCPMessage = {
        id: 'faulty-msg',
        type: 'invalid_type' as any,
        from: 'node-456',
        to: mockNode.id,
        data: { corrupted: true },
        timestamp: new Date()
      };

      const response = await mcpHandler.processMessage(faultyMessage);

      expect(response.status).toBe('error');
      expect(response.error).toBeDefined();
    });

    test('should implement retry logic for failed operations', async () => {
      let attempts = 0;
      const failingOperation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) throw new Error('Temporary failure');
        return { success: true };
      });

      mcpHandler.setRetryStrategy({
        maxAttempts: 3,
        backoffMs: 100
      });

      const result = await mcpHandler.executeWithRetry(failingOperation);

      expect(attempts).toBe(3);
      expect(result.success).toBe(true);
    });

    test('should handle network partitions gracefully', async () => {
      // Simulate network partition
      coordinator.simulateNetworkPartition(['node-1', 'node-2'], ['node-3', 'node-4']);

      const partition1Nodes = coordinator.getNodesInPartition('partition-1');
      const partition2Nodes = coordinator.getNodesInPartition('partition-2');

      expect(partition1Nodes).toHaveLength(2);
      expect(partition2Nodes).toHaveLength(2);

      // Test that nodes in same partition can communicate
      const message = {
        id: 'test-msg',
        type: 'coordination',
        from: 'node-1',
        to: 'node-2',
        data: {},
        timestamp: new Date()
      };

      const canCommunicate = coordinator.canNodesCommunciate('node-1', 'node-2');
      expect(canCommunicate).toBe(true);

      const cannotCommunicate = coordinator.canNodesCommunciate('node-1', 'node-3');
      expect(cannotCommunicate).toBe(false);
    });
  });

  describe('Protocol Versioning', () => {
    test('should handle protocol version compatibility', async () => {
      const oldVersionNode = {
        id: 'old-node',
        protocolVersion: '1.0.0',
        capabilities: ['basic']
      };

      const newVersionNode = {
        id: 'new-node',
        protocolVersion: '2.0.0',
        capabilities: ['basic', 'advanced']
      };

      const compatibility = mcpHandler.checkProtocolCompatibility(
        oldVersionNode.protocolVersion,
        newVersionNode.protocolVersion
      );

      expect(compatibility.compatible).toBe(true);
      expect(compatibility.commonFeatures).toContain('basic');
    });

    test('should handle protocol negotiation', async () => {
      const negotiationRequest = {
        requestedVersion: '2.0.0',
        supportedFeatures: ['coordination', 'load-balancing', 'heartbeat']
      };

      const negotiationResult = await mcpHandler.negotiateProtocol(negotiationRequest);

      expect(negotiationResult.agreedVersion).toBeDefined();
      expect(negotiationResult.enabledFeatures).toEqual(
        expect.arrayContaining(['coordination', 'heartbeat'])
      );
    });
  });

  describe('Security and Authentication', () => {
    test('should validate message signatures', async () => {
      const signedMessage: MCPMessage = {
        id: 'signed-msg',
        type: 'coordination',
        from: 'node-456',
        to: mockNode.id,
        data: { action: 'sync' },
        timestamp: new Date(),
        signature: 'mock-signature',
        publicKey: 'mock-public-key'
      };

      const isValid = await mcpHandler.validateMessageSignature(signedMessage);
      expect(isValid).toBe(true); // Assuming valid signature
    });

    test('should enforce access control for sensitive operations', async () => {
      const privilegedMessage: MCPMessage = {
        id: 'admin-msg',
        type: 'admin_command',
        from: 'node-456',
        to: mockNode.id,
        data: { command: 'shutdown' },
        timestamp: new Date()
      };

      const hasPermission = await mcpHandler.checkPermission(
        privilegedMessage.from,
        'admin_command'
      );

      if (!hasPermission) {
        const response = await mcpHandler.processMessage(privilegedMessage);
        expect(response.status).toBe('unauthorized');
      }
    });
  });

  describe('Hive Mind Integration', () => {
    test('should coordinate with hive collective intelligence', async () => {
      const hiveCoordinationMessage: MCPMessage = {
        id: 'hive-coord',
        type: 'hive_coordination',
        from: 'hive-controller',
        to: mockNode.id,
        data: {
          collective_task: 'analyze_patterns',
          participation_required: true,
          consensus_threshold: 0.7
        },
        timestamp: new Date()
      };

      const response = await mcpHandler.processMessage(hiveCoordinationMessage);

      expect(response.status).toBe('participating');
      expect(response.data.nodeContribution).toBeDefined();
    });

    test('should share learning across hive nodes', async () => {
      const learningData = {
        pattern: 'optimization_strategy',
        effectiveness: 0.85,
        context: 'database_queries',
        metadata: { samples: 1000 }
      };

      await mcpHandler.shareLearningWithHive(learningData);

      const sharedLearning = await mcpHandler.getHiveLearning('optimization_strategy');
      expect(sharedLearning).toContainEqual(expect.objectContaining({
        effectiveness: 0.85,
        context: 'database_queries'
      }));
    });

    test('should participate in collective decision making', async () => {
      const decisionRequest = {
        id: 'decision-123',
        topic: 'resource_allocation',
        options: ['strategy_a', 'strategy_b', 'strategy_c'],
        deadline: new Date(Date.now() + 60000)
      };

      const vote = await mcpHandler.participateInDecision(decisionRequest);

      expect(vote.option).toBeDefined();
      expect(vote.confidence).toBeGreaterThan(0);
      expect(vote.reasoning).toBeDefined();
    });
  });
});