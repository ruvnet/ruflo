// command-registry.js - Extensible command registration system
import process from 'process';
import { initCommand } from './simple-commands/init/index.js';
import { memoryCommand } from './simple-commands/memory.js';
import { sparcCommand } from './simple-commands/sparc.js';
import { agentCommand } from './simple-commands/agent.js';
import { taskCommand } from './simple-commands/task.js';
import { configCommand } from './simple-commands/config.js';
import { statusCommand } from './simple-commands/status.js';
import { mcpCommand } from './simple-commands/mcp.js';
import { monitorCommand } from './simple-commands/monitor.js';
import { startCommand } from './simple-commands/start.js';
import { swarmCommand } from './simple-commands/swarm.js';
import { batchManagerCommand } from './simple-commands/batch-manager.js';
import { githubCommand } from './simple-commands/github.js';
import { trainingAction } from './simple-commands/training.js';
import { analysisAction } from './simple-commands/analysis.js';
import { automationAction } from './simple-commands/automation.js';
import { coordinationAction } from './simple-commands/coordination.js';
// Legacy hooks removed - use modern agentic-flow-hooks system
// import { hooksAction } from './simple-commands/hooks.js';
import { hookSafetyCommand } from './simple-commands/hook-safety.js';
import { hiveMindCommand } from './simple-commands/hive-mind.js';
import { HelpFormatter } from './help-formatter.js';
import hiveMindOptimizeCommand from './simple-commands/hive-mind-optimize.js';
import {
  showUnifiedMetrics,
  fixTaskAttribution,
} from './simple-commands/swarm-metrics-integration.js';
// Migration completed - hooks already migrated to agentic-flow-hooks
// import { migrateHooksCommand, migrateHooksCommandConfig } from './simple-commands/migrate-hooks.js';
import {
  fixHookVariablesCommand,
  fixHookVariablesCommandConfig,
} from './simple-commands/fix-hook-variables.js';
import { 
  initializePerformanceTracking,
  trackCommandExecution 
} from './simple-commands/performance-hooks.js';
// Maestro commands integrated with clean implementation
// Note: Maestro TypeScript commands now integrated directly in ./commands/maestro.ts
// Note: TypeScript imports commented out for Node.js compatibility
// import { ruvSwarmAction } from './commands/ruv-swarm.ts';
// import { configIntegrationAction } from './commands/config-integration.ts';

// Command registry for extensible CLI
export const commandRegistry = new Map();

// Register core commands
export function registerCoreCommands() {
  commandRegistry.set('init', {
    handler: initCommand,
    description: 'Initialize Claude Code integration files and SPARC development environment',
    usage: 'init [--force] [--minimal] [--sparc]',
    examples: [
      'npx claude-flow@latest init --sparc  # Recommended: Full SPARC setup',
      'init --sparc                         # Initialize with SPARC modes',
      'init --force --minimal               # Minimal setup, overwrite existing',
      'init --sparc --force                 # Force SPARC setup',
    ],
    details: `
The --sparc flag creates a complete development environment:
  • .roomodes file containing 17 specialized SPARC modes
  • CLAUDE.md for AI-readable project instructions
  • Pre-configured modes: architect, code, tdd, debug, security, and more
  • Ready for TDD workflows and automated code generation
  
First-time users should run: npx claude-flow@latest init --sparc`,
  });

  commandRegistry.set('start', {
    handler: startCommand,
    description: 'Start the Claude-Flow orchestration system',
    usage: 'start [--daemon] [--port <port>] [--verbose] [--ui] [--web]',
    examples: [
      'start                    # Start in interactive mode',
      'start --daemon           # Start as background daemon',
      'start --port 8080        # Use custom MCP port',
      'start --verbose          # Show detailed system activity',
      'start --ui               # Launch terminal-based UI',
      'start --web              # Launch web-based UI',
    ],
  });

  // Add start-ui as a convenient alias for launching the UI
  commandRegistry.set('start-ui', {
    handler: async (args, flags) => {
      // Import and use the direct UI launcher
      const { launchUI } = await import('./simple-commands/start-ui.js');
      // Pass the full raw arguments from process.argv
      const fullArgs = process.argv.slice(3); // Skip node, script, and command
      return launchUI(fullArgs);
    },
    description: 'Start the UI interface (web UI by default)',
    usage: 'start-ui [--port <port>] [--terminal]',
    examples: [
      'start-ui                 # Launch web-based UI (default)',
      'start-ui --port 3000     # Use custom port',
      'start-ui --terminal      # Launch terminal-based UI instead',
    ],
  });

  commandRegistry.set('memory', {
    handler: memoryCommand,
    description: 'Memory management operations',
    usage: 'memory <subcommand> [options]',
    examples: [
      'memory store key "value"',
      'memory query search_term',
      'memory stats',
      'memory export backup.json',
    ],
  });

  commandRegistry.set('sparc', {
    handler: sparcCommand,
    description: 'SPARC development mode operations',
    usage: 'sparc [subcommand] [options]',
    examples: [
      'sparc "orchestrate full app development"  # Default: sparc orchestrator',
      'sparc modes                               # List available modes',
      'sparc run code "implement feature"        # Run specific mode',
      'sparc tdd "feature description"           # TDD workflow',
      'sparc info architect                      # Mode details',
    ],
  });

  // Maestro Bridge - Canonical implementation with swarm coordination
  commandRegistry.set('maestro', {
    handler: async (args, flags) => {
      const { maestroUnifiedAction } = await import('./simple-commands/maestro.js');
      return maestroUnifiedAction(args, flags);
    },
    description: 'Maestro: Specs-Driven Development with Native Hive Mind Swarm Coordination',
    usage: 'maestro <subcommand> [options]',
    examples: [
      'maestro workflow user-auth "JWT authentication" --swarm',
      'maestro create-spec my-feature "Implement user auth"',
      'maestro generate-design my-feature',
      'maestro generate-tasks my-feature',
      'maestro implement-task my-feature 1 --swarm',
      'maestro status my-feature',
      'maestro init-steering api-design',
      'maestro performance',
      'maestro help',
    ],
    details: `
Native Hive Mind Integration Features:
  • MaestroSwarmCoordinator as primary entry point
  • TypeScript architecture merged with JavaScript implementation
  • Specs-driven topology with 8-agent capacity
  • Consensus validation (66% threshold by default)
  • Collective memory with 24-hour TTL
  • Performance monitoring and real-time metrics
  • Auto-spawning specialized agents
  • Event-driven coordination with caching

Swarm Options:
  --swarm                   Enable native hive-mind coordination
  --consensus               Enable/disable consensus validation (default: true)
  --verbose                 Detailed output with performance metrics

Advanced Features:
  • Complete end-to-end workflow with swarm coordination
  • File-based progress tracking with swarm context
  • Seamless hive-mind system integration
  • Quality gate validation through consensus
  • Auto-spawning agent coordination
  • Comprehensive error handling and recovery`,
  });

  commandRegistry.set('agent', {
    handler: agentCommand,
    description: 'Manage AI agents and hierarchies',
    usage: 'agent <subcommand> [options]',
    examples: [
      'agent spawn researcher --name "DataBot"',
      'agent list --verbose',
      'agent hierarchy create enterprise',
      'agent ecosystem status',
    ],
  });

  commandRegistry.set('task', {
    handler: taskCommand,
    description: 'Manage tasks and workflows',
    usage: 'task <subcommand> [options]',
    examples: [
      'task create research "Market analysis"',
      'task list --filter running',
      'task workflow examples/dev-flow.json',
      'task coordination status',
    ],
  });

  commandRegistry.set('config', {
    handler: configCommand,
    description: 'Manage system configuration',
    usage: 'config <subcommand> [options]',
    examples: [
      'config init',
      'config set terminal.poolSize 15',
      'config get orchestrator.maxConcurrentTasks',
      'config validate',
    ],
  });

  commandRegistry.set('status', {
    handler: statusCommand,
    description: 'Show system status and health',
    usage: 'status [--verbose] [--json]',
    examples: ['status', 'status --verbose', 'status --json'],
  });

  commandRegistry.set('mcp', {
    handler: mcpCommand,
    description: 'Manage MCP server and tools',
    usage: 'mcp <subcommand> [options]',
    examples: ['mcp status', 'mcp start --port 8080', 'mcp tools --verbose', 'mcp auth setup'],
  });

  commandRegistry.set('monitor', {
    handler: monitorCommand,
    description: 'Real-time system monitoring',
    usage: 'monitor [--watch] [--interval <ms>]',
    examples: [
      'monitor',
      'monitor --watch',
      'monitor --interval 1000 --watch',
      'monitor --format json',
    ],
  });

  commandRegistry.set('swarm', {
    handler: swarmCommand,
    description: 'Swarm-based AI agent coordination',
    usage: 'swarm <objective> [options]',
    examples: [
      'swarm "Build a REST API"',
      'swarm "Research cloud architecture" --strategy research',
      'swarm "Analyze data" --max-agents 3 --parallel',
      'swarm "Development task" --ui --monitor --background',
    ],
  });

  commandRegistry.set('hive-mind', {
    handler: hiveMindCommand,
    description: '🧠 Advanced Hive Mind swarm intelligence with collective decision-making',
    usage: 'hive-mind <subcommand> [options]',
    examples: [
      'hive-mind init                          # Initialize hive mind system',
      'hive-mind spawn "Build microservices"   # Create swarm with objective',
      'hive-mind wizard                        # Interactive setup wizard',
      'hive-mind status                        # View active swarms',
      'hive-mind consensus                     # View consensus decisions',
      'hive-mind metrics                       # Performance analytics',
    ],
    customHelp: true, // Use command's own help function
    details: `
Hive Mind System Features:
  • Queen-led coordination with specialized worker agents
  • Collective memory and knowledge sharing
  • Consensus building for critical decisions  
  • Auto-scaling based on workload
  • Parallel task execution with work stealing
  • Real-time monitoring and metrics
  • SQLite-backed persistence
  • MCP tool integration for 87+ operations

Queen Types:
  • Strategic - Long-term planning and optimization
  • Tactical - Task prioritization and rapid response
  • Adaptive - Learning and strategy evolution

Worker Types:
  • Researcher, Coder, Analyst, Tester
  • Architect, Reviewer, Optimizer, Documenter

Use 'hive-mind wizard' for interactive setup or 'hive-mind help' for full documentation.`,
  });

  commandRegistry.set('hive-mind-optimize', {
    handler: hiveMindOptimizeCommand,
    description: '🔧 Optimize hive mind database for better performance',
    usage: 'hive-mind-optimize [options]',
    examples: [
      'hive-mind-optimize                      # Interactive optimization wizard',
      'hive-mind-optimize --auto               # Auto-optimize with defaults',
      'hive-mind-optimize --report             # Generate optimization report',
      'hive-mind-optimize --clean-memory --memory-days 60',
      'hive-mind-optimize --auto --vacuum --archive-tasks',
    ],
    details: `
Hive Mind Database Optimization Features:
  • Safe, backward-compatible optimizations
  • Performance indexes for 50% faster queries
  • Memory cleanup and archiving
  • Task archival for space management
  • Behavioral pattern tracking
  • Database integrity checking
  
Optimization Levels:
  • v1.0 → v1.1: Basic performance indexes
  • v1.1 → v1.2: Advanced query optimization
  • v1.2 → v1.3: Performance tracking tables
  • v1.3 → v1.4: Memory optimization features
  • v1.4 → v1.5: Behavioral analysis tracking

Safety Features:
  • Automatic backups before major operations
  • All changes are backward-compatible
  • Existing data is always preserved
  • Rollback capability on errors`,
  });

  commandRegistry.set('swarm-metrics', {
    handler: async (args, flags) => {
      const subcommand = args[0];
      if (subcommand === 'fix') {
        return await fixTaskAttribution();
      } else {
        return await showUnifiedMetrics();
      }
    },
    description: 'Unified swarm metrics and task attribution diagnostics',
    usage: 'swarm-metrics [fix] [options]',
    examples: [
      'swarm-metrics                    # Show unified metrics from all swarm systems',
      'swarm-metrics fix                # Fix task attribution issues between systems',
    ],
    details: `
Swarm Metrics Integration Features:
  • Unified view of hive-mind and ruv-swarm metrics
  • Task attribution diagnosis and repair
  • Cross-system swarm performance comparison
  • Database integration status checking
  • Automatic sample task creation for empty swarms

This command helps resolve issues where:
  • Overall task statistics show correctly but per-swarm shows 0/0
  • Multiple swarm systems are not properly integrated
  • Task assignments are missing or incorrectly attributed

Use 'swarm-metrics fix' to automatically repair attribution issues.`,
  });

  commandRegistry.set('batch', {
    handler: batchManagerCommand,
    description: 'Batch operation management and configuration utilities',
    usage: 'batch <command> [options]',
    examples: [
      'batch create-config my-batch.json',
      'batch create-config --interactive',
      'batch validate-config my-batch.json',
      'batch estimate my-batch.json',
      'batch list-templates',
      'batch list-environments',
    ],
    details: `
Batch operations support:
  • Multiple project initialization with templates
  • Environment-specific configurations (dev, staging, prod)
  • Parallel processing with resource management
  • Progress tracking and detailed reporting
  • Configuration validation and estimation tools
  
Use with init command:
  claude-flow init --batch-init project1,project2,project3
  claude-flow init --config batch-config.json --parallel`,
  });

  commandRegistry.set('github', {
    handler: githubCommand,
    description: 'GitHub workflow automation with 6 specialized modes',
    usage: 'github <mode> <objective> [options]',
    examples: [
      'github pr-manager "create feature PR with automated testing"',
      'github gh-coordinator "setup CI/CD pipeline" --auto-approve',
      'github release-manager "prepare v2.0.0 release"',
      'github repo-architect "optimize repository structure"',
      'github issue-tracker "analyze project roadmap issues"',
      'github sync-coordinator "sync package versions across repos"',
    ],
    details: `
GitHub automation modes:
  • gh-coordinator: GitHub workflow orchestration and coordination
  • pr-manager: Pull request management with multi-reviewer coordination
  • issue-tracker: Issue management and project coordination
  • release-manager: Release coordination and deployment pipelines
  • repo-architect: Repository structure optimization
  • sync-coordinator: Multi-package synchronization and version alignment
  
Advanced features:
  • Multi-reviewer coordination with automated scheduling
  • Intelligent issue categorization and assignment
  • Automated testing integration and quality gates
  • Release pipeline orchestration with rollback capabilities`,
  });

  commandRegistry.set('training', {
    handler: trainingAction,
    description: 'Neural pattern learning and model updates',
    usage: 'training <command> [options]',
    examples: [
      'training neural-train --data recent --model task-predictor',
      'training pattern-learn --operation "file-creation" --outcome "success"',
      'training model-update --agent-type coordinator --operation-result "efficient"',
    ],
    details: `
Neural training commands:
  • neural-train: Train neural patterns from operations
  • pattern-learn: Learn from specific operation outcomes
  • model-update: Update agent models with new insights
  
Improves task selection accuracy, agent performance prediction, and coordination efficiency.`,
  });

  commandRegistry.set('analysis', {
    handler: analysisAction,
    description: 'Performance and usage analytics',
    usage: 'analysis <command> [options]',
    examples: [
      'analysis bottleneck-detect --scope system',
      'analysis performance-report --timeframe 7d --format detailed',
      'analysis token-usage --breakdown --cost-analysis',
    ],
    details: `
Analysis commands:
  • bottleneck-detect: Detect performance bottlenecks in the system
  • performance-report: Generate comprehensive performance reports
  • token-usage: Analyze token consumption and costs
  
Helps with performance optimization, cost management, and resource allocation.`,
  });

  commandRegistry.set('automation', {
    handler: automationAction,
    description: 'Intelligent agent and workflow management',
    usage: 'automation <command> [options]',
    examples: [
      'automation auto-agent --task-complexity enterprise --swarm-id swarm-123',
      'automation smart-spawn --requirement "web-development" --max-agents 8',
      'automation workflow-select --project-type api --priority speed',
    ],
    details: `
Automation commands:
  • auto-agent: Automatically spawn optimal agents based on task complexity
  • smart-spawn: Intelligently spawn agents based on specific requirements
  • workflow-select: Select and configure optimal workflows for project types
  
Provides optimal resource allocation and intelligent agent selection.`,
  });

  commandRegistry.set('coordination', {
    handler: coordinationAction,
    description: 'Swarm and agent orchestration',
    usage: 'coordination <command> [options]',
    examples: [
      'coordination swarm-init --topology hierarchical --max-agents 8',
      'coordination agent-spawn --type developer --name "api-dev" --swarm-id swarm-123',
      'coordination task-orchestrate --task "Build REST API" --strategy parallel',
    ],
    details: `
Coordination commands:
  • swarm-init: Initialize swarm coordination infrastructure
  • agent-spawn: Spawn and coordinate new agents
  • task-orchestrate: Orchestrate task execution across agents
  
Enables intelligent task distribution, agent synchronization, and shared memory coordination.`,
  });

  // Legacy hooks command removed - use modern agentic-flow-hooks system
  // Access hooks via: import { agenticHookManager } from '../services/agentic-flow-hooks/index.js'
  /*
  commandRegistry.set('hooks', {
    handler: hooksAction,
    description: '[LEGACY] Lifecycle event management - Use agentic-flow-hooks system instead',
    usage: 'hooks <command> [options] [DEPRECATED]',
    examples: [
      'hooks pre-task --description "Build API" --task-id task-123',
      'hooks post-task --task-id task-123 --analyze-performance --generate-insights',
      'hooks session-end --export-metrics --generate-summary',
    ],
    details: `
[DEPRECATED] Legacy hooks commands - Use modern agentic-flow-hooks system:
  • pre-task: Execute before task begins (preparation & setup)
  • post-task: Execute after task completion (analysis & cleanup)
  • pre-edit: Execute before file modifications (backup & validation)
  • post-edit: Execute after file modifications (tracking & coordination)
  • session-end: Execute at session termination (cleanup & export)
  
Enables automated preparation & cleanup, performance tracking, and coordination synchronization.`,
  });
  */

  commandRegistry.set('hook-safety', {
    handler: hookSafetyCommand,
    description: '🚨 Critical hook safety system - Prevent infinite loops & financial damage',
    usage: 'hook-safety <command> [options]',
    examples: [
      'hook-safety validate                           # Check for dangerous hook configurations',
      'hook-safety validate --config ~/.claude/settings.json',
      'hook-safety status                             # View safety status and context',
      'hook-safety reset                              # Reset circuit breakers',
      'hook-safety safe-mode                          # Enable safe mode (skip all hooks)',
    ],
    details: `
🚨 CRITICAL: Stop hooks calling 'claude' commands create INFINITE LOOPS that can:
  • Bypass API rate limits
  • Cost thousands of dollars per day  
  • Make your system unresponsive

Hook Safety commands:
  • validate: Check Claude Code settings for dangerous patterns
  • status: Show current safety status and execution context
  • reset: Reset circuit breakers and execution counters  
  • safe-mode: Enable/disable safe mode (skips all hooks)

SAFE ALTERNATIVES:
  • Use PostToolUse hooks instead of Stop hooks
  • Implement flag-based update patterns
  • Use 'claude --skip-hooks' for manual updates
  • Create conditional execution scripts

For more information: https://github.com/ruvnet/claude-flow/issues/166`,
  });

  // Migration completed - hooks already migrated to agentic-flow-hooks system
  // commandRegistry.set('migrate-hooks', migrateHooksCommandConfig);

  commandRegistry.set('fix-hook-variables', {
    handler: fixHookVariablesCommand,
    ...fixHookVariablesCommandConfig,
  });

  commandRegistry.set('hive', {
    handler: async (args, flags) => {
      try {
        // Try to load the hive command module
        const { hiveAction } = await import('./commands/hive.js');
        return hiveAction({ args, flags, command: 'hive' });
      } catch (error) {
        // Fallback to simple implementation if module not found
        console.log('🐝 Hive Mind - Advanced Multi-Agent Coordination');
        console.log('');
        console.log('The Hive Mind system provides:');
        console.log('  • Consensus-based decision making');
        console.log('  • Distributed task orchestration');
        console.log('  • Quality-driven execution');
        console.log('  • Real-time swarm monitoring');
        console.log('');
        console.log('Usage: hive <objective> [options]');
        console.log('');
        console.log('For full functionality, ensure the hive module is properly built.');
      }
    },
    description: 'Hive Mind - Advanced multi-agent swarm with consensus',
    usage: 'hive <objective> [options]',
    examples: [
      'hive "Build microservices architecture"',
      'hive "Optimize database performance" --consensus unanimous',
      'hive "Develop ML pipeline" --topology mesh --monitor',
      'hive "Create REST API" --sparc --max-agents 8',
      'hive "Research cloud patterns" --background --quality-threshold 0.9',
    ],
    details: `
Hive Mind features:
  • 👑 Queen-led orchestration with specialized agents
  • 🗳️ Consensus mechanisms (quorum, unanimous, weighted, leader)
  • 🏗️ Multiple topologies (hierarchical, mesh, ring, star)
  • 📊 Real-time monitoring dashboard
  • 🧪 SPARC methodology integration
  • 💾 Distributed memory and knowledge sharing
  
Agent types:
  • Queen: Orchestrator and decision maker
  • Architect: System design and planning  
  • Worker: Implementation and execution
  • Scout: Research and exploration
  • Guardian: Quality and validation
  
Options:
  --topology <type>         Swarm topology (default: hierarchical)
  --consensus <type>        Decision mechanism (default: quorum)
  --max-agents <n>          Maximum agents (default: 8)
  --quality-threshold <n>   Min quality 0-1 (default: 0.8)
  --sparc                   Use SPARC methodology
  --monitor                 Real-time monitoring
  --background              Run in background`,
  });

  // Temporarily commented out for Node.js compatibility
  /*
  commandRegistry.set('ruv-swarm', {
    handler: ruvSwarmAction,
    description: 'Advanced AI swarm coordination with neural capabilities',
    usage: 'ruv-swarm <command> [options]',
    examples: [
      'ruv-swarm init --topology mesh --max-agents 8',
      'ruv-swarm spawn researcher --name "AI Researcher"',
      'ruv-swarm orchestrate "Build a REST API"',
      'ruv-swarm neural train --iterations 20',
      'ruv-swarm benchmark --type swarm',
      'ruv-swarm config show',
      'ruv-swarm status --verbose'
    ],
    details: `
Advanced swarm coordination features:
  • 84.8% SWE-Bench solve rate
  • 32.3% token reduction through coordination
  • 2.8-4.4x speed improvement via parallel execution
  • 27+ neural models for cognitive approaches
  • Persistent memory across sessions
  • Automatic topology optimization
  
Commands:
  init        - Initialize swarm with specified topology
  status      - Get current swarm status and metrics
  spawn       - Spawn specialized agents (researcher, coder, analyst, etc.)
  orchestrate - Coordinate complex tasks across agents
  neural      - Neural pattern training and management
  benchmark   - Performance testing and optimization
  config      - Configuration management
  memory      - Memory usage and coordination data`
  });
  */

  // Additional ruv-swarm coordination commands - temporarily commented out
  /*
  commandRegistry.set('swarm-init', {
    handler: async (args, flags) => {
      const { ruvSwarmAction } = await import('./commands/ruv-swarm.js');
      return ruvSwarmAction({ args: ['init', ...args], flags });
    },
    description: 'Quick swarm initialization with topology selection',
    usage: 'swarm-init [--topology <type>] [--max-agents <n>] [--strategy <type>]',
    examples: [
      'swarm-init --topology mesh --max-agents 8',
      'swarm-init --topology hierarchical --strategy specialized',
      'swarm-init --topology star --max-agents 5 --strategy balanced'
    ]
  });

  commandRegistry.set('neural-spawn', {
    handler: async (args, flags) => {
      const { ruvSwarmAction } = await import('./commands/ruv-swarm.js');
      return ruvSwarmAction({ args: ['spawn', ...args], flags });
    },
    description: 'Spawn neural agents with cognitive capabilities',
    usage: 'neural-spawn <type> [--name <name>] [--capabilities <list>]',
    examples: [
      'neural-spawn researcher --name "Data Analyst"',
      'neural-spawn coder --capabilities "typescript,react,api"',
      'neural-spawn coordinator --name "Project Manager"'
    ]
  });

  commandRegistry.set('memory-coordinate', {
    handler: async (args, flags) => {
      const { ruvSwarmAction } = await import('./commands/ruv-swarm.js');
      return ruvSwarmAction({ args: ['memory', ...args], flags });
    },
    description: 'Coordinate memory across swarm agents',
    usage: 'memory-coordinate [--detail <level>] [--sync] [--compress]',
    examples: [
      'memory-coordinate --detail summary',
      'memory-coordinate --detail detailed --sync',
      'memory-coordinate --compress --sync'
    ]
  });

  commandRegistry.set('config-integration', {
    handler: configIntegrationAction,
    description: 'Enhanced configuration management with ruv-swarm integration',
    usage: 'config-integration <command> [options]',
    examples: [
      'config-integration setup --enable-ruv-swarm',
      'config-integration preset development',
      'config-integration sync --force',
      'config-integration status --verbose',
      'config-integration export my-config.json',
      'config-integration validate --fix'
    ],
    details: `
Advanced configuration management features:
  • Unified configuration across Claude-Flow and ruv-swarm
  • Configuration presets for different environments
  • Automatic synchronization between config systems
  • Import/export capabilities with validation
  • Real-time status monitoring and validation
  
Presets:
  development  - Hierarchical topology, specialized strategy, 8 agents
  research     - Mesh topology, adaptive strategy, 12 agents  
  production   - Star topology, balanced strategy, 6 agents
  
Commands:
  setup        - Initialize ruv-swarm integration
  sync         - Synchronize configurations
  status       - Show integration status
  validate     - Validate all configurations
  preset       - Apply configuration preset
  export       - Export unified configuration
  import       - Import and apply configuration`
  });
  */
}

// Register a new command
export function registerCommand(name, command) {
  if (commandRegistry.has(name)) {
    console.warn(`Command '${name}' already exists and will be overwritten`);
  }

  commandRegistry.set(name, {
    handler: command.handler,
    description: command.description || 'No description available',
    usage: command.usage || `${name} [options]`,
    examples: command.examples || [],
    hidden: command.hidden || false,
  });
}

// Get command handler
export function getCommand(name) {
  return commandRegistry.get(name);
}

// List all registered commands
export function listCommands(includeHidden = false) {
  const commands = [];
  for (const [name, command] of commandRegistry.entries()) {
    if (includeHidden || !command.hidden) {
      commands.push({
        name,
        ...command,
      });
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

// Check if command exists
export function hasCommand(name) {
  return commandRegistry.has(name);
}

// Execute a command
export async function executeCommand(name, subArgs, flags) {
  const command = commandRegistry.get(name);
  if (!command) {
    throw new Error(`Unknown command: ${name}`);
  }

  try {
    // Track command execution for performance metrics
    await trackCommandExecution(name, command.handler, subArgs, flags);
  } catch (err) {
    throw new Error(`Command '${name}' failed: ${err.message}`);
  }
}

// Helper to show command help
export function showCommandHelp(name) {
  const command = commandRegistry.get(name);
  if (!command) {
    console.log(
      HelpFormatter.formatError(
        `Unknown command: ${name}`,
        'claude-flow',
        'claude-flow <command> [options]',
      ),
    );
    return;
  }

  // If command has custom help, call it with help flag
  if (command.customHelp) {
    command.handler(['--help'], { help: true });
    return;
  }

  // Convert command info to standardized format
  const helpInfo = {
    name: `claude-flow ${name}`,
    description: HelpFormatter.stripFormatting(command.description),
    usage: `claude-flow ${command.usage}`,
  };

  // Parse examples
  if (command.examples && command.examples.length > 0) {
    helpInfo.examples = command.examples.map((ex) => {
      if (ex.startsWith('npx')) {
        return ex;
      }
      return `claude-flow ${ex}`;
    });
  }

  // Parse options from details if available
  if (command.details) {
    const optionsMatch = command.details.match(/Options:([\s\S]*?)(?=\n\n|$)/);
    if (optionsMatch) {
      const optionsText = optionsMatch[1];
      const options = [];
      const optionLines = optionsText.split('\n').filter((line) => line.trim());

      for (const line of optionLines) {
        const match = line.match(/^\s*(--.+?)\s{2,}(.+)$/);
        if (match) {
          let [_, flags, description] = match;
          // Check for default value in description
          const defaultMatch = description.match(/\(default: (.+?)\)/);
          const option = {
            flags: flags.trim(),
            description: description.replace(/\(default: .+?\)/, '').trim(),
          };
          if (defaultMatch) {
            option.defaultValue = defaultMatch[1];
          }
          options.push(option);
        }
      }

      if (options.length > 0) {
        helpInfo.options = options;
      }
    }
  }

  console.log(HelpFormatter.formatHelp(helpInfo));
}

// Helper to show all commands
export function showAllCommands() {
  const commands = listCommands();

  console.log('Available commands:');
  console.log();

  for (const command of commands) {
    console.log(`  ${command.name.padEnd(12)} ${command.description}`);
  }

  console.log();
  console.log('Use "claude-flow help <command>" for detailed usage information');
}

// Initialize the command registry
registerCoreCommands();

// Initialize performance tracking
initializePerformanceTracking().catch(err => {
  // Performance tracking is optional, don't fail if it errors
  console.error('Failed to initialize performance tracking:', err.message);
});
