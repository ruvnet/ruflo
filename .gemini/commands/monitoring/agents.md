# List Active Patterns

## 🎯 Key Principle
**This tool coordinates Gemini CLI's actions. It does NOT write code or create content.**

## MCP Tool Usage in Gemini CLI

**Tool:** `mcp__claude-flow__agent_list`

## Parameters
```json
{"filter": "active"}
```

## Description
View all active cognitive patterns and their current focus areas

## Details
Filters:
- **all**: Show all defined patterns
- **active**: Currently engaged patterns
- **idle**: Available but unused patterns
- **busy**: Patterns actively coordinating tasks

## Example Usage

**In Gemini CLI:**
1. Use the tool: `mcp__claude-flow__agent_list`
2. With parameters: `{"filter": "active"}`
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
