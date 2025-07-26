# RAGBoard API Endpoints Specification

## Overview

This document defines all REST API endpoints for RAGBoard, organized by module. Each endpoint includes request/response schemas, authentication requirements, and error handling.

## Base Configuration

```yaml
base_url: https://api.ragboard.com/v1
content_type: application/json
authentication: Bearer JWT
rate_limiting: 
  default: 100 requests/minute
  ai_endpoints: 10 requests/minute
```

## Authentication Endpoints

### POST /auth/register
Register a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response (201):**
```json
{
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "created_at": "2024-01-15T10:00:00Z"
  },
  "tokens": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_in": 3600
  }
}
```

### POST /auth/login
Authenticate user and receive tokens.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "tokens": {
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_in": 3600
  }
}
```

### POST /auth/refresh
Refresh access token using refresh token.

**Request:**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJ...",
  "expires_in": 3600
}
```

### POST /auth/logout
Invalidate current session.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response (204):**
No content

## Board Management Endpoints

### GET /boards
List all boards for authenticated user.

**Query Parameters:**
- `page` (integer): Page number (default: 1)
- `limit` (integer): Items per page (default: 20, max: 100)
- `sort` (string): Sort field (created_at, updated_at, name)
- `order` (string): Sort order (asc, desc)
- `search` (string): Search in board names

**Response (200):**
```json
{
  "boards": [
    {
      "id": "brd_xyz789",
      "name": "Project Research",
      "description": "Research materials for Q1 project",
      "thumbnail_url": "https://cdn.ragboard.com/thumbnails/brd_xyz789.jpg",
      "node_count": 42,
      "created_at": "2024-01-10T08:00:00Z",
      "updated_at": "2024-01-15T14:30:00Z",
      "permissions": {
        "can_edit": true,
        "can_delete": true,
        "can_share": true
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

### POST /boards
Create a new board.

**Request:**
```json
{
  "name": "New Research Board",
  "description": "Collection of research materials",
  "settings": {
    "grid_snap": true,
    "auto_save": true,
    "collaboration_enabled": false
  }
}
```

**Response (201):**
```json
{
  "board": {
    "id": "brd_new123",
    "name": "New Research Board",
    "description": "Collection of research materials",
    "settings": {
      "grid_snap": true,
      "auto_save": true,
      "collaboration_enabled": false
    },
    "created_at": "2024-01-15T15:00:00Z"
  }
}
```

### GET /boards/{board_id}
Get detailed board information with nodes and connections.

**Response (200):**
```json
{
  "board": {
    "id": "brd_xyz789",
    "name": "Project Research",
    "description": "Research materials for Q1 project",
    "settings": {
      "grid_snap": true,
      "auto_save": true
    },
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    },
    "nodes": [
      {
        "id": "node_abc123",
        "type": "resource",
        "position": { "x": 100, "y": 200 },
        "size": { "width": 300, "height": 200 },
        "data": {
          "resource_type": "pdf",
          "title": "Research Paper",
          "url": "https://storage.ragboard.com/files/doc123.pdf"
        }
      }
    ],
    "connections": [
      {
        "id": "conn_xyz456",
        "source": "node_abc123",
        "target": "node_def456",
        "type": "reference"
      }
    ]
  }
}
```

### PUT /boards/{board_id}
Update board metadata.

**Request:**
```json
{
  "name": "Updated Board Name",
  "description": "New description",
  "settings": {
    "collaboration_enabled": true
  }
}
```

**Response (200):**
```json
{
  "board": {
    "id": "brd_xyz789",
    "name": "Updated Board Name",
    "description": "New description",
    "updated_at": "2024-01-15T16:00:00Z"
  }
}
```

### DELETE /boards/{board_id}
Delete a board and all its contents.

**Response (204):**
No content

## Node Management Endpoints

### POST /boards/{board_id}/nodes
Add a new node to the board.

**Request:**
```json
{
  "type": "resource",
  "position": { "x": 300, "y": 400 },
  "data": {
    "resource_type": "url",
    "title": "Important Article",
    "url": "https://example.com/article",
    "notes": "Key insights about the topic"
  }
}
```

**Response (201):**
```json
{
  "node": {
    "id": "node_new789",
    "type": "resource",
    "position": { "x": 300, "y": 400 },
    "size": { "width": 300, "height": 150 },
    "data": {
      "resource_type": "url",
      "title": "Important Article",
      "url": "https://example.com/article",
      "notes": "Key insights about the topic",
      "metadata": {
        "favicon": "https://example.com/favicon.ico",
        "description": "Article description from meta tags"
      }
    },
    "created_at": "2024-01-15T16:30:00Z"
  }
}
```

### PUT /nodes/{node_id}
Update node properties.

**Request:**
```json
{
  "position": { "x": 350, "y": 450 },
  "size": { "width": 400, "height": 200 },
  "data": {
    "title": "Updated Title",
    "notes": "Additional notes"
  }
}
```

**Response (200):**
```json
{
  "node": {
    "id": "node_new789",
    "position": { "x": 350, "y": 450 },
    "size": { "width": 400, "height": 200 },
    "data": {
      "title": "Updated Title",
      "notes": "Additional notes"
    },
    "updated_at": "2024-01-15T17:00:00Z"
  }
}
```

### DELETE /nodes/{node_id}
Remove a node from the board.

**Response (204):**
No content

### POST /nodes/{node_id}/process
Process node content (extract text, generate embeddings, etc.).

**Request:**
```json
{
  "operations": ["extract_text", "generate_embeddings", "summarize"]
}
```

**Response (202):**
```json
{
  "job_id": "job_proc123",
  "status": "processing",
  "operations": ["extract_text", "generate_embeddings", "summarize"],
  "estimated_completion": "2024-01-15T17:05:00Z"
}
```

## Connection Endpoints

### POST /connections
Create a connection between nodes.

**Request:**
```json
{
  "source": "node_abc123",
  "target": "node_def456",
  "type": "data_flow",
  "metadata": {
    "label": "Supports argument"
  }
}
```

**Response (201):**
```json
{
  "connection": {
    "id": "conn_new123",
    "source": "node_abc123",
    "target": "node_def456",
    "type": "data_flow",
    "metadata": {
      "label": "Supports argument"
    },
    "created_at": "2024-01-15T17:30:00Z"
  }
}
```

### DELETE /connections/{connection_id}
Remove a connection.

**Response (204):**
No content

## AI Chat Endpoints

### POST /chat/sessions
Start a new AI chat session.

**Request:**
```json
{
  "node_id": "node_chat123",
  "model": "claude-3-sonnet",
  "context_node_ids": ["node_abc123", "node_def456"],
  "system_prompt": "You are a helpful research assistant with access to the provided documents."
}
```

**Response (201):**
```json
{
  "session": {
    "id": "sess_chat789",
    "node_id": "node_chat123",
    "model": "claude-3-sonnet",
    "context": {
      "resources": [
        {
          "node_id": "node_abc123",
          "type": "pdf",
          "title": "Research Paper",
          "summary": "A study on climate change impacts..."
        }
      ],
      "total_tokens": 2500
    },
    "created_at": "2024-01-15T18:00:00Z"
  }
}
```

### POST /chat/{session_id}/messages
Send a message in the chat session.

**Request:**
```json
{
  "message": "What are the key findings from the research paper?",
  "stream": true
}
```

**Response (200) - Streaming:**
```
data: {"chunk": "Based on the research paper", "type": "content"}
data: {"chunk": ", the key findings are:\n\n1. ", "type": "content"}
data: {"chunk": "Temperature increases of 1.5°C", "type": "content"}
data: {"done": true, "usage": {"prompt_tokens": 2500, "completion_tokens": 150}}
```

**Response (200) - Non-streaming:**
```json
{
  "message": {
    "id": "msg_abc123",
    "role": "assistant",
    "content": "Based on the research paper, the key findings are:\n\n1. Temperature increases of 1.5°C...",
    "created_at": "2024-01-15T18:01:00Z"
  },
  "usage": {
    "prompt_tokens": 2500,
    "completion_tokens": 150,
    "total_tokens": 2650
  }
}
```

### GET /chat/{session_id}/history
Retrieve chat history.

**Query Parameters:**
- `limit` (integer): Number of messages (default: 50)
- `before` (string): Get messages before this ID
- `after` (string): Get messages after this ID

**Response (200):**
```json
{
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "What are the key findings?",
      "created_at": "2024-01-15T18:00:30Z"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "Based on the research paper...",
      "created_at": "2024-01-15T18:01:00Z"
    }
  ],
  "has_more": true
}
```

## Media Upload Endpoints

### POST /upload
Upload media files.

**Request:**
```
Content-Type: multipart/form-data

file: <binary data>
type: "image" | "video" | "audio" | "document"
node_id: "node_abc123" (optional)
```

**Response (201):**
```json
{
  "media": {
    "id": "media_xyz789",
    "type": "image",
    "filename": "research-diagram.png",
    "size": 1048576,
    "mime_type": "image/png",
    "url": "https://storage.ragboard.com/media/media_xyz789.png",
    "thumbnail_url": "https://storage.ragboard.com/thumbnails/media_xyz789_thumb.png",
    "processing_status": "completed",
    "metadata": {
      "width": 1920,
      "height": 1080,
      "duration": null
    },
    "created_at": "2024-01-15T19:00:00Z"
  }
}
```

### GET /media/{media_id}
Get media file information.

**Response (200):**
```json
{
  "media": {
    "id": "media_xyz789",
    "type": "image",
    "filename": "research-diagram.png",
    "url": "https://storage.ragboard.com/media/media_xyz789.png",
    "processing_status": "completed",
    "extracted_text": "Diagram showing climate trends...",
    "embeddings_generated": true
  }
}
```

### POST /transcribe
Transcribe audio/video content.

**Request:**
```json
{
  "media_id": "media_audio123",
  "language": "en",
  "format": "vtt"
}
```

**Response (202):**
```json
{
  "job_id": "job_trans456",
  "status": "processing",
  "estimated_completion": "2024-01-15T19:10:00Z"
}
```

## Search Endpoints

### POST /search
Vector search across board content.

**Request:**
```json
{
  "query": "climate change mitigation strategies",
  "board_id": "brd_xyz789",
  "filters": {
    "node_types": ["resource", "chat"],
    "resource_types": ["pdf", "url"]
  },
  "limit": 10,
  "include_context": true
}
```

**Response (200):**
```json
{
  "results": [
    {
      "node_id": "node_abc123",
      "type": "resource",
      "title": "Climate Mitigation Report",
      "score": 0.89,
      "highlights": [
        "...effective <em>mitigation strategies</em> include renewable energy adoption..."
      ],
      "context": {
        "before": "The report identifies that",
        "match": "effective mitigation strategies include renewable energy adoption",
        "after": "and carbon capture technologies."
      }
    }
  ],
  "total": 15,
  "query_embedding_generated": true
}
```

### GET /suggestions
Get content suggestions based on current board.

**Query Parameters:**
- `board_id` (string): Board to analyze
- `node_id` (string): Specific node for context (optional)
- `limit` (integer): Number of suggestions (default: 5)

**Response (200):**
```json
{
  "suggestions": [
    {
      "type": "related_content",
      "title": "Related Research on Carbon Capture",
      "reason": "Similar topics discussed in your current nodes",
      "url": "https://example.com/carbon-capture-research",
      "confidence": 0.85
    }
  ]
}
```

## WebSocket Events

### Connection
```javascript
const socket = io('wss://api.ragboard.com', {
  auth: { token: 'Bearer <access_token>' }
});
```

### Events

#### join-board
Join a board room for real-time updates.
```javascript
socket.emit('join-board', { board_id: 'brd_xyz789' });
```

#### board-joined
Confirmation of joining board.
```javascript
socket.on('board-joined', (data) => {
  console.log('Joined board:', data.board_id);
  console.log('Active users:', data.active_users);
});
```

#### node-update
Real-time node updates.
```javascript
// Sending update
socket.emit('node-update', {
  node_id: 'node_abc123',
  updates: { position: { x: 400, y: 300 } }
});

// Receiving update
socket.on('node-update', (data) => {
  console.log('Node updated:', data.node_id, data.updates);
});
```

#### cursor-move
Track cursor positions of other users.
```javascript
// Sending position
socket.emit('cursor-move', { x: 500, y: 600 });

// Receiving positions
socket.on('cursor-move', (data) => {
  console.log('User cursor:', data.user_id, data.position);
});
```

#### presence-update
User presence status.
```javascript
socket.on('presence-update', (data) => {
  console.log('User presence:', data.user_id, data.status);
});
```

## Error Responses

All endpoints follow a consistent error response format:

```json
{
  "error": {
    "type": "validation_error",
    "message": "Invalid request parameters",
    "details": {
      "field": "email",
      "reason": "Invalid email format"
    },
    "request_id": "req_abc123",
    "documentation_url": "https://docs.ragboard.com/api/errors#validation_error"
  }
}
```

### Common Error Types

| Type | HTTP Status | Description |
|------|------------|-------------|
| `authentication_error` | 401 | Invalid or missing authentication |
| `authorization_error` | 403 | Insufficient permissions |
| `not_found_error` | 404 | Resource not found |
| `validation_error` | 400 | Invalid request parameters |
| `rate_limit_error` | 429 | Too many requests |
| `server_error` | 500 | Internal server error |
| `service_unavailable` | 503 | Service temporarily unavailable |

## Rate Limiting

Rate limit information is included in response headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1673784000
X-RateLimit-Reset-After: 3600
```

## Pagination

Paginated endpoints follow a consistent format:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5,
    "has_next": true,
    "has_prev": false
  }
}
```

## Webhooks

Configure webhooks for async events:

### POST /webhooks
```json
{
  "url": "https://your-app.com/webhook",
  "events": ["board.updated", "node.processed", "chat.message"],
  "secret": "webhook_secret_key"
}
```

### Webhook Payload
```json
{
  "event": "node.processed",
  "timestamp": "2024-01-15T20:00:00Z",
  "data": {
    "node_id": "node_abc123",
    "processing_results": {
      "text_extracted": true,
      "embeddings_generated": true,
      "summary": "Document summary..."
    }
  },
  "signature": "sha256=..."
}
```