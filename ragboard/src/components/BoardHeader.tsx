import React, { useState } from 'react';
import { Edit2, Check, X } from 'lucide-react';
import { clsx } from 'clsx';

interface BoardHeaderProps {
  boardName: string;
  onBoardNameChange: (name: string) => void;
}

export const BoardHeader: React.FC<BoardHeaderProps> = ({
  boardName,
  onBoardNameChange,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(boardName);

  const handleSave = () => {
    if (editValue.trim()) {
      onBoardNameChange(editValue.trim());
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditValue(boardName);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div className="absolute top-0 left-0 right-0 bg-white border-b z-10">
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          {/* Logo */}
          <img 
            src="/brand-assets/MVM Logo.png" 
            alt="MVM Logo" 
            className="h-8 w-auto"
            onError={(e) => {
              // Fallback if logo is not found
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
          
          {/* Board Name */}
          <div className="flex items-center gap-3">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="px-2 py-1 text-lg font-semibold border border-purple-500 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
              <button
                onClick={handleSave}
                className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                title="Save"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={handleCancel}
                className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-lg font-semibold text-gray-900">{boardName}</h1>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit board name"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          )}
          </div>
        </div>

        {/* Future: Add board switching and other controls here */}
        <div className="flex items-center gap-2">
          {/* Placeholder for future controls */}
        </div>
      </div>
    </div>
  );
};