/**
 * Event Parser utilities for Live Operations Dashboard
 * Handles parsing and validation of incoming WebSocket events
 */

import type { DashboardEvent, EventType } from '../types';

/**
 * Valid event types
 */
const VALID_EVENT_TYPES: EventType[] = [
  'agent:status',
  'task:update',
  'message:sent',
  'memory:operation',
  'topology:change',
  'metrics:update',
  'subscribed',
  'pong',
];

/**
 * Type guard for event types
 */
export function isValidEventType(type: unknown): type is EventType {
  return typeof type === 'string' && VALID_EVENT_TYPES.includes(type as EventType);
}

/**
 * Parse and validate a raw event from WebSocket
 */
export function parseEvent(data: unknown): DashboardEvent | null {
  if (!data || typeof data !== 'object') {
    console.warn('[EventParser] Invalid event data:', data);
    return null;
  }

  const event = data as Record<string, unknown>;

  if (!isValidEventType(event.type)) {
    console.warn('[EventParser] Invalid event type:', event.type);
    return null;
  }

  // Ensure timestamp exists
  if (typeof event.timestamp !== 'number') {
    event.timestamp = Date.now();
  }

  return event as DashboardEvent;
}

/**
 * Parse a batch of events
 */
export function parseEvents(data: unknown[]): DashboardEvent[] {
  return data
    .map(parseEvent)
    .filter((event): event is DashboardEvent => event !== null);
}

/**
 * Truncate a payload for preview display
 */
export function truncatePayload(payload: unknown, maxLength = 200): string {
  if (payload === null || payload === undefined) {
    return '';
  }

  const str = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

  if (str.length <= maxLength) {
    return str;
  }

  return str.slice(0, maxLength) + '...';
}

/**
 * Get a safe string representation of a value
 */
export function safeStringify(value: unknown): string {
  try {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
  } catch {
    return '[Unable to stringify]';
  }
}

/**
 * Extract a preview from an object
 */
export function getObjectPreview(obj: unknown, maxKeys = 3): string {
  if (!obj || typeof obj !== 'object') {
    return safeStringify(obj);
  }

  const keys = Object.keys(obj as Record<string, unknown>);
  const previewKeys = keys.slice(0, maxKeys);
  const preview = previewKeys
    .map((key) => `${key}: ${truncatePayload((obj as Record<string, unknown>)[key], 50)}`)
    .join(', ');

  if (keys.length > maxKeys) {
    return `{ ${preview}, ... +${keys.length - maxKeys} more }`;
  }

  return `{ ${preview} }`;
}
