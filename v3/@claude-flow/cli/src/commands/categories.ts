/**
 * Command Categories for CLI Help Organization
 *
 * Organizes commands into logical groups following DDD bounded contexts (ADR-002)
 * and provides structured help output with clear visual hierarchy.
 *
 * @module commands/categories
 */

import type { Command } from '../types.js';

/**
 * Command category definition
 */
export interface CommandCategory {
  /** Category identifier */
  id: string;
  /** Display name for help output */
  name: string;
  /** Category description */
  description: string;
  /** Command names in this category */
  commands: string[];
  /** Display priority (lower = higher in help) */
  priority: number;
  /** Whether to show in condensed help */
  showInCondensed: boolean;
}

/**
 * Primary commands - Core workflow, most frequently used
 * These map to main DDD bounded contexts
 */
export const PRIMARY_COMMANDS: CommandCategory = {
  id: 'primary',
  name: 'PRIMARY COMMANDS',
  description: 'Core workflow and orchestration',
  commands: [
    'init',      // Project setup
    'start',     // Quick start
    'status',    // System status
    'agent',     // Agent lifecycle (bounded context)
    'swarm',     // Swarm coordination (bounded context)
    'memory',    // Memory management (bounded context)
    'task',      // Task execution (bounded context)
    'session',   // Session management (bounded context)
    'mcp',       // MCP server interface
    'hooks',     // Self-learning hooks system
  ],
  priority: 1,
  showInCondensed: true,
};

/**
 * Advanced commands - Specialized features for power users
 */
export const ADVANCED_COMMANDS: CommandCategory = {
  id: 'advanced',
  name: 'ADVANCED COMMANDS',
  description: 'AI, security, and performance features',
  commands: [
    'neural',       // Neural pattern training
    'security',     // Security scanning
    'performance',  // Performance profiling
    'embeddings',   // Vector embeddings
    'hive-mind',    // Queen-led consensus
    'ruvector',     // RuVector PostgreSQL bridge
  ],
  priority: 2,
  showInCondensed: true,
};

/**
 * Utility commands - System tools and configuration
 */
export const UTILITY_COMMANDS: CommandCategory = {
  id: 'utility',
  name: 'UTILITY COMMANDS',
  description: 'Configuration and system tools',
  commands: [
    'config',       // Configuration management
    'doctor',       // System diagnostics
    'daemon',       // Background workers
    'completions',  // Shell completions
    'migrate',      // V2 to V3 migration
    'workflow',     // Workflow templates
  ],
  priority: 3,
  showInCondensed: true,
};

/**
 * Analysis commands - Intelligence and routing
 */
export const ANALYSIS_COMMANDS: CommandCategory = {
  id: 'analysis',
  name: 'ANALYSIS COMMANDS',
  description: 'Code analysis and intelligent routing',
  commands: [
    'analyze',   // Code analysis (AST, diff, coverage)
    'route',     // Q-Learning agent routing
    'progress',  // Progress tracking
  ],
  priority: 4,
  showInCondensed: false,
};

/**
 * Management commands - Operations and lifecycle
 */
export const MANAGEMENT_COMMANDS: CommandCategory = {
  id: 'management',
  name: 'MANAGEMENT COMMANDS',
  description: 'Providers, plugins, and deployment',
  commands: [
    'providers',   // AI provider management
    'plugins',     // Plugin management
    'deployment',  // Deployment management
    'claims',      // Claims-based authorization
    'issues',      // Issue claims (ADR-016)
    'update',      // Auto-update system
    'process',     // Background processes
  ],
  priority: 5,
  showInCondensed: false,
};

/**
 * All command categories in display order
 */
export const COMMAND_CATEGORIES: CommandCategory[] = [
  PRIMARY_COMMANDS,
  ADVANCED_COMMANDS,
  UTILITY_COMMANDS,
  ANALYSIS_COMMANDS,
  MANAGEMENT_COMMANDS,
];

/**
 * Get all command names across all categories
 */
export function getAllCommandNames(): string[] {
  return COMMAND_CATEGORIES.flatMap(cat => cat.commands);
}

/**
 * Get category for a command
 */
export function getCategoryForCommand(commandName: string): CommandCategory | undefined {
  return COMMAND_CATEGORIES.find(cat => cat.commands.includes(commandName));
}

/**
 * Get categories to show in condensed help
 */
export function getCondensedCategories(): CommandCategory[] {
  return COMMAND_CATEGORIES.filter(cat => cat.showInCondensed);
}

/**
 * Format categories for help output
 */
export function formatCategoriesHelp(
  commands: Map<string, Command>,
  options: { condensed?: boolean; colored?: boolean } = {}
): string {
  const { condensed = false, colored = true } = options;
  const categories = condensed ? getCondensedCategories() : COMMAND_CATEGORIES;

  const lines: string[] = [];

  for (const category of categories) {
    // Category header
    if (colored) {
      lines.push(`\x1b[36m${category.name}:\x1b[0m`);
    } else {
      lines.push(`${category.name}:`);
    }

    // Commands in category
    for (const cmdName of category.commands) {
      const cmd = commands.get(cmdName);
      if (cmd && !cmd.hidden) {
        const padding = ' '.repeat(Math.max(2, 14 - cmdName.length));
        lines.push(`  ${cmdName}${padding}${cmd.description}`);
      }
    }

    lines.push(''); // Empty line between categories
  }

  // Add note about more commands if condensed
  if (condensed) {
    const hiddenCount = COMMAND_CATEGORIES
      .filter(cat => !cat.showInCondensed)
      .reduce((sum, cat) => sum + cat.commands.length, 0);

    if (hiddenCount > 0) {
      lines.push(`Run "claude-flow --help-all" to see ${hiddenCount} more commands`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Command counts by category for status display
 */
export function getCommandCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cat of COMMAND_CATEGORIES) {
    counts[cat.id] = cat.commands.length;
  }
  counts.total = getAllCommandNames().length;
  return counts;
}
