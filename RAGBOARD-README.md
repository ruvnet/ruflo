You're building the first version of a web app called **RAGBoard**. It's a mind-mapping-style board that allows users to drag and drop multimedia content onto a visual canvas and connect that content to an AI chat module (Claude, GPT-4, etc.). The goal is to create a Retrieval-Augmented Generation (RAG) interface where users can inform the AI by visually linking resources.

Start by building the **core front-end components using React and TailwindCSS**, organized into a modular folder structure. Here's what to scaffold first:

---

### 🧱 Key Components (to scaffold now):

1. **BoardCanvas** (`/components/BoardCanvas.tsx`)
   - Full-screen, pannable, zoomable canvas.
   - Supports drag-and-drop layout of nodes.
   - Uses D3.js or React Flow for rendering nodes and connectors.

2. **ResourceNode** (`/components/ResourceNode.tsx`)
   - Reusable card UI for content types: video, image, text, PDF, URL, audio.
   - Should include an icon, name/title, and optional preview.
   - Accept `type`, `title`, `metadata`, and `position` as props.
   - Make nodes draggable and resizable.

3. **AIChatNode** (`/components/AIChatNode.tsx`)
   - Visual chat module.
   - Has a dotted-line connector system to show which nodes it's linked to.
   - Can be clicked to open a side panel chat interface.

4. **ConnectionLine** (`/components/ConnectionLine.tsx`)
   - Dotted lines between resource nodes and the chat.
   - Use absolute positioning or a canvas overlay to draw connections.

5. **SidebarMenu** (`/components/SidebarMenu.tsx`)
   - Icon-based menu (left side) to add new resources.
   - Buttons: Add Social URL, Upload File, Record Audio, Paste Text, Add Website URL, Add Folder.

6. **Modal: AddResourceModal** (`/components/AddResourceModal.tsx`)
   - Opens based on input type.
   - Accepts social URL, uploads, or raw text.
   - Should simulate async "processing" of input (e.g. loading spinner).

7. **FolderNode** (`/components/FolderNode.tsx`)
   - Container node that can group other nodes.
   - Toggle to expand/collapse contents.
   - Can be connected to AI chat like a single node.

---

### ⚙️ State Management:

Use **Zustand** for managing:
- Node positions and metadata.
- Connections between nodes and chat.
- Modal open/close state.
- Folder contents.

Create `/store/boardStore.ts` to hold global state.

---

### 📦 Initial File Structure:

```txt
/src
  /components
    BoardCanvas.tsx
    ResourceNode.tsx
    AIChatNode.tsx
    ConnectionLine.tsx
    SidebarMenu.tsx
    AddResourceModal.tsx
    FolderNode.tsx
  /store
    boardStore.ts
  App.tsx
  index.tsx

# 🧠 RAGBoard: Visual Knowledge Mapping + AI Chat Interface

RAGBoard is a visual, board-style interface that enables users to connect multimodal content (videos, audio, images, documents, websites, and text) to an AI chat (e.g., Claude or GPT-4). The result is a powerful drag-and-drop **Retrieval-Augmented Generation (RAG)** system where each conversation has contextual awareness of the connected knowledge.

---

## 🚀 Features

- 🧩 **Visual Mind-Map Board**  
  Interactive canvas to drop and organize resource nodes (media, text, URLs, docs).

- 🔗 **Drag-to-Connect AI Chat**  
  Link any resource—or group of resources—to an AI chat module to inform conversations.

- 📥 **Multi-Modal Input Support**  
  - YouTube, TikTok, Instagram, LinkedIn, Facebook Ad URLs  
  - Audio recordings (with built-in recorder and transcription)  
  - Uploaded images (with OCR + visual analysis)  
  - Website URLs (scraped and summarized)  
  - PDFs, TXT, DOC files (text extracted and embedded)  
  - Manual text input  

- 🗂️ **Folders for Grouping Content**  
  Drop multiple resources into a folder, then connect the folder to the AI for batch knowledge injection.

- 🧠 **Pluggable LLM Support**  
  Claude Sonnet by default, with option to swap in OpenAI GPT-4 or other APIs.

---

## 🛠️ Tech Stack (Recommended)

| Layer | Tool |
|-------|------|
| Frontend | React, TailwindCSS, D3.js or React Flow |
| Backend | Node.js + Express |
| Vector DB | Pinecone or Weaviate |
| File Storage | AWS S3 |
| Transcription | OpenAI Whisper API or AssemblyAI |
| Image Analysis | CLIP + OCR (Tesseract) |
| LLM API | Claude (Anthropic) and/or OpenAI GPT-4 |
| Auth | Firebase Auth or Auth0 |
| State Management | Zustand or Redux (optional) |

---

## 🧱 System Architecture

```txt
[ User ]
   ↓
[ React Frontend Board ]
   ↓                          ↘
[ Node.js API ]          [ LLM API (Claude) ]
   ↓                          ↗
[ Embedding Engine + Vector DB ]
   ↓
[ Resource Metadata DB ]