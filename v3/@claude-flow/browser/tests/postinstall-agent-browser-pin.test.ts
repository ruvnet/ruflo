import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

describe('postinstall agent-browser install', () => {
  const postinstall: string = pkg.scripts.postinstall;

  it('never installs an unpinned agent-browser@latest', () => {
    expect(postinstall).not.toMatch(/agent-browser@latest/);
  });

  it('installs the same agent-browser range the package depends on', () => {
    expect(pkg.dependencies['agent-browser']).toBeTruthy();
    expect(postinstall).toContain("require('./package.json').dependencies['agent-browser']");
    expect(postinstall).toContain("'npm install -g agent-browser@'+v");
  });
});
