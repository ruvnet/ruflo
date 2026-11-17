/**
 * Turn the ruflo mods on (or off) for a project (ADR-404): merge the
 * settings, sync the policy projection, then make the plugins loadable with
 * `claude`. One path for `ruflo mods install`, `ruflo init` (and its wizard)
 * and `ruflo init upgrade --mods`; `removeMods` is `ruflo mods uninstall`.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { output } from '../output.js';
import {
  disableBlockedPlugins,
  installMod,
  MARKETPLACE_NAME,
  MARKETPLACE_SOURCE,
  MOD_PLUGIN_IDS,
  MOD_PLUGINS,
  readRecord,
  readSettingsFile,
  settingsFileFor,
  recordClaudeInstalled,
  scopeOfSettingsFile,
  uninstallMod,
  type Added,
  type InstallResult,
  type MarketplaceEntry,
  type ModPlugin,
  type Scope,
} from './install.js';
import { findClaudeBinary, installArgv, marketplaceArgv, repairPluginInstall, uninstallArgv, uninstallPlugins, type Exec, type RepairStep } from './plugin-repair.js';
import { claudeConfigDir, describeSource, installedState, marketplaceState, repairCommands, resolveFindings, sameSource } from './plugin-resolve.js';
import { scanBeforeInstall, verifyAndRecord } from './install-trust.js';

export interface ApplyOptions {
  scope: Scope;
  dryRun?: boolean;
  /** Run `claude plugin marketplace …` and `claude plugin install …` (default true). */
  pluginInstall?: boolean;
  /**
   * Skip the `claude` step under a test runner or CI (VITEST / CI set): an
   * init there must never clone from GitHub into whatever config dir is live.
   */
  skipInTestEnv?: boolean;
  /** The marketplace to declare when the settings have none (default github ruvnet/ruflo). */
  marketplace?: MarketplaceEntry;
  /** ADR-509 §2.2: plugins (name or id) to install past a high scan finding; each override is recorded. */
  acceptRisk?: readonly string[];
  /** Injectable for tests. */
  exec?: Exec;
}

export interface ApplyResult {
  install: InstallResult;
  /** Whether every required plugin was left loadable (true when the step was skipped by request). */
  resolvable: boolean;
  /** Why the `claude` step did not run, when it did not. */
  skipped?: string;
}

/** One line per thing a run added; empty on a re-run. */
export function describeAdded(added: Added): string[] {
  return [
    ...added.plugins.map((id) => `enabledPlugins["${id}"] = true`),
    ...(added.marketplace ? ['extraKnownMarketplaces.ruflo'] : []),
    ...(added.env ? ['env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1"'] : []),
  ];
}

/** What default-on means, said exactly (ADR-404 Amendment 1). */
export const LOAD_NOTE = [
  'ruflo-mods and ruflo-console run only where Claude Code function hooks are on: with them off, or the rollout switch off, they do nothing and the classic hooks keep every event.',
  "ruflo-swarm's commands, skills and agents load without function hooks; with them on, ruflo-swarm is also a mod that can run host commands (pane actions you start).",
  "Each teammate's first trusted interactive Claude Code start clones github.com/ruvnet/ruflo; a headless claude -p on a fresh config loads nothing.",
  'Optional hardening: pluginConfigs["ruflo-mods@ruflo"].options.modTrust = "refuse-risky" with modTrustAllow, in user or managed settings (project settings cannot set it).',
];

async function syncPolicyQuietly(root: string): Promise<void> {
  try {
    const { loadPolicyState } = await import('../services/policy-runtime.js');
    const { syncPolicyProjection } = await import('./policy-projection.js');
    const result = syncPolicyProjection(root, loadPolicyState(root));
    if (result.action !== 'unchanged') output.writeln(`policy projection: ${result.action} (${result.path})`);
  } catch (error) {
    output.printWarning(`policy projection not synced: ${(error as Error).message}`);
  }
}

function printSteps(steps: readonly RepairStep[]): void {
  for (const step of steps) {
    const mark = step.state === 'ok' ? output.success('✓') : step.state === 'pending' ? output.warning('…') : output.error('✗');
    output.writeln(`${mark} claude ${step.argv.join(' ')}${step.state === 'pending' ? ' (pending: not in the ruflo marketplace yet)' : ''}`);
    if (step.state === 'failed' && step.output) output.writeln(output.dim(`    ${step.output.split('\n').slice(-3).join('\n    ')}`));
  }
}

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Claude Code re-serializes settings it touches; say so, never fight it. */
function noteRewrite(file: string, before: string | undefined): void {
  const after = readText(file);
  if (before === undefined || after === undefined || before === after) return;
  try {
    output.writeln(output.dim(JSON.stringify(canon(JSON.parse(before))) === JSON.stringify(canon(JSON.parse(after)))
      ? `Claude Code reformatted ${file} (key order and layout only; content unchanged).`
      : `Claude Code also changed ${file}; review it before committing.`));
  } catch {
    // Not ours to judge further.
  }
}

/** The marketplace the settings file already declares, else the requested one. */
function declaredMarketplace(root: string, scope: Scope, requested: MarketplaceEntry): MarketplaceEntry {
  try {
    const markets = readSettingsFile(settingsFileFor(root, scope)).extraKnownMarketplaces as Record<string, MarketplaceEntry> | undefined;
    return markets?.[MARKETPLACE_NAME] ?? requested;
  } catch {
    return requested;
  }
}

export async function applyMods(root: string, opts: ApplyOptions): Promise<ApplyResult> {
  const configDir = claudeConfigDir(process.env, homedir());
  const acceptRisk = new Set(opts.acceptRisk ?? []);
  const seen = new Set<string>();
  const blocked = new Map<string, string>();
  const told = new Set<string>();
  // ADR-509 §2.2: Claude Code loads an enabled plugin straight from the
  // marketplace clone, install or not. So where a clone already exists, scan it
  // BEFORE enabling anything from it, and never enable what the scan blocks.
  const preClone = opts.dryRun ? null : marketplaceState(configDir).location;
  const scannable = declaredMarketplace(root, opts.scope, opts.marketplace ?? MARKETPLACE_SOURCE).source.source !== 'directory';
  if (preClone && scannable) {
    for (const [id, why] of scanBeforeInstall(root, preClone, MOD_PLUGINS, acceptRisk, undefined, seen).blocked) blocked.set(id, why);
  }
  const install = installMod(root, opts.scope, opts.dryRun === true, MOD_PLUGIN_IDS.filter((id) => !blocked.has(id)), opts.marketplace ?? MARKETPLACE_SOURCE);
  // A blocked plugin enabled by an earlier run (or by hand) is turned off too.
  turnOff(root, install, blocked, told);
  const lines = describeAdded(install.added);
  // Only what is enabled in the file: `claude plugin install` would flip a
  // plugin someone set to false back to true.
  const enabled = (install.next.enabledPlugins ?? {}) as Record<string, unknown>;
  const plugins: ModPlugin[] = MOD_PLUGINS.filter((p) => enabled[p.id] === true && !blocked.has(p.id));
  // The marketplace the file declares wins: a person's own declaration is kept and used.
  const declared = (install.next.extraKnownMarketplaces as Record<string, MarketplaceEntry> | undefined)?.[MARKETPLACE_NAME] ?? MARKETPLACE_SOURCE;
  const market = marketplaceState(configDir);
  const known = market.known && sameSource(market.source, declared.source);

  if (install.dryRun) {
    output.writeln(`Would write ${install.settingsFile}:`);
    output.printJson(install.next);
    if (opts.pluginInstall !== false) {
      output.writeln('Would run:');
      const installs = declared.source.source === 'directory' ? [] : plugins.map((p) => installArgv(p.id, opts.scope));
      for (const argv of [marketplaceArgv(opts.scope, known, declared), ...installs]) output.writeln(`  claude ${argv.join(' ')}`);
    }
    return { install, resolvable: true };
  }

  await syncPolicyQuietly(root);
  if (lines.length) {
    output.printSuccess(`ruflo mods enabled in ${install.settingsFile}${install.backup ? ` (backup: ${install.backup})` : ''}`);
    for (const line of lines) output.writeln(`  + ${line}`);
  } else {
    output.printSuccess(`ruflo mods already enabled in ${install.settingsFile} (nothing changed)`);
  }
  output.writeln(`  marketplace: ${describeSource(declared.source)}`);
  if (opts.marketplace && !sameSource(opts.marketplace.source, declared.source)) {
    output.printWarning(`extraKnownMarketplaces.ruflo was already set (${describeSource(declared.source)}); left as it is.`);
  }
  for (const line of LOAD_NOTE) output.writeln(output.dim(line));

  const manual = (k = known) => {
    output.writeln('Run these to make the plugins loadable:');
    for (const line of repairCommands(root, opts.scope, k, plugins, declared)) output.writeln(`  ${line}`);
  };
  // The `claude` step may not run below: say what is enabled without a scan.
  const unscanned = () => {
    if (!preClone && scannable && plugins.length) output.printWarning(`No ruflo marketplace clone yet, so nothing was scanned (ADR-509): ${plugins.map((p) => p.id).join(', ')} enabled unscanned; Claude Code clones it on the first trusted start. Run ruflo mods install again after that to scan it.`);
  };
  if (opts.pluginInstall === false) {
    unscanned();
    return { install, resolvable: blocked.size === 0, skipped: '--no-plugin-install' };
  }
  if (opts.skipInTestEnv && (process.env.VITEST || process.env.CI)) {
    output.writeln(output.dim(`claude plugin step skipped (${process.env.VITEST ? 'VITEST' : 'CI'} set).`));
    unscanned();
    manual();
    return { install, resolvable: false, skipped: 'test or CI environment' };
  }
  const claude = findClaudeBinary(process.env, homedir());
  if (!claude) {
    output.printWarning('No runnable claude binary on PATH: the plugins are enabled in settings, not installed.');
    unscanned();
    manual();
    return { install, resolvable: false, skipped: 'no claude on PATH' };
  }

  if (declared.source.source === 'directory' && market.known && !sameSource(market.source, declared.source)) {
    output.printWarning(`Claude Code keeps one ruflo marketplace per config dir: it now switches from ${describeSource(market.source)} to ${describeSource(declared.source)} for every project on this machine. Switch back with: claude plugin marketplace add ruvnet/ruflo`);
  }
  // Never claim (and so never uninstall) a plugin that was installed before, or one ruflo did not enable.
  const before = new Set(plugins.filter((p) => installedState(root, configDir, p.id).installed).map((p) => p.id));
  const textBefore = readText(install.settingsFile);
  const repair = await repairPluginInstall({
    projectRoot: root, scope: opts.scope, configDir, claude, plugins, marketplace: declared, exec: opts.exec,
    // ADR-509 §2.2: scan the refreshed clone before any install (a directory marketplace has no install step to gate).
    beforeInstall: (clone) => {
      const gate = scanBeforeInstall(root, clone, plugins, acceptRisk, undefined, seen);
      for (const [id, why] of gate.blocked) blocked.set(id, why);
      return gate;
    },
  });
  printSteps(repair.steps);
  // The refresh may have brought a finding the first scan did not see: that plugin is turned off as well.
  turnOff(root, install, blocked, told);
  // ADR-509 §2.1: verify what Claude Code will load and leave the result for the mod's trust gate.
  verifyAndRecord(configDir, marketplaceState(configDir).location, plugins.map((p) => p.id.split('@')[0]!));
  if (declared.source.source === 'directory' && repair.ok) output.writeln(output.dim(`Directory marketplace: plugins load live from ${declared.source.path} (no clone, no install).`));
  const enabledByRuflo = new Set(readRecord(root)?.files[install.settingsFile]?.plugins ?? []);
  const ours = repair.steps
    .filter((st) => st.state === 'ok' && st.argv[1] === 'install')
    .map((st) => st.argv[2]!)
    .filter((id) => !before.has(id) && enabledByRuflo.has(id));
  recordClaudeInstalled(root, install.settingsFile, ours);
  noteRewrite(install.settingsFile, textBefore);

  const failed = resolveFindings(root, opts.scope, configDir, undefined, plugins.filter((p) => !blocked.has(p.id)).map((p) => p.id), declared).filter((f) => f.status === 'fail');
  if (repair.ok && failed.length === 0 && blocked.size === 0) return { install, resolvable: true };
  for (const f of failed) output.writeln(`${output.error('✗')} ${f.name}: ${f.message}`);
  const now = marketplaceState(configDir);
  manual(now.known && sameSource(now.source, declared.source));
  return { install, resolvable: false };
}

/** ADR-509 §2.2: turn off (enabledPlugins + install record) each blocked plugin, and say so. */
function turnOff(root: string, install: InstallResult, blocked: ReadonlyMap<string, string>, told: Set<string>): void {
  if (install.dryRun || blocked.size === 0) return;
  const off = disableBlockedPlugins(root, install.settingsFile, [...blocked.keys()]);
  for (const [id, why] of blocked) {
    if (told.has(id) && !off.includes(id)) continue; // already said, and nothing changed since
    told.add(id);
    output.writeln(`${output.error('✗')} ${id}: ${off.includes(id) ? `enabledPlugins["${id}"] removed from ${install.settingsFile}` : 'not enabled'}; ${why}`);
  }
}

/**
 * `ruflo mods uninstall`: `claude plugin uninstall` exactly the plugins ruflo
 * installed, then remove exactly the settings keys it added.
 */
export async function removeMods(root: string, opts: { dryRun?: boolean; exec?: Exec } = {}): Promise<{ settingsFiles: string[]; removed: boolean; dryRun: boolean; uninstalled: string[]; failed: string[] }> {
  const record = readRecord(root);
  const plan = Object.entries(record?.files ?? {}).map(([file, added]) => ({ file, scope: scopeOfSettingsFile(file), ids: added.claudeInstalled ?? [] }));
  const uninstalled: string[] = [];
  const failed: string[] = [];
  if (opts.dryRun) {
    for (const p of plan) for (const id of p.ids) output.writeln(`Would run: claude ${uninstallArgv(id, p.scope).join(' ')}`);
  } else if (plan.some((p) => p.ids.length)) {
    const claude = findClaudeBinary(process.env, homedir());
    for (const p of plan.filter((x) => x.ids.length)) {
      if (!claude) {
        output.printWarning('No runnable claude binary on PATH; run these to remove what ruflo installed:');
        for (const id of p.ids) output.writeln(`  cd ${JSON.stringify(root)} && claude ${uninstallArgv(id, p.scope).join(' ')}`);
        failed.push(...p.ids);
        continue;
      }
      const result = await uninstallPlugins({ projectRoot: root, scope: p.scope, ids: p.ids, claude, exec: opts.exec });
      printSteps(result.steps);
      for (const st of result.steps) (st.state === 'ok' ? uninstalled : failed).push(st.argv[2]!);
    }
  }
  const result = uninstallMod(root, opts.dryRun === true);
  return { ...result, uninstalled, failed };
}
