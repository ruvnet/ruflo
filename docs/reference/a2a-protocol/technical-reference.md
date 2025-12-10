# A2A Protocol Technical Reference

## Overview

This document provides the detailed technical reference for integrating the official Agent2Agent (A2A) Protocol with Claude-Flow infrastructure. The reference includes architecture diagrams, API definitions, data structures, implementation details, and performance optimization strategies.

## Architecture Overview

### Current Architecture (Before Refactoring)
```
┌─────────────────────────────────────────────────────────────┐
│                    Claude-Flow Architecture                 │
├─────────────────────────────────────────────────────────────┤
│  Communication Systems (4 overlapping)                     │
│  ├── SwarmCommunication (10 message types, 5 protocols)    │
│  ├── MessageBus (channel-based, priority queues)          │
│  ├── Hive-Mind Communication (database persistence)       │
│  └── Agent Communication (direct messaging)               │
├─────────────────────────────────────────────────────────────┤
│  Memory Systems (4 overlapping)                            │
│  ├── CollectiveMemory (distributed, pattern recognition)  │
│  ├── Memory (Hive-Mind) (high-performance cache)          │
│  ├── Agent Memory (local with MCP persistence)            │
│  └── DatabaseManager (persistent storage)                 │
├─────────────────────────────────────────────────────────────┤
│  Event Systems (3 overlapping)                             │
│  ├── SwarmEvent (20+ event types, routing)               │
│  ├── SwarmCoordinator (central coordination)              │
│  └── EventEmitter (base event system)                     │
└─────────────────────────────────────────────────────────────┘
```

### Target Architecture (After Refactoring)
```
┌─────────────────────────────────────────────────────────────┐
│                A2A-Compliant Architecture                   │
├─────────────────────────────────────────────────────────────┤
│  A2A Protocol Handler (Unified System)                     │
│  ├── Core A2A Methods (sendMessage, getTask, cancelTask)    │
│  ├── Optional A2A Methods (streaming, push notifications) │
│  └── Claude-Flow Extensions (memory, events, swarm)        │
├─────────────────────────────────────────────────────────────┤
│  Transport Layer (3 protocols)                             │
│  ├── JSON-RPC 2.0 over HTTP(S)                            │
│  ├── gRPC over HTTP/2 with TLS                            │
│  └── HTTP+JSON/REST                                       │
├─────────────────────────────────────────────────────────────┤
│  Agent Discovery (A2A Agent Cards)                        │
│  ├── Well-known URI discovery                              │
│  ├── Agent capability description                          │
│  └── Claude-Flow extensions                               │
├─────────────────────────────────────────────────────────────┤
│  Unified Communication (A2A Messages & Tasks)             │
│  ├── Message (role, parts, metadata)                      │
│  ├── Task (lifecycle, artifacts, history)                 │
│  └── Streaming (SSE, push notifications)                  │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. A2A Protocol Handler

#### Interface Definition
```typescript
interface A2AProtocolHandler {
  // Core A2A Protocol methods
  sendMessage(params: MessageSendParams): Promise<Task | Message>;
  getTask(params: TaskQueryParams): Promise<Task>;
  cancelTask(params: TaskIdParams): Promise<Task>;
  
  // Optional A2A methods
  streamMessage?(params: MessageSendParams): Promise<StreamResponse>;
  resubscribeTask?(params: TaskIdParams): Promise<StreamResponse>;
  setPushNotificationConfig?(params: TaskPushNotificationConfig): Promise<TaskPushNotificationConfig>;
  getPushNotificationConfig?(params: GetTaskPushNotificationConfigParams): Promise<TaskPushNotificationConfig>;
  listPushNotificationConfigs?(params: ListTaskPushNotificationConfigParams): Promise<TaskPushNotificationConfig[]>;
  deletePushNotificationConfig?(params: DeleteTaskPushNotificationConfigParams): Promise<void>;
  getAuthenticatedExtendedCard?(): Promise<AgentCard>;
  
  // Claude-Flow extensions
  storeMemory?(key: string, value: any, namespace?: string): Promise<void>;
  retrieveMemory?(key: string, namespace?: string): Promise<any>;
  emitEvent?(event: ClaudeFlowEvent): Promise<void>;
}
```

#### Implementation
```typescript
class ClaudeFlowA2AHandler implements A2AProtocolHandler {
  private messageBus: MessageBus;
  private memorySystem: DistributedMemorySystem;
  private eventBus: EventBus;
  private swarmCoordinator: SwarmCoordinator;
  private transportManager: A2ATransportManager;
  private agentCardGenerator: A2AAgentCardGenerator;
  
  constructor(config: ClaudeFlowA2AConfig) {
    this.messageBus = new MessageBus(config.messageBus);
    this.memorySystem = new DistributedMemorySystem(config.memory);
    this.eventBus = new EventBus(config.eventBus);
    this.swarmCoordinator = new SwarmCoordinator(config.swarm);
    this.transportManager = new A2ATransportManager(config.transports);
    this.agentCardGenerator = new A2AAgentCardGenerator(config.agentCards);
  }
  
  async sendMessage(params: MessageSendParams): Promise<Task | Message> {
    // Validate A2A message format
    const a2aMessage = this.validateA2AMessage(params.message);
    
    // Process through Claude-Flow pipeline
    const claudeFlowContext = await this.createClaudeFlowContext(a2aMessage);
    const result = await this.processThroughClaudeFlow(a2aMessage, claudeFlowContext);
    
    // Return A2A-compliant response
    return this.formatA2AResponse(result);
  }
  
  async getTask(params: TaskQueryParams): Promise<Task> {
    const task = await this.taskManager.getTask(params.id);
    const enhancedTask = await this.enhanceTaskWithClaudeFlowData(task);
    return enhancedTask;
  }
  
  async cancelTask(params: TaskIdParams): Promise<Task> {
    const task = await this.taskManager.cancelTask(params.id);
    return this.formatA2AResponse(task);
  }
  
  // Claude-Flow specific extensions
  async storeMemory(key: string, value: any, namespace?: string): Promise<void> {
    return this.memorySystem.store(key, value, namespace);
  }
  
  async retrieveMemory(key: string, namespace?: string): Promise<any> {
    return this.memorySystem.retrieve(key, namespace);
  }
  
  async emitEvent(event: ClaudeFlowEvent): Promise<void> {
    return this.eventBus.emit(event.type, event.data);
  }
}
```

### 2. Transport Layer

#### Transport Protocol Interface
```typescript
interface A2ATransport {
  sendMessage(message: Message, endpoint: string): Promise<Response>;
  streamMessage(message: Message, endpoint: string): Promise<StreamResponse>;
  getSupportedMethods(): string[];
  getCapabilities(): TransportCapabilities;
}
```

#### JSON-RPC 2.0 Transport
```typescript
class JSONRPCTransport implements A2ATransport {
  async sendMessage(message: Message, endpoint: string): Promise<Response> {
    const jsonRpcRequest: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: generateId(),
      method: this.mapMessageToMethod(message),
      params: this.mapMessageToParams(message)
    };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader()
      },
      body: JSON.stringify(jsonRpcRequest)
    });
    
    return this.parseJSONRPCResponse(response);
  }
  
  async streamMessage(message: Message, endpoint: string): Promise<StreamResponse> {
    const jsonRpcRequest: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: generateId(),
      method: "message/stream",
      params: this.mapMessageToParams(message)
    };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader()
      },
      body: JSON.stringify(jsonRpcRequest)
    });
    
    return this.createStreamResponse(response);
  }
  
  private mapMessageToMethod(message: Message): string {
    // Map A2A message to JSON-RPC method
    if (message.taskId) {
      return "message/send"; // Continue existing task
    } else {
      return "message/send"; // Start new task
    }
  }
  
  private mapMessageToParams(message: Message): any {
    return {
      message: message,
      configuration: {
        acceptedOutputModes: ["application/json", "text/plain"],
        historyLength: 10,
        blocking: false
      }
    };
  }
}
```

#### gRPC Transport
```typescript
class GRPCTransport implements A2ATransport {
  private client: A2AServiceClient;
  
  constructor(endpoint: string) {
    this.client = new A2AServiceClient(endpoint, {
      'grpc.keepalive_time_ms': 30000,
      'grpc.keepalive_timeout_ms': 5000,
      'grpc.keepalive_permit_without_calls': true,
      'grpc.http2.max_pings_without_data': 0,
      'grpc.http2.min_time_between_pings_ms': 10000,
      'grpc.http2.min_ping_interval_without_data_ms': 300000
    });
  }
  
  async sendMessage(message: Message, endpoint: string): Promise<Response> {
    const request = new SendMessageRequest({
      message: this.mapMessageToProto(message),
      configuration: this.mapConfigurationToProto(message)
    });
    
    const response = await this.client.sendMessage(request);
    return this.mapProtoToResponse(response);
  }
  
  async streamMessage(message: Message, endpoint: string): Promise<StreamResponse> {
    const request = new SendMessageRequest({
      message: this.mapMessageToProto(message),
      configuration: this.mapConfigurationToProto(message)
    });
    
    const stream = this.client.sendStreamingMessage(request);
    return this.createStreamResponse(stream);
  }
  
  private mapMessageToProto(message: Message): Message {
    return new Message({
      role: message.role,
      parts: message.parts.map(part => this.mapPartToProto(part)),
      messageId: message.messageId,
      taskId: message.taskId,
      contextId: message.contextId,
      metadata: message.metadata,
      extensions: message.extensions,
      referenceTaskIds: message.referenceTaskIds
    });
  }
}
```

#### HTTP+JSON/REST Transport
```typescript
class HTTPJSONTransport implements A2ATransport {
  async sendMessage(message: Message, endpoint: string): Promise<Response> {
    const url = `${endpoint}/v1/message:send`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader()
      },
      body: JSON.stringify({
        message: message,
        configuration: {
          acceptedOutputModes: ["application/json", "text/plain"],
          historyLength: 10,
          blocking: false
        }
      })
    });
    
    return this.parseHTTPResponse(response);
  }
  
  async streamMessage(message: Message, endpoint: string): Promise<StreamResponse> {
    const url = `${endpoint}/v1/message:stream`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader()
      },
      body: JSON.stringify({
        message: message,
        configuration: {
          acceptedOutputModes: ["application/json", "text/plain"],
          historyLength: 10,
          blocking: false
        }
      })
    });
    
    return this.createStreamResponse(response);
  }
  
  async getTask(taskId: string, endpoint: string): Promise<Task> {
    const url = `${endpoint}/v1/tasks/${taskId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.getAuthHeader()
      }
    });
    
    return this.parseTaskResponse(response);
  }
  
  async cancelTask(taskId: string, endpoint: string): Promise<Task> {
    const url = `${endpoint}/v1/tasks/${taskId}:cancel`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.getAuthHeader()
      },
      body: JSON.stringify({})
    });
    
    return this.parseTaskResponse(response);
  }
}
```

### 3. Agent Discovery

#### Agent Card Structure
```typescript
interface ClaudeFlowAgentCard extends AgentCard {
  // Official A2A fields
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport?: TransportProtocol;
  additionalInterfaces?: AgentInterface[];
  iconUrl?: string;
  provider?: AgentProvider;
  version: string;
  documentationUrl?: string;
  capabilities: AgentCapabilities;
  securitySchemes?: {[scheme: string]: SecurityScheme};
  security?: {[scheme: string]: string[]}[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  supportsAuthenticatedExtendedCard?: boolean;
  signatures?: AgentCardSignature[];
  
  // Claude-Flow extensions
  claudeFlowVersion: string;
  swarmCapabilities: SwarmCapabilities;
  memoryIntegration: MemoryConfig;
  performanceMetrics: PerformanceConfig;
  agentType: ClaudeFlowAgentType;
  swarmId?: string;
  region?: string;
  environment?: string;
  supportsSwarmCoordination: boolean;
  supportsMemorySharing: boolean;
  supportsEventStreaming: boolean;
  supportsMCPIntegration: boolean;
}
```

#### Agent Card Generator
```typescript
class A2AAgentCardGenerator {
  generateAgentCard(agent: ClaudeFlowAgent): ClaudeFlowAgentCard {
    return {
      // Official A2A fields
      protocolVersion: "0.3.0",
      name: agent.name,
      description: agent.description,
      url: agent.endpoint,
      preferredTransport: "JSONRPC",
      additionalInterfaces: [
        { url: agent.grpcEndpoint, transport: "GRPC" },
        { url: agent.restEndpoint, transport: "HTTP+JSON" }
      ],
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
        extensions: [
          {
            uri: "https://claude-flow.dev/memory-integration",
            description: "Claude-Flow memory integration",
            required: false
          },
          {
            uri: "https://claude-flow.dev/swarm-coordination",
            description: "Claude-Flow swarm coordination",
            required: false
          }
        ]
      },
      skills: this.mapSkills(agent.skills),
      defaultInputModes: ["application/json", "text/plain"],
      defaultOutputModes: ["application/json", "text/plain"],
      
      // Claude-Flow extensions
      claudeFlowVersion: "2.0.0",
      agentType: agent.type,
      swarmCapabilities: agent.swarmCapabilities,
      memoryIntegration: agent.memoryConfig,
      performanceMetrics: agent.performanceConfig,
      supportsSwarmCoordination: true,
      supportsMemorySharing: true,
      supportsEventStreaming: true,
      supportsMCPIntegration: true
    };
  }
  
  private mapSkills(agentSkills: AgentSkill[]): AgentSkill[] {
    return agentSkills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      examples: skill.examples,
      inputModes: skill.inputModes || ["application/json", "text/plain"],
      outputModes: skill.outputModes || ["application/json", "text/plain"]
    }));
  }
}
```

### 4. Communication Consolidation

#### Communication Consolidator
```typescript
class CommunicationConsolidator {
  // Map current message types to A2A Parts
  mapMessageToA2A(currentMessage: SwarmMessage): Message {
    return {
      role: currentMessage.fromAgentId ? "agent" : "user",
      parts: this.convertContentToParts(currentMessage.content),
      messageId: currentMessage.id,
      taskId: currentMessage.taskId,
      contextId: currentMessage.swarmId,
      metadata: {
        originalType: currentMessage.type,
        priority: currentMessage.priority,
        reliability: currentMessage.reliability
      },
      kind: "message"
    };
  }
  
  private convertContentToParts(content: any): Part[] {
    if (typeof content === 'string') {
      return [{ kind: "text", text: content }];
    } else if (content instanceof Buffer || content instanceof Uint8Array) {
      return [{ 
        kind: "file", 
        file: { 
          bytes: Buffer.from(content).toString('base64'),
          mimeType: 'application/octet-stream'
        } 
      }];
    } else {
      return [{ kind: "data", data: content }];
    }
  }
  
  // Map routing strategies to A2A transport
  mapRoutingToA2A(strategy: CommunicationStrategy): TransportProtocol {
    switch(strategy) {
      case 'direct': return 'JSONRPC';
      case 'broadcast': return 'HTTP+JSON';
      case 'publish-subscribe': return 'GRPC';
      case 'request-response': return 'JSONRPC';
      case 'event-driven': return 'GRPC';
      case 'gossip': return 'HTTP+JSON';
      case 'hierarchical': return 'JSONRPC';
      default: return 'JSONRPC';
    }
  }
  
  // Consolidate priority systems
  mapPriorityToA2A(priority: MessagePriority): A2APriority {
    switch(priority) {
      case 'urgent': return 'high';
      case 'high': return 'normal';
      case 'normal': return 'normal';
      case 'low': return 'low';
    }
  }
}
```

#### Unified Communication System
```typescript
class UnifiedCommunicationSystem {
  private a2aHandler: ClaudeFlowA2AHandler;
  private consolidator: CommunicationConsolidator;
  
  constructor() {
    this.a2aHandler = new ClaudeFlowA2AHandler();
    this.consolidator = new CommunicationConsolidator();
  }
  
  async sendMessage(
    type: string,
    content: any,
    sender: AgentId,
    receivers: AgentId | AgentId[],
    options: MessageOptions = {}
  ): Promise<string> {
    // Convert to A2A format
    const a2aMessage = this.consolidator.mapMessageToA2A({
      id: generateId(),
      type,
      content,
      fromAgentId: sender.id,
      toAgentId: Array.isArray(receivers) ? receivers[0].id : receivers.id,
      swarmId: options.swarmId || 'default',
      priority: options.priority || 'normal',
      reliability: options.reliability || 'best-effort',
      timestamp: new Date()
    });
    
    // Send via A2A protocol
    const result = await this.a2aHandler.sendMessage({
      message: a2aMessage,
      configuration: {
        acceptedOutputModes: options.outputModes || ['application/json'],
        historyLength: options.historyLength || 10,
        blocking: options.blocking || false
      }
    });
    
    return result.id;
  }
  
  async broadcastMessage(
    type: string,
    content: any,
    sender: AgentId,
    options: BroadcastOptions = {}
  ): Promise<string> {
    // Use A2A broadcast via HTTP+JSON transport
    const a2aMessage = this.consolidator.mapMessageToA2A({
      id: generateId(),
      type,
      content,
      fromAgentId: sender.id,
      toAgentId: null, // Broadcast
      swarmId: options.swarmId || 'default',
      priority: options.priority || 'normal',
      timestamp: new Date()
    });
    
    const result = await this.a2aHandler.sendMessage({
      message: a2aMessage,
      configuration: {
        acceptedOutputModes: ['application/json'],
        blocking: false
      }
    });
    
    return result.id;
  }
}
```

### 5. Memory Integration

#### Memory Integration Manager
```typescript
class MemoryIntegrationManager {
  private a2aHandler: ClaudeFlowA2AHandler;
  
  constructor() {
    this.a2aHandler = new ClaudeFlowA2AHandler();
  }
  
  // Integrate memory operations with A2A tasks
  async storeMemoryViaA2A(
    key: string, 
    value: any, 
    namespace?: string,
    options: MemoryOptions = {}
  ): Promise<void> {
    const task = await this.a2aHandler.sendMessage({
      message: {
        role: "agent",
        parts: [{
          kind: "data",
          data: { 
            action: "store", 
            key, 
            value, 
            namespace,
            options: {
              ttl: options.ttl,
              compression: options.compression,
              encryption: options.encryption
            }
          }
        }],
        messageId: generateId(),
        contextId: `memory-store-${namespace || 'default'}`,
        kind: "message"
      }
    });
    
    // Store as A2A task artifact
    await this.storeAsArtifact(task.id, { 
      key, 
      value, 
      namespace,
      timestamp: new Date(),
      metadata: options
    });
  }
  
  async retrieveMemoryViaA2A(
    key: string, 
    namespace?: string
  ): Promise<any> {
    const task = await this.a2aHandler.sendMessage({
      message: {
        role: "agent",
        parts: [{
          kind: "data",
          data: { 
            action: "retrieve", 
            key, 
            namespace 
          }
        }],
        messageId: generateId(),
        contextId: `memory-retrieve-${namespace || 'default'}`,
        kind: "message"
      }
    });
    
    // Extract from A2A task artifacts
    const artifacts = task.artifacts || [];
    const memoryArtifact = artifacts.find(a => 
      a.metadata?.action === 'retrieve' && 
      a.metadata?.key === key
    );
    
    return memoryArtifact ? memoryArtifact.parts[0].data.value : null;
  }
  
  // Map memory sharing to A2A context
  async shareMemoryViaA2A(
    fromAgent: string, 
    toAgent: string, 
    keys: string[],
    options: ShareOptions = {}
  ): Promise<void> {
    const message = {
      role: "agent",
      parts: [{
        kind: "data",
        data: { 
          action: "share", 
          fromAgent, 
          toAgent, 
          keys,
          options: {
            namespace: options.namespace,
            ttl: options.ttl,
            accessControl: options.accessControl
          }
        }
      }],
      messageId: generateId(),
      contextId: `memory-share-${fromAgent}-${toAgent}`,
      kind: "message"
    };
    
    await this.a2aHandler.sendMessage({ message });
  }
}
```

### 6. Event Unification

#### Event Unification Manager
```typescript
class EventUnificationManager {
  private a2aHandler: ClaudeFlowA2AHandler;
  
  constructor() {
    this.a2aHandler = new ClaudeFlowA2AHandler();
  }
  
  // Map current events to A2A task states
  mapEventToA2ATaskState(event: SwarmEvent): TaskState {
    switch(event.type) {
      case 'task.created': return 'submitted';
      case 'task.assigned': return 'submitted';
      case 'task.started': return 'working';
      case 'task.paused': return 'input-required';
      case 'task.resumed': return 'working';
      case 'task.completed': return 'completed';
      case 'task.failed': return 'failed';
      case 'task.cancelled': return 'canceled';
      case 'agent.error': return 'failed';
      case 'agent.heartbeat': return 'working';
      case 'swarm.created': return 'submitted';
      case 'swarm.started': return 'working';
      case 'swarm.completed': return 'completed';
      case 'swarm.failed': return 'failed';
      case 'swarm.cancelled': return 'canceled';
      default: return 'working';
    }
  }
  
  // Integrate event streaming with A2A
  async streamEventViaA2A(event: SwarmEvent): Promise<void> {
    const taskStatusUpdate: TaskStatusUpdateEvent = {
      taskId: event.data.taskId || generateId(),
      contextId: event.data.swarmId || 'default',
      status: {
        state: this.mapEventToA2ATaskState(event),
        message: {
          role: "agent",
          parts: [{
            kind: "text",
            text: `Event: ${event.type} - ${JSON.stringify(event.data)}`
          }],
          messageId: generateId(),
          kind: "message"
        },
        timestamp: event.timestamp.toISOString()
      },
      final: this.isTerminalEvent(event),
      kind: "status-update"
    };
    
    await this.a2aHandler.emitEvent(taskStatusUpdate);
  }
  
  private isTerminalEvent(event: SwarmEvent): boolean {
    const terminalEvents = [
      'task.completed', 'task.failed', 'task.cancelled',
      'swarm.completed', 'swarm.failed', 'swarm.cancelled'
    ];
    return terminalEvents.includes(event.type);
  }
}
```

## Data Structures

### A2A Message Structure
```typescript
interface Message {
  readonly role: "user" | "agent";
  parts: Part[];
  metadata?: {[key: string]: any};
  extensions?: string[];
  referenceTaskIds?: string[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  readonly kind: "message";
}

type Part = TextPart | FilePart | DataPart;

interface TextPart {
  readonly kind: "text";
  text: string;
  metadata?: {[key: string]: any};
}

interface FilePart {
  readonly kind: "file";
  file: FileWithBytes | FileWithUri;
  metadata?: {[key: string]: any};
}

interface DataPart {
  readonly kind: "data";
  data: {[key: string]: any};
  metadata?: {[key: string]: any};
}
```

### A2A Task Structure
```typescript
interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  history?: Message[];
  artifacts?: Artifact[];
  metadata?: {[key: string]: any};
  readonly kind: "task";
}

interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

enum TaskState {
  Submitted = "submitted",
  Working = "working",
  InputRequired = "input-required",
  Completed = "completed",
  Canceled = "canceled",
  Failed = "failed",
  Rejected = "rejected",
  AuthRequired = "auth-required",
  Unknown = "unknown"
}
```

### Claude-Flow Extensions
```typescript
interface ClaudeFlowEvent {
  type: string;
  data: any;
  timestamp: Date;
  source: string;
  correlationId?: string;
  causationId?: string;
}

interface MemoryOptions {
  ttl?: number;
  compression?: boolean;
  encryption?: boolean;
  namespace?: string;
}

interface ShareOptions {
  namespace?: string;
  ttl?: number;
  accessControl?: AccessControl[];
}
```

## API Endpoints

### A2A Protocol Endpoints
```
POST /v1/message:send          - Send message and initiate task
POST /v1/message:stream        - Send message with streaming
GET  /v1/tasks/{id}            - Get task status
POST /v1/tasks/{id}:cancel      - Cancel task
POST /v1/tasks/{id}:subscribe   - Resume task streaming
POST /v1/tasks/{id}/pushNotificationConfigs - Set push notification config
GET  /v1/tasks/{id}/pushNotificationConfigs/{configId} - Get push notification config
GET  /v1/tasks/{id}/pushNotificationConfigs - List push notification configs
DELETE /v1/tasks/{id}/pushNotificationConfigs/{configId} - Delete push notification config
GET  /v1/card                  - Get authenticated agent card
```

### Agent Discovery Endpoints
```
GET  /.well-known/agent-card.json - Agent Card discovery
GET  /v1/agents                  - List available agents
GET  /v1/agents/{id}             - Get agent details
POST /v1/agents                  - Register new agent
PUT  /v1/agents/{id}             - Update agent
DELETE /v1/agents/{id}           - Unregister agent
```

## Configuration

### A2A Handler Configuration
```typescript
interface ClaudeFlowA2AConfig {
  messageBus: MessageBusConfig;
  memory: DistributedMemoryConfig;
  eventBus: EventBusConfig;
  swarm: SwarmConfig;
  transports: TransportConfig;
  agentCards: AgentCardConfig;
}

interface TransportConfig {
  jsonrpc: {
    enabled: boolean;
    endpoint: string;
    timeout: number;
  };
  grpc: {
    enabled: boolean;
    endpoint: string;
    timeout: number;
    keepAlive: boolean;
  };
  httpJson: {
    enabled: boolean;
    endpoint: string;
    timeout: number;
  };
}

interface AgentCardConfig {
  discoveryPath: string;
  cacheTimeout: number;
  validationEnabled: boolean;
  signatureRequired: boolean;
}
```

## Error Handling

### A2A Error Codes
```typescript
enum A2AErrorCode {
  // Standard JSON-RPC errors
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  
  // A2A-specific errors
  TaskNotFound = -32001,
  TaskNotCancelable = -32002,
  PushNotificationNotSupported = -32003,
  UnsupportedOperation = -32004,
  ContentTypeNotSupported = -32005,
  InvalidAgentResponse = -32006,
  AuthenticatedExtendedCardNotConfigured = -32007
}

interface A2AError {
  code: A2AErrorCode;
  message: string;
  data?: any;
}
```

### Error Handling Strategy
```typescript
class A2AErrorHandler {
  handleError(error: Error, context: any): A2AError {
    if (error instanceof TaskNotFoundError) {
      return {
        code: A2AErrorCode.TaskNotFound,
        message: "Task not found",
        data: { taskId: context.taskId }
      };
    }
    
    if (error instanceof ValidationError) {
      return {
        code: A2AErrorCode.InvalidParams,
        message: "Invalid parameters",
        data: { validationErrors: error.details }
      };
    }
    
    return {
      code: A2AErrorCode.InternalError,
      message: "Internal server error",
      data: { originalError: error.message }
    };
  }
}
```

## Performance Optimization

### Caching Strategy
```typescript
class A2APerformanceOptimizer {
  private cache: Map<string, any> = new Map();
  private compressionEnabled: boolean = true;
  private batchSize: number = 100;
  
  async optimizeMessage(message: Message): Promise<Message> {
    // Compress large messages
    if (this.compressionEnabled && this.isLargeMessage(message)) {
      message = await this.compressMessage(message);
    }
    
    // Batch small messages
    if (this.shouldBatch(message)) {
      return this.addToBatch(message);
    }
    
    return message;
  }
  
  private isLargeMessage(message: Message): boolean {
    const size = JSON.stringify(message).length;
    return size > 1024; // 1KB threshold
  }
  
  private async compressMessage(message: Message): Promise<Message> {
    const compressed = await this.compress(JSON.stringify(message));
    return {
      ...message,
      metadata: {
        ...message.metadata,
        compressed: true,
        originalSize: JSON.stringify(message).length
      }
    };
  }
}
```

### Load Balancing
```typescript
class A2ALoadBalancer {
  private endpoints: string[] = [];
  private currentIndex: number = 0;
  
  getNextEndpoint(): string {
    const endpoint = this.endpoints[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    return endpoint;
  }
  
  async distributeMessage(message: Message): Promise<Response> {
    const endpoint = this.getNextEndpoint();
    return await this.sendToEndpoint(message, endpoint);
  }
}
```

## Security

### Authentication
```typescript
class A2AAuthentication {
  async authenticate(request: Request): Promise<AuthResult> {
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      throw new AuthenticationError("Missing authorization header");
    }
    
    const [scheme, token] = authHeader.split(' ');
    
    switch (scheme.toLowerCase()) {
      case 'bearer':
        return await this.validateBearerToken(token);
      case 'basic':
        return await this.validateBasicAuth(token);
      default:
        throw new AuthenticationError(`Unsupported auth scheme: ${scheme}`);
    }
  }
  
  private async validateBearerToken(token: string): Promise<AuthResult> {
    // Validate JWT token
    const payload = await this.jwt.verify(token);
    return {
      authenticated: true,
      user: payload.sub,
      permissions: payload.permissions
    };
  }
}
```

### Authorization
```typescript
class A2AAuthorization {
  async authorize(
    user: string, 
    action: string, 
    resource: string
  ): Promise<boolean> {
    const permissions = await this.getUserPermissions(user);
    return permissions.includes(`${action}:${resource}`);
  }
  
  async checkTaskAccess(user: string, taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId);
    return task.createdBy === user || this.hasPermission(user, 'read:task');
  }
}
```

## Monitoring and Observability

### Metrics Collection
```typescript
class A2AMetrics {
  private metrics: Map<string, number> = new Map();
  
  recordMessageSent(message: Message): void {
    this.increment('messages.sent');
    this.increment(`messages.sent.${message.role}`);
    this.recordLatency('message.send', Date.now() - message.timestamp.getTime());
  }
  
  recordTaskCompleted(task: Task): void {
    this.increment('tasks.completed');
    this.recordLatency('task.duration', task.completedAt.getTime() - task.createdAt.getTime());
  }
  
  private increment(key: string): void {
    this.metrics.set(key, (this.metrics.get(key) || 0) + 1);
  }
  
  private recordLatency(key: string, latency: number): void {
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, (current + latency) / 2); // Simple moving average
  }
}
```

### Health Checks
```typescript
class A2AHealthChecker {
  async checkHealth(): Promise<HealthStatus> {
    const checks = await Promise.all([
      this.checkTransportHealth(),
      this.checkMemoryHealth(),
      this.checkEventHealth(),
      this.checkSwarmHealth()
    ]);
    
    return {
      status: checks.every(c => c.healthy) ? 'healthy' : 'unhealthy',
      checks: checks,
      timestamp: new Date()
    };
  }
  
  private async checkTransportHealth(): Promise<HealthCheck> {
    try {
      await this.transportManager.ping();
      return { name: 'transport', healthy: true };
    } catch (error) {
      return { name: 'transport', healthy: false, error: error.message };
    }
  }
}
```

## Conclusion

This technical reference provides the detailed implementation guidance for integrating A2A protocol with Claude-Flow infrastructure. The reference covers:

1. **Architecture Design**: Clear separation of concerns with A2A compliance
2. **Component Implementation**: Detailed implementation of all core components
3. **Data Structures**: Complete type definitions for A2A protocol
4. **API Design**: RESTful endpoints following A2A specification
5. **Configuration**: Comprehensive configuration options
6. **Error Handling**: Robust error handling with A2A error codes
7. **Performance**: Optimization strategies for enterprise scale
8. **Security**: Authentication and authorization mechanisms
9. **Monitoring**: Observability and health checking

The implementation follows industry best practices and ensures full compliance with the official A2A Protocol specification while maintaining Claude-Flow's advanced enterprise capabilities.