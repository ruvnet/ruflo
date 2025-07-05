# Memory Management

## 🎯 Key Principle
**This tool coordinates Claude Code's actions. It does NOT write code or create content.**

## MCP Tool Usage in Claude Code

**Tool:** `mcp__ruv-swarm__memory_usage`

## Parameters
```json
{"detail": "detailed"}
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
1. Use the tool: `mcp__ruv-swarm__memory_usage`
2. With parameters: `{"detail": "detailed"}`
3. Claude Code then executes the coordinated plan using its native tools

## Important Reminders
- ✅ This tool provides coordination and structure
- ✅ Claude Code performs all actual implementation
- ❌ The tool does NOT write code
- ❌ The tool does NOT access files directly
- ❌ The tool does NOT execute commands

## See Also
- Main documentation: /claude.md
- Other commands in this category
- Workflow examples in /workflows/
