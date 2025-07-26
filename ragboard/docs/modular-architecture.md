# RAGBoard Modular Architecture

## Overview

RAGBoard follows a modular, component-based architecture designed for scalability, maintainability, and extensibility. Each module is self-contained with clear interfaces and responsibilities.

## Architecture Principles

### 1. **Separation of Concerns**
- Each module handles a specific domain
- Clear boundaries between UI, state, and business logic
- Minimal coupling between modules

### 2. **Component Composition**
- Small, focused components
- Compound component pattern for complex UI
- Render props and hooks for logic sharing

### 3. **Type Safety**
- Full TypeScript coverage
- Strict interface definitions
- Runtime validation at boundaries

### 4. **Performance First**
- Lazy loading and code splitting
- Virtualization for large datasets
- Optimistic UI updates

## Module Structure

```
ragboard/
├── src/
│   ├── modules/
│   │   ├── canvas/           # Board canvas module
│   │   ├── nodes/            # Node components module
│   │   ├── connections/      # Connection system module
│   │   ├── ai-chat/          # AI integration module
│   │   ├── collaboration/    # Real-time features module
│   │   ├── media/            # Media processing module
│   │   ├── auth/             # Authentication module
│   │   └── common/           # Shared components
│   ├── core/                 # Core utilities and types
│   ├── infrastructure/       # Technical infrastructure
│   └── app/                  # Application shell
```

## Core Modules

### 1. Canvas Module

**Purpose**: Manages the infinite scrollable board where nodes are placed and manipulated.

```typescript
// modules/canvas/types.ts
export interface CanvasState {
  viewport: Viewport;
  zoom: number;
  gridSnap: boolean;
  selection: Selection;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

// modules/canvas/components/BoardCanvas.tsx
export const BoardCanvas: React.FC<BoardCanvasProps> = ({
  children,
  onViewportChange,
  onSelectionChange,
}) => {
  // Canvas implementation with React Flow
};

// modules/canvas/hooks/useCanvas.ts
export const useCanvas = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>();
  
  // Canvas manipulation logic
  return { canvasRef, viewport, /* ... */ };
};
```

**Components**:
- `BoardCanvas` - Main canvas container
- `GridBackground` - Visual grid overlay
- `ViewportControls` - Zoom and pan controls
- `MiniMap` - Overview navigation

**Exports**:
```typescript
export * from './components';
export * from './hooks';
export * from './types';
export { canvasReducer } from './state';
```

### 2. Nodes Module

**Purpose**: Defines all node types and their behavior on the canvas.

```typescript
// modules/nodes/types.ts
export interface BaseNode {
  id: string;
  type: NodeType;
  position: Position;
  data: unknown;
  selected?: boolean;
  dragging?: boolean;
}

export interface ResourceNode extends BaseNode {
  type: 'resource';
  data: {
    resourceType: ResourceType;
    title: string;
    content?: string;
    url?: string;
    metadata?: ResourceMetadata;
  };
}

// modules/nodes/components/NodeFactory.tsx
export const NodeFactory: React.FC<NodeFactoryProps> = ({ node }) => {
  switch (node.type) {
    case 'resource':
      return <ResourceNode {...node} />;
    case 'chat':
      return <AIChatNode {...node} />;
    case 'folder':
      return <FolderNode {...node} />;
    default:
      return null;
  }
};
```

**Node Types**:
- `ResourceNode` - Media content (images, videos, documents)
- `AIChatNode` - AI conversation interface
- `FolderNode` - Group container for organization
- `TextNode` - Rich text content
- `URLNode` - Web content integration

**Features**:
- Drag & drop support
- Resize handles
- Connection points
- Context menus
- Inline editing

### 3. Connections Module

**Purpose**: Manages visual and data connections between nodes.

```typescript
// modules/connections/types.ts
export interface Connection {
  id: string;
  source: string;
  target: string;
  type: ConnectionType;
  metadata?: ConnectionMetadata;
}

export enum ConnectionType {
  DataFlow = 'data-flow',
  Reference = 'reference',
  Hierarchy = 'hierarchy',
}

// modules/connections/components/ConnectionRenderer.tsx
export const ConnectionRenderer: React.FC<ConnectionRendererProps> = ({
  connection,
  sourceNode,
  targetNode,
}) => {
  const path = calculateBezierPath(sourceNode, targetNode);
  
  return (
    <g className="connection-group">
      <path d={path} className="connection-line" />
      <ConnectionOverlay connection={connection} />
    </g>
  );
};
```

**Features**:
- Bezier curve rendering
- Interactive creation
- Connection validation
- Visual feedback
- Delete on click

### 4. AI Chat Module

**Purpose**: Integrates LLM capabilities with RAG context from connected nodes.

```typescript
// modules/ai-chat/types.ts
export interface ChatSession {
  id: string;
  nodeId: string;
  messages: Message[];
  context: RAGContext;
  model: AIModel;
}

export interface RAGContext {
  connectedResources: Resource[];
  embeddings: Embedding[];
  systemPrompt: string;
}

// modules/ai-chat/services/ContextBuilder.ts
export class ContextBuilder {
  async buildContext(chatNodeId: string): Promise<RAGContext> {
    const connections = await this.getConnections(chatNodeId);
    const resources = await this.getConnectedResources(connections);
    const embeddings = await this.generateEmbeddings(resources);
    
    return {
      connectedResources: resources,
      embeddings,
      systemPrompt: this.buildSystemPrompt(resources),
    };
  }
}
```

**Components**:
- `AIChatPanel` - Main chat interface
- `MessageList` - Conversation display
- `ChatInput` - Message composition
- `ModelSelector` - AI model selection
- `ContextIndicator` - Shows connected resources

**Services**:
- `LLMService` - Model API integration
- `EmbeddingService` - Vector generation
- `VectorSearchService` - Similarity search
- `ContextBuilder` - RAG context assembly

### 5. Collaboration Module

**Purpose**: Enables real-time multi-user features.

```typescript
// modules/collaboration/types.ts
export interface Presence {
  userId: string;
  cursor?: CursorPosition;
  selection?: string[];
  lastActive: number;
}

// modules/collaboration/services/CollaborationService.ts
export class CollaborationService {
  private socket: Socket;
  private presenceMap = new Map<string, Presence>();
  
  async joinBoard(boardId: string) {
    this.socket.emit('join-board', { boardId });
    this.startHeartbeat();
  }
  
  broadcastCursorMove(position: CursorPosition) {
    this.socket.emit('cursor-move', position);
  }
  
  onRemoteCursorMove(callback: (data: CursorMoveData) => void) {
    this.socket.on('remote-cursor', callback);
  }
}
```

**Features**:
- Live cursor tracking
- Selection indicators
- Conflict resolution
- Presence awareness
- Activity status

### 6. Media Module

**Purpose**: Handles file uploads and media processing.

```typescript
// modules/media/types.ts
export interface MediaProcessor {
  canProcess(file: File): boolean;
  process(file: File): Promise<ProcessedMedia>;
  generatePreview(media: ProcessedMedia): Promise<string>;
}

// modules/media/processors/ImageProcessor.ts
export class ImageProcessor implements MediaProcessor {
  async process(file: File): Promise<ProcessedMedia> {
    const compressed = await this.compress(file);
    const metadata = await this.extractMetadata(file);
    const thumbnail = await this.generateThumbnail(compressed);
    
    return {
      original: file,
      processed: compressed,
      thumbnail,
      metadata,
    };
  }
}
```

**Processors**:
- `ImageProcessor` - Image optimization
- `VideoProcessor` - Video transcoding
- `AudioProcessor` - Audio transcription
- `DocumentProcessor` - Text extraction
- `URLProcessor` - Web scraping

## State Management Architecture

### Store Structure

```typescript
// infrastructure/state/types.ts
export interface RootState {
  board: BoardState;
  ui: UIState;
  auth: AuthState;
  chat: ChatState;
}

// infrastructure/state/stores/boardStore.ts
export const useBoardStore = create<BoardStore>()(
  devtools(
    persist(
      immer((set, get) => ({
        // State
        nodes: new Map<string, AnyNode>(),
        connections: new Map<string, Connection>(),
        
        // Actions
        addNode: (node: AnyNode) => set(state => {
          state.nodes.set(node.id, node);
        }),
        
        // Selectors
        getNodeById: (id: string) => get().nodes.get(id),
        getConnectedNodes: (nodeId: string) => {
          const connections = Array.from(get().connections.values());
          return connections
            .filter(c => c.source === nodeId || c.target === nodeId)
            .map(c => c.source === nodeId ? c.target : c.source)
            .map(id => get().nodes.get(id))
            .filter(Boolean);
        },
      })),
      { name: 'board-store' }
    ),
    { name: 'BoardStore' }
  )
);
```

### Middleware

```typescript
// infrastructure/state/middleware/websocket.ts
export const websocketMiddleware: StateCreator<
  BoardStore,
  [],
  [['websocket', never]]
> = (set, get, api) => {
  const socket = createSocket();
  
  socket.on('remote-update', (update) => {
    set(state => applyRemoteUpdate(state, update));
  });
  
  api.subscribe((state, prevState) => {
    const changes = detectChanges(state, prevState);
    if (changes.length > 0) {
      socket.emit('local-update', changes);
    }
  });
  
  return {};
};
```

## API Integration Layer

### Service Architecture

```typescript
// infrastructure/api/base.ts
export abstract class BaseService {
  protected client: AxiosInstance;
  
  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
    });
    
    this.setupInterceptors();
  }
  
  private setupInterceptors() {
    this.client.interceptors.request.use(this.onRequest);
    this.client.interceptors.response.use(this.onResponse, this.onError);
  }
}

// modules/nodes/services/NodeService.ts
export class NodeService extends BaseService {
  async createNode(boardId: string, node: CreateNodeDto): Promise<Node> {
    const response = await this.client.post(`/boards/${boardId}/nodes`, node);
    return response.data;
  }
  
  async updateNode(nodeId: string, updates: UpdateNodeDto): Promise<Node> {
    const response = await this.client.patch(`/nodes/${nodeId}`, updates);
    return response.data;
  }
}
```

### Query Hooks

```typescript
// modules/nodes/hooks/queries.ts
export const useCreateNode = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateNodeData) => nodeService.createNode(data),
    onSuccess: (node, variables) => {
      queryClient.setQueryData(
        ['board', variables.boardId],
        (old: Board) => ({
          ...old,
          nodes: [...old.nodes, node],
        })
      );
    },
  });
};
```

## Component Patterns

### Compound Components

```typescript
// modules/common/components/Modal/index.tsx
export const Modal = {
  Root: ModalRoot,
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
};

// Usage
<Modal.Root open={isOpen} onClose={handleClose}>
  <Modal.Header>
    <h2>Add Resource</h2>
  </Modal.Header>
  <Modal.Body>
    <ResourceForm onSubmit={handleSubmit} />
  </Modal.Body>
  <Modal.Footer>
    <Button variant="secondary" onClick={handleClose}>
      Cancel
    </Button>
    <Button variant="primary" type="submit" form="resource-form">
      Add Resource
    </Button>
  </Modal.Footer>
</Modal.Root>
```

### Provider Pattern

```typescript
// modules/canvas/providers/CanvasProvider.tsx
export const CanvasProvider: React.FC<CanvasProviderProps> = ({
  children,
  initialViewport,
}) => {
  const [viewport, setViewport] = useState(initialViewport);
  const [zoom, setZoom] = useState(1);
  
  const value = useMemo(
    () => ({
      viewport,
      zoom,
      setViewport,
      setZoom,
      // ... other canvas state and methods
    }),
    [viewport, zoom]
  );
  
  return (
    <CanvasContext.Provider value={value}>
      {children}
    </CanvasContext.Provider>
  );
};
```

### Custom Hooks Pattern

```typescript
// modules/nodes/hooks/useNodeOperations.ts
export const useNodeOperations = (nodeId: string) => {
  const node = useBoardStore(state => state.nodes.get(nodeId));
  const { updateNode, deleteNode } = useBoardStore(state => state.actions);
  
  const handleUpdate = useCallback(
    (updates: Partial<Node>) => {
      updateNode(nodeId, updates);
    },
    [nodeId, updateNode]
  );
  
  const handleDelete = useCallback(() => {
    deleteNode(nodeId);
  }, [nodeId, deleteNode]);
  
  return {
    node,
    update: handleUpdate,
    delete: handleDelete,
  };
};
```

## Testing Strategy

### Unit Testing

```typescript
// modules/nodes/components/__tests__/ResourceNode.test.tsx
describe('ResourceNode', () => {
  it('renders with correct content', () => {
    const node: ResourceNode = {
      id: 'test-1',
      type: 'resource',
      position: { x: 0, y: 0 },
      data: {
        resourceType: 'image',
        title: 'Test Image',
        url: 'https://example.com/image.jpg',
      },
    };
    
    render(<ResourceNode node={node} />);
    
    expect(screen.getByText('Test Image')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', node.data.url);
  });
});
```

### Integration Testing

```typescript
// modules/ai-chat/__tests__/ChatIntegration.test.tsx
describe('AI Chat Integration', () => {
  it('builds context from connected resources', async () => {
    const { result } = renderHook(() => useChatContext('chat-node-1'));
    
    await waitFor(() => {
      expect(result.current.context).toEqual({
        connectedResources: expect.arrayContaining([
          expect.objectContaining({ type: 'document' }),
          expect.objectContaining({ type: 'image' }),
        ]),
        systemPrompt: expect.stringContaining('You have access to'),
      });
    });
  });
});
```

## Performance Optimization

### Lazy Loading

```typescript
// app/routes.tsx
const BoardPage = lazy(() => 
  import('../modules/board/pages/BoardPage')
);

const routes = [
  {
    path: '/board/:id',
    element: (
      <Suspense fallback={<BoardSkeleton />}>
        <BoardPage />
      </Suspense>
    ),
  },
];
```

### Virtualization

```typescript
// modules/nodes/components/NodeList.tsx
export const NodeList: React.FC<NodeListProps> = ({ nodes }) => {
  const rowRenderer = ({ index, style }) => (
    <div style={style}>
      <NodeListItem node={nodes[index]} />
    </div>
  );
  
  return (
    <FixedSizeList
      height={600}
      itemCount={nodes.length}
      itemSize={80}
      width="100%"
    >
      {rowRenderer}
    </FixedSizeList>
  );
};
```

### Memoization

```typescript
// modules/canvas/hooks/useVisibleNodes.ts
export const useVisibleNodes = () => {
  const nodes = useBoardStore(state => state.nodes);
  const viewport = useBoardStore(state => state.viewport);
  
  return useMemo(() => {
    return Array.from(nodes.values()).filter(node => 
      isNodeInViewport(node, viewport)
    );
  }, [nodes, viewport]);
};
```

## Extension Points

### Plugin System

```typescript
// core/plugins/types.ts
export interface Plugin {
  id: string;
  name: string;
  version: string;
  activate(context: PluginContext): void;
  deactivate(): void;
}

// core/plugins/PluginManager.ts
export class PluginManager {
  private plugins = new Map<string, Plugin>();
  
  async loadPlugin(pluginPath: string) {
    const module = await import(pluginPath);
    const plugin: Plugin = module.default;
    
    plugin.activate(this.createContext());
    this.plugins.set(plugin.id, plugin);
  }
}
```

### Custom Node Types

```typescript
// Extension point for custom nodes
export const registerNodeType = (
  type: string,
  component: React.ComponentType<CustomNodeProps>,
  config: NodeTypeConfig
) => {
  nodeRegistry.register(type, { component, config });
};

// Usage in plugin
registerNodeType('code-editor', CodeEditorNode, {
  ports: {
    inputs: ['source'],
    outputs: ['compiled'],
  },
  defaultSize: { width: 400, height: 300 },
});
```

## Deployment Architecture

### Build Configuration

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['@radix-ui/react-*', 'framer-motion'],
          'canvas-vendor': ['reactflow', 'd3'],
          'state-vendor': ['zustand', 'immer'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'reactflow'],
  },
});
```

### Environment Configuration

```typescript
// core/config/environment.ts
export const config = {
  api: {
    baseURL: import.meta.env.VITE_API_URL,
    timeout: 30000,
  },
  websocket: {
    url: import.meta.env.VITE_WS_URL,
    reconnectAttempts: 5,
  },
  features: {
    collaboration: import.meta.env.VITE_FEATURE_COLLABORATION === 'true',
    aiChat: import.meta.env.VITE_FEATURE_AI_CHAT === 'true',
  },
};
```

## Security Considerations

### Input Validation

```typescript
// core/validation/schemas.ts
export const nodeSchema = z.object({
  type: z.enum(['resource', 'chat', 'folder']),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.unknown(),
});

// Usage
export const validateNode = (data: unknown): Node => {
  return nodeSchema.parse(data);
};
```

### XSS Prevention

```typescript
// modules/common/utils/sanitize.ts
import DOMPurify from 'dompurify';

export const sanitizeHTML = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
    ALLOWED_ATTR: ['href', 'target'],
  });
};
```

## Monitoring and Analytics

### Performance Tracking

```typescript
// infrastructure/monitoring/performance.ts
export const trackPerformance = (metric: PerformanceMetric) => {
  // Send to analytics service
  analytics.track('performance', {
    name: metric.name,
    value: metric.value,
    tags: metric.tags,
  });
  
  // Log to console in development
  if (import.meta.env.DEV) {
    console.log(`[Performance] ${metric.name}: ${metric.value}ms`);
  }
};
```

### Error Boundary

```typescript
// app/components/ErrorBoundary.tsx
export class ErrorBoundary extends Component<Props, State> {
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    errorReporter.report(error, {
      componentStack: errorInfo.componentStack,
      props: this.props,
    });
  }
  
  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.handleReset} />;
    }
    
    return this.props.children;
  }
}
```

## Migration Strategy

### Incremental Adoption

1. **Phase 1**: Core modules (Canvas, Nodes, Connections)
2. **Phase 2**: AI Integration and Media Processing
3. **Phase 3**: Collaboration and Real-time features
4. **Phase 4**: Advanced features and optimizations

### Backward Compatibility

```typescript
// modules/legacy/adapters.ts
export const legacyNodeAdapter = (oldNode: LegacyNode): Node => {
  return {
    id: oldNode.nodeId,
    type: mapLegacyType(oldNode.nodeType),
    position: { x: oldNode.x, y: oldNode.y },
    data: mapLegacyData(oldNode),
  };
};
```

## Conclusion

This modular architecture provides:

- **Scalability**: Easy to add new features and node types
- **Maintainability**: Clear module boundaries and responsibilities
- **Performance**: Optimized rendering and state management
- **Extensibility**: Plugin system for custom functionality
- **Type Safety**: Full TypeScript coverage with strict typing
- **Testability**: Isolated modules with clear interfaces

The architecture is designed to grow with the application while maintaining code quality and developer experience.