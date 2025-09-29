# 🚀 Quick MCP Setup Guide

## Copy This Configuration

Replace your current `claude-flow` entry in Claude Code settings with:

```json
{
  "claude-flow": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "tsx",
      "$HOME/claude-flow-optimized/claude-flow/src/mcp/server-with-wrapper.ts"
    ],
    "env": {
      "NODE_ENV": "development",
      "CLAUDE_FLOW_LOG_LEVEL": "debug",
      "CLAUDE_FLOW_DEBUG": "true"
    },
    "priority": "critical",
    "description": "Core SuperClaude orchestration and swarm coordination"
  }
}
```

**Note:** Replace `$HOME/claude-flow-optimized/claude-flow` with your actual installation path.

## Location

Add this to: `~/Library/Application Support/Claude/claude_desktop_config.json`

## Then

1. Save the file
2. Restart Claude Code
3. Done! ✅

## Test It

In Claude Code, the MCP server should appear and provide these tools:
- `sparc_list` - List SPARC modes
- `sparc_swarm` - Run swarm coordination
- `sparc_swarm_status` - Check swarm status

## Troubleshooting

If it doesn't work:
1. Check the file path is correct
2. Make sure `tsx` is available: `npx tsx --version`
3. Check Claude Code logs for errors

## Manual Test

```bash
cd $HOME/claude-flow-optimized/claude-flow
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | npx tsx src/mcp/server-with-wrapper.ts
```

Should output JSON response with server info.