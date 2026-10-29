/**
 * ADR-510 §2.3 — `ruflo plugins paths [--json] [--names a,b]`.
 *
 * Prints the folder each ruflo plugin resolves to (the same resolver headless
 * workers use for `--plugin-dir`), so an Agent SDK caller can build
 * `plugins: [{ type: "local", path }]`, and lists plugins that could not be
 * found. Read-only.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { MOD_PLUGIN_IDS } from '../mods/install.js';
import { resolvePluginPaths } from '../mods/plugin-paths.js';

/** Default list: every plugin `ruflo mods install` enables. */
export const DEFAULT_PATH_PLUGINS: readonly string[] = MOD_PLUGIN_IDS.map((id) => id.split('@')[0]!);

const PLUGIN_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export const pathsCommand: Command = {
  name: 'paths',
  description: 'Print the local folder of each ruflo plugin (for claude -p --plugin-dir or Agent SDK plugins)',
  options: [
    { name: 'names', short: 'n', type: 'string', description: `Comma list of plugin names (default: ${DEFAULT_PATH_PLUGINS.join(',')})` },
    { name: 'json', type: 'boolean', description: 'Print { resolved, missing } as JSON', default: false },
  ],
  examples: [
    { command: 'ruflo plugins paths', description: 'Where ruflo-mods, ruflo-swarm and ruflo-console live on this machine' },
    { command: 'ruflo plugins paths --names ruflo-mods --json', description: 'JSON for an Agent SDK plugins array' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const raw = ctx.flags.names as string | undefined;
    const names = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [...DEFAULT_PATH_PLUGINS];
    const bad = names.filter((n) => !PLUGIN_NAME.test(n.split('@')[0]!));
    if (bad.length > 0) {
      const message = `invalid plugin name: ${bad.map((b) => JSON.stringify(b)).join(', ')}`;
      if (ctx.flags.json) output.writeln(JSON.stringify({ resolved: [], missing: [], error: message }));
      else output.printError(message);
      return { success: false, exitCode: 1, message };
    }
    const result = resolvePluginPaths(names, { projectRoot: ctx.cwd || process.cwd() });
    if (ctx.flags.json) {
      output.writeln(JSON.stringify(result, null, 2));
    } else {
      for (const p of result.resolved) output.writeln(`${p.name}\t${p.path}\t(${p.source})`);
      for (const m of result.missing) output.writeln(output.dim(`${m.name}\tmissing: ${m.reason}`));
      if (result.resolved.length > 0) {
        output.writeln(output.dim('Agent SDK: plugins: [{ type: "local", path }] — check the init message\'s plugin_errors'));
      }
    }
    // Missing plugins are reported, not an error: a worker still runs without them.
    return { success: true, exitCode: 0, data: result };
  },
};
