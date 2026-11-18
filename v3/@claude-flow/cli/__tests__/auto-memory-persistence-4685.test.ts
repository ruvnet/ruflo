/**
 * Regression for #4685 (JSON AutoMemory backend persistence):
 * - write and rename failures reject instead of resolving with an in-memory-only update;
 * - only ENOENT means "no store": corrupt, unreadable, malformed or duplicate-id
 *   stores throw and keep their original bytes;
 * - every persist is read back and checked;
 * - import reports success only after a verified readback and exits 1 on failure;
 * - `read <namespace> <key>` is a read-only exact lookup.
 *
 * Every test works in a disposable temp dir; HOME is always a sandbox.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const packageHook = resolve(here, '../.claude/helpers/auto-memory-hook.mjs');
const dogfoodHook = resolve(here, '../../../../.claude/helpers/auto-memory-hook.mjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try { fs.chmodSync(root, 0o700); } catch { /* ignore */ }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ruflo-4685-')));
  tempRoots.push(root);
  return root;
}

type Backend = {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  store(e: Record<string, unknown>): Promise<void>;
  bulkInsert(e: Record<string, unknown>[]): Promise<void>;
  storePresent: boolean;
};

/**
 * Load the helper's real store code (lock, atomic write, strict read, backend)
 * into an isolated VM, with any fs function replaceable. Same seam as the
 * reproduction in the issue.
 */
function loadBackend(overrides: Partial<Record<string, unknown>> = {}) {
  const source = fs.readFileSync(packageHook, 'utf8');
  const span = (from: string, to: string) => {
    const a = source.indexOf(from);
    const b = source.indexOf(to);
    expect(a, from).toBeGreaterThan(-1);
    expect(b, to).toBeGreaterThan(a);
    return source.slice(a, b);
  };
  const core = span('const LOCK_WAIT_MS', '// Claude Code shares');
  const cls = span('class JsonFileBackend', '// Resolve memory package path');
  const ctx = {
    existsSync: fs.existsSync, mkdirSync: fs.mkdirSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync, unlinkSync: fs.unlinkSync, rmdirSync: fs.rmdirSync, rmSync: fs.rmSync, statSync: fs.statSync,
    process, Atomics, SharedArrayBuffer, Int32Array,
    ...overrides,
  };
  return vm.runInNewContext(`${core}\n${cls}\n({ JsonFileBackend, readStoreFile: typeof readStoreFile === 'function' ? readStoreFile : undefined })`, ctx) as {
    JsonFileBackend: new (file: string) => Backend;
    readStoreFile: (file: string) => unknown[] | null;
  };
}

const entry = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, key: id, namespace: 'auto-memory', content: `content of ${id}`, type: 'semantic', tags: [], metadata: {}, createdAt: 1, updatedAt: 1, ...extra });

function snapshot(dir: string) {
  const out: Record<string, { bytes: string; mtimeMs: number } | 'dir'> = {};
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { out[p] = 'dir'; walk(p); } else out[p] = { bytes: fs.readFileSync(p).toString('base64'), mtimeMs: st.mtimeMs };
    }
  };
  walk(dir);
  return out;
}

describe('#4685 JsonFileBackend write failures propagate', () => {
  it('a failed atomic rename rejects store() and leaves no store or temp file', async () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    const { JsonFileBackend } = loadBackend({ renameSync: () => { throw Object.assign(new Error('synthetic EIO'), { code: 'EIO' }); } });
    const backend = new JsonFileBackend(file);
    await backend.initialize();
    await expect(backend.store(entry('one'))).rejects.toThrow(/synthetic EIO/);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a failed rename also rejects bulkInsert() and shutdown()', async () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    const { JsonFileBackend } = loadBackend({ renameSync: () => { throw new Error('synthetic EIO'); } });
    const backend = new JsonFileBackend(file);
    await backend.initialize();
    await expect(backend.bulkInsert([entry('a'), entry('b')])).rejects.toThrow(/synthetic EIO/);
    await expect(backend.shutdown()).rejects.toThrow(/synthetic EIO/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('a readback that does not match what was written rejects', async () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    // The temp file receives different bytes than intended, as a lost write would.
    const lossy = (p: string, text: string, enc: BufferEncoding) => fs.writeFileSync(p, p.endsWith('.tmp') ? '[]' : text, enc);
    const { JsonFileBackend } = loadBackend({ writeFileSync: lossy });
    const backend = new JsonFileBackend(file);
    await backend.initialize();
    await expect(backend.store(entry('one'))).rejects.toMatchObject({ code: 'STORE_READBACK_MISMATCH' });
  });

  it('a readback still holding a deleted entry rejects', async () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    fs.writeFileSync(file, JSON.stringify([entry('keep'), entry('gone')]));
    const original = fs.readFileSync(file, 'utf8');
    // The rename is lost: the old file (still holding "gone") stays in place.
    const { JsonFileBackend } = loadBackend({ renameSync: (tmp: string) => fs.unlinkSync(tmp) });
    const backend = new JsonFileBackend(file) as Backend & { bulkDelete(ids: string[]): Promise<number> };
    await backend.initialize();
    await expect(backend.bulkDelete(['gone'])).rejects.toMatchObject({ code: 'STORE_READBACK_MISMATCH' });
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('a successful store is on disk exactly as stored', async () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    const { JsonFileBackend } = loadBackend();
    const backend = new JsonFileBackend(file);
    await backend.initialize();
    expect(backend.storePresent).toBe(false);
    await backend.store(entry('one'));
    await backend.shutdown();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([entry('one')]);
    expect(fs.readdirSync(dir)).toEqual(['store.json']);
  });
});

describe('#4685 only ENOENT means "no store"; anything else keeps the original bytes', () => {
  const invalid: Array<[string, string, string]> = [
    ['corrupt JSON', '{broken', 'STORE_PARSE_FAILED'],
    ['a non-array document', '{"id":"x"}', 'STORE_NOT_ARRAY'],
    ['a non-object entry', '[1]', 'STORE_BAD_ENTRY'],
    ['an entry without an id', JSON.stringify([{ key: 'k', namespace: 'n' }]), 'STORE_BAD_ID'],
    ['a non-string id', JSON.stringify([{ id: 7, key: 'k' }]), 'STORE_BAD_ID'],
    ['an empty id', JSON.stringify([{ id: '', key: 'k' }]), 'STORE_BAD_ID'],
    ['duplicate ids', JSON.stringify([entry('dup'), entry('dup', { content: 'other' })]), 'STORE_DUPLICATE_ID'],
  ];

  for (const [label, text, code] of invalid) {
    it(`initialize() refuses ${label} and shutdown never overwrites it`, async () => {
      const dir = tempDir();
      const file = join(dir, 'store.json');
      fs.writeFileSync(file, text);
      const before = fs.statSync(file).mtimeMs;
      const { JsonFileBackend } = loadBackend();
      const backend = new JsonFileBackend(file);
      await expect(backend.initialize()).rejects.toMatchObject({ code });
      // A caller that ignored the error and shut down anyway must not write `[]`.
      await expect(backend.shutdown()).rejects.toMatchObject({ code });
      expect(fs.readFileSync(file, 'utf8')).toBe(text);
      expect(fs.statSync(file).mtimeMs).toBe(before);
      expect(fs.readdirSync(dir)).toEqual(['store.json']);
    });
  }

  it('a store corrupted after load is refused at merge time, not overwritten', async () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    fs.writeFileSync(file, JSON.stringify([entry('a')]));
    const { JsonFileBackend } = loadBackend();
    const backend = new JsonFileBackend(file);
    await backend.initialize();
    fs.writeFileSync(file, '{broken');
    await expect(backend.store(entry('b'))).rejects.toMatchObject({ code: 'STORE_PARSE_FAILED' });
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('EACCES on read is an error, not an empty store', async () => {
    const dir = tempDir();
    const file = join(dir, 'store.json');
    fs.writeFileSync(file, JSON.stringify([entry('a')]));
    const original = fs.readFileSync(file, 'utf8');
    const denied = (p: string, ...rest: unknown[]) => {
      if (p === file) throw Object.assign(new Error(`EACCES: permission denied, open '${p}'`), { code: 'EACCES' });
      return (fs.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
    };
    const { JsonFileBackend } = loadBackend({ readFileSync: denied });
    const backend = new JsonFileBackend(file);
    await expect(backend.initialize()).rejects.toMatchObject({ code: 'STORE_READ_FAILED' });
    await expect(backend.store(entry('b'))).rejects.toMatchObject({ code: 'STORE_READ_FAILED' });
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('EACCES from a real unreadable file (non-root only)', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root ignores file modes
    const dir = tempDir();
    const file = join(dir, 'store.json');
    fs.writeFileSync(file, JSON.stringify([entry('a')]));
    fs.chmodSync(file, 0o000);
    const { JsonFileBackend } = loadBackend();
    const backend = new JsonFileBackend(file);
    await expect(backend.initialize()).rejects.toMatchObject({ code: 'STORE_READ_FAILED' });
    fs.chmodSync(file, 0o600);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([entry('a')]);
  });

  it('a missing file is an empty store', async () => {
    const dir = tempDir();
    const { readStoreFile } = loadBackend();
    expect(readStoreFile(join(dir, 'absent.json'))).toBeNull();
  });
});

// ── CLI-level behaviour, through the real helper file ────────────────────────

/** Installs the helper at <home>/.claude/helpers plus a stub memory package whose bridge behaves as told. */
function installHook(source: string, bridgeBody: string) {
  const root = tempDir();
  const project = join(root, 'project');
  const home = join(root, 'home');
  fs.mkdirSync(project, { recursive: true });
  const hook = join(home, '.claude', 'helpers', 'auto-memory-hook.mjs');
  fs.mkdirSync(dirname(hook), { recursive: true });
  fs.copyFileSync(source, hook);
  const mock = join(home, 'mock-memory.mjs');
  fs.writeFileSync(mock, `
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./memory-loaded.marker', import.meta.url), 'loaded');
export class AutoMemoryBridge extends EventEmitter {
  constructor(backend, config) { super(); this.backend = backend; this.config = config; }
  async importFromAutoMemory() { ${bridgeBody} }
  async syncToAutoMemory() { return { synced: 0, categories: [] }; }
  async curateIndex() {}
}
`);
  fs.mkdirSync(join(home, '.claude-flow'), { recursive: true });
  fs.writeFileSync(join(home, '.claude-flow', 'memory-package.json'), JSON.stringify({ distPath: mock }));
  return { root, project, home, hook, marker: join(home, 'memory-loaded.marker') };
}

function runHook(hook: string, project: string, home: string, args: string[]) {
  const r = spawnSync(process.execPath, [hook, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(r.error).toBeUndefined();
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const STORE_ONE = `const e = { id: 'imp-1', key: 'auto-memory:MEMORY.md:Heading', namespace: 'auto-memory', content: 'hello', type: 'semantic', tags: [], metadata: {}, createdAt: 1, updatedAt: 1 };
  await this.backend.store(e); return { imported: 1, skipped: 0, deleted: 0, files: ['MEMORY.md'], durationMs: 0 };`;

describe('#4685 import reports success only after a verified readback', () => {
  for (const [name, source] of [['package', packageHook], ['repository', dogfoodHook]] as const) {
    it(`${name} helper: a valid import exits 0 and the entry is on disk`, () => {
      const { project, home, hook } = installHook(source, STORE_ONE);
      const r = runHook(hook, project, home, ['import']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Imported 1 entries');
      expect(r.stdout).toContain('verified');
      const store = JSON.parse(fs.readFileSync(join(project, '.claude-flow', 'data', 'auto-memory-store.json'), 'utf8'));
      expect(store.map((e: { id: string }) => e.id)).toEqual(['imp-1']);
    });

    it(`${name} helper: a failed write exits 1 (not 0, not 2) and never prints "Imported"`, () => {
      // The bridge hands the backend an entry it cannot store.
      const { project, home, hook } = installHook(source, `await this.backend.store({ key: 'no-id', namespace: 'auto-memory', content: 'x' }); return { imported: 1, skipped: 0 };`);
      const r = runHook(hook, project, home, ['import']);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('Imported');
      expect(r.stderr).toMatch(/\[AutoMemory\] Import failed/);
    });
  }

  it('an unwritable data directory fails the import with exit 1 (non-root only)', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const { project, home, hook } = installHook(packageHook, STORE_ONE);
    const data = join(project, '.claude-flow', 'data');
    fs.mkdirSync(data, { recursive: true });
    fs.chmodSync(data, 0o555);
    try {
      const r = runHook(hook, project, home, ['import']);
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain('Imported');
      expect(r.stderr).toMatch(/Import failed/);
    } finally {
      fs.chmodSync(data, 0o755);
    }
    expect(fs.existsSync(join(data, 'auto-memory-store.json'))).toBe(false);
  });

  it('a corrupt store fails the import with exit 1 and keeps its bytes', () => {
    const { project, home, hook } = installHook(packageHook, STORE_ONE);
    const file = join(project, '.claude-flow', 'data', 'auto-memory-store.json');
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, '{broken');
    const r = runHook(hook, project, home, ['import']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not valid JSON');
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('a source file the bridge could not read fails the import, but what was imported stays persisted', () => {
    const { project, home, hook } = installHook(packageHook, `this.emit('import:file-error', { file: 'broken.md', reason: 'read-failed' }); ${STORE_ONE}`);
    const r = runHook(hook, project, home, ['import']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('broken.md');
    expect(r.stdout).not.toContain('Imported');
    const store = JSON.parse(fs.readFileSync(join(project, '.claude-flow', 'data', 'auto-memory-store.json'), 'utf8'));
    expect(store.map((e: { id: string }) => e.id)).toEqual(['imp-1']);
  });
});

describe('#4685 read <namespace> <key> is a read-only exact lookup', () => {
  it('returns the entry and changes no byte, mtime, lock or directory', () => {
    const { root, project, home, hook, marker } = installHook(packageHook, 'throw new Error("must not run")');
    const file = join(project, '.claude-flow', 'data', 'auto-memory-store.json');
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([entry('a', { key: 'k1' }), entry('b', { key: 'k2' }), entry('c', { key: 'k1', namespace: 'other' })]));
    const before = snapshot(root);
    const r = runHook(hook, project, home, ['read', 'auto-memory', 'k1']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toEqual({ schemaVersion: 1, store: file, storePresent: true, namespace: 'auto-memory', key: 'k1', found: true, entry: entry('a', { key: 'k1' }) });
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(marker)).toBe(false); // the memory package was never loaded
  });

  it('reports an absent store without creating any directory', () => {
    const { root, project, home, hook, marker } = installHook(packageHook, 'throw new Error("must not run")');
    const before = snapshot(root);
    const r = runHook(hook, project, home, ['read', 'auto-memory', 'k1']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ schemaVersion: 1, storePresent: false, namespace: 'auto-memory', key: 'k1', found: false, entry: null });
    expect(fs.existsSync(join(project, '.claude-flow'))).toBe(false);
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('reports a present store with no match as found:false', () => {
    const { project, home, hook } = installHook(packageHook, 'throw new Error("must not run")');
    const file = join(project, '.claude-flow', 'data', 'auto-memory-store.json');
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([entry('a')]));
    const out = JSON.parse(runHook(hook, project, home, ['read', 'auto-memory', 'missing']).stdout);
    expect(out).toMatchObject({ storePresent: true, found: false, entry: null });
  });

  it('refuses an ambiguous key', () => {
    const { root, project, home, hook } = installHook(packageHook, 'throw new Error("must not run")');
    const file = join(project, '.claude-flow', 'data', 'auto-memory-store.json');
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([entry('a', { key: 'same' }), entry('b', { key: 'same' })]));
    const before = snapshot(root);
    const r = runHook(hook, project, home, ['read', 'auto-memory', 'same']);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ found: false, entry: null, error: { code: 'AMBIGUOUS_KEY' } });
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses a corrupt store without touching it', () => {
    const { root, project, home, hook } = installHook(packageHook, 'throw new Error("must not run")');
    const file = join(project, '.claude-flow', 'data', 'auto-memory-store.json');
    fs.mkdirSync(dirname(file), { recursive: true });
    fs.writeFileSync(file, '{broken');
    const before = snapshot(root);
    const r = runHook(hook, project, home, ['read', 'auto-memory', 'k']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ storePresent: true, found: false, error: { code: 'STORE_PARSE_FAILED' } });
    expect(snapshot(root)).toEqual(before);
  });

  it('requires both a namespace and a key', () => {
    const { project, home, hook } = installHook(packageHook, 'throw new Error("must not run")');
    const r = runHook(hook, project, home, ['read', 'auto-memory']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe('USAGE');
  });
});

describe('#4685 helper copies stay identical', () => {
  it('the repository helper is byte-identical to the packaged helper', () => {
    expect(fs.readFileSync(dogfoodHook).equals(fs.readFileSync(packageHook))).toBe(true);
  });
});
