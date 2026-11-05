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

function ageLock(): void {
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockFile, old, old);
}

describe('memory.db lock ownership (#4738)', () => {
  it('explains unsupported hard links and cleans up without running the operation', async () => {
    const originalLink = fs.linkSync;
    vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      if (to === lockFile) throw Object.assign(new Error('not supported'), { code: 'EOPNOTSUPP' });
      return originalLink(from, to);
    });
    syncBuiltinESMExports();
    let entered = false;
    await expect(withMemoryDbLock(dbPath, () => { entered = true; })).rejects.toThrow(/requires.*hard.link.*filesystem/i);
    expect(entered).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('does not steal an aged lock from an independent live caller', async () => {
    let release!: () => void;
    const held = withMemoryDbLock(dbPath, () => new Promise<void>((resolve) => { release = resolve; }));
    ageLock();
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

  it('fails closed with an actionable error when a crashed reclaimer left its guard', async () => {
    let content = '';
    await withMemoryDbLock(dbPath, () => { content = fs.readFileSync(lockFile, 'utf8'); });
    const owner = JSON.stringify({ ...JSON.parse(content), pid: 999999999 });
    fs.writeFileSync(lockFile, owner);
    fs.writeFileSync(`${lockFile}.reclaim`, owner);
    ageLock();
    vi.useFakeTimers();
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect((await result as Error).message).toContain(`${lockFile}.reclaim`);
    expect((await result as Error).message).toMatch(/inspect.*owner.*reclamation/i);
    expect(fs.readFileSync(`${lockFile}.reclaim`, 'utf8')).toBe(owner);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(owner);
  });

  it('does not treat a permission error probing the owner as a dead process', async () => {
    let content = '';
    await withMemoryDbLock(dbPath, () => { content = fs.readFileSync(lockFile, 'utf8'); });
    vi.useFakeTimers();
    const owner = JSON.stringify({ ...JSON.parse(content), pid: 12345 });
    fs.writeFileSync(lockFile, owner);
    ageLock();
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
    });
    const result = withMemoryDbLock(dbPath, () => 'unsafe').catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(await result).toBeInstanceOf(Error);
    expect((await result as Error).message).toMatch(/timed out acquiring memory.db lock/);
    expect(fs.readFileSync(lockFile, 'utf8')).toBe(owner);
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
    await expect(withMemoryDbLock(dbPath, () => 'recovered')).resolves.toBe('recovered');
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
