# Known Issues

## ruv-swarm v1.0.8 Logger Error

### Issue
When running `npx ruv-swarm mcp start`, you may encounter:
```
❌ Uncaught Exception: logger.logMemoryUsage is not a function
```

### Impact
- The error occurs after successful initialization
- The MCP server continues to work despite the error
- This is a non-critical error that doesn't affect functionality

### Workaround
Use claude-flow's integrated MCP server instead:

```bash
# Option 1: Use claude-flow MCP server (recommended)
npx claude-flow@alpha mcp start

# Option 2: Configure claude-flow with MCP integration
claude mcp add claude-flow npx claude-flow@alpha mcp start
```

### Fix Status
- **Affected Version**: ruv-swarm v1.0.8
- **Status**: Known issue in external package
- **Claude-Flow**: Provides integrated MCP server as alternative

### Technical Details
The error occurs because ruv-swarm attempts to call `logger.logMemoryUsage()` in a monitoring interval, but the method isn't properly bound to the logger instance in certain contexts.

## Anthropic API 500 Errors

### Issue
When Anthropic's API experiences issues, you may see:
```
API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}
```

### Workaround
1. Check https://status.anthropic.com/ for service status
2. Use `--claude` flag to generate commands without API calls
3. Use `--executor` for local execution

See issue #183 for more details.