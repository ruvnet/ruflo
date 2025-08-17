# CLI Output Capture and Streaming Technical Specification

## Overview

This document provides detailed technical specifications for capturing and streaming CLI output in real-time while maintaining full backward compatibility with existing claude-flow operations.

## Architecture Design

### Core Principles

1. **Non-Intrusive**: Minimal changes to existing CLI codebase
2. **Real-Time**: Sub-50ms latency for output streaming
3. **Reliable**: Robust error handling and recovery
4. **Scalable**: Support multiple concurrent web clients
5. **Secure**: Filtered output and access control

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLI Output Capture System                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │  Process        │    │   Output        │    │   Stream    │ │
│  │  Launcher       │───▶│   Interceptor   │───▶│   Manager   │ │
│  │                 │    │                 │    │             │ │
│  │ • spawn CLI     │    │ • capture       │    │ • multiplex │ │
│  │ • pipe mgmt     │    │ • buffer        │    │ • broadcast │ │
│  │ • lifecycle     │    │ • filter        │    │ • client    │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │  State          │    │   Session       │    │   WebSocket │ │
│  │  Manager        │    │   Controller    │    │   Server    │ │
│  │                 │    │                 │    │             │ │
│  │ • CLI state     │    │ • sync state    │    │ • client    │ │
│  │ • memory sync   │    │ • handle cmds   │    │ • broadcast │ │
│  │ • config mgmt   │    │ • persistence   │    │ • protocol  │ │
│  └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Process Launcher

### Implementation Strategy

The Process Launcher creates a wrapper around the existing CLI that captures all output streams without modifying the core CLI implementation.

#### Core Interface

```typescript
interface ProcessLauncher {
  // Launch CLI with output capture
  launch(command: string[], options: LaunchOptions): Promise<CapturedProcess>;
  
  // Attach to existing process (for hot-attach scenarios)
  attach(pid: number): Promise<CapturedProcess>;
  
  // Terminate process gracefully
  terminate(processId: string, signal?: string): Promise<void>;
  
  // Get process status
  getStatus(processId: string): ProcessStatus;
}

interface LaunchOptions {
  workingDirectory?: string;
  environment?: Record<string, string>;
  captureOutput?: boolean;
  sessionId?: string;
  timeout?: number;
  maxBufferSize?: number;
}

interface CapturedProcess {
  pid: number;
  processId: string;
  command: string[];
  startTime: Date;
  
  // Streams
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  
  // Control
  kill(signal?: string): Promise<void>;
  wait(): Promise<number>;
  
  // Events
  on(event: 'exit' | 'error' | 'spawn', listener: (...args: any[]) => void): void;
}
```

#### Implementation Details

```typescript
class CLIProcessLauncher implements ProcessLauncher {
  private processes = new Map<string, CapturedProcess>();
  private outputInterceptor: OutputInterceptor;
  
  constructor(private config: LauncherConfig) {
    this.outputInterceptor = new OutputInterceptor(config.interceptorOptions);
  }
  
  async launch(command: string[], options: LaunchOptions): Promise<CapturedProcess> {
    const processId = generateId('process');
    
    // Prepare environment
    const env = {
      ...process.env,
      ...options.environment,
      // Flag to indicate web mode
      CLAUDE_FLOW_WEB_MODE: 'true',
      CLAUDE_FLOW_SESSION_ID: options.sessionId || 'default',
      CLAUDE_FLOW_PROCESS_ID: processId,
    };
    
    // Spawn process with captured streams
    const childProcess = spawn(command[0], command.slice(1), {
      cwd: options.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'], // Capture all streams
      detached: false,
    });
    
    // Create captured process wrapper
    const captured = new CapturedProcessImpl(
      childProcess,
      processId,
      command,
      this.outputInterceptor
    );
    
    this.processes.set(processId, captured);
    
    // Setup cleanup on exit
    captured.on('exit', () => {
      this.processes.delete(processId);
    });
    
    return captured;
  }
}
```

### Process Lifecycle Management

```typescript
interface ProcessLifecycle {
  // Graceful shutdown sequence
  shutdown(): Promise<void>;
  
  // Handle process crashes
  handleCrash(process: CapturedProcess, error: Error): Promise<void>;
  
  // Restart failed processes
  restart(processId: string): Promise<CapturedProcess>;
  
  // Cleanup resources
  cleanup(processId: string): Promise<void>;
}
```

## Output Interceptor

### Stream Capture Architecture

The Output Interceptor captures stdout/stderr in real-time while maintaining the original CLI behavior.

#### Core Interface

```typescript
interface OutputInterceptor {
  // Capture output from process streams
  captureStream(
    stream: NodeJS.ReadableStream, 
    type: 'stdout' | 'stderr',
    processId: string
  ): InterceptedStream;
  
  // Apply output filtering
  filterOutput(data: Buffer, rules: FilterRule[]): Buffer;
  
  // Buffer output for history
  bufferOutput(processId: string, data: Buffer, type: StreamType): void;
  
  // Get buffered output
  getBufferedOutput(processId: string): BufferedOutput;
}

interface InterceptedStream {
  processId: string;
  type: 'stdout' | 'stderr';
  stream: NodeJS.ReadableStream;
  
  // Event emitters for real-time updates
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}
```

#### Implementation

```typescript
class OutputInterceptor {
  private buffers = new Map<string, CircularBuffer>();
  private filters: FilterRule[] = [];
  private streamMultiplexer: StreamMultiplexer;
  
  constructor(private config: InterceptorConfig) {
    this.streamMultiplexer = new StreamMultiplexer();
    this.loadFilterRules();
  }
  
  captureStream(
    stream: NodeJS.ReadableStream,
    type: 'stdout' | 'stderr',
    processId: string
  ): InterceptedStream {
    const intercepted = new InterceptedStreamImpl(processId, type);
    
    // Create transform stream for filtering and buffering
    const transform = new Transform({
      transform: (chunk: Buffer, encoding, callback) => {
        // Apply filters
        const filtered = this.filterOutput(chunk, this.filters);
        
        // Buffer for history
        this.bufferOutput(processId, filtered, type);
        
        // Emit to multiplexer for real-time streaming
        this.streamMultiplexer.emit(processId, type, filtered);
        
        // Pass through to original stream
        callback(null, filtered);
      }
    });
    
    // Pipe original stream through transform
    stream.pipe(transform);
    intercepted.setStream(transform);
    
    return intercepted;
  }
  
  private loadFilterRules(): void {
    this.filters = [
      // Filter API keys and secrets
      {
        pattern: /api[_-]?key\s*[=:]\s*["\']?([a-zA-Z0-9]+)["\']?/gi,
        replacement: 'API_KEY=***FILTERED***',
        sensitive: true
      },
      // Filter authentication tokens
      {
        pattern: /(?:token|auth|bearer)\s*[=:]\s*["\']?([a-zA-Z0-9-._~+/]+=*)["\']?/gi,
        replacement: 'TOKEN=***FILTERED***',
        sensitive: true
      },
      // Filter passwords
      {
        pattern: /password\s*[=:]\s*["\']?([^"\s]+)["\']?/gi,
        replacement: 'PASSWORD=***FILTERED***',
        sensitive: true
      }
    ];
  }
}
```

### Circular Buffer Implementation

```typescript
class CircularBuffer {
  private buffer: Buffer[];
  private head = 0;
  private tail = 0;
  private size = 0;
  
  constructor(private maxSize: number) {
    this.buffer = new Array(maxSize);
  }
  
  push(data: Buffer): void {
    this.buffer[this.tail] = data;
    this.tail = (this.tail + 1) % this.maxSize;
    
    if (this.size < this.maxSize) {
      this.size++;
    } else {
      this.head = (this.head + 1) % this.maxSize;
    }
  }
  
  getAll(): Buffer[] {
    const result: Buffer[] = [];
    for (let i = 0; i < this.size; i++) {
      const index = (this.head + i) % this.maxSize;
      result.push(this.buffer[index]);
    }
    return result;
  }
  
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }
}
```

## Stream Manager

### Multi-Client Streaming

The Stream Manager handles distributing output to multiple web clients efficiently.

#### Core Interface

```typescript
interface StreamManager {
  // Register new client
  addClient(clientId: string, socket: WebSocket): void;
  
  // Remove client
  removeClient(clientId: string): void;
  
  // Broadcast to all clients
  broadcast(processId: string, type: StreamType, data: Buffer): void;
  
  // Send to specific client
  sendToClient(clientId: string, message: StreamMessage): void;
  
  // Get client list
  getClients(): string[];
  
  // Client management
  manageClient(clientId: string): ClientManager;
}

interface StreamMessage {
  type: 'output' | 'error' | 'status' | 'complete';
  processId: string;
  streamType: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
  sequence: number;
  metadata?: Record<string, any>;
}
```

#### Implementation

```typescript
class StreamManager {
  private clients = new Map<string, ClientConnection>();
  private messageQueue = new Map<string, StreamMessage[]>();
  private sequenceNumbers = new Map<string, number>();
  
  constructor(private config: StreamConfig) {}
  
  addClient(clientId: string, socket: WebSocket): void {
    const connection = new ClientConnection(clientId, socket);
    this.clients.set(clientId, connection);
    
    // Send buffered messages
    this.sendBufferedMessages(clientId);
    
    // Setup event handlers
    connection.on('disconnect', () => {
      this.removeClient(clientId);
    });
  }
  
  broadcast(processId: string, type: StreamType, data: Buffer): void {
    const message: StreamMessage = {
      type: 'output',
      processId,
      streamType: type,
      data: data.toString('utf8'),
      timestamp: Date.now(),
      sequence: this.getNextSequence(processId),
    };
    
    // Buffer message for late-joining clients
    this.bufferMessage(processId, message);
    
    // Send to all connected clients
    for (const [clientId, connection] of this.clients) {
      if (connection.isActive()) {
        this.sendToClient(clientId, message);
      }
    }
  }
  
  private sendBufferedMessages(clientId: string): void {
    const connection = this.clients.get(clientId);
    if (!connection) return;
    
    // Send buffered messages for all active processes
    for (const [processId, messages] of this.messageQueue) {
      for (const message of messages) {
        connection.send(message);
      }
    }
  }
  
  private bufferMessage(processId: string, message: StreamMessage): void {
    if (!this.messageQueue.has(processId)) {
      this.messageQueue.set(processId, []);
    }
    
    const buffer = this.messageQueue.get(processId)!;
    buffer.push(message);
    
    // Keep only recent messages
    if (buffer.length > this.config.maxBufferSize) {
      buffer.shift();
    }
  }
}
```

### Message Batching and Compression

```typescript
interface MessageBatcher {
  // Batch messages for efficiency
  batchMessages(messages: StreamMessage[]): BatchedMessage;
  
  // Compress large messages
  compressMessage(message: StreamMessage): CompressedMessage;
  
  // Handle message priorities
  prioritizeMessages(messages: StreamMessage[]): StreamMessage[];
}

interface BatchedMessage {
  type: 'batch';
  messages: StreamMessage[];
  timestamp: number;
  count: number;
  compressed?: boolean;
}
```

## State Management

### CLI State Synchronization

The State Manager ensures that CLI state is properly synchronized with web clients.

#### Core Interface

```typescript
interface StateManager {
  // Sync CLI state with web clients
  syncState(processId: string): Promise<CLIState>;
  
  // Update state from CLI
  updateFromCLI(processId: string, state: Partial<CLIState>): void;
  
  // Get current state
  getCurrentState(processId: string): CLIState;
  
  // State persistence
  persistState(processId: string): Promise<void>;
  restoreState(processId: string): Promise<CLIState>;
}

interface CLIState {
  processId: string;
  sessionId: string;
  workingDirectory: string;
  environment: Record<string, string>;
  
  // Agent states
  agents: AgentState[];
  
  // Task states  
  tasks: TaskState[];
  
  // Memory bank state
  memoryBank: MemoryBankState;
  
  // Configuration
  config: ConfigState;
  
  // Runtime info
  startTime: Date;
  lastUpdate: Date;
  status: 'running' | 'completed' | 'failed' | 'stopped';
}

interface AgentState {
  id: string;
  name: string;
  type: string;
  status: 'idle' | 'busy' | 'completed' | 'failed';
  currentTask?: string;
  progress?: number;
  lastActivity: Date;
}
```

#### Implementation

```typescript
class StateManager {
  private states = new Map<string, CLIState>();
  private persistenceManager: PersistenceManager;
  private changeListeners = new Map<string, StateChangeListener[]>();
  
  constructor(private config: StateConfig) {
    this.persistenceManager = new PersistenceManager(config.persistenceOptions);
  }
  
  async syncState(processId: string): Promise<CLIState> {
    const state = this.states.get(processId);
    if (!state) {
      throw new Error(`No state found for process ${processId}`);
    }
    
    // Fetch latest state from CLI process
    const updated = await this.fetchStateFromCLI(processId);
    
    // Merge states
    const merged = this.mergeStates(state, updated);
    this.states.set(processId, merged);
    
    // Notify listeners
    this.notifyStateChange(processId, merged);
    
    return merged;
  }
  
  private async fetchStateFromCLI(processId: string): Promise<Partial<CLIState>> {
    // Implementation depends on CLI integration method
    // Options:
    // 1. File-based state sharing
    // 2. IPC communication
    // 3. Memory-mapped files
    // 4. REST API endpoint
    
    // For now, use file-based approach
    const stateFile = path.join(
      this.config.stateDirectory,
      `${processId}.state.json`
    );
    
    try {
      const data = await fs.readFile(stateFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // State file may not exist yet
      return {};
    }
  }
  
  private notifyStateChange(processId: string, state: CLIState): void {
    const listeners = this.changeListeners.get(processId) || [];
    for (const listener of listeners) {
      listener(state);
    }
  }
}
```

## Integration with Existing CLI

### Minimal Integration Points

To maintain backward compatibility, integration with the existing CLI is minimal and non-intrusive.

#### Environment Variable Detection

```typescript
// In existing CLI code (minimal addition)
const isWebMode = process.env.CLAUDE_FLOW_WEB_MODE === 'true';
const sessionId = process.env.CLAUDE_FLOW_SESSION_ID;
const processId = process.env.CLAUDE_FLOW_PROCESS_ID;

if (isWebMode) {
  // Initialize web mode hooks
  initializeWebModeHooks(sessionId, processId);
}
```

#### State Export Hooks

```typescript
// Minimal hooks in orchestrator.ts
export class Orchestrator implements IOrchestrator {
  // ... existing code ...
  
  private async notifyWebClients(event: string, data: any): Promise<void> {
    if (process.env.CLAUDE_FLOW_WEB_MODE === 'true') {
      const stateFile = path.join(
        process.env.CLAUDE_FLOW_STATE_DIR || './tmp',
        `${process.env.CLAUDE_FLOW_PROCESS_ID}.state.json`
      );
      
      const state = {
        event,
        data,
        timestamp: new Date().toISOString(),
        ...this.getCurrentState()
      };
      
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    }
  }
  
  async spawnAgent(profile: AgentProfile): Promise<string> {
    const agentId = await this.originalSpawnAgent(profile);
    
    // Notify web clients
    await this.notifyWebClients('agent_spawned', { agentId, profile });
    
    return agentId;
  }
}
```

### Configuration Integration

```typescript
// Extend existing config to support web mode
interface WebConfig {
  enabled: boolean;
  port: number;
  host: string;
  
  // Output capture settings
  capture: {
    bufferSize: number;
    filterRules: FilterRule[];
    compression: boolean;
  };
  
  // Streaming settings
  streaming: {
    batchSize: number;
    batchTimeout: number;
    maxClients: number;
  };
  
  // Security settings
  security: {
    allowedOrigins: string[];
    maxUploadSize: number;
    rateLimiting: RateLimit;
  };
}
```

## Error Handling and Recovery

### Robust Error Handling

```typescript
interface ErrorHandler {
  // Handle process crashes
  handleProcessCrash(processId: string, error: Error): Promise<void>;
  
  // Handle stream errors
  handleStreamError(streamId: string, error: Error): Promise<void>;
  
  // Handle client disconnections
  handleClientDisconnect(clientId: string): Promise<void>;
  
  // Recovery strategies
  recoverProcess(processId: string): Promise<boolean>;
  recoverStream(streamId: string): Promise<boolean>;
}

class ErrorHandler {
  async handleProcessCrash(processId: string, error: Error): Promise<void> {
    logger.error('Process crashed', { processId, error });
    
    // Notify clients
    this.streamManager.broadcast(processId, 'stderr', 
      Buffer.from(`Process crashed: ${error.message}\n`)
    );
    
    // Attempt recovery if configured
    if (this.config.autoRecover) {
      await this.recoverProcess(processId);
    }
  }
  
  async recoverProcess(processId: string): Promise<boolean> {
    try {
      // Get process configuration
      const config = this.processConfigs.get(processId);
      if (!config) return false;
      
      // Restart process
      const newProcess = await this.processLauncher.launch(
        config.command,
        config.options
      );
      
      // Update process mapping
      this.updateProcessMapping(processId, newProcess);
      
      logger.info('Process recovered successfully', { processId });
      return true;
    } catch (error) {
      logger.error('Process recovery failed', { processId, error });
      return false;
    }
  }
}
```

## Performance Optimizations

### Streaming Optimizations

```typescript
interface StreamOptimizer {
  // Compress output streams
  compressStream(stream: NodeJS.ReadableStream): NodeJS.ReadableStream;
  
  // Batch small messages
  batchMessages(messages: StreamMessage[]): BatchedMessage[];
  
  // Throttle high-frequency output
  throttleOutput(stream: NodeJS.ReadableStream, rate: number): NodeJS.ReadableStream;
}

class StreamOptimizer {
  compressStream(stream: NodeJS.ReadableStream): NodeJS.ReadableStream {
    return stream.pipe(createGzip());
  }
  
  throttleOutput(stream: NodeJS.ReadableStream, rate: number): NodeJS.ReadableStream {
    let lastEmit = 0;
    
    return new Transform({
      transform(chunk, encoding, callback) {
        const now = Date.now();
        if (now - lastEmit >= rate) {
          lastEmit = now;
          callback(null, chunk);
        } else {
          // Buffer for later
          setTimeout(() => callback(null, chunk), rate - (now - lastEmit));
        }
      }
    });
  }
}
```

### Memory Management

```typescript
interface MemoryManager {
  // Monitor memory usage
  getMemoryUsage(): MemoryUsage;
  
  // Clean up old buffers
  cleanupBuffers(maxAge: number): void;
  
  // Limit buffer sizes
  limitBufferSize(processId: string, maxSize: number): void;
}

interface MemoryUsage {
  total: number;
  used: number;
  buffers: number;
  streams: number;
  processes: number;
}
```

## Testing Strategy

### Unit Tests

```typescript
describe('OutputInterceptor', () => {
  test('should capture stdout correctly', async () => {
    const interceptor = new OutputInterceptor();
    const mockStream = new MockReadableStream();
    
    const captured = interceptor.captureStream(mockStream, 'stdout', 'test-process');
    
    // Simulate output
    mockStream.emit('data', Buffer.from('Hello World\n'));
    
    // Verify capture
    expect(captured.getBufferedOutput()).toContain('Hello World\n');
  });
  
  test('should filter sensitive information', () => {
    const interceptor = new OutputInterceptor();
    const input = Buffer.from('API_KEY=secret123 PASSWORD=mypass');
    
    const filtered = interceptor.filterOutput(input, interceptor.getDefaultFilters());
    
    expect(filtered.toString()).toContain('***FILTERED***');
    expect(filtered.toString()).not.toContain('secret123');
  });
});
```

### Integration Tests

```typescript
describe('CLI Integration', () => {
  test('should capture output from real CLI process', async () => {
    const launcher = new CLIProcessLauncher();
    const process = await launcher.launch(['node', '--version']);
    
    let output = '';
    process.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    
    await process.wait();
    
    expect(output).toMatch(/v\d+\.\d+\.\d+/);
  });
});
```

## Summary

This CLI output capture and streaming system provides:

1. **Real-time Output Streaming**: Sub-50ms latency for live CLI output
2. **Non-intrusive Integration**: Minimal changes to existing CLI code
3. **Multi-client Support**: Efficient broadcasting to multiple web clients
4. **Robust Error Handling**: Graceful failure recovery and process management
5. **Security**: Output filtering and access control
6. **Performance**: Optimized streaming with compression and batching
7. **Backward Compatibility**: Existing CLI functionality unchanged

The architecture ensures that the web UI can provide a real-time console experience while maintaining the full functionality and reliability of the existing claude-flow CLI system.