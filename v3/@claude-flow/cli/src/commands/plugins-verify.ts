/**
 * ADR-509 — `ruflo plugins verify [name]` and the scan `ruflo plugins install`
 * runs on a local plugin before registering it.
 */
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { claudeConfigDir, marketplaceState } from '../mods/plugin-resolve.js';
import { formatScanFinding, gateScan, scanPluginDir } from '../plugins/marketplace-trust/scan.js';
import { describeVerification, type PluginVerification } from '../plugins/marketplace-trust/signature.js';
import { isUntrusted, verifyClone, verifyInstallCache, writeVerifyStatus } from '../plugins/marketplace-trust/verify-status.js';

export const verifyCommand: Command = {
  name: 'verify',
  description: 'Check ruflo marketplace plugins against their release signatures (verified / modified / unsigned / bad-signature)',
  options: [
    { name: 'clone', description: 'A ruflo marketplace checkout to verify instead of the clone Claude Code loads from', type: 'string' },
    { name: 'no-cache', description: 'Skip the install-cache copies', type: 'boolean', default: false },
    { name: 'strict', description: 'Exit 1 on unsigned too (default: only modified / bad-signature fail)', type: 'boolean', default: false },
    { name: 'json', description: 'Output as JSON', type: 'boolean', default: false },
  ],
  examples: [
    { command: 'ruflo plugins verify', description: 'Every plugin in the ruflo marketplace clone, plus install-cache copies' },
    { command: 'ruflo plugins verify ruflo-mods', description: 'One plugin' },
    { command: 'ruflo plugins verify --clone . --strict', description: 'Release check: a checkout must verify completely' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const names = ctx.args.filter((a) => /^[A-Za-z0-9._-]{1,100}$/.test(a));
    const explicit = (ctx.flags.clone as string | undefined) ?? undefined;
    const configDir = claudeConfigDir(process.env, homedir());
    const clone = explicit ? resolve(explicit) : marketplaceState(configDir).location;
    if (!clone) {
      output.printError('No ruflo marketplace clone (run: claude plugin marketplace add ruvnet/ruflo, or pass --clone <dir>)');
      return { success: false, exitCode: 1 };
    }
    let results: PluginVerification[];
    try {
      results = verifyClone(clone, names);
    } catch (error) {
      output.printError(`Cannot read ${clone}/.claude-plugin/marketplace.json: ${(error as Error).message}`);
      return { success: false, exitCode: 1 };
    }
    if (names.length && results.length === 0) {
      output.printError(`${names.join(', ')}: not in the marketplace at ${clone}`);
      return { success: false, exitCode: 1 };
    }
    const noCache = ctx.flags.noCache === true || ctx.flags['no-cache'] === true || ctx.flags.cache === false;
    // The install cache is what Claude Code loads an installed plugin from, so the status the mod's
    // trust gate reads always includes it (--no-cache only hides it here); an explicit --clone writes nothing.
    const loadedCache = explicit ? [] : verifyInstallCache(configDir, 'ruflo', names);
    const cache = noCache ? [] : loadedCache;
    const statusPath = explicit ? undefined : writeVerifyStatus(configDir, clone, results, undefined, loadedCache);
    const all = [...results, ...cache];
    const strict = ctx.flags.strict === true;
    const failed = all.filter((r) => isUntrusted(r.result) || (strict && r.result === 'unsigned'));
    if (ctx.flags.json) {
      output.printJson({ clone, statusPath, clonePlugins: results, installCache: cache });
    } else {
      output.writeln(output.dim(`clone: ${clone}`));
      for (const r of results) printRow(r);
      if (cache.length) output.writeln(output.dim('install cache:'));
      for (const r of cache) printRow(r);
      if (statusPath) output.writeln(output.dim(`status written: ${statusPath}`));
    }
    return failed.length ? { success: false, exitCode: 1, data: all } : { success: true, data: all };
  },
};

function printRow(r: PluginVerification): void {
  const mark = r.result === 'verified' ? output.success('✓') : r.result === 'unsigned' ? output.warning('!') : output.error('✗');
  output.writeln(`${mark} ${describeVerification(r)}${r.version ? output.dim(` (v${r.version})`) : ''}`);
}

/**
 * ADR-509 §2.2 for `ruflo plugins install -n <local path>`: a high finding
 * stops the install unless --accept-risk names the plugin (its directory name).
 * Returns an error message when the install must stop.
 */
export function scanLocalPluginBeforeInstall(dir: string, acceptRisk: readonly string[]): string | null {
  const name = basename(resolve(dir));
  const findings = scanPluginDir(name, resolve(dir));
  for (const f of findings) output.writeln(f.severity === 'high' ? `${output.error('✗')} scan ${formatScanFinding(f)}` : output.dim(`  scan ${formatScanFinding(f)}`));
  const gate = gateScan(findings, new Set(acceptRisk));
  if (gate.accepted.length) output.printWarning(`--accept-risk ${name}: installing past its high scan finding(s)`);
  return gate.blocked.length ? `${name}: high scan finding(s); review them, then re-run with --accept-risk ${name}` : null;
}
