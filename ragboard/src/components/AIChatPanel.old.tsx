import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageCircle, 
  Send, 
  Mic, 
  Search,
  ChevronDown,
  Plus,
  Sparkles,
  Mail,
  Brain,
  X
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

interface AIChatPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  onCreateMindmap?: () => void;
}

export const AIChatPanel: React.FC<AIChatPanelProps> = ({
  isOpen = true,
  onClose,
  onCreateMindmap,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showPreviousConversations, setShowPreviousConversations] = useState(false);
  const [selectedModel, setSelectedModel] = useState('Claude 4 Sonnet');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const models = ['Claude 4 Sonnet', 'Claude 4 Opus', 'Claude 3.5 Sonnet', 'GPT-4'];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeConversation?.messages]);

  const handleSendMessage = () => {
    if (inputValue.trim() && activeConversation) {
      const newMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: inputValue,
        timestamp: new Date(),
      };

      const updatedConversation = {
        ...activeConversation,
        messages: [...activeConversation.messages, newMessage],
      };

      setActiveConversation(updatedConversation);
      setConversations(convs => 
        convs.map(c => c.id === activeConversation.id ? updatedConversation : c)
      );

      setInputValue('');

      // Simulate AI response
      setTimeout(() => {
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'I can help you analyze the connected resources. Based on the content you\'ve added, I can provide insights, summaries, or help you create new content.',
          timestamp: new Date(),
        };

        setActiveConversation(prev => prev ? {
          ...prev,
          messages: [...prev.messages, aiResponse],
        } : null);
      }, 1000);
    }
  };

  const handleNewConversation = () => {
    const newConversation: Conversation = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    };

    setConversations([...conversations, newConversation]);
    setActiveConversation(newConversation);
    setShowPreviousConversations(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-16 bottom-0 w-[400px] bg-gradient-to-b from-purple-50 to-white border-l border-gray-200 flex flex-col z-40">
      {/* Header */}
      <div className="p-4 border-b border-purple-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-purple-800">AI Chat</span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-purple-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          )}
        </div>

        {!activeConversation ? (
          <button
            onClick={handleNewConversation}
            className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Conversation
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">{activeConversation.title}</h3>
            <button
              onClick={() => setShowPreviousConversations(!showPreviousConversations)}
              className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1"
            >
              Previous Conversations
              <ChevronDown className={`w-4 h-4 transition-transform ${showPreviousConversations ? 'rotate-180' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {/* Previous Conversations Dropdown */}
      {showPreviousConversations && (
        <div className="p-2 border-b border-purple-100 bg-purple-50 max-h-48 overflow-y-auto">
          {conversations.map(conv => (
            <button
              key={conv.id}
              onClick={() => {
                setActiveConversation(conv);
                setShowPreviousConversations(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg hover:bg-purple-100 transition-colors ${
                activeConversation?.id === conv.id ? 'bg-purple-100' : ''
              }`}
            >
              <p className="text-sm font-medium text-gray-800">{conv.title}</p>
              <p className="text-xs text-gray-600">
                {conv.createdAt.toLocaleDateString()} • {conv.messages.length} messages
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeConversation?.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4">
            <Sparkles className="w-12 h-12 text-purple-300" />
            <p className="text-sm text-center">
              Start a conversation by typing a message or connecting resources to analyze
            </p>
          </div>
        )}

        {activeConversation?.messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[85%] px-4 py-2 rounded-lg text-sm
                ${message.role === 'user' 
                  ? 'bg-purple-600 text-white' 
                  : 'bg-white border border-gray-200 text-gray-800 shadow-sm'}
              `}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <p className="text-xs opacity-70 mt-1">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Create Mindmap Button */}
      {activeConversation && activeConversation.messages.length > 0 && (
        <div className="px-4 py-2 border-t border-purple-100">
          <button
            onClick={onCreateMindmap}
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all flex items-center justify-center gap-2"
          >
            <Brain className="w-4 h-4" />
            Create Mindmap
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-purple-100 bg-white">
        <div className="mb-3">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask anything or press / for actions"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
            rows={3}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Mic className="w-4 h-4 text-gray-600" />
            </button>
            
            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {models.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 pointer-events-none" />
            </div>

            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Search className="w-4 h-4 text-gray-600" />
            </button>
          </div>

          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || !activeConversation}
            className="p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs">
          <button className="text-purple-600 hover:text-purple-700 transition-colors">
            Summarize
          </button>
          <button className="text-purple-600 hover:text-purple-700 transition-colors">
            Get Key Insights
          </button>
          <button className="text-purple-600 hover:text-purple-700 transition-colors flex items-center gap-1">
            <Mail className="w-3 h-3" />
            Write Email
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatPanel;