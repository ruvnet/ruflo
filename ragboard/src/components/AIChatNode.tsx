import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '../types';
import { MessageSquare, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import type { AIChat } from '../types';
import { ResizableNodeWrapper } from './ResizableNodeWrapper';

export interface AIChatNodeData extends AIChat {
  onClick?: (id: string) => void;
}

export const AIChatNode = memo<NodeProps<AIChatNodeData>>(({ data, selected }) => {
  const hasConnections = data.connectedResources.length > 0;
  const lastMessage = data.messages[data.messages.length - 1];

  return (
    <ResizableNodeWrapper selected={selected} minWidth={250} minHeight={150}>
      <Handle type="target" position={Position.Top} className="!bg-purple-600" />
      
      <div
        className={clsx(
          'bg-gradient-to-br from-purple-600 to-purple-700 rounded-lg shadow-lg overflow-hidden transition-all duration-200',
          'w-full h-full cursor-pointer',
          selected && 'ring-2 ring-purple-600 ring-offset-2',
          'hover:shadow-xl hover:scale-105'
        )}
        onClick={() => data.onClick?.(data.id)}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 text-white">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            <span className="font-medium">AI Chat</span>
          </div>
          <Sparkles className="w-4 h-4 animate-pulse" />
        </div>

        {/* Connection Status */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 text-purple-200 text-sm">
            {hasConnections ? (
              <>
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span>{data.connectedResources.length} resources connected</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-gray-400 rounded-full" />
                <span>No resources connected</span>
              </>
            )}
          </div>
        </div>

        {/* Last Message Preview */}
        {lastMessage && (
          <div className="bg-white/10 backdrop-blur-sm p-3 m-2 rounded text-white text-sm">
            <p className="opacity-70 text-xs mb-1">
              {lastMessage.role === 'user' ? 'You' : 'AI'}:
            </p>
            <p className="line-clamp-2">{lastMessage.content}</p>
          </div>
        )}

        {/* Click to Open */}
        <div className="text-center text-purple-200 text-xs pb-3">
          Click to open chat
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-purple-600" />
    </ResizableNodeWrapper>
  );
});

AIChatNode.displayName = 'AIChatNode';