# 📖 Claude Flow v2.0.0 API Reference

## 📋 Table of Contents
1. [Core Commands](#core-commands)
2. [Agent Management](#agent-management)
3. [Swarm Operations](#swarm-operations)
4. [SPARC Development](#sparc-development)
5. [Memory Operations](#memory-operations)
6. [Task Management](#task-management)
7. [MCP Integration](#mcp-integration)
8. [GitHub Integration](#github-integration)
9. [Enterprise Features](#enterprise-features)
10. [Monitoring & Analytics](#monitoring--analytics)

## 🎯 Core Commands

### `init`
Initialize Claude Flow in your project.

```bash
claude-flow init [options]
```

**Options:**
- `--sparc` - Initialize with SPARC methodology and ruv-swarm integration (recommended)
- `--minimal` - Minimal setup without extra features
- `--docker` - Include Docker configuration
- `--github` - Enable GitHub integration
- `--migrate` - Migrate from Deno version
- `--ci` - CI/CD friendly initialization (no prompts)

**Examples:**
```bash
# Full enterprise setup
./claude-flow init --sparc

# Minimal setup
./claude-flow init --minimal

# CI/CD setup
./claude-flow init --ci --sparc
```

### `start`
Start the Claude Flow orchestration system.

```bash
claude-flow start [options]
```

**Options:**
- `--ui` - Enable web UI (default: true)
- `--port <number>` - UI port (default: 3000)
- `--mcp` - Enable MCP server (default: true)
- `--mcp-port <number>` - MCP port (default: 3001)
- `--swarm` - Auto-start swarm coordination
- `--monitor` - Enable real-time monitoring
- `--detached` - Run in background

**Examples:**
```bash
# Start with UI
./claude-flow start --ui

# Custom ports
./claude-flow start --port 8080 --mcp-port 8081

# Background mode
./claude-flow start --detached
```

### `status`
Show system status and health metrics.

```bash
claude-flow status [options]
```

**Options:**
- `--json` - Output in JSON format
- `--detailed` - Show detailed metrics
- `--watch` - Continuous monitoring

**Output:**
```
🌊 Claude Flow Status
├── Version: 2.0.0
├── Uptime: 2h 15m
├── Components:
│   ├── ✅ Orchestrator: Running
│   ├── ✅ MCP Server: Connected
│   ├── ✅ Memory Bank: Active (1.2GB)
│   └── ✅ Swarm: 3 agents active
└── Health: Excellent
```

### `stop`
Stop the Claude Flow system.

```bash
claude-flow stop [options]
```

**Options:**
- `--force` - Force stop without cleanup
- `--timeout <seconds>` - Shutdown timeout

### `config`
Manage configuration settings.

```bash
claude-flow config <action> [key] [value]
```

**Actions:**
- `get <key>` - Get configuration value
- `set <key> <value>` - Set configuration value
- `list` - List all settings
- `reset` - Reset to defaults
- `migrate` - Migrate old configuration

**Examples:**
```bash
# Set UI port
./claude-flow config set ui.port 8080

# Get swarm settings
./claude-flow config get swarm

# List all settings
./claude-flow config list
```

## 🤖 Agent Management

### `agent spawn`
Create a new AI agent.

```bash
claude-flow agent spawn <type> [options]
```

**Agent Types:**
- `researcher` - Information gathering and analysis
- `coder` - Code generation and implementation
- `analyst` - Data analysis and insights
- `tester` - Testing and quality assurance
- `coordinator` - Task coordination
- `architect` - System design
- `reviewer` - Code review
- `documenter` - Documentation

**Options:**
- `--name <string>` - Agent name
- `--model <string>` - AI model to use
- `--temperature <number>` - Creativity level (0-1)
- `--max-tokens <number>` - Response limit
- `--tools <list>` - Available tools
- `--memory` - Enable memory access
- `--parent <id>` - Parent agent for hierarchy

**Examples:**
```bash
# Spawn researcher
./claude-flow agent spawn researcher --name "DataBot"

# Spawn with configuration
./claude-flow agent spawn coder \
  --name "APIBuilder" \
  --temperature 0.7 \
  --tools "file-system,web-search"

# Create hierarchy
./claude-flow agent spawn coordinator --name "Lead"
./claude-flow agent spawn coder --parent lead-123
```

### `agent list`
List all active agents.

```bash
claude-flow agent list [options]
```

**Options:**
- `--format <table|json|tree>` - Output format
- `--filter <string>` - Filter by type or status
- `--sort <field>` - Sort by field

**Output:**
```
🤖 Active Agents (5)
├── coordinator-a1b2 [Coordinator] - Idle
├── researcher-c3d4 [Researcher] - Working: "API analysis"
├── coder-e5f6 [Coder] - Working: "implement auth"
├── tester-g7h8 [Tester] - Idle
└── analyst-i9j0 [Analyst] - Working: "performance metrics"
```

### `agent info`
Get detailed agent information.

```bash
claude-flow agent info <agent-id>
```

### `agent terminate`
Terminate an agent.

```bash
claude-flow agent terminate <agent-id> [options]
```

**Options:**
- `--force` - Force termination
- `--cascade` - Terminate child agents

### `agent assign`
Assign task to agent.

```bash
claude-flow agent assign <agent-id> <task> [options]
```

**Options:**
- `--priority <high|medium|low>` - Task priority
- `--deadline <time>` - Task deadline
- `--dependencies <ids>` - Task dependencies

## 🐝 Swarm Operations

### `swarm init`
Initialize a swarm with topology.

```bash
claude-flow swarm init [options]
```

**Options:**
- `--topology <type>` - Swarm topology
  - `hierarchical` - Tree structure (default)
  - `mesh` - Fully connected
  - `ring` - Circular coordination
  - `star` - Central coordinator
- `--max-agents <number>` - Maximum agents (default: 8)
- `--strategy <type>` - Coordination strategy
  - `balanced` - Even distribution
  - `specialized` - Task-specific
  - `adaptive` - Dynamic adjustment

**Examples:**
```bash
# Hierarchical swarm
./claude-flow swarm init --topology hierarchical --max-agents 10

# Mesh network
./claude-flow swarm init --topology mesh --strategy adaptive
```

### `swarm`
Execute task with swarm coordination.

```bash
claude-flow swarm <task> [options]
```

**Options:**
- `--strategy <type>` - Execution strategy
  - `development` - Full development cycle
  - `analysis` - Deep analysis
  - `testing` - Comprehensive testing
  - `research` - Research and exploration
  - `optimization` - Performance optimization
- `--max-agents <number>` - Agent limit
- `--parallel` - Enable parallel execution
- `--monitor` - Real-time monitoring
- `--timeout <minutes>` - Task timeout

**Examples:**
```bash
# Development task
./claude-flow swarm "Build REST API with authentication" \
  --strategy development \
  --parallel \
  --monitor

# Research task
./claude-flow swarm "Research best practices for microservices" \
  --strategy research \
  --max-agents 5
```

### `swarm status`
Get swarm status and metrics.

```bash
claude-flow swarm status [options]
```

**Options:**
- `--detailed` - Show agent details
- `--metrics` - Include performance metrics

### `swarm monitor`
Real-time swarm monitoring.

```bash
claude-flow swarm monitor [options]
```

**Options:**
- `--dashboard` - Web dashboard
- `--metrics <list>` - Specific metrics to track

## 🎯 SPARC Development

### `sparc run`
Execute SPARC development mode.

```bash
claude-flow sparc run <mode> <prompt> [options]
```

**Modes:**
- `spec` - Specification writing
- `pseudocode` - Pseudocode design
- `architect` - System architecture
- `code` - Code implementation
- `test` - Test creation
- `review` - Code review
- `refactor` - Code refactoring
- `debug` - Debugging
- `document` - Documentation
- `ask` - General questions
- `tdd` - Test-driven development
- `bdd` - Behavior-driven development
- `ddd` - Domain-driven design
- `security-review` - Security analysis
- `performance-review` - Performance analysis
- `api-design` - API design
- `ui-design` - UI/UX design
- `data-modeling` - Database design
- `integration` - System integration
- `deployment` - Deployment planning
- `devops` - DevOps automation

**Options:**
- `--context <file>` - Context file
- `--output <file>` - Output file
- `--chain <modes>` - Chain multiple modes
- `--interactive` - Interactive mode

**Examples:**
```bash
# Architecture design
./claude-flow sparc run architect "design microservices for e-commerce"

# TDD workflow
./claude-flow sparc run tdd "user authentication system"

# Chained execution
./claude-flow sparc run --chain spec,architect,code "payment processing"
```

### `sparc template`
Manage SPARC templates.

```bash
claude-flow sparc template <action> [name]
```

**Actions:**
- `list` - List available templates
- `create` - Create new template
- `edit` - Edit template
- `delete` - Delete template
- `apply` - Apply template

## 🧠 Memory Operations

### `memory store`
Store information in memory bank.

```bash
claude-flow memory store <key> <value> [options]
```

**Options:**
- `--type <type>` - Data type (text, json, file)
- `--tags <list>` - Tags for categorization
- `--ttl <seconds>` - Time to live
- `--compress` - Compress data
- `--encrypt` - Encrypt sensitive data

**Examples:**
```bash
# Store text
./claude-flow memory store api-design "RESTful endpoints for user management"

# Store JSON
./claude-flow memory store config '{"api": {"version": "2.0"}}' --type json

# Store with tags
./claude-flow memory store requirements "User auth with JWT" \
  --tags "auth,security,backend"
```

### `memory query`
Search memory bank.

```bash
claude-flow memory query <pattern> [options]
```

**Options:**
- `--type <type>` - Filter by type
- `--tags <list>` - Filter by tags
- `--limit <number>` - Result limit
- `--format <format>` - Output format

**Examples:**
```bash
# Query by pattern
./claude-flow memory query "auth"

# Query with filters
./claude-flow memory query "*" --tags "security" --limit 10
```

### `memory delete`
Delete memory entries.

```bash
claude-flow memory delete <key> [options]
```

**Options:**
- `--pattern` - Delete by pattern
- `--confirm` - Skip confirmation

### `memory export`
Export memory bank.

```bash
claude-flow memory export <file> [options]
```

**Options:**
- `--format <json|csv|sql>` - Export format
- `--filter <pattern>` - Filter entries

### `memory import`
Import memory data.

```bash
claude-flow memory import <file> [options]
```

**Options:**
- `--merge` - Merge with existing
- `--overwrite` - Overwrite existing

## 📋 Task Management

### `task create`
Create a new task.

```bash
claude-flow task create <type> <description> [options]
```

**Task Types:**
- `development` - Development task
- `research` - Research task
- `analysis` - Analysis task
- `testing` - Testing task
- `documentation` - Documentation task
- `deployment` - Deployment task

**Options:**
- `--priority <level>` - Priority level
- `--assign <agent>` - Assign to agent
- `--dependencies <ids>` - Task dependencies
- `--deadline <date>` - Task deadline
- `--tags <list>` - Task tags

**Examples:**
```bash
# Create development task
./claude-flow task create development "Implement user authentication" \
  --priority high \
  --assign coder-123

# Create with dependencies
./claude-flow task create testing "Integration tests" \
  --dependencies task-001,task-002
```

### `task list`
List tasks.

```bash
claude-flow task list [options]
```

**Options:**
- `--status <status>` - Filter by status
- `--assigned <agent>` - Filter by assignment
- `--sort <field>` - Sort order

### `task update`
Update task status.

```bash
claude-flow task update <task-id> [options]
```

**Options:**
- `--status <status>` - New status
- `--progress <percent>` - Progress update
- `--notes <text>` - Add notes

### `task workflow`
Execute task workflow.

```bash
claude-flow task workflow <workflow-file> [options]
```

**Options:**
- `--parallel` - Parallel execution
- `--dry-run` - Simulation mode

## 🔌 MCP Integration

### `mcp status`
Check MCP server status.

```bash
claude-flow mcp status [options]
```

**Options:**
- `--detailed` - Detailed information
- `--tools` - List available tools

### `mcp tools`
List available MCP tools.

```bash
claude-flow mcp tools [options]
```

**Options:**
- `--category <cat>` - Filter by category
- `--search <term>` - Search tools

**Output:**
```
🔧 Available MCP Tools (27)
├── Swarm Coordination (8)
│   ├── swarm_init - Initialize swarm
│   ├── agent_spawn - Create agents
│   └── task_orchestrate - Coordinate tasks
├── Memory Management (6)
│   ├── memory_usage - Store/retrieve
│   └── memory_search - Search memory
├── Neural Processing (5)
│   ├── neural_train - Train patterns
│   └── neural_predict - Make predictions
└── System Tools (8)
    ├── benchmark_run - Performance tests
    └── monitor_metrics - System metrics
```

### `mcp call`
Call MCP tool directly.

```bash
claude-flow mcp call <tool> [params] [options]
```

**Examples:**
```bash
# Initialize swarm
./claude-flow mcp call swarm_init \
  --params '{"topology": "mesh", "maxAgents": 5}'

# Store memory
./claude-flow mcp call memory_usage \
  --params '{"action": "store", "key": "test", "value": "data"}'
```

## 🐙 GitHub Integration

### `github pr-manager`
Manage pull requests with swarm intelligence.

```bash
claude-flow github pr-manager <description> [options]
```

**Options:**
- `--branch <name>` - Target branch
- `--reviewers <list>` - Assign reviewers
- `--labels <list>` - PR labels
- `--analyze-impact` - Impact analysis
- `--suggest-tests` - Test suggestions
- `--update-docs` - Update documentation

### `github issue-solver`
Analyze and solve GitHub issues.

```bash
claude-flow github issue-solver <issue> [options]
```

**Options:**
- `--deep-analysis` - Root cause analysis
- `--auto-fix` - Generate fix
- `--create-pr` - Create fix PR

### `github release-coordinator`
Coordinate releases.

```bash
claude-flow github release-coordinator <version> [options]
```

**Options:**
- `--generate-changelog` - Auto changelog
- `--run-tests` - Run test suite
- `--publish-npm` - Publish to NPM
- `--create-docker` - Build Docker image

### `github sync-packages`
Synchronize packages across repositories.

```bash
claude-flow github sync-packages [options]
```

**Options:**
- `--repos <list>` - Target repositories
- `--package <spec>` - Package specification
- `--config <file>` - Sync configuration

### `github repo-architect`
Optimize repository structure.

```bash
claude-flow github repo-architect [action] [options]
```

**Options:**
- `--template <type>` - Apply template
- `--analyze` - Analyze structure
- `--apply-standards` - Apply best practices

## 🏢 Enterprise Features

### `project`
Project lifecycle management.

```bash
claude-flow project <action> [name] [options]
```

**Actions:**
- `create` - Create new project
- `list` - List projects
- `info` - Project information
- `archive` - Archive project
- `template` - Manage templates

**Options:**
- `--type <type>` - Project type
- `--template <name>` - Use template
- `--team <members>` - Assign team

### `deploy`
Deployment automation.

```bash
claude-flow deploy <action> [target] [options]
```

**Actions:**
- `create` - Create deployment
- `rollback` - Rollback deployment
- `status` - Deployment status
- `history` - Deployment history

**Options:**
- `--strategy <type>` - Deployment strategy
  - `blue-green` - Blue-green deployment
  - `canary` - Canary release
  - `rolling` - Rolling update
- `--environment <env>` - Target environment

### `cloud`
Multi-cloud resource management.

```bash
claude-flow cloud <action> [resource] [options]
```

**Actions:**
- `resources` - Manage resources
- `costs` - Cost analysis
- `optimize` - Optimization suggestions
- `migrate` - Cloud migration

**Options:**
- `--provider <name>` - Cloud provider
- `--region <region>` - Target region

### `security`
Security management.

```bash
claude-flow security <action> [target] [options]
```

**Actions:**
- `scan` - Security scanning
- `audit` - Security audit
- `report` - Generate reports
- `fix` - Auto-fix issues

**Options:**
- `--type <type>` - Scan type
- `--severity <level>` - Severity filter

### `analytics`
Performance analytics.

```bash
claude-flow analytics <action> [options]
```

**Actions:**
- `insights` - Generate insights
- `report` - Create reports
- `export` - Export data
- `dashboard` - View dashboard

**Options:**
- `--timerange <range>` - Time range
- `--metrics <list>` - Specific metrics

## 📊 Monitoring & Analytics

### `monitor`
Real-time system monitoring.

```bash
claude-flow monitor [options]
```

**Options:**
- `--dashboard` - Web dashboard
- `--metrics <list>` - Metrics to track
- `--alerts` - Enable alerting
- `--export` - Export metrics

### `logs`
View system logs.

```bash
claude-flow logs [component] [options]
```

**Options:**
- `--follow` - Follow log output
- `--since <time>` - Time filter
- `--level <level>` - Log level filter
- `--grep <pattern>` - Search pattern

### `benchmark`
Run performance benchmarks.

```bash
claude-flow benchmark [test] [options]
```

**Options:**
- `--iterations <n>` - Test iterations
- `--compare <baseline>` - Compare results
- `--export` - Export results

### `diagnose`
System diagnostics.

```bash
claude-flow diagnose [options]
```

**Options:**
- `--full` - Full diagnostic
- `--component <name>` - Specific component
- `--report` - Generate report

## 🎨 Output Formats

Most commands support multiple output formats:

- `--format table` - Table format (default)
- `--format json` - JSON format
- `--format yaml` - YAML format
- `--format csv` - CSV format
- `--format markdown` - Markdown format

## 🔧 Global Options

Available for all commands:

- `--help` - Show help
- `--version` - Show version
- `--verbose` - Verbose output
- `--quiet` - Suppress output
- `--no-color` - Disable colors
- `--config <file>` - Custom config file
- `--profile <name>` - Use profile

## 📚 Examples

### Complete Development Workflow
```bash
# 1. Initialize project
./claude-flow init --sparc

# 2. Start system
./claude-flow start --ui --monitor

# 3. Create swarm for development
./claude-flow swarm init --topology hierarchical --max-agents 8

# 4. Execute development task
./claude-flow swarm "Build complete REST API with authentication" \
  --strategy development \
  --parallel \
  --monitor

# 5. Monitor progress
./claude-flow monitor --dashboard

# 6. Create PR when ready
./claude-flow github pr-manager "Feature: Complete REST API implementation"

# 7. Deploy
./claude-flow deploy create v1.0.0 --strategy blue-green
```

---

**📖 For more examples and detailed guides, visit our [documentation](https://github.com/ruvnet/claude-code-flow/docs).**