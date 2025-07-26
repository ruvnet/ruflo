import React, { useCallback, useState } from 'react';
import {
  ReactFlow,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState
} from '@xyflow/react';
import { useBoardStore } from '../store/boardStore';
import { ResourceNode } from './ResourceNode';
import { AIChatNode } from './AIChatNode';
import { FolderNode } from './FolderNode';
import { TextNode } from './TextNode';
import { ConnectionLine } from './ConnectionLine';
import { SidebarMenu } from './SidebarMenu';
import { AddResourceModal } from './AddResourceModal';
import { EmptyState } from './EmptyState';
import { AIChatFloating } from './AIChatFloating';
import { AIChatFullScreen } from './AIChatFullScreen';
import { BoardHeader } from './BoardHeader';
import wsService from '../services/websocket';
import { Header } from './Header';
import { Resource, Folder, Connection, Node, Edge, FlowConnection, NodeTypes, EdgeTypes } from '../types';

// Define custom node types
const nodeTypes: NodeTypes = {
  resourceNode: ResourceNode,
  aiChatNode: AIChatNode,
  folderNode: FolderNode,
  textNode: TextNode,
};

// Define custom edge types
const edgeTypes: EdgeTypes = {
  default: ConnectionLine,
};

export const BoardCanvas: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<string>('');
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<'closed' | 'floating' | 'fullscreen'>('closed');
  const [boardId] = useState(() => new URLSearchParams(window.location.search).get('board_id') || 'default');
  const [boardName, setBoardName] = useState('Untitled Board');

  // Initialize WebSocket connection
  React.useEffect(() => {
    wsService.connect(boardId);
    
    // Set up WebSocket event listeners
    wsService.onResourceCreated((data) => {
      console.log('Resource created:', data);
      // Refresh resources or add new resource to state
    });
    
    wsService.onResourceProcessed((data) => {
      console.log('Resource processed:', data);
      // Update resource with processed data
    });
    
    return () => {
      wsService.disconnect();
    };
  }, [boardId]);

  const {
    resources,
    aiChats,
    addResource,
    updateResource,
    deleteResource,
    createAIChat,
    toggleFolder,
    addConnection,
    connectResourceToChat,
  } = useBoardStore();

  // Convert store data to ReactFlow nodes
  React.useEffect(() => {
    const resourceNodes: Node[] = Array.from(resources.values()).map((resource) => ({
      id: resource.id,
      type: resource.type === 'folder' ? 'folderNode' : 
            resource.type === 'text' ? 'textNode' : 'resourceNode',
      position: resource.position,
      data: {
        ...resource,
        onDelete: deleteResource,
        onToggle: resource.type === 'folder' ? toggleFolder : undefined,
      },
    }));

    const chatNodes: Node[] = Array.from(aiChats.values()).map((chat) => ({
      id: chat.id,
      type: 'aiChatNode',
      position: chat.position,
      data: {
        ...chat,
        onClick: (id: string) => {
          setSelectedChatId(id);
          setChatMode('floating');
        },
      },
    }));

    setNodes([...resourceNodes, ...chatNodes]);
  }, [resources, aiChats, deleteResource, toggleFolder, setNodes]);

  // Handle connections
  const onConnect = useCallback(
    (params: FlowConnection) => {
      if (!params.source || !params.target) return;

      // Check if connecting to AI chat
      const targetChat = aiChats.get(params.target);
      if (targetChat) {
        connectResourceToChat(params.target, params.source);
      }

      // Add visual connection
      setEdges((eds) => addEdge({ ...params, type: 'default' }, eds));
      addConnection({
        source: params.source,
        target: params.target,
        sourceHandle: params.sourceHandle || undefined,
        targetHandle: params.targetHandle || undefined,
      });
    },
    [aiChats, connectResourceToChat, addConnection, setEdges]
  );

  // Handle node drag
  const onNodeDragStop = useCallback(
    (event: React.MouseEvent, node: Node) => {
      updateResource(node.id, { position: node.position });
    },
    [updateResource]
  );

  // Handle adding resources
  const handleAddResource = useCallback((type: string) => {
    if (type === 'chat') {
      // Create AI chat node
      const chatId = createAIChat({ x: 300, y: 300 });
      setSelectedChatId(chatId);
      setChatMode('floating');
    } else if (type === 'folder') {
      // Create folder
      const folder: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'> & { type: 'folder'; isExpanded: boolean; children: string[] } = {
        type: 'folder',
        title: 'New Folder',
        position: { x: 200, y: 200 },
        isExpanded: true,
        children: [],
      };
      addResource(folder);
    } else if (type === 'text') {
      // Create text box directly on board
      const textBox: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'> = {
        type: 'text',
        title: 'New Text',
        position: { x: Math.random() * 500 + 100, y: Math.random() * 300 + 100 },
        metadata: {
          content: 'Double-click to edit this text...',
        },
      };
      addResource(textBox);
    } else {
      // Open modal for other types
      setModalType(type);
      setModalOpen(true);
    }
  }, [createAIChat, addResource, setSelectedChatId, setChatMode]);

  // Handle modal add
  const handleModalAdd = useCallback((data: any) => {
    const resource: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'> = {
      ...data,
      position: { x: Math.random() * 500 + 100, y: Math.random() * 300 + 100 },
    };
    addResource(resource);
  }, [addResource]);

  // Handle drop
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = {
        x: event.clientX,
        y: event.clientY,
      };

      const newResource: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'> = {
        type: type as any,
        title: `New ${type}`,
        position,
      };

      addResource(newResource);
    },
    [addResource]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="w-full h-screen bg-gray-50 relative">
      {/* Board Header */}
      <BoardHeader
        boardName={boardName}
        onBoardNameChange={setBoardName}
      />
      
      <div className="pt-14 h-full">
        <SidebarMenu onAddResource={handleAddResource} />
        
        <div className="ml-16 h-full">
          <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
        >
          <Background variant="dots" gap={20} size={1} />
          <Controls />
          </ReactFlow>
        </div>
      </div>

      <AddResourceModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={handleModalAdd}
        type={modalType}
      />
      
      {/* Chat Components */}
      {selectedChatId && chatMode === 'floating' && (
        <AIChatFloating
          chatId={selectedChatId}
          onClose={() => {
            setChatMode('closed');
            setSelectedChatId(null);
          }}
          onFullScreen={() => setChatMode('fullscreen')}
        />
      )}
      
      {selectedChatId && chatMode === 'fullscreen' && (
        <AIChatFullScreen
          chatId={selectedChatId}
          onClose={() => {
            setChatMode('closed');
            setSelectedChatId(null);
          }}
        />
      )}
    </div>
  );
};