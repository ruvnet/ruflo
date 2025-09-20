import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { WebSocketCoordinator } from '../../coordination/websocket-coordinator.js';
import { WebSocketClient } from '../../coordination/websocket-client.js';
import { MemoryManager } from '../../memory/manager.js';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';
import WebSocket from 'ws';

// Configure logger for tests
Logger.configure({
  level: 'error', // Reduce noise in tests
  enableColors: false,
  enableTimestamp: false,
  outputs: ['console']
});

describe('WebSocketCoordinator', () => {
  let coordinator: WebSocketCoordinator;
  let memoryManager: MemoryManager;
  let eventBus: EventBus;
  let logger: Logger;
  const testPort = 8888;

  beforeAll(async () => {
    logger = Logger.getInstance();
    eventBus = EventBus.getInstance();
    memoryManager = new MemoryManager({
      backend: 'memory',
      namespace: 'test-websocket',
      cacheSizeMB: 10,
      syncOnExit: false,
      maxEntries: 1000,
      ttlMinutes: 60
    }, eventBus, logger);

    await memoryManager.initialize();
  });

  afterAll(async () => {
    await memoryManager.shutdown();
  });

  beforeEach(() => {
    coordinator = new WebSocketCoordinator({
      port: testPort,
      host: 'localhost',
      heartbeatInterval: 1000,
      heartbeatTimeout: 2000,
      maxConnections: 10,
      compressionEnabled: false // Disable for testing
    }, eventBus, memoryManager);
  });

  afterEach(async () => {
    await coordinator.stop();
  });

  describe('Server Lifecycle', () => {
    it('should start successfully', async () => {
      const startPromise = coordinator.start();
      await expect(startPromise).resolves.toBeUndefined();
      
      const health = await coordinator.getHealthStatus();
      expect(health.healthy).toBe(true);
    });

    it('should stop successfully', async () => {
      await coordinator.start();
      const stopPromise = coordinator.stop();
      await expect(stopPromise).resolves.toBeUndefined();
    });

    it('should handle multiple start attempts gracefully', async () => {
      await coordinator.start();
      const secondStart = coordinator.start();
      await expect(secondStart).resolves.toBeUndefined();
    });

    it('should emit coordinator events', async () => {
      let startEventEmitted = false;
      let stopEventEmitted = false;

      coordinator.on('coordinator-started', () => {
        startEventEmitted = true;
      });

      coordinator.on('coordinator-stopped', () => {
        stopEventEmitted = true;
      });

      await coordinator.start();
      expect(startEventEmitted).toBe(true);

      await coordinator.stop();
      expect(stopEventEmitted).toBe(true);
    });
  });

  describe('Client Connections', () => {
    beforeEach(async () => {
      await coordinator.start();
    });

    it('should accept client connections', async () => {
      let clientConnectedEvent: any = null;

      coordinator.on('client-connected', (data) => {
        clientConnectedEvent = data;
      });

      const ws = new WebSocket(`ws://localhost:${testPort}?agentId=test-agent`);
      
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          resolve();
        });
      });

      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for event

      expect(clientConnectedEvent).not.toBeNull();
      expect(clientConnectedEvent.agentId).toBe('test-agent');

      ws.close();
    });

    it('should handle client disconnections', async () => {
      let clientDisconnectedEvent: any = null;

      coordinator.on('client-disconnected', (data) => {
        clientDisconnectedEvent = data;
      });

      const ws = new WebSocket(`ws://localhost:${testPort}?agentId=test-agent`);
      
      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          resolve();
        });
      });

      ws.close();

      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for event

      expect(clientDisconnectedEvent).not.toBeNull();
      expect(clientDisconnectedEvent.agentId).toBe('test-agent');
    });

    it('should track connection statistics', async () => {
      const ws1 = new WebSocket(`ws://localhost:${testPort}?agentId=agent1`);
      const ws2 = new WebSocket(`ws://localhost:${testPort}?agentId=agent2`);

      await Promise.all([
        new Promise<void>((resolve) => ws1.on('open', resolve)),
        new Promise<void>((resolve) => ws2.on('open', resolve))
      ]);

      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for processing

      const stats = coordinator.getConnectionStats();
      expect(stats.activeConnections).toBe(2);

      const agents = coordinator.getConnectedAgents();
      expect(agents).toHaveLength(2);

      ws1.close();
      ws2.close();
    });

    it('should enforce connection limits', async () => {
      // Create coordinator with low connection limit
      await coordinator.stop();
      coordinator = new WebSocketCoordinator({
        port: testPort,
        host: 'localhost',
        maxConnections: 1
      }, eventBus, memoryManager);
      await coordinator.start();

      const ws1 = new WebSocket(`ws://localhost:${testPort}?agentId=agent1`);
      await new Promise<void>((resolve) => ws1.on('open', resolve));

      const ws2 = new WebSocket(`ws://localhost:${testPort}?agentId=agent2`);
      
      await new Promise<void>((resolve, reject) => {
        ws2.on('close', (code) => {
          expect(code).toBe(1013); // Server overloaded
          resolve();
        });
        ws2.on('open', () => {
          reject(new Error('Second connection should have been rejected'));
        });
      });

      ws1.close();
    });
  });

  describe('Message Handling', () => {
    let client1: WebSocket;
    let client2: WebSocket;

    beforeEach(async () => {
      await coordinator.start();
      
      client1 = new WebSocket(`ws://localhost:${testPort}?agentId=agent1`);
      client2 = new WebSocket(`ws://localhost:${testPort}?agentId=agent2`);

      await Promise.all([
        new Promise<void>((resolve) => client1.on('open', resolve)),
        new Promise<void>((resolve) => client2.on('open', resolve))
      ]);

      // Wait for welcome messages
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(() => {
      client1.close();
      client2.close();
    });

    it('should handle ping messages', async () => {
      const pingMessage = {
        id: 'ping-1',
        type: 'ping',
        from: 'agent1',
        timestamp: Date.now(),
        priority: 1
      };

      let pongReceived = false;
      client1.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'pong') {
          pongReceived = true;
        }
      });

      client1.send(JSON.stringify(pingMessage));

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(pongReceived).toBe(true);
    });

    it('should route direct messages', async () => {
      const directMessage = {
        id: 'msg-1',
        type: 'message',
        from: 'agent1',
        to: 'agent2',
        payload: { text: 'Hello agent2!' },
        timestamp: Date.now(),
        priority: 0
      };

      let messageReceived = false;
      client2.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'message' && message.payload.text === 'Hello agent2!') {
          messageReceived = true;
        }
      });

      client1.send(JSON.stringify(directMessage));

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(messageReceived).toBe(true);
    });

    it('should handle broadcast messages', async () => {
      const broadcastMessage = {
        id: 'broadcast-1',
        type: 'broadcast',
        from: 'agent1',
        payload: { announcement: 'Hello everyone!' },
        timestamp: Date.now(),
        priority: 0
      };

      let broadcastReceived = false;
      client2.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'broadcast' && message.payload.announcement === 'Hello everyone!') {
          broadcastReceived = true;
        }
      });

      client1.send(JSON.stringify(broadcastMessage));

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(broadcastReceived).toBe(true);
    });

    it('should handle request-response flow', async () => {
      const requestMessage = {
        id: 'req-1',
        type: 'request',
        from: 'agent1',
        to: 'agent2',
        payload: { question: 'What is your status?' },
        timestamp: Date.now(),
        priority: 1
      };

      // Set up agent2 to respond to requests
      client2.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'request') {
          const response = {
            id: 'resp-1',
            type: 'response',
            from: 'agent2',
            to: 'agent1',
            payload: { status: 'all good' },
            timestamp: Date.now(),
            priority: 1,
            responseId: message.id
          };
          client2.send(JSON.stringify(response));
        }
      });

      let responseReceived = false;
      client1.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'response' && message.payload.status === 'all good') {
          responseReceived = true;
        }
      });

      client1.send(JSON.stringify(requestMessage));

      await new Promise(resolve => setTimeout(resolve, 200));
      expect(responseReceived).toBe(true);
    });

    it('should handle heartbeat messages', async () => {
      const heartbeatMessage = {
        id: 'hb-1',
        type: 'heartbeat',
        from: 'agent1',
        payload: { 
          capabilities: ['test-capability'],
          status: 'active'
        },
        timestamp: Date.now(),
        priority: 1
      };

      let heartbeatResponseReceived = false;
      client1.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'heartbeat' && message.responseId === 'hb-1') {
          heartbeatResponseReceived = true;
        }
      });

      client1.send(JSON.stringify(heartbeatMessage));

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(heartbeatResponseReceived).toBe(true);
    });

    it('should handle invalid messages gracefully', async () => {
      let errorReceived = false;
      client1.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'error') {
          errorReceived = true;
        }
      });

      // Send invalid JSON
      client1.send('invalid-json');

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(errorReceived).toBe(true);
    });
  });

  describe('Health and Statistics', () => {
    beforeEach(async () => {
      await coordinator.start();
    });

    it('should report healthy status when running', async () => {
      const health = await coordinator.getHealthStatus();
      expect(health.healthy).toBe(true);
      expect(health.metrics).toBeDefined();
      expect(health.metrics!.activeConnections).toBe(0);
    });

    it('should track message statistics', async () => {
      const client = new WebSocket(`ws://localhost:${testPort}?agentId=test-agent`);
      await new Promise<void>((resolve) => client.on('open', resolve));

      // Send a few messages
      for (let i = 0; i < 3; i++) {
        client.send(JSON.stringify({
          id: `msg-${i}`,
          type: 'message',
          from: 'test-agent',
          payload: { data: `message ${i}` },
          timestamp: Date.now(),
          priority: 0
        }));
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = coordinator.getConnectionStats();
      expect(stats.totalMessages).toBeGreaterThan(0);

      client.close();
    });

    it('should track connection uptime', async () => {
      const stats1 = coordinator.getConnectionStats();
      const uptime1 = Date.now() - stats1.uptime;

      await new Promise(resolve => setTimeout(resolve, 100));

      const stats2 = coordinator.getConnectionStats();
      const uptime2 = Date.now() - stats2.uptime;

      expect(uptime2).toBeGreaterThan(uptime1);
    });
  });

  describe('Advanced Features', () => {
    beforeEach(async () => {
      await coordinator.start();
    });

    it('should support force disconnection', async () => {
      const client = new WebSocket(`ws://localhost:${testPort}?agentId=test-agent`);
      await new Promise<void>((resolve) => client.on('open', resolve));

      let disconnected = false;
      client.on('close', () => {
        disconnected = true;
      });

      // Force disconnect the agent
      const disconnectedCount = await coordinator.disconnectAgent('test-agent', 'Test disconnect');
      expect(disconnectedCount).toBe(1);

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(disconnected).toBe(true);
    });

    it('should update topology constraints dynamically', async () => {
      const client = new WebSocket(`ws://localhost:${testPort}?agentId=test-agent`);
      await new Promise<void>((resolve) => client.on('open', resolve));

      let topologyUpdated = false;
      coordinator.on('topology-updated', (data) => {
        expect(data.constraints).toBe('star');
        topologyUpdated = true;
      });

      coordinator.updateTopologyConstraints('star');
      expect(topologyUpdated).toBe(true);

      client.close();
    });
  });
});

describe('WebSocketClient', () => {
  let coordinator: WebSocketCoordinator;
  let client: WebSocketClient;
  let memoryManager: MemoryManager;
  let eventBus: EventBus;
  let logger: Logger;
  const testPort = 8889;

  beforeAll(async () => {
    logger = Logger.getInstance();
    eventBus = EventBus.getInstance();
    memoryManager = new MemoryManager({
      backend: 'memory',
      namespace: 'test-websocket-client',
      cacheSizeMB: 10,
      syncOnExit: false,
      maxEntries: 1000,
      ttlMinutes: 60
    }, eventBus, logger);

    await memoryManager.initialize();

    // Start coordinator for client tests
    coordinator = new WebSocketCoordinator({
      port: testPort,
      host: 'localhost',
      heartbeatInterval: 1000,
      heartbeatTimeout: 2000
    }, eventBus, memoryManager);
    await coordinator.start();
  });

  afterAll(async () => {
    await coordinator.stop();
    await memoryManager.shutdown();
  });

  beforeEach(() => {
    client = new WebSocketClient({
      url: `ws://localhost:${testPort}`,
      agentId: 'test-client-agent',
      capabilities: ['test-capability'],
      heartbeatInterval: 500,
      reconnection: false // Disable for testing
    });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      let connected = false;
      client.on('connected', () => {
        connected = true;
      });

      await client.connect();
      expect(client.isConnected()).toBe(true);
      expect(connected).toBe(true);
    });

    it('should disconnect gracefully', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);

      let disconnected = false;
      client.on('disconnected', () => {
        disconnected = true;
      });

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
      expect(disconnected).toBe(true);
    });

    it('should report connection statistics', async () => {
      await client.connect();

      const stats = client.getStats();
      expect(stats.connectionState).toBe('connected');
      expect(stats.reconnectAttempts).toBe(0);
      expect(stats.queuedMessages).toBe(0);
      expect(stats.pendingRequests).toBe(0);
    });

    it('should handle connection errors', async () => {
      // Create client with invalid URL
      const badClient = new WebSocketClient({
        url: 'ws://localhost:99999',
        agentId: 'bad-client'
      });

      let errorOccurred = false;
      badClient.on('error', () => {
        errorOccurred = true;
      });

      await expect(badClient.connect()).rejects.toThrow();
      expect(errorOccurred).toBe(true);

      await badClient.disconnect();
    });
  });

  describe('Message Sending', () => {
    beforeEach(async () => {
      await client.connect();
      // Wait for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should send direct messages', async () => {
      const messagePromise = client.send('test-recipient', { text: 'Hello!' });
      await expect(messagePromise).resolves.toBeUndefined();
    });

    it('should send broadcast messages', async () => {
      const broadcastPromise = client.broadcast({ announcement: 'Hello everyone!' });
      await expect(broadcastPromise).resolves.toBeUndefined();
    });

    it('should send heartbeat messages', async () => {
      const heartbeatPromise = client.sendHeartbeat({ status: 'active' });
      await expect(heartbeatPromise).resolves.toBeUndefined();
    });

    it('should queue messages when disconnected', async () => {
      await client.disconnect();

      // Configure client to queue messages
      client = new WebSocketClient({
        url: `ws://localhost:${testPort}`,
        agentId: 'queue-test-agent',
        queueSize: 10
      });

      // Send message while disconnected
      const sendPromise = client.send('test-recipient', { text: 'Queued message' });
      await expect(sendPromise).resolves.toBeUndefined();

      const stats = client.getStats();
      expect(stats.queuedMessages).toBe(1);
    });
  });

  describe('Message Handling', () => {
    let serverClient: WebSocket;

    beforeEach(async () => {
      await client.connect();
      
      // Create a server-side client for testing
      serverClient = new WebSocket(`ws://localhost:${testPort}?agentId=server-test-agent`);
      await new Promise<void>((resolve) => serverClient.on('open', resolve));
      
      // Wait for connections to stabilize
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(() => {
      serverClient.close();
    });

    it('should handle incoming messages', async () => {
      let messageReceived = false;
      client.on('message', (message) => {
        if (message.payload.text === 'Test message') {
          messageReceived = true;
        }
      });

      // Send message from server client
      const message = {
        id: 'server-msg-1',
        type: 'message',
        from: 'server-test-agent',
        to: 'test-client-agent',
        payload: { text: 'Test message' },
        timestamp: Date.now(),
        priority: 0
      };

      serverClient.send(JSON.stringify(message));

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(messageReceived).toBe(true);
    });

    it('should handle custom message types with handlers', async () => {
      let customMessageReceived = false;
      client.onMessage('custom-type', (message) => {
        customMessageReceived = true;
      });

      // Send custom message from server
      const message = {
        id: 'custom-msg-1',
        type: 'message',
        from: 'server-test-agent',
        to: 'test-client-agent',
        payload: { type: 'custom-type', data: 'custom data' },
        timestamp: Date.now(),
        priority: 0
      };

      serverClient.send(JSON.stringify(message));

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(customMessageReceived).toBe(true);
    });

    it('should handle initial state message', async () => {
      let initialStateReceived = false;
      client.on('initial-state', (payload) => {
        initialStateReceived = true;
        expect(payload).toBeDefined();
      });

      // The client should have received an initial state message on connection
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(initialStateReceived).toBe(true);
    });
  });

  describe('Capability Management', () => {
    beforeEach(async () => {
      await client.connect();
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should update capabilities', async () => {
      const newCapabilities = ['capability1', 'capability2', 'capability3'];
      client.updateCapabilities(newCapabilities);

      const stats = client.getStats();
      // The capabilities are sent via heartbeat, so we verify they were set
      expect(client['config'].capabilities).toEqual(newCapabilities);
    });
  });
});