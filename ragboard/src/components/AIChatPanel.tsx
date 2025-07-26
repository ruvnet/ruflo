import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Sparkles, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useBoardStore } from '../store/boardStore';
import { ApiService } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Message } from '../types';

interface AIChatPanelProps {
  chatId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
  chatId,
  isOpen,
  onClose,
}) => {
  const [message, setMessage] = useState('');
  const [streamingMessage, setStreamingMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { aiChats, addMessage, resources } = useBoardStore();
  
  const chat = aiChats.get(chatId);
  const { execute: sendMessage, loading: sending } = useApi(ApiService.sendMessage);
  const { execute: getChatHistory } = useApi(ApiService.getChatHistory);

  // Load chat history on mount
  useEffect(() => {
    if (chatId && isOpen) {
      getChatHistory(chatId).then((messages) => {
        // Update store with loaded messages
        messages.forEach((msg) => {
          addMessage(chatId, msg);
        });
      }).catch(console.error);
    }
  }, [chatId, isOpen, getChatHistory, addMessage]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages, streamingMessage]);

  const handleSendMessage = async () => {
    if (!message.trim() || sending || !chat) return;

    const userMessage = message.trim();
    setMessage('');
    
    // Add user message to chat
    addMessage(chatId, {
      role: 'user',
      content: userMessage,
    });

    try {
      // Start streaming response
      setStreamingMessage('');
      let fullMessage = '';
      
      await ApiService.streamMessage(
        chatId,
        userMessage,
        chat.connectedResources,
        (chunk) => {
          fullMessage += chunk;
          setStreamingMessage(fullMessage);
        }
      );

      // Add complete AI message to chat
      if (fullMessage) {
        addMessage(chatId, {
          role: 'assistant',
          content: fullMessage,
        });
      }
      setStreamingMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      addMessage(chatId, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      });
    }
  };

  const getConnectedResourceNames = () => {
    if (!chat) return [];
    return chat.connectedResources
      .map((id) => resources.get(id))
      .filter(Boolean)
      .map((resource) => resource!.title);
  };

  if (!isOpen || !chat) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6" />
          <h2 className="text-lg font-semibold">AI Chat</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-white/20 rounded transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Connected Resources */}
      {chat.connectedResources.length > 0 && (
        <div className="bg-purple-50 p-3 border-b">
          <p className="text-sm text-purple-700">
            <span className="font-medium">Connected resources:</span>{' '}
            {getConnectedResourceNames().join(', ')}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chat.messages.length === 0 && !streamingMessage && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Sparkles className="w-12 h-12 mb-4" />
            <p className="text-center">
              Start a conversation about your connected resources.
              I can help analyze, summarize, and provide insights.
            </p>
          </div>
        )}
        
        {chat.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        
        {streamingMessage && (
          <MessageBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingMessage,
              timestamp: new Date(),
            }}
            isStreaming
          />
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask anything about your connected resources..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!message.trim() || sending}
            className={clsx(
              'px-4 py-2 rounded-lg transition-colors flex items-center gap-2',
              !message.trim() || sending
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-700'
            )}
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

// Message bubble component
const MessageBubble: React.FC<{
  message: Message;
  isStreaming?: boolean;
}> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';

  return (
    <div
      className={clsx(
        'flex gap-3',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
      )}
      
      <div
        className={clsx(
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser
            ? 'bg-purple-600 text-white'
            : 'bg-gray-100 text-gray-900'
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-gray-600 animate-pulse ml-1" />
        )}
      </div>
      
      {isUser && (
        <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-white text-sm font-medium">U</span>
        </div>
      )}
    </div>
  );
};