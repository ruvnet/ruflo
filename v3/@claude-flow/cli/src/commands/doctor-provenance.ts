/**
 * ADR-545 — `ruflo doctor --component provenance`.
 *
 * Checks the registry provenance of ruflo's three packages at the version(s)
 * this project pins (read from .mcp.json, .claude/settings.json and
 * CLAUDE.md), or at the running CLI's version when the project pins none.
 * Network-dependent, so it is a named component and not part of bare
 * `ruflo doctor`.
 */
import * as fs from 'fs';
import * as path from 'path';

import { isExactVersion, pinnedVersion } from '../init/pinning.js';
import {
  NPM_AUDIT_SIGNATURES_NOTE,
  verifyOurProvenance,
  worstStatus,
  type ProvenanceOptions,
  type ProvenanceReport,
} from '../init/provenance.js';

export interface ProvenanceCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export const PROVENANCE_CHECK_NAME = 'Package provenance (ADR-545)';

const PINNED_REF_RE = /(?<![\w@/.-])(?:@claude-flow\/cli|claude-flow|ruflo)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![\w.-])/g;

/** Exact versions of our packages this project's generated files pin. */
export function projectPinnedVersions(cwd: string): string[] {
  const found = new Set<string>();
  for (const rel of ['.mcp.json', '.claude/settings.json', 'CLAUDE.md']) {
    let text: string;
    try {
      const abs = path.join(cwd, rel);
      if (!fs.lstatSync(abs).isFile()) continue;
      text = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(PINNED_REF_RE)) found.add(m[1]);
  }
  return [...found].sort();
}

/** Lines for printing one provenance report (init, repin, doctor --verbose). */
export function formatProvenanceReport(report: ProvenanceReport): string[] {
  return report.results.map((r) => `${r.status.toUpperCase().padEnd(4)} ${r.pkg}@${r.version}: ${r.message}`);
}

export async function checkProvenance(
  cwd: string = process.cwd(),
  options: ProvenanceOptions & { versions?: string[] } = {},
): Promise<ProvenanceCheck> {
  const running = pinnedVersion();
  const versions = options.versions ?? (() => {
    const pinned = projectPinnedVersions(cwd);
    if (pinned.length > 0) return pinned;
    return isExactVersion(running) ? [running] : [];
  })();
  if (versions.length === 0) {
    return { name: PROVENANCE_CHECK_NAME, status: 'warn', message: 'no pinned version in this project and the running CLI version is unknown', fix: NPM_AUDIT_SIGNATURES_NOTE };
  }

  const reports = await Promise.all(versions.map((v) => verifyOurProvenance(v, options)));
  const status = worstStatus(reports.map((r) => r.status));
  const all = reports.flatMap((r) => r.results);
  const pick = all.filter((r) => r.status === status);
  const summary = status === 'pass'
    ? `${all.length} package(s) at ${versions.join(', ')} have SLSA provenance from github.com/ruvnet/ruflo matching dist.integrity (registry-consistent; for sigstore signature verification run \`npm audit signatures\`)`
    : pick.map((r) => `${r.pkg}@${r.version}: ${r.message}`).join(' | ');
  const fix = status === 'fail'
    ? `Do not run these versions. Repin to a release with valid provenance (\`ruflo init repin\`) and report it. ${NPM_AUDIT_SIGNATURES_NOTE}`
    : NPM_AUDIT_SIGNATURES_NOTE;
  return { name: PROVENANCE_CHECK_NAME, status, message: summary, fix };
}
