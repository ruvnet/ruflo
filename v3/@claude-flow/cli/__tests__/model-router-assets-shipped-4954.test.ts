// #4954: the neural router (CLAUDE_FLOW_ROUTER_NEURAL=1) loads its bundled KRR, the
// per-tier KRR specialists, the isotonic calibrators and the seed corpus from
// assets/model-router/. None of them were in `files`, so an npm install routed
// differently from a repo checkout. This checks each default-path asset exists
// and is matched by a `files` entry. It reads package.json instead of spawning
// `npm pack`, which crashed under CI's parallel test run.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkgRoot = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8')) as { files: string[] };

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

// npm `files` semantics for the shapes used here: an entry is a file, a
// directory (everything under it), or a pattern whose `*` matches within one
// path segment. Negated entries are applied after the positive ones.
function toRegExp(entry: string): RegExp {
  const body = entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${body}(/.*)?$`);
}

function shipped(path: string): boolean {
  const include = pkg.files.filter((f) => !f.startsWith('!')).some((f) => toRegExp(f).test(path));
  const exclude = pkg.files.filter((f) => f.startsWith('!')).some((f) => toRegExp(f.slice(1)).test(path));
  return include && !exclude;
}

describe('bundled router assets are in the published tarball (#4954)', () => {
  it('every default-path asset exists in the package', () => {
    expect(DEFAULT_PATH_ASSETS.filter((p) => !existsSync(resolve(pkgRoot, p)))).toEqual([]);
  });

  it('every default-path asset is matched by a `files` entry', () => {
    expect(DEFAULT_PATH_ASSETS.filter((p) => !shipped(p))).toEqual([]);
  });

  it('does not ship files no default path reads', () => {
    // FastGRNN loads only from CLAUDE_FLOW_ROUTER_MODEL_PATH; provenance is documentation.
    expect(shipped('assets/model-router/seed-router.fastgrnn.safetensors')).toBe(false);
    expect(shipped('assets/model-router/seed-rows.provenance.json')).toBe(false);
  });
});
