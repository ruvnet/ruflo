# Abstract Subagent Architecture - API Documentation

## API Overview

The Abstract Subagent Architecture provides a comprehensive API for managing AI coding agents, coordinating multi-agent workflows, and integrating with various AI providers. The API is designed to be intuitive, consistent, and extensible.

## Authentication and Authorization

### Authentication Methods

#### 1. API Key Authentication
```typescript
const config = {
  authentication: {
    type: 'api_key',
    credentials: {
      apiKey: process.env.ANTHROPIC_API_KEY
    }
  }
};
```

#### 2. OAuth Authentication
```typescript
const config = {
  authentication: {
    type: 'oauth',
    credentials: {
      clientId: process.env.OAUTH_CLIENT_ID,
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      refreshToken: process.env.OAUTH_REFRESH_TOKEN
    }
  }
};
```

#### 3. Bearer Token Authentication
```typescript
const config = {
  authentication: {
    type: 'bearer_token',
    credentials: {
      token: process.env.BEARER_TOKEN
    }
  }
};
```

### Authorization

The system implements role-based access control with the following roles:

- **Admin**: Full system access
- **Agent Manager**: Agent creation and management
- **Task Executor**: Task execution and coordination
- **Viewer**: Read-only access

## Core API Interfaces

### AbstractCodingAgent Interface

The core interface that all AI coding agents must implement.

```typescript
interface AbstractCodingAgent {
  readonly id: string;
  readonly type: AgentType;
  readonly provider: AgentProvider;
  
  // Core lifecycle methods
  getCapabilities(): Promise<AgentCapabilities>;
  executeTask(task: CodingTask): Promise<CodingResult>;
  healthCheck(): Promise<AgentHealth>;
  configure(config: AgentConfiguration): Promise<void>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Status and monitoring
  getStatus(): Promise<AgentStatus>;
  getMetrics(): Promise<AgentMetrics>;
  
  // Communication
  sendMessage(to: AgentId, message: AgentMessage): Promise<void>;
  broadcastMessage(message: AgentMessage): Promise<void>;
  
  // Event handling
  onEvent(eventType: EventType, handler: EventHandler): void;
  offEvent(eventType: EventType, handler: EventHandler): void;
}
```

### AgentCoordinator Interface

Manages coordination between multiple agents.

```typescript
interface AgentCoordinator {
  // Agent management
  registerAgent(agent: AbstractCodingAgent): Promise<void>;
  unregisterAgent(agentId: AgentId): Promise<void>;
  getAgent(agentId: AgentId): Promise<AbstractCodingAgent | null>;
  listAgents(): Promise<AbstractCodingAgent[]>;
  
  // Task coordination
  coordinateTask(config: CoordinationConfig): Promise<CodingResult>;
  executeTask(task: CodingTask): Promise<CodingResult>;
  
  // Coordination strategies
  setCoordinationStrategy(strategy: CoordinationStrategy): void;
  getCoordinationStrategies(): CoordinationStrategy[];
  
  // Conflict resolution
  resolveConflict(conflict: ConflictReport): Promise<ConflictResolution>;
  getConflictHistory(): Promise<ConflictReport[]>;
  
  // Session management
  createSession(config: SessionConfig): Promise<CoordinationSession>;
  getSession(sessionId: string): Promise<CoordinationSession | null>;
  endSession(sessionId: string): Promise<void>;
}
```

### TaskDelegator Interface

Intelligently delegates tasks to appropriate agents.

```typescript
interface TaskDelegator {
  // Task delegation
  delegateTask(task: CodingTask): Promise<DelegationResult>;
  delegateTaskToAgent(task: CodingTask, agentId: AgentId): Promise<DelegationResult>;
  
  // Agent selection
  findSuitableAgents(task: CodingTask): Promise<DelegationCandidate[]>;
  selectBestAgent(candidates: DelegationCandidate[]): Promise<DelegationCandidate>;
  
  // Load balancing
  getLoadBalancingMetrics(): Promise<LoadBalancingMetrics>;
  updateLoadBalancingStrategy(strategy: LoadBalancingStrategy): void;
  
  // Task analysis
  analyzeTaskComplexity(task: CodingTask): Promise<TaskComplexityAnalysis>;
  estimateTaskDuration(task: CodingTask, agentId: AgentId): Promise<number>;
}
```

### AgentConfigManager Interface

Manages agent and provider configurations.

```typescript
interface AgentConfigManager {
  // Agent configuration
  createAgentConfig(
    agentId: string,
    provider: AgentProvider,
    config: Partial<AgentConfiguration>
  ): Promise<AgentConfiguration>;
  
  updateAgentConfig(
    agentId: string,
    updates: Partial<AgentConfiguration>
  ): Promise<AgentConfiguration>;
  
  getAgentConfig(agentId: string): Promise<AgentConfiguration | null>;
  deleteAgentConfig(agentId: string): Promise<void>;
  listAgentConfigs(): Promise<AgentConfiguration[]>;
  
  // Provider configuration
  registerProvider(config: ProviderConfig): Promise<void>;
  updateProviderConfig(
    providerId: string,
    updates: Partial<ProviderConfig>
  ): Promise<ProviderConfig>;
  
  getProviderConfig(providerId: string): Promise<ProviderConfig | null>;
  listProviderConfigs(): Promise<ProviderConfig[]>;
  
  // Configuration validation
  validateAgentConfig(config: AgentConfiguration): Promise<ValidationResult>;
  validateProviderConfig(config: ProviderConfig): Promise<ValidationResult>;
  
  // Configuration templates
  createConfigTemplate(
    name: string,
    template: AgentConfigTemplate
  ): Promise<void>;
  
  getConfigTemplate(name: string): Promise<AgentConfigTemplate | null>;
  listConfigTemplates(): Promise<AgentConfigTemplate[]>;
}
```

### ProviderRegistry Interface

Manages AI provider information and capabilities.

```typescript
interface ProviderRegistry {
  // Provider management
  registerProvider(config: ProviderConfig): Promise<void>;
  unregisterProvider(providerId: string): Promise<void>;
  getProvider(providerId: string): Promise<ProviderConfig | null>;
  listProviders(): Promise<ProviderConfig[]>;
  
  // Provider status
  getProviderStatus(providerId: string): Promise<ProviderStatus>;
  updateProviderStatus(providerId: string, status: ProviderStatus): Promise<void>;
  getProviderHealth(providerId: string): Promise<ProviderHealth>;
  
  // Provider capabilities
  getProviderCapabilities(providerId: string): Promise<ProviderCapability[]>;
  updateProviderCapabilities(
    providerId: string,
    capabilities: ProviderCapability[]
  ): Promise<void>;
  
  // Provider metrics
  getProviderMetrics(providerId: string): Promise<ProviderMetrics>;
  updateProviderMetrics(
    providerId: string,
    metrics: ProviderMetrics
  ): Promise<void>;
  
  // Provider comparison
  compareProviders(criteria: ProviderComparisonCriteria): Promise<ProviderComparison>;
  findBestProvider(task: CodingTask): Promise<ProviderConfig | null>;
}
```

## Data Models

### CodingTask Model

```typescript
interface CodingTask {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  description: string;
  requirements: TaskRequirements;
  context: TaskContext;
  constraints: TaskConstraints;
  dependencies: TaskDependency[];
  metadata: Record<string, any>;
}

interface TaskRequirements {
  language?: string;
  framework?: string;
  libraries?: string[];
  patterns?: string[];
  quality?: QualityRequirements;
  performance?: PerformanceRequirements;
  security?: SecurityRequirements;
}

interface TaskContext {
  project?: ProjectContext;
  code?: CodeContext;
  environment?: EnvironmentContext;
  business?: BusinessContext;
  technical?: TechnicalContext;
}

interface TaskConstraints {
  timeLimit?: number;
  resourceLimit?: ResourceLimit;
  costLimit?: number;
  qualityThreshold?: number;
  securityLevel?: SecurityLevel;
}
```

### CodingResult Model

```typescript
interface CodingResult {
  id: string;
  taskId: string;
  agentId: string;
  status: TaskStatus;
  outputs: ResultOutput[];
  artifacts: ResultArtifact[];
  quality: QualityAssessment;
  errors: ResultError[];
  warnings: ResultWarning[];
  recommendations: ResultRecommendation[];
  nextSteps: ResultNextStep[];
  validation: ResultValidation;
  metadata: ResultMetadata;
  executionTime: number;
  timestamp: Date;
}

interface QualityAssessment {
  overall: number;
  correctness: number;
  efficiency: number;
  maintainability: number;
  readability: number;
  testability: number;
  security: number;
  performance: number;
  documentation: number;
  compliance: number;
}

interface ResultOutput {
  type: OutputType;
  content: string;
  format: string;
  language?: string;
  metadata: Record<string, any>;
}
```

### AgentCapabilities Model

```typescript
interface AgentCapabilities {
  // Core capabilities
  codeGeneration: boolean;
  codeReview: boolean;
  codeCompletion: boolean;
  codeRefactoring: boolean;
  debugging: boolean;
  testing: boolean;
  documentation: boolean;
  
  // Language support
  supportedLanguages: string[];
  supportedFrameworks: string[];
  
  // Performance characteristics
  maxTokensPerRequest: number;
  maxConcurrentRequests: number;
  averageResponseTime: number;
  
  // Specialized capabilities
  specializedCapabilities: Record<string, boolean>;
}
```

## API Endpoints

### Agent Management Endpoints

#### Create Agent
```http
POST /api/v1/agents
Content-Type: application/json

{
  "id": "claude-agent-1",
  "provider": "anthropic-claude-code",
  "type": "coding_assistant",
  "capabilities": {
    "codeGeneration": true,
    "codeReview": true
  },
  "settings": {
    "model": "claude-3-sonnet",
    "temperature": 0.7
  }
}
```

**Response:**
```json
{
  "id": "claude-agent-1",
  "status": "created",
  "config": {
    "id": "claude-agent-1",
    "provider": "anthropic-claude-code",
    "type": "coding_assistant",
    "capabilities": {
      "codeGeneration": true,
      "codeReview": true
    },
    "settings": {
      "model": "claude-3-sonnet",
      "temperature": 0.7
    }
  }
}
```

#### Get Agent
```http
GET /api/v1/agents/{agentId}
```

**Response:**
```json
{
  "id": "claude-agent-1",
  "type": "coding_assistant",
  "provider": "anthropic-claude-code",
  "status": "active",
  "capabilities": {
    "codeGeneration": true,
    "codeReview": true
  },
  "metrics": {
    "tasksCompleted": 150,
    "averageResponseTime": 2.5,
    "successRate": 0.95
  }
}
```

#### List Agents
```http
GET /api/v1/agents
```

**Response:**
```json
{
  "agents": [
    {
      "id": "claude-agent-1",
      "type": "coding_assistant",
      "provider": "anthropic-claude-code",
      "status": "active"
    },
    {
      "id": "codex-agent-1",
      "type": "coding_assistant",
      "provider": "openai-codex",
      "status": "active"
    }
  ],
  "total": 2
}
```

#### Update Agent
```http
PUT /api/v1/agents/{agentId}
Content-Type: application/json

{
  "settings": {
    "temperature": 0.8
  }
}
```

#### Delete Agent
```http
DELETE /api/v1/agents/{agentId}
```

### Task Execution Endpoints

#### Execute Task
```http
POST /api/v1/tasks
Content-Type: application/json

{
  "type": "code_generation",
  "description": "Generate a REST API endpoint for user authentication",
  "requirements": {
    "language": "typescript",
    "framework": "express",
    "libraries": ["bcrypt", "jsonwebtoken"]
  },
  "context": {
    "project": {
      "name": "auth-service",
      "version": "1.0.0"
    }
  }
}
```

**Response:**
```json
{
  "id": "task-123",
  "status": "completed",
  "result": {
    "id": "result-456",
    "outputs": [
      {
        "type": "code",
        "content": "// Generated authentication endpoint\napp.post('/auth/login', async (req, res) => {\n  // Implementation here\n});",
        "format": "typescript",
        "language": "typescript"
      }
    ],
    "quality": {
      "overall": 0.85,
      "correctness": 0.90,
      "efficiency": 0.80
    },
    "executionTime": 2.3
  }
}
```

#### Get Task Status
```http
GET /api/v1/tasks/{taskId}
```

**Response:**
```json
{
  "id": "task-123",
  "status": "in_progress",
  "progress": 0.75,
  "agentId": "claude-agent-1",
  "startedAt": "2024-01-15T10:00:00Z",
  "estimatedCompletion": "2024-01-15T10:02:00Z"
}
```

#### List Tasks
```http
GET /api/v1/tasks?status=completed&limit=10&offset=0
```

### Coordination Endpoints

#### Start Coordination Session
```http
POST /api/v1/coordination/sessions
Content-Type: application/json

{
  "strategy": "parallel",
  "participants": ["claude-agent-1", "codex-agent-1"],
  "task": {
    "type": "code_review",
    "description": "Review the authentication implementation"
  }
}
```

#### Get Coordination Session
```http
GET /api/v1/coordination/sessions/{sessionId}
```

#### End Coordination Session
```http
DELETE /api/v1/coordination/sessions/{sessionId}
```

### Provider Management Endpoints

#### Register Provider
```http
POST /api/v1/providers
Content-Type: application/json

{
  "id": "anthropic-claude-code",
  "name": "Anthropic Claude Code",
  "type": "anthropic-claude-code",
  "baseUrl": "https://api.anthropic.com",
  "capabilities": [
    "codeGeneration",
    "codeReview",
    "codeCompletion"
  ],
  "authentication": {
    "type": "api_key",
    "credentials": {
      "apiKey": "sk-..."
    }
  }
}
```

#### Get Provider Status
```http
GET /api/v1/providers/{providerId}/status
```

**Response:**
```json
{
  "providerId": "anthropic-claude-code",
  "status": "active",
  "health": "healthy",
  "metrics": {
    "requestsPerMinute": 45,
    "averageResponseTime": 1.8,
    "errorRate": 0.02
  },
  "lastChecked": "2024-01-15T10:00:00Z"
}
```

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "AUTHENTICATION_ERROR",
    "message": "Invalid API key provided",
    "details": {
      "provider": "anthropic-claude-code",
      "timestamp": "2024-01-15T10:00:00Z"
    },
    "requestId": "req-123"
  }
}
```

### Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `AUTHENTICATION_ERROR` | Authentication failed | 401 |
| `AUTHORIZATION_ERROR` | Insufficient permissions | 403 |
| `RATE_LIMIT_ERROR` | Rate limit exceeded | 429 |
| `PROVIDER_ERROR` | Provider API error | 502 |
| `NETWORK_ERROR` | Network connectivity issue | 503 |
| `TIMEOUT_ERROR` | Request timeout | 504 |
| `VALIDATION_ERROR` | Input validation failed | 400 |
| `CONFIGURATION_ERROR` | Configuration error | 500 |
| `COORDINATION_ERROR` | Coordination failed | 500 |
| `DELEGATION_ERROR` | Task delegation failed | 500 |

## Rate Limiting

### Rate Limits

- **Agent Creation**: 10 requests per minute
- **Task Execution**: 100 requests per minute
- **Provider Registration**: 5 requests per minute
- **Health Checks**: 1000 requests per minute

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642248000
```

## SDK Documentation

### TypeScript SDK

#### Installation
```bash
npm install @claude-flow/abstract-agents
```

#### Basic Usage
```typescript
import { AgentCoordinator, ClaudeCodeAgentAdapter } from '@claude-flow/abstract-agents';

// Create coordinator
const coordinator = new AgentCoordinator();

// Create agent
const agent = new ClaudeCodeAgentAdapter('claude-1', {
  provider: 'anthropic-claude-code',
  authentication: {
    type: 'api_key',
    credentials: { apiKey: process.env.ANTHROPIC_API_KEY }
  }
});

// Register agent
await coordinator.registerAgent(agent);

// Execute task
const result = await coordinator.executeTask({
  type: 'code_generation',
  description: 'Generate a React component',
  requirements: { language: 'typescript', framework: 'react' }
});

console.log(result.outputs[0].content);
```

#### Advanced Usage
```typescript
import { 
  AgentCoordinator, 
  TaskDelegator, 
  CoordinationStrategy 
} from '@claude-flow/abstract-agents';

// Create coordinator with custom configuration
const coordinator = new AgentCoordinator({
  coordinationStrategy: CoordinationStrategy.PARALLEL,
  maxConcurrentTasks: 10,
  timeout: 30000
});

// Create multiple agents
const agents = await Promise.all([
  coordinator.createAgent('claude-1', 'anthropic-claude-code'),
  coordinator.createAgent('codex-1', 'openai-codex'),
  coordinator.createAgent('gemini-1', 'google-gemini')
]);

// Register all agents
await Promise.all(agents.map(agent => coordinator.registerAgent(agent)));

// Execute task with coordination
const result = await coordinator.coordinateTask({
  strategy: 'parallel',
  participants: ['claude-1', 'codex-1', 'gemini-1'],
  task: {
    type: 'code_review',
    description: 'Review the authentication implementation',
    requirements: { language: 'typescript' }
  }
});

// Process results
result.outputs.forEach(output => {
  console.log(`Agent ${output.agentId}: ${output.content}`);
});
```

### Python SDK

#### Installation
```bash
pip install claude-flow-abstract-agents
```

#### Basic Usage
```python
from claude_flow_abstract_agents import AgentCoordinator, ClaudeCodeAgentAdapter

# Create coordinator
coordinator = AgentCoordinator()

# Create agent
agent = ClaudeCodeAgentAdapter(
    agent_id='claude-1',
    config={
        'provider': 'anthropic-claude-code',
        'authentication': {
            'type': 'api_key',
            'credentials': {'apiKey': os.getenv('ANTHROPIC_API_KEY')}
        }
    }
)

# Register agent
await coordinator.register_agent(agent)

# Execute task
result = await coordinator.execute_task({
    'type': 'code_generation',
    'description': 'Generate a Python function',
    'requirements': {'language': 'python'}
})

print(result.outputs[0].content)
```

## Examples and Use Cases

### Use Case 1: Multi-Provider Code Generation

```typescript
// Generate code using multiple providers for comparison
const providers = ['anthropic-claude-code', 'openai-codex', 'google-gemini'];
const results = await Promise.all(
  providers.map(provider => 
    coordinator.executeTask({
      type: 'code_generation',
      description: 'Generate a sorting algorithm',
      requirements: { language: 'python' }
    })
  )
);

// Compare results
results.forEach((result, index) => {
  console.log(`Provider ${providers[index]}:`);
  console.log(`Quality: ${result.quality.overall}`);
  console.log(`Code: ${result.outputs[0].content}`);
});
```

### Use Case 2: Load Balancing

```typescript
// Configure load balancing
const delegator = new TaskDelegator({
  strategy: 'round_robin',
  healthCheckInterval: 30000,
  maxRetries: 3
});

// Execute tasks with load balancing
const tasks = [
  { type: 'code_generation', description: 'Task 1' },
  { type: 'code_review', description: 'Task 2' },
  { type: 'testing', description: 'Task 3' }
];

const results = await Promise.all(
  tasks.map(task => delegator.delegateTask(task))
);
```

### Use Case 3: Fault Tolerance

```typescript
// Configure fault tolerance
const coordinator = new AgentCoordinator({
  fallbackStrategy: 'automatic',
  healthCheckInterval: 10000,
  retryAttempts: 3
});

// Execute task with automatic fallback
const result = await coordinator.executeTask({
  type: 'code_generation',
  description: 'Generate a web service',
  requirements: { language: 'typescript' }
});
```

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2024-01-XX | System Architect | Initial API documentation |

## References

- [Requirements Document](./REQUIREMENTS.md)
- [Technical Specifications](./SPECIFICATIONS.md)
- [Architecture Design Document](./ARCHITECTURE.md)
- [Integration Guide](./INTEGRATION.md)
- [Claude-Flow Core Documentation](../../../README.md)