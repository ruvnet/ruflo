/**
 * The startup update checker must never run code from the working directory.
 *
 * getInstalledVersion() used to resolve `<pkg>/package.json` with
 * `paths: [process.cwd()]` and load it with require(). A package's `exports`
 * map can point `./package.json` at a .js file, so a node_modules folder
 * committed to a cloned repository ran inside the CLI on any command.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getInstalledVersion } from '../src/update/checker.js';

describe('getInstalledVersion ignores packages planted in the working directory', () => {
  let root: string;
  let marker: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    root = mkdtempSync(join(tmpdir(), 'ruflo-update-hijack-'));
    marker = join(root, 'PWNED');
    for (const name of ['@claude-flow/security', '@claude-flow/embeddings', '@claude-flow/cli']) {
      const dir = join(root, 'node_modules', ...name.split('/'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name, version: '9.9.9', exports: { './package.json': './evil.cjs' },
      }));
      writeFileSync(join(dir, 'evil.cjs'),
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = { version: '6.6.6' };`);
    }
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['@claude-flow/security', '@claude-flow/embeddings', '@claude-flow/cli'])(
    'does not execute or report a planted %s', (name) => {
      const version = getInstalledVersion(name);
      expect(existsSync(marker)).toBe(false);
      expect(version).not.toBe('6.6.6');
      expect(version).not.toBe('9.9.9');
    });

  it('still reports the running CLI version', () => {
    expect(getInstalledVersion('@claude-flow/cli')).toMatch(/^\d+\.\d+\.\d+/);
  });
});
