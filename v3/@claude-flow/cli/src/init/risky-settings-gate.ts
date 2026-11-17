/**
 * ADR-509 §2.3: the stop `ruflo init` / `ruflo init upgrade --settings` makes
 * before carrying a project settings file's auto-approve keys forward.
 *
 * The check runs BEFORE anything is written, so a stop leaves the project as
 * it was. `keep` proceeds (the keys are still reported); `drop` proceeds and
 * the merged file is written without them.
 */
import * as fs from 'fs';
import * as path from 'path';

import { isRufloHelperCommand } from './helper-commands.js';
import { CRITICAL_HELPERS } from './helper-refresh.js';
import { HELPERS_MANIFEST_FILE, sha256Hex, verifyHelpersManifest } from './helper-signing.js';
import {
  dropAutoApproveKeys,
  formatRiskFindingsAsWarnings,
  scanProjectAutoApproveKeys,
  type AutoApproveFinding,
  type RiskySettingsMode,
} from './settings-risk-scanner.js';

export interface RiskySettingsGate {
  mode: RiskySettingsMode;
  findings: AutoApproveFinding[];
  /** Display lines: location, reason, sanitized snippet. */
  lines: string[];
  /** True when init must stop (mode `stop` and at least one finding). */
  stop: boolean;
}

export function scanAutoApprove(settings: Record<string, unknown>): AutoApproveFinding[] {
  return scanProjectAutoApproveKeys(settings, isRufloHelperCommand);
}

/** Reads a settings file and judges it; null when the file is absent, unreadable or not a JSON object. */
export function checkRiskySettings(settingsPath: string, mode: RiskySettingsMode = 'stop'): RiskySettingsGate | null {
  if (!fs.existsSync(settingsPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const findings = scanAutoApprove(parsed as Record<string, unknown>);
  if (findings.length === 0) return null;
  return { mode, findings, lines: formatRiskFindingsAsWarnings(findings), stop: mode === 'stop' };
}

/**
 * ADR-509 §2.3: the helpers ruflo's hooks launch, as the PROJECT ships them.
 * `init` keeps an existing `.claude/helpers/<name>` unless --force, and the
 * project-scope hook commands prefer the project's copy, so a repository that
 * ships its own hook-handler.cjs runs it under an exact ruflo hook command. A
 * helper is trusted when its bytes are the copy this ruflo ships, or its
 * SHA-256 is in a helpers manifest signed with ruflo's key (this ruflo's, or
 * the project's own, which an older signed release left). Anything else is a
 * finding. A `.LOCKED` helpers dir (deliberate local edits) is skipped, and with
 * no ground truth at all this fails open. `pubkeyPem` is injectable for tests.
 */
export function untrustedProjectHelpers(targetDir: string, sourceHelpersDir: string | null, pubkeyPem?: string): AutoApproveFinding[] {
  const helpersDir = path.join(targetDir, '.claude', 'helpers');
  // .LOCKED is the sanctioned marker for deliberately edited helpers (helper-refresh honours it too).
  if (fs.existsSync(path.join(helpersDir, '.LOCKED'))) return [];
  const signed = (dir: string | null) => {
    if (!dir) return null;
    try {
      return verifyHelpersManifest(fs.readFileSync(path.join(dir, HELPERS_MANIFEST_FILE), 'utf-8'), pubkeyPem);
    } catch {
      return null;
    }
  };
  const manifests = [signed(sourceHelpersDir), signed(helpersDir)].filter((m) => m !== null);
  // No ground truth at all (no shipped copy, no signed manifest): fail open, as
  // helper-integrity does, rather than flag every install.
  if (!sourceHelpersDir && manifests.length === 0) return [];
  const out: AutoApproveFinding[] = [];
  for (const name of CRITICAL_HELPERS) {
    const file = path.join(helpersDir, name);
    let bytes: Buffer;
    try {
      if (!fs.lstatSync(file).isFile()) throw new Error('not a regular file');
      bytes = fs.readFileSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      out.push({ target: { kind: 'helper', name }, location: `.claude/helpers/${name}`, snippet: '(unreadable or not a regular file)', reason: "is not ruflo's signed helper; ruflo's hooks would run it" });
      continue;
    }
    if (sourceHelpersDir) {
      try {
        if (bytes.equals(fs.readFileSync(path.join(sourceHelpersDir, name)))) continue;
      } catch {
        // not shipped by this ruflo: fall through to the signed manifests
      }
    }
    const hash = sha256Hex(bytes);
    if (manifests.some((m) => m.files[name] === hash)) continue;
    out.push({
      target: { kind: 'helper', name },
      location: `.claude/helpers/${name}`,
      snippet: `sha256 ${hash.slice(0, 16)}…`,
      reason: "differs from ruflo's signed helper; init keeps it and ruflo's hooks would run it",
    });
  }
  return out;
}

/**
 * The init gate: the settings file's auto-approve keys plus the project's
 * untrusted helpers. Null when there is nothing to report.
 */
export function checkInitTrust(targetDir: string, mode: RiskySettingsMode, sourceHelpersDir: string | null): RiskySettingsGate | null {
  const settings = checkRiskySettings(path.join(targetDir, '.claude', 'settings.json'), mode);
  const helpers = untrustedProjectHelpers(targetDir, sourceHelpersDir);
  const findings = [...(settings?.findings ?? []), ...helpers];
  if (findings.length === 0) return null;
  return { mode, findings, lines: formatRiskFindingsAsWarnings(findings), stop: mode === 'stop' };
}

/** `drop`: the settings without the auto-approve keys; otherwise the settings unchanged. */
export function applyRiskyMode(settings: Record<string, unknown>, mode: RiskySettingsMode | undefined): { settings: Record<string, unknown>; dropped: number } {
  if (mode !== 'drop') return { settings, dropped: 0 };
  const findings = scanAutoApprove(settings);
  return findings.length ? { settings: dropAutoApproveKeys(settings, findings), dropped: findings.length } : { settings, dropped: 0 };
}

/** Reads `--keep-risky-settings` / `--drop-risky-settings` (camel or kebab); both at once is an error. */
export function riskyModeFromFlags(flags: Record<string, unknown>): RiskySettingsMode | { error: string } {
  const keep = flags.keepRiskySettings === true || flags['keep-risky-settings'] === true;
  const drop = flags.dropRiskySettings === true || flags['drop-risky-settings'] === true;
  if (keep && drop) return { error: '--keep-risky-settings and --drop-risky-settings cannot be used together' };
  return keep ? 'keep' : drop ? 'drop' : 'stop';
}
