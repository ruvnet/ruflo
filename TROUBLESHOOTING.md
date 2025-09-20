# Claude Flow Troubleshooting Guide

## 🚨 Common Issues & Solutions

### 1. MCP Server Connection Issues

**Symptom**: `mcp__claude-flow__swarm_init` returns error or doesn't respond

**Solutions**:
```bash
# Check if server is running
ps aux | grep claude-flow

# Restart the server
pkill -f "claude-flow-mcp"
# Wait 2 seconds
# Start new Claude Code session

# Verify configuration
cat ~/.claude_fixed.json | grep -A 10 "claude-flow"
```

### 2. Agents Not Spawning in Parallel

**Symptom**: Agents execute sequentially instead of concurrently

**Solution**: ALWAYS use BatchTool pattern
```javascript
// ❌ WRONG - Multiple messages
Message 1: mcp__claude-flow__agent_spawn
Message 2: mcp__claude-flow__agent_spawn

// ✅ CORRECT - Single message
[BatchTool]:
  mcp__claude-flow__agent_spawn { type: "researcher" }
  mcp__claude-flow__agent_spawn { type: "coder" }
  mcp__claude-flow__agent_spawn { type: "analyst" }
```

### 3. Memory Not Persisting

**Symptom**: Memory lost between sessions

**Solutions**:
```javascript
// Store with proper namespace
mcp__claude-flow__memory_usage {
  action: "store",
  key: "project/feature/data",  // Use hierarchical keys
  value: JSON.stringify(data),
  namespace: "default",
  ttl: 86400  // 24 hours
}

// Retrieve with same namespace
mcp__claude-flow__memory_usage {
  action: "retrieve",
  key: "project/feature/data",
  namespace: "default"
}
```

### 4. ParaThinker Not Reaching Consensus

**Symptom**: 8 agents give 8 different solutions

**Solution**: Enforce distinct strategies
```javascript
// Be explicit about approach constraints
Task("ONLY use geometric methods. DO NOT use algebra or numerical.", ...)
Task("ONLY use algebraic transformation. DO NOT use geometry.", ...)
Task("ONLY use numerical approximation. DO NOT use symbolic.", ...)
```

### 5. Token Limit Exceeded

**Symptom**: "Maximum context length exceeded"

**Solutions**:
```bash
# Reduce agent count
mcp__claude-flow__swarm_init { maxAgents: 5 }  # Instead of 8

# Or use lighter agent types
"researcher" → lighter than "ml-developer"
"analyst" → lighter than "system-architect"

# Or split task into phases
Phase 1: Research (3 agents)
Phase 2: Implementation (3 agents)
Phase 3: Validation (2 agents)
```

### 6. Hooks Not Executing

**Symptom**: Agents not coordinating properly

**Solution**: Explicit hook instructions in Task
```javascript
Task(`
You are [Agent Type].

MANDATORY: Execute these hooks:
1. START: npx claude-flow@alpha hooks pre-task --description "[task]"
2. AFTER EACH FILE: npx claude-flow@alpha hooks post-edit --file "[file]"
3. END: npx claude-flow@alpha hooks post-task --task-id "[id]"

Your task: [specific task]
`, "agent-type")
```

### 7. Version Mismatch Issues

**Symptom**: Features not working as expected

**Check & Update**:
```bash
# Check current version
cat ~/Documents/Cline/MCP/claude-flow-mcp/package.json | grep version

# Update to latest
cd ~/Documents/Cline/MCP/claude-flow-mcp
git stash
git pull origin main
npm install

# Restart Claude Code
```

### 8. Swarm Status Unknown

**Symptom**: Can't tell if swarm is working

**Diagnostic Commands**:
```javascript
// Check swarm health
mcp__claude-flow__swarm_status {}

// Get detailed metrics
mcp__claude-flow__performance_report { format: "detailed" }

// Analyze bottlenecks
mcp__claude-flow__bottleneck_analyze { component: "swarm" }
```

### 9. Enhanced Memory Connection Issues

**Symptom**: `mcp__enhanced-memory-mcp__` tools not working

**Solutions**:
```bash
# Check if server is running
ps aux | grep enhanced-memory

# Verify Python environment
/Users/marc/Documents/Cline/MCP/.unified_environments/base_mcp/venv/bin/python --version

# Test directly
cd /Users/marc/Documents/Cline/MCP/enhanced-memory-mcp
python server.py  # Should show "Server started"
```

### 10. Slow Performance

**Symptom**: Operations taking too long

**Optimizations**:
```javascript
// Use appropriate topology
"mesh" → Best for independent tasks (ParaThinker)
"hierarchical" → Best for organized workflows
"ring" → Best for sequential processing
"star" → Best for centralized coordination

// Limit scope
mcp__claude-flow__swarm_init { 
  maxAgents: 4,  // Start small
  strategy: "balanced"  // Not "parallel" for everything
}

// Cache results
mcp__claude-flow__memory_usage {
  action: "store",
  key: "cache/expensive-operation",
  value: result,
  ttl: 3600  // 1 hour cache
}
```

## 🔍 Diagnostic Checklist

Run this when things aren't working:

```bash
# 1. Check all processes
ps aux | grep -E "claude-flow|enhanced-memory|mcp"

# 2. Verify configuration
cat ~/.claude_fixed.json | grep -E "claude-flow|enhanced-memory" -A 5

# 3. Test MCP tools
mcp__claude-flow__swarm_status {}
mcp__enhanced-memory-mcp__get_memory_status {}

# 4. Check logs
tail -f ~/.claude-flow/logs/error.log

# 5. Memory diagnostics
mcp__claude-flow__memory_usage { action: "list" }

# 6. Performance check
mcp__claude-flow__performance_report { format: "summary" }
```

## 🆘 Emergency Recovery

If everything is broken:

```bash
# 1. Kill all MCP processes
pkill -f mcp

# 2. Clear corrupted state
rm -rf ~/.claude-flow/sessions/*
rm -rf ~/.claude-flow/metrics/*

# 3. Reset configuration
cd ~/Documents/Cline/MCP/claude-flow-mcp
git checkout -- .
git pull origin main

# 4. Restart Claude Code
# Open new session

# 5. Reinitialize
mcp__claude-flow__swarm_init { topology: "mesh", maxAgents: 3 }
```

## 📞 Getting Help

1. **Check Logs**: `~/.claude-flow/logs/`
2. **GitHub Issues**: https://github.com/ruvnet/claude-flow/issues
3. **Documentation**: https://github.com/ruvnet/claude-flow/docs
4. **Memory Check**: Search stored patterns
   ```javascript
   mcp__enhanced-memory-mcp__search_nodes {
     query: "error solution fix",
     entity_types: ["solution", "pattern"]
   }
   ```

## 🎯 Prevention Tips

1. **Always use BatchTool** for multiple operations
2. **Store important decisions** in memory immediately
3. **Use appropriate agent counts** (start small, scale up)
4. **Monitor token usage** with performance reports
5. **Test hooks** in Task instructions explicitly
6. **Keep Claude Flow updated** (check weekly)

---

**Quick Fix Reminder**: Most issues resolve by restarting Claude Code and ensuring all operations are in a single BatchTool message!