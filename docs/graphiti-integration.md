# Graphiti Integration for Claude-Flow

## Overview

This document describes the Graphiti knowledge graph integration for Claude-Flow's memory and hive-mind systems. Graphiti transforms information into a richly connected knowledge network, enabling persistent, queryable memory with relationships and temporal metadata.

## Features

### Knowledge Graph Memory
- **Episode Processing**: Store text, JSON, and message-based content as episodes
- **Node Relationships**: Automatic entity and relationship extraction
- **Temporal Reasoning**: Track fact validity over time
- **Persistent Storage**: Long-term memory retention with configurable TTL

### Collective Intelligence
- **Pattern Recognition**: Identify behavioral, performance, and error patterns
- **Insight Generation**: Derive insights from collective knowledge
- **Knowledge Evolution**: Adaptive learning from new information
- **Hive-Mind Sharing**: Share knowledge across swarm agents

## Installation

### Prerequisites

1. Install the Graphiti MCP server:
```bash
npm install -g @mcp/graphiti
```

2. Configure your MCP settings to include Graphiti:
```json
{
  "mcpServers": {
    "graphiti": {
      "command": "npx",
      "args": ["@mcp/graphiti"],
      "env": {
        "DATABASE_URL": "your_database_url"
      }
    }
  }
}
```

## Usage

### Basic Memory Operations

```typescript
import { GraphitiMemoryAdapter } from 'claude-flow/memory';

// Initialize the adapter
const graphiti = new GraphitiMemoryAdapter({
  enabled: true,
  defaultGroupId: 'my_project',
  enableAutoSync: true
});

// Add a text memory
await graphiti.addMemory(
  'User Preference',
  'User prefers dark mode UI',
  {
    source: 'text',
    groupId: 'user_preferences'
  }
);

// Add structured data
const userData = {
  name: 'John Doe',
  preferences: {
    theme: 'dark',
    language: 'en'
  }
};

await graphiti.addMemory(
  'User Profile',
  JSON.stringify(userData),
  {
    source: 'json',
    sourceDescription: 'User profile data'
  }
);
```

### Searching Knowledge

```typescript
// Search for nodes
const nodeResults = await graphiti.searchNodes('user preferences', {
  maxNodes: 10,
  entityType: 'Preference'
});

// Search for facts/relationships
const factResults = await graphiti.searchFacts('theme settings', {
  maxFacts: 20
});

// Get recent episodes
const recentMemories = await graphiti.getRecentEpisodes('user_preferences', 5);
```

### Hive-Mind Integration

```typescript
import { GraphitiHiveIntegration } from 'claude-flow/swarm';

// Create hive-mind integration
const hiveIntegration = new GraphitiHiveIntegration(graphiti, {
  enablePatternExtraction: true,
  enableInsightGeneration: true
});

// Extract patterns from collective knowledge
const patterns = await hiveIntegration.extractPatterns('swarm_001');

// Generate insights
const insights = await hiveIntegration.generateInsights('swarm_001');

// Query collective knowledge
const knowledge = await hiveIntegration.queryCollectiveKnowledge(
  'optimization strategies',
  ['swarm_001', 'swarm_002']
);
```

### Temporal Reasoning

```typescript
// Update fact validity
await graphiti.updateFactValidity(
  'edge_uuid_123',
  false, // Mark as invalid
  new Date('2024-12-31') // Valid until date
);
```

## Configuration

### Environment Variables

```bash
# Graphiti Database Connection
GRAPHITI_DATABASE_URL=postgresql://user:pass@localhost/graphiti

# Claude-Flow Graphiti Settings
CLAUDE_FLOW_GRAPHITI_ENABLED=true
CLAUDE_FLOW_GRAPHITI_DEFAULT_GROUP=default
CLAUDE_FLOW_GRAPHITI_MAX_NODES=10000
CLAUDE_FLOW_GRAPHITI_SYNC_INTERVAL=30000
```

### Configuration Object

```typescript
const config = {
  enabled: true,
  memory: {
    adapter: {
      enabled: true,
      defaultGroupId: 'project_name',
      maxNodes: 10000,
      maxFacts: 50000,
      enableAutoSync: true,
      syncInterval: 30000, // 30 seconds
      enableTemporalTracking: true,
      knowledgeRetentionDays: 90
    }
  },
  hiveMind: {
    integration: {
      enabled: true,
      enablePatternExtraction: true,
      enableInsightGeneration: true,
      enableKnowledgeEvolution: true,
      minPatternConfidence: 0.7,
      insightGenerationInterval: 60000 // 1 minute
    }
  }
};
```

## Architecture

### Components

1. **GraphitiMemoryAdapter**: Core adapter for memory operations
   - Episode management
   - Node and edge caching
   - Search operations
   - Temporal tracking

2. **GraphitiHiveIntegration**: Collective intelligence layer
   - Pattern extraction
   - Insight generation
   - Knowledge evolution
   - Cross-swarm sharing

3. **Configuration Module**: Runtime configuration and validation
   - MCP server detection
   - Feature flags
   - Fallback modes

### Data Flow

```
User Input → Episode Creation → Graphiti Storage
                ↓
          Entity Extraction
                ↓
          Relationship Mapping
                ↓
          Pattern Recognition → Insight Generation
                ↓
          Hive-Mind Sharing → Collective Intelligence
```

## API Reference

### GraphitiMemoryAdapter

#### Methods

- `addMemory(name, content, options)`: Add an episode to the knowledge graph
- `searchNodes(query, options)`: Search for relevant nodes
- `searchFacts(query, options)`: Search for facts/relationships
- `getRecentEpisodes(groupId, limit)`: Get recent episodes
- `updateFactValidity(edgeUuid, isValid, validUntil)`: Update temporal validity
- `shareWithHiveMind(nodeUuids, targetSwarms)`: Share knowledge with swarms
- `clearGraph()`: Clear all data from the knowledge graph
- `getStatistics()`: Get memory statistics

#### Events

- `connected`: Graphiti connection established
- `memory:added`: New episode added
- `hivemind:share`: Knowledge shared with hive-mind
- `sync:completed`: Synchronization completed
- `error`: Error occurred

### GraphitiHiveIntegration

#### Methods

- `storeHiveMindSession(session)`: Store session data
- `extractPatterns(swarmId, timeWindow)`: Extract patterns
- `generateInsights(swarmId)`: Generate insights
- `evolveKnowledge(swarmId)`: Evolve knowledge base
- `queryCollectiveKnowledge(query, swarmIds)`: Query across swarms

#### Events

- `session:stored`: Session stored in Graphiti
- `patterns:extracted`: Patterns extracted
- `insights:generated`: Insights generated
- `pattern:evolved`: Pattern evolved
- `knowledge:evolution:started`: Evolution process started

## Testing

Run the test suite:

```bash
npm test src/__tests__/memory/graphiti-adapter.test.ts
npm test src/__tests__/swarm/graphiti-hive-integration.test.ts
```

## Troubleshooting

### Graphiti MCP Server Not Available

If you see warnings about Graphiti not being available:

1. Ensure the MCP server is installed:
   ```bash
   npm install -g @mcp/graphiti
   ```

2. Check your MCP configuration includes Graphiti

3. Verify database connection settings

### Fallback Mode

When Graphiti is unavailable, the system operates in fallback mode with:
- Local memory caching only
- Limited search capabilities
- No persistent storage
- Disabled auto-sync

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to the Graphiti integration.

## License

This integration is part of Claude-Flow and follows the same license terms.