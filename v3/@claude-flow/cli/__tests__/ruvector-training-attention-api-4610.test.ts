/**
 * #4610: ruvector-training called @ruvector/attention methods that don't exist:
 * InfoNceLoss.backward() (and compute() with an array of positives), and
 * computeRaw() on FlashAttention / MoEAttention / HyperbolicAttention. The
 * contrastive leg of `neural train` swallowed the error every epoch.
 *
 * Runs against the real binding, since a mock would hide exactly this kind of
 * API mismatch. vitest externalizes `@ruvector/*`, so the source runs in a child
 * process under tsx (as agentic-flow-root-import.test.ts does). Skipped where
 * @ruvector/attention is not installed.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLI = resolve(__dirname, '..');
const SRC = JSON.stringify(pathToFileURL(join(CLI, 'src', 'services', 'ruvector-training.ts')).href);
const hasBinding = (() => { try { createRequire(import.meta.url).resolve('@ruvector/attention'); return true; } catch { return false; } })();

/** Run `body` after initializeTraining in a child; it must print one RESULT= JSON line. */
function probe(body: string): Record<string, any> {
  const script = `
    const rt = await import(${SRC});
    const binding = (await import('node:module')).createRequire(import.meta.url)('@ruvector/attention');
    await rt.initializeTraining({ dim: 8, useFlashAttention: true, useMoE: true, useHyperbolic: true });
    const vec = s => Float32Array.from({ length: 8 }, (_, i) => Math.sin(s + i) * 0.5);
    const out = {};
    const attempt = (name, f) => { try { out[name] = f(); } catch (e) { out[name] = { error: e.constructor.name + ': ' + e.message }; } };
    ${body}
    console.log('RESULT=' + JSON.stringify(out, (_, v) => v instanceof Float32Array ? Array.from(v) : v));
    process.exit(0);`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: CLI, encoding: 'utf8', timeout: 120_000 });
  const line = child.stdout.split('\n').find((l) => l.startsWith('RESULT='));
  if (!line) throw new Error(`probe produced no result: ${child.stderr.slice(-500)}`);
  return JSON.parse(line.slice('RESULT='.length));
}

describe.skipIf(!hasBinding)('ruvector-training against the real @ruvector/attention API (#4610)', () => {
  it('computeContrastiveLoss returns the binding loss and gradients, averaging positives', () => {
    const r = probe(`
      const anchor = vec(1), negatives = [vec(7), vec(9)];
      attempt('one', () => rt.computeContrastiveLoss(anchor, [vec(2)], negatives));
      attempt('expected', () => new binding.InfoNceLoss(0.07).computeWithGradients(anchor, vec(2), negatives));
      attempt('a', () => rt.computeContrastiveLoss(anchor, [vec(2)], [vec(7)]));
      attempt('b', () => rt.computeContrastiveLoss(anchor, [vec(3)], [vec(7)]));
      attempt('both', () => rt.computeContrastiveLoss(anchor, [vec(2), vec(3)], [vec(7)]));
      attempt('none', () => rt.computeContrastiveLoss(anchor, [], negatives));`);
    // Baseline: { error: 'Error: Get TypedArray info failed' } (and backward() does not exist).
    expect(r.one.error).toBeUndefined();
    expect(r.one.loss).toBeCloseTo(r.expected.loss, 6);
    expect(r.one.gradient).toHaveLength(8);
    r.one.gradient.forEach((g: number, i: number) => expect(g).toBeCloseTo(r.expected.gradients[i], 6));
    expect(r.both.loss).toBeCloseTo((r.a.loss + r.b.loss) / 2, 6);
    expect(r.both.gradient[0]).toBeCloseTo((r.a.gradient[0] + r.b.gradient[0]) / 2, 6);
    expect(r.none.error).toMatch(/at least one positive/);
  }, 150_000);

  it('flash, MoE and hyperbolic attention helpers return attended vectors', () => {
    const r = probe(`
      for (const fn of ['computeFlashAttention', 'computeMoEAttention', 'computeHyperbolicAttention'])
        attempt(fn, () => rt[fn](vec(1), [vec(2), vec(3)], [vec(4), vec(5)]));`);
    // Baseline: { error: 'TypeError: <x>Attention.computeRaw is not a function' }.
    for (const fn of ['computeFlashAttention', 'computeMoEAttention', 'computeHyperbolicAttention']) {
      expect(r[fn].error, fn).toBeUndefined();
      expect(r[fn], fn).toHaveLength(8);
    }
  }, 150_000);
});
