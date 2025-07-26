import React, { useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Type, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useBoardStore } from '../store/boardStore';
import { ResizableNodeWrapper } from './ResizableNodeWrapper';

interface TextNodeData {
  id: string;
  title: string;
  metadata?: {
    content?: string;
  };
  onDelete: (id: string) => void;
}

export const TextNode: React.FC<NodeProps<TextNodeData>> = ({ data, selected }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(data.metadata?.content || 'Double-click to edit...');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateResource = useBoardStore((state) => state.updateResource);
  const setDraggedResource = useBoardStore((state) => state.setDraggedResource);

  const handleDragStart = (e: React.DragEvent) => {
    if (!isEditing) {
      setDraggedResource(data.id);
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragEnd = () => {
    setDraggedResource(null);
  };

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleSave = () => {
    updateResource(data.id, {
      metadata: {
        ...data.metadata,
        content,
      },
    });
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setContent(data.metadata?.content || '');
      setIsEditing(false);
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    }
  };

  return (
    <ResizableNodeWrapper selected={selected} minWidth={200} minHeight={100}>
      <div
        className={clsx(
          'w-full h-full bg-white rounded-lg shadow-md transition-all',
          selected && 'ring-2 ring-purple-500',
          'hover:shadow-lg'
        )}
        onDoubleClick={handleDoubleClick}
      >
        <Handle type="target" position={Position.Top} />
      
      {/* Header */}
      <div 
        className="px-3 py-2 bg-yellow-50 rounded-t-lg border-b flex items-center justify-between"
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-yellow-600" />
          <span className="text-sm font-medium text-gray-700">Text Note</span>
        </div>
        <button
          onClick={() => data.onDelete(data.id)}
          className="p-1 hover:bg-yellow-100 rounded transition-colors"
        >
          <X className="w-3 h-3 text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="p-3">
        {isEditing ? (
          <div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className="w-full min-h-[60px] p-2 text-sm border border-purple-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              placeholder="Enter your text..."
            />
            <div className="mt-2 text-xs text-gray-500">
              Press Ctrl+Enter to save, Esc to cancel
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-700 whitespace-pre-wrap min-h-[60px]">
            {content || 'Double-click to edit...'}
          </p>
        )}
      </div>

        <Handle type="source" position={Position.Bottom} />
      </div>
    </ResizableNodeWrapper>
  );
};