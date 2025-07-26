import React, { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '../types';
import { Folder as FolderIcon, ChevronRight, ChevronDown, X } from 'lucide-react';
import { clsx } from 'clsx';
import type { Folder } from '../types';
import { ResizableNodeWrapper } from './ResizableNodeWrapper';
import { useBoardStore } from '../store/boardStore';

export interface FolderNodeData extends Folder {
  onToggle?: (id: string) => void;
  onDelete?: (id: string) => void;
  childCount?: number;
}

export const FolderNode = memo<NodeProps<FolderNodeData>>(({ data, selected }) => {
  const ChevronIcon = data.isExpanded ? ChevronDown : ChevronRight;
  const [isDragOver, setIsDragOver] = useState(false);
  const addToFolder = useBoardStore((state) => state.addToFolder);
  const draggedResource = useBoardStore((state) => state.draggedResource);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedResource && draggedResource !== data.id) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    if (draggedResource && draggedResource !== data.id) {
      addToFolder(data.id, draggedResource);
    }
  };

  return (
    <ResizableNodeWrapper selected={selected} minWidth={200} minHeight={100}>
      <Handle type="target" position={Position.Top} className="!bg-purple-600" />
      
      <div
        className={clsx(
          'bg-white rounded-lg shadow-lg overflow-hidden transition-all duration-200 w-full h-full',
          selected && 'ring-2 ring-purple-600 ring-offset-2',
          isDragOver && 'ring-2 ring-green-500 bg-green-50',
          'hover:shadow-xl'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 bg-amber-50">
          <div className="flex items-center gap-2">
            <button
              onClick={() => data.onToggle?.(data.id)}
              className="p-1 hover:bg-amber-100 rounded transition-colors"
            >
              <ChevronIcon className="w-4 h-4 text-gray-600" />
            </button>
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <FolderIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">{data.title}</h3>
              <p className="text-xs text-gray-500">
                {data.childCount || data.children.length} items
              </p>
            </div>
          </div>
          {data.onDelete && (
            <button
              onClick={() => data.onDelete?.(data.id)}
              className="p-1 hover:bg-amber-100 rounded transition-colors"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {/* Preview of contents when expanded */}
        {data.isExpanded && data.children.length > 0 && (
          <div className="p-3 pt-0">
            <div className="text-xs text-gray-500 space-y-1">
              {data.children.slice(0, 3).map((childId, index) => (
                <div key={childId} className="flex items-center gap-1">
                  <div className="w-1 h-1 bg-gray-400 rounded-full" />
                  <span>Resource {index + 1}</span>
                </div>
              ))}
              {data.children.length > 3 && (
                <div className="text-gray-400">
                  +{data.children.length - 3} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-purple-600" />
    </ResizableNodeWrapper>
  );
});

FolderNode.displayName = 'FolderNode';