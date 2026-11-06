/**
 * Doctor checks for project configuration, settings, helpers and the daemon.
 * Split out of commands/doctor.ts (#4773).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'node:os';
import type { HealthCheck } from './shared.js';

// Check config file
export async function checkConfigFile(): Promise<HealthCheck> {
  // JSON configs (parse-validated). The first three are LEGACY shapes from
  // pre-v3 init flows; v3 init writes only `.claude-flow/config.yaml`.
  const jsonPaths = [
    '.claude-flow/config.json',
    'claude-flow.config.json',
    '.claude-flow.json'
  ];
  // YAML configs (existence-checked only — no heavy yaml parser dependency).
  const yamlPaths = [
    '.claude-flow/config.yaml',
    '.claude-flow/config.yml',
    'claude-flow.config.yaml'
  ];

  // #1798 — collect ALL configs that exist instead of returning at the first
  // hit. The previous early-return masked silent collisions: if both a v2
  // JSON and a v3 YAML existed, doctor reported only the JSON while the
  // daemon was actually reading from the YAML. Surfacing both lets the user
  // see and resolve the disagreement.
  const foundJson: string[] = [];
  const invalidJson: string[] = [];
  for (const configPath of jsonPaths) {
    if (!existsSync(configPath)) continue;
    try {
      JSON.parse(readFileSync(configPath, 'utf8'));
      foundJson.push(configPath);
    } catch {
      invalidJson.push(configPath);
    }
  }
  const foundYaml = yamlPaths.filter(p => existsSync(p));

  // Hard failures first: malformed JSON wins.
  if (invalidJson.length > 0) {
    return { name: 'Config File', status: 'fail', message: `Invalid JSON: ${invalidJson.join(', ')}`, fix: 'Fix JSON syntax in config file' };
  }

  // #1798 — collision: legacy JSON + new YAML both present. Subsystems can
  // disagree on which to read; surface this as a warn with the recommended
  // resolution (keep the YAML, archive the JSON).
  if (foundJson.length > 0 && foundYaml.length > 0) {
    return {
      name: 'Config File',
      status: 'warn',
      message: `Config collision: legacy ${foundJson.join(', ')} + ${foundYaml.join(', ')} — subsystems may disagree silently`,
      fix: `Archive the legacy JSON (mv ${foundJson[0]} ${foundJson[0]}.bak) and keep ${foundYaml[0]} as the canonical config`,
    };
  }

  if (foundYaml.length > 0) {
    return { name: 'Config File', status: 'pass', message: `Found: ${foundYaml[0]}` };
  }
  if (foundJson.length > 0) {
    return { name: 'Config File', status: 'pass', message: `Found: ${foundJson[0]}` };
  }

  return { name: 'Config File', status: 'warn', message: 'No config file (using defaults)', fix: 'claude-flow config init' };
}

// Check daemon status
/**
 * #2448 / #2677 — Detect runaway `npx @claude-flow/cli@latest` commands
 * left over in `.claude/settings.json` from pre-#2337 installs.
 *
 * These fire on every Claude Code event (statusLine refires every few hundred
 * ms, hooks fire per tool-use), each spawning a cold Node process + npm
 * registry round-trip. On the reporter's 48 GB macOS box this produced
 * load average 49, jetsam, and a kernel watchdog panic two minutes after
 * boot. Severity is CRITICAL when present; users who installed before #2337
 * and never re-ran `ruflo init` still have it.
 *
 * Detection only — does not modify settings. Fix path is `ruflo init` (the
 * executor's migration logic, also patched in #2448, will now regenerate
 * the broken commands).
 */
export async function checkStaleSettingsNpx(): Promise<HealthCheck> {
  // Same regex pattern the executor migration uses — kept in sync. Flag-list
  // repetition bounded at 10 (CodeQL js/redos — unbounded `*` here is
  // exponential-backtracking-prone on a crafted settings.json).
  // Every subcommand incurs the same cold npm process/registry cost. The
  // previous `hooks` literal missed `memory`, `daemon`, `swarm`, etc.
  const BROKEN_RE = /npx\s+(?:--?\S+\s+){0,10}@?claude-flow\/cli@latest\s+\S+/;

  // Look in both project-local and home-dir settings.
  const candidates = [
    join(process.cwd(), '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
  ].filter((p, i, a) => p && a.indexOf(p) === i);

  const offenders: Array<{ path: string; where: string }> = [];
  for (const settingsPath of candidates) {
    if (!existsSync(settingsPath)) continue;
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      continue; // checkConfigFile reports JSON errors separately
    }

    // statusLine.command
    const sl = settings.statusLine as { command?: string } | undefined;
    if (sl?.command && BROKEN_RE.test(sl.command)) {
      offenders.push({ path: settingsPath, where: 'statusLine' });
    }

    // hooks.<event>[].hooks[].command
    const hooks = settings.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>> | undefined;
    if (hooks) {
      for (const [eventName, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          if (!Array.isArray(group.hooks)) continue;
          for (const h of group.hooks) {
            if (typeof h?.command === 'string' && BROKEN_RE.test(h.command)) {
              offenders.push({ path: settingsPath, where: `hooks.${eventName}` });
            }
          }
        }
      }
    }
  }

  if (offenders.length === 0) {
    return { name: 'Stale npx@latest in settings (#2448)', status: 'pass', message: 'no runaway commands detected' };
  }

  // Group by file for readable output
  const byFile = offenders.reduce((acc, o) => {
    (acc[o.path] ??= []).push(o.where);
    return acc;
  }, {} as Record<string, string[]>);
  const summary = Object.entries(byFile)
    .map(([p, wheres]) => `${p} [${[...new Set(wheres)].join(', ')}]`)
    .join('; ');

  return {
    name: 'Stale npx@latest in settings (#2448)',
    status: 'fail',
    message: `CRITICAL — runaway \`npx @claude-flow/cli@latest\` commands detected: ${summary}`,
    fix: 'Re-run `npx ruflo init` to migrate (the v3.13.3+ init migrator regenerates these to local-helper form). On macOS this prevents the process-storm / kernel-panic class reported in #2448.',
  };
}

/**
 * #3565: report signed critical helpers whose on-disk content no longer
 * matches the signed manifest. CLI startup heals such files, so this matters
 * for the paths startup does not heal: `.LOCKED` or `RUFLO_HELPERS_LOCKED`
 * (auto-restore skipped by design), an unverifiable package manifest, and an
 * unresolvable package source.
 */
export async function checkHelperIntegrity(opts: {
  cwd?: string;
  homeDir?: string;
  sourceDirOverride?: string | null;
  pubkeyPemOverride?: string;
} = {}): Promise<HealthCheck> {
  const name = 'Helper Integrity (#3565)';
  const { verifyInstalledCriticalHelpers } = await import('../../init/helper-integrity.js');
  const { CRITICAL_HELPERS, findPackageHelpersDir } = await import('../../init/helper-refresh.js');
  const envLocked = /^(1|true|on|yes)$/i.test(String(process.env.RUFLO_HELPERS_LOCKED || ''));
  const home = opts.homeDir ?? homedir();
  const dirs = [
    join(opts.cwd ?? process.cwd(), '.claude', 'helpers'),
    ...(home ? [join(home, '.claude', 'helpers')] : []),
  ].filter((d, i, a) => a.indexOf(d) === i && existsSync(join(d, 'hook-handler.cjs')));
  if (dirs.length === 0) {
    return { name, status: 'pass', message: 'no installed ruflo helpers to verify' };
  }

  const source = opts.sourceDirOverride === undefined ? findPackageHelpersDir() : opts.sourceDirOverride;
  if (!source) {
    return {
      name, status: 'warn',
      message: 'cannot verify installed helpers: the package helper source was not found',
      fix: 'Reinstall @claude-flow/cli',
    };
  }

  const tamperedLines: string[] = [];
  const lockedLines: string[] = [];
  for (const dir of dirs) {
    const r = verifyInstalledCriticalHelpers(dir, source, CRITICAL_HELPERS, opts.pubkeyPemOverride);
    if (r.blocked) {
      return {
        name, status: 'fail',
        message: `cannot verify installed helpers: ${r.blocked}`,
        fix: 'Reinstall @claude-flow/cli from a trusted source',
      };
    }
    if (r.tampered.length === 0) continue;
    const line = `${dir}: ${r.tampered.join(', ')}`;
    if (envLocked || existsSync(join(dir, '.LOCKED'))) lockedLines.push(line);
    else tamperedLines.push(line);
  }

  if (tamperedLines.length > 0) {
    return {
      name, status: 'fail',
      message: `critical helpers do not match the signed manifest — ${tamperedLines.join('; ')}`,
      fix: 'Run any ruflo command to restore verified copies (startup heals them), or `npx ruflo init --force`; then find out what modified them',
    };
  }
  if (lockedLines.length > 0) {
    return {
      name, status: 'warn',
      message: `locally modified helpers (auto-restore disabled by .LOCKED / RUFLO_HELPERS_LOCKED) — ${lockedLines.join('; ')}`,
      fix: 'Expected if you edit helpers deliberately; otherwise remove .LOCKED and run any ruflo command to restore them',
    };
  }
  return { name, status: 'pass', message: `${dirs.length} helper dir(s) match the signed manifest` };
}

export async function checkDaemonStatus(): Promise<HealthCheck> {
  try {
    const pidFile = '.claude-flow/daemon.pid';
    if (existsSync(pidFile)) {
      const pid = readFileSync(pidFile, 'utf8').trim();
      try {
        process.kill(parseInt(pid, 10), 0); // Check if process exists
        return { name: 'Daemon Status', status: 'pass', message: `Running (PID: ${pid})` };
      } catch {
        return { name: 'Daemon Status', status: 'warn', message: 'Stale PID file', fix: 'rm .claude-flow/daemon.pid && claude-flow daemon start' };
      }
    }
    return { name: 'Daemon Status', status: 'warn', message: 'Not running', fix: 'claude-flow daemon start' };
  } catch {
    return { name: 'Daemon Status', status: 'warn', message: 'Unable to check', fix: 'claude-flow daemon status' };
  }
}
