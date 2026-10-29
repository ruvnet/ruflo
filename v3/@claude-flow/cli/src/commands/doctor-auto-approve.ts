/**
 * ADR-509 §2.3 — `ruflo doctor` reports project-level auto-approve keys
 * (enableAllProjectMcpServers, enabledMcpjsonServers, bypassPermissions,
 * blanket Bash allows, non-ruflo hooks) in `.claude/settings.json` and
 * `.claude/settings.local.json` as a warning, in any project.
 */
import { join } from 'node:path';

import { checkRiskySettings } from '../init/risky-settings-gate.js';

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
  if (hits.length === 0) return { name: AUTO_APPROVE_CHECK_NAME, status: 'pass', message: 'no auto-approve keys in project settings' };
  const shown = hits.slice(0, 3).join(' | ');
  return {
    name: AUTO_APPROVE_CHECK_NAME,
    status: 'warn',
    message: `${hits.length} auto-approve key(s): ${shown}${hits.length > 3 ? ` | … ${hits.length - 3} more` : ''}`,
    fix: 'Review them; `ruflo init upgrade --settings --drop-risky-settings` rewrites settings.json without them',
  };
}
