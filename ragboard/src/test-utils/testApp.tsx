import React from 'react';
import { useBoardStore } from '../store/boardStore';

export const TestApp: React.FC = () => {
  const {
    nodes,
    edges,
    addNode,
    openAddResourceModal,
    closeAddResourceModal,
    isAddResourceModalOpen,
    addResourceType,
  } = useBoardStore();

  const testAddNode = () => {
    const newNode = {
      id: `test-${Date.now()}`,
      type: 'resource',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: {
        title: 'Test Resource',
        type: 'text' as const,
        metadata: {
          createdAt: new Date(),
        },
      },
    };
    addNode(newNode);
  };

  const testAddChatNode = () => {
    const newNode = {
      id: `chat-${Date.now()}`,
      type: 'aiChat',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: {
        model: 'claude-3-sonnet',
        conversation: [],
      },
    };
    addNode(newNode);
  };

  const testAddFolderNode = () => {
    const newNode = {
      id: `folder-${Date.now()}`,
      type: 'folder',
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: {
        title: 'Test Folder',
        children: [],
      },
    };
    addNode(newNode);
  };

  return (
    <div className="fixed bottom-4 right-4 bg-white p-4 rounded-lg shadow-lg z-50 space-y-2">
      <h3 className="font-bold text-sm mb-2">Debug Panel</h3>
      <div className="text-xs space-y-1">
        <p>Nodes: {nodes.length}</p>
        <p>Edges: {edges.length}</p>
        <p>Modal Open: {isAddResourceModalOpen ? 'Yes' : 'No'}</p>
        <p>Resource Type: {addResourceType || 'None'}</p>
      </div>
      <div className="space-y-2 pt-2 border-t">
        <button
          onClick={testAddNode}
          className="w-full px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700"
        >
          Add Test Resource
        </button>
        <button
          onClick={testAddChatNode}
          className="w-full px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
        >
          Add Test Chat
        </button>
        <button
          onClick={testAddFolderNode}
          className="w-full px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
        >
          Add Test Folder
        </button>
        <button
          onClick={() => openAddResourceModal('text')}
          className="w-full px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700"
        >
          Open Modal
        </button>
        {isAddResourceModalOpen && (
          <button
            onClick={closeAddResourceModal}
            className="w-full px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
          >
            Close Modal
          </button>
        )}
      </div>
    </div>
  );
};