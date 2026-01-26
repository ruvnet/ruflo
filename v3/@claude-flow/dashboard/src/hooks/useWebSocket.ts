/**
 * useWebSocket Hook
 * React hook for managing WebSocket connections
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  WebSocketManager,
  type ConnectionStatus,
  type WebSocketMessage,
  type EventHandler,
  type WebSocketManagerConfig,
} from '../services/WebSocketManager';
import { EventAggregator, type BatchedEvents } from '../services/EventAggregator';
import { EventBuffer } from '../services/EventBuffer';

export interface UseWebSocketOptions extends Partial<WebSocketManagerConfig> {
  autoConnect?: boolean;
  enableAggregation?: boolean;
  bufferSize?: number;
  onMessage?: EventHandler<WebSocketMessage>;
  onBatch?: (batch: BatchedEvents) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export interface UseWebSocketReturn {
  connectionStatus: ConnectionStatus;
  connect: () => Promise<void>;
  disconnect: () => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  send: (message: WebSocketMessage) => boolean;
  on: <T = unknown>(eventType: string, handler: EventHandler<T>) => () => void;
  onChannel: <T = unknown>(channel: string, handler: EventHandler<T>) => () => void;
  isConnected: boolean;
  subscribedChannels: string[];
  eventBuffer: EventBuffer;
  lastError: Error | null;
}

export function useWebSocket(
  url: string,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const {
    autoConnect = true,
    enableAggregation = true,
    bufferSize = 1000,
    maxReconnectAttempts = 10,
    reconnectDelay = 1000,
    heartbeatInterval = 30000,
    protocols,
    onMessage,
    onBatch,
    onStatusChange,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [subscribedChannels, setSubscribedChannels] = useState<string[]>([]);
  const [lastError, setLastError] = useState<Error | null>(null);

  // Refs for manager instances
  const managerRef = useRef<WebSocketManager | null>(null);
  const aggregatorRef = useRef<EventAggregator | null>(null);
  const bufferRef = useRef<EventBuffer>(new EventBuffer(bufferSize));

  // Initialize manager and aggregator
  useEffect(() => {
    // Create WebSocket manager
    managerRef.current = new WebSocketManager({
      url,
      maxReconnectAttempts,
      reconnectDelay,
      heartbeatInterval,
      protocols,
    });

    // Create event aggregator if enabled
    if (enableAggregation) {
      aggregatorRef.current = new EventAggregator();
    }

    // Subscribe to status changes
    const unsubscribeStatus = managerRef.current.onStatusChange((status) => {
      setConnectionStatus(status);
      onStatusChange?.(status);

      if (status === 'error') {
        setLastError(new Error('WebSocket connection error'));
      } else {
        setLastError(null);
      }
    });

    // Subscribe to all messages for buffering
    const unsubscribeMessages = managerRef.current.onAll((message: WebSocketMessage) => {
      // Call user's message handler
      onMessage?.(message);

      // Add to aggregator or buffer directly
      if (aggregatorRef.current) {
        aggregatorRef.current.addEvent(message);
      } else {
        const normalizedEvent = {
          id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          type: message.type,
          channel: message.channel,
          payload: message.payload,
          timestamp: message.timestamp ?? Date.now(),
          receivedAt: Date.now(),
        };
        bufferRef.current.add(normalizedEvent);
      }
    });

    // Subscribe to batches if aggregation is enabled
    let unsubscribeBatch: (() => void) | undefined;
    if (aggregatorRef.current) {
      unsubscribeBatch = aggregatorRef.current.onBatch((batch) => {
        // Add batch events to buffer
        bufferRef.current.addBatch(batch.events);
        // Call user's batch handler
        onBatch?.(batch);
      });
    }

    // Auto-connect if enabled
    if (autoConnect) {
      managerRef.current.connect().catch((error) => {
        console.error('Auto-connect failed:', error);
        setLastError(error as Error);
      });
    }

    // Cleanup
    return () => {
      unsubscribeStatus();
      unsubscribeMessages();
      unsubscribeBatch?.();
      managerRef.current?.disconnect();
      aggregatorRef.current?.destroy();
    };
  }, [
    url,
    autoConnect,
    enableAggregation,
    maxReconnectAttempts,
    reconnectDelay,
    heartbeatInterval,
    protocols,
    onMessage,
    onBatch,
    onStatusChange,
  ]);

  // Update subscribed channels when they change
  useEffect(() => {
    if (managerRef.current) {
      setSubscribedChannels(managerRef.current.getSubscribedChannels());
    }
  }, [connectionStatus]);

  // Connect method
  const connect = useCallback(async () => {
    if (!managerRef.current) {
      throw new Error('WebSocket manager not initialized');
    }

    try {
      await managerRef.current.connect();
      setLastError(null);
    } catch (error) {
      setLastError(error as Error);
      throw error;
    }
  }, []);

  // Disconnect method
  const disconnect = useCallback(() => {
    managerRef.current?.disconnect();
  }, []);

  // Subscribe method
  const subscribe = useCallback((channel: string) => {
    if (managerRef.current) {
      managerRef.current.subscribe(channel);
      setSubscribedChannels(managerRef.current.getSubscribedChannels());
    }
  }, []);

  // Unsubscribe method
  const unsubscribe = useCallback((channel: string) => {
    if (managerRef.current) {
      managerRef.current.unsubscribe(channel);
      setSubscribedChannels(managerRef.current.getSubscribedChannels());
    }
  }, []);

  // Send method
  const send = useCallback((message: WebSocketMessage): boolean => {
    if (!managerRef.current) {
      return false;
    }
    return managerRef.current.sendMessage(message);
  }, []);

  // Event handler registration
  const on = useCallback(<T = unknown>(eventType: string, handler: EventHandler<T>): (() => void) => {
    if (!managerRef.current) {
      return () => {};
    }
    return managerRef.current.on(eventType, handler);
  }, []);

  // Channel handler registration
  const onChannel = useCallback(<T = unknown>(channel: string, handler: EventHandler<T>): (() => void) => {
    if (!managerRef.current) {
      return () => {};
    }
    return managerRef.current.onChannel(channel, handler);
  }, []);

  return {
    connectionStatus,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    send,
    on,
    onChannel,
    isConnected: connectionStatus === 'connected',
    subscribedChannels,
    eventBuffer: bufferRef.current,
    lastError,
  };
}

export default useWebSocket;
