/**
 * MessageDetail Component
 * Modal overlay showing full message details including:
 * - Complete content and data (JSON formatted and syntax highlighted)
 * - Copy content button
 * - Source and target agent links
 * - Timestamp (absolute and relative)
 * - Close on escape key press
 */

import React, { useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNow } from 'date-fns';
import type { Message, MessageType } from '../../store/messageStore';
import {
  MESSAGE_TYPE_COLORS,
  MESSAGE_TYPE_LABELS,
  MESSAGE_DIRECTION_COLORS,
  MESSAGE_DIRECTION_LABELS,
} from '../../types/messages';

/**
 * Props for MessageDetail component
 */
interface MessageDetailProps {
  message: Message;
  onClose: () => void;
  onAgentClick?: (agentId: string) => void;
}

/**
 * Basic JSON syntax highlighting
 */
const highlightJson = (json: string): React.ReactNode => {
  // Simple regex-based highlighting
  const highlighted = json
    .replace(/"([^"]+)":/g, '<span class="text-purple-400">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="text-green-400">"$1"</span>')
    .replace(/: (\d+)/g, ': <span class="text-amber-400">$1</span>')
    .replace(/: (true|false)/g, ': <span class="text-blue-400">$1</span>')
    .replace(/: (null)/g, ': <span class="text-slate-500">$1</span>');

  return <span dangerouslySetInnerHTML={{ __html: highlighted }} />;
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
      className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
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
 * Direction badge component
 */
interface DirectionBadgeProps {
  direction: string;
}

const DirectionBadge: React.FC<DirectionBadgeProps> = ({ direction }) => {
  const color = MESSAGE_DIRECTION_COLORS[direction] ?? '#64748b';
  const label = MESSAGE_DIRECTION_LABELS[direction] ?? direction;

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
 * Agent link component
 */
interface AgentLinkProps {
  agentId: string;
  label: string;
  color: string;
  onClick?: () => void;
}

const AgentLink: React.FC<AgentLinkProps> = ({
  agentId,
  label,
  color,
  onClick,
}) => {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-slate-500 mb-1">{label}</span>
      <button
        type="button"
        onClick={onClick}
        className={`text-left px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors ${
          onClick ? 'cursor-pointer' : 'cursor-default'
        }`}
        disabled={!onClick}
      >
        <span className="font-medium" style={{ color }}>
          {agentId}
        </span>
      </button>
    </div>
  );
};

/**
 * Copy to clipboard button
 */
interface CopyButtonProps {
  text: string;
  label?: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ text, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <motion.button
      type="button"
      onClick={handleCopy}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        copied
          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
      }`}
    >
      {copied ? (
        <>
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
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span>Copied!</span>
        </>
      ) : (
        <>
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
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <span>{label}</span>
        </>
      )}
    </motion.button>
  );
};

/**
 * MessageDetail component
 */
export const MessageDetail: React.FC<MessageDetailProps> = ({
  message,
  onClose,
  onAgentClick,
}) => {
  const formattedData = message.data ? formatData(message.data) : null;

  // Format timestamps
  const absoluteTime = format(message.timestamp, 'PPpp');
  const relativeTime = formatDistanceToNow(message.timestamp, {
    addSuffix: true,
  });

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  // Animation variants
  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: { opacity: 1, scale: 1, y: 0 },
  };

  // Get message size
  const messageSize = message.metadata?.size ?? message.content.length;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-2xl max-h-[90vh] bg-slate-900 rounded-xl shadow-2xl border border-slate-800 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-slate-200">
                Message Details
              </h2>
              <TypeBadge type={message.type} />
              <DirectionBadge direction={message.direction} />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Timestamp */}
            <div className="mb-6">
              <span className="text-xs text-slate-500 block mb-1">
                Timestamp
              </span>
              <div className="flex items-center gap-3">
                <span className="text-slate-200">{absoluteTime}</span>
                <span className="text-slate-500">({relativeTime})</span>
              </div>
            </div>

            {/* Agents */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <AgentLink
                agentId={message.source}
                label="Source Agent"
                color="#3b82f6" // Blue
                onClick={
                  onAgentClick ? () => onAgentClick(message.source) : undefined
                }
              />
              {message.target && (
                <AgentLink
                  agentId={message.target}
                  label="Target Agent"
                  color="#22c55e" // Green
                  onClick={
                    onAgentClick ? () => onAgentClick(message.target!) : undefined
                  }
                />
              )}
            </div>

            {/* Flow arrow */}
            {message.target && (
              <div className="flex items-center justify-center gap-4 mb-6 py-4 bg-slate-800/50 rounded-lg">
                <span className="font-medium text-blue-400">{message.source}</span>
                <svg
                  className="w-8 h-8 text-slate-500"
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
                <span className="font-medium text-green-400">{message.target}</span>
              </div>
            )}

            {/* Message info */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <span className="text-xs text-slate-500 block mb-1">
                  Message ID
                </span>
                <span className="text-sm text-slate-300 font-mono">
                  {message.id}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block mb-1">
                  Size
                </span>
                <span className="text-sm text-slate-300">
                  {messageSize > 1024
                    ? `${(messageSize / 1024).toFixed(2)} KB`
                    : `${messageSize} bytes`}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">Content</span>
                <CopyButton text={message.content} label="Copy Content" />
              </div>
              <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                <div className="p-4 text-sm text-slate-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {message.content}
                </div>
              </div>
            </div>

            {/* Data payload if present */}
            {formattedData && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500">Data</span>
                  <CopyButton text={formattedData} label="Copy Data" />
                </div>
                <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
                  <pre className="p-4 text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-80 overflow-y-auto text-slate-300">
                    {highlightJson(formattedData)}
                  </pre>
                </div>
              </div>
            )}

            {/* Metadata if present */}
            {message.metadata && Object.keys(message.metadata).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500">Metadata</span>
                </div>
                <div className="bg-slate-950 rounded-lg border border-slate-800 p-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {Object.entries(message.metadata).map(([key, value]) => (
                      <div key={key} className="flex flex-col">
                        <span className="text-slate-500 text-xs">{key}</span>
                        <span className="text-slate-300 font-mono">
                          {String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MessageDetail;
