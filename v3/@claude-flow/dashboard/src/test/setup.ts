/**
 * Test setup for Vitest
 */

import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 10);
  }

  send(data: string): void {
    // Mock send - can be extended in tests
    console.log('[MockWebSocket] Sending:', data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  // Helper method for tests to simulate receiving a message
  simulateMessage(data: unknown): void {
    this.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify(data),
      })
    );
  }

  // Helper method for tests to simulate an error
  simulateError(error: Error): void {
    this.onerror?.(new ErrorEvent('error', { error }));
  }
}

// @ts-expect-error - Mocking global WebSocket
globalThis.WebSocket = MockWebSocket;

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock ResizeObserver
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = MockResizeObserver;

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// @ts-expect-error - Mocking global
globalThis.IntersectionObserver = MockIntersectionObserver;

// Silence console during tests (optional - uncomment if needed)
// beforeAll(() => {
//   vi.spyOn(console, 'log').mockImplementation(() => {});
//   vi.spyOn(console, 'warn').mockImplementation(() => {});
//   vi.spyOn(console, 'error').mockImplementation(() => {});
// });

// afterAll(() => {
//   vi.restoreAllMocks();
// });
