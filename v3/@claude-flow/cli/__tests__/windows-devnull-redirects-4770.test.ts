/** #4770: `2>/dev/null` in an execSync string fails under cmd.exe on Windows. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGitUncommittedCount } from '../src/funnel/local-signals.js';

describe('#4770 no /dev/null redirects', () => {
  for (const file of ['commands/init.ts', 'commands/analyze.ts', 'commands/security.ts', 'appliance/rvfa-builder.ts']) {
    it(`${file} does not redirect stderr to /dev/null`, () => {
      const src = readFileSync(join(__dirname, '../src', file), 'utf-8');
      expect(src).not.toMatch(/2>\s*\/dev\/null/);
    });
  }

  it('getGitUncommittedCount returns a number in a git checkout', () => {
    // Was always undefined on Windows.
    expect(getGitUncommittedCount()).toBeTypeOf('number');
  });
});
