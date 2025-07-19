# Multi-Repo Swarm - Cross-Repository Swarm Orchestration

## Overview
Coordinate AI swarms across multiple repositories, enabling organization-wide automation and intelligent cross-project collaboration.

## Core Features

### 1. Cross-Repo Initialization
```bash
# Initialize multi-repo swarm
npx ruv-swarm github multi-repo-init \
  --repos "org/frontend,org/backend,org/shared" \
  --topology hierarchical \
  --shared-memory \
  --sync-strategy eventual
```

### 2. Repository Discovery
```bash
# Auto-discover related repositories
npx ruv-swarm github discover-repos \
  --org "my-organization" \
  --filter "language:typescript" \
  --analyze-dependencies \
  --suggest-swarm-topology
```

### 3. Synchronized Operations
```bash
# Execute synchronized changes across repos
npx ruv-swarm github multi-repo-execute \
  --task "update-dependencies" \
  --repos "org/*-service" \
  --create-prs \
  --link-prs
```

## Configuration

### Multi-Repo Config File
```yaml
# .swarm/multi-repo.yml
version: 1
organization: my-org
repositories:
  - name: frontend
    url: github.com/my-org/frontend
    role: ui
    agents: [coder, designer, tester]
    
  - name: backend
    url: github.com/my-org/backend
    role: api
    agents: [architect, coder, tester]
    
  - name: shared
    url: github.com/my-org/shared
    role: library
    agents: [analyst, coder]

coordination:
  topology: hierarchical
  communication: webhook
  memory: redis://shared-memory
  
dependencies:
  - from: frontend
    to: [backend, shared]
  - from: backend
    to: [shared]
```

### Repository Roles
```javascript
// Define repository roles and responsibilities
{
  "roles": {
    "ui": {
      "responsibilities": ["user-interface", "ux", "accessibility"],
      "default-agents": ["designer", "coder", "tester"]
    },
    "api": {
      "responsibilities": ["endpoints", "business-logic", "data"],
      "default-agents": ["architect", "coder", "security"]
    },
    "library": {
      "responsibilities": ["shared-code", "utilities", "types"],
      "default-agents": ["analyst", "coder", "documenter"]
    }
  }
}
```

## Orchestration Commands

### Dependency Management
```bash
# Update dependencies across all repos
npx ruv-swarm github multi-repo-deps \
  --update "typescript@5.0.0" \
  --test-each \
  --rollback-on-failure \
  --create-tracking-issue
```

### Refactoring Operations
```bash
# Coordinate large-scale refactoring
npx ruv-swarm github multi-repo-refactor \
  --pattern "rename:OldAPI->NewAPI" \
  --analyze-impact \
  --create-migration-guide \
  --staged-rollout
```

### Security Updates
```bash
# Coordinate security patches
npx ruv-swarm github multi-repo-security \
  --scan-all \
  --patch-vulnerabilities \
  --verify-fixes \
  --compliance-report
```

## Communication Strategies

### 1. Webhook-Based Coordination
```javascript
// webhook-coordinator.js
const { MultiRepoSwarm } = require('ruv-swarm');

const swarm = new MultiRepoSwarm({
  webhook: {
    url: 'https://swarm-coordinator.example.com',
    secret: process.env.WEBHOOK_SECRET
  }
});

// Handle cross-repo events
swarm.on('repo:update', async (event) => {
  await swarm.propagate(event, {
    to: event.dependencies,
    strategy: 'eventual-consistency'
  });
});
```

### 2. GraphQL Federation
```graphql
# Federated schema for multi-repo queries
type Repository @key(fields: "id") {
  id: ID!
  name: String!
  swarmStatus: SwarmStatus!
  dependencies: [Repository!]!
  agents: [Agent!]!
}

type SwarmStatus {
  active: Boolean!
  topology: Topology!
  tasks: [Task!]!
  memory: JSON!
}
```

### 3. Event Streaming
```yaml
# Kafka configuration for real-time coordination
kafka:
  brokers: ['kafka1:9092', 'kafka2:9092']
  topics:
    swarm-events: 
      partitions: 10
      replication: 3
    swarm-memory:
      partitions: 5
      replication: 3
```

## Advanced Features

### 1. Distributed Task Queue
```bash
# Create distributed task queue
npx ruv-swarm github multi-repo-queue \
  --backend redis \
  --workers 10 \
  --priority-routing \
  --dead-letter-queue
```

### 2. Cross-Repo Testing
```bash
# Run integration tests across repos
npx ruv-swarm github multi-repo-test \
  --setup-test-env \
  --link-services \
  --run-e2e \
  --tear-down
```

### 3. Monorepo Migration
```bash
# Assist in monorepo migration
npx ruv-swarm github to-monorepo \
  --analyze-repos \
  --suggest-structure \
  --preserve-history \
  --create-migration-prs
```

## Monitoring & Visualization

### Multi-Repo Dashboard
```bash
# Launch monitoring dashboard
npx ruv-swarm github multi-repo-dashboard \
  --port 3000 \
  --metrics "agent-activity,task-progress,memory-usage" \
  --real-time
```

### Dependency Graph
```bash
# Visualize repo dependencies
npx ruv-swarm github dep-graph \
  --format mermaid \
  --include-agents \
  --show-data-flow
```

### Health Monitoring
```bash
# Monitor swarm health across repos
npx ruv-swarm github health-check \
  --repos "org/*" \
  --check "connectivity,memory,agents" \
  --alert-on-issues
```

## Synchronization Patterns

### 1. Eventually Consistent
```javascript
// Eventual consistency for non-critical updates
{
  "sync": {
    "strategy": "eventual",
    "max-lag": "5m",
    "retry": {
      "attempts": 3,
      "backoff": "exponential"
    }
  }
}
```

### 2. Strong Consistency
```javascript
// Strong consistency for critical operations
{
  "sync": {
    "strategy": "strong",
    "consensus": "raft",
    "quorum": 0.51,
    "timeout": "30s"
  }
}
```

### 3. Hybrid Approach
```javascript
// Mix of consistency levels
{
  "sync": {
    "default": "eventual",
    "overrides": {
      "security-updates": "strong",
      "dependency-updates": "strong",
      "documentation": "eventual"
    }
  }
}
```

## Use Cases

### 1. Microservices Coordination
```bash
# Coordinate microservices development
npx ruv-swarm github microservices \
  --services "auth,users,orders,payments" \
  --ensure-compatibility \
  --sync-contracts \
  --integration-tests
```

### 2. Library Updates
```bash
# Update shared library across consumers
npx ruv-swarm github lib-update \
  --library "org/shared-lib" \
  --version "2.0.0" \
  --find-consumers \
  --update-imports \
  --run-tests
```

### 3. Organization-Wide Changes
```bash
# Apply org-wide policy changes
npx ruv-swarm github org-policy \
  --policy "add-security-headers" \
  --repos "org/*" \
  --validate-compliance \
  --create-reports
```

## Best Practices

### 1. Repository Organization
- Clear repository roles and boundaries
- Consistent naming conventions
- Documented dependencies
- Shared configuration standards

### 2. Communication
- Use appropriate sync strategies
- Implement circuit breakers
- Monitor latency and failures
- Clear error propagation

### 3. Security
- Secure cross-repo authentication
- Encrypted communication channels
- Audit trail for all operations
- Principle of least privilege

## Performance Optimization

### Caching Strategy
```bash
# Implement cross-repo caching
npx ruv-swarm github cache-strategy \
  --analyze-patterns \
  --suggest-cache-layers \
  --implement-invalidation
```

### Parallel Execution
```bash
# Optimize parallel operations
npx ruv-swarm github parallel-optimize \
  --analyze-dependencies \
  --identify-parallelizable \
  --execute-optimal
```

### Resource Pooling
```bash
# Pool resources across repos
npx ruv-swarm github resource-pool \
  --share-agents \
  --distribute-load \
  --monitor-usage
```

## Troubleshooting

### Connectivity Issues
```bash
# Diagnose connectivity problems
npx ruv-swarm github diagnose-connectivity \
  --test-all-repos \
  --check-permissions \
  --verify-webhooks
```

### Memory Synchronization
```bash
# Debug memory sync issues
npx ruv-swarm github debug-memory \
  --check-consistency \
  --identify-conflicts \
  --repair-state
```

### Performance Bottlenecks
```bash
# Identify performance issues
npx ruv-swarm github perf-analysis \
  --profile-operations \
  --identify-bottlenecks \
  --suggest-optimizations
```

## Examples

### Full-Stack Application Update
```bash
# Update full-stack application
npx ruv-swarm github fullstack-update \
  --frontend "org/web-app" \
  --backend "org/api-server" \
  --database "org/db-migrations" \
  --coordinate-deployment
```

### Cross-Team Collaboration
```bash
# Facilitate cross-team work
npx ruv-swarm github cross-team \
  --teams "frontend,backend,devops" \
  --task "implement-feature-x" \
  --assign-by-expertise \
  --track-progress
```

See also: [swarm-pr.md](./swarm-pr.md), [project-board-sync.md](./project-board-sync.md)