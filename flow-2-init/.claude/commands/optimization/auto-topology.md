# Automatic Topology Selection

## Purpose
Automatically select the optimal swarm topology based on task complexity analysis.

## How It Works

### 1. Task Analysis
The system analyzes your task description to determine:
- Complexity level (simple/medium/complex)
- Required agent types
- Estimated duration
- Resource requirements

### 2. Topology Selection
Based on analysis, it selects:
- **Star**: For simple, centralized tasks
- **Mesh**: For medium complexity with flexibility needs
- **Hierarchical**: For complex tasks requiring structure
- **Ring**: For sequential processing workflows

### 3. Example Usage

**Simple Task:**
```
Tool: mcp__ruv-swarm__task_orchestrate
Parameters: {"task": "Fix typo in README.md"}
Result: Automatically uses star topology with single agent
```

**Complex Task:**
```
Tool: mcp__ruv-swarm__task_orchestrate
Parameters: {"task": "Refactor authentication system with JWT, add tests, update documentation"}
Result: Automatically uses hierarchical topology with architect, coder, and tester agents
```

## Benefits
- 🎯 Optimal performance for each task type
- 🤖 Automatic agent assignment
- ⚡ Reduced setup time
- 📊 Better resource utilization

## Hook Configuration
The pre-task hook automatically handles topology selection:
```json
{
  "command": "npx ruv-swarm hook pre-task --auto-spawn-agents --optimize-topology"
}
```