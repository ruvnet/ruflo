# Purple Firefly AI - UI Requirements Specification

## Executive Summary
Purple Firefly AI is a content creation and management platform that leverages AI capabilities to help users create, analyze, and repurpose content from various sources. The application features a modern, clean interface with a focus on drag-and-drop interactions and AI-powered content generation.

## Application Architecture

### 1. Main Layout Structure

#### 1.1 Header Bar
- **Brand Identity**: Purple Firefly logo with app name
- **Status Indicators**: 
  - Hiring badge (yellow)
  - Affiliate badge (orange)
  - APIs section
- **User Account Section**:
  - Token counter (562 / 2.0k display)
  - Upgrade button (secondary style)
  - Share button (primary purple)
  - Refer & Earn button ($70 incentive, purple gradient)
- **Utility Icons**: Document, History, Notifications

#### 1.2 Sidebar Navigation
- **Width**: Fixed ~60px collapsed
- **Background**: Light gray (#F5F5F5)
- **Navigation Items** (top to bottom):
  - Magic wand (AI features)
  - Link/Chain (connections)
  - Video camera
  - Plus icon (add content)
  - Music note
  - Microphone
  - Image gallery
  - Text editor
  - Font/Typography
  - Color palette
  - Globe (web scraping)
  - Graph/Analytics
  - Document
  - Folder

### 2. Core Features & Components

#### 2.1 AI Chat Interface
- **Layout**: Right-side panel (60% width)
- **Header**: 
  - Purple gradient background
  - "AI Chat" title with icon
  - "+ New Conversation" button (primary)
  - "New Conversation" tab
  - "Previous Conversations" link
- **Chat Area**:
  - Message bubbles with avatars
  - Claude 4 Sonnet model selector dropdown
  - Search functionality
  - Action buttons: Summarize, Get Key Insights
  - Write Email option
  - Create Mindmap feature
- **Input Area**:
  - Large text input with placeholder
  - Send button with animated state
  - Voice input option

#### 2.2 Content Creation Hub
- **Main Canvas**: 
  - Drag-and-drop zone
  - "Drag and drop files here or click a button to start creating content"
  - Action buttons:
    - AI Chat (purple icon)
    - Add Text
    - Record Voice
    - Upload Documents
- **Social Media Integration**:
  - Quick paste from Ctrl/Cmd + V
  - Platform icons: YouTube, Instagram, TikTok, LinkedIn, Facebook, Discord

#### 2.3 Social Media Content Modal
- **Modal Design**:
  - White background with rounded corners
  - Close button (X) in top-right
  - Platform icons at top
- **Content Sources**:
  - YouTube (orange indicator)
  - Instagram (orange indicator)
  - TikTok (orange indicator)
  - LinkedIn (orange indicator)
  - Facebook Ads (orange indicator)
- **Input Field**:
  - "Your Content Link" label
  - Large text input with placeholder
  - Helper text with keyboard shortcut tip
- **Action Button**: "Add to Board" (purple, full-width)

#### 2.4 File Upload Interface
- **Upload Modal**:
  - Powered by Uploadcare
  - Drag-and-drop area
  - File source options:
    - From device
    - Dropbox
    - Google Drive
  - File preview with delete option
  - Progress indicators
  - "Add more" and "Done" buttons

#### 2.5 Website Scraping Feature
- **Input Card**:
  - Globe icon with "Website" header
  - URL input field (e.g., "hu-ha.com")
  - Arrow button for submission
  - Loading states (spinning dots animation)
- **AI Notes Section**:
  - "Add notes for AI to use..." text area
  - Info icon for help/tooltips

### 3. Visual Design System

#### 3.1 Color Palette
- **Primary**: Purple (#7B3FF2)
- **Secondary**: Light purple (#E8DEFF)
- **Accent**: Orange (#FF6B35)
- **Background**: Light gray (#F8F9FA)
- **Text Primary**: Dark gray (#1A1A1A)
- **Text Secondary**: Medium gray (#6B7280)

#### 3.2 Typography
- **Primary Font**: Inter or similar sans-serif
- **Headings**: Bold, various sizes
- **Body Text**: Regular weight, 14-16px
- **Small Text**: 12-14px for helpers and labels

#### 3.3 Component Styling
- **Buttons**:
  - Primary: Purple background, white text, rounded corners
  - Secondary: White background, purple border, purple text
  - Icon buttons: Circular with hover states
- **Cards**: White background, subtle shadow, rounded corners
- **Inputs**: Light border, rounded corners, focus states
- **Modals**: Overlay backdrop, centered content, smooth animations

### 4. Interaction Patterns

#### 4.1 Drag and Drop
- Visual feedback during drag
- Drop zone highlighting
- File type validation
- Progress indicators

#### 4.2 Content Connections
- Dotted line connectors between content pieces
- Annotation bubbles for context
- Visual linking system for related content

#### 4.3 Loading States
- Spinning animations for processing
- Progress bars for uploads
- Skeleton screens for content loading

### 5. Responsive Considerations
- Desktop-first design (optimized for 1440px+)
- Collapsible sidebar for more canvas space
- Modal adaptations for smaller screens
- Touch-friendly interaction zones

### 6. Accessibility Requirements
- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatibility
- High contrast mode support
- Focus indicators on all interactive elements

### 7. Performance Requirements
- Page load time < 3 seconds
- Smooth animations (60fps)
- Optimized image loading
- Efficient API calls with caching
- Progressive enhancement approach

## Component Specifications

### Header Component
```typescript
interface HeaderProps {
  user: {
    tokens: { current: number; total: number };
    avatar?: string;
  };
  onUpgrade: () => void;
  onShare: () => void;
  onReferEarn: () => void;
}
```

### Sidebar Component
```typescript
interface SidebarProps {
  activeItem?: string;
  collapsed?: boolean;
  onItemClick: (itemId: string) => void;
}
```

### AI Chat Component
```typescript
interface AIChatProps {
  conversations: Conversation[];
  activeConversation?: string;
  onNewConversation: () => void;
  onSendMessage: (message: string) => void;
  model: AIModel;
}
```

### Content Upload Component
```typescript
interface ContentUploadProps {
  onFileDrop: (files: File[]) => void;
  onSocialMediaAdd: (platform: string, url: string) => void;
  onWebsiteAdd: (url: string, notes?: string) => void;
}
```

## Implementation Priority
1. Core layout and navigation
2. AI Chat interface
3. Content upload functionality
4. Social media integration
5. Website scraping feature
6. Advanced content manipulation
7. Analytics and insights
8. Collaboration features