/**
 * #5079: Version Freshness asked npm for the `alpha` dist-tag, which is frozen
 * (ADR-513), so every release after it reported "up to date". It must query
 * `latest`, the tag its own fix advice installs. The federation fix advice had
 * the same frozen-tag problem.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_FRESHNESS_QUERY } from '../src/commands/doctor.js';

// doctor's checks live in commands/doctor-checks/ (#4773)
const commandsDir = fileURLToPath(new URL('../src/commands/', import.meta.url));
const checksDir = join(commandsDir, 'doctor-checks');
const source = [
  join(commandsDir, 'doctor.ts'),
  ...readdirSync(checksDir).filter(f => f.endsWith('.ts')).map(f => join(checksDir, f)),
].map(f => readFileSync(f, 'utf-8')).join('\n');

describe('#5079 doctor compares against the latest dist-tag', () => {
  it('queries @claude-flow/cli@latest', () => {
    expect(VERSION_FRESHNESS_QUERY).toBe('npm view @claude-flow/cli@latest version');
  });

  it('never queries or installs a frozen alpha tag', () => {
    expect(source).not.toMatch(/@claude-flow\/[\w-]+@(alpha|v3alpha)\b/);
  });
});
