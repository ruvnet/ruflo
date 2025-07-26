# RAGBOARD API Specification

## API Overview

The RAGBOARD API follows RESTful principles with additional WebSocket endpoints for real-time features. All API endpoints return JSON and use standard HTTP status codes.

## Base URL

```
Production: https://api.ragboard.com/v1
Development: http://localhost:3000/api/v1
```

## Authentication

All API requests require authentication using JWT tokens in the Authorization header:

```
Authorization: Bearer <token>
```

## Common Response Format

### Success Response

```json
{
  "success": true,
  "data": { },
  "meta": {
    "timestamp": "2024-01-25T12:00:00Z",
    "version": "1.0.0"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found",
    "details": { },
    "requestId": "req_abc123"
  }
}
```

## Endpoints

### Authentication

#### POST /auth/register
Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "usr_123",
      "email": "user@example.com",
      "name": "John Doe",
      "createdAt": "2024-01-25T12:00:00Z"
    },
    "tokens": {
      "access": "eyJ...",
      "refresh": "eyJ...",
      "expiresIn": 3600
    }
  }
}
```

#### POST /auth/login
Authenticate and receive tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response:** Same as register

#### POST /auth/refresh
Refresh access token.

**Request Body:**
```json
{
  "refreshToken": "eyJ..."
}
```

#### POST /auth/logout
Invalidate refresh token.

### Boards

#### GET /boards
List all boards for authenticated user.

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)
- `sort` (string): Sort field (default: "updatedAt")
- `order` (string): Sort order "asc" or "desc" (default: "desc")

**Response:**
```json
{
  "success": true,
  "data": {
    "boards": [
      {
        "id": "brd_123",
        "name": "Research Board",
        "description": "AI research materials",
        "thumbnail": "https://s3.../thumb.jpg",
        "nodeCount": 15,
        "lastModified": "2024-01-25T12:00:00Z",
        "createdAt": "2024-01-20T12:00:00Z",
        "permissions": {
          "canEdit": true,
          "canDelete": true,
          "canShare": true
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
}
```

#### POST /boards
Create a new board.

**Request Body:**
```json
{
  "name": "New Research Board",
  "description": "Collection of AI papers",
  "settings": {
    "gridSnap": true,
    "gridSize": 20,
    "theme": "light"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "board": {
      "id": "brd_124",
      "name": "New Research Board",
      "description": "Collection of AI papers",
      "settings": { },
      "createdAt": "2024-01-25T12:00:00Z"
    }
  }
}
```

#### GET /boards/:id
Get board details with all nodes and connections.

**Response:**
```json
{
  "success": true,
  "data": {
    "board": {
      "id": "brd_123",
      "name": "Research Board",
      "description": "AI research materials",
      "settings": { },
      "nodes": {
        "resources": [
          {
            "id": "node_123",
            "type": "resource",
            "resourceType": "pdf",
            "title": "Attention Is All You Need",
            "position": { "x": 100, "y": 200 },
            "size": { "width": 300, "height": 200 },
            "content": "Transformer architecture paper...",
            "metadata": {
              "url": "https://arxiv.org/...",
              "pageCount": 15,
              "extractedText": "...",
              "summary": "..."
            }
          }
        ],
        "chats": [
          {
            "id": "node_456",
            "type": "chat",
            "position": { "x": 500, "y": 200 },
            "size": { "width": 400, "height": 500 },
            "aiModel": "claude-3-sonnet",
            "settings": {
              "temperature": 0.7,
              "maxTokens": 4000
            },
            "connectedResources": ["node_123"]
          }
        ],
        "folders": [ ]
      },
      "connections": [
        {
          "id": "conn_789",
          "from": "node_123",
          "to": "node_456",
          "type": "data_flow"
        }
      ]
    }
  }
}
```

#### PUT /boards/:id
Update board settings.

**Request Body:**
```json
{
  "name": "Updated Board Name",
  "description": "New description",
  "settings": {
    "theme": "dark"
  }
}
```

#### DELETE /boards/:id
Delete a board and all its contents.

### Nodes

#### POST /boards/:boardId/nodes
Add a new node to a board.

**Request Body:**
```json
{
  "type": "resource",
  "resourceType": "url",
  "position": { "x": 300, "y": 400 },
  "data": {
    "url": "https://example.com/article",
    "title": "Interesting Article"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "node": {
      "id": "node_124",
      "boardId": "brd_123",
      "type": "resource",
      "resourceType": "url",
      "position": { "x": 300, "y": 400 },
      "title": "Interesting Article",
      "processingStatus": "pending",
      "createdAt": "2024-01-25T12:00:00Z"
    }
  }
}
```

#### PUT /nodes/:id
Update node properties.

**Request Body:**
```json
{
  "position": { "x": 350, "y": 450 },
  "size": { "width": 320, "height": 240 },
  "title": "Updated Title",
  "metadata": {
    "notes": "Important reference"
  }
}
```

#### DELETE /nodes/:id
Remove a node from the board.

#### POST /nodes/:id/process
Trigger processing for a node (extract text, generate embeddings, etc).

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job_123",
    "status": "queued",
    "estimatedTime": 30
  }
}
```

### Connections

#### POST /connections
Create a connection between nodes.

**Request Body:**
```json
{
  "boardId": "brd_123",
  "from": "node_123",
  "to": "node_456",
  "type": "data_flow"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "connection": {
      "id": "conn_790",
      "boardId": "brd_123",
      "from": "node_123",
      "to": "node_456",
      "type": "data_flow",
      "createdAt": "2024-01-25T12:00:00Z"
    }
  }
}
```

#### DELETE /connections/:id
Remove a connection.

### AI Chat

#### POST /chat/sessions
Start a new chat session.

**Request Body:**
```json
{
  "chatNodeId": "node_456",
  "context": {
    "connectedResources": ["node_123", "node_124"],
    "systemPrompt": "You are a helpful AI assistant with knowledge about the connected resources."
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "session": {
      "id": "sess_123",
      "chatNodeId": "node_456",
      "context": { },
      "startedAt": "2024-01-25T12:00:00Z"
    }
  }
}
```

#### POST /chat/sessions/:id/messages
Send a message in a chat session.

**Request Body:**
```json
{
  "message": "Can you summarize the main points from the connected PDF?"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": {
      "id": "msg_123",
      "sessionId": "sess_123",
      "role": "assistant",
      "content": "Based on the connected PDF 'Attention Is All You Need', here are the main points:\n\n1. The paper introduces the Transformer architecture...",
      "createdAt": "2024-01-25T12:00:01Z"
    }
  }
}
```

#### GET /chat/sessions/:id/messages
Get chat history.

**Query Parameters:**
- `limit` (number): Messages to return (default: 50)
- `before` (string): Message ID to paginate before

### Media

#### POST /upload
Upload a file for processing.

**Request:** Multipart form data
- `file`: The file to upload
- `boardId`: Target board ID
- `nodeId` (optional): Existing node to attach to

**Response:**
```json
{
  "success": true,
  "data": {
    "media": {
      "id": "media_123",
      "url": "https://s3.../file.pdf",
      "mimeType": "application/pdf",
      "size": 1048576,
      "processingStatus": "queued"
    }
  }
}
```

#### POST /media/transcribe
Transcribe audio file.

**Request Body:**
```json
{
  "mediaId": "media_123",
  "language": "en"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "transcription": {
      "text": "This is the transcribed text...",
      "duration": 120,
      "language": "en",
      "confidence": 0.95
    }
  }
}
```

#### POST /media/analyze-image
Analyze image content.

**Request Body:**
```json
{
  "mediaId": "media_456",
  "analyses": ["ocr", "objects", "description"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "analysis": {
      "ocr": {
        "text": "Extracted text from image...",
        "confidence": 0.92
      },
      "objects": [
        {
          "label": "person",
          "confidence": 0.98,
          "bbox": { "x": 100, "y": 50, "width": 200, "height": 300 }
        }
      ],
      "description": "A person standing in front of a whiteboard with diagrams"
    }
  }
}
```

### Search

#### POST /search
Perform vector similarity search.

**Request Body:**
```json
{
  "query": "transformer architecture attention mechanism",
  "boardId": "brd_123",
  "filters": {
    "resourceTypes": ["pdf", "url"],
    "dateRange": {
      "from": "2024-01-01",
      "to": "2024-01-31"
    }
  },
  "limit": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "nodeId": "node_123",
        "title": "Attention Is All You Need",
        "snippet": "...self-attention mechanism allows the model to...",
        "score": 0.92,
        "metadata": {
          "resourceType": "pdf",
          "pageNumber": 3
        }
      }
    ]
  }
}
```

### Sharing

#### POST /boards/:id/share
Create a share link for a board.

**Request Body:**
```json
{
  "permissions": "view",
  "expiresIn": 604800,
  "password": "optional_password"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "shareLink": {
      "id": "share_123",
      "url": "https://ragboard.com/shared/abc123xyz",
      "permissions": "view",
      "expiresAt": "2024-02-01T12:00:00Z",
      "hasPassword": true
    }
  }
}
```

## WebSocket Events

### Connection

```javascript
const socket = io('wss://api.ragboard.com', {
  auth: {
    token: 'Bearer <token>'
  }
})
```

### Events

#### Client → Server

- `join-board`: Join a board room
  ```json
  { "boardId": "brd_123" }
  ```

- `leave-board`: Leave a board room
  ```json
  { "boardId": "brd_123" }
  ```

- `node-update`: Broadcast node changes
  ```json
  {
    "boardId": "brd_123",
    "nodeId": "node_123",
    "updates": { "position": { "x": 400, "y": 300 } }
  }
  ```

- `cursor-move`: Share cursor position
  ```json
  {
    "boardId": "brd_123",
    "position": { "x": 500, "y": 400 }
  }
  ```

- `start-typing`: Indicate typing in chat
  ```json
  {
    "boardId": "brd_123",
    "chatNodeId": "node_456"
  }
  ```

#### Server → Client

- `board-joined`: Confirmation of joining board
  ```json
  {
    "boardId": "brd_123",
    "activeUsers": ["usr_123", "usr_456"]
  }
  ```

- `node-updated`: Node was updated by another user
  ```json
  {
    "nodeId": "node_123",
    "updates": { },
    "userId": "usr_456",
    "timestamp": "2024-01-25T12:00:00Z"
  }
  ```

- `node-created`: New node added to board
  ```json
  {
    "node": { },
    "userId": "usr_456"
  }
  ```

- `node-deleted`: Node removed from board
  ```json
  {
    "nodeId": "node_123",
    "userId": "usr_456"
  }
  ```

- `connection-created`: New connection added
  ```json
  {
    "connection": { },
    "userId": "usr_456"
  }
  ```

- `cursor-moved`: Another user's cursor position
  ```json
  {
    "userId": "usr_456",
    "position": { "x": 600, "y": 500 }
  }
  ```

- `user-typing`: User is typing in chat
  ```json
  {
    "userId": "usr_456",
    "chatNodeId": "node_456"
  }
  ```

## Rate Limiting

API endpoints have the following rate limits:

| Endpoint Type | Limit | Window |
|--------------|-------|---------|
| Authentication | 5 requests | 15 minutes |
| Read operations | 100 requests | 1 minute |
| Write operations | 30 requests | 1 minute |
| File uploads | 10 requests | 5 minutes |
| AI operations | 20 requests | 1 minute |

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706186400
```

## Error Codes

| Code | HTTP Status | Description |
|------|------------|-------------|
| AUTH_INVALID_CREDENTIALS | 401 | Invalid email or password |
| AUTH_TOKEN_EXPIRED | 401 | JWT token has expired |
| AUTH_TOKEN_INVALID | 401 | JWT token is invalid |
| RESOURCE_NOT_FOUND | 404 | Resource does not exist |
| PERMISSION_DENIED | 403 | User lacks required permissions |
| VALIDATION_ERROR | 400 | Request validation failed |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Internal server error |
| SERVICE_UNAVAILABLE | 503 | Service temporarily unavailable |

## SDK Examples

### JavaScript/TypeScript

```typescript
import { RAGBoardClient } from '@ragboard/sdk'

const client = new RAGBoardClient({
  apiKey: process.env.RAGBOARD_API_KEY,
  baseUrl: 'https://api.ragboard.com/v1'
})

// Create a board
const board = await client.boards.create({
  name: 'My Research Board',
  description: 'Collection of AI papers'
})

// Add a resource node
const node = await client.nodes.create(board.id, {
  type: 'resource',
  resourceType: 'url',
  position: { x: 100, y: 100 },
  data: {
    url: 'https://arxiv.org/...',
    title: 'Interesting Paper'
  }
})

// Start a chat session
const session = await client.chat.createSession({
  chatNodeId: 'node_456',
  context: {
    connectedResources: [node.id]
  }
})

// Send a message
const response = await client.chat.sendMessage(session.id, {
  message: 'What are the key insights from this paper?'
})
```

### Python

```python
from ragboard import RAGBoardClient

client = RAGBoardClient(
    api_key=os.environ['RAGBOARD_API_KEY'],
    base_url='https://api.ragboard.com/v1'
)

# Create a board
board = client.boards.create(
    name='My Research Board',
    description='Collection of AI papers'
)

# Add a resource node
node = client.nodes.create(
    board_id=board.id,
    type='resource',
    resource_type='url',
    position={'x': 100, 'y': 100},
    data={
        'url': 'https://arxiv.org/...',
        'title': 'Interesting Paper'
    }
)

# Start a chat session
session = client.chat.create_session(
    chat_node_id='node_456',
    context={
        'connected_resources': [node.id]
    }
)

# Send a message
response = client.chat.send_message(
    session_id=session.id,
    message='What are the key insights from this paper?'
)
```