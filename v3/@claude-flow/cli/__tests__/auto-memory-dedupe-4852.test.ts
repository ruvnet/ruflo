/**
 * Regression for #4852: `read <ns> <key>` refused an ambiguous key with
 * AMBIGUOUS_KEY and no ids, leaving no way to see or repair the duplicates.
 *
 *  (a) the AMBIGUOUS_KEY refusal lists each matching id with createdAt/updatedAt;
 *  (b) read-only `read --all <ns> <key>` and `read-id <id>`;
 *  (c) `dedupe <ns> <key>`: a dry run by default, `--apply` keeps one entry
 *      (newest updatedAt, ties by id, or `--keep <id>`) and touches no other key.
 *
 * Every test runs the real helper as a subprocess in a disposable temp dir,
 * with HOME sandboxed. The memory package is a marker stub that must never load.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
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

const entry = (id: string, key: string, updatedAt: number, extra: Record<string, unknown> = {}) =>
  ({ id, key, namespace: 'auto-memory', content: `content of ${id}`, type: 'semantic', tags: [], metadata: {}, createdAt: 1, updatedAt, ...extra });

// Three copies of "dup" (b2 and b3 tie on updatedAt), one in another namespace, plus other keys.
const STORE = [
  entry('a1', 'other', 5),
  entry('b3', 'dup', 30),
  entry('b1', 'dup', 10, { createdAt: 0 }),
  entry('c1', 'dup', 99, { namespace: 'elsewhere' }),
  entry('b2', 'dup', 30),
  entry('d1', 'another', 7),
];

function setup(source: string) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'ruflo-4852-')));
  tempRoots.push(root);
  const project = join(root, 'project');
  const home = join(root, 'home');
  const hook = join(home, '.claude', 'helpers', 'auto-memory-hook.mjs');
  fs.mkdirSync(dirname(hook), { recursive: true });
  fs.copyFileSync(source, hook);
  const marker = join(home, 'memory-loaded.marker');
  const stub = join(home, 'stub-memory.mjs');
  fs.writeFileSync(stub, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'x'); export class AutoMemoryBridge {}\n`);
  fs.mkdirSync(join(home, '.claude-flow'), { recursive: true });
  fs.writeFileSync(join(home, '.claude-flow', 'memory-package.json'), JSON.stringify({ distPath: stub }));
  const store = join(project, '.claude-flow', 'data', 'auto-memory-store.json');
  fs.mkdirSync(dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify(STORE, null, 2));
  return { root, project, home, hook, store, marker };
}

type Ctx = ReturnType<typeof setup>;
function run(c: Ctx, args: string[]) {
  const r = spawnSync(process.execPath, [c.hook, ...args], {
    cwd: c.project,
    env: { ...process.env, CLAUDE_PROJECT_DIR: c.project, HOME: c.home, USERPROFILE: c.home },
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(r.error).toBeUndefined();
  return { status: r.status, out: JSON.parse(r.stdout) };
}

/** Every file under root with its bytes and mtime, plus every directory. */
function snapshot(root: string) {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) { out[p] = 'dir'; walk(p); } else out[p] = `${fs.readFileSync(p).toString('base64')}@${st.mtimeMs}`;
    }
  };
  walk(root);
  return out;
}

const stored = (c: Ctx) => JSON.parse(fs.readFileSync(c.store, 'utf8')) as ReturnType<typeof entry>[];
const brief = (e: ReturnType<typeof entry>) => ({ id: e.id, createdAt: e.createdAt, updatedAt: e.updatedAt });
const byId = (id: string) => STORE.find((e) => e.id === id)!;

for (const [name, source] of [['package', packageHook], ['repository', dogfoodHook]] as const) {
  describe(`#4852 ${name} helper: inspecting duplicate keys is read-only`, () => {
    it('AMBIGUOUS_KEY lists every matching id with createdAt and updatedAt', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      const r = run(c, ['read', 'auto-memory', 'dup']);
      expect(r.status).toBe(1);
      expect(r.out).toMatchObject({ found: false, entry: null, error: { code: 'AMBIGUOUS_KEY' } });
      expect(r.out.error.matches).toEqual([brief(byId('b3')), brief(byId('b1')), brief(byId('b2'))]);
      expect(r.out.error.message).toMatch(/read --all|dedupe/);
      expect(snapshot(c.root)).toEqual(before);
    });

    it('read --all returns {multiplicity, entries[]} and changes nothing', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      const r = run(c, ['read', '--all', 'auto-memory', 'dup']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ storePresent: true, namespace: 'auto-memory', key: 'dup', multiplicity: 3 });
      expect(r.out.entries).toEqual([byId('b3'), byId('b1'), byId('b2')]);
      expect(r.out.error).toBeUndefined();
      expect(snapshot(c.root)).toEqual(before);
      expect(fs.existsSync(c.marker)).toBe(false);
    });

    it('read --all on an absent key reports multiplicity 0', () => {
      const c = setup(source);
      const r = run(c, ['read', '--all', 'auto-memory', 'nope']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ multiplicity: 0, entries: [] });
    });

    it('read-id returns one entry by id and changes nothing', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      const r = run(c, ['read-id', 'b1']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ storePresent: true, id: 'b1', found: true, entry: byId('b1') });
      expect(snapshot(c.root)).toEqual(before);
      expect(fs.existsSync(c.marker)).toBe(false);
    });

    it('read-id with an unknown id reports found:false and changes nothing', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      const r = run(c, ['read-id', 'zzz']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ id: 'zzz', found: false, entry: null });
      expect(snapshot(c.root)).toEqual(before);
    });

    it('read-id needs an id', () => {
      const c = setup(source);
      const r = run(c, ['read-id']);
      expect(r.status).toBe(1);
      expect(r.out.error.code).toBe('USAGE');
    });
  });

  describe(`#4852 ${name} helper: dedupe`, () => {
    it('a dry run reports the plan (newest updatedAt, ties by id) and changes no byte', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      const r = run(c, ['dedupe', 'auto-memory', 'dup']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ dryRun: true, applied: false, multiplicity: 3 });
      expect(r.out.keep).toEqual(brief(byId('b2')));
      expect(r.out.remove).toEqual([brief(byId('b3')), brief(byId('b1'))]);
      expect(snapshot(c.root)).toEqual(before);
      expect(fs.existsSync(c.marker)).toBe(false);
    });

    it('--apply leaves exactly one entry for the key and keeps every other key byte-for-byte', () => {
      const c = setup(source);
      const r = run(c, ['dedupe', 'auto-memory', 'dup', '--apply']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ dryRun: false, applied: true, multiplicity: 3, keep: brief(byId('b2')) });
      expect(r.out.remove.map((e: { id: string }) => e.id)).toEqual(['b3', 'b1']);
      const after = stored(c);
      expect(after.filter((e) => e.namespace === 'auto-memory' && e.key === 'dup')).toEqual([byId('b2')]);
      // Every entry of every other key (and the same key in another namespace) survives unchanged, in order.
      expect(after).toEqual(STORE.filter((e) => !['b3', 'b1'].includes(e.id)));
      expect(fs.readdirSync(dirname(c.store)).sort()).toEqual(['auto-memory-store.json']); // no temp file or lock left
      // Now unambiguous.
      expect(run(c, ['read', 'auto-memory', 'dup']).out).toMatchObject({ found: true, entry: byId('b2') });
      expect(fs.existsSync(c.marker)).toBe(false);
    });

    it('--keep <id> chooses the survivor, in the dry run and with --apply', () => {
      const c = setup(source);
      const dry = run(c, ['dedupe', 'auto-memory', 'dup', '--keep', 'b1']);
      expect(dry.status).toBe(0);
      expect(dry.out.keep).toEqual(brief(byId('b1')));
      expect(dry.out.remove.map((e: { id: string }) => e.id)).toEqual(['b2', 'b3']); // newest first

      const r = run(c, ['dedupe', '--keep', 'b1', 'auto-memory', 'dup', '--apply']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ applied: true, keep: brief(byId('b1')) });
      expect(stored(c)).toEqual(STORE.filter((e) => !['b3', 'b2'].includes(e.id)));
    });

    it('--keep with an unknown id is refused and the store is untouched', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      for (const extra of [[], ['--apply']]) {
        const r = run(c, ['dedupe', 'auto-memory', 'dup', '--keep', 'nope', ...extra]);
        expect(r.status).toBe(1);
        expect(r.out).toMatchObject({ applied: false, error: { code: 'UNKNOWN_ID' } });
        expect(r.out.error.matches.map((e: { id: string }) => e.id)).toEqual(['b2', 'b3', 'b1']);
      }
      expect(snapshot(c.root)).toEqual(before);
    });

    it('--keep with an id from a different key is refused, so it can never delete across keys', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      const r = run(c, ['dedupe', 'auto-memory', 'dup', '--keep', 'c1', '--apply']);
      expect(r.status).toBe(1);
      expect(r.out.error.code).toBe('UNKNOWN_ID');
      expect(r.out.error.message).toMatch(/does not have namespace/);
      expect(snapshot(c.root)).toEqual(before);
    });

    it('--apply on a key with one entry writes nothing', () => {
      const c = setup(source);
      const before = snapshot(c.root);
      const r = run(c, ['dedupe', 'auto-memory', 'other', '--apply']);
      expect(r.status).toBe(0);
      expect(r.out).toMatchObject({ multiplicity: 1, keep: brief(byId('a1')), remove: [], applied: false });
      expect(snapshot(c.root)).toEqual(before);
    });

    it('refuses a corrupt store without touching it', () => {
      const c = setup(source);
      fs.writeFileSync(c.store, '{broken');
      const before = snapshot(c.root);
      for (const args of [['dedupe', 'auto-memory', 'dup'], ['dedupe', 'auto-memory', 'dup', '--apply'], ['read', '--all', 'auto-memory', 'dup'], ['read-id', 'b1']]) {
        const r = run(c, args);
        expect(r.status).toBe(1);
        expect(r.out.error.code).toBe('STORE_PARSE_FAILED');
      }
      expect(snapshot(c.root)).toEqual(before);
    });

    it('needs a namespace and a key, and a value for --keep', () => {
      const c = setup(source);
      expect(run(c, ['dedupe', 'auto-memory']).out.error.code).toBe('USAGE');
      expect(run(c, ['dedupe', 'auto-memory', 'dup', '--keep']).out.error.code).toBe('USAGE');
      expect(run(c, ['dedupe', 'auto-memory', 'dup', '--keep', '--apply']).out.error.code).toBe('USAGE');
      expect(stored(c)).toEqual(STORE);
    });
  });
}
