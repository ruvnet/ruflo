import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '../types';
import { 
  Youtube, 
  Instagram, 
  Music, 
  FileText, 
  Image,
  Link,
  X,
  GripVertical
} from 'lucide-react';
import { clsx } from 'clsx';
import type { Resource, Platform } from '../types';
import { ResizableNodeWrapper } from './ResizableNodeWrapper';
import { useBoardStore } from '../store/boardStore';

const platformIcons: Record<Platform, React.ElementType> = {
  youtube: Youtube,
  instagram: Instagram,
  tiktok: Music,
  linkedin: Link,
  facebook: Link,
  web: Link,
};

const platformColors: Record<Platform, string> = {
  youtube: 'bg-red-500',
  instagram: 'bg-gradient-to-br from-purple-600 to-pink-500',
  tiktok: 'bg-black',
  linkedin: 'bg-blue-600',
  facebook: 'bg-blue-500',
  web: 'bg-gray-500',
};

export interface ResourceNodeData extends Resource {
  onDelete?: (id: string) => void;
  isSelected?: boolean;
}

export const ResourceNode = memo<NodeProps<ResourceNodeData>>(({ data, selected }) => {
  const Icon = data.platform ? platformIcons[data.platform] : FileText;
  const bgColor = data.platform ? platformColors[data.platform] : 'bg-gray-400';
  const setDraggedResource = useBoardStore((state) => state.setDraggedResource);

  const handleDragStart = (e: React.DragEvent) => {
    setDraggedResource(data.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedResource(null);
  };

  const getPreview = () => {
    if (data.type === 'image' && data.url) {
      return (
        <div className="w-full h-32 relative overflow-hidden">
          <img 
            src={data.url} 
            alt={data.title}
            className="w-full h-full object-cover"
          />
        </div>
      );
    }

    if (data.type === 'text' && data.content) {
      return (
        <div className="p-3 text-xs text-gray-600 line-clamp-3">
          {data.content}
        </div>
      );
    }

    if (data.platform && data.metadata?.thumbnail) {
      return (
        <div className="w-full h-32 relative overflow-hidden">
          <img 
            src={data.metadata.thumbnail} 
            alt={data.title}
            className="w-full h-full object-cover"
          />
          <div className={clsx('absolute top-2 left-2 w-8 h-8 rounded-full flex items-center justify-center', bgColor)}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <ResizableNodeWrapper selected={selected} minWidth={200} minHeight={150}>
      <Handle type="target" position={Position.Top} className="!bg-purple-600" />
      
      <div
        className={clsx(
          'bg-white rounded-lg shadow-lg overflow-hidden transition-all duration-200 w-full h-full',
          selected && 'ring-2 ring-purple-600 ring-offset-2',
          'hover:shadow-xl'
        )}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between p-3 border-b"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-gray-400 cursor-move" />
            <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center', bgColor)}>
              <Icon className="w-5 h-5 text-white" />
            </div>
          </div>
          {data.onDelete && (
            <button
              onClick={() => data.onDelete?.(data.id)}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {/* Preview */}
        {getPreview()}

        {/* Title */}
        <div className="p-3">
          <h3 className="text-sm font-medium text-gray-900 truncate">{data.title}</h3>
          {data.metadata?.duration && (
            <p className="text-xs text-gray-500 mt-1">{data.metadata.duration}</p>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-purple-600" />
    </ResizableNodeWrapper>
  );
});

ResourceNode.displayName = 'ResourceNode';