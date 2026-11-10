/**
 * V3 CLI Cleanup Command
 * Removes project artifacts created by claude-flow/ruflo
 *
 * Created with ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { existsSync, statSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Ruflo-owned subdirectories within .claude/ that are safe to delete.
 * Everything else in .claude/ (agents, skills, commands, settings.local.json,
 * memory.db, worktrees, launch.json) belongs to Claude Code and must be preserved.
 * See: https://github.com/ruvnet/ruflo/issues/1557
 */
const CLAUDE_OWNED_SUBDIRS = [
  { path: join('.claude', 'helpers'), description: 'Ruflo hook scripts' },
];

/**
 * Artifact directories and files that claude-flow/ruflo may create
 */
const ARTIFACT_DIRS = [
  { path: '.claude-flow', description: 'Capabilities and configuration' },
  { path: '.swarm', description: 'Swarm state' },
  { path: '.hive-mind', description: 'Consensus state' },
  { path: 'coordination', description: 'Coordination data' },
];

/**
 * Directories a project may own just as well as ruflo. Each one is removed only
 * when it holds a path ruflo itself writes, so `cleanup --force` cannot take a
 * project's own `data/` or `memory/` folder with it (issue #4833):
 *   - `data/memory` is the default `CLAUDE_FLOW_MEMORY_PATH` store directory.
 *   - `memory/memory.db` is the v2 memory database.
 */
const SHARED_ARTIFACT_DIRS = [
  { path: 'data', description: 'Memory databases', markers: [join('data', 'memory')] },
  { path: 'memory', description: 'Memory storage', markers: [join('memory', 'memory.db'), join('memory', 'store.json')] },
];

const ARTIFACT_FILES = [
  { path: 'claude-flow.config.json', description: 'Claude Flow configuration' },
];

/**
 * Paths to preserve when --keep-config is set
 */
const KEEP_CONFIG_PATHS = [
  'claude-flow.config.json',
  join('.claude', 'settings.json'),
];

/**
 * What makes a hook entry ruflo's: its command runs one of the helpers ruflo
 * deploys into `.claude/helpers/`, or names the CLI itself. Every other entry in
 * `.claude/settings.json` belongs to the user and must survive (issue #4833).
 */
const RUFLO_HOOK_COMMAND = /(?:^|[\s"'/\\])\.claude[\\/]helpers[\\/]|(?:^|[\s"'/\\])claude-flow(?:@|[\s"'/\\]|$)|(?:^|[\s"'/\\])ruflo(?:@|[\s"'/\\]|$)/i;

type HookEntry = { command?: unknown };
type HookMatcher = { hooks?: unknown };

function isRufloHook(hook: unknown): boolean {
  const command = (hook as HookEntry | null)?.command;
  return typeof command === 'string' && RUFLO_HOOK_COMMAND.test(command);
}

/**
 * Drop ruflo's hook matchers from a settings `hooks` block and keep everything the
 * user wrote. A matcher that mixes both keeps its user half. Returns undefined when
 * no hook is left, so the caller can drop the key entirely.
 */
function pruneRufloHooks(hooks: unknown): Record<string, unknown> | undefined {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return undefined;
  const kept: Record<string, unknown> = {};

  for (const [event, matchers] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(matchers)) {
      kept[event] = matchers;
      continue;
    }
    const survivors: unknown[] = [];
    for (const matcher of matchers as HookMatcher[]) {
      const inner = matcher?.hooks;
      if (!Array.isArray(inner)) {
        survivors.push(matcher);
        continue;
      }
      const rest = inner.filter((hook) => !isRufloHook(hook));
      if (rest.length === inner.length) survivors.push(matcher);
      else if (rest.length > 0) survivors.push({ ...matcher, hooks: rest });
    }
    if (survivors.length > 0) kept[event] = survivors;
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Calculate the total size of a path (file or directory) in bytes
 */
function getSize(fullPath: string): number {
  try {
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      return stat.size;
    }
    if (stat.isDirectory()) {
      let total = 0;
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        total += getSize(join(fullPath, entry.name));
      }
      return total;
    }
  } catch {
    // Permission errors, broken symlinks, etc.
  }
  return 0;
}

/**
 * Format bytes into a human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Cleanup command definition
 */
export const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Remove project artifacts created by claude-flow/ruflo',
  aliases: ['clean'],
  options: [
    {
      name: 'dry-run',
      short: 'n',
      description: 'Show what would be removed without deleting (default behavior)',
      type: 'boolean',
      default: true,
    },
    {
      name: 'force',
      short: 'f',
      description: 'Actually delete the artifacts',
      type: 'boolean',
      default: false,
    },
    {
      name: 'keep-config',
      short: 'k',
      description: 'Preserve claude-flow.config.json and .claude/settings.json',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    {
      command: 'cleanup',
      description: 'Show what would be removed (dry run)',
    },
    {
      command: 'cleanup --force',
      description: 'Remove all claude-flow artifacts',
    },
    {
      command: 'cleanup --force --keep-config',
      description: 'Remove artifacts but keep configuration files',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force === true;
    const keepConfig = ctx.flags.keepConfig === true || ctx.flags['keep-config'] === true;
    const cwd = ctx.cwd;

    const dryRun = !force;

    output.writeln();
    output.writeln(output.bold(dryRun
      ? 'Claude Flow Cleanup (dry run)'
      : 'Claude Flow Cleanup'));
    output.writeln();

    const found: { path: string; description: string; size: number; type: 'dir' | 'file'; skipped?: boolean }[] = [];
    let totalSize = 0;

    // Scan ruflo-owned subdirs within .claude/ (surgical — preserves Claude Code files)
    for (const artifact of CLAUDE_OWNED_SUBDIRS) {
      const fullPath = join(cwd, artifact.path);
      if (existsSync(fullPath)) {
        const size = getSize(fullPath);
        found.push({ path: artifact.path, description: artifact.description, size, type: 'dir' });
        totalSize += size;
      }
    }

    // Check if .claude/settings.json has ruflo hooks/claudeFlow blocks to clean
    const settingsPath = join(cwd, '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      found.push({ path: join('.claude', 'settings.json'), description: 'Remove ruflo hooks/claudeFlow blocks (preserves rest)', size: 0, type: 'file' });
    }

    // Scan standalone artifact directories
    for (const artifact of ARTIFACT_DIRS) {
      const fullPath = join(cwd, artifact.path);
      if (existsSync(fullPath)) {
        const size = getSize(fullPath);
        found.push({ path: artifact.path, description: artifact.description, size, type: 'dir' });
        totalSize += size;
      }
    }

    // Scan directories a project may own. A bare `data/` or `memory/` is not
    // enough: only the presence of ruflo's own file inside makes it an artifact.
    for (const artifact of SHARED_ARTIFACT_DIRS) {
      const fullPath = join(cwd, artifact.path);
      if (!existsSync(fullPath)) continue;
      const owned = artifact.markers.some((marker) => existsSync(join(cwd, marker)));
      if (!owned) {
        output.writeln(output.dim(`  [skip] dir   ${artifact.path}  - not created by ruflo`));
        continue;
      }
      const size = getSize(fullPath);
      found.push({ path: artifact.path, description: artifact.description, size, type: 'dir' });
      totalSize += size;
    }

    // Scan files
    for (const artifact of ARTIFACT_FILES) {
      const fullPath = join(cwd, artifact.path);
      if (existsSync(fullPath)) {
        const size = getSize(fullPath);
        found.push({ path: artifact.path, description: artifact.description, size, type: 'file' });
        totalSize += size;
      }
    }

    if (found.length === 0) {
      output.writeln(output.info('No claude-flow artifacts found in the current directory.'));
      return { success: true, message: 'Nothing to clean' };
    }

    // Mark items that would be skipped due to --keep-config
    if (keepConfig) {
      for (const item of found) {
        if (KEEP_CONFIG_PATHS.includes(item.path)) {
          item.skipped = true;
        }
      }
    }

    // Display what was found
    output.writeln(output.bold('Artifacts found:'));
    output.writeln();

    let removedCount = 0;
    let removedSize = 0;
    let skippedCount = 0;

    for (const item of found) {
      const sizeStr = formatSize(item.size);
      const typeLabel = item.type === 'dir' ? 'dir ' : 'file';

      if (item.skipped) {
        output.writeln(output.dim(`  [skip] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
        skippedCount++;
        continue;
      }

      if (dryRun) {
        output.writeln(output.warning(`  [would remove] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
      } else {
        // Actually delete
        try {
          const fullPath = join(cwd, item.path);
          // Special handling: surgically clean settings.json instead of deleting
          if (item.path === join('.claude', 'settings.json')) {
            try {
              const raw = JSON.parse(readFileSync(fullPath, 'utf-8'));
              // Only ruflo's own hook entries go; the user's hooks stay (#4833).
              const hooks = pruneRufloHooks(raw.hooks);
              if (hooks === undefined) delete raw.hooks;
              else raw.hooks = hooks;
              delete raw.claudeFlow;
              writeFileSync(fullPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
            } catch { /* settings.json parse failed, skip */ }
          } else if (item.type === 'dir') {
            rmSync(fullPath, { recursive: true, force: true });
          } else {
            rmSync(fullPath, { force: true });
          }
          output.writeln(output.success(`  [removed] ${typeLabel}  ${item.path}  (${sizeStr}) - ${item.description}`));
          removedCount++;
          removedSize += item.size;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          output.writeln(output.error(`  [failed] ${typeLabel}  ${item.path}  - ${msg}`));
        }
      }
    }

    // Summary
    output.writeln();
    output.writeln(output.bold('Summary:'));

    if (dryRun) {
      const actionable = found.filter(f => !f.skipped);
      output.writeln(`  Found ${actionable.length} artifact(s) totaling ${formatSize(totalSize)}`);
      if (skippedCount > 0) {
        output.writeln(`  ${skippedCount} item(s) would be preserved (--keep-config)`);
      }
      output.writeln();
      output.writeln(output.dim('  This was a dry run. Use --force to actually remove artifacts.'));
    } else {
      output.writeln(`  Removed ${removedCount} artifact(s) totaling ${formatSize(removedSize)}`);
      if (skippedCount > 0) {
        output.writeln(`  Preserved ${skippedCount} item(s) (--keep-config)`);
      }
    }

    output.writeln();

    return {
      success: true,
      message: dryRun
        ? `Dry run: ${found.length} artifact(s) found`
        : `Removed ${removedCount} artifact(s)`,
      data: { found, removedCount, removedSize, dryRun },
    };
  },
};

export default cleanupCommand;
