// gemini-flow-commands.js - Gemini-Flow specific slash commands

// Create Gemini-Flow specific commands
export async function createClaudeFlowCommands(workingDir) {
  // Help command
  const helpCommand = `---
name: gemini-flow-help
description: Show Gemini-Flow commands and usage
---

# Gemini-Flow Commands

## 🌊 Gemini-Flow: Agent Orchestration Platform

Gemini-Flow is the ultimate multi-terminal orchestration platform that revolutionizes how you work with Gemini Code.

## Core Commands

### 🚀 System Management
- \`./gemini-flow start\` - Start orchestration system
- \`./gemini-flow start --ui\` - Start with interactive process management UI
- \`./gemini-flow status\` - Check system status
- \`./gemini-flow monitor\` - Real-time monitoring
- \`./gemini-flow stop\` - Stop orchestration

### 🤖 Agent Management
- \`./gemini-flow agent spawn <type>\` - Create new agent
- \`./gemini-flow agent list\` - List active agents
- \`./gemini-flow agent info <id>\` - Agent details
- \`./gemini-flow agent terminate <id>\` - Stop agent

### 📋 Task Management
- \`./gemini-flow task create <type> "description"\` - Create task
- \`./gemini-flow task list\` - List all tasks
- \`./gemini-flow task status <id>\` - Task status
- \`./gemini-flow task cancel <id>\` - Cancel task
- \`./gemini-flow task workflow <file>\` - Execute workflow

### 🧠 Memory Operations
- \`./gemini-flow memory store "key" "value"\` - Store data
- \`./gemini-flow memory query "search"\` - Search memory
- \`./gemini-flow memory stats\` - Memory statistics
- \`./gemini-flow memory export <file>\` - Export memory
- \`./gemini-flow memory import <file>\` - Import memory

### ⚡ SPARC Development
- \`./gemini-flow sparc "task"\` - Run SPARC orchestrator
- \`./gemini-flow sparc modes\` - List all 17+ SPARC modes
- \`./gemini-flow sparc run <mode> "task"\` - Run specific mode
- \`./gemini-flow sparc tdd "feature"\` - TDD workflow
- \`./gemini-flow sparc info <mode>\` - Mode details

### 🐝 Swarm Coordination
- \`./gemini-flow swarm "task" --strategy <type>\` - Start swarm
- \`./gemini-flow swarm "task" --background\` - Long-running swarm
- \`./gemini-flow swarm "task" --monitor\` - With monitoring
- \`./gemini-flow swarm "task" --ui\` - Interactive UI
- \`./gemini-flow swarm "task" --distributed\` - Distributed coordination

### 🌍 MCP Integration
- \`./gemini-flow mcp status\` - MCP server status
- \`./gemini-flow mcp tools\` - List available tools
- \`./gemini-flow mcp config\` - Show configuration
- \`./gemini-flow mcp logs\` - View MCP logs

### 🤖 Gemini Integration
- \`./gemini-flow gemini spawn "task"\` - Spawn Gemini with enhanced guidance
- \`./gemini-flow gemini batch <file>\` - Execute workflow configuration

## 🌟 Quick Examples

### Initialize with SPARC:
\`\`\`bash
npx -y gemini-flow@latest init --sparc
\`\`\`

### Start a development swarm:
\`\`\`bash
./gemini-flow swarm "Build REST API" --strategy development --monitor --review
\`\`\`

### Run TDD workflow:
\`\`\`bash
./gemini-flow sparc tdd "user authentication"
\`\`\`

### Store project context:
\`\`\`bash
./gemini-flow memory store "project_requirements" "e-commerce platform specs" --namespace project
\`\`\`

### Spawn specialized agents:
\`\`\`bash
./gemini-flow agent spawn researcher --name "Senior Researcher" --priority 8
./gemini-flow agent spawn developer --name "Lead Developer" --priority 9
\`\`\`

## 🎯 Best Practices
- Use \`./gemini-flow\` instead of \`npx gemini-flow\` after initialization
- Store important context in memory for cross-session persistence
- Use swarm mode for complex tasks requiring multiple agents
- Enable monitoring for real-time progress tracking
- Use background mode for tasks > 30 minutes

## 📚 Resources
- Documentation: https://github.com/ruvnet/gemini-flow/docs
- Examples: https://github.com/ruvnet/gemini-flow/examples
- Issues: https://github.com/ruvnet/gemini-flow/issues
`;
  
  await Deno.writeTextFile(`${workingDir}/.claude/commands/gemini-flow-help.md`, helpCommand);
  console.log('  ✓ Created slash command: /gemini-flow-help');
  
  // Memory command
  const memoryCommand = `---
name: gemini-flow-memory
description: Interact with Gemini-Flow memory system
---

# 🧠 Gemini-Flow Memory System

The memory system provides persistent storage for cross-session and cross-agent collaboration with CRDT-based conflict resolution.

## Store Information
\`\`\`bash
# Store with default namespace
./gemini-flow memory store "key" "value"

# Store with specific namespace
./gemini-flow memory store "architecture_decisions" "microservices with API gateway" --namespace arch
\`\`\`

## Query Memory
\`\`\`bash
# Search across all namespaces
./gemini-flow memory query "authentication"

# Search with filters
./gemini-flow memory query "API design" --namespace arch --limit 10
\`\`\`

## Memory Statistics
\`\`\`bash
# Show overall statistics
./gemini-flow memory stats

# Show namespace-specific stats
./gemini-flow memory stats --namespace project
\`\`\`

## Export/Import
\`\`\`bash
# Export all memory
./gemini-flow memory export full-backup.json

# Export specific namespace
./gemini-flow memory export project-backup.json --namespace project

# Import memory
./gemini-flow memory import backup.json
\`\`\`

## Cleanup Operations
\`\`\`bash
# Clean entries older than 30 days
./gemini-flow memory cleanup --days 30

# Clean specific namespace
./gemini-flow memory cleanup --namespace temp --days 7
\`\`\`

## 🗂️ Namespaces
- **default** - General storage
- **agents** - Agent-specific data and state
- **tasks** - Task information and results
- **sessions** - Session history and context
- **swarm** - Swarm coordination and objectives
- **project** - Project-specific context
- **spec** - Requirements and specifications
- **arch** - Architecture decisions
- **impl** - Implementation notes
- **test** - Test results and coverage
- **debug** - Debug logs and fixes

## 🎯 Best Practices

### Naming Conventions
- Use descriptive, searchable keys
- Include timestamp for time-sensitive data
- Prefix with component name for clarity

### Organization
- Use namespaces to categorize data
- Store related data together
- Keep values concise but complete

### Maintenance
- Regular backups with export
- Clean old data periodically
- Monitor storage statistics
- Compress large values

## Examples

### Store SPARC context:
\`\`\`bash
./gemini-flow memory store "spec_auth_requirements" "OAuth2 + JWT with refresh tokens" --namespace spec
./gemini-flow memory store "arch_api_design" "RESTful microservices with GraphQL gateway" --namespace arch
./gemini-flow memory store "test_coverage_auth" "95% coverage, all tests passing" --namespace test
\`\`\`

### Query project decisions:
\`\`\`bash
./gemini-flow memory query "authentication" --namespace arch --limit 5
./gemini-flow memory query "test results" --namespace test
\`\`\`

### Backup project memory:
\`\`\`bash
./gemini-flow memory export project-$(date +%Y%m%d).json --namespace project
\`\`\`
`;
  
  await Deno.writeTextFile(`${workingDir}/.claude/commands/gemini-flow-memory.md`, memoryCommand);
  console.log('  ✓ Created slash command: /gemini-flow-memory');
  
  // Swarm command
  const swarmCommand = `---
name: gemini-flow-swarm
description: Coordinate multi-agent swarms for complex tasks
---

# 🐝 Gemini-Flow Swarm Coordination

Advanced multi-agent coordination system with timeout-free execution, distributed memory sharing, and intelligent load balancing.

## Basic Usage
\`\`\`bash
./gemini-flow swarm "your complex task" --strategy <type> [options]
\`\`\`

## 🎯 Swarm Strategies
- **auto** - Automatic strategy selection based on task analysis
- **development** - Code implementation with review and testing
- **research** - Information gathering and synthesis
- **analysis** - Data processing and pattern identification
- **testing** - Comprehensive quality assurance
- **optimization** - Performance tuning and refactoring
- **maintenance** - System updates and bug fixes

## 🤖 Agent Types
- **coordinator** - Plans and delegates tasks to other agents
- **developer** - Writes code and implements solutions
- **researcher** - Gathers and analyzes information
- **analyzer** - Identifies patterns and generates insights
- **tester** - Creates and runs tests for quality assurance
- **reviewer** - Performs code and design reviews
- **documenter** - Creates documentation and guides
- **monitor** - Tracks performance and system health
- **specialist** - Domain-specific expert agents

## 🔄 Coordination Modes
- **centralized** - Single coordinator manages all agents (default)
- **distributed** - Multiple coordinators share management
- **hierarchical** - Tree structure with nested coordination
- **mesh** - Peer-to-peer agent collaboration
- **hybrid** - Mixed coordination strategies

## ⚙️ Common Options
- \`--strategy <type>\` - Execution strategy
- \`--mode <type>\` - Coordination mode
- \`--max-agents <n>\` - Maximum concurrent agents (default: 5)
- \`--timeout <minutes>\` - Timeout in minutes (default: 60)
- \`--background\` - Run in background for tasks > 30 minutes
- \`--monitor\` - Enable real-time monitoring
- \`--ui\` - Launch terminal UI interface
- \`--parallel\` - Enable parallel execution
- \`--distributed\` - Enable distributed coordination
- \`--review\` - Enable peer review process
- \`--testing\` - Include automated testing
- \`--encryption\` - Enable data encryption
- \`--verbose\` - Detailed logging output
- \`--dry-run\` - Show configuration without executing

## 🌟 Examples

### Development Swarm with Review
\`\`\`bash
./gemini-flow swarm "Build e-commerce REST API" \\
  --strategy development \\
  --monitor \\
  --review \\
  --testing
\`\`\`

### Long-Running Research Swarm
\`\`\`bash
./gemini-flow swarm "Analyze AI market trends 2024-2025" \\
  --strategy research \\
  --background \\
  --distributed \\
  --max-agents 8
\`\`\`

### Performance Optimization Swarm
\`\`\`bash
./gemini-flow swarm "Optimize database queries and API performance" \\
  --strategy optimization \\
  --testing \\
  --parallel \\
  --monitor
\`\`\`

### Enterprise Development Swarm
\`\`\`bash
./gemini-flow swarm "Implement secure payment processing system" \\
  --strategy development \\
  --mode distributed \\
  --max-agents 10 \\
  --parallel \\
  --monitor \\
  --review \\
  --testing \\
  --encryption \\
  --verbose
\`\`\`

### Testing and QA Swarm
\`\`\`bash
./gemini-flow swarm "Comprehensive security audit and testing" \\
  --strategy testing \\
  --review \\
  --verbose \\
  --max-agents 6
\`\`\`

## 📊 Monitoring and Control

### Real-time monitoring:
\`\`\`bash
# Monitor swarm activity
./gemini-flow monitor

# Monitor specific component
./gemini-flow monitor --focus swarm
\`\`\`

### Check swarm status:
\`\`\`bash
# Overall system status
./gemini-flow status

# Detailed swarm status
./gemini-flow status --verbose
\`\`\`

### View agent activity:
\`\`\`bash
# List all agents
./gemini-flow agent list

# Agent details
./gemini-flow agent info <agent-id>
\`\`\`

## 💾 Memory Integration

Swarms automatically use distributed memory for collaboration:

\`\`\`bash
# Store swarm objectives
./gemini-flow memory store "swarm_objective" "Build scalable API" --namespace swarm

# Query swarm progress
./gemini-flow memory query "swarm_progress" --namespace swarm

# Export swarm memory
./gemini-flow memory export swarm-results.json --namespace swarm
\`\`\`

## 🎯 Key Features

### Timeout-Free Execution
- Background mode for long-running tasks
- State persistence across sessions
- Automatic checkpoint recovery

### Work Stealing & Load Balancing
- Dynamic task redistribution
- Automatic agent scaling
- Resource-aware scheduling

### Circuit Breakers & Fault Tolerance
- Automatic retry with exponential backoff
- Graceful degradation
- Health monitoring and recovery

### Real-Time Collaboration
- Cross-agent communication
- Shared memory access
- Event-driven coordination

### Enterprise Security
- Role-based access control
- Audit logging
- Data encryption
- Input validation

## 🔧 Advanced Configuration

### Dry run to preview:
\`\`\`bash
./gemini-flow swarm "Test task" --dry-run --strategy development
\`\`\`

### Custom quality thresholds:
\`\`\`bash
./gemini-flow swarm "High quality API" \\
  --strategy development \\
  --quality-threshold 0.95
\`\`\`

### Scheduling algorithms:
- FIFO (First In, First Out)
- Priority-based
- Deadline-driven
- Shortest Job First
- Critical Path
- Resource-aware
- Adaptive

For detailed documentation, see: https://github.com/ruvnet/gemini-flow/docs/swarm-system.md
`;
  
  await Deno.writeTextFile(`${workingDir}/.claude/commands/gemini-flow-swarm.md`, swarmCommand);
  console.log('  ✓ Created slash command: /gemini-flow-swarm');
}