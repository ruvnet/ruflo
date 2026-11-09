/**
 * Regression guard: the published peer/dependency ranges must not admit
 * versions with known advisories.
 *
 * - agentic-flow <= 2.0.13: GHSA-vcv2-r9jh-99m5 (OS command injection in
 *   MCP server tools), first patched in 2.0.14. 1.0.6 declared
 *   `>=2.0.12-fix.8 <4.0.0`, which admitted 2.0.12-fix.8, 2.0.12 and 2.0.13.
 * - ws >= 8.0.0 < 8.21.0: GHSA-96hv-2xvq-fx4p (memory exhaustion DoS).
 *
 * The ranges are restricted to `^X.Y.Z` alternatives joined by `||`, so the
 * check below is exact without pulling semver into the plugin.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, '..', '..', 'package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};

type Version = { major: number; minor: number; patch: number; pre: boolean };

function parse(v: string): Version {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(v);
  if (!m) throw new Error(`not a version: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] !== undefined };
}

function cmp(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Caret semantics for X >= 1: same major, >= floor, no prereleases. */
function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split('||').some((part) => {
    const m = /^\s*\^(\d+\.\d+\.\d+)\s*$/.exec(part);
    if (!m) throw new Error(`unsupported range form: ${part.trim()}`);
    const floor = parse(m[1]);
    return !v.pre && v.major === floor.major && floor.major >= 1 && cmp(v, floor) >= 0;
  });
}

describe('advisory-free dependency ranges', () => {
  const agenticFlow = manifest.peerDependencies['agentic-flow'];

  it.each(['2.0.12-fix.8', '2.0.12', '2.0.13', '2.0.11', '1.10.2'])(
    'agentic-flow peer rejects vulnerable %s (GHSA-vcv2-r9jh-99m5)',
    (v) => {
      expect(satisfies(v, agenticFlow)).toBe(false);
    },
  );

  it.each(['2.0.14', '2.1.5', '3.0.0', '3.4.1'])(
    'agentic-flow peer admits patched %s',
    (v) => {
      expect(satisfies(v, agenticFlow)).toBe(true);
    },
  );

  it('agentic-flow peer does not reach the next major', () => {
    expect(satisfies('4.0.0', agenticFlow)).toBe(false);
  });

  it.each(['8.20.0', '8.20.1'])('ws rejects vulnerable %s (GHSA-96hv-2xvq-fx4p)', (v) => {
    expect(satisfies(v, manifest.dependencies.ws)).toBe(false);
  });

  it('ws admits 8.21.0', () => {
    expect(satisfies('8.21.0', manifest.dependencies.ws)).toBe(true);
  });
});
