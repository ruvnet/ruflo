# Claude-Flow MCP Start Now Uses Claude Code MCP Wrapper

## Summary

Yes! `./claude-flow mcp start` now uses the Claude Code MCP wrapper by default.

## What Changed

The `claude-flow mcp start` command has been updated to:
1. **Default to wrapper mode** with stdio transport
2. **Use Claude Code MCP** with automatic SPARC prompt injection
3. **Fall back to legacy mode** only when explicitly requested

## How It Works

### Default Behavior (Wrapper Mode)
```bash
# These all use the wrapper now:
./claude-flow mcp start
./claude-flow mcp start --transport stdio
```

When you run this, you'll see:
```
✅ Starting Claude-Flow MCP Server (Wrapper Mode)
📦 Using Claude Code MCP pass-through with SPARC prompt injection
🔧 All SPARC tools available with enhanced AI capabilities
ℹ️  To use legacy mode, set CLAUDE_FLOW_LEGACY_MCP=true
```

### Using Legacy Mode
If you need the old template-based server:
```bash
# Option 1: Use --legacy flag
./claude-flow mcp start --legacy

# Option 2: Set environment variable
CLAUDE_FLOW_LEGACY_MCP=true ./claude-flow mcp start

# Option 3: Use HTTP transport (requires legacy mode)
./claude-flow mcp start --transport http
```

## Benefits

1. **Real AI Intelligence**: SPARC tools now use Claude's actual AI capabilities
2. **No More Templates**: Removes hardcoded file generation templates
3. **Better Responses**: More intelligent and context-aware outputs
4. **Automatic Enhancement**: SPARC methodology injected automatically

## Transport Options

- **stdio** (default): Uses wrapper mode with Claude Code MCP
- **http**: Uses legacy mode (wrapper only supports stdio currently)

## Command Options

```bash
./claude-flow mcp start [options]
  -p, --port <port>         Port for MCP server (default: 3000)
  -h, --host <host>         Host for MCP server (default: localhost)
  --transport <transport>   Transport type: stdio, http (default: stdio)
  --legacy                  Use legacy template-based MCP server
```

## What This Means

When you use `./claude-flow mcp start`:
- All SPARC tools (sparc_coder, sparc_researcher, etc.) get enhanced with SPARC prompts
- Requests forward to Claude Code's Task tool
- You get AI-generated responses instead of template-based ones
- The interface remains exactly the same - no changes to how you use the tools

## Testing

To verify it's working:
```bash
# Start the server
./claude-flow mcp start

# In another terminal, test with the MCP client
node test-mcp-wrapper.js
```

The wrapper is now the default, providing a much more powerful and intelligent MCP server experience!