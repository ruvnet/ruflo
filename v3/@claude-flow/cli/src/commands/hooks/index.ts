/**
 * V3 CLI Hooks Command
 * Self-learning hooks system for intelligent workflow automation
 *
 * Split into focused modules for maintainability (was 4534 lines).
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// Import subcommands from focused modules
import { preEditCommand, postEditCommand } from './edit-hooks.js';
import { preCommandCommand, postCommandCommand } from './command-hooks.js';
import { routeCommand, explainCommand } from './routing.js';
import { pretrainCommand, buildAgentsCommand } from './pretrain.js';
import { metricsCommand, progressHookCommand } from './metrics-progress.js';
import { transferCommand, listCommand } from './transfer-list.js';
import { preTaskCommand, postTaskCommand } from './task-hooks.js';
import { sessionEndCommand, sessionRestoreCommand } from './session-hooks.js';
import { intelligenceCommand } from './intelligence.js';
import { workerCommand } from './workers.js';
import { coverageRouteCommand, coverageSuggestCommand, coverageGapsCommand } from './coverage.js';
import { statuslineCommand } from './statusline.js';
import { tokenOptimizeCommand, modelRouteCommand, modelOutcomeCommand, modelStatsCommand } from './token-model.js';
import {
  routeTaskCommand, sessionStartCommand, preBashCommand, postBashCommand,
  teammateIdleCommand, taskCompletedCommand
} from './compat-teams.js';

// Hook types
export const HOOK_TYPES = [
  { value: 'pre-edit', label: 'Pre-Edit', hint: 'Get context before editing files' },
  { value: 'post-edit', label: 'Post-Edit', hint: 'Record editing outcomes' },
  { value: 'pre-command', label: 'Pre-Command', hint: 'Assess risk before commands' },
  { value: 'post-command', label: 'Post-Command', hint: 'Record command outcomes' },
  { value: 'route', label: 'Route', hint: 'Route tasks to optimal agents' },
  { value: 'explain', label: 'Explain', hint: 'Explain routing decisions' }
];

// Agent routing options
export const AGENT_TYPES = [
  'coder', 'researcher', 'tester', 'reviewer', 'architect',
  'security-architect', 'security-auditor', 'memory-specialist',
  'swarm-specialist', 'performance-engineer', 'core-architect',
  'test-architect', 'coordinator', 'analyst', 'optimizer'
];

// Main hooks command
export const hooksCommand: Command = {
  name: 'hooks',
  description: 'Self-learning hooks system for intelligent workflow automation',
  subcommands: [
    preEditCommand,
    postEditCommand,
    preCommandCommand,
    postCommandCommand,
    preTaskCommand,
    postTaskCommand,
    sessionEndCommand,
    sessionRestoreCommand,
    routeCommand,
    explainCommand,
    pretrainCommand,
    buildAgentsCommand,
    metricsCommand,
    transferCommand,
    listCommand,
    intelligenceCommand,
    workerCommand,
    progressHookCommand,
    statuslineCommand,
    // Coverage-aware routing commands
    coverageRouteCommand,
    coverageSuggestCommand,
    coverageGapsCommand,
    // Token optimization
    tokenOptimizeCommand,
    // Model routing (tiny-dancer integration)
    modelRouteCommand,
    modelOutcomeCommand,
    modelStatsCommand,
    // Backward-compatible aliases for v2
    routeTaskCommand,
    sessionStartCommand,
    preBashCommand,
    postBashCommand,
    // Agent Teams integration
    teammateIdleCommand,
    taskCompletedCommand,
  ],
  options: [],
  examples: [
    { command: 'claude-flow hooks pre-edit -f src/utils.ts', description: 'Get context before editing' },
    { command: 'claude-flow hooks route -t "Fix authentication bug"', description: 'Route task to optimal agent' },
    { command: 'claude-flow hooks pretrain', description: 'Bootstrap intelligence from repository' },
    { command: 'claude-flow hooks metrics --v3-dashboard', description: 'View V3 performance metrics' }
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Self-Learning Hooks System'));
    output.writeln();
    output.writeln('Intelligent workflow automation with pattern learning and adaptive routing');
    output.writeln();
    output.writeln('Usage: claude-flow hooks <subcommand> [options]');
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      `${output.highlight('pre-edit')}        - Get context before editing files`,
      `${output.highlight('post-edit')}       - Record editing outcomes for learning`,
      `${output.highlight('pre-command')}     - Assess risk before executing commands`,
      `${output.highlight('post-command')}    - Record command execution outcomes`,
      `${output.highlight('pre-task')}        - Record task start and get agent suggestions`,
      `${output.highlight('post-task')}       - Record task completion for learning`,
      `${output.highlight('session-end')}     - End current session and persist state`,
      `${output.highlight('session-restore')} - Restore a previous session`,
      `${output.highlight('route')}           - Route tasks to optimal agents`,
      `${output.highlight('explain')}         - Explain routing decisions`,
      `${output.highlight('pretrain')}        - Bootstrap intelligence from repository`,
      `${output.highlight('build-agents')}    - Generate optimized agent configs`,
      `${output.highlight('metrics')}         - View learning metrics dashboard`,
      `${output.highlight('transfer')}        - Transfer patterns from another project`,
      `${output.highlight('list')}            - List all registered hooks`,
      `${output.highlight('worker')}          - Background worker management (12 workers)`,
      `${output.highlight('progress')}        - Check V3 implementation progress`,
      `${output.highlight('statusline')}      - Generate dynamic statusline display`,
      `${output.highlight('coverage-route')}  - Route tasks based on coverage gaps (ruvector)`,
      `${output.highlight('coverage-suggest')}- Suggest coverage improvements`,
      `${output.highlight('coverage-gaps')}   - List all coverage gaps with agents`,
      `${output.highlight('token-optimize')} - Token optimization (30-50% savings)`,
      `${output.highlight('model-route')}    - Route to optimal model (haiku/sonnet/opus)`,
      `${output.highlight('model-outcome')}  - Record model routing outcome`,
      `${output.highlight('model-stats')}    - View model routing statistics`,
      '',
      output.bold('Agent Teams:'),
      `${output.highlight('teammate-idle')}  - Handle idle teammate (auto-assign tasks)`,
      `${output.highlight('task-completed')} - Handle task completion (train patterns)`
    ]);
    output.writeln();
    output.writeln('Run "claude-flow hooks <subcommand> --help" for subcommand help');
    output.writeln();
    output.writeln(output.bold('V3 Features:'));
    output.printList([
      'ReasoningBank adaptive learning',
      'Flash Attention (CPU-optimized)',
      'AgentDB integration (150x faster search)',
      '84.8% SWE-Bench solve rate',
      '32.3% token reduction',
      '2.8-4.4x speed improvement',
      'Agent Teams integration (auto task assignment)'
    ]);

    return { success: true };
  }
};

export default hooksCommand;
