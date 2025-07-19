# Memory Management

## 🎯 Key Principle
**This tool coordinates Gemini CLI's actions. It does NOT write code or create content.**

## MCP Tool Usage in Gemini CLI

**Tool:** `mcp__claude-flow__memory_usage`

## Parameters
```json
{"detail": "detailed"}
```

## Description
Track persistent memory usage across Gemini CLI sessions

## Details
Memory helps Gemini CLI:
- Maintain context between sessions
- Remember project decisions
- Track implementation patterns
- Store coordination strategies that worked well

## Example Usage

**In Gemini CLI:**
1. Use the tool: `mcp__claude-flow__memory_usage`
2. With parameters: `{"detail": "detailed"}`
3. Gemini CLI then executes the coordinated plan using its native tools

## Important Reminders
- ✅ This tool provides coordination and structure
- ✅ Gemini CLI performs all actual implementation
- ❌ The tool does NOT write code
- ❌ The tool does NOT access files directly
- ❌ The tool does NOT execute commands

## See Also
- Main documentation: /claude.md
- Other commands in this category
- Workflow examples in /workflows/
