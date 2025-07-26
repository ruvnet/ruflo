import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Sparkles, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useBoardStore } from '../store/boardStore';
import { ApiService } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Message } from '../types';

interface AIChatFloatingProps {
  chatId: string;
  onClose: () => void;
  onFullScreen: () => void;
}

export const AIChatFloating: React.FC<AIChatFloatingProps> = ({
  chatId,
  onClose,
  onFullScreen,
}) => {
  const [message, setMessage] = useState('');
  const [streamingMessage, setStreamingMessage] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { aiChats, addMessage, resources } = useBoardStore();
  
  const chat = aiChats.get(chatId);
  const { execute: sendMessage, loading: sending } = useApi(ApiService.sendMessage);
  const { execute: getChatHistory } = useApi(ApiService.getChatHistory);

  // Load chat history on mount
  useEffect(() => {
    if (chatId) {
      getChatHistory(chatId).then((messages) => {
        messages.forEach((msg) => {
          addMessage(chatId, msg);
        });
      }).catch(console.error);
    }
  }, [chatId, getChatHistory, addMessage]);

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

  if (!chat) return null;

  return (
    <>
      {/* Floating buttons that appear on hover - keep them visible longer */}
      <div 
        className={`chat-action-buttons fixed flex gap-2 z-[101] transition-all duration-300 ${
          showButtons ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        style={{
          bottom: isMinimized ? '90px' : '450px',
          right: '24px',
        }}
        onMouseEnter={() => setShowButtons(true)}
        onMouseLeave={() => setTimeout(() => setShowButtons(false), 100)}
      >
        <button
          onClick={onFullScreen}
          className="px-3 py-1.5 bg-white text-gray-700 text-sm rounded-md shadow-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5"
          onMouseEnter={(e) => e.stopPropagation()}
        >
          <Maximize2 className="w-4 h-4" />
          Full Screen
        </button>
        <button
          onClick={() => {/* Add zoom functionality */}}
          className="px-3 py-1.5 bg-white text-gray-700 text-sm rounded-md shadow-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5"
          onMouseEnter={(e) => e.stopPropagation()}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
          </svg>
          Zoom
        </button>
      </div>

      {/* Chat window */}
      <div
        className="fixed bg-white shadow-xl rounded-lg overflow-hidden flex flex-col transition-all duration-300"
        style={{
          bottom: '24px',
          right: '24px',
          width: '380px',
          height: isMinimized ? '60px' : '420px',
          zIndex: 100,
        }}
        onMouseEnter={() => setShowButtons(true)}
        onMouseLeave={(e) => {
          // Don't hide if moving to buttons
          const relatedTarget = e.relatedTarget as HTMLElement;
          if (!relatedTarget?.closest('.chat-action-buttons')) {
            setTimeout(() => setShowButtons(false), 300);
          }
        }}
      >
        {/* Header */}
        <div className="bg-purple-600 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">AI Assistant</h3>
              {chat.connectedResources.length > 0 && (
                <p className="text-xs text-purple-200">
                  {chat.connectedResources.length} resources connected
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 hover:bg-white/20 rounded transition-colors"
              title={isMinimized ? "Restore" : "Minimize"}
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/20 rounded transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {chat.messages.length === 0 && !streamingMessage && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
                  <Sparkles className="w-8 h-8 mb-3 text-purple-400" />
                  <p className="text-center text-gray-600">
                    Ask me anything about your connected resources.
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
            <div className="border-t bg-white p-3">
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
                  placeholder="Type your message..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={!message.trim() || sending}
                  className={clsx(
                    'px-3 py-2 rounded-lg transition-colors flex items-center justify-center',
                    !message.trim() || sending
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 text-white hover:bg-purple-700'
                  )}
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </>
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
        'flex gap-2',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-purple-600" />
        </div>
      )}
      
      <div
        className={clsx(
          'max-w-[80%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-purple-600 text-white'
            : 'bg-white text-gray-800 border border-gray-200'
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-purple-600 animate-pulse ml-1" />
        )}
      </div>
      
      {isUser && (
        <div className="w-7 h-7 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-medium">U</span>
        </div>
      )}
    </div>
  );
};