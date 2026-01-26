/**
 * MessageStream Component
 * Main component for displaying the real-time message stream with:
 * - MessageFilter at top for filtering
 * - Pause/Resume button with buffered count badge
 * - Virtual scrolling list of MessageItem components
 * - Auto-scroll to new messages (when not paused)
 * - Timestamp separators for message batches
 * - Empty state when no messages
 */

import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { format, isToday, isYesterday, isSameMinute } from 'date-fns';
import {
  useMessageStore,
  useFilteredMessages,
  useIsPaused,
  useMessageFilter,
  useMessageStats,
} from '../../store/messageStore';
import type { Message, MessageFilter as MessageFilterType } from '../../store/messageStore';
import { MessageFilter } from './MessageFilter';
import { MessageItem } from './MessageItem';
import { MessageDetail } from './MessageDetail';

/**
 * Get timestamp label for a message batch
 */
const getTimestampLabel = (timestamp: Date): string => {
  if (isToday(timestamp)) {
    return `Today at ${format(timestamp, 'HH:mm')}`;
  } else if (isYesterday(timestamp)) {
    return `Yesterday at ${format(timestamp, 'HH:mm')}`;
  } else {
    return format(timestamp, 'MMM d, yyyy HH:mm');
  }
};

/**
 * Check if two timestamps should be grouped together (within 1 minute)
 */
const shouldGroupTimestamps = (ts1: Date, ts2: Date): boolean => {
  return isSameMinute(ts1, ts2);
};

/**
 * Empty state component
 */
const EmptyState: React.FC<{ hasFilters: boolean }> = ({ hasFilters }) => {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-500">
      <svg
        className="w-16 h-16 mb-4 opacity-50"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <p className="text-lg font-medium">
        {hasFilters ? 'No messages match your filters' : 'No messages yet'}
      </p>
      <p className="text-sm mt-1">
        {hasFilters
          ? 'Try adjusting your filter criteria'
          : 'Messages will appear here as agents communicate'}
      </p>
    </div>
  );
};

/**
 * Timestamp separator component
 */
const TimestampSeparator: React.FC<{ timestamp: Date }> = ({ timestamp }) => {
  const label = getTimestampLabel(timestamp);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-900/30">
      <div className="flex-1 h-px bg-slate-800" />
      <span className="text-xs text-slate-500 font-medium">{label}</span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  );
};

/**
 * Pause/Resume control button
 */
interface StreamControlProps {
  isPaused: boolean;
  onToggle: () => void;
}

const StreamControl: React.FC<StreamControlProps> = ({
  isPaused,
  onToggle,
}) => {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        isPaused
          ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'
          : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'
      }`}
    >
      {isPaused ? (
        <>
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          <span>Resume</span>
        </>
      ) : (
        <>
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
          <span>Pause</span>
        </>
      )}
    </motion.button>
  );
};

/**
 * Stats display component
 */
const StatsDisplay: React.FC = () => {
  const stats = useMessageStats();

  return (
    <div className="flex items-center gap-4 text-xs text-slate-500">
      <span>Total: {stats.total}</span>
      {stats.messagesPerSecond > 0 && (
        <span>{stats.messagesPerSecond.toFixed(1)} msg/s</span>
      )}
    </div>
  );
};

/**
 * MessageStream component
 */
export const MessageStream: React.FC = () => {
  // Store state
  const filter = useMessageFilter();
  const setFilter = useMessageStore((state) => state.setFilter);
  const isPaused = useIsPaused();
  const togglePause = useMessageStore((state) => state.togglePause);
  const toggleMessageExpanded = useMessageStore((state) => state.toggleMessageExpanded);

  // Get filtered messages
  const filteredMessages = useFilteredMessages();

  // Track new message IDs for animation
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
  const prevMessagesRef = useRef<Message[]>([]);

  // Selected message for detail view
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

  // Container ref for virtual scrolling
  const parentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll state
  const [autoScroll, setAutoScroll] = useState(true);

  // Virtual list configuration - messages newest first (reversed)
  const reversedMessages = useMemo(() => [...filteredMessages].reverse(), [filteredMessages]);

  const virtualizer = useVirtualizer({
    count: reversedMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // Estimated row height
    overscan: 5, // Number of items to render outside visible area
  });

  // Handle filter changes
  const handleFilterChange = useCallback(
    (filterUpdate: Partial<MessageFilterType>) => {
      setFilter(filterUpdate);
    },
    [setFilter]
  );

  // Toggle message expansion
  const toggleExpanded = useCallback(
    (messageId: string) => {
      toggleMessageExpanded(messageId);
    },
    [toggleMessageExpanded]
  );

  // Handle message click for detail view
  const handleMessageDoubleClick = useCallback((message: Message) => {
    setSelectedMessage(message);
  }, []);

  // Close detail modal
  const handleCloseDetail = useCallback(() => {
    setSelectedMessage(null);
  }, []);

  // Track new messages for entry animation
  useEffect(() => {
    const currentIds = new Set(filteredMessages.map((m) => m.id));
    const prevIds = new Set(prevMessagesRef.current.map((m) => m.id));

    // Find new message IDs
    const newIds = new Set<string>();
    currentIds.forEach((id) => {
      if (!prevIds.has(id)) {
        newIds.add(id);
      }
    });

    if (newIds.size > 0) {
      setNewMessageIds(newIds);
      // Clear new status after animation
      const timer = setTimeout(() => {
        setNewMessageIds(new Set());
      }, 500);
      return () => clearTimeout(timer);
    }

    prevMessagesRef.current = filteredMessages;
  }, [filteredMessages]);

  // Auto-scroll to top when new messages arrive (if enabled and not paused)
  useEffect(() => {
    if (autoScroll && !isPaused && filteredMessages.length > 0 && parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [filteredMessages.length, autoScroll, isPaused]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (parentRef.current) {
      const { scrollTop } = parentRef.current;
      // If user scrolled away from top, disable auto-scroll
      setAutoScroll(scrollTop < 10);
    }
  }, []);

  // Check if any filters are active
  const hasFilters =
    filter.source.length > 0 ||
    filter.target.length > 0 ||
    filter.types.length > 0 ||
    filter.search.length > 0;

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Filter controls */}
      <MessageFilter filter={filter} onFilterChange={handleFilterChange} />

      {/* Stream controls header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-slate-200">Message Stream</h2>
          <span className="text-sm text-slate-500">
            ({filteredMessages.length} messages)
          </span>
          <StatsDisplay />
        </div>
        <div className="flex items-center gap-2">
          <StreamControl isPaused={isPaused} onToggle={togglePause} />
        </div>
      </div>

      {/* Message list */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        {reversedMessages.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const message = reversedMessages[virtualRow.index];
              if (!message) return null;

              // Check if we should show a timestamp separator
              const prevMessage = reversedMessages[virtualRow.index - 1];
              const showSeparator =
                !prevMessage ||
                !shouldGroupTimestamps(prevMessage.timestamp, message.timestamp);

              return (
                <div
                  key={message.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {showSeparator && (
                    <TimestampSeparator timestamp={message.timestamp} />
                  )}
                  <div onDoubleClick={() => handleMessageDoubleClick(message)}>
                    <MessageItem
                      message={message}
                      isExpanded={message.expanded ?? false}
                      onToggle={() => toggleExpanded(message.id)}
                      searchHighlight={filter.search}
                      isNew={newMessageIds.has(message.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll to top button */}
      <AnimatePresence>
        {!autoScroll && filteredMessages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2"
          >
            <button
              type="button"
              onClick={() => {
                if (parentRef.current) {
                  parentRef.current.scrollTop = 0;
                  setAutoScroll(true);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-full shadow-lg hover:bg-blue-600 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              </svg>
              <span>Scroll to latest</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Message detail modal */}
      {selectedMessage && (
        <MessageDetail
          message={selectedMessage}
          onClose={handleCloseDetail}
        />
      )}
    </div>
  );
};

export default MessageStream;
