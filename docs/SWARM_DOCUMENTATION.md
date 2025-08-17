# Claude Flow Swarm Mode Documentation

## Overview

The Claude Flow Swarm Mode enables self-orchestrating agent swarms that can work collaboratively on complex tasks. When activated, a master orchestrator spawns specialized agents in separate terminal windows/sessions to work on different aspects of your objective.

## How It Works

1. **Master Orchestrator**: The main Claude instance that analyzes your objective and coordinates the swarm
2. **Specialized Agents**: Individual Claude instances spawned in separate terminals for specific tasks
3. **Shared Memory**: Agents communicate through a shared memory namespace for coordination
4. **Real Terminal Spawning**: Each agent runs in its own terminal window/tab for visibility

## Current Implementation Status

### Working Features
- ✅ Swarm initialization and configuration
- ✅ Dry-run mode to preview configuration
- ✅ Native terminal spawning (single orchestrator)
- ✅ Command-line argument parsing
- ✅ VS Code detection and script generation

### In Progress
- 🚧 VS Code terminal API integration (macOS only currently)
- 🚧 Multi-agent spawning in separate terminals
- 🚧 Real-time swarm monitoring
- 🚧 Agent communication through shared memory

### Known Limitations
- VS Code terminal spawning requires macOS (AppleScript)
- Linux/Windows users get manual instructions instead
- Agent spawning tools (dispatch_agent) need MCP integration
- Terminal output capture requires VS Code extension

## Usage

### Basic Usage
```bash
claude-flow swarm "Your objective here"
```

### With Options
Due to CLI parsing limitations, flags must come AFTER the objective:
```bash
claude-flow swarm "Research cloud architectures" --strategy research --max-agents 5 --monitor
```

### Dry Run
```bash
claude-flow swarm "Test objective" --dry-run
```

### VS Code Integration
```bash
# Automatically detects VS Code environment
claude-flow swarm "Build a feature" --vscode

# Force VS Code mode
claude-flow swarm "Create API" --vscode
```

## Options

- `--dry-run`: Show configuration without executing
- `--strategy <type>`: Strategy type (auto, research, development, analysis)
- `--max-agents <n>`: Maximum number of agents (default: 5)
- `--max-depth <n>`: Maximum delegation depth (default: 3)
- `--timeout <minutes>`: Timeout in minutes (default: 60)
- `--research`: Enable research capabilities
- `--parallel`: Enable parallel execution
- `--review`: Enable peer review mode
- `--coordinator`: Spawn dedicated coordinators
- `--memory-namespace <name>`: Memory namespace (default: swarm)
- `--vscode`: Use VS Code terminal integration
- `--monitor`: Enable real-time monitoring
- `--verbose`: Verbose output

## Terminal Integration

### Native Terminal Mode
- Works on macOS, Linux, and Windows
- Spawns new terminal windows using system commands
- Each agent runs in its own terminal window

### VS Code Integration
- Automatically detected when running in VS Code terminal
- Spawns new terminal tabs within VS Code
- Better integration with VS Code workspace

## Agent Types

1. **Researcher**: Information gathering and analysis
2. **Developer**: Code implementation and testing
3. **Analyst**: Data analysis and insights
4. **Reviewer**: Quality assurance and validation
5. **Coordinator**: Sub-task coordination

## Example Scenarios

### Research Task
```bash
claude-flow swarm --strategy research --research "Research best practices for microservices"
```

### Development Task
```bash
claude-flow swarm --strategy development --max-agents 3 "Build a REST API with authentication"
```

### Complex Project
```bash
claude-flow swarm --parallel --review --coordinator "Design and implement a real-time chat system"
```

## Monitoring

Use the `--monitor` flag to enable real-time monitoring of swarm progress:

```bash
claude-flow swarm --monitor "Your task"
```

This displays:
- Active agents and their status
- Task progress
- Runtime statistics
- Agent coordination events

## Requirements

- Claude desktop app installed
- `claude` command available in PATH
- Terminal access (for native mode)
- VS Code (for VS Code integration)

## Troubleshooting

### Claude CLI Not Found
Make sure Claude desktop app is installed and the `claude` command is in your PATH:
```bash
which claude
```

### Terminal Spawning Issues
- **macOS**: Requires Terminal app access permissions
- **Linux**: Requires gnome-terminal or compatible terminal
- **Windows**: Requires cmd.exe access
- **VS Code**: Must be running inside VS Code terminal

### Agent Communication
Agents communicate through shared memory. If agents aren't coordinating:
1. Check memory namespace is consistent
2. Verify agents have started successfully
3. Monitor agent output in their terminals

## Best Practices

1. **Clear Objectives**: Provide specific, well-defined objectives
2. **Appropriate Strategy**: Choose the right strategy for your task
3. **Resource Limits**: Set reasonable agent limits to avoid overwhelming the system
4. **Monitoring**: Use monitoring for long-running tasks
5. **Timeout**: Set appropriate timeouts for your tasks

## Architecture

The swarm system consists of:

1. **CLI Command** (`swarm.ts`): Handles command parsing and initialization
2. **Swarm Spawner** (`swarm-spawn.ts`): Manages agent lifecycle and terminal spawning
3. **Terminal Manager**: Handles terminal creation and management
4. **MCP Tools** (`swarm-tools.ts`): Provides tools for agent coordination
5. **Memory System**: Shared state and communication

## Future Enhancements

- Web UI for swarm monitoring
- Agent performance metrics
- Automatic agent scaling
- Cloud deployment support
- Integration with CI/CD pipelines