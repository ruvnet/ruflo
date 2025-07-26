# Purple Firefly AI - Component Hierarchy & Visual Patterns

## Component Tree Structure

```
App
├── Header
│   ├── BrandSection
│   │   ├── Logo
│   │   └── AppName
│   ├── StatusBadges
│   │   ├── HiringBadge
│   │   ├── AffiliateBadge
│   │   └── APIsBadge
│   └── UserSection
│       ├── TokenCounter
│       ├── UpgradeButton
│       ├── ShareButton
│       └── ReferEarnButton
│
├── Layout
│   ├── Sidebar
│   │   └── NavigationItems[]
│   │       ├── IconButton
│   │       └── Tooltip
│   │
│   └── MainContent
│       ├── ContentCanvas
│       │   ├── DropZone
│       │   ├── ActionButtons
│       │   │   ├── AIChatButton
│       │   │   ├── AddTextButton
│       │   │   ├── RecordVoiceButton
│       │   │   └── UploadDocumentsButton
│       │   └── QuickPasteSection
│       │
│       └── AIChatPanel
│           ├── ChatHeader
│           │   ├── Title
│           │   ├── NewConversationButton
│           │   └── TabNavigation
│           ├── ChatMessages
│           │   ├── MessageBubble[]
│           │   └── TypingIndicator
│           └── ChatInput
│               ├── TextArea
│               ├── ModelSelector
│               └── ActionButtons
│
└── Modals
    ├── SocialMediaModal
    │   ├── PlatformSelector
    │   ├── URLInput
    │   └── SubmitButton
    ├── FileUploadModal
    │   ├── DropArea
    │   ├── SourceSelector
    │   └── FilePreview
    └── WebsiteScrapingCard
        ├── URLInput
        ├── NotesArea
        └── ProcessingIndicator
```

## Visual Design Patterns

### 1. Spacing System
- **Base Unit**: 4px
- **Component Padding**: 
  - Small: 8px (2 units)
  - Medium: 16px (4 units)
  - Large: 24px (6 units)
- **Section Margins**: 32px (8 units)

### 2. Border Radius
- **Small**: 4px (buttons, inputs)
- **Medium**: 8px (cards, modals)
- **Large**: 12px (major containers)
- **Full**: 50% (circular elements)

### 3. Shadow System
- **Elevation 1**: 0 1px 3px rgba(0,0,0,0.12)
- **Elevation 2**: 0 4px 6px rgba(0,0,0,0.16)
- **Elevation 3**: 0 10px 20px rgba(0,0,0,0.19)

### 4. Animation Patterns
- **Transition Duration**: 200ms (fast), 300ms (normal), 500ms (slow)
- **Easing Function**: cubic-bezier(0.4, 0, 0.2, 1)
- **Hover States**: Scale(1.05) for buttons, opacity changes
- **Loading Animations**: Spinning dots, progress bars

## Component States

### Button States
```css
/* Default */
background: #7B3FF2;
color: white;

/* Hover */
background: #6B2FE2;
transform: translateY(-1px);
box-shadow: 0 4px 8px rgba(123, 63, 242, 0.3);

/* Active */
background: #5B1FD2;
transform: translateY(0);

/* Disabled */
background: #E5E7EB;
color: #9CA3AF;
cursor: not-allowed;
```

### Input States
```css
/* Default */
border: 1px solid #E5E7EB;
background: white;

/* Focus */
border-color: #7B3FF2;
box-shadow: 0 0 0 3px rgba(123, 63, 242, 0.1);

/* Error */
border-color: #EF4444;
box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);

/* Disabled */
background: #F9FAFB;
color: #9CA3AF;
```

## Responsive Breakpoints
- **Mobile**: 375px - 767px
- **Tablet**: 768px - 1023px
- **Desktop**: 1024px - 1439px
- **Large Desktop**: 1440px+

## Icon System
- **Size Variants**: 16px, 20px, 24px, 32px
- **Style**: Outlined (default), Filled (active states)
- **Color**: Inherit from parent, Purple for active

## Content Connection Visual Language
- **Connection Lines**: Dotted, 2px stroke, #9CA3AF color
- **Connection Points**: 8px circles, white fill, purple border
- **Annotation Bubbles**: White background, shadow elevation 2
- **Active Connections**: Purple color, solid line

## Loading States
### Skeleton Screens
- **Background**: Linear gradient animation
- **Colors**: #F3F4F6 to #E5E7EB
- **Animation**: 1.5s shimmer effect

### Progress Indicators
- **Linear Progress**: 4px height, purple fill
- **Circular Progress**: 40px diameter, 3px stroke
- **Percentage Display**: Inside circular progress

## Accessibility Patterns
### Focus Indicators
- **Keyboard Focus**: 2px purple outline, 2px offset
- **High Contrast Mode**: 3px black/white outline
- **Skip Links**: Hidden but available for screen readers

### ARIA Patterns
- **Live Regions**: For chat updates, upload progress
- **Landmarks**: Proper navigation, main, aside usage
- **Labels**: All interactive elements properly labeled

## Performance Optimizations
### Image Loading
- **Lazy Loading**: For below-fold content
- **Progressive Enhancement**: Low-quality placeholders
- **Format**: WebP with fallbacks

### Code Splitting
- **Route-based**: Each major section
- **Component-based**: Heavy components (charts, editors)
- **Vendor splitting**: External libraries

## Component Communication
### Event System
```typescript
// Event types
type AppEvents = 
  | { type: 'FILE_UPLOAD'; payload: File[] }
  | { type: 'CHAT_MESSAGE'; payload: Message }
  | { type: 'CONTENT_CONNECT'; payload: Connection }
  | { type: 'URL_SCRAPE'; payload: ScrapeRequest }
```

### State Management
```typescript
// Global state shape
interface AppState {
  user: UserState;
  chat: ChatState;
  content: ContentState;
  ui: UIState;
}
```

This hierarchy provides a complete blueprint for implementing the Purple Firefly AI interface with consistent visual patterns and interactions.