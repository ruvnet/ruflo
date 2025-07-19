# Smart Agent Auto-Spawning

## Purpose
Automatically spawn the right agents at the right time without manual intervention.

## Auto-Spawning Triggers

### 1. File Type Detection
When editing files, agents auto-spawn:
- **JavaScript/TypeScript**: Coder agent
- **Markdown**: Researcher agent
- **JSON/YAML**: Analyst agent
- **Multiple files**: Coordinator agent

### 2. Task Complexity
```
Simple task: "Fix typo"
→ Single coordinator agent

Complex task: "Implement OAuth with Google"
→ Architect + Coder + Tester + Researcher
```

### 3. Dynamic Scaling
The system monitors workload and spawns additional agents when:
- Task queue grows
- Complexity increases
- Parallel opportunities exist

## Configuration
Already enabled in settings.json:
```json
{
  "hooks": [{
    "matcher": "^Task$",
    "command": "npx ruv-swarm hook pre-task --auto-spawn-agents"
  }]
}
```

## Benefits
- 🤖 Zero manual agent management
- 🎯 Perfect agent selection
- 📈 Dynamic scaling
- 💾 Resource efficiency