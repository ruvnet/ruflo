/**
 * Message Store - Message stream state management
 * Implements circular buffer behavior for efficient memory usage
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';

/**
 * Maximum message buffer size
 */
const MAX_MESSAGES = 1000;

/**
 * Message type classification
 */
export type MessageType =
  | 'task'
  | 'response'
  | 'error'
  | 'info'
  | 'warning'
  | 'system'
  | 'agent'
  | 'memory'
  | 'debug';

/**
 * Message direction
 */
export type MessageDirection = 'inbound' | 'outbound' | 'internal';

/**
 * Message state representation
 */
export interface Message {
  id: string;
  timestamp: Date;
  type: MessageType;
  direction: MessageDirection;

  // Source and target
  source: string;
  target?: string;

  // Content
  content: string;
  data?: unknown;

  // Metadata
  metadata?: {
    taskId?: string;
    agentId?: string;
    sessionId?: string;
    correlationId?: string;
    duration?: number;
    size?: number;
    [key: string]: unknown;
  };

  // UI state
  highlighted?: boolean;
  expanded?: boolean;
}

/**
 * Message filter configuration
 */
export interface MessageFilter {
  source: string[];
  target: string[];
  types: MessageType[];
  search: string;
  direction?: MessageDirection;
  showSystem: boolean;
  showDebug: boolean;
}

/**
 * Message statistics
 */
export interface MessageStats {
  total: number;
  byType: Record<MessageType, number>;
  byDirection: Record<MessageDirection, number>;
  messagesPerSecond: number;
  lastMessageAt: Date | null;
}

/**
 * Message store state shape
 */
export interface MessageStoreState {
  // State
  messages: Message[];
  isPaused: boolean;
  filter: MessageFilter;
  stats: MessageStats;

  // Buffer configuration
  maxMessages: number;

  // Actions
  addMessage: (message: Omit<Message, 'id' | 'timestamp'> & { id?: string; timestamp?: Date }) => void;
  addMessages: (messages: Array<Omit<Message, 'id' | 'timestamp'> & { id?: string; timestamp?: Date }>) => void;
  pauseStream: () => void;
  resumeStream: () => void;
  togglePause: () => void;
  setFilter: (filter: Partial<MessageFilter>) => void;
  clearFilter: () => void;
  clearMessages: () => void;
  toggleMessageExpanded: (messageId: string) => void;
  highlightMessage: (messageId: string, highlighted: boolean) => void;
  setMaxMessages: (max: number) => void;

  // Selectors
  getFilteredMessages: () => Message[];
  getMessageById: (messageId: string) => Message | undefined;
  getMessagesBySource: (source: string) => Message[];
  getMessagesByType: (type: MessageType) => Message[];
}

/**
 * Default filter configuration
 */
const defaultFilter: MessageFilter = {
  source: [],
  target: [],
  types: [],
  search: '',
  showSystem: true,
  showDebug: false,
};

/**
 * Initial stats
 */
const initialStats: MessageStats = {
  total: 0,
  byType: {
    task: 0,
    response: 0,
    error: 0,
    info: 0,
    warning: 0,
    system: 0,
    agent: 0,
    memory: 0,
    debug: 0,
  },
  byDirection: {
    inbound: 0,
    outbound: 0,
    internal: 0,
  },
  messagesPerSecond: 0,
  lastMessageAt: null,
};

/**
 * Generate unique message ID
 */
const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Apply filter to messages
 */
const applyFilter = (messages: Message[], filter: MessageFilter): Message[] => {
  return messages.filter((message) => {
    // Filter by source
    if (filter.source.length > 0 && !filter.source.includes(message.source)) {
      return false;
    }

    // Filter by target
    if (filter.target.length > 0 && message.target && !filter.target.includes(message.target)) {
      return false;
    }

    // Filter by types
    if (filter.types.length > 0 && !filter.types.includes(message.type)) {
      return false;
    }

    // Filter by direction
    if (filter.direction && message.direction !== filter.direction) {
      return false;
    }

    // Filter system messages
    if (!filter.showSystem && message.type === 'system') {
      return false;
    }

    // Filter debug messages
    if (!filter.showDebug && message.type === 'debug') {
      return false;
    }

    // Filter by search text
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const contentMatch = message.content.toLowerCase().includes(searchLower);
      const sourceMatch = message.source.toLowerCase().includes(searchLower);
      const targetMatch = message.target?.toLowerCase().includes(searchLower) ?? false;

      if (!contentMatch && !sourceMatch && !targetMatch) {
        return false;
      }
    }

    return true;
  });
};

/**
 * Message Zustand store
 */
export const useMessageStore = create<MessageStoreState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      messages: [],
      isPaused: false,
      filter: { ...defaultFilter },
      stats: { ...initialStats },
      maxMessages: MAX_MESSAGES,

      // Actions
      addMessage: (message) => {
        if (get().isPaused) return;

        set(
          (state) => {
            const newMessage: Message = {
              ...message,
              id: message.id ?? generateMessageId(),
              timestamp: message.timestamp ?? new Date(),
            };

            // Circular buffer: remove oldest if at capacity
            const newMessages = state.messages.length >= state.maxMessages
              ? [...state.messages.slice(1), newMessage]
              : [...state.messages, newMessage];

            // Update stats
            const newStats = { ...state.stats };
            newStats.total++;
            newStats.byType[newMessage.type]++;
            newStats.byDirection[newMessage.direction]++;
            newStats.lastMessageAt = newMessage.timestamp;

            return {
              messages: newMessages,
              stats: newStats,
            };
          },
          false,
          'addMessage'
        );
      },

      addMessages: (messages) => {
        if (get().isPaused) return;

        set(
          (state) => {
            const newMessages: Message[] = messages.map((m) => ({
              ...m,
              id: m.id ?? generateMessageId(),
              timestamp: m.timestamp ?? new Date(),
            }));

            // Apply circular buffer
            let combined = [...state.messages, ...newMessages];
            if (combined.length > state.maxMessages) {
              combined = combined.slice(combined.length - state.maxMessages);
            }

            // Update stats
            const newStats = { ...state.stats };
            for (const msg of newMessages) {
              newStats.total++;
              newStats.byType[msg.type]++;
              newStats.byDirection[msg.direction]++;
            }
            if (newMessages.length > 0) {
              newStats.lastMessageAt = newMessages[newMessages.length - 1].timestamp;
            }

            return {
              messages: combined,
              stats: newStats,
            };
          },
          false,
          'addMessages'
        );
      },

      pauseStream: () =>
        set({ isPaused: true }, false, 'pauseStream'),

      resumeStream: () =>
        set({ isPaused: false }, false, 'resumeStream'),

      togglePause: () =>
        set((state) => ({ isPaused: !state.isPaused }), false, 'togglePause'),

      setFilter: (filterUpdates) =>
        set(
          (state) => ({
            filter: { ...state.filter, ...filterUpdates },
          }),
          false,
          'setFilter'
        ),

      clearFilter: () =>
        set({ filter: { ...defaultFilter } }, false, 'clearFilter'),

      clearMessages: () =>
        set(
          {
            messages: [],
            stats: { ...initialStats },
          },
          false,
          'clearMessages'
        ),

      toggleMessageExpanded: (messageId) =>
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId ? { ...m, expanded: !m.expanded } : m
            ),
          }),
          false,
          'toggleMessageExpanded'
        ),

      highlightMessage: (messageId, highlighted) =>
        set(
          (state) => ({
            messages: state.messages.map((m) =>
              m.id === messageId ? { ...m, highlighted } : m
            ),
          }),
          false,
          'highlightMessage'
        ),

      setMaxMessages: (max) =>
        set(
          (state) => {
            const newMax = Math.max(100, Math.min(10000, max));
            let messages = state.messages;
            if (messages.length > newMax) {
              messages = messages.slice(messages.length - newMax);
            }
            return {
              maxMessages: newMax,
              messages,
            };
          },
          false,
          'setMaxMessages'
        ),

      // Selectors
      getFilteredMessages: () => applyFilter(get().messages, get().filter),

      getMessageById: (messageId) => get().messages.find((m) => m.id === messageId),

      getMessagesBySource: (source) => get().messages.filter((m) => m.source === source),

      getMessagesByType: (type) => get().messages.filter((m) => m.type === type),
    })),
    { name: 'MessageStore' }
  )
);

/**
 * Selector hooks for optimized re-renders
 */
export const useMessages = () => useMessageStore((state) => state.messages);
export const useIsPaused = () => useMessageStore((state) => state.isPaused);
export const useMessageFilter = () => useMessageStore((state) => state.filter);
export const useMessageStats = () => useMessageStore((state) => state.stats);

/**
 * Get filtered messages with reactive updates
 */
export const useFilteredMessages = (): Message[] => {
  const messages = useMessageStore((state) => state.messages);
  const filter = useMessageStore((state) => state.filter);
  return applyFilter(messages, filter);
};

/**
 * Get recent messages (last N)
 */
export const useRecentMessages = (count: number = 50): Message[] => {
  const messages = useMessageStore((state) => state.messages);
  return messages.slice(-count);
};
