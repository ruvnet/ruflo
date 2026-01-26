/**
 * Message Components Index
 * Exports all message-related components for the Live Operations Dashboard
 */

export { MessageFilter } from './MessageFilter';
export { MessageItem } from './MessageItem';
export { MessageStream } from './MessageStream';
export { MessageDetail } from './MessageDetail';

// Re-export types from the types module for convenience
export type {
  Message,
  MessageType,
  MessageDirection,
  MessageFilter as MessageFilterType,
  MessageFilterState,
  MessageStats,
  MessageStoreState,
  MessageEvent,
  MessageFlow,
  MessagePayload,
  MessagePriority,
  MessageDeliveryStatus,
} from '../../types/messages';

export {
  MESSAGE_TYPE_COLORS,
  MESSAGE_TYPE_LABELS,
  MESSAGE_TYPE_CSS_COLORS,
  MESSAGE_DIRECTION_COLORS,
  MESSAGE_DIRECTION_LABELS,
  ALL_MESSAGE_TYPES,
  DEFAULT_MESSAGE_FILTER,
  MessageTypeEnum,
  MessagePriorityEnum,
  MessageDeliveryStatusEnum,
} from '../../types/messages';
