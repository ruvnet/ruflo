/**
 * #5079: Version Freshness asked npm for the `alpha` dist-tag, which is frozen
 * (ADR-513), so every release after it reported "up to date". It must query
 * `latest`, the tag its own fix advice installs. The federation fix advice had
 * the same frozen-tag problem.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION_FRESHNESS_QUERY } from '../src/commands/doctor.js';

const source = readFileSync(fileURLToPath(new URL('../src/commands/doctor.ts', import.meta.url)), 'utf-8');

describe('#5079 doctor compares against the latest dist-tag', () => {
  it('queries @claude-flow/cli@latest', () => {
    expect(VERSION_FRESHNESS_QUERY).toBe('npm view @claude-flow/cli@latest version');
  });

  it('never queries or installs a frozen alpha tag', () => {
    expect(source).not.toMatch(/@claude-flow\/[\w-]+@(alpha|v3alpha)\b/);
  });
});
