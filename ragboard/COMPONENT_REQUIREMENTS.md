# RAGBOARD Component Requirements

## Core Components Structure

### 1. App Shell Components

#### AppHeader
```typescript
interface AppHeaderProps {
  user: User;
  tokenUsage: { used: number; total: number };
  onUpgrade: () => void;
  onShare: () => void;
  onReferral: () => void;
}
```
- Fixed position header with logo, user info, and action buttons
- Token usage display with progress indicator
- Responsive button group

#### LeftSidebar
```typescript
interface Tool {
  id: string;
  icon: React.ComponentType;
  name: string;
  shortcut?: string;
}

interface LeftSidebarProps {
  tools: Tool[];
  activeTool: string;
  onToolSelect: (toolId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}
```
- Collapsible sidebar with tool palette
- Active tool highlighting
- Tooltip on hover when collapsed

#### RightSidebar (AI Chat Panel)
```typescript
interface RightSidebarProps {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  onNewConversation: () => void;
  onSendMessage: (message: string) => void;
  onCreateMindmap: () => void;
}
```
- Chat interface with conversation history
- AI model selector
- Quick action buttons

### 2. Canvas Components

#### Canvas
```typescript
interface CanvasProps {
  nodes: CanvasNode[];
  connections: Connection[];
  onNodeCreate: (type: NodeType, position: Point) => void;
  onNodeUpdate: (nodeId: string, updates: Partial<CanvasNode>) => void;
  onNodeDelete: (nodeId: string) => void;
  onConnectionCreate: (from: string, to: string) => void;
  onConnectionDelete: (connectionId: string) => void;
}
```
- Infinite scrollable canvas
- Pan and zoom capabilities
- Grid snapping (optional)
- Multi-selection support

#### CanvasNode
```typescript
type NodeType = 'text' | 'url' | 'social-media' | 'file' | 'image' | 'audio';

interface CanvasNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  size: { width: number; height: number };
  content: NodeContent;
  connections: string[];
  metadata: NodeMetadata;
}
```
- Draggable and resizable
- Connection points on edges
- Content-specific rendering

### 3. Node Components

#### TextNode
- Inline editing capability
- Rich text formatting
- Auto-resize based on content

#### URLNode
- URL validation and preview
- Favicon display
- Loading states
- Notes field for AI context

#### SocialMediaNode
- Platform-specific styling
- Thumbnail preview
- Metadata extraction
- Share/embed options

#### FileNode
- File type icon
- Upload progress
- Preview capability for images/PDFs
- Download option

### 4. Modal Components

#### AddContentModal
```typescript
interface AddContentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContentAdd: (content: ContentData) => void;
  contentType: 'social-media' | 'file' | 'url';
}
```
- Step-by-step content addition
- Platform selection for social media
- Drag-drop file upload
- URL validation

#### FileUploadModal
- Multi-file selection
- Cloud storage integration
- Progress tracking
- File preview grid

### 5. Connection System

#### ConnectionLine
```typescript
interface ConnectionLineProps {
  from: Point;
  to: Point;
  isActive: boolean;
  onDelete?: () => void;
}
```
- Bezier curve rendering
- Animated creation
- Hover states
- Delete on click

#### ConnectionPoint
```typescript
interface ConnectionPointProps {
  nodeId: string;
  position: 'top' | 'right' | 'bottom' | 'left';
  onConnectionStart: () => void;
  onConnectionEnd: () => void;
}
```
- Visible on node hover
- Drag interaction
- Visual feedback during connection

### 6. AI Integration Components

#### ChatMessage
```typescript
interface ChatMessageProps {
  message: Message;
  isAI: boolean;
  timestamp: Date;
  actions?: MessageAction[];
}
```
- Message bubbles with proper alignment
- Markdown rendering support
- Code syntax highlighting
- Action buttons

#### ChatInput
```typescript
interface ChatInputProps {
  onSend: (message: string) => void;
  onVoiceInput: () => void;
  suggestions: string[];
  placeholder: string;
}
```
- Multi-line text input
- Voice recording button
- Slash commands
- Suggestion dropdown

### 7. Utility Components

#### EmptyState
- Centered messaging
- Action buttons grid
- Keyboard shortcut hints
- Animated illustrations

#### LoadingSpinner
- Contextual sizing
- Inline and overlay variants
- Progress indication

#### Tooltip
- Smart positioning
- Keyboard shortcut display
- Delay on show/hide

## State Management Requirements

### Global State
```typescript
interface AppState {
  user: User;
  canvas: {
    nodes: CanvasNode[];
    connections: Connection[];
    selectedNodes: string[];
    activeTool: string;
  };
  chat: {
    conversations: Conversation[];
    activeConversationId: string | null;
    messages: Message[];
  };
  ui: {
    leftSidebarCollapsed: boolean;
    rightSidebarVisible: boolean;
    activeModal: string | null;
  };
}
```

### Actions
- Canvas: ADD_NODE, UPDATE_NODE, DELETE_NODE, CONNECT_NODES
- Chat: SEND_MESSAGE, RECEIVE_MESSAGE, NEW_CONVERSATION
- UI: TOGGLE_SIDEBAR, OPEN_MODAL, CLOSE_MODAL

## Performance Requirements

1. **Canvas Rendering**
   - Use canvas or WebGL for large node counts
   - Viewport culling for off-screen nodes
   - Debounced position updates

2. **File Handling**
   - Chunked uploads for large files
   - Client-side image optimization
   - Lazy loading for previews

3. **Real-time Updates**
   - WebSocket for chat messages
   - Optimistic UI updates
   - Conflict resolution for collaborative editing

## Accessibility Requirements

1. **Keyboard Navigation**
   - Tab through all interactive elements
   - Arrow keys for canvas navigation
   - Escape to close modals

2. **Screen Reader Support**
   - ARIA labels for all controls
   - Live regions for chat updates
   - Descriptive alt text for images

3. **Visual Accessibility**
   - High contrast mode support
   - Focus indicators
   - Minimum touch target sizes (44x44px)

## Browser Support
- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile: iOS Safari 14+, Chrome Android