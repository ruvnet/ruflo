# Neural Pattern Training

## 🎯 Key Principle
**This tool coordinates Claude Code's actions. It does NOT write code or create content.**

## MCP Tool Usage in Claude Code

**Tool:** `mcp__claude-flow__neural_train`

## Parameters
```json
{
  "pattern_type": "coordination",
  "training_data": "task decomposition patterns",
  "epochs": 50
}
```

## Description
Improve coordination patterns through neural network training

## Details
Training improves:
- Task breakdown effectiveness
- Coordination pattern selection
- Resource allocation strategies
- Overall coordination efficiency

## Example Usage

**In Claude Code:**
1. Train coordination patterns: Use tool `mcp__claude-flow__neural_train` with parameters `{"pattern_type": "coordination", "training_data": "successful task patterns", "epochs": 50}`
2. Train optimization patterns: Use tool `mcp__claude-flow__neural_train` with parameters `{"pattern_type": "optimization", "training_data": "performance metrics", "epochs": 30}`
3. Check training status: Use tool `mcp__claude-flow__neural_status`
4. Analyze patterns: Use tool `mcp__claude-flow__neural_patterns` with parameters `{"action": "analyze"}`

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
