# PRD: Claude Flow Live Operations Dashboard

## Product Requirements Document
**Version:** 1.0.0
**Date:** 2026-01-25
**Status:** Draft
**Methodology:** SPARC + TDD

---

## Executive Summary

Create a real-time operations dashboard for Claude Flow V3 that provides live visibility into agent activities, task execution, message flow between agents, and memory operations. Unlike the static technology showcase, this dashboard connects to a running Claude Flow system and displays live operational data.

---

## 1. SPECIFICATION PHASE (S)

### 1.1 Vision Statement

Build a **Live Operations Dashboard** that visualizes:
- **Real-time agent status** - Which agents are active, idle, busy, or errored
- **Task execution flow** - Tasks being created, assigned, in-progress, and completed
- **Message transmission** - Inter-agent communication with message content preview
- **Memory operations** - Store, retrieve, search operations with namespace visibility
- **Swarm coordination** - Topology visualization with live connection states

### 1.2 Problem Statement

| Problem | Current State | Desired State |
|---------|---------------|---------------|
| Agent visibility | CLI output only (`agent list`) | Real-time visual agent grid with status |
| Task tracking | Manual polling required | Live task timeline with progress |
| Message flow | Hidden in logs | Visual message stream between agents |
| Memory operations | No visibility | Live memory operation log with filters |
| Swarm health | Static topology view | Animated topology with live connections |
| Debugging | Parse log files | Interactive timeline with drill-down |

### 1.3 Target Users

1. **Developers running Claude Flow** - Need real-time visibility during development
2. **Operators monitoring swarms** - Need health dashboards for production
3. **Debuggers troubleshooting** - Need message and memory inspection
4. **Team leads reviewing** - Need task progress and agent utilization metrics

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Event latency | < 100ms from occurrence to display | Timestamp comparison |
| Agent status accuracy | 100% match with CLI | Automated verification |
| Message capture rate | 100% of inter-agent messages | Message count comparison |
| Memory operation visibility | All store/search/retrieve ops | Operation audit |
| Dashboard responsiveness | 60 FPS during updates | Performance profiling |
| Connection reliability | Auto-reconnect < 2s | Connection monitoring |

### 1.5 User Stories

```gherkin
Feature: Live Agent Monitoring

  Scenario: Developer monitors active agents
    Given the Claude Flow daemon is running
    And a swarm has been initialized with 6 agents
    When the developer opens the Live Dashboard
    Then they see all 6 agents with real-time status indicators
    And status updates appear within 100ms of changes
    And they can click an agent to see its current task

  Scenario: Operator tracks task execution
    Given multiple tasks are being processed
    When the operator views the Task Timeline
    Then they see tasks flowing through states (pending → in_progress → completed)
    And each task shows assigned agent and duration
    And failed tasks are highlighted with error details

  Scenario: Debugger inspects message flow
    Given agents are communicating during task execution
    When the debugger enables Message Stream view
    Then they see messages flowing between agents in real-time
    And can filter by source/target agent
    And can expand messages to see full payload
    And message connections animate on the topology view

  Scenario: Developer monitors memory operations
    Given agents are using shared memory
    When memory operations occur
    Then the Memory Log shows store/retrieve/search operations
    And displays namespace, key, and value preview
    And highlights cache hits vs misses
    And shows HNSW vector search queries with similarity scores
```

### 1.6 Data Sources

| Data Type | Source | Protocol | Update Frequency |
|-----------|--------|----------|------------------|
| Agent status | Claude Flow daemon | WebSocket | On change |
| Task updates | Task orchestrator | WebSocket | On change |
| Messages | Agent communication layer | WebSocket | Real-time stream |
| Memory ops | Memory service | WebSocket | On operation |
| Swarm topology | Swarm coordinator | WebSocket | On topology change |
| Metrics | Performance monitor | WebSocket | Every 1s |

---

## 2. PSEUDOCODE PHASE (P)

### 2.1 Core Dashboard Components

```
COMPONENT LiveDashboard:
  STATE:
    connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error'
    agents: Map<AgentId, AgentState>
    tasks: Map<TaskId, TaskState>
    messages: MessageStream[]
    memoryOps: MemoryOperation[]
    topology: TopologyState
    selectedView: 'overview' | 'agents' | 'tasks' | 'messages' | 'memory'

  ON_MOUNT:
    CONNECT to Claude Flow WebSocket server
    SUBSCRIBE to all event channels
    INITIALIZE empty state collections
    START heartbeat monitoring

  ON_EVENT(event):
    SWITCH event.type:
      'agent:status' → UPDATE agents map
      'task:update' → UPDATE tasks map, ADD to timeline
      'message:sent' → APPEND to messages stream, ANIMATE on topology
      'memory:operation' → APPEND to memoryOps log
      'topology:change' → UPDATE topology state
      'metrics:update' → UPDATE performance metrics

  ON_DISCONNECT:
    SET connectionStatus = 'disconnected'
    SHOW reconnecting indicator
    ATTEMPT reconnect with exponential backoff

COMPONENT AgentGrid:
  PROPS:
    agents: Map<AgentId, AgentState>
    onAgentSelect: (agent) => void

  RENDER:
    FOR each agent IN agents:
      RENDER AgentCard with:
        - Name and type icon
        - Status indicator (pulsing if active)
        - Current task preview
        - CPU/memory usage bar
        - Message count badge
      ON_CLICK → onAgentSelect(agent)

COMPONENT TaskTimeline:
  STATE:
    tasks: TaskState[]
    filter: { status: string[], agent: string[], timeRange: DateRange }
    view: 'timeline' | 'kanban' | 'list'

  RENDER:
    DRAW timeline axis with time markers
    FOR each task IN filteredTasks:
      POSITION task bar based on startTime and duration
      COLOR based on status (pending=gray, progress=blue, done=green, error=red)
      SHOW agent avatar on task bar
      ON_HOVER → SHOW task details tooltip
      ON_CLICK → OPEN task detail panel

COMPONENT MessageStream:
  STATE:
    messages: Message[]
    filter: { source: string[], target: string[], search: string }
    isPaused: boolean
    selectedMessage: Message | null

  RENDER:
    RENDER filter controls (agent selectors, search input, pause button)
    RENDER scrollable message list:
      FOR each message IN messages (newest first):
        SHOW timestamp, source → target, message type
        SHOW truncated payload preview
        ON_CLICK → EXPAND to show full payload
        HIGHLIGHT if matches search

  ON_NEW_MESSAGE(message):
    IF NOT isPaused:
      PREPEND to messages list
      IF list exceeds maxMessages:
        REMOVE oldest messages
      ANIMATE new message entry

COMPONENT MemoryOperationLog:
  STATE:
    operations: MemoryOperation[]
    filter: { namespace: string[], operation: string[], search: string }
    showValues: boolean

  RENDER:
    RENDER namespace filter chips
    RENDER operation type filter (store, retrieve, search, delete)
    FOR each op IN filteredOperations:
      SHOW timestamp, operation type icon
      SHOW namespace::key
      IF showValues AND op.value:
        SHOW truncated value preview
      IF op.type == 'search':
        SHOW query and result count
        SHOW similarity scores for top results
      COLOR code by operation type

COMPONENT LiveTopology:
  STATE:
    nodes: AgentNode[]
    edges: Connection[]
    activeMessages: AnimatedMessage[]
    layout: 'hierarchical' | 'mesh' | 'force'

  RENDER:
    RENDER D3 force-directed graph
    FOR each node IN nodes:
      DRAW agent circle with status color
      PULSE if agent is active
      SHOW agent name label

    FOR each edge IN edges:
      DRAW connection line
      STYLE based on connection health

    FOR each message IN activeMessages:
      ANIMATE particle along edge from source to target
      FADE out after reaching target

  ON_MESSAGE_EVENT(message):
    CREATE animated particle at source node
    ANIMATE along path to target node
    REMOVE particle after animation completes
```

### 2.2 Event Types

```
TYPE AgentStatusEvent = {
  type: 'agent:status'
  agentId: string
  status: 'spawning' | 'active' | 'idle' | 'busy' | 'error' | 'stopped'
  task?: TaskId
  metrics?: { cpu: number, memory: number, messageCount: number }
  timestamp: number
}

TYPE TaskUpdateEvent = {
  type: 'task:update'
  taskId: string
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed'
  agentId?: string
  description: string
  progress?: number
  error?: string
  startTime?: number
  endTime?: number
  timestamp: number
}

TYPE MessageEvent = {
  type: 'message:sent'
  messageId: string
  source: AgentId
  target: AgentId
  messageType: 'task' | 'result' | 'query' | 'response' | 'broadcast'
  payload: unknown
  size: number
  timestamp: number
}

TYPE MemoryOperationEvent = {
  type: 'memory:operation'
  operation: 'store' | 'retrieve' | 'search' | 'delete' | 'update'
  namespace: string
  key?: string
  query?: string
  value?: unknown
  resultCount?: number
  cacheHit?: boolean
  latency: number
  timestamp: number
}

TYPE TopologyChangeEvent = {
  type: 'topology:change'
  topology: 'hierarchical' | 'mesh' | 'adaptive'
  nodes: AgentNode[]
  edges: Connection[]
  timestamp: number
}
```

### 2.3 WebSocket Connection Manager

```
CLASS WebSocketManager:
  PROPERTIES:
    url: string
    socket: WebSocket | null
    reconnectAttempts: number
    maxReconnectAttempts: 10
    reconnectDelay: 1000
    eventHandlers: Map<EventType, Handler[]>
    heartbeatInterval: number

  METHOD connect():
    socket = NEW WebSocket(url)

    socket.onopen = () =>
      SET reconnectAttempts = 0
      START heartbeat timer
      EMIT 'connected' event
      SUBSCRIBE to all channels

    socket.onmessage = (event) =>
      data = JSON.parse(event.data)
      handlers = eventHandlers.get(data.type)
      FOR each handler IN handlers:
        handler(data)

    socket.onclose = () =>
      STOP heartbeat timer
      IF reconnectAttempts < maxReconnectAttempts:
        SCHEDULE reconnect with exponential backoff
        INCREMENT reconnectAttempts
      ELSE:
        EMIT 'connection_failed' event

    socket.onerror = (error) =>
      LOG error
      EMIT 'error' event

  METHOD subscribe(channel: string):
    SEND { type: 'subscribe', channel }

  METHOD unsubscribe(channel: string):
    SEND { type: 'unsubscribe', channel }

  METHOD on(eventType: string, handler: Function):
    ADD handler to eventHandlers[eventType]
    RETURN unsubscribe function

  METHOD disconnect():
    IF socket:
      socket.close()
      socket = null
```

---

## 3. ARCHITECTURE PHASE (A)

### 3.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Live Operations Dashboard                        │
│                        (React + Vite)                                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ Agent Grid  │  │   Task      │  │  Message    │  │  Memory    │ │
│  │             │  │  Timeline   │  │   Stream    │  │    Log     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘ │
│         │                │                │               │         │
│  ┌──────┴────────────────┴────────────────┴───────────────┴──────┐ │
│  │                    Event Store (Zustand)                       │ │
│  │  agents | tasks | messages | memoryOps | topology | metrics   │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
│                             │                                       │
│  ┌──────────────────────────┴────────────────────────────────────┐ │
│  │              WebSocket Connection Manager                      │ │
│  │         Reconnection | Heartbeat | Event Routing              │ │
│  └──────────────────────────┬────────────────────────────────────┘ │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ WebSocket (wss://)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Claude Flow Event Server                          │
│                   (New: WebSocket Gateway)                          │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   Agent     │  │    Task     │  │   Message   │  │   Memory   │ │
│  │  Manager    │  │ Orchestrator│  │    Bus      │  │  Service   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘ │
│         │                │                │               │         │
│  ┌──────┴────────────────┴────────────────┴───────────────┴──────┐ │
│  │                     Event Aggregator                           │ │
│  │            Collects events from all services                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Framework** | React 18 + Vite | Consistent with showcase, fast HMR |
| **State** | Zustand | Lightweight, good for real-time updates |
| **WebSocket** | Native WebSocket + reconnecting-websocket | Reliable connection management |
| **Visualization** | D3.js | Topology animation, timeline rendering |
| **Animation** | Framer Motion | Smooth transitions for status changes |
| **Styling** | Tailwind CSS | Consistent with showcase theme |
| **Time Handling** | date-fns | Relative time display, timeline math |
| **Testing** | Vitest + MSW | Mock WebSocket for testing |

### 3.3 Project Structure

```
v3/@claude-flow/dashboard/
├── src/
│   ├── components/
│   │   ├── agents/
│   │   │   ├── AgentGrid.tsx
│   │   │   ├── AgentCard.tsx
│   │   │   ├── AgentDetail.tsx
│   │   │   └── AgentStatusIndicator.tsx
│   │   ├── tasks/
│   │   │   ├── TaskTimeline.tsx
│   │   │   ├── TaskCard.tsx
│   │   │   ├── TaskDetail.tsx
│   │   │   └── TaskKanban.tsx
│   │   ├── messages/
│   │   │   ├── MessageStream.tsx
│   │   │   ├── MessageItem.tsx
│   │   │   ├── MessageDetail.tsx
│   │   │   └── MessageFilter.tsx
│   │   ├── memory/
│   │   │   ├── MemoryLog.tsx
│   │   │   ├── MemoryOperation.tsx
│   │   │   ├── NamespaceFilter.tsx
│   │   │   └── VectorSearchResult.tsx
│   │   ├── topology/
│   │   │   ├── LiveTopology.tsx
│   │   │   ├── AnimatedEdge.tsx
│   │   │   ├── MessageParticle.tsx
│   │   │   └── TopologyControls.tsx
│   │   ├── metrics/
│   │   │   ├── MetricsPanel.tsx
│   │   │   ├── ThroughputChart.tsx
│   │   │   └── LatencyGauge.tsx
│   │   └── layout/
│   │       ├── DashboardLayout.tsx
│   │       ├── Header.tsx
│   │       ├── Sidebar.tsx
│   │       └── ConnectionStatus.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts
│   │   ├── useAgentEvents.ts
│   │   ├── useTaskEvents.ts
│   │   ├── useMessageStream.ts
│   │   ├── useMemoryEvents.ts
│   │   └── useConnectionStatus.ts
│   ├── services/
│   │   ├── WebSocketManager.ts
│   │   ├── EventAggregator.ts
│   │   └── EventBuffer.ts
│   ├── store/
│   │   ├── dashboardStore.ts
│   │   ├── agentStore.ts
│   │   ├── taskStore.ts
│   │   ├── messageStore.ts
│   │   └── memoryStore.ts
│   ├── types/
│   │   ├── events.ts
│   │   ├── agents.ts
│   │   ├── tasks.ts
│   │   ├── messages.ts
│   │   └── memory.ts
│   └── utils/
│       ├── eventParser.ts
│       ├── timeUtils.ts
│       └── formatters.ts
├── __tests__/
│   ├── components/
│   ├── hooks/
│   ├── services/
│   └── mocks/
│       └── websocket.ts
├── package.json
├── vite.config.ts
└── vitest.config.ts
```

### 3.4 Backend Requirements (Claude Flow Event Server)

The dashboard requires a WebSocket server in Claude Flow. This needs to be added:

```typescript
// New: v3/@claude-flow/cli/src/services/event-server.ts

interface EventServerConfig {
  port: number;
  host: string;
  maxConnections: number;
  heartbeatInterval: number;
}

class EventServer {
  // Channels
  private channels = ['agents', 'tasks', 'messages', 'memory', 'topology', 'metrics'];

  // Emit events from various sources
  emitAgentStatus(agentId: string, status: AgentStatus): void;
  emitTaskUpdate(task: Task): void;
  emitMessage(message: AgentMessage): void;
  emitMemoryOperation(op: MemoryOperation): void;
  emitTopologyChange(topology: TopologyState): void;
  emitMetrics(metrics: SystemMetrics): void;
}
```

### 3.5 Data Flow

```
Agent spawns → AgentManager.spawn()
                    │
                    ├─→ EventServer.emitAgentStatus('spawning')
                    │
                    └─→ Agent starts → EventServer.emitAgentStatus('active')
                              │
                              ├─→ Task assigned → EventServer.emitTaskUpdate()
                              │
                              ├─→ Agent sends message → EventServer.emitMessage()
                              │
                              ├─→ Agent accesses memory → EventServer.emitMemoryOperation()
                              │
                              └─→ Task completes → EventServer.emitTaskUpdate()

WebSocket Server broadcasts to all subscribed dashboard clients
```

---

## 4. REFINEMENT PHASE (R)

### 4.1 TDD Test Specifications

```typescript
// __tests__/hooks/useWebSocket.test.ts

describe('useWebSocket', () => {
  describe('Connection Management', () => {
    it('should connect to WebSocket server on mount', async () => {
      // Given: WebSocket server is available
      // When: hook is mounted
      // Then: connection status becomes 'connected'
    });

    it('should reconnect automatically on disconnect', async () => {
      // Given: connected WebSocket
      // When: server closes connection
      // Then: hook attempts reconnection with backoff
      // And: connection status shows 'reconnecting'
    });

    it('should stop reconnecting after max attempts', async () => {
      // Given: server is unavailable
      // When: max reconnect attempts exceeded
      // Then: connection status becomes 'failed'
      // And: error callback is invoked
    });

    it('should send heartbeat at configured interval', async () => {
      // Given: connected WebSocket
      // When: heartbeat interval elapses
      // Then: ping message is sent
    });
  });

  describe('Event Handling', () => {
    it('should parse and dispatch agent status events', async () => {
      // Given: subscribed to agent channel
      // When: agent:status event received
      // Then: event handler is called with parsed data
    });

    it('should buffer events during reconnection', async () => {
      // Given: disconnected state
      // When: reconnection succeeds
      // Then: request missed events from server
    });
  });
});

// __tests__/components/AgentGrid.test.tsx

describe('AgentGrid', () => {
  describe('Rendering', () => {
    it('should render all agents from store', () => {
      // Given: 6 agents in store
      // When: component renders
      // Then: 6 AgentCard components are visible
    });

    it('should show correct status indicator for each agent', () => {
      // Given: agents with different statuses
      // When: component renders
      // Then: each card shows appropriate status color/animation
    });

    it('should update immediately when agent status changes', async () => {
      // Given: rendered grid with active agent
      // When: agent status changes to 'busy'
      // Then: card updates within one render cycle
    });
  });

  describe('Interaction', () => {
    it('should open detail panel on agent click', async () => {
      // Given: rendered grid
      // When: user clicks agent card
      // Then: AgentDetail panel opens with agent info
    });

    it('should highlight agent on topology when hovered', async () => {
      // Given: rendered grid with topology visible
      // When: user hovers over agent card
      // Then: corresponding node highlights on topology
    });
  });
});

// __tests__/components/MessageStream.test.tsx

describe('MessageStream', () => {
  describe('Real-time Updates', () => {
    it('should prepend new messages to stream', async () => {
      // Given: stream with 5 messages
      // When: new message event received
      // Then: message appears at top of list
      // And: animation plays for new message
    });

    it('should pause updates when pause button clicked', async () => {
      // Given: active message stream
      // When: user clicks pause
      // Then: new messages are buffered but not displayed
      // And: badge shows buffered message count
    });

    it('should limit displayed messages to maxMessages', async () => {
      // Given: maxMessages = 100
      // When: 150 messages received
      // Then: only 100 most recent messages in DOM
    });
  });

  describe('Filtering', () => {
    it('should filter by source agent', async () => {
      // Given: messages from multiple agents
      // When: user selects source filter
      // Then: only messages from selected agent visible
    });

    it('should search message content', async () => {
      // Given: messages with various payloads
      // When: user enters search query
      // Then: only matching messages visible
      // And: matches are highlighted
    });
  });
});

// __tests__/components/MemoryLog.test.tsx

describe('MemoryLog', () => {
  describe('Operation Display', () => {
    it('should show store operations with key and value preview', () => {
      // Given: store operation event
      // When: rendered
      // Then: shows namespace, key, truncated value
    });

    it('should show search operations with query and results', () => {
      // Given: HNSW search operation
      // When: rendered
      // Then: shows query, result count, top similarity scores
    });

    it('should indicate cache hits vs misses', () => {
      // Given: retrieve operations with cache status
      // When: rendered
      // Then: cache hits show green indicator
      // And: cache misses show yellow indicator
    });
  });

  describe('Namespace Filtering', () => {
    it('should filter by namespace', () => {
      // Given: operations across multiple namespaces
      // When: user selects namespace filter
      // Then: only operations for that namespace shown
    });
  });
});

// __tests__/components/LiveTopology.test.tsx

describe('LiveTopology', () => {
  describe('Animation', () => {
    it('should animate message particles between agents', async () => {
      // Given: rendered topology with connected agents
      // When: message event received
      // Then: particle animates from source to target node
    });

    it('should pulse active agents', () => {
      // Given: agent with 'active' status
      // When: rendered
      // Then: node has pulsing animation
    });

    it('should update edge styles based on connection health', () => {
      // Given: connection with high latency
      // When: rendered
      // Then: edge shows warning color
    });
  });

  describe('Layout', () => {
    it('should switch between topology layouts', async () => {
      // Given: hierarchical layout
      // When: user selects mesh layout
      // Then: nodes animate to new positions
    });
  });
});

// __tests__/services/WebSocketManager.test.ts

describe('WebSocketManager', () => {
  describe('Subscription', () => {
    it('should subscribe to channels on connect', async () => {
      // Given: new connection
      // When: connection opens
      // Then: subscribe messages sent for all channels
    });

    it('should handle subscription confirmation', async () => {
      // Given: pending subscription
      // When: server confirms
      // Then: channel marked as subscribed
    });
  });

  describe('Event Buffering', () => {
    it('should buffer events when disconnected', () => {
      // Given: disconnected state
      // When: local events occur
      // Then: events queued for sync on reconnect
    });

    it('should request event replay on reconnect', async () => {
      // Given: reconnecting after disconnect
      // When: connection established
      // Then: request events since last received timestamp
    });
  });
});
```

### 4.2 Edge Cases & Error Handling

```typescript
// Connection failures
class ConnectionErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <ConnectionErrorView
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false })}
        />
      );
    }
    return this.props.children;
  }
}

// Event buffer overflow
const MAX_EVENTS = 10000;
const eventBuffer = {
  messages: new CircularBuffer<Message>(MAX_EVENTS),
  memoryOps: new CircularBuffer<MemoryOp>(MAX_EVENTS),

  add(event) {
    // Oldest events automatically evicted when buffer full
  }
};

// Slow consumer handling
const throttledUpdate = throttle((events) => {
  batchUpdate(events);
}, 16); // 60 FPS max

// Large payload handling
const truncatePayload = (payload: unknown, maxSize = 1000): string => {
  const str = JSON.stringify(payload);
  if (str.length > maxSize) {
    return str.slice(0, maxSize) + '... (truncated)';
  }
  return str;
};
```

### 4.3 Performance Optimizations

| Optimization | Implementation |
|--------------|----------------|
| Virtual scrolling | Use @tanstack/react-virtual for message/memory lists |
| Event batching | Batch state updates every 16ms (60 FPS) |
| Memoization | React.memo for AgentCard, MessageItem components |
| Web Workers | Parse large payloads in worker thread |
| Debounced search | Debounce filter inputs by 150ms |
| Lazy rendering | Only render visible topology nodes |

### 4.4 Accessibility Requirements

| Requirement | Implementation |
|-------------|----------------|
| Screen reader | ARIA live regions for status changes |
| Keyboard nav | Tab through agents, Enter to select |
| Color blind | Status uses icons + colors, not color alone |
| Reduced motion | Respect prefers-reduced-motion |
| Focus management | Trap focus in modals, return on close |

---

## 5. COMPLETION PHASE (C)

### 5.1 Definition of Done

- [ ] WebSocket connection with auto-reconnect working
- [ ] All event types properly parsed and displayed
- [ ] < 100ms latency from event to UI update
- [ ] 60 FPS maintained during high event volume
- [ ] All TDD tests passing
- [ ] Accessibility audit passed (WCAG 2.1 AA)
- [ ] Works in Chrome, Firefox, Safari, Edge
- [ ] Mobile responsive (can view on tablet)
- [ ] Documentation complete

### 5.2 Implementation Phases

| Phase | Deliverables | Dependencies |
|-------|--------------|--------------|
| **Phase 1: Backend** | WebSocket Event Server in Claude Flow | CLI codebase access |
| **Phase 2: Connection** | WebSocketManager, connection UI | Phase 1 |
| **Phase 3: Agents** | AgentGrid, AgentCard, AgentDetail | Phase 2 |
| **Phase 4: Tasks** | TaskTimeline, TaskCard, TaskDetail | Phase 2 |
| **Phase 5: Messages** | MessageStream, MessageItem, filters | Phase 2 |
| **Phase 6: Memory** | MemoryLog, namespace filters | Phase 2 |
| **Phase 7: Topology** | LiveTopology with animations | Phase 3 |
| **Phase 8: Polish** | Performance, accessibility, testing | All phases |

### 5.3 Deployment

```yaml
# .github/workflows/deploy-dashboard.yml
name: Deploy Live Dashboard

on:
  push:
    branches: [main]
    paths: ['v3/@claude-flow/dashboard/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: pnpm install
      - run: pnpm test
      - run: pnpm build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./v3/@claude-flow/dashboard/dist
```

### 5.4 Configuration

```typescript
// Dashboard configuration
interface DashboardConfig {
  // WebSocket
  wsUrl: string;                    // Default: ws://localhost:3001
  reconnectMaxAttempts: number;     // Default: 10
  reconnectBaseDelay: number;       // Default: 1000ms
  heartbeatInterval: number;        // Default: 30000ms

  // Display
  maxMessages: number;              // Default: 1000
  maxMemoryOps: number;             // Default: 1000
  updateThrottleMs: number;         // Default: 16 (60 FPS)

  // Features
  enableMessageContent: boolean;    // Default: true (can disable for security)
  enableMemoryValues: boolean;      // Default: true
  autoScroll: boolean;              // Default: true
}
```

---

## 6. APPENDICES

### A. Event Server Protocol

```typescript
// Client → Server
{ type: 'subscribe', channel: 'agents' }
{ type: 'unsubscribe', channel: 'agents' }
{ type: 'ping' }
{ type: 'replay', since: timestamp }

// Server → Client
{ type: 'subscribed', channel: 'agents' }
{ type: 'pong' }
{ type: 'agent:status', ...event }
{ type: 'task:update', ...event }
{ type: 'message:sent', ...event }
{ type: 'memory:operation', ...event }
{ type: 'topology:change', ...event }
{ type: 'metrics:update', ...event }
```

### B. Color Scheme (Dark Theme)

```css
:root {
  /* Status Colors */
  --status-active: #22c55e;    /* Green - pulsing */
  --status-idle: #64748b;      /* Gray */
  --status-busy: #f59e0b;      /* Amber */
  --status-error: #ef4444;     /* Red */
  --status-spawning: #3b82f6;  /* Blue - pulsing */

  /* Operation Colors */
  --op-store: #22c55e;         /* Green */
  --op-retrieve: #3b82f6;      /* Blue */
  --op-search: #a855f7;        /* Purple */
  --op-delete: #ef4444;        /* Red */

  /* Message Types */
  --msg-task: #3b82f6;         /* Blue */
  --msg-result: #22c55e;       /* Green */
  --msg-query: #f59e0b;        /* Amber */
  --msg-error: #ef4444;        /* Red */
}
```

### C. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `1-5` | Switch views (Agents, Tasks, Messages, Memory, Topology) |
| `Space` | Pause/resume message stream |
| `Escape` | Close detail panel |
| `/` | Focus search input |
| `?` | Show keyboard shortcuts |

---

## Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Tech Lead | | | |
| Designer | | | |

---

*Document generated following SPARC methodology with TDD approach*
