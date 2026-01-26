/**
 * WebSocketManager Tests
 * Tests for channel subscription, event buffering, and reconnection handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketManager } from '../../src/services/WebSocketManager';
import { MockWebSocket, createMockEventServer } from '../mocks/websocket';

describe('WebSocketManager', () => {
  let manager: WebSocketManager;
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    // Save original WebSocket
    originalWebSocket = globalThis.WebSocket;
    // Replace with mock
    // @ts-expect-error - Mocking global WebSocket
    globalThis.WebSocket = MockWebSocket;
    MockWebSocket.clearInstances();

    manager = new WebSocketManager({
      url: 'ws://localhost:3001',
      maxReconnectAttempts: 3,
      reconnectDelay: 100,
      heartbeatInterval: 1000,
    });
  });

  afterEach(() => {
    manager.disconnect();
    // Restore original WebSocket
    globalThis.WebSocket = originalWebSocket;
    vi.clearAllTimers();
  });

  describe('Connection Management', () => {
    it('should connect to WebSocket server', async () => {
      const statusChanges: string[] = [];
      manager.onStatusChange((status) => statusChanges.push(status));

      await manager.connect();

      expect(statusChanges).toContain('connecting');
      expect(statusChanges).toContain('connected');
      expect(manager.isConnected()).toBe(true);
    });

    it('should handle connection failure', async () => {
      // Prevent auto-open
      // @ts-expect-error - Mocking global WebSocket with options
      globalThis.WebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super(url, { autoOpen: false });
        }
      };

      const newManager = new WebSocketManager({
        url: 'ws://localhost:3001',
        maxReconnectAttempts: 1,
        reconnectDelay: 10,
      });

      const connectPromise = newManager.connect();
      const ws = MockWebSocket.getLastInstance();
      ws?.simulateError(new Error('Connection refused'));

      await expect(connectPromise).rejects.toThrow();
    });

    it('should disconnect gracefully', async () => {
      await manager.connect();
      expect(manager.isConnected()).toBe(true);

      manager.disconnect();
      expect(manager.getStatus()).toBe('disconnected');
    });

    it('should return early if already connected', async () => {
      await manager.connect();
      expect(manager.isConnected()).toBe(true);

      // Connecting again should resolve immediately
      await manager.connect();
      expect(manager.isConnected()).toBe(true);
    });
  });

  describe('Channel Subscription', () => {
    it('should track subscribed channels', async () => {
      await manager.connect();

      manager.subscribe('agents');
      manager.subscribe('tasks');

      expect(manager.getSubscribedChannels()).toContain('agents');
      expect(manager.getSubscribedChannels()).toContain('tasks');
    });

    it('should send subscribe message to server', async () => {
      await manager.connect();

      manager.subscribe('agents');

      const ws = MockWebSocket.getLastInstance();
      const sent = ws?.getSentMessages();
      expect(sent?.some((m) => m.type === 'subscribe' && m.channel === 'agents')).toBe(true);
    });

    it('should unsubscribe from channels', async () => {
      await manager.connect();

      manager.subscribe('agents');
      expect(manager.getSubscribedChannels()).toContain('agents');

      manager.unsubscribe('agents');
      expect(manager.getSubscribedChannels()).not.toContain('agents');
    });

    it('should send unsubscribe message to server', async () => {
      await manager.connect();

      manager.subscribe('agents');
      manager.unsubscribe('agents');

      const ws = MockWebSocket.getLastInstance();
      const sent = ws?.getSentMessages();
      expect(sent?.some((m) => m.type === 'unsubscribe' && m.channel === 'agents')).toBe(true);
    });

    it('should resubscribe to channels on reconnect', async () => {
      await manager.connect();

      manager.subscribe('agents');
      manager.subscribe('tasks');

      // Disconnect and reconnect
      manager.disconnect();
      await manager.connect();

      const ws = MockWebSocket.getLastInstance();
      const sent = ws?.getSentMessages();

      // Check resubscription messages
      expect(sent?.filter((m) => m.type === 'subscribe' && m.channel === 'agents').length).toBe(1);
      expect(sent?.filter((m) => m.type === 'subscribe' && m.channel === 'tasks').length).toBe(1);
    });

    it('should handle subscribing before connection', () => {
      // Subscribe before connecting
      const result = manager.subscribe('agents');

      expect(result).toBe(true);
      expect(manager.getSubscribedChannels()).toContain('agents');
    });
  });

  describe('Event Buffering When Disconnected', () => {
    it('should not send messages when disconnected', () => {
      const result = manager.sendMessage({
        type: 'test',
        payload: {},
      });

      expect(result).toBe(false);
    });

    it('should send messages when connected', async () => {
      await manager.connect();

      const result = manager.sendMessage({
        type: 'subscribe',
        channel: 'agents',
      });

      expect(result).toBe(true);

      const ws = MockWebSocket.getLastInstance();
      const sent = ws?.getSentMessages();
      expect(sent?.some((m) => m.type === 'subscribe')).toBe(true);
    });
  });

  describe('Event Replay on Reconnect', () => {
    it('should maintain channel subscriptions across reconnect', async () => {
      await manager.connect();

      // Subscribe to channels
      manager.subscribe('agents');
      manager.subscribe('tasks');
      manager.subscribe('memory');

      const channels = manager.getSubscribedChannels();
      expect(channels).toHaveLength(3);

      // Simulate disconnect
      manager.disconnect();

      // Reconnect
      await manager.connect();

      // Verify subscriptions maintained
      const newChannels = manager.getSubscribedChannels();
      expect(newChannels).toContain('agents');
      expect(newChannels).toContain('tasks');
      expect(newChannels).toContain('memory');
    });
  });

  describe('Message Handling', () => {
    it('should route messages to type handlers', async () => {
      await manager.connect();

      const handler = vi.fn();
      manager.on('agent:status', handler);

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage({
        type: 'agent:status',
        payload: { agentId: 'test-1', status: 'active' },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:status',
          payload: expect.objectContaining({ agentId: 'test-1' }),
        })
      );
    });

    it('should route messages to channel handlers', async () => {
      await manager.connect();

      const handler = vi.fn();
      manager.onChannel('agents', handler);

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage({
        type: 'agent:status',
        channel: 'agents',
        payload: { agentId: 'test-1' },
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should support wildcard handlers', async () => {
      await manager.connect();

      const handler = vi.fn();
      manager.onAll(handler);

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage({ type: 'any-type', payload: {} });

      expect(handler).toHaveBeenCalled();
    });

    it('should allow unsubscribing from handlers', async () => {
      await manager.connect();

      const handler = vi.fn();
      const unsubscribe = manager.on('test', handler);

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage({ type: 'test', payload: {} });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      ws?.simulateMessage({ type: 'test', payload: {} });
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should handle malformed JSON messages', async () => {
      await manager.connect();

      const handler = vi.fn();
      manager.onAll(handler);

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage('invalid json string');

      // Should handle as raw message
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'raw', payload: 'invalid json string' })
      );
    });

    it('should add timestamp to messages without one', async () => {
      await manager.connect();

      const handler = vi.fn();
      manager.on('test', handler);

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage({ type: 'test', payload: {} });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Number),
        })
      );
    });

    it('should handle pong messages for heartbeat', async () => {
      await manager.connect();

      const handler = vi.fn();
      manager.onAll(handler);

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage({ type: 'pong' });

      // Pong messages should not be routed to handlers
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Status Changes', () => {
    it('should notify listeners of status changes', async () => {
      const listener = vi.fn();
      manager.onStatusChange(listener);

      await manager.connect();

      expect(listener).toHaveBeenCalledWith('connecting');
      expect(listener).toHaveBeenCalledWith('connected');
    });

    it('should allow removing status listeners', async () => {
      const listener = vi.fn();
      const unsubscribe = manager.onStatusChange(listener);

      unsubscribe();
      await manager.connect();

      expect(listener).not.toHaveBeenCalled();
    });

    it('should report correct status values', async () => {
      expect(manager.getStatus()).toBe('disconnected');

      const connectPromise = manager.connect();
      // Status immediately changes to connecting
      expect(manager.getStatus()).toBe('connecting');

      await connectPromise;
      expect(manager.getStatus()).toBe('connected');

      manager.disconnect();
      expect(manager.getStatus()).toBe('disconnected');
    });
  });

  describe('Handler Cleanup', () => {
    it('should clear all handlers', async () => {
      await manager.connect();

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.on('event1', handler1);
      manager.on('event2', handler2);

      manager.clearHandlers();

      const ws = MockWebSocket.getLastInstance();
      ws?.simulateMessage({ type: 'event1', payload: {} });
      ws?.simulateMessage({ type: 'event2', payload: {} });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('Mock Event Server Integration', () => {
    it('should work with mock event server for agent status', async () => {
      await manager.connect();

      const ws = MockWebSocket.getLastInstance()!;
      const eventServer = createMockEventServer(ws);

      const handler = vi.fn();
      manager.on('agent:status', handler);

      eventServer.emitAgentStatus('agent-1', 'active');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:status',
          payload: expect.objectContaining({
            agentId: 'agent-1',
            status: 'active',
          }),
        })
      );
    });

    it('should work with mock event server for task updates', async () => {
      await manager.connect();

      const ws = MockWebSocket.getLastInstance()!;
      const eventServer = createMockEventServer(ws);

      const handler = vi.fn();
      manager.on('task:update', handler);

      eventServer.emitTaskUpdate('task-1', 'completed');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task:update',
          payload: expect.objectContaining({
            taskId: 'task-1',
            status: 'completed',
          }),
        })
      );
    });

    it('should work with mock event server for messages', async () => {
      await manager.connect();

      const ws = MockWebSocket.getLastInstance()!;
      const eventServer = createMockEventServer(ws);

      const handler = vi.fn();
      manager.on('message:sent', handler);

      eventServer.emitMessage('agent-1', 'agent-2', { data: 'test' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message:sent',
          payload: expect.objectContaining({
            source: 'agent-1',
            target: 'agent-2',
            payload: { data: 'test' },
          }),
        })
      );
    });

    it('should work with mock event server for memory operations', async () => {
      await manager.connect();

      const ws = MockWebSocket.getLastInstance()!;
      const eventServer = createMockEventServer(ws);

      const handler = vi.fn();
      manager.on('memory:operation', handler);

      eventServer.emitMemoryOp('store', 'agent', 'state');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'memory:operation',
          payload: expect.objectContaining({
            operation: 'store',
            namespace: 'agent',
            key: 'state',
          }),
        })
      );
    });
  });

  describe('Error Handling in Handlers', () => {
    it('should continue processing other handlers if one throws', async () => {
      await manager.connect();

      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const normalHandler = vi.fn();

      manager.on('test', errorHandler);
      manager.on('test', normalHandler);

      const ws = MockWebSocket.getLastInstance();

      // Should not throw
      expect(() => {
        ws?.simulateMessage({ type: 'test', payload: {} });
      }).not.toThrow();

      expect(errorHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });
  });
});
