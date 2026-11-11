// #4954: the neural router (CLAUDE_FLOW_ROUTER_NEURAL=1) loads its bundled KRR, the
// per-tier KRR specialists, the isotonic calibrators and the seed corpus from
// assets/model-router/. None of them were in `files`, so an npm install routed
// differently from a repo checkout. This lists the real tarball contents.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const pkgRoot = resolve(__dirname, '..');

const DEFAULT_PATH_ASSETS = [
  'assets/model-router/seed-router.krr.json',
  'assets/model-router/seed-router.krr.low.json',
  'assets/model-router/seed-router.krr.med.json',
  'assets/model-router/seed-router.krr.high.json',
  'assets/model-router/seed-router.calibrator.json',
  'assets/model-router/seed-router.calibrator.low.json',
  'assets/model-router/seed-router.calibrator.med.json',
  'assets/model-router/seed-router.calibrator.high.json',
  'assets/model-router/seed-rows.json',
  'assets/agent-router/centroids.minilm.json',
];

function packedFiles(): string[] {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: pkgRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(r.status, r.stderr).toBe(0);
  const [entry] = JSON.parse(r.stdout) as Array<{ files: Array<{ path: string }> }>;
  return entry.files.map((f) => f.path);
}

describe('bundled router assets are in the published tarball (#4954)', () => {
  const files = packedFiles();

  it('ships every asset the default neural-router and centroid paths load', () => {
    const missing = DEFAULT_PATH_ASSETS.filter((p) => !files.includes(p));
    expect(missing).toEqual([]);
  });

  it('does not ship files no default path reads', () => {
    // FastGRNN loads only from CLAUDE_FLOW_ROUTER_MODEL_PATH; provenance is documentation.
    expect(files).not.toContain('assets/model-router/seed-router.fastgrnn.safetensors');
    expect(files).not.toContain('assets/model-router/seed-rows.provenance.json');
  });
}, 120_000);
