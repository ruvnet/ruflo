import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Send, Plus, Image as ImageIcon, Minimize2, Share, 
  Sparkles, Upload, Search, Clock, MessageSquare
} from 'lucide-react';
import { clsx } from 'clsx';
import { useBoardStore } from '../store/boardStore';
import { ApiService } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Message } from '../types';

interface AIChatFullScreenNewProps {
  chatId: string;
  onClose: () => void;
  onMinimize: () => void;
}

export const AIChatFullScreenNew: React.FC<AIChatFullScreenNewProps> = ({
  chatId,
  onClose,
  onMinimize,
}) => {
  const [message, setMessage] = useState('');
  const [streamingMessage, setStreamingMessage] = useState('');
  const [selectedConversation, setSelectedConversation] = useState(chatId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { aiChats, addMessage, resources } = useBoardStore();
  
  const chat = aiChats.get(selectedConversation);
  const { execute: sendMessage, loading: sending } = useApi(ApiService.sendMessage);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages, streamingMessage]);

  const handleSendMessage = async () => {
    if (!message.trim() || sending || !chat) return;

    const userMessage = message.trim();
    setMessage('');
    
    // Add user message to chat
    addMessage(selectedConversation, {
      role: 'user',
      content: userMessage,
    });

    try {
      // Start streaming response
      setStreamingMessage('');
      let fullMessage = '';
      
      await ApiService.streamMessage(
        selectedConversation,
        userMessage,
        chat.connectedResources,
        (chunk) => {
          fullMessage += chunk;
          setStreamingMessage(fullMessage);
        }
      );

      // Add complete AI message to chat
      if (fullMessage) {
        addMessage(selectedConversation, {
          role: 'assistant',
          content: fullMessage,
        });
      }
      setStreamingMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      addMessage(selectedConversation, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      });
    }
  };

  if (!chat) return null;

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-semibold text-purple-600">Purple Firefly</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-md text-sm">🎯 Hiring</span>
            <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded-md text-sm">😊 Affiliate</span>
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-sm">🤖 APIs</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">562 / 2.0k</span>
          <button className="px-4 py-1.5 border border-gray-300 rounded-md text-sm hover:bg-gray-50">
            Upgrade
          </button>
          <button className="px-4 py-1.5 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700 flex items-center gap-2">
            <Share className="w-4 h-4" />
            Share
          </button>
          <button className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
            Refer & Earn $70 💰
          </button>
          <button
            onClick={onMinimize}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="Minimize chat"
          >
            <Minimize2 className="w-5 h-5 text-gray-600" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col">
          <div className="p-4">
            <button className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center justify-center gap-2">
              <Plus className="w-5 h-5" />
              New Conversation
            </button>
          </div>
          
          <div className="px-4 pb-2">
            <h3 className="text-sm font-medium text-gray-500">Previous Conversations</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto px-2">
            {/* Conversation list would go here */}
            <div className="space-y-1">
              <div className="p-3 bg-white rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                <div className="flex items-start gap-3">
                  <MessageSquare className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">Current Board Chat</p>
                    <p className="text-xs text-gray-500 truncate">Connected resources: {chat.connectedResources.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col">
          {/* Chat header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">New Conversation</h2>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {chat.messages.length === 0 && !streamingMessage && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="w-8 h-8 text-purple-600" />
                </div>
                <p className="text-lg font-medium text-gray-600 mb-2">Start a conversation</p>
                <p className="text-sm text-gray-500 text-center max-w-md">
                  I can help you analyze your connected resources, answer questions, and provide insights.
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

          {/* Create Mindmap button */}
          <div className="px-6 py-3 border-t border-gray-100">
            <button className="text-purple-600 hover:text-purple-700 flex items-center gap-2 text-sm font-medium">
              <span className="text-lg">🎯</span>
              Create Mindmap
            </button>
          </div>

          {/* Input area */}
          <div className="px-6 py-4 border-t border-gray-200">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex gap-3"
            >
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask anything or press / for actions"
                  className="w-full px-4 py-3 pr-24 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  disabled={sending}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                    title="Upload image"
                  >
                    <ImageIcon className="w-4 h-4 text-gray-500" />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                    title="Attach file"
                  >
                    <Upload className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={!message.trim() || sending}
                className={clsx(
                  'p-3 rounded-lg transition-colors',
                  !message.trim() || sending
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                )}
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
            
            {/* Bottom toolbar */}
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-md text-sm font-medium flex items-center gap-1.5">
                  <div className="w-4 h-4 bg-orange-600 rounded-full" />
                  Claude 4 Sonnet
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button className="px-3 py-1.5 hover:bg-gray-100 rounded-md text-sm text-gray-600 flex items-center gap-1.5">
                  <Search className="w-4 h-4" />
                  Search
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <button className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-md font-medium">
                  Summarize
                </button>
                <button className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-md font-medium">
                  Get Key Insights
                </button>
                <button className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-md font-medium">
                  Write Email
                </button>
              </div>
            </div>
          </div>
        </div>
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
    <div className={clsx('mb-6', isUser ? 'flex justify-end' : '')}>
      <div className={clsx('max-w-3xl', isUser ? 'text-right' : '')}>
        {!isUser && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700">AI Assistant</span>
          </div>
        )}
        <div
          className={clsx(
            'inline-block px-4 py-3 rounded-lg',
            isUser
              ? 'bg-purple-600 text-white'
              : 'bg-gray-100 text-gray-900'
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-purple-600 animate-pulse ml-1" />
          )}
        </div>
      </div>
    </div>
  );
};

// Add missing import
const ChevronDown = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);