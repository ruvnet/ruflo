/**
 * WebSocket Mock for Testing
 * Provides a controllable mock WebSocket for unit tests
 */

import type { WebSocketMessage } from '../../src/services/WebSocketManager';

export interface MockWebSocketOptions {
  autoOpen?: boolean;
  delay?: number;
}

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  protocol = '';
  extensions = '';
  bufferedAmount = 0;
  binaryType: BinaryType = 'blob';

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private sentMessages: WebSocketMessage[] = [];
  private options: MockWebSocketOptions;

  constructor(url: string, options: MockWebSocketOptions = {}) {
    this.url = url;
    this.options = {
      autoOpen: true,
      delay: 0,
      ...options,
    };

    MockWebSocket.instances.push(this);

    if (this.options.autoOpen) {
      this.simulateOpen();
    }
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }

    try {
      const message = JSON.parse(data) as WebSocketMessage;
      this.sentMessages.push(message);
    } catch {
      this.sentMessages.push({ type: 'raw', payload: data });
    }
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }

    this.readyState = MockWebSocket.CLOSING;

    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.(
        new CloseEvent('close', {
          code: code ?? 1000,
          reason: reason ?? '',
          wasClean: true,
        })
      );
    }, this.options.delay);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    switch (type) {
      case 'open':
        this.onopen = listener as (event: Event) => void;
        break;
      case 'close':
        this.onclose = listener as (event: CloseEvent) => void;
        break;
      case 'error':
        this.onerror = listener as (event: Event) => void;
        break;
      case 'message':
        this.onmessage = listener as (event: MessageEvent) => void;
        break;
    }
  }

  removeEventListener(): void {
    // No-op for mock
  }

  dispatchEvent(): boolean {
    return true;
  }

  // Test helper methods

  simulateOpen(): void {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, this.options.delay);
  }

  simulateMessage(data: WebSocketMessage | string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      return;
    }

    const messageData = typeof data === 'string' ? data : JSON.stringify(data);

    this.onmessage?.(
      new MessageEvent('message', {
        data: messageData,
      })
    );
  }

  simulateError(error?: Error): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onerror?.(
      new ErrorEvent('error', {
        error: error ?? new Error('WebSocket error'),
        message: error?.message ?? 'WebSocket error',
      })
    );
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(
      new CloseEvent('close', {
        code,
        reason,
        wasClean: code === 1000,
      })
    );
  }

  getSentMessages(): WebSocketMessage[] {
    return [...this.sentMessages];
  }

  getLastSentMessage(): WebSocketMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  clearSentMessages(): void {
    this.sentMessages = [];
  }

  static clearInstances(): void {
    MockWebSocket.instances = [];
  }

  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

/**
 * Create a mock event server that responds to subscription requests
 */
export function createMockEventServer(ws: MockWebSocket): {
  emitAgentStatus: (agentId: string, status: string) => void;
  emitTaskUpdate: (taskId: string, status: string) => void;
  emitMessage: (source: string, target: string, payload: unknown) => void;
  emitMemoryOp: (operation: string, namespace: string, key: string) => void;
} {
  return {
    emitAgentStatus: (agentId: string, status: string) => {
      ws.simulateMessage({
        type: 'agent:status',
        payload: {
          agentId,
          status,
          timestamp: Date.now(),
        },
      });
    },

    emitTaskUpdate: (taskId: string, status: string) => {
      ws.simulateMessage({
        type: 'task:update',
        payload: {
          taskId,
          status,
          timestamp: Date.now(),
        },
      });
    },

    emitMessage: (source: string, target: string, payload: unknown) => {
      ws.simulateMessage({
        type: 'message:sent',
        payload: {
          messageId: `msg_${Date.now()}`,
          source,
          target,
          payload,
          timestamp: Date.now(),
        },
      });
    },

    emitMemoryOp: (operation: string, namespace: string, key: string) => {
      ws.simulateMessage({
        type: 'memory:operation',
        payload: {
          operation,
          namespace,
          key,
          timestamp: Date.now(),
        },
      });
    },
  };
}

/**
 * Setup global WebSocket mock
 */
export function setupWebSocketMock(): void {
  // @ts-expect-error - Mocking global WebSocket
  globalThis.WebSocket = MockWebSocket;
}

/**
 * Restore original WebSocket
 */
export function restoreWebSocket(original: typeof WebSocket): void {
  globalThis.WebSocket = original;
}
