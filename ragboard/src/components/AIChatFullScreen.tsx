import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Send, Sparkles, Loader2, Plus, Image as ImageIcon, Mic, ChevronDown,
  MessageSquare, Paperclip, Settings, Maximize2
} from 'lucide-react';
import { clsx } from 'clsx';
import { useBoardStore } from '../store/boardStore';
import { ApiService } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Message } from '../types';

interface AIChatFullScreenProps {
  chatId: string;
  onClose: () => void;
}

export const AIChatFullScreen: React.FC<AIChatFullScreenProps> = ({
  chatId,
  onClose,
}) => {
  const [message, setMessage] = useState('');
  const [streamingMessage, setStreamingMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState('claude-4-sonnet');
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { aiChats, addMessage, resources } = useBoardStore();
  
  const chat = aiChats.get(chatId);
  const { execute: sendMessage, loading: sending } = useApi(ApiService.sendMessage);
  const { execute: getChatHistory } = useApi(ApiService.getChatHistory);

  // Model options
  const models = [
    { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', icon: '🟣' },
    { id: 'gpt-4', name: 'GPT-4', icon: '🟢' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus', icon: '🔵' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', icon: '⚪' },
  ];

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

  const handleImageUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Handle file upload logic here
      console.log('File selected:', file);
    }
  };

  if (!chat) return null;

  return (
    <div className="fixed inset-0 bg-white z-50 flex">
      {/* Top Navigation Bar */}
      <div className="absolute top-0 left-0 right-0 bg-white border-b z-10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-lg">Purple Firefly</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="text-yellow-500">🔥 Hiring</span>
            <span className="text-yellow-500">😊 Affiliate</span>
            <span className="text-gray-500">👤 APIs</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">562 / 2.0k</span>
          <button className="px-4 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            Upgrade
          </button>
          <button className="px-4 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Share
          </button>
          <button className="px-4 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600">
            Refer & Earn $70 💰
          </button>
          <button
            onClick={() => {}}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            title="Minimize"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <span className="text-sm text-gray-400">ESC</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex w-full pt-14">
        {/* Sidebar */}
        <div className="w-64 bg-gray-50 border-r flex flex-col">
          {/* New Conversation Button */}
          <div className="p-4">
            <button className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-lg hover:bg-purple-700 transition-colors">
              <Plus className="w-5 h-5" />
              New Conversation
            </button>
          </div>

          {/* Previous Conversations */}
          <div className="px-4 pb-2">
            <h3 className="text-sm font-medium text-gray-500">Previous Conversations</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {/* Current conversation would be highlighted here */}
            <div className="mx-2 px-3 py-2 bg-purple-100 rounded-lg">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium text-purple-900 truncate">New Conversation</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Chat Header */}
          <div className="bg-white border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">New Conversation</h2>
              <button
                onClick={onClose}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100 transition-colors flex items-center gap-2"
              >
                <span>Minimize chat</span>
                <span className="text-xs bg-gray-200 px-1.5 py-0.5 rounded">ESC</span>
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto bg-gray-50">
            <div className="max-w-3xl mx-auto p-6 space-y-6">
              {chat.messages.length === 0 && !streamingMessage && (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="text-6xl mb-6">🔮</div>
                  <h3 className="text-2xl font-semibold text-gray-800 mb-2">Ask me anything</h3>
                  <p className="text-gray-600 text-center max-w-md">
                    I'm here to help with your questions about the connected resources.
                  </p>
                  
                  {/* Create Mindmap button */}
                  <button className="mt-8 flex items-center gap-2 text-purple-600 hover:text-purple-700 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Create Mindmap
                  </button>
                </div>
              )}
              
              {chat.messages.map((msg) => (
                <MessageBubbleFullScreen key={msg.id} message={msg} />
              ))}
              
              {streamingMessage && (
                <MessageBubbleFullScreen
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
          </div>

          {/* Input Area */}
          <div className="bg-white border-t">
            <div className="max-w-3xl mx-auto p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="relative"
              >
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Ask anything or press / for actions"
                    className="flex-1 bg-transparent outline-none text-gray-800 placeholder-gray-400"
                    disabled={sending}
                  />
                  
                  {/* Voice input button */}
                  <button
                    type="button"
                    className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Voice input"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                </div>

                {/* Bottom toolbar */}
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-3">
                    {/* Image upload */}
                    <button
                      type="button"
                      onClick={handleImageUpload}
                      className="p-2 text-gray-500 hover:text-gray-700 transition-colors"
                      title="Upload image"
                    >
                      <ImageIcon className="w-5 h-5" />
                    </button>

                    {/* Model selector */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-sm hover:bg-purple-200 transition-colors"
                      >
                        <span>{models.find(m => m.id === selectedModel)?.icon}</span>
                        <span>{models.find(m => m.id === selectedModel)?.name}</span>
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      
                      {showModelDropdown && (
                        <div className="absolute bottom-full mb-2 left-0 bg-white border rounded-lg shadow-lg py-1 min-w-[200px]">
                          {models.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => {
                                setSelectedModel(model.id);
                                setShowModelDropdown(false);
                              }}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors flex items-center gap-2"
                            >
                              <span>{model.icon}</span>
                              <span>{model.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Search toggle */}
                    <button
                      type="button"
                      onClick={() => setSearchEnabled(!searchEnabled)}
                      className={clsx(
                        'px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2',
                        searchEnabled 
                          ? 'bg-purple-600 text-white' 
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      )}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      Search
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 transition-colors"
                    >
                      Summarize
                    </button>
                    <button
                      type="button"
                      className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 transition-colors"
                    >
                      Get Key Insights
                    </button>
                    <button
                      type="button"
                      className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 transition-colors"
                    >
                      Write Email
                    </button>
                  </div>
                </div>
              </form>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Full screen message bubble component
const MessageBubbleFullScreen: React.FC<{
  message: Message;
  isStreaming?: boolean;
}> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';

  return (
    <div className={clsx('flex gap-4', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-6 h-6 text-purple-600" />
        </div>
      )}
      
      <div className={clsx('max-w-2xl')}>
        <div
          className={clsx(
            'rounded-lg px-4 py-3',
            isUser
              ? 'bg-purple-600 text-white'
              : 'bg-white text-gray-900 shadow-sm border border-gray-100'
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-purple-600 animate-pulse ml-1" />
          )}
        </div>
      </div>
      
      {isUser && (
        <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-white font-medium">U</span>
        </div>
      )}
    </div>
  );
};