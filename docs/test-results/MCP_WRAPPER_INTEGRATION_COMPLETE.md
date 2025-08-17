# Claude-Flow MCP Wrapper Integration Complete

## Summary

The claude-flow MCP server now uses the Claude Code wrapper by default when you run `claude-flow mcp start` or `npm run mcp`.

## What Changed

### 1. **Default Server Entry Point**
- Changed from: `src/mcp/server.ts` (template-based)
- Changed to: `src/mcp/server-with-wrapper.ts` (wrapper mode)

### 2. **Updated Files**
- `package.json`: Updated `mcp` script to use wrapper entry point
- `claude-flow.mcp.json`: Updated to use wrapper server
- `src/mcp/server-with-wrapper.ts`: New entry point with mode selection

### 3. **Backward Compatibility**
- Legacy mode still available with: `CLAUDE_FLOW_LEGACY_MCP=true npm run mcp`
- Or use `--legacy` flag

## How to Use

### Start MCP Server (Now Uses Wrapper by Default)
```bash
# These all use the wrapper now:
npm run mcp
claude-flow mcp start
claude mcp serve claude-flow.mcp.json
```

### Use Legacy Mode (If Needed)
```bash
# Use the old template-based approach:
CLAUDE_FLOW_LEGACY_MCP=true npm run mcp
```

### Test the Integration
```bash
./test-wrapper-integration.sh
```

## Benefits of the New Default

1. **Real AI Intelligence**: Uses Claude's actual capabilities instead of templates
2. **Automatic SPARC Enhancement**: All SPARC methodology injected automatically
3. **Better Responses**: More intelligent and context-aware outputs
4. **Easier Maintenance**: No need to update templates for new patterns
5. **Full Tool Access**: Direct pass-through to all Claude Code tools

## What Users Will See

When starting the MCP server, users will now see:
```
🚀 Claude-Flow MCP Server (Wrapper Mode)
📦 Using Claude Code MCP pass-through with SPARC prompt injection
🔧 All SPARC tools available with enhanced AI capabilities
ℹ️  To use legacy mode, set CLAUDE_FLOW_LEGACY_MCP=true
```

## Tool Behavior

All SPARC tools now:
1. Receive the original task
2. Get enhanced with SPARC methodology prompts
3. Forward to Claude Code's Task tool
4. Return AI-generated results

Example flow:
```
sparc_coder("Create REST API") 
  → Inject SPARC coder prompt 
  → Forward to Claude Code Task 
  → AI generates actual code
```

## Configuration

The `claude-flow.mcp.json` now includes:
```json
{
  "command": "node",
  "args": ["node_modules/.bin/tsx", "src/mcp/server-with-wrapper.ts"],
  "env": {
    "CLAUDE_FLOW_WRAPPER_MODE": "true"
  }
}
```

## Migration Guide

For users upgrading:
1. No action required - the wrapper is now default
2. Existing SPARC tool calls work identically
3. Results will be better (AI-generated vs templates)
4. If issues arise, use legacy mode temporarily

## Testing

Run the test script to verify everything works:
```bash
node test-mcp-wrapper.js
```

This will test:
- Tool listing
- SPARC mode execution
- Prompt injection
- Swarm coordination

## Support

- Report issues: https://github.com/ruvnet/claude-code-flow/issues
- Legacy mode available as fallback
- All existing workflows continue to work