import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { withMemoryDbLock } from '../src/memory/memory-initializer.js';

let root: string;
let dbPath: string;
let lockFile: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-db-lock-4738-'));
  dbPath = path.join(root, 'memory.db');
  lockFile = `${dbPath}.lock`;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  fs.rmSync(root, { recursive: true, force: true });
});

function ageLock(file = lockFile, ageMs = 60_000): void {
  const old = new Date(Date.now() - ageMs);
  fs.utimesSync(file, old, old);
}

async function currentOwner(): Promise<Record<string, unknown>> {
  let content = '';
  await withMemoryDbLock(dbPath, () => { content = fs.readFileSync(lockFile, 'utf8'); });
  return JSON.parse(content);
}

async function expectRecovery(): Promise<void> {
  vi.useFakeTimers();
  const result = withMemoryDbLock(dbPath, () => 'recovered').catch((error) => error);
  await vi.advanceTimersByTimeAsync(15_100);
  expect(await result).toBe('recovered');
}

describe('memory.db lock ownership (#4738)', () => {
  it.each(['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM'])('uses exclusive creation when hard links fail with %s', async (code) => {
    const originalLink = fs.linkSync;
    vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      if (to === lockFile) throw Object.assign(new Error('not supported'), { code });
      return originalLink(from, to);
    });
    syncBuiltinESMExports();
    await expect(withMemoryDbLock(dbPath, () => {
      expect(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid).toBe(process.pid);
      return 'written';
    })).resolves.toBe('written');
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('does not steal an aged lock from an independent live caller', async () => {
    let release!: () => void;
    const held = withMemoryDbLock(dbPath, () => new Promise<void>((resolve) => { release = resolve; }));
    ageLock(lockFile, 360_000);
    let entered = false;
    const contender = withMemoryDbLock(dbPath, () => { entered = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(entered).toBe(false);
    } finally {
      release();
      await Promise.all([held, contender]);
    }
    expect(entered).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('refreshes an owned lock during a long operation', async () => {
    vi.useFakeTimers();
    await withMemoryDbLock(dbPath, async () => {
      const before = fs.statSync(lockFile).mtimeMs;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fs.statSync(lockFile).mtimeMs).toBeGreaterThan(before + 1_000);
    });
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('does not refresh or remove a replacement lock owned by the same process', async () => {
    vi.useFakeTimers();
    const replacement = JSON.stringify({ pid: process.pid, token: 'another-acquisition' });
    await withMemoryDbLock(dbPath, async () => {
      fs.unlinkSync(lockFile);
      fs.writeFileSync(lockFile, replacement);
      const before = fs.statSync(lockFile).mtimeMs;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fs.statSync(lockFile).mtimeMs).toBe(before);
    });
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(replacement);
  });

  it.each(['incomplete owner', '999999999'])('preserves an aged lock whose owner cannot be identified: %s', async (content) => {
    vi.useFakeTimers();
    fs.writeFileSync(lockFile, content);
    ageLock();
    let entered = false;
    const result = withMemoryDbLock(dbPath, () => { entered = true; }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect((await result as Error).message).toMatch(/timed out acquiring memory.db lock/);
    expect(entered).toBe(false);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(content);
  });

  it.each(['host', 'platform', 'pidns', 'boot'])('does not probe a PID from a different %s', async (field) => {
    let content = '';
    await withMemoryDbLock(dbPath, () => { content = fs.readFileSync(lockFile, 'utf8'); });
    const owner = { ...JSON.parse(content), pid: 999999999, [field]: 'foreign-identity' };
    fs.writeFileSync(lockFile, JSON.stringify(owner));
    ageLock();
    vi.useFakeTimers();
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(JSON.stringify(owner));
  });

  it.each(['', '999999999', 'incomplete owner'])('recovers an expired legacy or incomplete owner: %j', async (content) => {
    fs.writeFileSync(lockFile, content);
    ageLock(lockFile, 360_000);
    await expectRecovery();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each(['host', 'platform', 'pidns', 'boot'])('recovers an expired owner after %s identity drift', async (field) => {
    const owner = { ...await currentOwner(), [field]: 'old-identity' };
    fs.writeFileSync(lockFile, JSON.stringify(owner));
    ageLock(lockFile, 360_000);
    await expectRecovery();
  });

  it.each(['', '12345', 'unknown-owner'])('recovers an expired reclaim guard: %j', async (content) => {
    fs.writeFileSync(lockFile, 'old owner');
    fs.writeFileSync(`${lockFile}.reclaim`, content);
    ageLock(lockFile, 360_000);
    ageLock(`${lockFile}.reclaim`, 360_000);
    await expectRecovery();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('preserves an expired reclaim guard with a verifiably live owner', async () => {
    const owner = JSON.stringify(await currentOwner());
    fs.writeFileSync(lockFile, 'old owner');
    fs.writeFileSync(`${lockFile}.reclaim`, owner);
    ageLock(lockFile, 360_000);
    ageLock(`${lockFile}.reclaim`, 360_000);
    vi.useFakeTimers();
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect(fs.readFileSync(`${lockFile}.reclaim`, 'utf8')).toBe(owner);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe('old owner');
  });

  it('cleans an expired guard left after a reclaimer already removed the main lock', async () => {
    fs.writeFileSync(`${lockFile}.reclaim`, 'crashed guard');
    ageLock(`${lockFile}.reclaim`, 360_000);
    await withMemoryDbLock(dbPath, () => {});
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('refreshes the actual lock inode when exclusive creation replaces hard links', async () => {
    vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('not supported'), { code: 'EPERM' });
    });
    syncBuiltinESMExports();
    vi.useFakeTimers();
    await withMemoryDbLock(dbPath, async () => {
      const before = fs.statSync(lockFile).mtimeMs;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fs.statSync(lockFile).mtimeMs).toBeGreaterThan(before + 1_000);
    });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('recovers an expired owner and guard on a filesystem without hard links', async () => {
    vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' });
    });
    syncBuiltinESMExports();
    fs.writeFileSync(lockFile, 'old owner');
    fs.writeFileSync(`${lockFile}.reclaim`, 'old guard');
    ageLock(lockFile, 360_000);
    ageLock(`${lockFile}.reclaim`, 360_000);
    await expectRecovery();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('removes only expired orphan candidate files and preserves fresh or live candidates', async () => {
    const liveOwner = await currentOwner();
    const orphan = `${lockFile}.11111111-1111-4111-8111-111111111111.tmp`;
    const fresh = `${lockFile}.22222222-2222-4222-8222-222222222222.tmp`;
    const live = `${lockFile}.33333333-3333-4333-8333-333333333333.tmp`;
    const unrelated = `${lockFile}.user-backup.tmp`;
    fs.writeFileSync(orphan, '');
    fs.writeFileSync(fresh, '');
    fs.writeFileSync(live, JSON.stringify(liveOwner));
    fs.writeFileSync(unrelated, '');
    for (const file of [orphan, live, unrelated]) ageLock(file, 360_000);
    await withMemoryDbLock(dbPath, () => {});
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

  it('does not treat a permission error probing the owner as a dead process', async () => {
    let content = '';
    await withMemoryDbLock(dbPath, () => { content = fs.readFileSync(lockFile, 'utf8'); });
    vi.useFakeTimers();
    const owner = JSON.stringify({ ...JSON.parse(content), pid: 12345 });
    fs.writeFileSync(lockFile, owner);
    ageLock(lockFile, 360_000);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
    });
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect((await result as Error).message).toMatch(/timed out acquiring memory.db lock/);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(owner);
  });

  it('preserves an expired guard when its scoped owner cannot be probed due to permissions', async () => {
    const owner = JSON.stringify({ ...await currentOwner(), pid: 12345 });
    fs.writeFileSync(lockFile, 'expired owner');
    fs.writeFileSync(`${lockFile}.reclaim`, owner);
    ageLock(lockFile, 360_000);
    ageLock(`${lockFile}.reclaim`, 360_000);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
    });
    vi.useFakeTimers();
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect(fs.readFileSync(`${lockFile}.reclaim`, 'utf8')).toBe(owner);
  });

  it('preserves a successor published before the reclaim guard is acquired', async () => {
    const live = await currentOwner();
    const previous = JSON.stringify({ ...live, pid: 999999999 });
    const successor = JSON.stringify({ ...live, token: 'successor' });
    fs.writeFileSync(lockFile, previous);
    ageLock();
    const link = fs.linkSync;
    let replaced = false;
    vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      if (to === `${lockFile}.reclaim` && !replaced) {
        replaced = true;
        fs.unlinkSync(lockFile);
        fs.writeFileSync(lockFile, successor);
      }
      return link(from, to);
    });
    syncBuiltinESMExports();
    vi.useFakeTimers();
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(successor);
  });

  it('does not reclaim through a replaced guard or remove the replacement guard', async () => {
    const live = await currentOwner();
    fs.writeFileSync(lockFile, JSON.stringify({ ...live, pid: 999999999 }));
    ageLock();
    const guardOwner = JSON.stringify({ ...live, token: 'replacement-reclaimer' });
    const link = fs.linkSync;
    vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      link(from, to);
      if (to === `${lockFile}.reclaim`) {
        fs.unlinkSync(to);
        fs.writeFileSync(to, guardOwner);
      }
    });
    syncBuiltinESMExports();
    vi.useFakeTimers();
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect(fs.readFileSync(`${lockFile}.reclaim`, 'utf8')).toBe(guardOwner);
    expect(fs.existsSync(lockFile)).toBe(true);
  });

  it('keeps concurrent callers exclusive without hard links', async () => {
    vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' });
    });
    syncBuiltinESMExports();
    let release!: () => void;
    let inside = 0;
    let overlap = false;
    const first = withMemoryDbLock(dbPath, async () => {
      inside++;
      await new Promise<void>((resolve) => { release = resolve; });
      inside--;
    });
    const second = withMemoryDbLock(dbPath, () => { overlap = inside > 0; });
    release();
    await Promise.all([first, second]);
    expect(overlap).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each([false, true])('cleans a failed exclusive owner write without removing a replacement: %s', async (replace) => {
    const link = fs.linkSync;
    const open = fs.openSync;
    const write = fs.writeFileSync;
    let directFd: number | undefined;
    vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      if (to === lockFile) throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' });
      return link(from, to);
    });
    vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      const fd = open(...args);
      if (args[0] === lockFile && args[1] === 'wx') directFd = fd;
      return fd;
    });
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (typeof file === 'number' && file === directFd) {
        if (replace) {
          fs.unlinkSync(lockFile);
          write(lockFile, 'replacement');
        }
        throw failure;
      }
      return write(file, ...args);
    });
    syncBuiltinESMExports();
    let entered = false;
    await expect(withMemoryDbLock(dbPath, () => { entered = true; })).rejects.toBe(failure);
    expect(entered).toBe(false);
    if (replace) {
      expect(fs.readFileSync(lockFile, 'utf8')).toBe('replacement');
      expect(fs.readdirSync(root)).toEqual([path.basename(lockFile)]);
    } else {
      expect(fs.readdirSync(root)).toEqual([]);
    }
  });

  it('does not publish an empty lock if the owner write is interrupted', async () => {
    const moduleUrl = new URL('../src/memory/memory-initializer.ts', import.meta.url).href;
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const pauseOwnerWrite = (fd, data) => {
        if (typeof fd === 'number' && typeof data === 'string'
          && (data === String(process.pid) || data.includes('"pid":' + process.pid))) {
          process.send('writing-owner');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
          throw new Error('owner write was not interrupted');
        }
      };
      for (const name of ['writeFileSync', 'writeSync']) {
        const original = fs[name];
        fs[name] = (...args) => { pauseOwnerWrite(...args); return original(...args); };
      }
      syncBuiltinESMExports();
      const { withMemoryDbLock } = await import(${JSON.stringify(moduleUrl)});
      await withMemoryDbLock(${JSON.stringify(dbPath)}, () => {});
    `;
    const child = spawn(process.execPath, ['--import', loader, '--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr!.on('data', (data) => { stderr += data; });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`writer exited ${code}: ${stderr}`)));
      });
      expect(fs.existsSync(lockFile)).toBe(false);
    } finally {
      child.kill('SIGKILL');
      await exited;
    }
    await expectRecovery();
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('keeps a slow child process exclusive even while its event loop cannot refresh the lock', async () => {
    const inside = path.join(root, 'inside');
    const release = path.join(root, 'release');
    const moduleUrl = new URL('../src/memory/memory-initializer.ts', import.meta.url).href;
    const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    const script = `
      import * as fs from 'node:fs';
      import { withMemoryDbLock } from ${JSON.stringify(moduleUrl)};
      await withMemoryDbLock(${JSON.stringify(dbPath)}, () => {
        fs.writeFileSync(${JSON.stringify(inside)}, 'held');
        process.send('locked');
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(${JSON.stringify(release)})) {
          if (Date.now() > deadline) throw new Error('parent did not release holder');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
        fs.unlinkSync(${JSON.stringify(inside)});
      });
      process.disconnect();
    `;
    const child = spawn(process.execPath, ['--import', loader, '--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr!.on('data', (data) => { stderr += data; });
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    const ready = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('message', () => resolve());
      child.once('exit', (code) => reject(new Error(`holder exited ${code}: ${stderr}`)));
    });
    let contender: Promise<void> | undefined;
    let overlap = false;
    try {
      await ready;
      ageLock();
      contender = withMemoryDbLock(dbPath, () => { overlap = fs.existsSync(inside); });
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      fs.writeFileSync(release, 'release');
      const code = await exited;
      await contender;
      expect(code, stderr).toBe(0);
    }
    expect(overlap).toBe(false);
    expect(fs.existsSync(lockFile)).toBe(false);
  });
});
