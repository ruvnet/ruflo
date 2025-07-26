import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';

interface FolderNodeData {
  name?: string;
  title?: string;
  expanded?: boolean;
  childNodes?: string[];
}

const FolderNodeFlow: React.FC<NodeProps<FolderNodeData>> = ({
  data,
  selected,
  id,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(data.expanded || false);
  const title = data.name || data.title || 'Folder';
  const childNodes = data.childNodes || [];

  return (
    <div
      className={`
        bg-white rounded-lg shadow-md border-2 transition-all duration-200
        ${selected ? 'border-purple-500 shadow-lg' : 'border-gray-200'}
        min-w-[250px] max-w-[300px]
      `}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            {isExpanded ? (
              <FolderOpen className="w-5 h-5 text-purple-600" />
            ) : (
              <Folder className="w-5 h-5 text-purple-600" />
            )}
            <h3 className="font-semibold text-gray-800">{title}</h3>
          </div>
          
          {childNodes.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="p-1 hover:bg-purple-100 rounded transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-600" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-600" />
              )}
            </button>
          )}
        </div>
        
        <div className="text-sm text-gray-600">
          {childNodes.length} {childNodes.length === 1 ? 'item' : 'items'}
        </div>
        
        {isExpanded && childNodes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {childNodes.map((childId, index) => (
                <div
                  key={childId}
                  className="text-sm text-gray-700 pl-2 py-1 hover:bg-purple-50 rounded"
                >
                  • Node {childId}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Connection Handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-purple-400 !border-2 !border-white"
        style={{ top: -6 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-purple-400 !border-2 !border-white"
        style={{ bottom: -6 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-purple-400 !border-2 !border-white"
        style={{ left: -6 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 !bg-purple-400 !border-2 !border-white"
        style={{ right: -6 }}
      />
    </div>
  );
};

export default memo(FolderNodeFlow);