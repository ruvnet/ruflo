# Claude-Flow MCP Wrapper Guide

## Overview

The Claude-Flow MCP Wrapper is a new architecture that replaces the templated approach with a dynamic wrapper around Claude Code's MCP tools. This provides automatic SPARC/swarm prompt injection while leveraging Claude Code's native capabilities.

## Architecture

### Previous Architecture (Templated)
```
User → claude-flow MCP → Template Engine → File Generation
                      ↓
                    Claude CLI (optional)
```

### New Architecture (Wrapper)
```
User → claude-flow MCP Wrapper → Claude Code MCP Tools
           ↓                           ↑
    Prompt Injection              Native Tools
```

## Key Benefits

1. **No More Templates**: Removes the need for hardcoded file generation templates
2. **Real Claude Intelligence**: Uses Claude Code's actual AI capabilities
3. **Automatic Enhancement**: Injects SPARC methodology without manual prompting
4. **Tool Pass-Through**: Direct access to all Claude Code tools
5. **Simplified Maintenance**: No need to update templates for new patterns

## How It Works

### 1. Tool Interception
When a SPARC tool is called (e.g., `sparc_coder`), the wrapper:
- Intercepts the request
- Extracts the task and context
- Builds an enhanced prompt with SPARC methodology
- Forwards to Claude Code's `Task` tool

### 2. Prompt Injection
The wrapper automatically adds:
- SPARC mode description and instructions
- Available tools for the mode
- Usage patterns and best practices
- SPARC methodology workflow
- Integration capabilities

### 3. Example Transformation

**Original Request:**
```json
{
  "tool": "sparc_coder",
  "params": {
    "task": "Create a REST API for user management"
  }
}
```

**Enhanced Prompt Sent to Claude Code:**
```
SPARC: coder

## Mode Description
Autonomous code generation and implementation

## Available Tools
- **Read**: Read file contents
- **Write**: Write files
- **Edit**: Edit existing files
- **MultiEdit**: Make multiple edits to a file
- **Bash**: Execute system commands
- **TodoWrite**: Create and manage task coordination

## Usage Pattern
[Usage pattern code example]

## Best Practices
- Follow existing code patterns and conventions
- Write comprehensive tests for new code
- Use batch file operations for efficiency
- Implement proper error handling
- Add meaningful comments and documentation

## TASK: Create a REST API for user management

# 🎯 SPARC METHODOLOGY EXECUTION FRAMEWORK
[Full SPARC workflow steps 1-5]
```

## Usage

### Starting the Wrapper

```bash
# Run directly with TypeScript
npm run mcp:wrapper

# Or use the executable
./claude-flow-mcp-wrapper

# Build and run compiled version
npm run mcp:wrapper:build
npm run mcp:wrapper:serve
```

### Configuration

The wrapper is configured via `claude-flow-wrapper.mcp.json`:

```json
{
  "name": "claude-flow-wrapper",
  "tools": {
    "sparc_coder": {
      "passThrough": "Task",
      "promptInjection": true
    }
  }
}
```

### Integration with Claude

Add to your Claude desktop configuration:

```json
{
  "servers": {
    "claude-flow": {
      "command": "/path/to/claude-flow-mcp-wrapper"
    }
  }
}
```

## Available Tools

### SPARC Mode Tools
All 17 SPARC modes are available as `sparc_<mode>`:
- `sparc_orchestrator` - Multi-agent coordination
- `sparc_coder` - Code generation
- `sparc_researcher` - Deep research
- `sparc_tdd` - Test-driven development
- `sparc_architect` - System design
- `sparc_reviewer` - Code review
- `sparc_debugger` - Debugging
- `sparc_tester` - Testing
- `sparc_analyzer` - Analysis
- `sparc_optimizer` - Performance optimization
- `sparc_documenter` - Documentation
- `sparc_designer` - UI/UX design
- `sparc_innovator` - Creative solutions
- `sparc_swarm-coordinator` - Swarm management
- `sparc_memory-manager` - Memory management
- `sparc_batch-executor` - Parallel execution
- `sparc_workflow-manager` - Workflow automation

### Meta Tools
- `sparc_list` - List all available modes
- `sparc_swarm` - Coordinate multiple agents
- `sparc_swarm_status` - Check swarm status

## Swarm Coordination

The wrapper supports advanced swarm coordination:

```javascript
// Example swarm request
sparc_swarm({
  objective: "Build a complete web application",
  strategy: "development",
  mode: "distributed",
  maxAgents: 5
})
```

This automatically:
1. Plans appropriate agents based on strategy
2. Launches agents with proper coordination
3. Manages parallel/sequential execution
4. Tracks progress and results

## Migration Guide

### For Tool Developers

**Before (Template-based):**
```javascript
// Had to implement file generation templates
function generateCode(task) {
  if (task.includes("calculator")) {
    return calculatorTemplate;
  }
  // More template logic...
}
```

**After (Wrapper-based):**
```javascript
// Just forward to Claude Code with enhanced prompt
return this.forwardToClaudeCode('Task', {
  description: `SPARC ${mode}`,
  prompt: enhancedPrompt
});
```

### For Users

The interface remains the same! All existing SPARC tools work identically:

```javascript
// Still works exactly the same
sparc_coder({ 
  task: "Create a user authentication system"
})
```

## Advanced Features

### Memory Integration
The wrapper automatically includes memory keys for coordination:
```javascript
Memory Key: sparc_coder_1234567890
```

### Parallel Execution
Enable parallel execution through context:
```javascript
sparc_orchestrator({
  task: "Process multiple files",
  context: { parallel: true }
})
```

### Custom Working Directory
```javascript
sparc_coder({
  task: "Create module",
  context: { workingDirectory: "/src/modules" }
})
```

## Troubleshooting

### Wrapper Not Starting
1. Check Node.js version (requires 18+)
2. Ensure dependencies are installed: `npm install`
3. Verify TypeScript compilation: `npm run build`

### Tools Not Available
1. Check `.roomodes` file exists
2. Verify SPARC modes are loading correctly
3. Check console for error messages

### Claude Code Connection Issues
1. Ensure Claude Code is installed
2. Check MCP server permissions
3. Verify stdio communication

## Development

### Adding New SPARC Modes
1. Add mode definition to `.roomodes`
2. Restart the wrapper
3. Mode automatically available as `sparc_<mode>`

### Customizing Prompt Injection
Edit `buildEnhancedPrompt` method in `claude-code-wrapper.ts`:
```typescript
private buildEnhancedPrompt(mode: SparcMode, task: string, context?: SparcContext): string {
  // Customize prompt building logic
}
```

### Testing
```bash
# Test wrapper functionality
npm test src/mcp/claude-code-wrapper.test.ts

# Test with real Claude Code
./test-wrapper-integration.sh
```

## Performance Considerations

1. **Prompt Size**: Enhanced prompts are larger but provide better context
2. **No Template Overhead**: Removes template matching/generation overhead
3. **Direct Tool Access**: Faster than subprocess spawning
4. **Caching**: Mode definitions cached on startup

## Security

1. **Input Validation**: All inputs validated before forwarding
2. **No Code Generation**: No hardcoded templates that could have vulnerabilities
3. **Sandboxed Execution**: Relies on Claude Code's security model
4. **Environment Isolation**: No environment variable exposure

## Future Enhancements

1. **Dynamic Mode Loading**: Hot-reload SPARC modes without restart
2. **Prompt Optimization**: ML-based prompt optimization
3. **Result Caching**: Cache common task results
4. **Multi-Model Support**: Support for different AI models
5. **Plugin System**: Extensible prompt injection plugins