# Gemini-Flow MCP Start Now Uses Gemini Code MCP Wrapper

## Summary

Yes! `./gemini-flow mcp start` now uses the Gemini Code MCP wrapper by default.

## What Changed

The `gemini-flow mcp start` command has been updated to:
1. **Default to wrapper mode** with stdio transport
2. **Use Gemini Code MCP** with automatic SPARC prompt injection
3. **Fall back to legacy mode** only when explicitly requested

## How It Works

### Default Behavior (Wrapper Mode)
```bash
# These all use the wrapper now:
./gemini-flow mcp start
./gemini-flow mcp start --transport stdio
```

When you run this, you'll see:
```
✅ Starting Gemini-Flow MCP Server (Wrapper Mode)
📦 Using Gemini Code MCP pass-through with SPARC prompt injection
🔧 All SPARC tools available with enhanced AI capabilities
ℹ️  To use legacy mode, set CLAUDE_FLOW_LEGACY_MCP=true
```

### Using Legacy Mode
If you need the old template-based server:
```bash
# Option 1: Use --legacy flag
./gemini-flow mcp start --legacy

# Option 2: Set environment variable
CLAUDE_FLOW_LEGACY_MCP=true ./gemini-flow mcp start

# Option 3: Use HTTP transport (requires legacy mode)
./gemini-flow mcp start --transport http
```

## Benefits

1. **Real AI Intelligence**: SPARC tools now use Claude's actual AI capabilities
2. **No More Templates**: Removes hardcoded file generation templates
3. **Better Responses**: More intelligent and context-aware outputs
4. **Automatic Enhancement**: SPARC methodology injected automatically

## Transport Options

- **stdio** (default): Uses wrapper mode with Gemini Code MCP
- **http**: Uses legacy mode (wrapper only supports stdio currently)

## Command Options

```bash
./gemini-flow mcp start [options]
  -p, --port <port>         Port for MCP server (default: 3000)
  -h, --host <host>         Host for MCP server (default: localhost)
  --transport <transport>   Transport type: stdio, http (default: stdio)
  --legacy                  Use legacy template-based MCP server
```

## What This Means

When you use `./gemini-flow mcp start`:
- All SPARC tools (sparc_coder, sparc_researcher, etc.) get enhanced with SPARC prompts
- Requests forward to Gemini Code's Task tool
- You get AI-generated responses instead of template-based ones
- The interface remains exactly the same - no changes to how you use the tools

## Testing

To verify it's working:
```bash
# Start the server
./gemini-flow mcp start

# In another terminal, test with the MCP client
node test-mcp-wrapper.js
```

The wrapper is now the default, providing a much more powerful and intelligent MCP server experience!