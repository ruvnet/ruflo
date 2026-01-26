/**
 * MessageStream Component Tests
 * Tests for message rendering, pause/resume, filtering, and search highlighting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useState } from 'react';

// Message types
type MessageType = 'task' | 'response' | 'error' | 'info' | 'warning' | 'system' | 'agent' | 'memory' | 'debug';
type MessageDirection = 'inbound' | 'outbound' | 'internal';

interface Message {
  id: string;
  source: string;
  sourceName: string;
  target?: string;
  targetName?: string;
  messageType: MessageType;
  direction: MessageDirection;
  content: string;
  payload: unknown;
  size: number;
  timestamp: Date;
  expanded?: boolean;
}

// Mock message data
const mockMessages: Message[] = [
  {
    id: 'msg-1',
    source: 'agent-1',
    sourceName: 'Coordinator',
    target: 'agent-2',
    targetName: 'Coder',
    messageType: 'task',
    direction: 'outbound',
    content: 'Implement feature X',
    payload: { action: 'implement feature X' },
    size: 45,
    timestamp: new Date(Date.now() - 5000),
  },
  {
    id: 'msg-2',
    source: 'agent-2',
    sourceName: 'Coder',
    target: 'agent-1',
    targetName: 'Coordinator',
    messageType: 'response',
    direction: 'inbound',
    content: 'Task completed successfully',
    payload: { status: 'completed' },
    size: 32,
    timestamp: new Date(Date.now() - 3000),
  },
  {
    id: 'msg-3',
    source: 'agent-1',
    sourceName: 'Coordinator',
    target: 'agent-3',
    targetName: 'Tester',
    messageType: 'task',
    direction: 'outbound',
    content: 'Run test suite for feature X',
    payload: { query: 'test status?' },
    size: 28,
    timestamp: new Date(Date.now() - 1000),
  },
  {
    id: 'msg-4',
    source: 'system',
    sourceName: 'System',
    messageType: 'system',
    direction: 'internal',
    content: 'Swarm initialized',
    payload: {},
    size: 20,
    timestamp: new Date(Date.now() - 500),
  },
  {
    id: 'msg-5',
    source: 'agent-4',
    sourceName: 'Debug Agent',
    messageType: 'debug',
    direction: 'internal',
    content: 'Debug trace enabled',
    payload: {},
    size: 15,
    timestamp: new Date(Date.now() - 100),
  },
];

// Highlight text component
const HighlightText: React.FC<{ text: string; highlight: string }> = ({
  text,
  highlight,
}) => {
  if (!highlight) return <span>{text}</span>;

  const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} data-testid="search-highlight" className="bg-yellow-300">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
};

// MessageItem component for testing
interface MessageItemProps {
  message: Message;
  searchHighlight?: string;
  onSelect?: (messageId: string) => void;
}

const MessageItem: React.FC<MessageItemProps> = ({
  message,
  searchHighlight,
  onSelect,
}) => {
  return (
    <div
      data-testid={`message-item-${message.id}`}
      onClick={() => onSelect?.(message.id)}
      role="button"
      tabIndex={0}
    >
      <span data-testid={`message-source-${message.id}`}>
        <HighlightText text={message.sourceName} highlight={searchHighlight || ''} />
      </span>
      {message.targetName && (
        <span data-testid={`message-target-${message.id}`}>
          <HighlightText text={message.targetName} highlight={searchHighlight || ''} />
        </span>
      )}
      <span data-testid={`message-type-${message.id}`}>
        {message.messageType}
      </span>
      <span data-testid={`message-content-${message.id}`}>
        <HighlightText text={message.content} highlight={searchHighlight || ''} />
      </span>
    </div>
  );
};

// MessageStream component for testing
interface MessageStreamProps {
  messages?: Message[];
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onMessageSelect?: (messageId: string) => void;
  maxMessages?: number;
  sourceFilter?: string[];
  targetFilter?: string[];
  searchQuery?: string;
}

const MessageStream: React.FC<MessageStreamProps> = ({
  messages = mockMessages,
  isPaused = false,
  onPause,
  onResume,
  onMessageSelect,
  maxMessages = 1000,
  sourceFilter = [],
  targetFilter = [],
  searchQuery = '',
}) => {
  // Apply filters
  let filteredMessages = messages;

  // Source filter
  if (sourceFilter.length > 0) {
    filteredMessages = filteredMessages.filter((msg) =>
      sourceFilter.includes(msg.source)
    );
  }

  // Target filter
  if (targetFilter.length > 0) {
    filteredMessages = filteredMessages.filter(
      (msg) => msg.target && targetFilter.includes(msg.target)
    );
  }

  // Search filter
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filteredMessages = filteredMessages.filter(
      (msg) =>
        msg.content.toLowerCase().includes(query) ||
        msg.sourceName.toLowerCase().includes(query) ||
        (msg.targetName && msg.targetName.toLowerCase().includes(query))
    );
  }

  // Apply max limit
  const displayMessages = filteredMessages.slice(0, maxMessages);

  return (
    <div data-testid="message-stream">
      <div data-testid="stream-controls">
        <button
          data-testid="pause-button"
          onClick={isPaused ? onResume : onPause}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        {isPaused && (
          <span data-testid="paused-indicator">Stream Paused</span>
        )}
        <span data-testid="message-count">{displayMessages.length} messages</span>
      </div>

      <div data-testid="message-list">
        {displayMessages.map((msg) => (
          <MessageItem
            key={msg.id}
            message={msg}
            searchHighlight={searchQuery}
            onSelect={onMessageSelect}
          />
        ))}
      </div>

      {displayMessages.length === 0 && (
        <p data-testid="empty-state">No messages yet</p>
      )}
    </div>
  );
};

describe('MessageStream', () => {
  describe('Prepending new messages', () => {
    it('should render all messages', () => {
      render(<MessageStream />);

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-2')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-3')).toBeInTheDocument();
    });

    it('should display message source and target', () => {
      render(<MessageStream />);

      expect(screen.getByTestId('message-source-msg-1')).toHaveTextContent('Coordinator');
      expect(screen.getByTestId('message-target-msg-1')).toHaveTextContent('Coder');
    });

    it('should display message type', () => {
      render(<MessageStream />);

      expect(screen.getByTestId('message-type-msg-1')).toHaveTextContent('task');
      expect(screen.getByTestId('message-type-msg-2')).toHaveTextContent('response');
      expect(screen.getByTestId('message-type-msg-3')).toHaveTextContent('task');
    });

    it('should display message content', () => {
      render(<MessageStream />);

      expect(screen.getByTestId('message-content-msg-1')).toHaveTextContent(
        'Implement feature X'
      );
    });

    it('should update when new messages arrive', () => {
      const initialMessages = mockMessages.slice(0, 2);
      const { rerender } = render(<MessageStream messages={initialMessages} />);

      expect(screen.queryByTestId('message-item-msg-3')).not.toBeInTheDocument();

      const updatedMessages = [...mockMessages.slice(0, 3)];
      rerender(<MessageStream messages={updatedMessages} />);

      expect(screen.getByTestId('message-item-msg-3')).toBeInTheDocument();
    });

    it('should show empty state when no messages', () => {
      render(<MessageStream messages={[]} />);

      expect(screen.getByTestId('empty-state')).toHaveTextContent('No messages yet');
    });
  });

  describe('Pause/Resume functionality', () => {
    it('should show pause button when not paused', () => {
      render(<MessageStream isPaused={false} />);

      expect(screen.getByTestId('pause-button')).toHaveTextContent('Pause');
    });

    it('should show resume button when paused', () => {
      render(<MessageStream isPaused={true} />);

      expect(screen.getByTestId('pause-button')).toHaveTextContent('Resume');
    });

    it('should call onPause when pause button clicked', () => {
      const onPause = vi.fn();
      render(<MessageStream isPaused={false} onPause={onPause} />);

      fireEvent.click(screen.getByTestId('pause-button'));

      expect(onPause).toHaveBeenCalled();
    });

    it('should call onResume when resume button clicked', () => {
      const onResume = vi.fn();
      render(<MessageStream isPaused={true} onResume={onResume} />);

      fireEvent.click(screen.getByTestId('pause-button'));

      expect(onResume).toHaveBeenCalled();
    });

    it('should show paused indicator when paused', () => {
      render(<MessageStream isPaused={true} />);

      expect(screen.getByTestId('paused-indicator')).toBeInTheDocument();
    });

    it('should not show paused indicator when not paused', () => {
      render(<MessageStream isPaused={false} />);

      expect(screen.queryByTestId('paused-indicator')).not.toBeInTheDocument();
    });

    it('should toggle pause state correctly', () => {
      const TestComponent = () => {
        const [paused, setPaused] = useState(false);
        return (
          <MessageStream
            isPaused={paused}
            onPause={() => setPaused(true)}
            onResume={() => setPaused(false)}
          />
        );
      };

      render(<TestComponent />);

      expect(screen.getByTestId('pause-button')).toHaveTextContent('Pause');
      expect(screen.queryByTestId('paused-indicator')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('pause-button'));

      expect(screen.getByTestId('pause-button')).toHaveTextContent('Resume');
      expect(screen.getByTestId('paused-indicator')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('pause-button'));

      expect(screen.getByTestId('pause-button')).toHaveTextContent('Pause');
      expect(screen.queryByTestId('paused-indicator')).not.toBeInTheDocument();
    });
  });

  describe('Max message limit', () => {
    it('should limit displayed messages to maxMessages', () => {
      const manyMessages: Message[] = Array.from({ length: 20 }, (_, i) => ({
        id: `msg-${i}`,
        source: 'agent-1',
        sourceName: 'Agent',
        messageType: 'info' as const,
        direction: 'internal' as const,
        content: `Message ${i}`,
        payload: {},
        size: 10,
        timestamp: new Date(Date.now() - i * 1000),
      }));

      render(<MessageStream messages={manyMessages} maxMessages={10} />);

      expect(screen.getByTestId('message-count')).toHaveTextContent('10 messages');
    });

    it('should show all messages when under limit', () => {
      render(<MessageStream messages={mockMessages} maxMessages={1000} />);

      expect(screen.getByTestId('message-count')).toHaveTextContent('5 messages');
    });
  });

  describe('Source/Target filtering', () => {
    it('should filter messages by source', () => {
      render(<MessageStream messages={mockMessages} sourceFilter={['agent-1']} />);

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-3')).toBeInTheDocument();
      expect(screen.queryByTestId('message-item-msg-2')).not.toBeInTheDocument();
    });

    it('should filter messages by target', () => {
      render(<MessageStream messages={mockMessages} targetFilter={['agent-2']} />);

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.queryByTestId('message-item-msg-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('message-item-msg-3')).not.toBeInTheDocument();
    });

    it('should apply both source and target filters', () => {
      render(
        <MessageStream
          messages={mockMessages}
          sourceFilter={['agent-1']}
          targetFilter={['agent-3']}
        />
      );

      expect(screen.getByTestId('message-item-msg-3')).toBeInTheDocument();
      expect(screen.queryByTestId('message-item-msg-1')).not.toBeInTheDocument();
    });

    it('should show empty state when filters match nothing', () => {
      render(
        <MessageStream messages={mockMessages} sourceFilter={['nonexistent']} />
      );

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  describe('Search highlighting', () => {
    it('should highlight matching text in content', () => {
      render(<MessageStream messages={mockMessages} searchQuery="feature" />);

      const highlights = screen.getAllByTestId('search-highlight');
      expect(highlights.length).toBeGreaterThan(0);
      expect(highlights[0]).toHaveTextContent('feature');
    });

    it('should highlight matching text in source name', () => {
      render(<MessageStream messages={mockMessages} searchQuery="Coordinator" />);

      const highlights = screen.getAllByTestId('search-highlight');
      expect(highlights.some((h) => h.textContent === 'Coordinator')).toBe(true);
    });

    it('should highlight matching text in target name', () => {
      render(<MessageStream messages={mockMessages} searchQuery="Coder" />);

      const highlights = screen.getAllByTestId('search-highlight');
      expect(highlights.some((h) => h.textContent === 'Coder')).toBe(true);
    });

    it('should be case-insensitive', () => {
      render(<MessageStream messages={mockMessages} searchQuery="FEATURE" />);

      const highlights = screen.getAllByTestId('search-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });

    it('should filter messages that do not match search', () => {
      render(<MessageStream messages={mockMessages} searchQuery="feature" />);

      // Messages containing "feature" should be visible
      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-3')).toBeInTheDocument();

      // Messages not containing "feature" should be filtered
      expect(screen.queryByTestId('message-item-msg-2')).not.toBeInTheDocument();
    });

    it('should show all messages when search query is empty', () => {
      render(<MessageStream messages={mockMessages} searchQuery="" />);

      expect(screen.getAllByTestId(/^message-item-/)).toHaveLength(5);
    });
  });

  describe('Message Selection', () => {
    it('should call onMessageSelect when message is clicked', () => {
      const onMessageSelect = vi.fn();
      render(<MessageStream onMessageSelect={onMessageSelect} />);

      fireEvent.click(screen.getByTestId('message-item-msg-1'));

      expect(onMessageSelect).toHaveBeenCalledWith('msg-1');
    });

    it('should call onMessageSelect with correct message id', () => {
      const onMessageSelect = vi.fn();
      render(<MessageStream onMessageSelect={onMessageSelect} />);

      fireEvent.click(screen.getByTestId('message-item-msg-2'));
      expect(onMessageSelect).toHaveBeenCalledWith('msg-2');

      fireEvent.click(screen.getByTestId('message-item-msg-3'));
      expect(onMessageSelect).toHaveBeenCalledWith('msg-3');
    });
  });

  describe('Message Count Display', () => {
    it('should display correct message count', () => {
      render(<MessageStream messages={mockMessages} />);

      expect(screen.getByTestId('message-count')).toHaveTextContent('5 messages');
    });

    it('should update count when messages change', () => {
      const { rerender } = render(<MessageStream messages={mockMessages.slice(0, 2)} />);

      expect(screen.getByTestId('message-count')).toHaveTextContent('2 messages');

      rerender(<MessageStream messages={mockMessages} />);

      expect(screen.getByTestId('message-count')).toHaveTextContent('5 messages');
    });

    it('should reflect filtered count', () => {
      render(<MessageStream messages={mockMessages} sourceFilter={['agent-1']} />);

      // Only messages from agent-1 (msg-1 and msg-3)
      expect(screen.getByTestId('message-count')).toHaveTextContent('2 messages');
    });
  });
});
