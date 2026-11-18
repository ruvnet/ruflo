/**
 * `ruflo plugins host <action>` — dual-host (Claude Code + Codex) installer for
 * Ruflo marketplace plugins (#2854). Every host mutation goes through that
 * host's own plugin CLI via HostPluginManager (literal argv, no shell).
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  HostPluginInputError,
  HostPluginManager,
  type HostAction,
  type HostOperationOptions,
  type HostOperationReport,
  type HostScope,
  type HostSelection,
  type HostTargetResult,
} from '../services/host-plugin-manager.js';

const HOST_VALUES: readonly HostSelection[] = ['claude', 'codex', 'both'];
const SCOPE_VALUES: readonly HostScope[] = ['user', 'project', 'local'];

const commonOptions: Command['options'] = [
  { name: 'host', type: 'string', description: 'claude | codex | both (default: every host that is installed)' },
  { name: 'marketplace', type: 'string', description: 'Marketplace source as owner/repo', default: 'ruvnet/ruflo' },
  { name: 'marketplace-name', type: 'string', description: 'Marketplace name the source registers as', default: 'ruflo' },
  { name: 'scope', type: 'string', description: 'Claude scope: user | project | local (Codex supports user only)', default: 'user' },
  { name: 'dry-run', type: 'boolean', description: 'Print the exact argv that would run, change nothing' },
  { name: 'json', type: 'boolean', description: 'Print the structured per-host report as JSON' },
];

/** Exposed for tests: lets them inject a manager wired to fake host CLIs. */
export const hostCommandRuntime = { createManager: (): HostPluginManager => new HostPluginManager() };

function flag(ctx: CommandContext, kebab: string): unknown {
  const camel = kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return ctx.flags[kebab] ?? ctx.flags[camel];
}

function readOptions(ctx: CommandContext): HostOperationOptions {
  const host = flag(ctx, 'host');
  if (host !== undefined && !HOST_VALUES.includes(host as HostSelection)) {
    throw new HostPluginInputError(`--host must be one of ${HOST_VALUES.join(', ')}`);
  }
  const scope = (flag(ctx, 'scope') ?? 'user') as HostScope;
  if (!SCOPE_VALUES.includes(scope)) throw new HostPluginInputError(`--scope must be one of ${SCOPE_VALUES.join(', ')}`);
  return {
    hosts: (host as HostSelection | undefined) ?? 'auto',
    scope,
    dryRun: flag(ctx, 'dry-run') === true,
    cwd: ctx.cwd,
    marketplace: {
      source: (flag(ctx, 'marketplace') as string | undefined) ?? undefined,
      name: (flag(ctx, 'marketplace-name') as string | undefined) ?? undefined,
    },
  };
}

function renderResult(r: HostTargetResult): void {
  const tag = r.outcome === 'ok' || r.outcome === 'unchanged' ? output.success(r.outcome)
    : r.outcome === 'planned' ? output.highlight(r.outcome) : output.error(r.outcome);
  output.writeln(`  [${r.host}] ${r.target}: ${tag}${r.message ? ` — ${r.message}` : ''}`);
  for (const s of r.steps) {
    output.writeln(`      $ ${s.display}${s.ok === false ? output.error('  (failed)') : ''}`);
    if (s.stderr) output.writeln(output.dim(`        ${s.stderr.split('\n').slice(0, 3).join(' | ')}`));
  }
  if (r.manual) output.writeln(output.dim(`      manual: ${r.manual}`));
}

function finish(ctx: CommandContext, report: HostOperationReport & Record<string, unknown>): CommandResult {
  if (flag(ctx, 'json') === true) {
    output.writeln(JSON.stringify(report, null, 2));
  } else {
    output.writeln(output.bold(`plugins host ${report.action}${report.dryRun ? ' (dry run — nothing executed)' : ''}`));
    for (const r of report.results) renderResult(r);
    output.writeln(report.ok ? output.success('all requested hosts succeeded') : output.error('one or more hosts failed — see above'));
  }
  return { success: report.ok, exitCode: report.ok ? 0 : 1, data: report };
}

function fail(ctx: CommandContext, err: unknown): CommandResult {
  const message = err instanceof Error ? err.message : String(err);
  if (flag(ctx, 'json') === true) output.writeln(JSON.stringify({ ok: false, error: message }));
  else output.printError(message);
  return { success: false, exitCode: 1, message };
}

function actionCommand(action: HostAction, description: string): Command {
  return {
    name: action,
    description,
    options: commonOptions,
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      try {
        const report = await hostCommandRuntime.createManager().apply(action, ctx.args, readOptions(ctx));
        return finish(ctx, report as HostOperationReport & Record<string, unknown>);
      } catch (err) {
        return fail(ctx, err);
      }
    },
  };
}

const syncCommand: Command = {
  name: 'sync',
  description: 'Make Claude Code and Codex match: same marketplace, union of enabled plugins (additive, never removes)',
  options: commonOptions,
  action: async (ctx) => {
    try {
      const report = await hostCommandRuntime.createManager().sync(readOptions(ctx));
      return finish(ctx, report as unknown as HostOperationReport & Record<string, unknown>);
    } catch (err) {
      return fail(ctx, err);
    }
  },
};

const statusCommand: Command = {
  name: 'status',
  description: 'Show each host\'s installed version per Ruflo plugin and flag drift',
  options: commonOptions,
  action: async (ctx) => {
    try {
      const status = await hostCommandRuntime.createManager().status(readOptions(ctx));
      if (flag(ctx, 'json') === true) {
        output.writeln(JSON.stringify(status, null, 2));
      } else {
        for (const h of status.hosts) renderResult(h);
        for (const [host, src] of Object.entries(status.marketplaces)) {
          output.writeln(`  [${host}] marketplace: ${src ?? output.warning('not registered')}`);
        }
        const fmt = (s: { version: string; enabled: boolean } | null) => (s ? `${s.version}${s.enabled ? '' : ' (disabled)'}` : '-');
        output.printTable({
          columns: [
            { key: 'plugin', header: 'Plugin', width: 28 },
            { key: 'claude', header: 'Claude', width: 18 },
            { key: 'codex', header: 'Codex', width: 18 },
            { key: 'drift', header: 'Drift', width: 36 },
          ],
          data: status.rows.map((r) => ({ plugin: r.plugin, claude: fmt(r.claude), codex: fmt(r.codex), drift: r.drift.join('; ') || 'in sync' })),
        });
      }
      return { success: status.ok, exitCode: status.ok ? 0 : 1, data: status };
    } catch (err) {
      return fail(ctx, err);
    }
  },
};

export const hostCommand: Command = {
  name: 'host',
  description: 'Install/update/remove Ruflo marketplace plugins in Claude Code and Codex together',
  subcommands: [
    actionCommand('install', 'Install plugin(s) in every selected host'),
    actionCommand('update', 'Refresh the marketplace and update plugin(s) in every selected host'),
    actionCommand('uninstall', 'Uninstall plugin(s) from every selected host'),
    actionCommand('enable', 'Enable plugin(s) in every selected host'),
    actionCommand('disable', 'Disable plugin(s) in every selected host'),
    syncCommand,
    statusCommand,
  ],
  examples: [
    { command: 'ruflo plugins host install ruflo-swarm', description: 'Install in Claude Code and Codex' },
    { command: 'ruflo plugins host sync --dry-run', description: 'Show what sync would run' },
    { command: 'ruflo plugins host status', description: 'Per-host versions and drift' },
  ],
  action: async () => {
    output.writeln('Usage: ruflo plugins host <install|update|uninstall|enable|disable|sync|status> [plugin...] [--host claude|codex|both] [--dry-run]');
    return { success: true };
  },
};
