# Development Workflow Coordination

## Purpose
Structure Claude Code's approach to complex development tasks for maximum efficiency.

## Step-by-Step Coordination

### 1. Initialize Development Framework
```
Tool: mcp__ruv-swarm__swarm_init
Parameters: {"topology": "hierarchical", "maxAgents": 8, "strategy": "specialized"}
```
Creates hierarchical structure for organized, top-down development.

### 2. Define Development Perspectives
```
Tool: mcp__ruv-swarm__agent_spawn
Parameters: {"type": "architect", "name": "System Design"}
```
```
Tool: mcp__ruv-swarm__agent_spawn
Parameters: {"type": "coder", "name": "Implementation Focus"}
```
Sets up architectural and implementation thinking patterns.

### 3. Coordinate Implementation
```
Tool: mcp__ruv-swarm__task_orchestrate
Parameters: {"task": "Build REST API with authentication", "strategy": "parallel", "priority": "high"}
```

## What Claude Code Actually Does
1. Uses **Write** tool to create new files
2. Uses **Edit/MultiEdit** tools for code modifications
3. Uses **Bash** tool for testing and building
4. Uses **TodoWrite** tool for task tracking
5. Follows coordination patterns for systematic implementation

Remember: All code is written by Claude Code using its native tools!