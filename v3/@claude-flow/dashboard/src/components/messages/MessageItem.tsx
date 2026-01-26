/**
 * MessageItem Component
 * Displays a single message in the message stream with:
 * - Timestamp (relative)
 * - Source to target agent flow
 * - Message type badge with color
 * - Truncated content preview
 * - Expandable full data view
 * - Search term highlighting
 * - Entry animation for new messages
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import type { Message, MessageType } from '../../store/messageStore';
import { MESSAGE_TYPE_COLORS, MESSAGE_TYPE_LABELS } from '../../types/messages';

/**
 * Props for MessageItem component
 */
interface MessageItemProps {
  message: Message;
  isExpanded: boolean;
  onToggle: () => void;
  searchHighlight?: string;
  isNew?: boolean;
}

/**
 * Truncate content for preview
 */
const truncateContent = (content: string, maxLength = 100): string => {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
};

/**
 * Format data as pretty JSON
 */
const formatData = (data: unknown): string => {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
};

/**
 * Highlight search terms in text
 */
const highlightText = (text: string, searchTerm: string): React.ReactNode => {
  if (!searchTerm) return text;

  const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) =>
    regex.test(part) ? (
      <mark
        key={index}
        className="bg-yellow-500/30 text-yellow-200 rounded px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
};

/**
 * Escape special regex characters
 */
const escapeRegExp = (string: string): string => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Message type badge component
 */
interface TypeBadgeProps {
  type: MessageType;
}

const TypeBadge: React.FC<TypeBadgeProps> = ({ type }) => {
  const color = MESSAGE_TYPE_COLORS[type];
  const label = MESSAGE_TYPE_LABELS[type];

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      {label}
    </span>
  );
};

/**
 * Agent flow display (source arrow target)
 */
interface AgentFlowProps {
  source: string;
  target?: string;
  searchHighlight?: string;
}

const AgentFlow: React.FC<AgentFlowProps> = ({
  source,
  target,
  searchHighlight,
}) => {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium text-blue-400 truncate max-w-[120px]">
        {searchHighlight ? highlightText(source, searchHighlight) : source}
      </span>
      {target && (
        <>
          <svg
            className="w-4 h-4 text-slate-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
          <span className="font-medium text-green-400 truncate max-w-[120px]">
            {searchHighlight ? highlightText(target, searchHighlight) : target}
          </span>
        </>
      )}
    </div>
  );
};

/**
 * MessageItem component
 */
export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isExpanded,
  onToggle,
  searchHighlight,
  isNew = false,
}) => {
  // Format relative timestamp
  const relativeTime = useMemo(() => {
    return formatDistanceToNow(message.timestamp, { addSuffix: true });
  }, [message.timestamp]);

  // Get truncated content preview
  const contentPreview = useMemo(() => {
    return truncateContent(message.content);
  }, [message.content]);

  // Get formatted data if present
  const formattedData = useMemo(() => {
    if (!message.data) return null;
    return formatData(message.data);
  }, [message.data]);

  // Get message size
  const messageSize = message.metadata?.size ?? message.content.length;

  // Animation variants
  const itemVariants = {
    initial: { opacity: 0, y: -20, scale: 0.95 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  };

  const expandVariants = {
    collapsed: { height: 0, opacity: 0 },
    expanded: { height: 'auto', opacity: 1 },
  };

  return (
    <motion.div
      layout
      variants={itemVariants}
      initial={isNew ? 'initial' : false}
      animate="animate"
      exit="exit"
      transition={{ duration: 0.2 }}
      className={`border-b border-slate-800 hover:bg-slate-800/50 transition-colors ${
        isNew ? 'bg-blue-900/20' : ''
      } ${message.highlighted ? 'bg-yellow-900/20 border-yellow-700' : ''}`}
    >
      {/* Main content - clickable to expand */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 text-left focus:outline-none focus:bg-slate-800/50"
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left side - timestamp, agents, type */}
          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs text-slate-500 flex-shrink-0">
                {relativeTime}
              </span>
              <TypeBadge type={message.type} />
              {message.direction && (
                <span className="text-xs text-slate-500">
                  ({message.direction})
                </span>
              )}
            </div>

            {/* Agent flow */}
            <AgentFlow
              source={message.source}
              target={message.target}
              searchHighlight={searchHighlight}
            />

            {/* Content preview */}
            <div className="mt-2 text-sm text-slate-300 truncate">
              {searchHighlight
                ? highlightText(contentPreview, searchHighlight)
                : contentPreview}
            </div>
          </div>

          {/* Right side - expand indicator and size */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-slate-500">
              {messageSize > 1024
                ? `${(messageSize / 1024).toFixed(1)}KB`
                : `${messageSize}B`}
            </span>
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <svg
                className="w-4 h-4 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </motion.div>
          </div>
        </div>
      </button>

      {/* Expanded content view */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            variants={expandVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Full content */}
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-400">
                    Content
                  </span>
                </div>
                <div className="text-sm text-slate-300 whitespace-pre-wrap break-words">
                  {searchHighlight
                    ? highlightText(message.content, searchHighlight)
                    : message.content}
                </div>
              </div>

              {/* Data payload if present */}
              {formattedData && (
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-400">
                      Data
                    </span>
                  </div>
                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-64 overflow-y-auto">
                    {searchHighlight
                      ? highlightText(formattedData, searchHighlight)
                      : formattedData}
                  </pre>
                </div>
              )}

              {/* Metadata if present */}
              {message.metadata && Object.keys(message.metadata).length > 0 && (
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-400">
                      Metadata
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.entries(message.metadata).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-slate-500">{key}:</span>
                        <span className="text-slate-300 font-mono">
                          {String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default MessageItem;
