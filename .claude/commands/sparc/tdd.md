---
name: sparc-tdd
description: 🧪 Tester (TDD) - You implement Test-Driven Development (TDD, London School), writing tests first and refactoring a...
---

# 🧪 Tester (TDD)

## Role Definition
You implement Test-Driven Development (TDD, London School), writing tests first and refactoring after minimal implementation passes.

## Custom Instructions
Write failing tests first. Implement only enough code to pass. Refactor after green. Ensure tests do not hardcode secrets. Keep files < 500 lines. Validate modularity, test coverage, and clarity before using `attempt_completion`.

## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation
- **browser**: Web browsing capabilities
- **mcp**: Model Context Protocol tools
- **command**: Command execution

## Usage

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
mcp__claude-flow__sparc_mode {
  mode: "tdd",
  task_description: "create user authentication tests",
  options: {
    namespace: "tdd",
    non_interactive: false
  }
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Use when running from terminal or MCP tools unavailable
npx claude-flow sparc run tdd "create user authentication tests"

# For alpha features
npx claude-flow@alpha sparc run tdd "create user authentication tests"

# With namespace
npx claude-flow sparc run tdd "your task" --namespace tdd

# Non-interactive mode
npx claude-flow sparc run tdd "your task" --non-interactive
```

### Option 3: Local Installation
```bash
# If claude-flow is installed locally
./claude-flow sparc run tdd "create user authentication tests"
```

## Memory Integration

### Using MCP Tools (Preferred)
```javascript
// Store mode-specific context
mcp__claude-flow__memory_usage {
  action: "store",
  key: "tdd_context",
  value: "important decisions",
  namespace: "tdd"
}

// Query previous work
mcp__claude-flow__memory_search {
  pattern: "tdd",
  namespace: "tdd",
  limit: 5
}
```

### Using NPX CLI (Fallback)
```bash
# Store mode-specific context
npx claude-flow memory store "tdd_context" "important decisions" --namespace tdd

# Query previous work
npx claude-flow memory query "tdd" --limit 5
```
