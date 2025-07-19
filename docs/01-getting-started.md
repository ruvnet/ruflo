# Getting Started with Gemini-Flow

Welcome to Gemini-Flow, an advanced AI agent orchestration system designed for sophisticated multi-agent collaboration, task coordination, and memory management. This guide will help you get up and running quickly.

## Quick Installation

### Option 1: NPX (Recommended for First-Time Users)
```bash
# Run directly without installation
npx claude-flow

# Or install globally for persistent use
npm install -g claude-flow
claude-flow --version
```

### Option 2: Deno Installation
```bash
# Install with Deno
deno install --allow-all --name claude-flow https://raw.githubusercontent.com/ruvnet/gemini-flow/main/src/cli/index.ts

# Verify installation
claude-flow --help
```

### Option 3: From Source
```bash
# Clone the repository
git clone https://github.com/ruvnet/gemini-flow.git
cd gemini-flow

# Install dependencies and build
deno task install

# Run from source
deno task dev
```

## Initial Setup

### 1. Initialize Configuration
```bash
# Create default configuration file
claude-flow config init

# Verify configuration
claude-flow config show
```

### 2. Start the Orchestrator
```bash
# Basic start
claude-flow start

# Start with daemon mode for background operation
claude-flow start --daemon

# Start with custom port
claude-flow start --port 3000
```

### 3. Verify System Health
```bash
# Check system status
claude-flow agent list
claude-flow memory stats
claude-flow mcp status
```

## Your First Workflow

Let's create a simple research workflow to demonstrate Gemini-Flow's capabilities:

### Step 1: Spawn a Research Agent
```bash
# Create a research agent
claude-flow agent spawn researcher --name "Research Assistant"

# Verify agent is active
claude-flow agent list
```

### Step 2: Create a Research Task
```bash
# Create a research task
claude-flow task create research "Analyze current trends in AI development tools" \
  --priority high \
  --estimated-duration 2h

# Check task status
claude-flow task list
```

### Step 3: Monitor Progress
```bash
# Monitor task execution
claude-flow task monitor --follow

# Check agent activity
claude-flow agent info <agent-id>
```

### Step 4: Review Results
```bash
# Query memory for research findings
claude-flow memory query --filter "AI development tools" --recent

# Export findings
claude-flow memory export --filter "research-results" --output research-findings.json
```

## Interactive Exploration

For learning and experimentation, use the interactive REPL mode:

```bash
# Start interactive session
claude-flow repl
```

In REPL mode, you can:
```bash
# Get help
> help

# Spawn agents interactively
> agent spawn coordinator --name "Project Manager"

# Create tasks
> task create analysis "Evaluate system performance"

# Query memory
> memory query --recent --limit 5

# Exit REPL
> exit
```

## Basic Concepts

### Agents
Agents are specialized AI workers with specific capabilities:
- **Researcher**: Information gathering and analysis
- **Implementer**: Code development and technical tasks
- **Analyst**: Data analysis and pattern recognition
- **Coordinator**: Planning and task delegation

### Tasks
Tasks represent work to be done:
- **Research**: Information gathering
- **Implementation**: Code development
- **Analysis**: Data processing
- **Coordination**: Planning and management

### Memory Bank
The memory system stores:
- Agent discoveries and insights
- Task progress and results
- Shared knowledge across agents
- Project history and context

### MCP Integration
Model Context Protocol enables:
- External tool integration
- API connectivity
- Custom tool development
- Secure tool execution

## Common Commands Reference

### Agent Management
```bash
# List all agents
claude-flow agent list

# Get detailed agent info
claude-flow agent info <agent-id>

# Terminate an agent
claude-flow agent terminate <agent-id>
```

### Task Management
```bash
# List all tasks
claude-flow task list

# Check task status
claude-flow task status <task-id>

# Cancel a task
claude-flow task cancel <task-id>
```

### Memory Operations
```bash
# Search memory
claude-flow memory query --search "keyword"

# View memory stats
claude-flow memory stats

# Clean up old entries
claude-flow memory cleanup --older-than 30d
```

### Configuration
```bash
# View current config
claude-flow config show

# Update settings
claude-flow config set orchestrator.maxConcurrentAgents 15

# Reset to defaults
claude-flow config init --force
```

## Next Steps

1. **Explore the Architecture**: Read [02-architecture-overview.md](./02-architecture-overview.md) to understand how Gemini-Flow works
2. **Configure Your System**: See [03-configuration-guide.md](./03-configuration-guide.md) for detailed configuration options
3. **Learn Agent Management**: Check [04-agent-management.md](./04-agent-management.md) for advanced agent patterns
4. **Create Complex Workflows**: Study [05-task-coordination.md](./05-task-coordination.md) for workflow orchestration

## Getting Help

- Use `claude-flow help` for command-line help
- Join our [Discord community](https://discord.gg/claude-flow)
- Check [GitHub Issues](https://github.com/ruvnet/gemini-flow/issues)
- Review the [full documentation](https://claude-flow.dev/docs)

## Troubleshooting Common Issues

### Installation Problems
If you encounter permission issues:
```bash
# For NPM
npm config set prefix ~/.npm-global
export PATH=~/.npm-global/bin:$PATH

# For Deno
export PATH="$HOME/.deno/bin:$PATH"
```

### Configuration Issues
If configuration fails to initialize:
```bash
# Check directory permissions
ls -la $(pwd)

# Manually create config
touch claude-flow.config.json
claude-flow config init --force
```

### Agent Startup Issues
If agents fail to start:
```bash
# Check system resources
claude-flow system resources

# Increase limits
claude-flow config set orchestrator.maxConcurrentAgents 5

# Check logs
claude-flow logs --level debug
```

You're now ready to start using Gemini-Flow! Continue to the next sections for more advanced features and configuration options.