/**
 * ADR-509 on the `ruflo mods install` / `ruflo init` (mods) path: scan each
 * plugin in the refreshed marketplace clone before `claude plugin install`
 * (§2.2), and after the install verify the clone against its signatures and
 * write the status file the ruflo-mods trust gate reads (§2.1): per plugin the
 * worst of its clone and install-cache copies, and each copy by its directory.
 */
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import { output } from '../output.js';
import { formatScanFinding, gateScan, scanPluginDir } from '../plugins/marketplace-trust/scan.js';
import { describeVerification, type PluginVerification } from '../plugins/marketplace-trust/signature.js';
import { verifyClone, verifyInstallCache, writeVerifyStatus } from '../plugins/marketplace-trust/verify-status.js';
import { recordAcceptedRisk, type ModPlugin } from './install.js';
import { pluginManifestIn, type ReadFs, nodeReadFs } from './plugin-resolve.js';

const nameOf = (id: string) => id.split('@')[0]!;

/**
 * Scan each plugin the clone carries. Returns the plugin ids whose install must
 * not run, each with the reason; prints every finding; records --accept-risk.
 */
export function scanBeforeInstall(
  root: string,
  clone: string | null,
  plugins: readonly ModPlugin[],
  acceptRisk: ReadonlySet<string>,
  fs: ReadFs = nodeReadFs,
  /** Lines already printed / overrides already recorded by an earlier scan in the same run (scanned before enabling, then again after the clone refresh). */
  seen: Set<string> = new Set(),
): { blocked: Map<string, string> } {
  const blocked = new Map<string, string>();
  if (!clone) return { blocked };
  const byName = new Map<string, string>();
  const findings = plugins.flatMap((p) => {
    const manifest = pluginManifestIn(clone, p.id, fs);
    if (!fs.exists(manifest)) return [];
    byName.set(nameOf(p.id), p.id);
    return scanPluginDir(nameOf(p.id), dirname(dirname(manifest)));
  });
  // --accept-risk takes the plugin name or its id (name@ruflo).
  const accept = new Set([...acceptRisk].map(nameOf));
  const gate = gateScan(findings, accept);
  for (const f of findings) {
    const line = formatScanFinding(f);
    if (seen.has(line)) continue;
    seen.add(line);
    if (f.severity === 'high') output.writeln(`${output.error('✗')} scan ${line}`);
    else output.writeln(output.dim(`  scan ${line}`));
  }
  for (const name of gate.blocked) {
    const id = byName.get(name) ?? name;
    const first = gate.findings.find((f) => f.plugin === name && f.severity === 'high')!;
    blocked.set(id, `not installed: high scan finding in ${first.file} (${first.rule}); review it, then re-run with --accept-risk ${name}`);
  }
  const at = new Date().toISOString();
  const accepted = gate.accepted.filter((plugin) => !seen.has(`accepted:${plugin}`));
  for (const plugin of accepted) seen.add(`accepted:${plugin}`);
  recordAcceptedRisk(root, accepted.map((plugin) => ({
    plugin,
    at,
    findings: gate.findings.filter((f) => f.plugin === plugin && f.severity === 'high').map(formatScanFinding),
  })));
  for (const plugin of accepted) output.printWarning(`--accept-risk ${plugin}: installing past its high scan finding(s); recorded in .claude-flow/mods/install.json`);
  return { blocked };
}

/** Verify the clone's ruflo plugins and write the status file; prints one line per non-verified plugin. */
export function verifyAndRecord(configDir: string, clone: string | null, names: readonly string[], home: string = homedir()): PluginVerification[] {
  if (!clone) return [];
  let results: PluginVerification[];
  let cache: PluginVerification[];
  try {
    results = verifyClone(clone, names);
    // The install cache is what Claude Code loads an installed plugin from: it is recorded too (worst of both).
    cache = verifyInstallCache(configDir, 'ruflo', names);
    writeVerifyStatus(configDir, clone, results, home, cache);
  } catch (error) {
    output.printWarning(`plugin signature check skipped: ${(error as Error).message}`);
    return [];
  }
  for (const r of cache) if (r.result === 'modified' || r.result === 'bad-signature') output.writeln(`${output.error('✗')} signature (install cache) ${describeVerification(r)}`);
  for (const r of results) {
    if (r.result === 'verified') output.writeln(`${output.success('✓')} signature ${r.plugin}: verified`);
    else if (r.result !== 'unsigned') output.writeln(`${output.error('✗')} signature ${describeVerification(r)}`);
  }
  const unsigned = results.filter((r) => r.result === 'unsigned').map((r) => r.plugin);
  if (unsigned.length) output.writeln(output.dim(`  signature: unsigned (no .claude-plugin/signature.json): ${unsigned.join(', ')}`));
  return results;
}

export interface SignatureFinding {
  name: string;
  status: 'pass' | 'warn';
  message: string;
  fix?: string;
}

/**
 * `ruflo mods doctor` (§2.1): one finding per ruflo mod plugin from its clone
 * and install-cache signatures; writes the status file the mod's trust gate
 * reads. `modified` / `bad-signature` warn: they are enforced only under
 * modTrust: refuse-risky, since a local checkout is always modified.
 */
export function signatureFindings(configDir: string, clone: string | null, names: readonly string[], home: string = homedir()): SignatureFinding[] {
  if (!clone) return [];
  let results: PluginVerification[];
  let cache: PluginVerification[];
  try {
    results = verifyClone(clone, names);
    cache = verifyInstallCache(configDir, 'ruflo', names);
    writeVerifyStatus(configDir, clone, results, home, cache);
  } catch (error) {
    return [{ name: 'plugin signatures', status: 'warn', message: `could not check: ${(error as Error).message}` }];
  }
  const rows = [...results.map((r) => ({ r, where: 'clone' })), ...cache.map((r) => ({ r, where: 'install cache' }))];
  return rows.map(({ r, where }): SignatureFinding => ({
    name: `signature ${r.plugin} (${where})`,
    // `unsigned` is reported, not warned: a clone from before the first signed release has no signature.json,
    // and a --strict doctor gate must not fail on that alone. modified / bad-signature warn.
    status: r.result === 'verified' || r.result === 'unsigned' ? 'pass' : 'warn',
    message: r.result === 'unsigned' ? `${r.plugin}: unsigned (no .claude-plugin/signature.json in this release)` : describeVerification(r),
    ...(r.result === 'modified' || r.result === 'bad-signature'
      ? { fix: 'claude plugin marketplace update ruflo (a local checkout is always modified; enforced only with modTrust: refuse-risky)' }
      : {}),
  }));
}
