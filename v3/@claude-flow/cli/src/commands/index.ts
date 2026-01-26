/**
 * V3 CLI Commands Index
 * Central registry for all CLI commands with categorized help output
 *
 * All commands are now loaded synchronously to ensure consistent help output
 * and avoid missing commands in the CLI interface.
 *
 * @see ADR-002 DDD Structure - Commands organized by bounded context
 * @see ADR-045 CLI Command Registry - Complete command categorization
 */

import type { Command } from '../types.js';

// =============================================================================
// Command Category System
// =============================================================================

export * from './categories.js';
import {
  COMMAND_CATEGORIES,
  formatCategoriesHelp,
  getAllCommandNames,
  getCategoryForCommand,
  getCommandCounts,
} from './categories.js';

// =============================================================================
// Primary Commands - Core workflow (most frequently used)
// =============================================================================

import { initCommand } from './init.js';
import { startCommand } from './start.js';
import { statusCommand } from './status.js';
import { agentCommand } from './agent.js';
import { swarmCommand } from './swarm.js';
import { memoryCommand } from './memory.js';
import { taskCommand } from './task.js';
import { sessionCommand } from './session.js';
import { mcpCommand } from './mcp.js';
import { hooksCommand } from './hooks.js';

// =============================================================================
// Advanced Commands - AI, security, performance features
// =============================================================================

import { neuralCommand } from './neural.js';
import { securityCommand } from './security.js';
import { performanceCommand } from './performance.js';
import { embeddingsCommand } from './embeddings.js';
import { hiveMindCommand } from './hive-mind.js';
import { ruvectorCommand } from './ruvector/index.js';

// =============================================================================
// Utility Commands - Configuration and system tools
// =============================================================================

import { configCommand } from './config.js';
import { doctorCommand } from './doctor.js';
import { daemonCommand } from './daemon.js';
import { completionsCommand } from './completions.js';
import { migrateCommand } from './migrate.js';
import { workflowCommand } from './workflow.js';

// =============================================================================
// Analysis Commands - Intelligence and routing
// =============================================================================

import { analyzeCommand } from './analyze.js';
import { routeCommand } from './route.js';
import { progressCommand } from './progress.js';

// =============================================================================
// Management Commands - Providers, plugins, deployment
// =============================================================================

import { providersCommand } from './providers.js';
import { pluginsCommand } from './plugins.js';
import { deploymentCommand } from './deployment.js';
import { claimsCommand } from './claims.js';
import { issuesCommand } from './issues.js';
import updateCommand from './update.js';
import { processCommand } from './process.js';

// =============================================================================
// Command Registry
// =============================================================================

/**
 * All commands organized by category
 */
export const commandsByCategory = {
  primary: [
    initCommand,
    startCommand,
    statusCommand,
    agentCommand,
    swarmCommand,
    memoryCommand,
    taskCommand,
    sessionCommand,
    mcpCommand,
    hooksCommand,
  ],
  advanced: [
    neuralCommand,
    securityCommand,
    performanceCommand,
    embeddingsCommand,
    hiveMindCommand,
    ruvectorCommand,
  ],
  utility: [
    configCommand,
    doctorCommand,
    daemonCommand,
    completionsCommand,
    migrateCommand,
    workflowCommand,
  ],
  analysis: [
    analyzeCommand,
    routeCommand,
    progressCommand,
  ],
  management: [
    providersCommand,
    pluginsCommand,
    deploymentCommand,
    claimsCommand,
    issuesCommand,
    updateCommand,
    processCommand,
  ],
};

/**
 * All commands in a flat array (for backwards compatibility)
 */
export const commands: Command[] = [
  // Primary
  ...commandsByCategory.primary,
  // Advanced
  ...commandsByCategory.advanced,
  // Utility
  ...commandsByCategory.utility,
  // Analysis
  ...commandsByCategory.analysis,
  // Management
  ...commandsByCategory.management,
];

/**
 * Command registry map for quick lookup
 */
export const commandRegistry = new Map<string, Command>();

// Register all commands and their aliases
for (const cmd of commands) {
  commandRegistry.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      commandRegistry.set(alias, cmd);
    }
  }
}

// =============================================================================
// Command Exports (named exports for direct imports)
// =============================================================================

// Primary
export { initCommand } from './init.js';
export { startCommand } from './start.js';
export { statusCommand } from './status.js';
export { agentCommand } from './agent.js';
export { swarmCommand } from './swarm.js';
export { memoryCommand } from './memory.js';
export { taskCommand } from './task.js';
export { sessionCommand } from './session.js';
export { mcpCommand } from './mcp.js';
export { hooksCommand } from './hooks.js';

// Advanced
export { neuralCommand } from './neural.js';
export { securityCommand } from './security.js';
export { performanceCommand } from './performance.js';
export { embeddingsCommand } from './embeddings.js';
export { hiveMindCommand } from './hive-mind.js';
export { ruvectorCommand } from './ruvector/index.js';

// Utility
export { configCommand } from './config.js';
export { doctorCommand } from './doctor.js';
export { daemonCommand } from './daemon.js';
export { completionsCommand } from './completions.js';
export { migrateCommand } from './migrate.js';
export { workflowCommand } from './workflow.js';

// Analysis
export { analyzeCommand } from './analyze.js';
export { routeCommand } from './route.js';
export { progressCommand } from './progress.js';

// Management
export { providersCommand } from './providers.js';
export { pluginsCommand } from './plugins.js';
export { deploymentCommand } from './deployment.js';
export { claimsCommand } from './claims.js';
export { issuesCommand } from './issues.js';
export { updateCommand };
export { processCommand } from './process.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get command by name
 */
export function getCommand(name: string): Command | undefined {
  return commandRegistry.get(name);
}

/**
 * Get command by name (async for backwards compatibility)
 */
export async function getCommandAsync(name: string): Promise<Command | undefined> {
  return commandRegistry.get(name);
}

/**
 * Check if command exists
 */
export function hasCommand(name: string): boolean {
  return commandRegistry.has(name);
}

/**
 * Get all command names (including aliases)
 */
export function getCommandNames(): string[] {
  return Array.from(commandRegistry.keys());
}

/**
 * Get all unique commands (excluding aliases and hidden)
 */
export function getUniqueCommands(): Command[] {
  return commands.filter(cmd => !cmd.hidden);
}

/**
 * Load all commands (sync - all already loaded)
 */
export async function loadAllCommands(): Promise<Command[]> {
  return commands;
}

/**
 * Setup commands in a CLI instance
 */
export function setupCommands(cli: { command: (cmd: Command) => void }): void {
  for (const cmd of commands) {
    cli.command(cmd);
  }
}

/**
 * Setup all commands (async for backwards compatibility)
 */
export async function setupAllCommands(cli: { command: (cmd: Command) => void }): Promise<void> {
  setupCommands(cli);
}

/**
 * Format help output with categorized commands
 */
export function formatHelpWithCategories(options?: { condensed?: boolean; colored?: boolean }): string {
  return formatCategoriesHelp(commandRegistry, options);
}

/**
 * Get command statistics
 */
export function getCommandStats(): {
  total: number;
  byCategory: Record<string, number>;
  withSubcommands: number;
} {
  const counts = getCommandCounts();
  const withSubcommands = commands.filter(c => c.subcommands && c.subcommands.length > 0).length;

  return {
    total: commands.length,
    byCategory: counts,
    withSubcommands,
  };
}
