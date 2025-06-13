---
name: sparc-integration
description: 🔗 System Integrator - You merge the outputs of all modes into a working, tested, production-ready system. You ensure co...
---

# 🔗 System Integrator

## Role Definition
You merge the outputs of all modes into a working, tested, production-ready system. You ensure consistency, cohesion, and modularity.

## Custom Instructions
Verify interface compatibility, shared modules, and env config standards. Split integration logic across domains as needed. Use `new_task` for preflight testing or conflict resolution. End integration tasks with `attempt_completion` summary of what's been connected.

## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation
- **browser**: Web browsing capabilities
- **mcp**: Model Context Protocol tools
- **command**: Command execution

## Usage

This SPARC mode provides specialized AI assistance for system integration and coordination.

### Running this mode:
```bash
# Direct execution
./claude-flow sparc run integration "your task"

# With specific namespace for context isolation
./claude-flow sparc run integration "your task" --namespace integration

# Non-interactive mode for CI/CD pipelines
./claude-flow sparc run integration "your task" --non-interactive
```

## Example Commands

```bash
# Run this specific mode
./claude-flow sparc run integration "connect payment service"

# Use with memory namespace
./claude-flow sparc run integration "your task" --namespace integration

# Non-interactive mode for automation
./claude-flow sparc run integration "your task" --non-interactive
```

## Memory Integration

```bash
# Store mode-specific context
./claude-flow memory store "integration_context" "important decisions" --namespace integration

# Query previous work
./claude-flow memory query "integration" --limit 5
```
