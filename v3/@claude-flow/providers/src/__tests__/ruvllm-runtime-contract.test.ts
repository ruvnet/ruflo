/**
 * Contract for the @ruvector/ruvllm runtime ruflo resolves.
 *
 * @ruvector/ruvllm 4.0.0 and 4.0.1 were published from the wrong repository:
 * an ESM-only GPU-loop harness with none of the runtime symbols ruflo uses.
 * An open `>=2.6.0` range picked them up, and every caller that loads the
 * runtime with `createRequire(...)('@ruvector/ruvllm')` (the CLI's
 * intelligence.ts SonaCoordinator, sona-optimizer.ts, native-training.ts)
 * silently fell back to JS. Load the installed package the same way and
 * require the symbols, so a wrong-package release fails CI instead.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const requireCjs = createRequire(import.meta.url);

describe('@ruvector/ruvllm runtime contract', () => {
  it('loads through CommonJS require and exports the runtime classes', () => {
    const ruvllm = requireCjs('@ruvector/ruvllm');
    for (const symbol of ['SonaCoordinator', 'ContrastiveTrainer', 'TrainingPipeline', 'LoraAdapter']) {
      expect(typeof ruvllm[symbol], `@ruvector/ruvllm.${symbol}`).toBe('function');
    }
  });

  it('constructs a SonaCoordinator the way the CLI does', () => {
    const ruvllm = requireCjs('@ruvector/ruvllm');
    const coordinator = new ruvllm.SonaCoordinator(ruvllm.DEFAULT_SONA_CONFIG);
    expect(coordinator).toBeTruthy();
  });

  it('resolves a version inside the declared range (>=2.6.0 <4.0.0 || ^4.1.0)', () => {
    // The package's exports map does not expose ./package.json, so find it
    // from the resolved entry point.
    let dir = dirname(requireCjs.resolve('@ruvector/ruvllm'));
    while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== '@ruvector/ruvllm') {
      const up = dirname(dir);
      if (up === dir) throw new Error('package.json for @ruvector/ruvllm not found');
      dir = up;
    }
    const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
    const [major, minor] = version.split('.').map(Number);
    const inRange = (major === 2 && minor >= 6) || major === 3 || (major === 4 && minor >= 1);
    expect(inRange, `@ruvector/ruvllm@${version}`).toBe(true);
  });
});
