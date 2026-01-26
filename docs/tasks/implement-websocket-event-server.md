# Task: Implement WebSocket Event Server for Live Dashboard

## Objective

Create a WebSocket Event Server in `@claude-flow/cli` that broadcasts real-time events to the Live Operations Dashboard at `v3/@claude-flow/dashboard`.

## Background

The Live Operations Dashboard frontend is complete and expects a WebSocket server at `ws://localhost:3001` that broadcasts events when:
- Agents spawn, change status, or stop
- Tasks are created, assigned, updated, or completed
- Messages are sent between agents
- Memory operations occur (store, retrieve, search)
- Topology changes

## Requirements

### 1. Create Event Server (`v3/@claude-flow/cli/src/services/event-server.ts`)

```typescript
interface EventServerConfig {
  port: number;           // Default: 3001
  host: string;           // Default: localhost
  maxConnections: number; // Default: 100
  heartbeatInterval: number; // Default: 30000ms
}

class EventServer {
  // Start/stop the WebSocket server
  start(): Promise<void>;
  stop(): Promise<void>;

  // Emit events to all connected clients
  emitAgentStatus(event: AgentStatusEvent): void;
  emitTaskUpdate(event: TaskUpdateEvent): void;
  emitMessage(event: MessageEvent): void;
  emitMemoryOperation(event: MemoryOperationEvent): void;
  emitTopologyChange(event: TopologyChangeEvent): void;
  emitMetrics(event: MetricsUpdateEvent): void;

  // Client management
  getConnectedClients(): number;
  broadcast(event: DashboardEvent): void;
}
```

### 2. Event Types (match dashboard expectations)

```typescript
// Agent status event
interface AgentStatusEvent {
  type: 'agent:status';
  agentId: string;
  name: string;
  agentType: string;
  status: 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'stopped';
  task?: string;
  metrics?: { cpu: number; memory: number; messageCount: number };
  timestamp: number;
}

// Task update event
interface TaskUpdateEvent {
  type: 'task:update';
  taskId: string;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
  agentId?: string;
  description: string;
  progress?: number;
  error?: string;
  startTime?: number;
  endTime?: number;
  timestamp: number;
}

// Message event
interface MessageEvent {
  type: 'message:sent';
  messageId: string;
  source: string;
  target: string;
  messageType: 'task' | 'response' | 'query' | 'broadcast' | 'error';
  payload: unknown;
  size: number;
  timestamp: number;
}

// Memory operation event
interface MemoryOperationEvent {
  type: 'memory:operation';
  operation: 'store' | 'retrieve' | 'search' | 'delete' | 'update';
  namespace: string;
  key?: string;
  query?: string;
  value?: unknown;
  resultCount?: number;
  cacheHit?: boolean;
  latency: number;
  timestamp: number;
}

// Topology change event
interface TopologyChangeEvent {
  type: 'topology:change';
  topology: 'hierarchical' | 'mesh' | 'adaptive';
  nodes: Array<{ id: string; name: string; type: string; status: string }>;
  edges: Array<{ source: string; target: string; health: string }>;
  timestamp: number;
}

// Metrics update event
interface MetricsUpdateEvent {
  type: 'metrics:update';
  activeAgents: number;
  pendingTasks: number;
  messagesPerSecond: number;
  memoryOpsPerSecond: number;
  timestamp: number;
}
```

### 3. WebSocket Protocol

**Client → Server:**
```json
{ "type": "subscribe", "channel": "agents" }
{ "type": "unsubscribe", "channel": "agents" }
{ "type": "ping" }
{ "type": "replay", "since": 1234567890 }
```

**Server → Client:**
```json
{ "type": "subscribed", "channel": "agents" }
{ "type": "pong" }
{ "type": "agent:status", ... }
{ "type": "task:update", ... }
```

### 4. Integration Points

Hook into existing CLI services to emit events:

1. **Agent Manager** - Emit `agent:status` on spawn, status change, stop
2. **Task Orchestrator** - Emit `task:update` on create, assign, complete, fail
3. **Message Bus** - Emit `message:sent` on inter-agent communication
4. **Memory Service** - Emit `memory:operation` on store/retrieve/search
5. **Swarm Coordinator** - Emit `topology:change` on topology updates

### 5. CLI Command

Add command to start the event server:

```bash
# Start event server standalone
npx @claude-flow/cli event-server start --port 3001

# Or integrate with daemon
npx @claude-flow/cli daemon start --with-event-server
```

### 6. Update Dashboard Connection

Update `v3/@claude-flow/dashboard/src/App.tsx` to:
- Remove demo data when WebSocket connects successfully
- Keep demo data as fallback when no server available

## Files to Create/Modify

### Create:
- `v3/@claude-flow/cli/src/services/event-server.ts` - Main event server
- `v3/@claude-flow/cli/src/services/event-emitter.ts` - Event emission helpers
- `v3/@claude-flow/cli/src/commands/event-server.ts` - CLI command

### Modify:
- `v3/@claude-flow/cli/src/services/agent-manager.ts` - Add event emission
- `v3/@claude-flow/cli/src/services/task-orchestrator.ts` - Add event emission
- `v3/@claude-flow/cli/src/services/daemon.ts` - Integrate event server
- `v3/@claude-flow/dashboard/src/App.tsx` - Connect to real server

## Dependencies

Add to `@claude-flow/cli`:
```json
{
  "ws": "^8.16.0",
  "@types/ws": "^8.5.10"
}
```

## Testing

1. Start the event server: `npx @claude-flow/cli event-server start`
2. Start the dashboard: `cd v3/@claude-flow/dashboard && npm run dev`
3. Open dashboard at http://localhost:5173
4. In another terminal, spawn a swarm: `npx @claude-flow/cli swarm init`
5. Verify events appear in dashboard in real-time

## Success Criteria

- [ ] Event server starts on port 3001
- [ ] Dashboard connects and shows "Connected" status
- [ ] Agent spawn events appear in real-time
- [ ] Task updates flow to dashboard
- [ ] Messages between agents are visible
- [ ] Memory operations are logged
- [ ] Topology updates when swarm changes
- [ ] Metrics update every second
