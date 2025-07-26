# RAGBOARD UI Patterns & Implementation Guide

## Key UI Patterns Observed

### 1. Canvas Interaction Pattern
The application uses a **node-based canvas system** similar to tools like Figma or Miro:

- **Infinite Canvas**: Users can pan and scroll in any direction
- **Direct Manipulation**: Drag-and-drop for node creation and positioning
- **Connection System**: Visual links between related content nodes
- **Multi-Select**: Hold Shift/Cmd for selecting multiple nodes

### 2. Content Creation Flow

#### Empty State → Content Addition
1. **Initial State**: Canvas shows helpful prompt with action buttons
2. **Content Sources**:
   - AI Chat (primary purple CTA)
   - Text Input
   - Voice Recording
   - Document Upload
   - URL/Social Media paste (Ctrl/Cmd+V)

#### Progressive Disclosure
- Start simple with basic actions
- Reveal advanced features as users engage
- Context-sensitive tool palette in sidebar

### 3. Node Connection Behavior

#### Visual Feedback
```css
/* Connection point styles */
.connection-point {
  opacity: 0;
  transition: opacity 200ms ease-out;
}

.node:hover .connection-point {
  opacity: 1;
}

.connection-point:hover {
  transform: scale(1.2);
  background-color: #3B82F6;
}
```

#### Connection Drawing
1. **Start**: Click and hold on connection point
2. **Drag**: Dotted line follows cursor
3. **Valid Target**: Highlight compatible nodes
4. **Complete**: Release on target connection point
5. **Cancel**: Release in empty space or press Escape

### 4. AI Chat Integration

#### Contextual Awareness
- Chat understands selected nodes
- Suggests actions based on canvas content
- Can create new nodes from chat responses

#### Quick Actions
- "Create Mindmap" - generates connected nodes
- "Summarize" - analyzes selected content
- "Get Key Insights" - extracts important points

### 5. Modal Patterns

#### Consistent Modal Structure
```typescript
interface ModalLayout {
  header: {
    title: string;
    closeButton: boolean;
  };
  body: {
    maxWidth: '500px';
    padding: '24px';
  };
  footer?: {
    primaryAction: string;
    secondaryAction?: string;
  };
}
```

#### Modal Behaviors
- Fade in with slight scale animation
- Click outside to close (with confirmation for forms)
- Escape key handling
- Focus trap for accessibility

### 6. File Upload Experience

#### Multi-Step Process
1. **Choose Source**: Device, Dropbox, Google Drive
2. **Select Files**: Multi-select with preview
3. **Process**: Show upload progress
4. **Complete**: Create node with file content

#### Drag-and-Drop Zone
```javascript
const dropZoneStates = {
  idle: 'Drop files here',
  hover: 'Release to upload',
  uploading: 'Uploading... {progress}%',
  complete: 'Upload complete'
};
```

### 7. Responsive Layout Strategy

#### Sidebar Behavior
- **Desktop**: Both sidebars visible
- **Tablet**: Right sidebar overlays canvas
- **Mobile**: Bottom sheet pattern for chat

#### Canvas Adaptation
- Touch gestures for mobile (pinch zoom, two-finger pan)
- Larger touch targets on mobile
- Simplified toolbar for small screens

### 8. Visual Hierarchy

#### Z-Index Layers
```css
:root {
  --z-canvas: 0;
  --z-nodes: 10;
  --z-connections: 5;
  --z-sidebars: 20;
  --z-modals: 30;
  --z-tooltips: 40;
  --z-notifications: 50;
}
```

#### Focus Management
- Clear visual focus indicators
- Logical tab order
- Skip links for accessibility

### 9. Performance Optimizations

#### Canvas Rendering
```javascript
// Use requestAnimationFrame for smooth updates
const updateCanvas = () => {
  if (isDirty) {
    renderNodes();
    renderConnections();
    isDirty = false;
  }
  requestAnimationFrame(updateCanvas);
};
```

#### Virtual Scrolling
- Only render visible nodes
- Lazy load node content
- Debounce position updates

### 10. State Persistence

#### Auto-Save Pattern
- Save canvas state every 5 seconds
- Save on significant actions
- Show save indicator
- Conflict resolution for collaboration

#### Undo/Redo Stack
```typescript
interface CanvasAction {
  type: 'ADD' | 'DELETE' | 'MOVE' | 'CONNECT';
  timestamp: number;
  data: any;
  inverse: () => CanvasAction;
}
```

## Implementation Priorities

### Phase 1: Core Canvas
1. Basic canvas with pan/zoom
2. Text and URL nodes
3. Simple connections
4. Basic toolbar

### Phase 2: AI Integration
1. Chat sidebar
2. AI responses
3. Node creation from chat
4. Context awareness

### Phase 3: Rich Content
1. Social media nodes
2. File upload system
3. Image/video support
4. Audio recording

### Phase 4: Polish
1. Animations and transitions
2. Keyboard shortcuts
3. Mobile optimization
4. Collaboration features

## Technical Recommendations

### Libraries to Consider
- **Canvas**: Konva.js or Fabric.js for 2D rendering
- **State**: Zustand or Valtio for simple state management
- **Animations**: Framer Motion for declarative animations
- **File Upload**: Uppy for robust file handling
- **Rich Text**: Tiptap or Slate for text editing

### Performance Guidelines
- Use CSS containment for node rendering
- Implement intersection observer for viewport culling
- Batch DOM updates with requestAnimationFrame
- Use Web Workers for heavy computations

### Accessibility Checklist
- [ ] All interactive elements keyboard accessible
- [ ] ARIA labels for canvas elements
- [ ] Screen reader announcements for actions
- [ ] High contrast mode support
- [ ] Reduced motion preferences respected