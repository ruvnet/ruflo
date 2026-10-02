/**
 * `ruflo mods` — opt into running ruflo as a Claude Code mod (ADR-404,
 * Claude Code function hooks, early access).
 *
 * install/uninstall edit one settings file and record what they added;
 * status/doctor report what can be known from outside a session; sync-policy
 * rewrites the policy projection the mod's tool check reads. Classic hooks
 * are never removed: they stay the default and the fallback.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { installMod, uninstallMod, type Scope } from '../mods/install.js';
import { probeMods, type Finding } from '../mods/probe.js';
import { claudeConfigDir, marketplaceState, repairCommands, resolveFindings } from '../mods/plugin-resolve.js';
import { findClaudeBinary, repairArgv, repairPluginInstall } from '../mods/plugin-repair.js';
import { homedir } from 'node:os';
import { modsDisableSub, modsEnableSub, modsListSub } from './mods-manage.js';
import { installManager, MANAGER_PLUGIN_ID, removeManager } from '../init/mods-generator.js';

function projectRoot(ctx: CommandContext): string {
  return (ctx.flags.projectRoot as string | undefined) ?? (ctx.flags['project-root'] as string | undefined) ?? ctx.cwd ?? process.cwd();
}

function printFindings(findings: Finding[]): void {
  for (const f of findings) {
    const mark = f.status === 'pass' ? output.success('✓') : f.status === 'warn' ? output.warning('!') : output.error('✗');
    output.writeln(`${mark} ${f.name}: ${f.message}`);
    if (f.fix && f.status !== 'pass') output.writeln(output.dim(`    fix: ${f.fix}`));
  }
}

const rootOption = { name: 'project-root', description: 'Project root (default: current directory)', type: 'string' as const };

const installSub: Command = {
  name: 'install',
  description: 'Enable the ruflo-mods plugin for this project (opt-in; classic hooks stay as fallback)',
  options: [
    rootOption,
    { name: 'scope', description: 'local (.claude/settings.local.json, default) | project (.claude/settings.json)', type: 'string', default: 'local' },
    { name: 'dry-run', description: 'Show the settings that would be written and the claude commands that would run', type: 'boolean', default: false },
    { name: 'plugin-install', description: 'Refresh the ruflo marketplace and run `claude plugin install` (--no-plugin-install to only write settings)', type: 'boolean', default: true },
    { name: 'strict', description: 'Exit 1 when the plugin could not be made resolvable', type: 'boolean', default: false },
    { name: 'manager', description: 'Also enable and install the mod manager, ruflo-mods-manager (ADR-407; --no-manager skips it)', type: 'boolean', default: true },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const scope = (ctx.flags.scope as string | undefined) ?? 'local';
    if (scope !== 'local' && scope !== 'project') {
      output.printError(`--scope must be local or project, got ${scope}`);
      return { success: false, exitCode: 1 };
    }
    const root = projectRoot(ctx);
    const pluginInstall = ctx.flags.pluginInstall !== false && ctx.flags['plugin-install'] !== false;
    const result = installMod(root, scope as Scope, (ctx.flags.dryRun === true || ctx.flags['dry-run'] === true));
    if (result.dryRun) {
      output.writeln(`Would write ${result.settingsFile}:`);
      output.printJson(result.next);
      if (pluginInstall) {
        const known = marketplaceState(claudeConfigDir(process.env, homedir())).known;
        output.writeln('Would run:');
        for (const argv of repairArgv(scope as Scope, known)) output.writeln(`  claude ${argv.join(' ')}`);
      }
      return { success: true, data: result };
    }
    await syncPolicy(root, true);
    output.printSuccess(`ruflo-mods enabled in ${result.settingsFile}${result.backup ? ` (backup: ${result.backup})` : ''}`);
    const resolvable = pluginInstall ? await makeResolvable(root, scope as Scope) : true;
    if (ctx.flags.manager !== false) {
      const m = await installManager({ projectRoot: root, pluginInstall: pluginInstall && resolvable });
      output.writeln(m.step ? `${m.step.ok ? output.success('✓') : output.error('✗')} claude ${m.step.argv.join(' ')}` : output.dim(`${MANAGER_PLUGIN_ID} enabled in settings; not installed: ${m.skip}`));
    }
    if (resolvable) {
      output.writeln('Restart Claude Code, then run /ruflo-mods in a session to see what the mod owns.');
      output.writeln(output.dim('Early access: Claude Code loads it only where function hooks are on. Run `ruflo mods doctor`.'));
    }
    const strict = ctx.flags.strict === true;
    return resolvable || !strict ? { success: true, data: { ...result, resolvable } } : { success: false, exitCode: 1, data: { ...result, resolvable } };
  },
};

/**
 * Settings alone are a request: Claude Code skips an enabled plugin missing
 * from a stale marketplace clone. Install it the way a person would, then
 * re-read Claude Code's own records; print the manual commands on any failure.
 */
async function makeResolvable(root: string, scope: Scope): Promise<boolean> {
  const configDir = claudeConfigDir(process.env, homedir());
  const known = marketplaceState(configDir).known;
  const manual = () => {
    output.writeln('Run these to make the plugin loadable:');
    for (const line of repairCommands(root, scope, known)) output.writeln(`  ${line}`);
  };
  const claude = findClaudeBinary(process.env, homedir());
  if (!claude) {
    output.printWarning('No runnable claude binary on PATH: the plugin is enabled in settings but not installed.');
    manual();
    return false;
  }
  const repair = await repairPluginInstall({ projectRoot: root, scope, marketplaceKnown: known, claude });
  for (const step of repair.steps) {
    const line = `claude ${step.argv.join(' ')}`;
    output.writeln(step.ok ? `${output.success('✓')} ${line}` : `${output.error('✗')} ${line}`);
    if (!step.ok && step.output) output.writeln(output.dim(`    ${step.output.split('\n').slice(-3).join('\n    ')}`));
  }
  const findings = resolveFindings(root, scope, configDir);
  const failed = findings.filter((f) => f.status === 'fail');
  if (repair.ok && failed.length === 0) return true;
  printFindings(failed);
  manual();
  return false;
}

const uninstallSub: Command = {
  name: 'uninstall',
  description: 'Remove what `ruflo mods install` added (classic hooks take every event back)',
  options: [rootOption, { name: 'dry-run', description: 'Show what would be removed', type: 'boolean', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dry = ctx.flags.dryRun === true || ctx.flags['dry-run'] === true;
    const manager = removeManager(projectRoot(ctx), dry);
    if (manager.removed) output.writeln(`${dry ? 'Would remove' : 'Removed'} ${MANAGER_PLUGIN_ID}'s record (and its key, where ruflo added it)`);
    const result = uninstallMod(projectRoot(ctx), dry);
    if (!result.removed) {
      output.printWarning('No install record (.claude-flow/mods/install.json): nothing ruflo added to remove.');
      return { success: true, data: result };
    }
    output.printSuccess(`${result.dryRun ? 'Would remove' : 'Removed'} ruflo-mods from ${result.settingsFile}`);
    return { success: true, data: result };
  },
};

function findingsCommand(name: 'status' | 'doctor', description: string): Command {
  return {
    name,
    description,
    options: [rootOption, { name: 'json', description: 'Output as JSON', type: 'boolean', default: false }],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      const findings = probeMods({ projectRoot: projectRoot(ctx) });
      if (ctx.flags.json) output.printJson(findings);
      else printFindings(findings);
      const failed = findings.some((f) => f.status === 'fail');
      // status reports (exit 0); doctor gates on a failure (warnings are expected while early access is off).
      return name === 'doctor' && failed ? { success: false, exitCode: 1, data: findings } : { success: true, data: findings };
    },
  };
}

async function syncPolicy(root: string, quiet: boolean): Promise<boolean> {
  try {
    const { loadPolicyState } = await import('../services/policy-runtime.js');
    const { syncPolicyProjection } = await import('../mods/policy-projection.js');
    const result = syncPolicyProjection(root, loadPolicyState(root));
    if (!quiet || result.action !== 'unchanged') output.writeln(`policy projection: ${result.action} (${result.path})`);
    return true;
  } catch (error) {
    output.printWarning(`policy projection not synced: ${(error as Error).message}`);
    return false;
  }
}

const syncPolicySub: Command = {
  name: 'sync-policy',
  description: 'Rewrite the Claude Code policy projection from .claude-flow/policy/state.json',
  options: [rootOption],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const ok = await syncPolicy(projectRoot(ctx), false);
    return { success: ok, exitCode: ok ? 0 : 1 };
  },
};

const statusSub = findingsCommand('status', 'Show whether the mod is enabled, can load, and what it owns');

export const modsCommand: Command = {
  name: 'mods',
  description: 'Run ruflo as a Claude Code mod (function hooks, early access, ADR-404)',
  subcommands: [
    installSub,
    uninstallSub,
    statusSub,
    findingsCommand('doctor', 'Check the mod path; exits 1 only on a failure'),
    syncPolicySub,
    modsListSub,
    modsEnableSub,
    modsDisableSub,
  ],
  examples: [
    { command: 'ruflo mods install', description: 'Enable for this project (settings.local.json) and install the plugin with claude' },
    { command: 'ruflo mods install --no-plugin-install', description: 'Only write settings; run no claude command' },
    { command: 'ruflo mods doctor', description: 'Function hooks on? Refused by policy? Handshake supported?' },
    { command: 'ruflo mods uninstall', description: 'Remove only what install added' },
  ],
  action: statusSub.action,
};

export default modsCommand;
