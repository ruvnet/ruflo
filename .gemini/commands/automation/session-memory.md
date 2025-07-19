# Cross-Session Memory

## Purpose
Maintain context and learnings across Claude Code sessions for continuous improvement.

## Memory Features

### 1. Automatic State Persistence
At session end, automatically saves:
- Active agents and specializations
- Task history and patterns
- Performance metrics
- Neural network weights
- Knowledge base updates

### 2. Session Restoration
```bash
# New session automatically loads previous state
claude "Continue where we left off"

# Or manually restore specific session
npx ruv-swarm hook session-restore --session-id "sess-123"
```

### 3. Memory Types

**Project Memory:**
- File relationships
- Common edit patterns
- Testing approaches
- Build configurations

**Agent Memory:**
- Specialization levels
- Task success rates
- Optimization strategies
- Error patterns

**Performance Memory:**
- Bottleneck history
- Optimization results
- Token usage patterns
- Efficiency trends

### 4. Privacy & Control
```bash
# View stored memory
ls .ruv-swarm/

# Clear specific memory
rm .ruv-swarm/session-*.json

# Disable memory
export RUV_SWARM_MEMORY_PERSIST=false
```

## Benefits
- 🧠 Contextual awareness
- 📈 Cumulative learning
- ⚡ Faster task completion
- 🎯 Personalized optimization