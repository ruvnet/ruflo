/**
 * ADR-509 §2.2 fix pass — the scan reads what the engine loads: the hooks.json
 * `modules` list (resolved against hooks.json) and every relative import they
 * reach, whatever the file's name, directory or size. A loaded file that cannot
 * be scanned is a high finding, never skipped. Each fixture below gave no
 * finding at all before (negative controls (a)–(c) from the review).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanPluginDir } from '../src/plugins/marketplace-trust/scan.js';

let tmp: string;
const write = (rel: string, text: string) => {
  mkdirSync(join(tmp, rel, '..'), { recursive: true });
  writeFileSync(join(tmp, rel), text);
};
const high = () => scanPluginDir('p', join(tmp, 'p')).filter((f) => f.severity === 'high').map((f) => `${f.file}:${f.rule}`);
const modules = (...m: string[]) => write('p/hooks/hooks.json', JSON.stringify({ modules: m }));
const CP = "import { spawn } from 'node:child_process'\nexport const run = () => spawn('sh')\n";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'adr509-mods-'));
  write('p/.claude-plugin/plugin.json', '{"name":"p"}');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('ADR-509 scan follows hooks.json modules and their imports', () => {
  it('(a) a listed module outside hooks/', () => {
    modules('../lib/entry.ts');
    write('p/lib/entry.ts', CP);
    expect(high()).toEqual(['lib/entry.ts:module-child-process']);
  });

  it('(b) a listed module named like a test, and one inside tests/', () => {
    modules('./x.test.ts', './tests/y.ts');
    write('p/hooks/x.test.ts', CP);
    write('p/hooks/tests/y.ts', "require('child_process')");
    expect(high().sort()).toEqual(['hooks/tests/y.ts:module-child-process', 'hooks/x.test.ts:module-child-process']);
  });

  it('(c) a listed module over the size limit is unscannable, not skipped', () => {
    modules('./big.ts');
    write('p/hooks/big.ts', `${CP}//${'x'.repeat(1024 * 1024 + 10)}`);
    expect(high()).toEqual(['hooks/big.ts:unscannable']);
  });

  it('follows relative imports from a listed module (import, export from, import(), require, .js→.ts, index)', () => {
    modules('./register.ts');
    write('p/hooks/register.ts', "import './a.js'\nexport { b } from '../src/b'\nconst c = await import('../src/c')\nconst d = require('../src/d')\n");
    write('p/hooks/a.ts', CP);
    write('p/src/b/index.ts', CP);
    write('p/src/c.mjs', 'eval("1")');
    write('p/src/d.cjs', "require('child_process')");
    expect(high().sort()).toEqual(['hooks/a.ts:module-child-process', 'src/b/index.ts:module-child-process', 'src/c.mjs:module-dynamic-code', 'src/d.cjs:module-child-process']);
  });

  it('a type-only import loads nothing; an import cycle terminates', () => {
    modules('./register.ts');
    write('p/hooks/register.ts', "import type { T } from '../types'\nimport { x } from './loop'\n");
    write('p/hooks/loop.ts', "import { y } from './register'\nexport const x = 1\n");
    expect(scanPluginDir('p', join(tmp, 'p'))).toEqual([]);
  });

  it('a missing listed module, a module outside the plugin and a computed import are high', () => {
    modules('./gone.ts', '../../elsewhere.ts', './dyn.ts');
    write('elsewhere.ts', 'export {}');
    write('p/hooks/dyn.ts', "const name = 'child' + '_process'\nconst m = await import(name)\n");
    expect(high().sort()).toEqual(['../elsewhere.ts:module-outside-plugin', 'hooks/dyn.ts:module-computed-import', 'hooks/gone.ts:unscannable']);
  });

  it("ruflo's own mod plugins still scan with no high finding (a high one would block ruflo mods install)", () => {
    const plugins = join(__dirname, '..', '..', '..', '..', 'plugins');
    for (const name of ['ruflo-mods', 'ruflo-swarm', 'ruflo-console']) {
      expect(scanPluginDir(name, join(plugins, name)).filter((f) => f.severity === 'high')).toEqual([]);
    }
  });
});
