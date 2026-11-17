/** Host CLI only. Fixed developer-owned checks are trusted code, not a sandbox. */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { canonical, digest, observationOf, type Evidence, type Observation } from '../v3/@claude-flow/cli/src/services/managed-learning.js';

type Command = { argv: string[]; cwd: string; timeoutMs: number };
type Groups = Record<'acceptance' | 'safety' | 'replay' | 'adversarial', Command[]>;
export type HostManifest = {
  v: 1; root: string; sourceFiles: string[]; artifactFiles: string[];
  taskSpec: string; policySpec: string; corpusSpec: string; evaluatorSpec: string; costReceipt: string;
  taskType: Observation['taskType']; split: Observation['split']; trial: number;
  strategy: Observation['strategy']; budgetCents: number; checks: Groups; metrics: Command;
};
type CheckResult = { group: string; exitCode: number | null; signal: string | null; timedOut: boolean; overflow: boolean; durationMs: number; stdoutHash: string; stderrHash: string };
const HASH = /^[a-f0-9]{64}$/;
const groups = ['acceptance', 'safety', 'replay', 'adversarial'] as const;
function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) throw Error('Invalid closed host contract');
}
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function beneath(root: string, path: string): boolean { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)); }
function regular(path: string, max = 128_000, hostOwned = false): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || (hostOwned && ((process.getuid && before.uid !== process.getuid()) || (before.mode & 0o022)))) throw Error('Host file ownership or type rejected');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.ino !== before.ino || s.dev !== before.dev || s.size > max) throw Error('Host file changed or exceeded limit');
    const buffer = Buffer.alloc(max + 1); let bytes = 0;
    while (bytes < buffer.length) { const count = readSync(fd, buffer, bytes, buffer.length - bytes, bytes); if (!count) break; bytes += count; }
    if (bytes > max) throw Error('Host file exceeds limit');
    return buffer.subarray(0, bytes);
  } finally { closeSync(fd); }
}
function contained(root: string, input: unknown, directory = false): string {
  if (typeof input !== 'string' || !input || isAbsolute(input) || input.includes('\0')) throw Error('Paths must be relative to host root');
  const path = resolve(root, input);
  if (!beneath(root, path)) throw Error('Path outside host root');
  let p = root;
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    p = resolve(p, component);
    if (lstatSync(p).isSymbolicLink()) throw Error('Symlink paths are not accepted');
  }
  if (!beneath(root, realpathSync(path)) || (directory && !lstatSync(path).isDirectory())) throw Error('Invalid contained path');
  return path;
}
function jsonFile(path: string, hostOwned = false): unknown { return JSON.parse(regular(path, 128_000, hostOwned).toString('utf8')); }
export function treeHash(root: string, paths: string[]): string {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 100 || new Set(paths).size !== paths.length) throw Error('Explicit unique file list required');
  let bytes = 0;
  return digest(paths.slice().sort().map(name => {
    const data = regular(contained(root, name), 4_000_000); bytes += data.length;
    if (bytes > 16_000_000) throw Error('Tree exceeds limit');
    return { path: name, sha256: sha(data) };
  }));
}
function commandOf(value: unknown, root: string): Command {
  exact(value, ['argv', 'cwd', 'timeoutMs']);
  if (!Array.isArray(value.argv) || value.argv.length < 1 || value.argv.length > 32 || value.argv.some(v => typeof v !== 'string' || v.length > 4096 || v.includes('\0')) || !isAbsolute(value.argv[0]) || !Number.isSafeInteger(value.timeoutMs) || (value.timeoutMs as number) < 1 || (value.timeoutMs as number) > 30_000) throw Error('Invalid bounded argv');
  const executable = realpathSync(value.argv[0]);
  if (/^(?:ba|da|z|fi|c|tc|k)?sh$|^(?:env|cmd|powershell|pwsh)(?:\.exe)?$/i.test(basename(executable))) throw Error('Shell and executable-dispatch wrappers are not accepted');
  const stat = lstatSync(executable);
  if (!stat.isFile() || (stat.mode & 0o022) || !(stat.mode & 0o111)) throw Error('Unsafe executable');
  contained(root, value.cwd, true);
  return { argv: [executable, ...value.argv.slice(1)], cwd: value.cwd as string, timeoutMs: value.timeoutMs as number };
}
function manifestOf(value: unknown): HostManifest {
  exact(value, ['v', 'root', 'sourceFiles', 'artifactFiles', 'taskSpec', 'policySpec', 'corpusSpec', 'evaluatorSpec', 'costReceipt', 'taskType', 'split', 'trial', 'strategy', 'budgetCents', 'checks', 'metrics']);
  if (value.v !== 1 || typeof value.root !== 'string' || !isAbsolute(value.root) || lstatSync(value.root).isSymbolicLink() || !lstatSync(value.root).isDirectory()) throw Error('Invalid host root');
  const root = realpathSync(value.root);
  const strategy = value.strategy;
  exact(strategy, ['id', 'model', 'workers', 'template']);
  if (['id', 'model', 'template'].some(k => typeof strategy[k] !== 'string')) throw Error('Strategy identifiers must be literal strings');
  exact(value.checks, groups);
  const checks = {} as Groups;
  for (const group of groups) {
    const entries = value.checks[group];
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 4) throw Error('Every verification group needs executed checks');
    checks[group] = entries.map(v => commandOf(v, root));
  }
  return { ...value, root, checks, metrics: commandOf(value.metrics, root) } as HostManifest;
}
async function run(command: Command, root: string, group: string, deadline: number): Promise<{ report: CheckResult; stdout: string }> {
  const started = performance.now(), stdout: Buffer[] = [], stderr: Buffer[] = [];
  let bytes = 0, overflow = false, timedOut = false;
  if (Date.now() >= deadline) throw Error('Verifier deadline exceeded');
  const child = spawn(command.argv[0]!, command.argv.slice(1), { cwd: contained(root, command.cwd, true), shell: false, detached: true, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, Math.min(command.timeoutMs, deadline - Date.now()));
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on('data', (data: Buffer) => { bytes += data.length; if (bytes > 64_000) { overflow = true; kill(); } else chunks.push(data); });
  return new Promise((resolveResult, reject) => {
    child.once('error', () => { clearTimeout(timer); kill(); reject(Error('Verifier executable failed')); });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer); kill();
      const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
      resolveResult({ report: { group, exitCode, signal, timedOut, overflow, durationMs: Math.ceil(performance.now() - started), stdoutHash: sha(out), stderrHash: sha(err) }, stdout: out.toString('utf8') });
    });
  });
}

/** Manifest and key paths are supplied only by the trusted host CLI, never MCP. */
export async function verifyHostManifest(path: string): Promise<{ evidence: Evidence; report: { v: 1; sourceHash: string; artifactHash: string; evaluatorHash: string; costReceiptHash: string; costOrigin: string; checks: CheckResult[]; limitations: string } }> {
  if (process.platform === 'win32') throw Error('Verifier process-group lifecycle requires a POSIX host');
  const manifest = manifestOf(jsonFile(resolve(path), true));
  const keyPath = process.env.RUFLO_MANAGED_VERIFIER_PRIVATE_KEY_FILE;
  if (!keyPath || !isAbsolute(keyPath)) throw Error('Host signing key file is required');
  const keyDir = lstatSync(dirname(keyPath)), keyStat = lstatSync(keyPath);
  if (!keyDir.isDirectory() || keyDir.isSymbolicLink() || (keyDir.mode & 0o077) || (process.getuid && keyDir.uid !== process.getuid()) || keyStat.isSymbolicLink() || (keyStat.mode & 0o077)) throw Error('Signing key needs an owner-only directory and file');
  const root = manifest.root;
  const specs = Object.fromEntries(['taskSpec', 'policySpec', 'corpusSpec', 'evaluatorSpec'].map(k => [k, jsonFile(contained(root, manifest[k as keyof HostManifest]), true)]));
  const sourceHash = treeHash(root, manifest.sourceFiles), artifactHash = treeHash(root, manifest.artifactFiles);
  const taskHash = digest(specs.taskSpec), policyHash = digest(specs.policySpec), corpusHash = digest(specs.corpusSpec);
  const evaluatorHash = digest({ verifier: sha(regular(fileURLToPath(import.meta.url), 200_000)), spec: specs.evaluatorSpec, checks: manifest.checks, metrics: manifest.metrics });
  const cost = jsonFile(contained(root, manifest.costReceipt), true);
  exact(cost, ['v', 'origin', 'amountCents', 'taskHash', 'sourceHash', 'artifactHash', 'strategyHash', 'receiptId']);
  if (cost.v !== 1 || !['synthetic-fixture', 'provider-export'].includes(cost.origin as string) || !Number.isSafeInteger(cost.amountCents) || (cost.amountCents as number) <= 0 || (cost.amountCents as number) > 999_999_999 || cost.taskHash !== taskHash || cost.sourceHash !== sourceHash || cost.artifactHash !== artifactHash || cost.strategyHash !== digest(manifest.strategy) || typeof cost.receiptId !== 'string' || !HASH.test(cost.receiptId)) throw Error('Trusted cost receipt is not bound to this attempt');
  if (cost.origin === 'synthetic-fixture' && process.env.RUFLO_MANAGED_VERIFIER_ALLOW_SYNTHETIC !== '1') throw Error('Synthetic cost requires explicit host fixture mode and a dedicated fixture key');
  // Validate the full observation contract before spawning any trusted checks.
  const attemptId = digest({ taskHash, sourceHash, artifactHash, policyHash, corpusHash, evaluatorHash, strategy: manifest.strategy, split: manifest.split, trial: manifest.trial, costReceiptHash: digest(cost) });
  const proposed = observationOf({ v: 1, attemptId, taskHash, sourceHash, artifactHash, policyHash, corpusHash, evaluatorHash, taskType: manifest.taskType, split: manifest.split, trial: manifest.trial, strategy: manifest.strategy, budgetCents: manifest.budgetCents, costCents: cost.amountCents, durationMs: 0, checks: { acceptance: false, safety: false, replay: false, adversarial: false, drift: 1, driftThreshold: 0, rollbackRate: 1 } });
  const reports: CheckResult[] = [], outcomes = {} as Record<typeof groups[number], boolean>;
  const started = performance.now(), deadline = Date.now() + 120_000;
  for (const group of groups) {
    const results = [];
    for (const check of manifest.checks[group]) { const result = await run(check, root, group, deadline); reports.push(result.report); results.push(result.report.exitCode === 0 && !result.report.timedOut && !result.report.overflow); }
    outcomes[group] = results.every(Boolean);
  }
  const metricResult = await run(manifest.metrics, root, 'metrics', deadline); reports.push(metricResult.report);
  if (metricResult.report.exitCode !== 0 || metricResult.report.timedOut || metricResult.report.overflow || metricResult.stdout.length > 4096) throw Error('Independent metrics check failed');
  const metrics: unknown = JSON.parse(metricResult.stdout); exact(metrics, ['drift', 'driftThreshold', 'rollbackRate']);
  if (treeHash(root, manifest.sourceFiles) !== sourceHash || treeHash(root, manifest.artifactFiles) !== artifactHash || digest(jsonFile(contained(root, manifest.costReceipt), true)) !== digest(cost) || ['taskSpec', 'policySpec', 'corpusSpec', 'evaluatorSpec'].some(k => digest(jsonFile(contained(root, manifest[k as keyof HostManifest]), true)) !== digest(specs[k]))) throw Error('Host inputs changed during verification');
  const observation = observationOf({ ...proposed, durationMs: Math.ceil(performance.now() - started), checks: { ...outcomes, ...metrics } });
  // Key material is loaded only after all checks; children never inherit it or its path.
  const key = createPrivateKey(regular(keyPath, 16_384, true));
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Host signer must use Ed25519');
  const signature = sign(null, Buffer.from(canonical(observation)), key).toString('base64');
  return { evidence: { observation, signature }, report: { v: 1, sourceHash, artifactHash, evaluatorHash, costReceiptHash: digest(cost), costOrigin: cost.origin as string, checks: reports, limitations: 'Fixed host-owned checks measure their declared contracts only; not a sandbox, universal safety proof, provider billing audit or release authorization. Synthetic fixture cost is not live spend.' } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw Error('One host manifest path is required');
    console.log(JSON.stringify(await verifyHostManifest(process.argv[2]!)));
  } catch { console.error('Managed outcome verification failed; no receipt emitted. Inspect trusted host inputs and check contracts.'); process.exitCode = 1; }
}
