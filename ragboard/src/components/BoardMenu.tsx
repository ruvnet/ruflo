import React, { useState } from 'react';
import { Save, FolderOpen, Download, Upload, Plus, Clock } from 'lucide-react';
import { useBoardStore } from '../store/boardStore';
import { ApiService } from '../services/api';
import { useApi } from '../hooks/useApi';

interface BoardMenuProps {
  boardName: string;
  onBoardNameChange: (name: string) => void;
}

export const BoardMenu: React.FC<BoardMenuProps> = ({ boardName, onBoardNameChange }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [savedBoards, setSavedBoards] = useState<Array<{id: string; name: string; updatedAt: Date}>>([]);
  
  const { resources, connections, aiChats } = useBoardStore();
  const { execute: saveBoard, loading: saving } = useApi(ApiService.saveBoard);
  const { execute: loadBoard, loading: loading } = useApi(ApiService.loadBoard);
  const { execute: listBoards } = useApi(ApiService.listBoards);

  const handleSaveBoard = async () => {
    try {
      const boardData = {
        name: boardName,
        resources: Array.from(resources.values()),
        connections,
        aiChats: Array.from(aiChats.values()),
      };
      
      await saveBoard(boardData);
      alert('Board saved successfully!');
    } catch (error: any) {
      console.error('Error saving board:', error);
      if (error.response?.status === 401) {
        alert('Please log in to save boards');
      } else {
        alert('Failed to save board. The board save/load feature requires backend connection.');
      }
    }
  };

  const handleLoadBoard = async (boardId: string) => {
    try {
      const boardData = await loadBoard(boardId);
      // Clear current board
      useBoardStore.setState({
        resources: new Map(boardData.resources.map(r => [r.id, r])),
        connections: boardData.connections,
        aiChats: new Map(boardData.aiChats.map(c => [c.id, c])),
      });
      onBoardNameChange(boardData.name);
      setShowLoadDialog(false);
    } catch (error) {
      console.error('Error loading board:', error);
      alert('Failed to load board');
    }
  };

  const handleNewBoard = () => {
    if (confirm('Are you sure you want to create a new board? Unsaved changes will be lost.')) {
      useBoardStore.setState({
        resources: new Map(),
        connections: [],
        aiChats: new Map(),
      });
      onBoardNameChange('Untitled Board');
    }
  };

  const handleExportBoard = () => {
    const boardData = {
      name: boardName,
      resources: Array.from(resources.values()),
      connections,
      aiChats: Array.from(aiChats.values()),
      exportDate: new Date().toISOString(),
    };
    
    const blob = new Blob([JSON.stringify(boardData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${boardName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBoard = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const boardData = JSON.parse(e.target?.result as string);
        useBoardStore.setState({
          resources: new Map(boardData.resources.map((r: any) => [r.id, r])),
          connections: boardData.connections,
          aiChats: new Map(boardData.aiChats.map((c: any) => [c.id, c])),
        });
        onBoardNameChange(boardData.name || 'Imported Board');
        alert('Board imported successfully!');
      } catch (error) {
        console.error('Error importing board:', error);
        alert('Failed to import board. Please check the file format.');
      }
    };
    reader.readAsText(file);
  };

  const openLoadDialog = async () => {
    try {
      const boards = await listBoards();
      setSavedBoards(boards);
      setShowLoadDialog(true);
    } catch (error: any) {
      console.error('Error listing boards:', error);
      if (error.response?.status === 401) {
        alert('Please log in to load boards');
      } else {
        alert('Failed to load board list. The board save/load feature requires backend connection.');
      }
    }
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          Board Menu
        </button>

        {showMenu && (
          <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
            <button
              onClick={handleNewBoard}
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
            >
              <Plus className="w-4 h-4 text-gray-600" />
              New Board
            </button>
            
            <button
              onClick={handleSaveBoard}
              disabled={saving}
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3 disabled:opacity-50"
            >
              <Save className="w-4 h-4 text-gray-600" />
              {saving ? 'Saving...' : 'Save Board'}
            </button>
            
            <button
              onClick={openLoadDialog}
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
            >
              <FolderOpen className="w-4 h-4 text-gray-600" />
              Load Board
            </button>
            
            <div className="border-t border-gray-200 my-2" />
            
            <button
              onClick={handleExportBoard}
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
            >
              <Download className="w-4 h-4 text-gray-600" />
              Export Board
            </button>
            
            <label className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3 cursor-pointer">
              <Upload className="w-4 h-4 text-gray-600" />
              Import Board
              <input
                type="file"
                accept=".json"
                onChange={handleImportBoard}
                className="hidden"
              />
            </label>
          </div>
        )}
      </div>

      {/* Load Board Dialog */}
      {showLoadDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">Load Board</h2>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {savedBoards.length === 0 ? (
                <p className="p-4 text-center text-gray-500">No saved boards found</p>
              ) : (
                <div className="divide-y">
                  {savedBoards.map((board) => (
                    <button
                      key={board.id}
                      onClick={() => handleLoadBoard(board.id)}
                      className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium text-gray-900">{board.name}</h3>
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                            <Clock className="w-3 h-3" />
                            {new Date(board.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end">
              <button
                onClick={() => setShowLoadDialog(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};