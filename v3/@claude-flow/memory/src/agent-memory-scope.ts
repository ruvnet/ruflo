/**
 * Agent-Scoped Memory - Support for Claude Code's 3-scope agent memory directories
 *
 * Claude Code organizes agent memory into three scopes:
 * - **project**: Shared across all collaborators (checked into git)
 * - **local**: Machine-specific, not shared (gitignored)
 * - **user**: Global per-user, spans all projects
 *
 * Each scope stores agent-specific memory in a named subdirectory,
 * enabling isolated yet transferable knowledge between agents.
 *
 * @module @claude-flow/memory/agent-memory-scope
 */

import * as path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import type { IMemoryBackend, MemoryEntry } from './types.js';
import { AutoMemoryBridge } from './auto-memory-bridge.js';
import type {
  AutoMemoryBridgeConfig,
  MemoryInsight,
  InsightCategory,
} from './auto-memory-bridge.js';

// ===== Types =====

/** Claude Code's 3-scope agent memory system */
export type AgentMemoryScope = 'project' | 'local' | 'user';

/** Configuration for agent-scoped memory bridge */
export interface AgentScopedConfig extends AutoMemoryBridgeConfig {
  /** Agent name (used in directory path) */
  agentName: string;
  /** Memory scope */
  scope: AgentMemoryScope;
}

/** Options for knowledge transfer between agents */
export interface TransferOptions {
  /** Source namespace to transfer from */
  sourceNamespace: string;
  /** Minimum confidence to include (default: 0.8) */
  minConfidence?: number;
  /** Maximum entries to transfer (default: 20) */
  maxEntries?: number;
  /** Filter by categories */
  categories?: InsightCategory[];
}

/** Result of a knowledge transfer */
export interface TransferResult {
  /** Number of entries transferred */
  transferred: number;
  /** Number of entries skipped (below threshold or duplicate) */
  skipped: number;
}

// ===== Internal Helpers =====

/**
 * Find the git root directory by walking up from a starting directory.
 * Synchronous variant for path resolution (no async needed for stat checks).
 */
function findGitRootSync(dir: string): string | null {
  let current = path.resolve(dir);
  const root = path.parse(current).root;

  while (current !== root) {
    if (existsSync(path.join(current, '.git'))) {
      return current;
    }
    current = path.dirname(current);
  }

  return null;
}

/**
 * List agent subdirectories inside a given directory.
 * Returns an empty array if the directory does not exist or is unreadable.
 */
function listAgentsInDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(path.join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

// ===== Public Functions =====

/**
 * Resolve the agent memory directory for a given agent name, scope, and working directory.
 *
 * Path resolution matches Claude Code binary behavior:
 * ```
 * project: <gitRoot>/.claude/agent-memory/<agentName>/
 * local:   <gitRoot>/.claude/agent-memory-local/<agentName>/
 * user:    ~/.claude/agent-memory/<agentName>/
 * ```
 *
 * Agent names are sanitized to prevent path traversal attacks.
 *
 * @param agentName - The agent identifier
 * @param scope - Memory scope: project, local, or user
 * @param workingDir - Working directory for git root detection (defaults to cwd)
 * @returns Absolute path to the agent's memory directory
 */
export function resolveAgentMemoryDir(
  agentName: string,
  scope: AgentMemoryScope,
  workingDir?: string,
): string {
  // Sanitize agent name to prevent path traversal
  const safeName = agentName.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (scope === 'user') {
    const home = process.env.HOME
      || process.env.USERPROFILE
      || (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : '');
    if (!home) {
      throw new Error('Cannot determine home directory: HOME, USERPROFILE, and HOMEDRIVE+HOMEPATH are all undefined');
    }
    return path.join(home, '.claude', 'agent-memory', safeName);
  }

  // For project and local scopes, find git root
  const effectiveDir = workingDir || process.cwd();
  const gitRoot = findGitRootSync(effectiveDir);
  const baseDir = gitRoot || effectiveDir;

  if (scope === 'local') {
    return path.join(baseDir, '.claude', 'agent-memory-local', safeName);
  }

  // scope === 'project'
  return path.join(baseDir, '.claude', 'agent-memory', safeName);
}

/**
 * Create an AutoMemoryBridge configured for a specific agent scope.
 *
 * This is the primary factory for creating scoped bridges. It resolves
 * the correct memory directory based on agent name and scope, then
 * delegates to AutoMemoryBridge for the actual sync logic.
 *
 * @param backend - The AgentDB memory backend
 * @param config - Agent-scoped configuration
 * @returns A configured AutoMemoryBridge instance
 *
 * @example
 * ```typescript
 * const bridge = createAgentBridge(backend, {
 *   agentName: 'coder',
 *   scope: 'project',
 *   syncMode: 'on-write',
 * });
 * await bridge.recordInsight({ ... });
 * ```
 */
export function createAgentBridge(
  backend: IMemoryBackend,
  config: AgentScopedConfig,
): AutoMemoryBridge {
  const memoryDir = resolveAgentMemoryDir(
    config.agentName,
    config.scope,
    config.workingDir,
  );

  return new AutoMemoryBridge(backend, {
    ...config,
    memoryDir,
  });
}

/**
 * Transfer knowledge from a source backend namespace into a target bridge.
 *
 * Queries high-confidence entries from the source and records them as
 * insights in the target bridge. Useful for cross-agent knowledge sharing
 * or promoting learnings from one scope to another.
 *
 * @param sourceBackend - Backend to query entries from
 * @param targetBridge - Bridge to record insights into
 * @param options - Transfer options (namespace, filters, limits)
 * @returns Transfer result with counts of transferred and skipped entries
 *
 * @example
 * ```typescript
 * const result = await transferKnowledge(sourceBackend, targetBridge, {
 *   sourceNamespace: 'learnings',
 *   minConfidence: 0.9,
 *   maxEntries: 10,
 *   categories: ['architecture', 'security'],
 * });
 * console.log(`Transferred ${result.transferred}, skipped ${result.skipped}`);
 * ```
 */
export async function transferKnowledge(
  sourceBackend: IMemoryBackend,
  targetBridge: AutoMemoryBridge,
  options: TransferOptions,
): Promise<TransferResult> {
  const {
    sourceNamespace,
    minConfidence = 0.8,
    maxEntries = 20,
    categories,
  } = options;

  let transferred = 0;
  let skipped = 0;

  // Query high-confidence entries from source (fetch extra to allow for filtering)
  const entries = await sourceBackend.query({
    type: 'hybrid',
    namespace: sourceNamespace,
    tags: ['insight'],
    limit: maxEntries * 2,
  });

  for (const entry of entries) {
    if (transferred >= maxEntries) break;

    const confidence = (entry.metadata?.confidence as number) || 0;
    if (confidence < minConfidence) {
      skipped++;
      continue;
    }

    // Filter by category if specified
    const entryCategory = entry.metadata?.category as InsightCategory | undefined;
    if (
      categories &&
      categories.length > 0 &&
      entryCategory &&
      !categories.includes(entryCategory)
    ) {
      skipped++;
      continue;
    }

    // Record as insight in target bridge
    const insight: MemoryInsight = {
      category: entryCategory || 'project-patterns',
      summary:
        (entry.metadata?.summary as string) || entry.content.split('\n')[0],
      detail: entry.content,
      source: `transfer:${sourceNamespace}`,
      confidence,
      agentDbId: entry.id,
    };

    await targetBridge.recordInsight(insight);
    transferred++;
  }

  return { transferred, skipped };
}

/**
 * List all agent scopes and their agents for the current project.
 *
 * Scans the three scope directories (project, local, user) and returns
 * the agent names found in each. Useful for discovery and diagnostics.
 *
 * @param workingDir - Working directory for git root detection (defaults to cwd)
 * @returns Array of scope/agents pairs
 *
 * @example
 * ```typescript
 * const scopes = listAgentScopes('/workspaces/my-project');
 * // [
 * //   { scope: 'project', agents: ['coder', 'tester'] },
 * //   { scope: 'local', agents: ['researcher'] },
 * //   { scope: 'user', agents: ['planner'] },
 * // ]
 * ```
 */
export function listAgentScopes(
  workingDir?: string,
): Array<{ scope: AgentMemoryScope; agents: string[] }> {
  const effectiveDir = workingDir || process.cwd();
  const gitRoot = findGitRootSync(effectiveDir);
  const baseDir = gitRoot || effectiveDir;
  const home = process.env.HOME
    || process.env.USERPROFILE
    || (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : '')
    || '';

  const projectDir = path.join(baseDir, '.claude', 'agent-memory');
  const localDir = path.join(baseDir, '.claude', 'agent-memory-local');
  const userDir = path.join(home, '.claude', 'agent-memory');

  return [
    { scope: 'project' as AgentMemoryScope, agents: listAgentsInDir(projectDir) },
    { scope: 'local' as AgentMemoryScope, agents: listAgentsInDir(localDir) },
    { scope: 'user' as AgentMemoryScope, agents: listAgentsInDir(userDir) },
  ];
}
