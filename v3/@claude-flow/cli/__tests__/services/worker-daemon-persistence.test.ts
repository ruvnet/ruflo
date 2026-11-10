import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkerDaemon } from '../../src/services/worker-daemon.js';
import * as secureFs from '../../src/fs-secure.js';

type DaemonInternals = {
  headlessInitPromise: Promise<void>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  runMapWorker(): Promise<unknown>;
  runAuditWorkerLocal(): Promise<unknown>;
};

let workspace: string;
let daemon: DaemonInternals;
let logFile: string;
const events = ['SIGTERM', 'SIGINT', 'SIGHUP', 'exit', 'uncaughtException', 'unhandledRejection'] as const;
let originalListeners: Map<string, ReturnType<typeof process.listeners>>;

beforeEach(async () => {
  originalListeners = new Map(events.map(event => [event, process.listeners(event)]));
  workspace = mkdtempSync(join(tmpdir(), 'daemon-persistence-'));
  daemon = new WorkerDaemon(workspace, { aiWorkersEnabled: false }) as unknown as DaemonInternals;
  await daemon.headlessInitPromise;
  logFile = join(workspace, '.claude-flow', 'logs', 'daemon.log');
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const event of events) {
    for (const listener of process.listeners(event)) {
      if (!originalListeners.get(event)!.includes(listener)) process.removeListener(event, listener);
    }
  }
  rmSync(workspace, { recursive: true, force: true });
});

describe('worker daemon persistence', () => {
  it('appends complete records while the log is below its limit', () => {
    writeFileSync(logFile, 'earlier\n');
    daemon.log('info', 'later');
    expect(readFileSync(logFile, 'utf8')).toMatch(/^earlier\n\[.+\] \[INFO\] later\n$/);
    expect(existsSync(logFile + '.1')).toBe(false);
  });

  it('rotates at 5 MiB and retains only three previous logs', () => {
    const previous = Buffer.alloc(5 * 1024 * 1024, 'a');
    writeFileSync(logFile, previous);
    writeFileSync(logFile + '.1', 'older');
    writeFileSync(logFile + '.2', 'oldest retained');
    writeFileSync(logFile + '.3', 'discarded');
    daemon.log('warn', 'new generation');
    expect(readFileSync(logFile, 'utf8')).toMatch(/\[WARN\] new generation\n$/);
    expect(readFileSync(logFile + '.1').equals(previous)).toBe(true);
    expect(readFileSync(logFile + '.2', 'utf8')).toBe('older');
    expect(readFileSync(logFile + '.3', 'utf8')).toBe('oldest retained');
    expect(existsSync(logFile + '.4')).toBe(false);
  });

  it('rotates before a multibyte record would cross the limit', () => {
    writeFileSync(logFile, Buffer.alloc(5 * 1024 * 1024 - 100, 'a'));
    daemon.log('info', '界'.repeat(30));
    expect(existsSync(logFile + '.1')).toBe(true);
    expect(readFileSync(logFile, 'utf8')).toContain('界'.repeat(30));
  });

  it.each([
    ['runMapWorker', 'codebase-map.json'],
    ['runAuditWorkerLocal', 'security-audit.json'],
  ] as const)('%s replaces metric JSON through the atomic writer', async (method, filename) => {
    const write = vi.spyOn(secureFs, 'writeFileAtomic');
    const result = await daemon[method]();
    const file = join(workspace, '.claude-flow', 'metrics', filename);
    expect(write).toHaveBeenCalledWith(file, expect.any(Buffer));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(result);
  });

  it('keeps the previous metric report when the atomic writer fails', async () => {
    await daemon.runMapWorker();
    const file = join(workspace, '.claude-flow', 'metrics', 'codebase-map.json');
    const previous = readFileSync(file, 'utf8');
    vi.spyOn(secureFs, 'writeFileAtomic').mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(daemon.runMapWorker()).rejects.toThrow('disk full');
    expect(readFileSync(file, 'utf8')).toBe(previous);
  });
});
