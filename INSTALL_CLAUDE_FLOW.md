# How to Install Claude Flow MCP in Claude Desktop

## Step 1: Add to Claude Desktop Config

Add this entry to `/Users/marc/Library/Application Support/Claude/claude_desktop_config.json`:

```json
"claude-flow": {
  "command": "npx",
  "args": [
    "claude-flow@alpha",
    "mcp",
    "start"
  ],
  "env": {
    "NODE_ENV": "production",
    "MCP_TIMEOUT": "120000",
    "MCP_REQUEST_TIMEOUT": "90000",
    "MCP_PROTOCOL_TIMEOUT": "60000",
    "NODE_OPTIONS": "--max-old-space-size=4096"
  }
}
```

Or for local installation:

```json
"claude-flow": {
  "command": "node",
  "args": [
    "/Users/marc/Documents/Cline/MCP/claude-flow-mcp/server.js"
  ],
  "env": {
    "NODE_ENV": "production",
    "MCP_TIMEOUT": "120000",
    "MCP_REQUEST_TIMEOUT": "90000",
    "MCP_PROTOCOL_TIMEOUT": "60000"
  }
}
```

## Step 2: Restart Claude Desktop

After adding the configuration, completely quit and restart Claude Desktop.

## Step 3: Verify Installation

Once restarted, test with:
```javascript
mcp__claude-flow__swarm_status {}
```

## What This Enables:

- **ParaThinker Parallel Reasoning** - 8 parallel paths instead of single chain
- **Swarm Orchestration** - Coordinate multiple agents
- **Memory Management** - Persistent storage across sessions
- **GitHub Integration** - Advanced repository management
- **Performance Monitoring** - Track and optimize operations

This is the missing piece for implementing the parallel reasoning approach from the video!