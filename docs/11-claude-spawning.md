# Gemini Instance Spawning

## Overview

Gemini-Flow provides powerful capabilities to spawn and manage Gemini Code instances with specific configurations. This feature allows you to programmatically launch Gemini with tailored tool permissions, development modes, and execution parameters - similar to the claude-sparc.sh script but integrated into the orchestration system.

## Key Features

- **Flexible Tool Configuration**: Specify exactly which tools Gemini can use
- **Development Mode Selection**: Choose between full, backend-only, frontend-only, or api-only modes
- **Parallel Execution Support**: Enable BatchTool and dispatch_agent for concurrent operations
- **Research Capabilities**: Toggle WebFetchTool for web research tasks
- **Workflow Automation**: Execute multiple Gemini instances from JSON workflow files
- **Dry-Run Mode**: Preview commands before execution

## Command Reference

### Spawn Individual Gemini Instance

```bash
npx claude-flow gemini spawn <task> [options]
```

#### Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--tools` | `-t` | Comma-separated list of allowed tools | View,Edit,Replace,GlobTool,GrepTool,LS,Bash |
| `--no-permissions` | | Use --dangerously-skip-permissions flag | false |
| `--config` | `-c` | MCP config file path | |
| `--mode` | `-m` | Development mode (full/backend-only/frontend-only/api-only) | full |
| `--parallel` | | Enable parallel execution with BatchTool | false |
| `--research` | | Enable web research with WebFetchTool | false |
| `--coverage` | | Test coverage target percentage | 80 |
| `--commit` | | Commit frequency (phase/feature/manual) | phase |
| `--verbose` | `-v` | Enable verbose output | false |
| `--dry-run` | `-d` | Show what would be executed without running | false |

#### Examples

```bash
# Basic task with default tools
npx claude-flow gemini spawn "implement user authentication system"

# Research task with web capabilities
npx claude-flow gemini spawn "research best practices for microservices" --research --parallel

# Backend development with specific tools
npx claude-flow gemini spawn "create REST API endpoints" --mode backend-only --tools "View,Edit,Replace,Bash"

# Frontend task with no permission prompts
npx claude-flow gemini spawn "build React dashboard" --mode frontend-only --no-permissions

# Dry run to preview command
npx claude-flow gemini spawn "refactor payment module" --coverage 95 --dry-run
```

### Batch Workflow Execution

```bash
npx claude-flow gemini batch <workflow-file> [options]
```

Execute multiple Gemini instances based on a JSON workflow file.

#### Workflow File Format

```json
{
  "name": "Development Workflow",
  "description": "Multi-task development workflow",
  "parallel": true,
  "tasks": [
    {
      "id": "task-1",
      "name": "Research Task",
      "description": "Research authentication best practices",
      "tools": ["WebFetchTool", "View", "Edit"],
      "skipPermissions": true,
      "config": ".roo/mcp.json"
    },
    {
      "id": "task-2", 
      "name": "Implementation Task",
      "description": "Implement authentication system",
      "tools": "View,Edit,Replace,GlobTool,GrepTool,LS,Bash",
      "mode": "backend-only",
      "coverage": 90
    }
  ]
}
```

#### Task Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `id` | string | Unique task identifier | Yes |
| `name` | string | Task name for display | No |
| `description` | string | Task description (used as Gemini prompt) | Yes |
| `tools` | string/array | Allowed tools (comma-separated string or array) | No |
| `skipPermissions` | boolean | Use --dangerously-skip-permissions flag | No |
| `dangerouslySkipPermissions` | boolean | Alternative to skipPermissions | No |
| `config` | string | MCP config file path | No |
| `mode` | string | Development mode | No |
| `coverage` | number | Test coverage target | No |
| `type` | string | Task type for categorization | No |

#### Examples

```bash
# Execute workflow with dry run
npx claude-flow gemini batch development-workflow.json --dry-run

# Execute workflow in production
npx claude-flow gemini batch production-tasks.json
```

## Environment Variables

When Gemini instances are spawned, the following environment variables are set:

| Variable | Description |
|----------|-------------|
| `CLAUDE_INSTANCE_ID` | Unique identifier for the Gemini instance |
| `CLAUDE_FLOW_MODE` | Development mode (full/backend-only/etc) |
| `CLAUDE_FLOW_COVERAGE` | Test coverage target percentage |
| `CLAUDE_FLOW_COMMIT` | Commit frequency setting |
| `CLAUDE_TASK_ID` | Task ID (for batch execution) |
| `CLAUDE_TASK_TYPE` | Task type (for batch execution) |

## Integration with Orchestration System

The Gemini spawning feature integrates seamlessly with the existing orchestration system:

1. **Agent Delegation**: Agents can spawn Gemini instances for specific subtasks
2. **Task Coordination**: Gemini instances can be part of larger task workflows
3. **Memory Sharing**: Gemini instances can access the shared memory bank
4. **Status Tracking**: Monitor Gemini instance status through the orchestrator

## Best Practices

### Tool Selection

- Use minimal tool sets for security and performance
- Include `WebFetchTool` only when web research is needed
- Add `BatchTool` for tasks requiring parallel execution
- Consider `dispatch_agent` for complex multi-step operations

### Development Modes

- **full**: Use for complete full-stack development
- **backend-only**: Focus on server-side implementation
- **frontend-only**: UI/UX development tasks
- **api-only**: REST/GraphQL API development

### Workflow Design

1. Group related tasks together
2. Use parallel execution for independent tasks
3. Set appropriate coverage targets based on criticality
4. Use descriptive task IDs and names for tracking

### Error Handling

- Always test with `--dry-run` first
- Check Gemini instance exit codes
- Monitor logs for execution errors
- Use verbose mode for debugging

## Advanced Usage

### Conditional Task Execution

Create workflows with conditional logic:

```json
{
  "tasks": [
    {
      "id": "test-task",
      "description": "Run unit tests",
      "tools": "Bash,View",
      "onSuccess": "deploy-task",
      "onFailure": "debug-task"
    }
  ]
}
```

### Custom Tool Combinations

Define tool presets for common scenarios:

```bash
# Research preset
RESEARCH_TOOLS="WebFetchTool,View,Edit,GrepTool"

# Development preset
DEV_TOOLS="View,Edit,Replace,GlobTool,GrepTool,LS,Bash,BatchTool"

# Minimal preset
MIN_TOOLS="View,Edit"

npx claude-flow gemini spawn "research task" --tools "$RESEARCH_TOOLS"
```

### Integration with CI/CD

Use Gemini spawning in CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Run Gemini Development Task
  run: |
    npx claude-flow gemini spawn \
      "implement feature from issue #123" \
      --mode backend-only \
      --coverage 90 \
      --commit feature \
      --no-permissions
```

## Troubleshooting

### Common Issues

1. **"Raw mode not supported" error**
   - This occurs when running in non-interactive environments
   - Use `--no-permissions` flag to bypass interactive prompts

2. **Tool not found errors**
   - Ensure tool names are spelled correctly
   - Check that required tools are installed in the environment

3. **Workflow file parsing errors**
   - Validate JSON syntax
   - Ensure all required fields are present
   - Check for proper quotation marks

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
npx claude-flow gemini spawn "debug task" --verbose --dry-run
```

## Security Considerations

1. **Tool Permissions**: Be cautious with tool permissions in production
2. **File Access**: Gemini instances inherit file system permissions
3. **Network Access**: WebFetchTool enables internet access
4. **Credential Handling**: Never include credentials in task descriptions

## Future Enhancements

- Template library for common task types
- Visual workflow designer
- Real-time Gemini instance monitoring
- Integration with more AI models
- Distributed execution across multiple machines