import React from 'react';
import { MessageCircle, X } from 'lucide-react';

interface AIChatMinimizedProps {
  onExpand: () => void;
  onClose: () => void;
  hasNewMessage?: boolean;
}

export const AIChatMinimized: React.FC<AIChatMinimizedProps> = ({
  onExpand,
  onClose,
  hasNewMessage = false,
}) => {
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="relative">
        {/* Main chat bubble */}
        <button
          onClick={onExpand}
          className="w-14 h-14 bg-purple-600 rounded-full shadow-lg hover:bg-purple-700 transition-all hover:scale-105 flex items-center justify-center group"
        >
          <MessageCircle className="w-6 h-6 text-white" />
          
          {/* New message indicator */}
          {hasNewMessage && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          )}
        </button>

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute -top-2 -right-2 w-6 h-6 bg-gray-800 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-gray-900"
        >
          <X className="w-3 h-3" />
        </button>

        {/* Hover tooltip */}
        <div className="absolute bottom-full right-0 mb-2 px-3 py-1 bg-gray-800 text-white text-sm rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          AI Assistant
        </div>
      </div>
    </div>
  );
};