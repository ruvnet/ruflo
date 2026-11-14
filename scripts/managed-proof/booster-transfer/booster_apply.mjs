/** Fixed host-only Agent Booster bridge. Does not execute generated programs. */
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
let input = '';
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 128000) throw Error('input-bound');
  }
  const value = JSON.parse(input);
  if (!value || Object.keys(value).sort().join(',') !== 'code,edit,language' ||
      typeof value.code !== 'string' || typeof value.edit !== 'string' ||
      Buffer.byteLength(value.code) > 64000 || Buffer.byteLength(value.edit) > 64000 ||
      !['javascript', 'typescript'].includes(value.language)) throw Error('schema');
  const owner = createRequire(join(process.cwd(), 'package.json'));
  const entry = owner.resolve('agent-booster');
  let packageDir = dirname(entry);
  for (let i = 0; i < 5 && !existsSync(join(packageDir, 'package.json')); i++) packageDir = dirname(packageDir);
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (pkg.name !== 'agent-booster' || pkg.version !== '0.2.2') throw Error('version');
  const { AgentBooster } = await import(pathToFileURL(entry).href);
  const started = performance.now();
  const result = await new AgentBooster().apply(value);
  const admitted = result?.success === true && typeof result.output === 'string' &&
    Buffer.byteLength(result.output) <= 64000 && Number.isFinite(result.confidence) &&
    result.confidence >= .5 && result.confidence <= 1;
  console.log(JSON.stringify({ available: true, version: pkg.version, admitted,
    output: admitted ? result.output : null, confidence: Number.isFinite(result?.confidence) ? result.confidence : null,
    strategy: typeof result?.strategy === 'string' ? result.strategy.slice(0, 80) : null,
    latencyMs: performance.now() - started }));
} catch {
  console.log(JSON.stringify({ available: false, admitted: false, output: null, error: 'Agent Booster unavailable, unsupported version or invalid result' }));
  process.exitCode = 3;
}
