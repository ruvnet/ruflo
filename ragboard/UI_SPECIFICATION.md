# RAGBOARD UI Specification Document

## Overview
RAGBOARD is a visual content creation platform that combines drag-and-drop content management with AI-powered chat assistance. The application features a canvas-based interface where users can create, connect, and manage various types of content nodes.

## Application Header
- **Logo**: Purple Firefly branding
- **User Profile**: Avatar with dropdown menu
- **Status Tags**: "Hiring", "Affiliate", "APIs"
- **Token Counter**: Displays usage (e.g., "562 / 2.0k")
- **Action Buttons**:
  - "Upgrade" (secondary button)
  - "Share" (primary purple button)
  - "Refer & Earn $70" (accent purple button with icon)

## Main Layout

### Left Sidebar
**Width**: ~60px (collapsed), ~280px (expanded)
**Background**: Light gray (#F5F5F5)
**Tools** (top to bottom):
1. Canvas tool (paintbrush icon)
2. Connection tool (node connector)
3. Add node (+)
4. Edge tool (bezier curve)
5. Voice/Mic tool
6. Image tool
7. Text tool
8. Font tool
9. Globe/Web tool
10. AI/Spark tool
11. Document tool
12. Folder tool

### Right Sidebar - AI Chat Panel
**Width**: ~400px
**Background**: Light purple gradient (#E8E0FF to #F5F0FF)
**Components**:

#### Chat Header
- Purple "AI Chat" label with chat bubble icon
- Toggle between:
  - "+ New Conversation" button (primary purple)
  - Active conversation view
- "Previous Conversations" link (when applicable)

#### Chat Interface
- Message bubbles with proper spacing
- Input area at bottom:
  - Placeholder: "Ask anything or press / for actions"
  - Voice input button (mic icon)
  - Model selector dropdown (Claude 4 Sonnet)
  - Search button
  - Action buttons: "Summarize", "Get Key Insights"
  - "Write Email" link

#### Mindmap Creation Feature
- "Create Mindmap" button with icon
- Integration with canvas nodes

## Canvas Area

### Empty State
- Center message: "Drag and drop files here or click a button to start creating content"
- Four action buttons:
  1. "AI Chat" (purple chat icon)
  2. "Add Text" (T icon)
  3. "Record Voice" (mic icon)
  4. "Upload Documents" (document icon)
- Social media integration prompt:
  - "Use Ctrl/Cmd + V to paste social media content and websites"
  - Platform icons: YouTube, Instagram, TikTok, LinkedIn, Facebook, Globe

### Content Nodes

#### Social Media Content Node
- **Container**: White rounded rectangle with shadow
- **Header**: Platform name and icon (e.g., YouTube)
- **Content Preview**: 
  - Thumbnail image
  - Title/Description text
  - Platform-specific branding
- **Connection Points**: Small circles on edges for linking
- **Hover State**: Blue highlight on connection points

#### URL/Website Node
- **Design**: Blue gradient card
- **Icon**: Globe with decorative dots pattern
- **URL Display**: Input field with arrow button
- **Footer**: "Add notes for AI to use..." placeholder
- **Connection Point**: Purple circle on right edge

#### Text Node
- **Background**: Light blue gradient
- **Label**: "Text" with badge
- **Content**: Editable text area
- **Connection System**: Dotted line connectors

#### File Upload Node
- **Types Supported**: PDFs, documents, images
- **Display**: File icon with filename
- **Status**: Upload progress indicator

### Connection System
- **Visual**: Dotted blue lines between nodes
- **Interaction**: Drag from connection point to another node
- **Behavior**: Curved bezier paths that adjust dynamically

## Modals and Overlays

### Add Social Media Content Modal
**Width**: 500px
**Components**:
- Header: "Add Social Media Content" with close (X) button
- Platform selector icons (horizontal row)
- Description text explaining the feature
- Platform list with checkboxes:
  - YouTube (orange)
  - Instagram (purple)
  - TikTok (black)
  - LinkedIn (blue)
  - Facebook Ads (blue)
- URL input field: "Paste your content link here..."
- Pro tip with Cmd/Ctrl + V shortcut hint
- "Add to Board" button (primary purple)

### File Upload Modal
**Design**: Similar to social media modal
**Features**:
- Drag & drop zone with upload icon
- "Drop files here" text
- Integration options:
  - From device
  - Dropbox
  - Google Drive
- File preview after selection
- Action buttons: "Clear", "Add more", "Done"

### Full Canvas View Modal
- Dark overlay background
- Centered white container
- Node preview at actual size
- Zoom/pan controls
- Close button

## Color Palette
- **Primary Purple**: #7C3AED (buttons, accents)
- **Light Purple**: #E8E0FF (backgrounds)
- **Blue Accent**: #3B82F6 (connections, highlights)
- **Success Green**: #10B981
- **Warning Orange**: #F59E0B
- **Text Primary**: #1F2937
- **Text Secondary**: #6B7280
- **Background**: #FFFFFF
- **Canvas**: #F3F4F6

## Typography
- **Font Family**: System UI stack (-apple-system, BlinkMacSystemFont, "Segoe UI", etc.)
- **Headers**: 16-20px, font-weight: 600
- **Body**: 14px, font-weight: 400
- **Small Text**: 12px, font-weight: 400
- **Buttons**: 14px, font-weight: 500

## Interactive States
- **Hover**: Slight scale (1.02) and shadow increase
- **Active**: Scale down (0.98) with reduced shadow
- **Focus**: Purple outline (2px solid #7C3AED)
- **Disabled**: Opacity 0.5, cursor not-allowed

## Animations
- **Node Creation**: Fade in with slight scale (0.9 to 1)
- **Connection Drawing**: Smooth bezier curve animation
- **Modal Open**: Fade in with scale (0.95 to 1)
- **Hover Effects**: 200ms ease-out transitions

## Responsive Behavior
- Minimum viewport: 1280px width
- Canvas: Infinite scroll in all directions
- Sidebars: Fixed position, collapsible
- Modals: Centered with max-width constraints

## Key Features Summary
1. Drag-and-drop canvas for content organization
2. AI chat integration with context awareness
3. Multi-source content import (social media, files, URLs)
4. Visual connection system between content nodes
5. Real-time collaboration indicators
6. Token usage tracking
7. Export and sharing capabilities