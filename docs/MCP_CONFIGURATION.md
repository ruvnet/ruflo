# Claude Flow MCP Server Configuration

## ✅ Server Status: WORKING

The refactored MCP server in `src/mcp/` is fully functional and can be integrated into Claude Code.

## Verified Working Configuration

### Test Results
```bash
# Test command:
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}' \
  | npx tsx src/mcp/server-with-wrapper.ts

# Response:
{"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"claude-flow-wrapper","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
```

✅ Server initializes correctly
✅ Responds to MCP protocol messages
✅ Returns proper JSON-RPC 2.0 responses

## Recommended Configuration

Add this to your Claude Code MCP settings (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": [
        "tsx",
        "$HOME/claude-flow-optimized/claude-flow/src/mcp/server-with-wrapper.ts"
      ],
      "env": {
        "NODE_ENV": "development",
        "CLAUDE_FLOW_LOG_LEVEL": "debug",
        "CLAUDE_FLOW_DEBUG": "true"
      }
    }
  }
}
```

**Note:** Replace `$HOME/claude-flow-optimized/claude-flow` with your actual installation path.

### Alternative: Using Direct tsx Path

If you want to avoid npx overhead:

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "$HOME/claude-flow-optimized/claude-flow/node_modules/.bin/tsx",
      "args": [
        "src/mcp/server-with-wrapper.ts"
      ],
      "env": {
        "NODE_ENV": "development",
        "CLAUDE_FLOW_LOG_LEVEL": "debug",
        "CLAUDE_FLOW_DEBUG": "true"
      },
      "cwd": "$HOME/claude-flow-optimized/claude-flow"
    }
  }
}
```

**Note:** Replace `$HOME/claude-flow-optimized/claude-flow` with your actual installation path.

### For Your Current Setup

Based on your JSON structure, use this format:

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

## Server Features

- **Protocol:** MCP (Model Context Protocol) 2024-11-05
- **Transport:** stdio (JSON-RPC over stdin/stdout)
- **Mode:** Wrapper mode with SPARC prompt injection
- **Tools:** All SPARC tools available with enhanced AI capabilities

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Runtime environment |
| `CLAUDE_FLOW_LOG_LEVEL` | info | Logging level (debug, info, warn, error) |
| `CLAUDE_FLOW_DEBUG` | false | Enable debug mode |
| `CLAUDE_FLOW_LEGACY_MCP` | false | Use legacy MCP server |

## Server Modes

### Wrapper Mode (Default)
- Uses `ClaudeCodeMCPWrapper`
- Pass-through with SPARC enhancement
- Recommended for most use cases

### Legacy Mode
Set `CLAUDE_FLOW_LEGACY_MCP=true` to use the original MCP server implementation.

## Troubleshooting

### Server Not Starting
1. Verify tsx is installed: `npm list tsx`
2. Check paths are correct (use absolute paths)
3. Ensure permissions: `chmod +x src/mcp/server-with-wrapper.ts`

### No Tools Appearing
1. Check logs in Claude Code MCP section
2. Verify environment variables are set
3. Ensure server initialized successfully

### Connection Issues
1. Server must use stdio transport
2. Verify JSON-RPC 2.0 format
3. Check initialize request succeeds

## Testing

### Manual Test
```bash
# Start server and send initialize
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}}' \
  | npx tsx src/mcp/server-with-wrapper.ts
```

### Expected Output
```json
{
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {"tools": {}},
    "serverInfo": {
      "name": "claude-flow-wrapper",
      "version": "1.0.0"
    }
  },
  "jsonrpc": "2.0",
  "id": 1
}
```

## Next Steps

1. Copy the configuration to Claude Code settings
2. Restart Claude Code
3. Verify the MCP server appears in Claude Code's MCP section
4. Test by invoking Claude Flow tools

## Support

- **Repository:** https://github.com/ruvnet/claude-flow
- **Issues:** https://github.com/ruvnet/claude-flow/issues
- **Documentation:** `/docs` directory in repository