import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Link, X } from 'lucide-react';
import { useBoardStore } from '../store/boardStore';

interface URLNodeData {
  title: string;
  url: string;
  platform?: string;
  metadata?: {
    thumbnail?: string;
    description?: string;
    favicon?: string;
  };
}

const URLNode: React.FC<NodeProps<URLNodeData>> = ({ data, selected, id }) => {
  const deleteNode = useBoardStore((state) => state.deleteNode);

  const getPlatformIcon = () => {
    // In a real app, would have specific icons for each platform
    return <Link className="w-5 h-5" />;
  };

  return (
    <div
      className={`relative group rounded-lg border-2 ${
        selected ? 'border-blue-600 shadow-lg' : 'border-blue-400'
      } bg-white min-w-[280px] transition-all hover:shadow-md`}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <button
        onClick={() => deleteNode(id)}
        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600 z-10"
      >
        <X className="w-4 h-4" />
      </button>

      {data.metadata?.thumbnail && (
        <div className="h-32 overflow-hidden rounded-t-lg">
          <img
            src={data.metadata.thumbnail}
            alt={data.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="text-blue-600">{getPlatformIcon()}</div>
          <div className="flex-1">
            <h3 className="font-medium text-gray-800 text-sm line-clamp-2">
              {data.title}
            </h3>
            {data.metadata?.description && (
              <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                {data.metadata.description}
              </p>
            )}
            <a
              href={data.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
            >
              <span className="truncate max-w-[200px]">{data.url}</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default URLNode;