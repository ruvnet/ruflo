/**
 * #2638 — dual-host instructions with one source.
 *
 * `init --dual` makes AGENTS.md the single source for the sections both hosts
 * share. CLAUDE.md becomes Claude Code's `@AGENTS.md` import plus only the
 * Claude-specific sections. Two steps:
 *
 *   1. writeDualClaudeMd (Claude pass) writes the import form, but only over a
 *      CLAUDE.md that is missing, already ours and unmodified, or --force.
 *   2. finalizeDualInstructions (after the Codex pass) checks that AGENTS.md
 *      really carries every shared section. If it does not (Codex init failed,
 *      or an older @claude-flow/codex wrote the single-host AGENTS.md), the full
 *      single-host CLAUDE.md is written back, so nothing is lost.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InitOptions, InitResult } from './types.js';
import { AGENTS_MD_CLI, generateClaudeMd, generateDualClaudeMd, sharedSectionsForImport } from './claudemd-generator.js';
import { importsAgentsMd } from './shared-instructions.js';

export const DUAL_MIGRATION_HINT =
  'to share instructions with Codex, move your custom sections into AGENTS.md and replace the shared ones ' +
  'with a line `@AGENTS.md`, or re-run with --force (the current file is backed up to CLAUDE.md.pre-ruflo)';

function inferredTemplate(options: InitOptions) {
  return (!options.components.commands && !options.components.agents) ? 'minimal' as const : undefined;
}

function backup(claudeMdPath: string, result: InitResult): void {
  const base = `${claudeMdPath}.pre-ruflo`;
  const target = fs.existsSync(base) ? `${base}.${Date.now()}` : base;
  fs.copyFileSync(claudeMdPath, target);
  result.created.files.push(path.basename(target));
}

/** Claude pass of `init --dual`: write CLAUDE.md as the AGENTS.md import form when it is safe to. */
export function writeDualClaudeMd(claudeMdPath: string, options: InitOptions, result: InitResult): void {
  const template = inferredTemplate(options);
  const fullForm = generateClaudeMd(options, template);
  const importForm = generateDualClaudeMd(options, template);

  if (fs.existsSync(claudeMdPath)) {
    const existing = fs.readFileSync(claudeMdPath, 'utf-8');
    if (existing === importForm || (importsAgentsMd(existing) && !options.force)) {
      result.skipped.push('CLAUDE.md (already imports AGENTS.md)');
      return;
    }
    const ours = existing === fullForm;
    if (!ours && !options.force) {
      result.skipped.push(`CLAUDE.md (has your own content; ${DUAL_MIGRATION_HINT})`);
      return;
    }
    if (!ours) backup(claudeMdPath, result);
  }

  fs.writeFileSync(claudeMdPath, importForm, 'utf-8');
  result.created.files.push('CLAUDE.md (imports AGENTS.md)');
  result.dualInstructions = { importForm, fullForm };
}

export interface DualFinalizeOutcome {
  /** `import`: CLAUDE.md imports AGENTS.md. `restored`: full CLAUDE.md written back. `none`: nothing to do. */
  action: 'import' | 'restored' | 'none';
  message?: string;
}

/**
 * After the Codex pass: keep the import form only when AGENTS.md carries every
 * shared section verbatim. Never touches a CLAUDE.md this run did not write.
 */
export function finalizeDualInstructions(targetDir: string, claudeResult: InitResult | undefined): DualFinalizeOutcome {
  const dual = claudeResult?.dualInstructions;
  if (!dual) return { action: 'none' };

  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  let current: string | undefined;
  try {
    current = fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    return { action: 'none' };
  }
  if (current !== dual.importForm) return { action: 'none' };

  let agentsMd = '';
  try {
    agentsMd = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf-8');
  } catch { /* missing AGENTS.md: handled below */ }

  const missing = sharedSectionsForImport(AGENTS_MD_CLI).filter((section) => !agentsMd.includes(section));
  if (missing.length === 0) {
    return { action: 'import', message: 'CLAUDE.md imports AGENTS.md (shared sections live once, in AGENTS.md)' };
  }

  fs.writeFileSync(claudeMdPath, dual.fullForm, 'utf-8');
  return {
    action: 'restored',
    message: `AGENTS.md is missing ${missing.length} shared section(s) (Codex init failed, or an older @claude-flow/codex ran), ` +
      'so the full CLAUDE.md was kept instead of the @AGENTS.md import',
  };
}
