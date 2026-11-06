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
 *
 * Skipped only when no @ruvector/ruvllm directory is installed between this
 * package and the repo root. A directory that exists but does not load (as
 * 4.0.x does not, having no CommonJS entry) fails.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const requireCjs = createRequire(import.meta.url);
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

function installedDir(): string | null {
  let dir = join(__dirname, '..', '..');
  for (;;) {
    const candidate = join(dir, 'node_modules', '@ruvector', 'ruvllm');
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === REPO_ROOT || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}
const INSTALLED = installedDir();

/** require() the package, naming the installed copy when it does not load. */
function loadRuvllm(): Record<string, any> {
  try {
    return requireCjs('@ruvector/ruvllm');
  } catch (err) {
    const pkg = INSTALLED ? JSON.parse(readFileSync(join(INSTALLED, 'package.json'), 'utf8')) : {};
    throw new Error(`@ruvector/ruvllm@${pkg.version ?? '?'} at ${INSTALLED} does not load via require(): ${(err as Error).message}`);
  }
}

describe.skipIf(!INSTALLED)('@ruvector/ruvllm runtime contract', () => {
  it('loads through CommonJS require and exports the runtime classes', () => {
    const ruvllm = loadRuvllm();
    for (const symbol of ['SonaCoordinator', 'ContrastiveTrainer', 'TrainingPipeline', 'LoraAdapter']) {
      expect(typeof ruvllm[symbol], `@ruvector/ruvllm.${symbol}`).toBe('function');
    }
  });

  it('constructs a SonaCoordinator the way the CLI does', () => {
    const ruvllm = loadRuvllm();
    const coordinator = new ruvllm.SonaCoordinator(ruvllm.DEFAULT_SONA_CONFIG);
    expect(coordinator).toBeTruthy();
  });

  it('resolves a version inside the declared range (^4.1.0)', () => {
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
    const inRange = major === 4 && minor >= 1;
    expect(inRange, `@ruvector/ruvllm@${version}`).toBe(true);
  });
});
