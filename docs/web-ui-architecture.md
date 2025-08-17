# Console-Style Web UI Technical Architecture

## Executive Summary

This document outlines the technical architecture for implementing a console-style web UI for Claude Code that maintains backward compatibility with existing CLI operations while providing real-time streaming of CLI output and seamless user input handling.

## Overall System Architecture

### High-Level Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web UI Layer                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Console View   │  │  Input Handler  │  │  Status Panel   │ │
│  │  - Terminal UI  │  │  - Command Line │  │  - Agent Status │ │
│  │  - Output Stream│  │  - File Upload  │  │  - Task Monitor │ │
│  │  - History      │  │  - Shortcuts    │  │  - Memory Bank  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │   WebSocket Bridge    │
                    │  - Command Routing    │
                    │  - Stream Management  │
                    │  - Session Handling   │
                    └───────────┬───────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                  CLI Output Manager                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Output Capture  │  │ Stream Router   │  │ State Manager   │ │
│  │ - stdout/stderr │  │ - Multi-client  │  │ - CLI State     │ │
│  │ - Command Echo  │  │ - Buffering     │  │ - Session Sync  │ │
│  │ - Process Mgmt  │  │ - Filtering     │  │ - Cache Mgmt    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│               Existing Claude-Flow CLI                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Orchestrator   │  │ Terminal Mgr    │  │  Memory System  │ │
│  │  Task System    │  │ Agent Manager   │  │  Config Manager │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

1. **Web UI Layer**: Browser-based console interface with real-time updates
2. **WebSocket Bridge**: Bi-directional communication between web UI and CLI
3. **CLI Output Manager**: Captures and streams CLI output without disrupting normal operation
4. **Existing CLI**: Unmodified core functionality with minimal integration hooks

## CLI Output Capture and Streaming Specification

### Architecture Overview

The CLI output capture system uses a non-intrusive approach that wraps existing CLI operations without modifying core functionality.

### Core Components

#### 1. Output Interceptor
```typescript
interface OutputInterceptor {
  // Capture stdout/stderr from CLI processes
  captureStream(processId: string, streamType: 'stdout' | 'stderr'): ReadableStream;
  
  // Buffer output for late-joining clients  
  bufferOutput(processId: string, maxSize: number): void;
  
  // Filter sensitive information
  filterOutput(data: string, rules: FilterRule[]): string;
}

interface FilterRule {
  pattern: RegExp;
  replacement: string;
  sensitive: boolean;
}
```

#### 2. Stream Manager
```typescript
interface StreamManager {
  // Create output stream for web clients
  createClientStream(sessionId: string): WebSocketStream;
  
  // Multiplex single CLI output to multiple clients
  multiplexStream(cliStream: ReadableStream): Map<string, WebSocketStream>;
  
  // Handle client connection/disconnection
  manageConnections(): void;
}
```

#### 3. Process Wrapper
```typescript
interface ProcessWrapper {
  // Launch CLI with output capture
  launchWithCapture(command: string[], options: LaunchOptions): Promise<CapturedProcess>;
  
  // Attach to existing CLI process
  attachToProcess(pid: number): CapturedProcess;
}

interface CapturedProcess {
  pid: number;
  stdout: ReadableStream;
  stderr: ReadableStream;
  stdin: WritableStream;
  status: ProcessStatus;
}
```

### Implementation Details

#### CLI Integration Points

1. **Wrapper Script**: Create `claude-flow-web` wrapper that:
   - Launches regular CLI with output capture
   - Starts WebSocket server
   - Manages process lifecycle

2. **Environment Variables**: Use environment flags to detect web mode:
   ```bash
   CLAUDE_FLOW_WEB_MODE=true
   CLAUDE_FLOW_WEB_PORT=3000
   CLAUDE_FLOW_SESSION_ID=session-123
   ```

3. **Output Hooks**: Minimal hooks in existing CLI for:
   - Session status updates
   - Memory bank synchronization
   - Task completion notifications

#### Streaming Protocol

```typescript
interface StreamMessage {
  type: 'output' | 'error' | 'status' | 'complete';
  timestamp: number;
  sessionId: string;
  data: string;
  metadata?: {
    processId?: string;
    command?: string;
    agentId?: string;
  };
}
```

## User Input Handling System

### Architecture Goals

- **Unified Input Processing**: Handle commands from both CLI and web UI
- **Context Preservation**: Maintain CLI state and context across interfaces
- **Security**: Validate and sanitize all user inputs
- **Compatibility**: Ensure existing CLI behavior is unchanged

### Core Components

#### 1. Input Router
```typescript
interface InputRouter {
  // Route commands to appropriate handler
  routeCommand(input: UserInput): Promise<CommandResult>;
  
  // Validate input security and format
  validateInput(input: UserInput): ValidationResult;
  
  // Handle file uploads and attachments
  processFileInput(files: FileInput[]): Promise<ProcessedFiles>;
}

interface UserInput {
  type: 'command' | 'file' | 'interrupt' | 'paste';
  content: string | File[];
  sessionId: string;
  timestamp: number;
  metadata?: InputMetadata;
}
```

#### 2. Command Parser
```typescript
interface CommandParser {
  // Parse web UI input into CLI-compatible format
  parseWebInput(input: string): ParsedCommand;
  
  // Handle special web UI commands (file upload, etc.)
  parseSpecialCommands(input: string): SpecialCommand[];
  
  // Validate command syntax and permissions
  validateCommand(command: ParsedCommand): ValidationResult;
}

interface ParsedCommand {
  executable: string;
  args: string[];
  flags: Map<string, string>;
  files?: AttachedFile[];
}
```

#### 3. Session Manager
```typescript
interface SessionManager {
  // Create new CLI session for web client
  createSession(clientId: string): Promise<CLISession>;
  
  // Synchronize session state between CLI and web
  syncSessionState(sessionId: string): Promise<SessionState>;
  
  // Handle session persistence and recovery
  persistSession(session: CLISession): Promise<void>;
  restoreSession(sessionId: string): Promise<CLISession>;
}

interface CLISession {
  id: string;
  workingDirectory: string;
  environment: Map<string, string>;
  history: CommandHistory;
  state: SessionState;
  agents: ActiveAgent[];
}
```

### Input Processing Flow

1. **Web UI Input** → Input Router → Command Parser → CLI Process
2. **File Upload** → File Processor → Temporary Storage → CLI Access
3. **Shortcuts/Macros** → Macro Expander → Command Parser → CLI Process
4. **Interrupts** → Signal Handler → CLI Process Control

## Web Server and Client Architecture

### Server Architecture

#### 1. Web Server Stack
```typescript
// Using Node.js with Express and Socket.io
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

interface WebServer {
  app: express.Application;
  httpServer: http.Server;
  socketServer: SocketIOServer;
  
  // Core server lifecycle
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  
  // Handle client connections
  handleConnection(socket: Socket): void;
}
```

#### 2. Route Handlers
```typescript
interface RouteHandlers {
  // Serve web UI assets
  serveStaticAssets(req: Request, res: Response): void;
  
  // Handle file uploads
  handleFileUpload(req: Request, res: Response): Promise<void>;
  
  // Provide session information
  getSessionInfo(req: Request, res: Response): Promise<void>;
  
  // Health check endpoint
  healthCheck(req: Request, res: Response): void;
}
```

### Client Architecture

#### 1. Frontend Framework
- **Framework**: Vanilla TypeScript with minimal dependencies
- **Styling**: CSS modules with console theme
- **Build**: Vite for development and bundling

#### 2. Core Components
```typescript
interface ConsoleComponent {
  // Terminal display with scrollback
  terminal: TerminalDisplay;
  
  // Command input with history
  commandLine: CommandInput;
  
  // Status and monitoring panels
  statusPanel: StatusDisplay;
  
  // File drag-and-drop
  fileHandler: FileDropHandler;
}

interface TerminalDisplay {
  // Render output with ANSI color support
  renderOutput(data: string): void;
  
  // Handle scrolling and history
  scrollToBottom(): void;
  scrollToTop(): void;
  
  // Search functionality
  search(query: string): SearchResult[];
}
```

#### 3. WebSocket Client
```typescript
interface WebSocketClient {
  // Connection management
  connect(url: string): Promise<void>;
  disconnect(): void;
  
  // Message handling
  sendCommand(command: string): void;
  sendFile(file: File): Promise<void>;
  
  // Event listeners
  onOutput(callback: (data: string) => void): void;
  onStatus(callback: (status: SessionStatus) => void): void;
  onError(callback: (error: Error) => void): void;
}
```

## API and Communication Protocols

### WebSocket Protocol

#### Message Types
```typescript
// Client to Server
interface ClientMessage {
  type: 'command' | 'file' | 'ping' | 'interrupt';
  payload: CommandPayload | FilePayload | PingPayload | InterruptPayload;
  requestId: string;
}

// Server to Client  
interface ServerMessage {
  type: 'output' | 'error' | 'status' | 'pong' | 'complete';
  payload: any;
  requestId?: string;
}
```

#### Command Protocol
```typescript
interface CommandPayload {
  command: string;
  sessionId: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
}

interface OutputPayload {
  data: string;
  stream: 'stdout' | 'stderr';
  timestamp: number;
  metadata?: {
    processId: string;
    command: string;
  };
}
```

### REST API Endpoints

```typescript
interface APIEndpoints {
  // Session management
  'POST /api/sessions': CreateSessionResponse;
  'GET /api/sessions/:id': SessionInfo;
  'DELETE /api/sessions/:id': void;
  
  // File operations
  'POST /api/files/upload': FileUploadResponse;
  'GET /api/files/:id': FileContent;
  
  // System status
  'GET /api/status': SystemStatus;
  'GET /api/health': HealthCheck;
}
```

## Data Flow Diagrams

### Command Execution Flow
```
Web UI Input → WebSocket → Input Router → Command Parser
                                              ↓
CLI Process ← Process Manager ← Session Manager ← Command Validator
     ↓
Output Capture → Stream Manager → WebSocket → Web UI Display
```

### File Upload Flow  
```
File Drop → Upload Handler → Temporary Storage → CLI Access Path
                ↓                    ↓
        WebSocket Notify → Web UI Confirmation
```

### Multi-Client Streaming
```
CLI Process Output → Output Interceptor → Stream Multiplexer
                                              ↓
                                    ┌─── Client 1 WebSocket
                                    ├─── Client 2 WebSocket  
                                    └─── Client N WebSocket
```

## Security Considerations

### Input Validation
- **Command Injection Prevention**: Strict parsing and validation
- **File Upload Security**: Type validation, size limits, virus scanning
- **Path Traversal Protection**: Restrict file system access
- **Privilege Escalation**: Maintain CLI user permissions

### Authentication and Authorization
```typescript
interface SecurityManager {
  // Validate client connections
  authenticateClient(token: string): Promise<ClientIdentity>;
  
  // Check command permissions
  authorizeCommand(client: ClientIdentity, command: string): boolean;
  
  // Rate limiting
  checkRateLimit(clientId: string): Promise<boolean>;
}
```

### Data Protection
- **Session Isolation**: Separate client sessions
- **Output Filtering**: Remove sensitive information
- **Secure WebSocket**: WSS with proper certificates
- **Memory Cleanup**: Clear sensitive data on session end

## Performance Requirements

### Latency Targets
- **Command Response**: < 100ms for simple commands
- **Output Streaming**: < 50ms latency
- **File Upload**: < 1s for files up to 10MB
- **Connection Establishment**: < 2s

### Throughput Requirements
- **Concurrent Sessions**: Support 50+ simultaneous sessions
- **Output Rate**: Handle 1000+ lines/second per session
- **WebSocket Messages**: 10,000+ messages/second total

### Resource Limits
- **Memory Usage**: < 100MB base server overhead
- **CPU Usage**: < 20% on modern server hardware
- **Network Bandwidth**: Efficient compression and batching

## Implementation Roadmap

### Phase 1: Core Infrastructure
1. Output capture system
2. WebSocket server
3. Basic web UI shell

### Phase 2: Input Handling
1. Command routing
2. File upload support
3. Session management

### Phase 3: Advanced Features
1. Multiple client support
2. Session persistence
3. Advanced UI features

### Phase 4: Optimization
1. Performance tuning
2. Security hardening
3. Monitoring and logging

## Technical Specifications Summary

This architecture provides:

1. **Non-intrusive Integration**: Minimal changes to existing CLI
2. **Real-time Streaming**: Live output with minimal latency
3. **Unified Input Handling**: Seamless command processing
4. **Console-style UX**: Familiar terminal interface
5. **Multi-client Support**: Collaborative development
6. **Security First**: Comprehensive security measures
7. **Performance Optimized**: Efficient resource usage
8. **Backward Compatible**: Existing CLI unchanged

The design ensures that claude-flow settings integration, real-time CLI streaming, and console-style web interface work together seamlessly while maintaining the robustness and functionality of the existing CLI system.