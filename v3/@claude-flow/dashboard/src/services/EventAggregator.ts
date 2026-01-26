/**
 * Event Aggregator
 * Aggregates and normalizes events for efficient state updates
 */

import type { WebSocketMessage } from './WebSocketManager';

export interface NormalizedEvent {
  id: string;
  type: string;
  channel?: string;
  payload: unknown;
  timestamp: number;
  receivedAt: number;
  source?: string;
}

export interface BatchedEvents {
  events: NormalizedEvent[];
  batchId: string;
  startTime: number;
  endTime: number;
  eventCount: number;
}

export type EventValidator = (event: WebSocketMessage) => boolean;
export type EventTransformer = (event: WebSocketMessage) => NormalizedEvent;
export type BatchHandler = (batch: BatchedEvents) => void;

export interface EventAggregatorConfig {
  batchInterval?: number;
  maxBatchSize?: number;
  validators?: Map<string, EventValidator>;
  transformers?: Map<string, EventTransformer>;
}

// Known event types for validation
const VALID_EVENT_TYPES = new Set([
  'agent:spawned',
  'agent:stopped',
  'agent:status',
  'agent:metrics',
  'agent:error',
  'task:created',
  'task:started',
  'task:completed',
  'task:failed',
  'task:progress',
  'memory:stored',
  'memory:retrieved',
  'memory:deleted',
  'swarm:initialized',
  'swarm:status',
  'swarm:agent:joined',
  'swarm:agent:left',
  'system:status',
  'system:metrics',
  'system:alert',
  'system:error',
  'ping',
  'pong',
  'subscribe',
  'unsubscribe',
  'raw',
]);

export class EventAggregator {
  private batchInterval: number;
  private maxBatchSize: number;
  private validators: Map<string, EventValidator>;
  private transformers: Map<string, EventTransformer>;

  private pendingEvents: NormalizedEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchHandlers: Set<BatchHandler> = new Set();
  private batchCounter = 0;

  constructor(config: EventAggregatorConfig = {}) {
    this.batchInterval = config.batchInterval ?? 100; // 100ms default batch window
    this.maxBatchSize = config.maxBatchSize ?? 50;
    this.validators = config.validators ?? new Map();
    this.transformers = config.transformers ?? new Map();

    this.setupDefaultValidators();
  }

  /**
   * Setup default event validators
   */
  private setupDefaultValidators(): void {
    // Default validator checks for known event types
    this.validators.set('default', (event: WebSocketMessage) => {
      if (!event.type) {
        return false;
      }
      return VALID_EVENT_TYPES.has(event.type) || event.type.startsWith('custom:');
    });
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    this.batchCounter++;
    return `batch_${Date.now()}_${this.batchCounter}`;
  }

  /**
   * Validate an event using registered validators
   */
  validateEvent(event: WebSocketMessage): boolean {
    // Check type-specific validator first
    const typeValidator = this.validators.get(event.type);
    if (typeValidator && !typeValidator(event)) {
      return false;
    }

    // Check default validator
    const defaultValidator = this.validators.get('default');
    if (defaultValidator && !defaultValidator(event)) {
      console.warn(`Invalid event type: ${event.type}`);
      return false;
    }

    return true;
  }

  /**
   * Normalize timestamp to milliseconds
   */
  private normalizeTimestamp(timestamp?: number): number {
    if (!timestamp) {
      return Date.now();
    }

    // If timestamp appears to be in seconds, convert to milliseconds
    if (timestamp < 1e12) {
      return timestamp * 1000;
    }

    return timestamp;
  }

  /**
   * Transform a raw WebSocket message into a normalized event
   */
  normalizeEvent(event: WebSocketMessage): NormalizedEvent {
    // Check for custom transformer
    const customTransformer = this.transformers.get(event.type);
    if (customTransformer) {
      return customTransformer(event);
    }

    // Default normalization
    return {
      id: this.generateEventId(),
      type: event.type,
      channel: event.channel,
      payload: event.payload,
      timestamp: this.normalizeTimestamp(event.timestamp),
      receivedAt: Date.now(),
    };
  }

  /**
   * Add an event to the pending batch
   */
  addEvent(event: WebSocketMessage): boolean {
    // Validate event
    if (!this.validateEvent(event)) {
      return false;
    }

    // Normalize and add to pending
    const normalizedEvent = this.normalizeEvent(event);
    this.pendingEvents.push(normalizedEvent);

    // Check if we should flush immediately due to batch size
    if (this.pendingEvents.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.batchTimer) {
      // Start batch timer
      this.batchTimer = setTimeout(() => {
        this.flush();
      }, this.batchInterval);
    }

    return true;
  }

  /**
   * Flush pending events as a batch
   */
  flush(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingEvents.length === 0) {
      return;
    }

    const events = [...this.pendingEvents];
    this.pendingEvents = [];

    const batch: BatchedEvents = {
      events,
      batchId: this.generateBatchId(),
      startTime: events[0].receivedAt,
      endTime: events[events.length - 1].receivedAt,
      eventCount: events.length,
    };

    // Notify all batch handlers
    this.batchHandlers.forEach(handler => {
      try {
        handler(batch);
      } catch (error) {
        console.error('Error in batch handler:', error);
      }
    });
  }

  /**
   * Register a batch handler
   */
  onBatch(handler: BatchHandler): () => void {
    this.batchHandlers.add(handler);
    return () => this.batchHandlers.delete(handler);
  }

  /**
   * Register a custom validator for an event type
   */
  registerValidator(eventType: string, validator: EventValidator): void {
    this.validators.set(eventType, validator);
  }

  /**
   * Register a custom transformer for an event type
   */
  registerTransformer(eventType: string, transformer: EventTransformer): void {
    this.transformers.set(eventType, transformer);
  }

  /**
   * Get pending event count
   */
  getPendingCount(): number {
    return this.pendingEvents.length;
  }

  /**
   * Clear all pending events
   */
  clear(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingEvents = [];
  }

  /**
   * Destroy the aggregator
   */
  destroy(): void {
    this.clear();
    this.batchHandlers.clear();
    this.validators.clear();
    this.transformers.clear();
  }

  /**
   * Group events by type
   */
  static groupByType(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
    const grouped = new Map<string, NormalizedEvent[]>();

    for (const event of events) {
      const existing = grouped.get(event.type) ?? [];
      existing.push(event);
      grouped.set(event.type, existing);
    }

    return grouped;
  }

  /**
   * Group events by channel
   */
  static groupByChannel(events: NormalizedEvent[]): Map<string, NormalizedEvent[]> {
    const grouped = new Map<string, NormalizedEvent[]>();

    for (const event of events) {
      const channel = event.channel ?? 'default';
      const existing = grouped.get(channel) ?? [];
      existing.push(event);
      grouped.set(channel, existing);
    }

    return grouped;
  }

  /**
   * Filter events by time range
   */
  static filterByTimeRange(
    events: NormalizedEvent[],
    startTime: number,
    endTime: number
  ): NormalizedEvent[] {
    return events.filter(
      event => event.timestamp >= startTime && event.timestamp <= endTime
    );
  }
}
