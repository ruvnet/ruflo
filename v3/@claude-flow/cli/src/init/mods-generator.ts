/**
 * The `--mods` step of `ruflo init` (ADR-407): enable ruflo-mods and the mod
 * manager (ADR-406) in `.claude/settings.local.json`, then make both
 * resolvable the way a person would, through #3612's install and repair
 * functions. `ruflo mods install|uninstall` share it.
 *
 * Opt-in, idempotent, and it never writes under `.claude/helpers/`, so the
 * signed helpers manifest is untouched. The manager's settings key is
 * recorded in its own file, `.claude-flow/mods/manager.json`, beside
 * install.ts's record, which is left exactly as installMod writes it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

import { installMod, readSettingsFile, settingsFileFor, MOD_PLUGIN_ID, type InstallResult } from '../mods/install.js';
import { claudeConfigDir, marketplaceState, repairCommands, resolveFindings } from '../mods/plugin-resolve.js';
import { findClaudeBinary, INSTALL_TIMEOUT_MS, nodeExec, repairArgv, repairPluginInstall, type Exec, type RepairStep } from '../mods/plugin-repair.js';
import { defaultVersionOf, MODS_DEFAULT_ON, versionLess } from '../mods/claude-installs.js';
import type { Finding } from '../mods/probe.js';

export const MANAGER_PLUGIN_ID = 'ruflo-mods-manager@ruflo';
export const MANAGER_RECORD = join('.claude-flow', 'mods', 'manager.json');

export interface ManagerRecord {
  version: 1;
  settingsFile: string;
  installedAt: string;
  added: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** The settings with the manager enabled, and whether that added the key (pure). */
export function withManagerEnabled(settings: Record<string, unknown>): { next: Record<string, unknown>; added: boolean } {
  const plugins = isRecord(settings.enabledPlugins) ? { ...settings.enabledPlugins } : {};
  const added = plugins[MANAGER_PLUGIN_ID] !== true;
  plugins[MANAGER_PLUGIN_ID] = true;
  return { next: { ...settings, enabledPlugins: plugins }, added };
}

export function readManagerRecord(projectRoot: string): ManagerRecord | null {
  const path = join(resolve(projectRoot), MANAGER_RECORD);
  if (!existsSync(path)) return null;
  try {
    const r = JSON.parse(readFileSync(path, 'utf8')) as ManagerRecord;
    return r && r.version === 1 && typeof r.settingsFile === 'string' && typeof r.added === 'boolean' ? r : null;
  } catch {
    return null;
  }
}

/** Sets the manager's key in the local settings and records whether ruflo added it (OR-ed with an earlier record). */
export function enableManager(projectRoot: string): { settingsFile: string; added: boolean } {
  const settingsFile = settingsFileFor(projectRoot, 'local');
  const { next, added } = withManagerEnabled(readSettingsFile(settingsFile));
  writeJson(settingsFile, next);
  const previous = readManagerRecord(projectRoot);
  const merged = added || (previous !== null && previous.settingsFile === settingsFile && previous.added);
  writeJson(join(resolve(projectRoot), MANAGER_RECORD), { version: 1, settingsFile, installedAt: new Date().toISOString(), added: merged } satisfies ManagerRecord);
  return { settingsFile, added: merged };
}

/** Removes the manager's key only when its record says ruflo added it, then the record. */
export function removeManager(projectRoot: string, dryRun = false): { removed: boolean; settingsFile?: string } {
  const record = readManagerRecord(projectRoot);
  if (!record) return { removed: false };
  const root = resolve(projectRoot);
  if (!resolve(record.settingsFile).startsWith(join(root, '.claude') + sep)) {
    throw new Error(`manager record names a settings file outside ${root}/.claude: ${record.settingsFile}`);
  }
  if (dryRun) return { removed: true, settingsFile: record.settingsFile };
  if (record.added && existsSync(record.settingsFile)) {
    const settings = readSettingsFile(record.settingsFile);
    if (isRecord(settings.enabledPlugins)) {
      const plugins = { ...settings.enabledPlugins };
      delete plugins[MANAGER_PLUGIN_ID];
      if (Object.keys(plugins).length === 0) delete settings.enabledPlugins;
      else settings.enabledPlugins = plugins;
      writeJson(record.settingsFile, settings);
    }
  }
  unlinkSync(join(root, MANAGER_RECORD));
  return { removed: true, settingsFile: record.settingsFile };
}

/** Installed for this project (user scope anywhere, local/project here), its folder present. */
export function managerInstalled(projectRoot: string, configDir: string): boolean {
  try {
    const record = JSON.parse(readFileSync(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')) as unknown;
    const entries = isRecord(record) && isRecord(record.plugins) && Array.isArray(record.plugins[MANAGER_PLUGIN_ID]) ? (record.plugins[MANAGER_PLUGIN_ID] as unknown[]) : [];
    return entries.some((e) => isRecord(e) && typeof e.installPath === 'string' && existsSync(e.installPath)
      && (e.scope === 'user' || (typeof e.projectPath === 'string' && resolve(e.projectPath) === resolve(projectRoot))));
  } catch {
    return false;
  }
}

export const managerInstallArgv = (): string[] => ['plugin', 'install', MANAGER_PLUGIN_ID, '--scope', 'local'];

export interface ModsStepOptions {
  projectRoot: string;
  dryRun?: boolean;
  /** Also install the manager (default true; `--no-mods-manager`). */
  manager?: boolean;
  /** Run `claude plugin …` at all (default true; `--no-plugin-install`). */
  pluginInstall?: boolean;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** The claude to run; discovered when undefined, none when null. */
  claude?: string | null;
  claudeVersion?: string | null;
}

export interface ModsPlan {
  settingsFile: string;
  settings: Record<string, unknown>;
  manager: boolean;
  claude: { path: string; version: string | null } | null;
  /** Why the plugins are not installed by claude: null when they will be. */
  skip: string | null;
  /** Why the manager's install is skipped while ruflo-mods' runs. */
  managerSkip: string | null;
  argv: string[][];
  manual: string[];
}

function resolveClaude(opts: ModsStepOptions): { path: string; version: string | null } | null {
  const env = opts.env ?? process.env;
  const path = opts.claude === undefined ? findClaudeBinary(env, opts.home ?? homedir()) : opts.claude;
  if (!path) return null;
  return { path, version: opts.claudeVersion !== undefined ? opts.claudeVersion : defaultVersionOf(path) };
}

/** What the step would write and run (pure apart from reads). */
export function planModsStep(opts: ModsStepOptions): ModsPlan {
  const root = resolve(opts.projectRoot);
  const manager = opts.manager !== false;
  const env = opts.env ?? process.env;
  const configDir = claudeConfigDir(env, opts.home ?? homedir());
  const known = marketplaceState(configDir).known;
  const enabled = installMod(root, 'local', true);
  const settings = manager ? withManagerEnabled(enabled.next).next : enabled.next;
  const claude = resolveClaude(opts);
  const skip = opts.pluginInstall === false ? 'plugin install not requested (--no-plugin-install)' : claude ? null : 'no runnable claude on PATH';
  const managerSkip = !manager ? null
    : !claude ? null
      : claude.version === null ? `claude version unknown (${claude.path}); the manager needs >= ${MODS_DEFAULT_ON}`
        : versionLess(claude.version, MODS_DEFAULT_ON) ? `claude ${claude.version} is older than ${MODS_DEFAULT_ON}, which the manager's pane needs` : null;
  const argv = skip ? [] : [...repairArgv('local', known), ...(manager && !managerSkip ? [managerInstallArgv()] : [])];
  const manual = [...repairCommands(root, 'local', known), ...(manager ? [`claude ${managerInstallArgv().join(' ')}`] : [])];
  return { settingsFile: enabled.settingsFile, settings, manager, claude, skip, managerSkip, argv, manual };
}

export interface ModsReport {
  plan: ModsPlan;
  dryRun: boolean;
  install?: InstallResult;
  managerAdded?: boolean;
  steps: RepairStep[];
  findings: Finding[];
  managerInstalled: boolean | null;
  resolvable: boolean;
}

/** Runs the step (ADR-407 steps 1 to 5). Never throws for a claude failure: the report says what happened. */
export async function runModsStep(opts: ModsStepOptions): Promise<ModsReport> {
  const plan = planModsStep(opts);
  if (opts.dryRun) return { plan, dryRun: true, steps: [], findings: [], managerInstalled: null, resolvable: false };
  const root = resolve(opts.projectRoot);
  const env = opts.env ?? process.env;
  const configDir = claudeConfigDir(env, opts.home ?? homedir());

  const install = installMod(root, 'local');
  const managerAdded = plan.manager ? enableManager(root).added : undefined;
  const steps: RepairStep[] = [];
  let findings: Finding[] = [];
  let mgr: boolean | null = null;
  if (!plan.skip && plan.claude) {
    const exec = opts.exec ?? nodeExec;
    const repair = await repairPluginInstall({ projectRoot: root, scope: 'local', marketplaceKnown: marketplaceState(configDir).known, claude: plan.claude.path, exec, env });
    steps.push(...repair.steps);
    if (repair.ok && plan.manager && !plan.managerSkip) {
      const argv = managerInstallArgv();
      let r: { code: number; stdout: string; stderr: string };
      try {
        r = await exec(plan.claude.path, argv, { cwd: root, timeout: INSTALL_TIMEOUT_MS, env });
      } catch (error) {
        r = { code: 1, stdout: '', stderr: (error as Error).message };
      }
      steps.push({ argv, ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() });
    }
    findings = resolveFindings(root, 'local', configDir);
    if (plan.manager) mgr = managerInstalled(root, configDir);
  }
  const modsOk = findings.length > 0 && findings.every((f) => f.status !== 'fail');
  const resolvable = modsOk && (!plan.manager || plan.managerSkip !== null || mgr === true);
  return { plan, dryRun: false, install, managerAdded, steps, findings, managerInstalled: mgr, resolvable };
}

/**
 * The manager's half alone (ADR-407 steps 2, 4 and 5), for `ruflo mods install`
 * after its own ruflo-mods install and repair have run.
 */
export async function installManager(opts: ModsStepOptions): Promise<{ added: boolean; step: RepairStep | null; skip: string | null; installed: boolean | null }> {
  const root = resolve(opts.projectRoot);
  const env = opts.env ?? process.env;
  const { added } = enableManager(root);
  const plan = planModsStep({ ...opts, manager: true });
  const skip = plan.skip ?? plan.managerSkip;
  if (skip || !plan.claude) return { added, step: null, skip, installed: null };
  const argv = managerInstallArgv();
  let r: { code: number; stdout: string; stderr: string };
  try {
    r = await (opts.exec ?? nodeExec)(plan.claude.path, argv, { cwd: root, timeout: INSTALL_TIMEOUT_MS, env });
  } catch (error) {
    r = { code: 1, stdout: '', stderr: (error as Error).message };
  }
  return { added, step: { argv, ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() }, skip: null, installed: managerInstalled(root, claudeConfigDir(env, opts.home ?? homedir())) };
}

/** Prints a report for init and `mods install` alike. */
export function printModsReport(report: ModsReport, out: { writeln: (s?: string) => void; success: (s: string) => string; error: (s: string) => string; warning: (s: string) => string; dim: (s: string) => string }): void {
  const { plan } = report;
  if (report.dryRun) {
    out.writeln(`Would write ${plan.settingsFile}:`);
    out.writeln(JSON.stringify(plan.settings, null, 2));
    if (plan.skip) out.writeln(out.warning(`Would not run claude: ${plan.skip}`));
    for (const argv of plan.argv) out.writeln(`Would run: claude ${argv.join(' ')}`);
    if (plan.managerSkip) out.writeln(out.warning(`Would skip the manager's install: ${plan.managerSkip}`));
    return;
  }
  out.writeln(out.success(`  ✓ ${MOD_PLUGIN_ID}${plan.manager ? ` and ${MANAGER_PLUGIN_ID}` : ''} enabled in ${plan.settingsFile}`));
  for (const step of report.steps) out.writeln(`  ${step.ok ? out.success('✓') : out.error('✗')} claude ${step.argv.join(' ')}${step.ok || !step.output ? '' : `\n    ${out.dim(step.output.split('\n').slice(-3).join('\n    '))}`}`);
  for (const f of report.findings.filter((x) => x.status === 'fail')) out.writeln(`  ${out.error('✗')} ${f.name}: ${f.message}`);
  if (plan.managerSkip) out.writeln(out.warning(`  manager not installed: ${plan.managerSkip}`));
  if (report.managerInstalled === false) out.writeln(`  ${out.error('✗')} ${MANAGER_PLUGIN_ID} not installed for this project`);
  if (plan.skip || !report.resolvable) {
    if (plan.skip) out.writeln(out.warning(`  plugins not installed: ${plan.skip}`));
    out.writeln('  Run these to make the plugins loadable:');
    for (const line of plan.manual) out.writeln(`    ${line}`);
  } else {
    out.writeln(out.dim('  Restart Claude Code, then /mods opens the manager (early access; "ruflo mods doctor" checks the path).'));
  }
}
