/**
 * Regression for #4851: the SessionStart import runs auto-memory-hook.mjs
 * directly, and the hook only found @claude-flow/memory through the sidecar
 * written by init / upgrade / doctor. A fresh worktree has no sidecar
 * (.claude-flow/ is gitignored), so imports were DISABLED there.
 *
 * The hook now resolves the package itself when the sidecar is missing or
 * stale, verifies the AutoMemoryBridge export, and records the sidecar so the
 * next run is fast. When nothing resolves, the warning names what it searched.
 *
 * Mock-first: the "memory package" is a stub module in a temp dir. No network.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageHook = resolve(here, '../.claude/helpers/auto-memory-hook.mjs');
const dogfoodHook = resolve(here, '../../../../.claude/helpers/auto-memory-hook.mjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const write = (file: string, text: string) => {
  fs.mkdirSync(dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** A stub @claude-flow/memory whose bridge stores one entry on import. */
const STUB_BRIDGE = `export class AutoMemoryBridge {
  constructor(backend) { this.backend = backend; }
  async importFromAutoMemory() {
    await this.backend.store({ id: 'stub-1', key: 'stub', namespace: 'auto-memory', content: 'x', type: 'semantic', tags: [], metadata: {}, createdAt: 1, updatedAt: 1 });
    return { imported: 1, skipped: 0 };
  }
}
`;

function plantMemoryPackage(pkgDir: string, body = STUB_BRIDGE): string {
  write(join(pkgDir, 'package.json'), JSON.stringify({ name: '@claude-flow/memory', version: '9.9.9-stub', type: 'module', main: 'dist/index.js', exports: { '.': './dist/index.js' } }));
  const dist = join(pkgDir, 'dist', 'index.js');
  write(dist, body);
  return fs.realpathSync(dist);
}

function plantPackage(dir: string, name: string) {
  write(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }));
}

/** A project with the hook installed the way init does, and no sidecar. */
function project(source: string) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ruflo-4851-')));
  tempRoots.push(root);
  const dir = join(root, 'project');
  const home = join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  write(join(dir, 'package.json'), JSON.stringify({ name: 'repro-4851', version: '1.0.0' }));
  const hook = join(dir, '.claude', 'helpers', 'auto-memory-hook.mjs');
  write(hook, fs.readFileSync(source, 'utf8'));
  return { root, dir, home, hook, sidecar: join(dir, '.claude-flow', 'memory-package.json') };
}

function run(hook: string, cwd: string, home: string, cmd: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: cwd };
  delete env.NODE_PATH; // pnpm's vitest shim would otherwise expose the workspace package
  const r = spawnSync(process.execPath, [hook, cmd], { cwd, env, encoding: 'utf8', timeout: 20_000 });
  expect(r.error).toBeUndefined();
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const readSidecar = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

for (const [name, source] of [['package', packageHook], ['repository', dogfoodHook]] as const) {
  describe(`#4851 ${name} helper resolves @claude-flow/memory without a sidecar`, () => {
    it('fresh worktree: no sidecar, package resolvable from the project → import works and the sidecar is written', () => {
      const p = project(source);
      const dist = plantMemoryPackage(join(p.dir, 'node_modules', '@claude-flow', 'memory'));
      expect(fs.existsSync(p.sidecar)).toBe(false);

      const r = run(p.hook, p.dir, p.home, 'import');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Imported 1 entries');
      expect(r.stdout).not.toContain('DISABLED');
      expect(readSidecar(p.sidecar)).toMatchObject({ distPath: dist, version: '9.9.9-stub', resolvedBy: 'auto-memory-hook' });

      // The second run takes the sidecar and leaves it untouched.
      const before = fs.readFileSync(p.sidecar, 'utf8');
      expect(run(p.hook, p.dir, p.home, 'import').stdout).toContain('Imported 1 entries');
      expect(fs.readFileSync(p.sidecar, 'utf8')).toBe(before);
    });

    it("finds the package in the CLI's own node_modules, as recordMemoryPackagePath does", () => {
      const p = project(source);
      const cli = join(p.dir, 'node_modules', 'ruflo', 'node_modules', '@claude-flow', 'cli');
      plantPackage(join(p.dir, 'node_modules', 'ruflo'), 'ruflo');
      plantPackage(cli, '@claude-flow/cli');
      const dist = plantMemoryPackage(join(cli, 'node_modules', '@claude-flow', 'memory'));

      const r = run(p.hook, p.dir, p.home, 'import');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Imported 1 entries');
      expect(readSidecar(p.sidecar).distPath).toBe(dist);
    });

    it("fresh git worktree: uses the main checkout's sidecar and records its own", () => {
      const p = project(source);
      const dist = plantMemoryPackage(join(p.root, 'elsewhere', '@claude-flow', 'memory'));
      write(join(p.dir, '.gitignore'), '.claude-flow/\n');
      const git = (...args: string[]) => execFileSync('git', args, { cwd: p.dir, stdio: 'ignore', env: { ...process.env, HOME: p.home, GIT_CONFIG_NOSYSTEM: '1' } });
      git('init', '-q', '-b', 'main');
      git('add', '.');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
      write(p.sidecar, JSON.stringify({ distPath: dist, resolvedBy: 'init' }));
      const wt = join(p.root, 'wt');
      git('worktree', 'add', '-q', wt);
      const wtHook = join(wt, '.claude', 'helpers', 'auto-memory-hook.mjs');
      const wtSidecar = join(wt, '.claude-flow', 'memory-package.json');
      expect(fs.existsSync(wtSidecar)).toBe(false);

      const r = run(wtHook, wt, p.home, 'import');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Imported 1 entries');
      expect(readSidecar(wtSidecar).distPath).toBe(dist);
    });

    it('stale sidecar (missing file) → re-resolved and rewritten', () => {
      const p = project(source);
      const dist = plantMemoryPackage(join(p.dir, 'node_modules', '@claude-flow', 'memory'));
      write(p.sidecar, JSON.stringify({ distPath: join(p.root, 'gone', 'dist', 'index.js'), resolvedBy: 'init' }));

      const r = run(p.hook, p.dir, p.home, 'import');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Imported 1 entries');
      expect(readSidecar(p.sidecar)).toMatchObject({ distPath: dist, resolvedBy: 'auto-memory-hook' });
    });

    it('stale sidecar (module without AutoMemoryBridge) → re-resolved and rewritten', () => {
      const p = project(source);
      const dist = plantMemoryPackage(join(p.dir, 'node_modules', '@claude-flow', 'memory'));
      const wrong = plantMemoryPackage(join(p.root, 'old', 'memory'), 'export const somethingElse = 1;\n');
      write(p.sidecar, JSON.stringify({ distPath: wrong, resolvedBy: 'init' }));

      const r = run(p.hook, p.dir, p.home, 'import');
      expect(r.stdout).toContain('Imported 1 entries');
      expect(readSidecar(p.sidecar).distPath).toBe(dist);
    });

    it('nothing resolvable → the disabled warning names every place searched, and no sidecar is written', () => {
      const p = project(source);
      const wrong = plantMemoryPackage(join(p.root, 'old', 'memory'), 'export const somethingElse = 1;\n');
      write(p.sidecar, JSON.stringify({ distPath: wrong }));

      const r = run(p.hook, p.dir, p.home, 'import');
      expect(r.status).toBe(1); // #4963: loud and a failure, so the hook runner can see nothing was imported
      expect(r.stdout).toContain('self-learning imports are DISABLED');
      expect(r.stdout).toContain('npm i -D @claude-flow/memory');
      expect(r.stdout).toContain('Searched:');
      expect(r.stdout).toContain(`sidecar ${p.sidecar}: ${wrong} has no AutoMemoryBridge export`);
      expect(r.stdout).toContain(`require.resolve from ${p.dir}: not found`);
      expect(r.stdout).toContain(`require.resolve from ${join(p.dir, '.claude', 'helpers')}: not found`);
      expect(r.stdout).toContain(`@claude-flow/cli dependencies from ${p.dir}: not found`);
      expect(r.stderr).toContain('Searched:');
      expect(run(p.hook, p.dir, p.home, 'sync').status).toBe(1); // #4963: sync fails the same way
      expect(readSidecar(p.sidecar)).toEqual({ distPath: wrong }); // left as it was
      expect(fs.existsSync(join(p.dir, '.claude-flow', 'data', 'auto-memory-store.json'))).toBe(false);
    });

    it('status reports the resolution but never writes the sidecar', () => {
      const p = project(source);
      plantMemoryPackage(join(p.dir, 'node_modules', '@claude-flow', 'memory'));
      const r = run(p.hook, p.dir, p.home, 'status');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Package:        ✅ Available');
      expect(r.stdout).toContain('Resolved via:   project-root');
      expect(fs.existsSync(p.sidecar)).toBe(false);
    });
  });
}
