# Memory Management

## 🎯 Key Principle
**This tool coordinates Claude Code's actions. It does NOT write code or create content.**

## MCP Tool Usage in Claude Code

**Tool:** `mcp__claude-flow__memory_usage`

## Parameters
```json
{
  "action": "retrieve",
  "namespace": "default"
}
```

## Description
Track persistent memory usage across Claude Code sessions

## Details
Memory helps Claude Code:
- Maintain context between sessions
- Remember project decisions
- Track implementation patterns
- Store coordination strategies that worked well

## Example Usage

**In Claude Code:**
1. Store memory: Use tool `mcp__claude-flow__memory_usage` with parameters `{"action": "store", "key": "project_context", "value": "authentication system design"}`
2. Retrieve memory: Use tool `mcp__claude-flow__memory_usage` with parameters `{"action": "retrieve", "key": "project_context"}`
3. List memories: Use tool `mcp__claude-flow__memory_usage` with parameters `{"action": "list", "namespace": "default"}`
4. Search memories: Use tool `mcp__claude-flow__memory_search` with parameters `{"pattern": "auth*"}`

## Important Reminders
- ✅ This tool provides coordination and structure
- ✅ Claude Code performs all actual implementation
- ❌ The tool does NOT write code
- ❌ The tool does NOT access files directly
- ❌ The tool does NOT execute commands

## See Also
- Main documentation: /CLAUDE.md
- Other commands in this category
- Workflow examples in /workflows/
