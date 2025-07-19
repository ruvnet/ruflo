---
name: gemini-flow-help
description: Show Gemini-Flow commands and usage with batchtools optimization
---

# Gemini-Flow Commands (Batchtools Optimized)

## Core Commands with Batch Operations

### System Management (Batch Operations)
- `npx gemini-flow start` - Start orchestration system
- `npx gemini-flow status` - Check system status
- `npx gemini-flow monitor` - Real-time monitoring
- `npx gemini-flow stop` - Stop orchestration

**Batch Operations:**
```bash
# Check multiple system components in parallel
npx gemini-flow batch status --components "agents,tasks,memory,connections"

# Start multiple services concurrently
npx gemini-flow batch start --services "monitor,scheduler,coordinator"
```

### Agent Management (Parallel Operations)
- `npx gemini-flow agent spawn <type>` - Create new agent
- `npx gemini-flow agent list` - List active agents
- `npx gemini-flow agent info <id>` - Agent details
- `npx gemini-flow agent terminate <id>` - Stop agent

**Batch Operations:**
```bash
# Spawn multiple agents in parallel
npx gemini-flow agent batch-spawn "code:3,test:2,review:1"

# Get info for multiple agents concurrently
npx gemini-flow agent batch-info "agent1,agent2,agent3"

# Terminate multiple agents
npx gemini-flow agent batch-terminate --pattern "test-*"
```

### Task Management (Concurrent Processing)
- `npx gemini-flow task create <type> "description"` - Create task
- `npx gemini-flow task list` - List all tasks
- `npx gemini-flow task status <id>` - Task status
- `npx gemini-flow task cancel <id>` - Cancel task

**Batch Operations:**
```bash
# Create multiple tasks from file
npx gemini-flow task batch-create tasks.json

# Check status of multiple tasks concurrently
npx gemini-flow task batch-status --ids "task1,task2,task3"

# Process task queue in parallel
npx gemini-flow task process-queue --parallel 5
```

### Memory Operations (Bulk Processing)
- `npx gemini-flow memory store "key" "value"` - Store data
- `npx gemini-flow memory query "search"` - Search memory
- `npx gemini-flow memory stats` - Memory statistics
- `npx gemini-flow memory export <file>` - Export memory

**Batch Operations:**
```bash
# Bulk store from JSON file
npx gemini-flow memory batch-store data.json

# Parallel query across namespaces
npx gemini-flow memory batch-query "search term" --namespaces "all"

# Export multiple namespaces concurrently
npx gemini-flow memory batch-export --namespaces "project,agents,tasks"
```

### SPARC Development (Parallel Workflows)
- `npx gemini-flow sparc modes` - List SPARC modes
- `npx gemini-flow sparc run <mode> "task"` - Run mode
- `npx gemini-flow sparc tdd "feature"` - TDD workflow
- `npx gemini-flow sparc info <mode>` - Mode details

**Batch Operations:**
```bash
# Run multiple SPARC modes in parallel
npx gemini-flow sparc batch-run --modes "spec:task1,architect:task2,code:task3"

# Execute parallel TDD for multiple features
npx gemini-flow sparc batch-tdd features.json

# Analyze multiple components concurrently
npx gemini-flow sparc batch-analyze --components "auth,api,database"
```

### Swarm Coordination (Enhanced Parallelization)
- `npx gemini-flow swarm "task" --strategy <type>` - Start swarm
- `npx gemini-flow swarm "task" --background` - Long-running swarm
- `npx gemini-flow swarm "task" --monitor` - With monitoring

**Batch Operations:**
```bash
# Launch multiple swarms for different components
npx gemini-flow swarm batch --config swarms.json

# Coordinate parallel swarm strategies
npx gemini-flow swarm multi-strategy "project" --strategies "dev:frontend,test:backend,docs:api"
```

## Advanced Batch Examples

### Parallel Development Workflow:
```bash
# Initialize complete project setup in parallel
npx gemini-flow batch init --actions "memory:setup,agents:spawn,tasks:queue"

# Run comprehensive analysis
npx gemini-flow batch analyze --targets "code:quality,security:audit,performance:profile"
```

### Concurrent Testing Suite:
```bash
# Execute parallel test suites
npx gemini-flow sparc batch-test --suites "unit,integration,e2e" --parallel

# Generate reports concurrently
npx gemini-flow batch report --types "coverage,performance,security"
```

### Bulk Operations:
```bash
# Process multiple files in parallel
npx gemini-flow batch process --files "*.ts" --action "lint,format,analyze"

# Parallel code generation
npx gemini-flow batch generate --templates "api:users,api:products,api:orders"
```

## Performance Tips
- Use `--parallel` flag for concurrent operations
- Batch similar operations to reduce overhead
- Leverage `--async` for non-blocking execution
- Use `--stream` for real-time progress updates
- Enable `--cache` for repeated operations

## Monitoring Batch Operations
```bash
# Real-time batch monitoring
npx gemini-flow monitor --batch

# Batch operation statistics
npx gemini-flow stats --batch-ops

# Performance profiling
npx gemini-flow profile --batch-execution
```