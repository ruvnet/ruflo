/**
 * useWebSocket Hook Tests
 * Tests for WebSocket connection management, event handling, and buffering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebSocket } from '../../src/hooks';
import { MockWebSocket } from '../mocks/websocket';

describe('useWebSocket', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    // Save and replace WebSocket
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error - Mocking global WebSocket
    globalThis.WebSocket = MockWebSocket;
    MockWebSocket.clearInstances();
    // Don't use fake timers - the mock WebSocket already uses setTimeout internally
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.clearAllMocks();
  });

  describe('Connection Management', () => {
    describe('connect on mount', () => {
      it('should auto-connect when autoConnect is true (default)', async () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', { autoConnect: true })
        );

        await waitFor(() => {
          expect(result.current.connectionStatus).toBe('connected');
        }, { timeout: 1000 });
        expect(result.current.isConnected).toBe(true);
      });

      it('should not auto-connect when autoConnect is false', () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', { autoConnect: false })
        );

        expect(result.current.connectionStatus).toBe('disconnected');
        expect(result.current.isConnected).toBe(false);
      });

      it('should connect manually when connect() is called', async () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', { autoConnect: false })
        );

        expect(result.current.connectionStatus).toBe('disconnected');

        await act(async () => {
          await result.current.connect();
        });

        await waitFor(() => {
          expect(result.current.connectionStatus).toBe('connected');
        }, { timeout: 1000 });
      });
    });

    describe('auto-reconnect', () => {
      it('should track connection status changes', async () => {
        const onStatusChange = vi.fn();

        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', {
            autoConnect: true,
            onStatusChange,
          })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        expect(onStatusChange).toHaveBeenCalledWith('connecting');
        expect(onStatusChange).toHaveBeenCalledWith('connected');
      });

      it('should disconnect on close', async () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', {
            autoConnect: true,
          })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        // Simulate normal close
        const ws = MockWebSocket.getLastInstance();
        act(() => {
          ws?.simulateClose(1000, 'Normal closure');
        });

        await waitFor(() => {
          expect(result.current.connectionStatus).toBe('disconnected');
        }, { timeout: 1000 });
      });
    });

    describe('max reconnect attempts', () => {
      it('should stay disconnected when autoConnect is false', () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', {
            autoConnect: false,
            maxReconnectAttempts: 2,
          })
        );

        expect(result.current.connectionStatus).toBe('disconnected');
      });
    });

    describe('disconnect', () => {
      it('should disconnect manually', async () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', { autoConnect: true })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        act(() => {
          result.current.disconnect();
        });

        await waitFor(() => {
          expect(result.current.connectionStatus).toBe('disconnected');
        }, { timeout: 1000 });
        expect(result.current.isConnected).toBe(false);
      });

      it('should cleanup on unmount', async () => {
        const { result, unmount } = renderHook(() =>
          useWebSocket('ws://localhost:3001', { autoConnect: true })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        const ws = MockWebSocket.getLastInstance();

        unmount();

        // Verify WebSocket close was initiated (state is CLOSING or CLOSED)
        expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(ws?.readyState);
      });
    });
  });

  describe('Event Handling', () => {
    describe('parse and dispatch events', () => {
      it('should parse JSON messages and call onMessage', async () => {
        const onMessage = vi.fn();

        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', {
            autoConnect: true,
            onMessage,
            enableAggregation: false,
          })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        const ws = MockWebSocket.getLastInstance();
        const testMessage = {
          type: 'agent:status',
          payload: { agentId: 'test-1', status: 'active' },
        };

        act(() => {
          ws?.simulateMessage(testMessage);
        });

        expect(onMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'agent:status',
            payload: expect.objectContaining({ agentId: 'test-1' }),
          })
        );
      });

      it('should add events to buffer', async () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', {
            autoConnect: true,
            enableAggregation: false,
          })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        const ws = MockWebSocket.getLastInstance();

        act(() => {
          ws?.simulateMessage({ type: 'agent:status', payload: { agentId: 'test-1' } });
        });

        expect(result.current.eventBuffer.size()).toBeGreaterThan(0);
      });

      it('should dispatch events to type-specific handlers', async () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', { autoConnect: true })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        const handler = vi.fn();
        act(() => {
          result.current.on('agent:status', handler);
        });

        const ws = MockWebSocket.getLastInstance();
        act(() => {
          ws?.simulateMessage({
            type: 'agent:status',
            payload: { agentId: 'test-1' },
          });
        });

        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'agent:status' })
        );
      });
    });

    describe('buffer during reconnection', () => {
      it('should provide access to event buffer', () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', {
            autoConnect: false,
            bufferSize: 100,
          })
        );

        expect(result.current.eventBuffer).toBeDefined();
        expect(result.current.eventBuffer.size()).toBe(0);
      });

      it('should buffer events when connected', async () => {
        const { result } = renderHook(() =>
          useWebSocket('ws://localhost:3001', {
            autoConnect: true,
            enableAggregation: false,
          })
        );

        await waitFor(() => {
          expect(result.current.isConnected).toBe(true);
        }, { timeout: 1000 });

        const ws = MockWebSocket.getLastInstance();

        // Send multiple messages
        act(() => {
          ws?.simulateMessage({ type: 'event1', payload: { data: 1 } });
          ws?.simulateMessage({ type: 'event2', payload: { data: 2 } });
          ws?.simulateMessage({ type: 'event3', payload: { data: 3 } });
        });

        expect(result.current.eventBuffer.size()).toBe(3);
      });
    });
  });

  describe('Subscription', () => {
    it('should track subscribed channels', async () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: true })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      }, { timeout: 1000 });

      act(() => {
        result.current.subscribe('agents');
        result.current.subscribe('tasks');
      });

      expect(result.current.subscribedChannels).toContain('agents');
      expect(result.current.subscribedChannels).toContain('tasks');
    });

    it('should unsubscribe from channels', async () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: true })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      }, { timeout: 1000 });

      act(() => {
        result.current.subscribe('agents');
      });

      expect(result.current.subscribedChannels).toContain('agents');

      act(() => {
        result.current.unsubscribe('agents');
      });

      expect(result.current.subscribedChannels).not.toContain('agents');
    });

    it('should send subscribe message to server', async () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: true })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      }, { timeout: 1000 });

      act(() => {
        result.current.subscribe('agents');
      });

      const ws = MockWebSocket.getLastInstance();
      const sent = ws?.getSentMessages();
      expect(sent?.some(m => m.type === 'subscribe' && m.channel === 'agents')).toBe(true);
    });
  });

  describe('Send', () => {
    it('should send messages when connected', async () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: true })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      }, { timeout: 1000 });

      let sent = false;
      act(() => {
        sent = result.current.send({ type: 'test', payload: { data: 'test' } });
      });

      expect(sent).toBe(true);

      const ws = MockWebSocket.getLastInstance();
      const sentMessages = ws?.getSentMessages();
      expect(sentMessages?.some(m => m.type === 'test')).toBe(true);
    });

    it('should not send messages when disconnected', () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: false })
      );

      const sent = result.current.send({ type: 'test', payload: {} });
      expect(sent).toBe(false);
    });
  });

  describe('Status Changes', () => {
    it('should call onStatusChange callback on status transitions', async () => {
      const onStatusChange = vi.fn();

      renderHook(() =>
        useWebSocket('ws://localhost:3001', {
          autoConnect: true,
          onStatusChange,
        })
      );

      await waitFor(() => {
        expect(onStatusChange).toHaveBeenCalledWith('connecting');
        expect(onStatusChange).toHaveBeenCalledWith('connected');
      }, { timeout: 1000 });
    });

    it('should provide correct connectionStatus values', async () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: false })
      );

      expect(result.current.connectionStatus).toBe('disconnected');

      await act(async () => {
        await result.current.connect();
      });

      await waitFor(() => {
        expect(result.current.connectionStatus).toBe('connected');
      }, { timeout: 1000 });
    });
  });

  describe('Error Handling', () => {
    it('should track last error', () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: false })
      );

      expect(result.current.lastError).toBeNull();
    });

    it('should handle connection errors', async () => {
      const onStatusChange = vi.fn();
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', {
          autoConnect: true,
          onStatusChange,
        })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      }, { timeout: 1000 });

      const ws = MockWebSocket.getLastInstance();
      act(() => {
        // Simulate close which triggers reconnection or disconnection
        ws?.simulateClose(1006, 'Connection failed');
      });

      // After close, status should change from connected
      await waitFor(() => {
        expect(result.current.connectionStatus).not.toBe('connected');
      }, { timeout: 1000 });
    });
  });

  describe('Channel Handlers', () => {
    it('should register and invoke channel handlers', async () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: true })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      }, { timeout: 1000 });

      const handler = vi.fn();
      act(() => {
        result.current.onChannel('agents', handler);
      });

      const ws = MockWebSocket.getLastInstance();
      act(() => {
        ws?.simulateMessage({
          type: 'agent:update',
          channel: 'agents',
          payload: { agentId: 'test' },
        });
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should unsubscribe handlers correctly', async () => {
      const { result } = renderHook(() =>
        useWebSocket('ws://localhost:3001', { autoConnect: true })
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      }, { timeout: 1000 });

      const handler = vi.fn();
      let unsubscribe: () => void;

      act(() => {
        unsubscribe = result.current.on('test-event', handler);
      });

      const ws = MockWebSocket.getLastInstance();
      act(() => {
        ws?.simulateMessage({ type: 'test-event', payload: {} });
      });

      expect(handler).toHaveBeenCalledTimes(1);

      act(() => {
        unsubscribe();
      });

      act(() => {
        ws?.simulateMessage({ type: 'test-event', payload: {} });
      });

      // Should not be called again after unsubscribe
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
