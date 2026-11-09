/**
 * Regression guard: the published dependency ranges must not admit versions
 * with known advisories. Each row is (field, package, versions that must be
 * rejected, versions that must be admitted).
 *
 * Ranges are restricted to `^X.Y.Z` alternatives joined by `||`, so the check
 * below is exact without pulling semver into the package.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as Record<
  string,
  Record<string, string> | undefined
>;

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

const rows: Array<[field: string, name: string, advisory: string, rejected: string[], admitted: string[]]> = [
  ['dependencies', 'zod', 'GHSA-mrhx-c7xc-m3w5', ['3.22.4', '3.25.76', '4.6.5'], ['4.6.7']],
];

describe('advisory-free dependency ranges', () => {
  for (const [field, name, advisory, rejected, admitted] of rows) {
    const range = manifest[field]?.[name];

    it(`${field}.${name} is declared`, () => {
      expect(range).toBeTypeOf('string');
    });

    for (const v of rejected) {
      it(`${field}.${name} rejects ${v} (${advisory})`, () => {
        expect(satisfies(v, range!)).toBe(false);
      });
    }

    for (const v of admitted) {
      it(`${field}.${name} admits ${v}`, () => {
        expect(satisfies(v, range!)).toBe(true);
      });
    }
  }
});
