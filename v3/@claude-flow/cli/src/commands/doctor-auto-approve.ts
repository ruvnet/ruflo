/**
 * ADR-509 §2.3 — `ruflo doctor` reports project-level auto-approve keys
 * (enableAllProjectMcpServers, enabledMcpjsonServers, bypassPermissions,
 * blanket Bash allows, non-ruflo hooks) in `.claude/settings.json` and
 * `.claude/settings.local.json`, and project `.claude/helpers` that are not
 * ruflo's signed copies, as a warning, in any project.
 */
import { join } from 'node:path';

import { findPackageHelpersDir } from '../init/helper-refresh.js';
import { checkRiskySettings, untrustedProjectHelpers } from '../init/risky-settings-gate.js';
import { formatRiskFindingsAsWarnings } from '../init/settings-risk-scanner.js';

export interface AutoApproveCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export const AUTO_APPROVE_CHECK_NAME = 'Project auto-approve settings (ADR-509)';

export async function checkProjectAutoApproveSettings(cwd: string = process.cwd()): Promise<AutoApproveCheck> {
  const hits: string[] = [];
  for (const file of ['.claude/settings.json', '.claude/settings.local.json']) {
    const gate = checkRiskySettings(join(cwd, file), 'keep');
    if (gate) hits.push(...gate.lines.map((l) => `${file}: ${l}`));
  }
  // A project-shipped helper that is not ruflo's signed copy runs under ruflo's own hook commands.
  hits.push(...formatRiskFindingsAsWarnings(untrustedProjectHelpers(cwd, findPackageHelpersDir())));
  if (hits.length === 0) return { name: AUTO_APPROVE_CHECK_NAME, status: 'pass', message: 'no auto-approve keys in project settings' };
  const shown = hits.slice(0, 3).join(' | ');
  return {
    name: AUTO_APPROVE_CHECK_NAME,
    status: 'warn',
    message: `${hits.length} auto-approve key(s): ${shown}${hits.length > 3 ? ` | … ${hits.length - 3} more` : ''}`,
    fix: 'Review them; `ruflo init upgrade --settings --drop-risky-settings` rewrites settings.json without them',
  };
}
