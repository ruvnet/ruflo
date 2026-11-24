/**
 * #1861: `doctor --fix`'s Version Freshness suggestion told users to run
 * `npx -y @claude-flow/cli@latest` (or `npm update @claude-flow/cli`), but
 * users invoke this CLI as `ruflo`, not `@claude-flow/cli`. The registry
 * query itself must stay against `@claude-flow/cli@latest` (#5079 — that's
 * the package whose dist-tags are real), but the fix command shown to the
 * user should match the branding they actually run.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/commands/doctor.ts', import.meta.url)), 'utf-8');

describe('#1861 Version Freshness fix suggestion uses ruflo branding', () => {
  it('suggests the npx-cache-clear fix against ruflo, not @claude-flow/cli', () => {
    expect(source).toContain("'rm -rf ~/.npm/_npx/* && npx -y ruflo@latest'");
    expect(source).not.toContain("npx -y @claude-flow/cli@latest'");
  });

  it('suggests npm update against ruflo, not @claude-flow/cli', () => {
    expect(source).toContain("'npm update ruflo'");
    expect(source).not.toContain("'npm update @claude-flow/cli'");
  });

  it('still queries the registry against @claude-flow/cli@latest (#5079 — unchanged)', () => {
    expect(source).toContain("VERSION_FRESHNESS_QUERY = 'npm view @claude-flow/cli@latest version'");
  });
});
