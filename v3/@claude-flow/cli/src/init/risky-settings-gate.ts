/**
 * ADR-509 §2.3: the stop `ruflo init` / `ruflo init upgrade --settings` makes
 * before carrying a project settings file's auto-approve keys forward.
 *
 * The check runs BEFORE anything is written, so a stop leaves the project as
 * it was. `keep` proceeds (the keys are still reported); `drop` proceeds and
 * the merged file is written without them.
 */
import * as fs from 'fs';

import { isRufloHelperCommand } from './helper-commands.js';
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
