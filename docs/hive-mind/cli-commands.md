# 🐝 Hive Mind CLI Commands Guide

## Overview

The Hive Mind system provides a comprehensive set of CLI commands for orchestrating intelligent multi-agent development. This guide covers all commands, options, and usage patterns.

## Primary Commands

### `hive-mind` - Launch Interactive Wizard

The main entry point for the Hive Mind system with an interactive wizard.

```bash
npx claude-flow@2.0.0 hive-mind
```

**Aliases:**
- `hive` - Shorter version
- `hm` - Shortest version

**Options:**
- `--task <description>` - Skip wizard with direct task
- `--complexity <level>` - Set complexity (low|medium|high)
- `--agents <number>` - Override agent count
- `--topology <type>` - Force specific topology
- `--no-wizard` - Skip wizard, use defaults

**Examples:**
```bash
# Interactive wizard
npx claude-flow@2.0.0 hive-mind

# Direct task execution
npx claude-flow@2.0.0 hive-mind --task "Build REST API" --complexity high

# Custom configuration
npx claude-flow@2.0.0 hive-mind --agents 8 --topology mesh --no-wizard
```

### `hive-mind init` - Initialize Hive Mind System

Set up Hive Mind with specific configuration.

```bash
npx claude-flow@2.0.0 hive-mind init [options]
```

**Options:**
- `--topology <type>` - Swarm topology (hierarchical|mesh|ring|star)
- `--max-agents <n>` - Maximum agent count (default: 8)
- `--memory-size <mb>` - Shared memory allocation
- `--neural` - Enable neural learning
- `--persistent` - Enable persistent memory

**Examples:**
```bash
# Basic initialization
npx claude-flow@2.0.0 hive-mind init

# Advanced setup
npx claude-flow@2.0.0 hive-mind init --topology hierarchical --max-agents 12 --neural
```

### `hive-mind task` - Execute Specific Task

Run a task with Hive Mind orchestration.

```bash
npx claude-flow@2.0.0 hive-mind task <description> [options]
```

**Options:**
- `--analyze` - Show task analysis only
- `--agents <list>` - Specify agent types
- `--parallel` - Force parallel execution
- `--monitor` - Enable real-time monitoring
- `--export <path>` - Export results to file

**Examples:**
```bash
# Simple task
npx claude-flow@2.0.0 hive-mind task "Create user authentication system"

# Complex task with options
npx claude-flow@2.0.0 hive-mind task "Migrate database to PostgreSQL" \
  --agents "architect,analyst,coder,tester" \
  --monitor \
  --export ./migration-results.json
```

## Agent Management Commands

### `hive-mind agents` - Manage Agents

List, spawn, and control agents in the hive.

```bash
npx claude-flow@2.0.0 hive-mind agents <action> [options]
```

**Actions:**
- `list` - Show all active agents
- `spawn` - Create new agent
- `status` - Agent status details
- `metrics` - Performance metrics
- `stop` - Stop specific agent

**Options:**
- `--type <type>` - Agent type for spawn
- `--name <name>` - Custom agent name
- `--capabilities <list>` - Agent capabilities
- `--id <id>` - Agent ID for operations

**Examples:**
```bash
# List all agents
npx claude-flow@2.0.0 hive-mind agents list

# Spawn specialized agent
npx claude-flow@2.0.0 hive-mind agents spawn --type coder --name "API-Expert"

# Check agent metrics
npx claude-flow@2.0.0 hive-mind agents metrics --id coder-001
```

### `hive-mind swarm` - Swarm Operations

Control the overall swarm behavior.

```bash
npx claude-flow@2.0.0 hive-mind swarm <action> [options]
```

**Actions:**
- `status` - Overall swarm health
- `optimize` - Optimize topology
- `scale` - Scale agent count
- `sync` - Synchronize agents
- `reset` - Reset swarm state

**Examples:**
```bash
# Check swarm status
npx claude-flow@2.0.0 hive-mind swarm status

# Optimize for current task
npx claude-flow@2.0.0 hive-mind swarm optimize

# Scale to 10 agents
npx claude-flow@2.0.0 hive-mind swarm scale --target 10
```

## Task Orchestration Commands

### `hive-mind orchestrate` - Advanced Orchestration

Fine-grained control over task orchestration.

```bash
npx claude-flow@2.0.0 hive-mind orchestrate [options]
```

**Options:**
- `--strategy <type>` - Execution strategy (parallel|sequential|adaptive)
- `--dependencies` - Enable dependency resolution
- `--priority <level>` - Task priority (low|medium|high|critical)
- `--timeout <ms>` - Maximum execution time
- `--retry <n>` - Retry failed tasks

**Examples:**
```bash
# Parallel orchestration with dependencies
npx claude-flow@2.0.0 hive-mind orchestrate \
  --strategy parallel \
  --dependencies \
  --priority high

# Adaptive strategy with timeout
npx claude-flow@2.0.0 hive-mind orchestrate \
  --strategy adaptive \
  --timeout 300000 \
  --retry 3
```

### `hive-mind workflow` - Workflow Management

Create and manage complex workflows.

```bash
npx claude-flow@2.0.0 hive-mind workflow <action> [options]
```

**Actions:**
- `create` - Create new workflow
- `run` - Execute workflow
- `list` - Show saved workflows
- `export` - Export workflow definition
- `import` - Import workflow

**Examples:**
```bash
# Create workflow
npx claude-flow@2.0.0 hive-mind workflow create \
  --name "full-stack-dev" \
  --steps "design,implement,test,deploy"

# Run saved workflow
npx claude-flow@2.0.0 hive-mind workflow run full-stack-dev

# Export workflow
npx claude-flow@2.0.0 hive-mind workflow export full-stack-dev --format json
```

## Memory & Learning Commands

### `hive-mind memory` - Memory Operations

Manage Hive Mind's shared memory system.

```bash
npx claude-flow@2.0.0 hive-mind memory <action> [options]
```

**Actions:**
- `status` - Memory usage stats
- `search` - Search memories
- `clear` - Clear memory
- `backup` - Backup memory
- `restore` - Restore from backup

**Examples:**
```bash
# Check memory status
npx claude-flow@2.0.0 hive-mind memory status

# Search for patterns
npx claude-flow@2.0.0 hive-mind memory search --pattern "authentication"

# Backup current state
npx claude-flow@2.0.0 hive-mind memory backup --path ./hive-backup.json
```

### `hive-mind learn` - Learning System

Manage neural learning and pattern recognition.

```bash
npx claude-flow@2.0.0 hive-mind learn <action> [options]
```

**Actions:**
- `train` - Train on patterns
- `analyze` - Analyze patterns
- `predict` - Make predictions
- `export` - Export models

**Examples:**
```bash
# Train on successful patterns
npx claude-flow@2.0.0 hive-mind learn train --data ./success-patterns.json

# Analyze task patterns
npx claude-flow@2.0.0 hive-mind learn analyze --task "API development"

# Predict optimal approach
npx claude-flow@2.0.0 hive-mind learn predict --task "Build chat app"
```

## Monitoring & Analytics Commands

### `hive-mind monitor` - Real-Time Monitoring

Monitor Hive Mind operations in real-time.

```bash
npx claude-flow@2.0.0 hive-mind monitor [options]
```

**Options:**
- `--interval <ms>` - Update interval
- `--metrics <list>` - Specific metrics to track
- `--export` - Export monitoring data
- `--dashboard` - Launch web dashboard

**Examples:**
```bash
# Basic monitoring
npx claude-flow@2.0.0 hive-mind monitor

# Custom monitoring
npx claude-flow@2.0.0 hive-mind monitor \
  --interval 1000 \
  --metrics "agents,memory,tasks"

# Web dashboard
npx claude-flow@2.0.0 hive-mind monitor --dashboard
```

### `hive-mind report` - Generate Reports

Generate detailed reports on Hive Mind operations.

```bash
npx claude-flow@2.0.0 hive-mind report <type> [options]
```

**Report Types:**
- `performance` - Performance metrics
- `agents` - Agent activity
- `tasks` - Task completion
- `quality` - Code quality metrics
- `summary` - Executive summary

**Examples:**
```bash
# Performance report
npx claude-flow@2.0.0 hive-mind report performance --timeframe 24h

# Agent activity report
npx claude-flow@2.0.0 hive-mind report agents --format detailed

# Task summary
npx claude-flow@2.0.0 hive-mind report tasks --export ./task-report.pdf
```

## Configuration Commands

### `hive-mind config` - Configuration Management

Manage Hive Mind configuration.

```bash
npx claude-flow@2.0.0 hive-mind config <action> [options]
```

**Actions:**
- `get` - Get configuration value
- `set` - Set configuration value
- `list` - List all settings
- `reset` - Reset to defaults
- `export` - Export configuration

**Examples:**
```bash
# View all settings
npx claude-flow@2.0.0 hive-mind config list

# Set max agents
npx claude-flow@2.0.0 hive-mind config set max-agents 12

# Export configuration
npx claude-flow@2.0.0 hive-mind config export --path ./hive-config.json
```

## Integration Commands

### `hive-mind integrate` - External Integrations

Integrate Hive Mind with external services.

```bash
npx claude-flow@2.0.0 hive-mind integrate <service> [options]
```

**Services:**
- `github` - GitHub integration
- `gitlab` - GitLab integration
- `jira` - Jira integration
- `slack` - Slack notifications
- `discord` - Discord notifications

**Examples:**
```bash
# GitHub integration
npx claude-flow@2.0.0 hive-mind integrate github --repo owner/repo

# Slack notifications
npx claude-flow@2.0.0 hive-mind integrate slack --webhook <url>
```

## Utility Commands

### `hive-mind analyze` - Task Analysis

Analyze tasks without execution.

```bash
npx claude-flow@2.0.0 hive-mind analyze <task> [options]
```

**Options:**
- `--detailed` - Detailed analysis
- `--suggest-agents` - Recommend agents
- `--estimate-time` - Time estimation
- `--complexity` - Complexity score

**Examples:**
```bash
# Basic analysis
npx claude-flow@2.0.0 hive-mind analyze "Build e-commerce platform"

# Detailed analysis
npx claude-flow@2.0.0 hive-mind analyze "Migrate to microservices" \
  --detailed \
  --suggest-agents \
  --estimate-time
```

### `hive-mind template` - Task Templates

Use and manage task templates.

```bash
npx claude-flow@2.0.0 hive-mind template <action> [options]
```

**Actions:**
- `list` - Show available templates
- `use` - Use a template
- `create` - Create template
- `share` - Share template

**Templates:**
- `rest-api` - REST API with auth
- `full-stack` - Full-stack application
- `microservices` - Microservice architecture
- `migration` - System migration
- `optimization` - Performance optimization

**Examples:**
```bash
# List templates
npx claude-flow@2.0.0 hive-mind template list

# Use REST API template
npx claude-flow@2.0.0 hive-mind template use rest-api --name "MyAPI"

# Create custom template
npx claude-flow@2.0.0 hive-mind template create --name "my-template"
```

## Advanced Options

### Global Options

Available for all commands:

- `--verbose` - Detailed output
- `--quiet` - Minimal output
- `--json` - JSON output format
- `--no-color` - Disable colors
- `--help` - Show help
- `--version` - Show version

### Environment Variables

Configure Hive Mind via environment:

```bash
# Set default topology
export HIVE_MIND_TOPOLOGY=hierarchical

# Set max agents
export HIVE_MIND_MAX_AGENTS=12

# Enable debug mode
export HIVE_MIND_DEBUG=true

# Set memory size
export HIVE_MIND_MEMORY=64
```

### Configuration File

Create `.hive-mind.json` in your project:

```json
{
  "topology": "mesh",
  "maxAgents": 10,
  "memory": {
    "size": 64,
    "persistent": true
  },
  "neural": {
    "enabled": true,
    "autoTrain": true
  },
  "monitoring": {
    "enabled": true,
    "interval": 1000
  }
}
```

## Common Workflows

### Quick Development

```bash
# 1. Start Hive Mind
npx claude-flow@2.0.0 hive-mind

# 2. Follow wizard prompts
# 3. Monitor progress
# 4. Review results
```

### Complex Project

```bash
# 1. Initialize with custom settings
npx claude-flow@2.0.0 hive-mind init --topology hierarchical --max-agents 12

# 2. Create workflow
npx claude-flow@2.0.0 hive-mind workflow create --name "enterprise-app"

# 3. Run with monitoring
npx claude-flow@2.0.0 hive-mind workflow run enterprise-app --monitor

# 4. Generate report
npx claude-flow@2.0.0 hive-mind report summary --export ./project-report.pdf
```

### Continuous Integration

```bash
# In CI/CD pipeline
npx claude-flow@2.0.0 hive-mind task "$BUILD_TASK" \
  --non-interactive \
  --export ./build-results.json \
  --timeout 600000
```

## Tips & Best Practices

1. **Use Templates**: Start with templates for common tasks
2. **Monitor Progress**: Always use `--monitor` for long tasks
3. **Save Workflows**: Create workflows for repeated tasks
4. **Review Reports**: Check performance reports regularly
5. **Enable Learning**: Let Hive Mind learn from successes
6. **Backup Memory**: Regular backups preserve learnings
7. **Custom Agents**: Create specialized agents for your domain

## Troubleshooting

### Command Not Found
```bash
# Ensure global installation
npm install -g claude-flow@2.0.0

# Or use npx
npx claude-flow@2.0.0 hive-mind
```

### Agents Not Coordinating
```bash
# Check swarm status
npx claude-flow@2.0.0 hive-mind swarm status

# Sync agents
npx claude-flow@2.0.0 hive-mind swarm sync

# Reset if needed
npx claude-flow@2.0.0 hive-mind swarm reset
```

### Performance Issues
```bash
# Run diagnostics
npx claude-flow@2.0.0 hive-mind monitor --metrics "bottlenecks"

# Optimize topology
npx claude-flow@2.0.0 hive-mind swarm optimize

# Scale agents
npx claude-flow@2.0.0 hive-mind swarm scale --target 6
```

## Next Steps

- Read the [Wizard Guide](./wizard-guide.md) for interactive usage
- Check [Examples](./examples.md) for real-world scenarios
- See [API Reference](./api-reference.md) for programmatic access
- Review [Troubleshooting](./troubleshooting.md) for common issues