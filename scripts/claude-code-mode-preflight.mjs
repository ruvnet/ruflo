#!/usr/bin/env node
/**
 * ADR-531: non-mutating compatibility preflight for Claude Code Code Mode.
 * Does not enable Code Mode, check account/model/native-build eligibility,
 * or replace the host's permission checks.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const NAME = 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE';
const TEAM = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
const truthy = value => value === true || value === 1 || value === '1' || value === 'true';
const envOf = settings => settings && typeof settings.env === 'object' && settings.env !== null ? settings.env : {};

export function assessCodeMode({ version = '', userSettings = {}, projectSettings = {}, env = {}, configErrors = [] } = {}) {
  const checks = [];
  const add = (id, severity, detail) => checks.push({ id, severity, detail });
  const match = String(version).match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) add('version', 'block', 'Claude Code version could not be verified. Requires v2.1.323 or newer.');
  else {
    const [major, minor, patch] = match.slice(1).map(Number);
    if (major < 2 || (major === 2 && (minor < 1 || (minor === 1 && patch < 323))))
      add('version', 'block', 'Installed Claude Code version is too old for Code Mode.');
    else add('version', 'pass', 'Version meets minimum v2.1.323; native build is not verified.');
  }
  for (const error of configErrors) add('settings-parse', 'block', `Cannot safely interpret ${error} settings.`);

  const userEnv = envOf(userSettings);
  const projectEnv = envOf(projectSettings);
  const sources = [env[NAME], userEnv[NAME]].map(v => v == null ? '' : String(v));
  const optedOut = sources.includes('0');
  const optedIn = sources.includes('1') && !optedOut;
  if (optedOut) add('opt-in', 'off', 'Shell or user settings explicitly turns Code Mode off.');
  else if (optedIn) add('opt-in', 'pass', 'User-controlled opt-in detected; Claude still requires an interactive confirmation.');
  else add('opt-in', 'off', 'No shell/user opt-in. Code Mode remains off by default.');
  if (projectEnv[NAME] !== undefined)
    add('project-opt-in', 'warn', 'Project-level Code Mode flag is ignored by Claude Code and cannot enable it.');

  if ([env[TEAM], userEnv[TEAM], projectEnv[TEAM]].some(truthy))
    add('agent-teams', 'block', 'Agent teams are enabled; Code Mode and agent teams cannot run together. Do not change the shared project default.');
  else add('agent-teams', 'pass', 'No agent-team opt-in detected in inspected settings.');

  const mods = [userSettings, projectSettings].some(settings =>
    Object.entries(settings?.enabledPlugins ?? {}).some(([name, enabled]) =>
      enabled === true && (/mods/i.test(name) || /protector/i.test(name))));
  if (mods) add('mods', 'warn', 'An enabled tool-checking mod may block Code Mode. Test separately; do not disable safety mods automatically.');

  if (truthy(env.CLAUDE_CODE_ENABLE_TELEMETRY) || truthy(env.ENABLE_BETA_TRACING_DETAILED) ||
      truthy(userEnv.CLAUDE_CODE_ENABLE_TELEMETRY) || truthy(userEnv.ENABLE_BETA_TRACING_DETAILED))
    add('otel', 'block', 'OpenTelemetry export may prevent Code Mode startup. Preserve production observability.');
  if (truthy(env.DISABLE_TELEMETRY) || truthy(userEnv.DISABLE_TELEMETRY))
    add('feature-flags', 'block', 'Disabled feature-flag fetching is incompatible with Code Mode.');
  if (userSettings?.apiKeyHelper || projectSettings?.apiKeyHelper || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_CUSTOM_HEADERS)
    add('credential-helper', 'block', 'An API key helper or custom authorization headers may prevent Code Mode startup.');
  if (env.ANTHROPIC_BASE_URL || userEnv.ANTHROPIC_BASE_URL || projectEnv.ANTHROPIC_BASE_URL)
    add('gateway', 'block', 'Custom Anthropic API gateway is not supported by Code Mode.');

  add('host-limits', 'warn', 'Manual native terminal only; -p, SDK, agent teams, IDE, cloud and gateways are unsupported.');
  add('unverified', 'warn', 'Account, supported model, native installation, managed policy, consent, hooks and per-call permissions require live verification.');
  const blocked = checks.some(c => c.severity === 'block');
  const status = blocked ? 'blocked' : optedIn ? 'manual-trial-only' : 'not-enabled';
  return { status, claudeVersion: match?.[0] ?? null, checks,
    recommendation: 'Keep existing Ruflo agent-team path as default. Use a separately authorized interactive terminal lab for Code Mode.' };
}

function argumentValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`${flag} requires a value`);
  return argv[i + 1];
}

function readOptional(path, name, errors) {
  if (!existsSync(path)) return {};
  try {
    const result = JSON.parse(readFileSync(path, 'utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('expected object');
    return result;
  } catch { errors.push(name); return {}; }
}

export function runCli(argv = process.argv.slice(2), env = process.env) {
  const configErrors = [];
  const userPath = argumentValue(argv, '--user-settings') ?? join(homedir(), '.claude', 'settings.json');
  const projectPath = argumentValue(argv, '--project-settings') ?? resolve(process.cwd(), '.claude', 'settings.json');
  const userSettings = readOptional(userPath, 'user', configErrors);
  const projectSettings = readOptional(projectPath, 'project', configErrors);
  const versionOverride = argumentValue(argv, '--claude-version');
  const bin = versionOverride ? null : spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5000, shell: false });
  const version = versionOverride ?? (bin?.status === 0 ? bin.stdout : '');
  const report = assessCodeMode({ version, userSettings, projectSettings, env, configErrors });
  if (versionOverride) report.checks.push({ id: 'override', severity: 'warn', detail: 'Version supplied by caller, not verified from installed Claude binary.' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === 'blocked' ? 2 : report.status === 'not-enabled' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = runCli(); }
  catch (error) { process.stderr.write(`Code Mode preflight: ${error.message}\n`); process.exitCode = 2; }
}
