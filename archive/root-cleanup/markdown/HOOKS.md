# 🔗 Claude-Flow Hooks Documentation

## Overview

Claude-Flow hooks provide powerful lifecycle event management for automated preparation, tracking, and cleanup during development workflows. These hooks integrate seamlessly with swarm coordination and enable sophisticated automation patterns.

## Available Hooks

### 1. Pre-Task Hook (`pre-task`)

Execute before any task begins to prepare the environment and load context.

**Usage:**
```bash
npx claude-flow hooks pre-task --description "Task description" [options]
```

**Options:**
- `--description <desc>` - Task description (required)
- `--task-id <id>` - Task identifier for tracking
- `--agent-id <id>` - Executing agent identifier
- `--auto-spawn-agents` - Auto-spawn agents for task (default: true)

**Example:**
```bash
# Basic task preparation
npx claude-flow hooks pre-task --description "Build REST API"

# With full options
npx claude-flow hooks pre-task \
  --description "Implement authentication system" \
  --task-id "auth-123" \
  --agent-id "coder-456" \
  --auto-spawn-agents true
```

**What it does:**
- Loads previous session context
- Prepares workspace environment
- Auto-spawns appropriate agents based on task
- Sets up coordination memory
- Validates prerequisites

### 2. Post-Task Hook (`post-task`)

Execute after task completion for analysis and cleanup.

**Usage:**
```bash
npx claude-flow hooks post-task --task-id <id> [options]
```

**Options:**
- `--task-id <id>` - Task identifier (required)
- `--analyze-performance` - Generate performance analysis
- `--generate-insights` - Create AI-powered insights

**Example:**
```bash
# Basic completion
npx claude-flow hooks post-task --task-id "auth-123"

# With full analysis
npx claude-flow hooks post-task \
  --task-id "auth-123" \
  --analyze-performance \
  --generate-insights
```

**What it does:**
- Captures task metrics
- Stores completion status
- Generates performance reports
- Creates insights for future improvements
- Updates swarm memory with learnings

### 3. Pre-Edit Hook (`pre-edit`)

Execute before file modifications for backup and validation.

**Usage:**
```bash
npx claude-flow hooks pre-edit --file <path> [options]
```

**Options:**
- `--file <path>` - Target file path (required)
- `--operation <type>` - Edit operation type: edit, create, delete

**Example:**
```bash
# Before editing existing file
npx claude-flow hooks pre-edit --file "src/api.js" --operation edit

# Before creating new file
npx claude-flow hooks pre-edit --file "src/auth.js" --operation create
```

**What it does:**
- Creates file backups
- Validates file permissions
- Checks for conflicts
- Loads file-specific context
- Prepares formatting rules

### 4. Post-Edit Hook (`post-edit`)

Execute after file modifications for tracking and coordination.

**Usage:**
```bash
npx claude-flow hooks post-edit --file <path> [options]
```

**Options:**
- `--file <path>` - Modified file path (required)
- `--memory-key <key>` - Coordination memory key for storing edit info

**Example:**
```bash
# Basic tracking
npx claude-flow hooks post-edit --file "src/api.js"

# With swarm coordination
npx claude-flow hooks post-edit \
  --file "src/api.js" \
  --memory-key "swarm/auth-swarm/edits/api-endpoint"
```

**What it does:**
- Auto-formats code based on file type
- Updates coordination memory
- Tracks changes for other agents
- Triggers related validations
- Updates task progress

### 5. Session-End Hook (`session-end`)

Execute at session termination for cleanup and export.

**Usage:**
```bash
npx claude-flow hooks session-end [options]
```

**Options:**
- `--export-metrics` - Export session performance metrics
- `--swarm-id <id>` - Swarm identifier for coordination cleanup
- `--generate-summary` - Create comprehensive session summary

**Example:**
```bash
# Basic cleanup
npx claude-flow hooks session-end

# Full export and summary
npx claude-flow hooks session-end \
  --export-metrics \
  --generate-summary \
  --swarm-id "auth-swarm-123"
```

**What it does:**
- Saves session state
- Exports performance metrics
- Generates session summary
- Cleans up temporary resources
- Updates persistent memory

## Integration with Claude Code

### Automatic Hook Configuration

Hooks are pre-configured in `.claude/settings.json` for seamless integration:

```json
{
  "hooks": {
    "pre-task": {
      "enabled": true,
      "auto-spawn-agents": true,
      "load-context": true
    },
    "post-edit": {
      "enabled": true,
      "auto-format": true,
      "update-memory": true
    },
    "session-end": {
      "enabled": true,
      "export-metrics": true,
      "generate-summary": true
    }
  }
}
```

### Agent Coordination Protocol

When using swarms, every agent MUST follow this coordination protocol:

```bash
# 1. Before starting work
npx claude-flow hooks pre-task --description "Agent task"

# 2. After each file operation
npx claude-flow hooks post-edit --file "path/to/file" --memory-key "swarm/agent/step"

# 3. After completing work
npx claude-flow hooks post-task --task-id "task-123" --analyze-performance
```

## Advanced Features

### Auto-Formatting

Post-edit hooks automatically format code based on file type:
- JavaScript/TypeScript: Prettier
- Python: Black
- Go: gofmt
- Rust: rustfmt
- CSS/SCSS: Prettier

### Performance Tracking

Hooks collect detailed metrics:
- Token usage per operation
- Execution time
- Success/failure rates
- Resource utilization
- Coordination efficiency

### Neural Pattern Learning

Successful operations train neural patterns for:
- Better agent assignment
- Improved task decomposition
- Optimized topology selection
- Enhanced error prediction

### Memory Coordination

Hooks maintain persistent memory for:
- Cross-session context
- Agent coordination state
- Task dependencies
- Performance history
- Learning patterns

## Best Practices

### 1. Always Use Pre-Task Hooks
```bash
# ✅ Good: Prepare context before starting
npx claude-flow hooks pre-task --description "Build feature X"

# ❌ Bad: Jump directly into work without preparation
```

### 2. Track All File Operations
```bash
# ✅ Good: Track every edit for coordination
npx claude-flow hooks post-edit --file "src/api.js" --memory-key "api/updates/1"

# ❌ Bad: Edit files without tracking
```

### 3. Generate Insights
```bash
# ✅ Good: Learn from completed tasks
npx claude-flow hooks post-task --task-id "feature-x" --generate-insights

# ❌ Bad: Complete tasks without analysis
```

### 4. Export Session Data
```bash
# ✅ Good: Save session state for continuity
npx claude-flow hooks session-end --export-metrics --generate-summary

# ❌ Bad: End sessions without saving state
```

## Troubleshooting

### Hook Not Executing

1. Check if hooks are enabled in `.claude/settings.json`
2. Verify claude-flow is properly installed: `npm list claude-flow`
3. Ensure you're using the correct command syntax
4. Check for error messages in the output

### Memory Key Conflicts

Use hierarchical naming for memory keys:
```bash
# Good: Hierarchical and unique
--memory-key "swarm/auth-123/agent/coder-1/step/implement-jwt"

# Bad: Too generic
--memory-key "edit-1"
```

### Performance Issues

1. Disable auto-formatting for large files
2. Use batch operations for multiple edits
3. Limit metric collection frequency
4. Clean up old session data regularly

### Agent Coordination Problems

1. Ensure all agents use the same swarm ID
2. Check memory synchronization with `claude-flow memory list`
3. Verify network connectivity for distributed agents
4. Review coordination logs in `.claude/logs/`

## Examples

### Complete Workflow Example

```bash
# 1. Start task with preparation
npx claude-flow hooks pre-task \
  --description "Implement user authentication" \
  --task-id "auth-impl" \
  --auto-spawn-agents

# 2. Track file creation
npx claude-flow hooks pre-edit --file "src/auth/jwt.js" --operation create
# ... create file ...
npx claude-flow hooks post-edit \
  --file "src/auth/jwt.js" \
  --memory-key "auth/jwt/created"

# 3. Track modifications
npx claude-flow hooks pre-edit --file "src/server.js" --operation edit
# ... edit file ...
npx claude-flow hooks post-edit \
  --file "src/server.js" \
  --memory-key "auth/server/integrated"

# 4. Complete task with analysis
npx claude-flow hooks post-task \
  --task-id "auth-impl" \
  --analyze-performance \
  --generate-insights

# 5. End session with full export
npx claude-flow hooks session-end \
  --export-metrics \
  --generate-summary \
  --swarm-id "auth-swarm"
```

### Swarm Coordination Example

```bash
# Agent 1: API Developer
npx claude-flow hooks pre-task --description "Build API endpoints" --agent-id "api-dev"
npx claude-flow hooks post-edit --file "src/routes/users.js" --memory-key "swarm/api/routes/users"

# Agent 2: Database Designer (checks Agent 1's work)
npx claude-flow memory retrieve --key "swarm/api/routes/users"
npx claude-flow hooks pre-task --description "Design user schema" --agent-id "db-designer"
npx claude-flow hooks post-edit --file "src/models/user.js" --memory-key "swarm/db/models/user"

# Coordinator: Reviews all work
npx claude-flow memory list --pattern "swarm/*"
npx claude-flow hooks post-task --task-id "api-build" --generate-insights
```

## Hook Configuration Reference

### Environment Variables

```bash
# Disable specific hooks
CLAUDE_FLOW_DISABLE_PRE_TASK=true
CLAUDE_FLOW_DISABLE_POST_EDIT=true

# Custom hook timeouts (ms)
CLAUDE_FLOW_HOOK_TIMEOUT=30000

# Memory storage location
CLAUDE_FLOW_MEMORY_PATH=./custom-memory

# Metric export format
CLAUDE_FLOW_METRIC_FORMAT=json  # or csv, yaml
```

### Configuration File (`.claude/hooks.config.json`)

```json
{
  "preTask": {
    "autoSpawnAgents": true,
    "loadPreviousContext": true,
    "validatePrerequisites": true,
    "agentAssignment": {
      "*.js": ["coder", "tester"],
      "*.py": ["coder", "analyst"],
      "*.md": ["documenter", "reviewer"]
    }
  },
  "postEdit": {
    "autoFormat": {
      "enabled": true,
      "languages": {
        "javascript": "prettier",
        "python": "black",
        "go": "gofmt"
      }
    },
    "memoryUpdate": {
      "enabled": true,
      "includeContent": false,
      "includeDiff": true
    }
  },
  "sessionEnd": {
    "exportPath": "./.claude/exports",
    "summaryFormat": "markdown",
    "includeMetrics": true,
    "cleanupTemp": true
  }
}
```

## Support

For issues or questions about hooks:
- GitHub Issues: https://github.com/ruvnet/claude-code-flow/issues
- Documentation: https://github.com/ruvnet/claude-code-flow
- Examples: `.claude/commands/` directory in your project