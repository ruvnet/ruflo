/**
 * Dashboard Services
 * WebSocket connection management and event handling
 */

export {
  WebSocketManager,
  type ConnectionStatus,
  type WebSocketMessage,
  type EventHandler,
  type WebSocketManagerConfig,
} from './WebSocketManager';

export {
  EventAggregator,
  type NormalizedEvent,
  type BatchedEvents,
  type EventValidator,
  type EventTransformer,
  type BatchHandler,
  type EventAggregatorConfig,
} from './EventAggregator';

export {
  CircularBuffer,
  EventBuffer,
  type CircularBufferConfig,
} from './EventBuffer';
