/**
 * ADR-545 — `ruflo init repin` (also `ruflo init --repin`) and the
 * provenance warning init prints after writing pinned files.
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { parseReleaseChannel, type ReleaseChannel } from '../init/pinning.js';
import { formatRepinReport, repinProject, type RepinReport } from '../init/repin.js';
import {
  automaticProvenanceCheckEnabled,
  verifyOurProvenance,
  NPM_AUDIT_SIGNATURES_NOTE,
  type ProvenanceOptions,
  type ProvenanceReport,
} from '../init/provenance.js';
import { formatProvenanceReport } from './doctor-provenance.js';

/** Read `--channel` from parsed flags. */
export function channelFromFlags(flags: Record<string, unknown>): ReleaseChannel | { error: string } {
  return parseReleaseChannel(flags.channel);
}

function isDryRun(flags: Record<string, unknown>): boolean {
  return flags.dryRun === true || flags['dry-run'] === true;
}

/**
 * Non-fatal: print what the registry says about the provenance of `version`.
 * Returns the report, or null when skipped. Never throws.
 */
export async function reportProvenance(
  version: string,
  context: 'init' | 'repin',
  options: ProvenanceOptions = {},
): Promise<ProvenanceReport | null> {
  if (!options.fetch && !automaticProvenanceCheckEnabled()) return null;
  try {
    const report = await verifyOurProvenance(version, { timeoutMs: 4000, ...options });
    if (report.status === 'pass') {
      output.printSuccess(`Provenance: ruflo ${version} packages carry SLSA provenance from github.com/ruvnet/ruflo`);
      return report;
    }
    const print = report.status === 'fail' ? output.printError.bind(output) : output.printWarning.bind(output);
    print(`Provenance (${context}): ${report.status === 'fail' ? 'FAILED' : 'not confirmed'} for ruflo ${version}`);
    for (const line of formatProvenanceReport(report)) output.writeln(`  ${line}`);
    output.writeln(output.dim(`  ${NPM_AUDIT_SIGNATURES_NOTE}`));
    return report;
  } catch {
    return null;
  }
}

export async function repinAction(ctx: CommandContext): Promise<CommandResult> {
  const channel = channelFromFlags(ctx.flags);
  if (typeof channel === 'object') {
    output.printError(channel.error);
    return { success: false, exitCode: 1 };
  }
  const dryRun = isDryRun(ctx.flags);
  let report: RepinReport;
  try {
    report = repinProject(ctx.cwd, { channel, dryRun });
  } catch (error) {
    output.printError(error instanceof Error ? error.message : String(error));
    return { success: false, exitCode: 1 };
  }

  const json = ctx.flags.format === 'json';
  if (!json) {
    output.writeln(output.bold(`RuFlo repin → @${report.target}${dryRun ? ' (dry run, nothing written)' : ''}`));
    const lines = formatRepinReport(report);
    if (lines.length === 0) output.printInfo('No floating or stale refs to ruflo packages found; nothing to change.');
    for (const line of lines) output.writeln(line);
    output.writeln();
    output.printInfo(`${report.changedLines} line(s) in ${report.changedFiles} file(s) ${dryRun ? 'would change' : 'changed'}`);
  }

  let provenance: ProvenanceReport | null = null;
  if (report.target !== 'latest' && !json) provenance = await reportProvenance(report.target, 'repin');
  if (json) output.printJson({ ...report, provenance });
  return { success: true, data: { ...report, provenance } };
}

export const repinCommand: Command = {
  name: 'repin',
  description: 'Rewrite @latest/@alpha refs to ruflo packages in settings.json, .mcp.json, CLAUDE.md and .claude/helpers to this CLI\'s exact version (ADR-545)',
  options: [
    { name: 'dry-run', description: 'Report every line that would change; write nothing', type: 'boolean', default: false },
    { name: 'channel', description: 'pinned (default: this CLI\'s exact version) or latest (rewrite pins back to @latest)', type: 'string' },
  ],
  examples: [
    { command: 'ruflo init repin --dry-run', description: 'Show what repinning would change' },
    { command: 'ruflo init repin', description: 'Pin the project to this CLI\'s version and check provenance' },
    { command: 'ruflo init repin --channel latest', description: 'Go back to floating @latest refs' },
  ],
  action: repinAction,
};
