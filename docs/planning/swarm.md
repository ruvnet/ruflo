# Claude-Flow Swarm Mode Demo

This is a working demonstration of the swarm mode feature that bypasses the Cliffy import issues in the current version.

## Usage

```bash
# Direct usage
./swarm-demo.ts <objective> [options]

# Using claude-flow wrapper
./bin/claude-flow swarm <objective> [options]

# Or if installed globally
claude-flow swarm <objective> [options]
```

## Options

- `--dry-run, -d` - Preview swarm configuration without executing
- `--max-agents <n>` - Maximum number of agents (default: 5)
- `--strategy <s>` - Strategy: auto, research, development, analysis
- `--coordinator` - Spawn dedicated coordinator agent
- `--research` - Enable research capabilities for all agents
- `--parallel` - Enable parallel execution
- `--review` - Enable peer review between agents
- `--verbose, -v` - Show verbose output

## Examples

```bash
# Basic swarm
./bin/claude-flow swarm "Build a REST API"

# Complex migration with coordinator
./bin/claude-flow swarm "Migrate monolithic app to microservices" \
  --coordinator --max-agents 10 --review

# Research swarm
./bin/claude-flow swarm "Research best practices for cloud architecture" \
  --strategy research --research --max-agents 8

# Development swarm with parallel execution
./bin/claude-flow swarm "Implement user authentication system" \
  --strategy development --parallel --review

# Preview configuration
./bin/claude-flow swarm "Create mobile app" --dry-run --verbose
```

## Requirements

- Claude CLI must be installed and available in PATH
- Deno runtime (for running the scripts)

## How It Works

1. The swarm demo script creates an orchestration prompt for Claude
2. Claude acts as the master orchestrator
3. The master analyzes the objective and creates an execution plan
4. It then coordinates the spawning and management of sub-agents
5. Each agent works on specific tasks while sharing knowledge
6. Results are synthesized and presented

## Troubleshooting

If you get "Claude CLI not found", ensure:
1. Claude desktop app is installed
2. The `claude` command is available in your PATH
3. You can test with: `which claude`

## Note

This is a temporary solution while the main CLI is being updated to resolve the import assertion deprecation warnings. The functionality is identical to the integrated swarm command.