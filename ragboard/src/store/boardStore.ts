import { create } from 'zustand';
import { Resource, Folder, Connection, AIChat, Message, BoardState } from '../types';

interface BoardStore extends BoardState {
  // Resource actions
  addResource: (resource: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateResource: (id: string, updates: Partial<Resource>) => void;
  deleteResource: (id: string) => void;
  moveResource: (id: string, position: { x: number; y: number }) => void;
  
  // Folder actions
  toggleFolder: (id: string) => void;
  addToFolder: (folderId: string, resourceId: string) => void;
  removeFromFolder: (folderId: string, resourceId: string) => void;
  
  // Connection actions
  addConnection: (connection: Omit<Connection, 'id'>) => void;
  removeConnection: (id: string) => void;
  
  // AI Chat actions
  createAIChat: (position: { x: number; y: number }) => string;
  addMessage: (chatId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  connectResourceToChat: (chatId: string, resourceId: string) => void;
  disconnectResourceFromChat: (chatId: string, resourceId: string) => void;
  
  // Selection actions
  selectResource: (id: string) => void;
  deselectResource: (id: string) => void;
  clearSelection: () => void;
  
  // Drag actions
  setDraggedResource: (id: string | null) => void;
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  resources: new Map(),
  connections: [],
  aiChats: new Map(),
  selectedResources: new Set(),
  draggedResource: null,
  
  addResource: (resource) => {
    const id = `resource-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newResource: Resource = {
      ...resource,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    set((state) => {
      const resources = new Map(state.resources);
      resources.set(id, newResource);
      return { resources };
    });
    
    return id;
  },
  
  updateResource: (id, updates) => {
    set((state) => {
      const resources = new Map(state.resources);
      const resource = resources.get(id);
      if (resource) {
        resources.set(id, {
          ...resource,
          ...updates,
          updatedAt: new Date(),
        });
      }
      return { resources };
    });
  },
  
  deleteResource: (id) => {
    set((state) => {
      const resources = new Map(state.resources);
      const resource = resources.get(id);
      
      // If it's a folder, remove all children from the folder
      if (resource && resource.type === 'folder') {
        const folder = resource as Folder;
        folder.children.forEach(childId => {
          const child = resources.get(childId);
          if (child) {
            resources.set(childId, { ...child, parentId: undefined });
          }
        });
      }
      
      resources.delete(id);
      
      // Remove connections involving this resource
      const connections = state.connections.filter(
        conn => conn.source !== id && conn.target !== id
      );
      
      // Remove from selected resources
      const selectedResources = new Set(state.selectedResources);
      selectedResources.delete(id);
      
      return { resources, connections, selectedResources };
    });
  },
  
  moveResource: (id, position) => {
    set((state) => {
      const resources = new Map(state.resources);
      const resource = resources.get(id);
      if (resource) {
        resources.set(id, {
          ...resource,
          position,
          updatedAt: new Date(),
        });
      }
      return { resources };
    });
  },
  
  toggleFolder: (id) => {
    set((state) => {
      const resources = new Map(state.resources);
      const folder = resources.get(id) as Folder;
      if (folder && folder.type === 'folder') {
        resources.set(id, {
          ...folder,
          isExpanded: !folder.isExpanded,
          updatedAt: new Date(),
        });
      }
      return { resources };
    });
  },
  
  addToFolder: (folderId, resourceId) => {
    set((state) => {
      const resources = new Map(state.resources);
      const folder = resources.get(folderId) as Folder;
      const resource = resources.get(resourceId);
      
      if (folder && folder.type === 'folder' && resource) {
        // Update folder
        resources.set(folderId, {
          ...folder,
          children: [...folder.children, resourceId],
          updatedAt: new Date(),
        });
        
        // Update resource parent
        resources.set(resourceId, {
          ...resource,
          parentId: folderId,
          updatedAt: new Date(),
        });
      }
      
      return { resources };
    });
  },
  
  removeFromFolder: (folderId, resourceId) => {
    set((state) => {
      const resources = new Map(state.resources);
      const folder = resources.get(folderId) as Folder;
      const resource = resources.get(resourceId);
      
      if (folder && folder.type === 'folder' && resource) {
        // Update folder
        resources.set(folderId, {
          ...folder,
          children: folder.children.filter(id => id !== resourceId),
          updatedAt: new Date(),
        });
        
        // Update resource parent
        resources.set(resourceId, {
          ...resource,
          parentId: undefined,
          updatedAt: new Date(),
        });
      }
      
      return { resources };
    });
  },
  
  addConnection: (connection) => {
    const id = `connection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    set((state) => ({
      connections: [...state.connections, { ...connection, id }],
    }));
  },
  
  removeConnection: (id) => {
    set((state) => ({
      connections: state.connections.filter(conn => conn.id !== id),
    }));
  },
  
  createAIChat: (position) => {
    const id = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newChat: AIChat = {
      id,
      position,
      messages: [],
      connectedResources: [],
      isActive: true,
    };
    
    set((state) => {
      const aiChats = new Map(state.aiChats);
      aiChats.set(id, newChat);
      return { aiChats };
    });
    
    return id;
  },
  
  addMessage: (chatId, message) => {
    const id = `message-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newMessage: Message = {
      ...message,
      id,
      timestamp: new Date(),
    };
    
    set((state) => {
      const aiChats = new Map(state.aiChats);
      const chat = aiChats.get(chatId);
      if (chat) {
        aiChats.set(chatId, {
          ...chat,
          messages: [...chat.messages, newMessage],
        });
      }
      return { aiChats };
    });
  },
  
  connectResourceToChat: (chatId, resourceId) => {
    set((state) => {
      const aiChats = new Map(state.aiChats);
      const chat = aiChats.get(chatId);
      if (chat && !chat.connectedResources.includes(resourceId)) {
        aiChats.set(chatId, {
          ...chat,
          connectedResources: [...chat.connectedResources, resourceId],
        });
      }
      return { aiChats };
    });
  },
  
  disconnectResourceFromChat: (chatId, resourceId) => {
    set((state) => {
      const aiChats = new Map(state.aiChats);
      const chat = aiChats.get(chatId);
      if (chat) {
        aiChats.set(chatId, {
          ...chat,
          connectedResources: chat.connectedResources.filter(id => id !== resourceId),
        });
      }
      return { aiChats };
    });
  },
  
  selectResource: (id) => {
    set((state) => {
      const selectedResources = new Set(state.selectedResources);
      selectedResources.add(id);
      return { selectedResources };
    });
  },
  
  deselectResource: (id) => {
    set((state) => {
      const selectedResources = new Set(state.selectedResources);
      selectedResources.delete(id);
      return { selectedResources };
    });
  },
  
  clearSelection: () => {
    set({ selectedResources: new Set() });
  },
  
  setDraggedResource: (id) => {
    set({ draggedResource: id });
  },
}));