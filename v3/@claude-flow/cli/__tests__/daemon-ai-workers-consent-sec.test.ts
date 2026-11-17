import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { HEADLESS_WORKER_CONFIGS } from '../src/services/headless-worker-executor.js';

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'ruflo-aiw-')); dirs.push(d); return d; };
const aiOn = (dir: string): boolean => new WorkerDaemon(dir, {}).getStatus().config.aiWorkersEnabled;
const cfg = { daemon: { aiWorkers: { enabled: true } } };

describe('AI workers need consent the repository cannot give', () => {
  it('ignores aiWorkers.enabled in a cloned project config (claude-flow.config.json and .claude-flow/config.json)', () => {
    vi.stubEnv('HOME', tmp()); vi.stubEnv('USERPROFILE', tmp()); vi.stubEnv('RUFLO_DAEMON_AI_WORKERS', '');
    const dir = tmp(); mkdirSync(join(dir, '.claude-flow'));
    writeFileSync(join(dir, 'claude-flow.config.json'), JSON.stringify(cfg));
    writeFileSync(join(dir, '.claude-flow', 'config.json'), JSON.stringify(cfg));
    expect(aiOn(dir)).toBe(false);
  });

  it('still honours the explicit option, the env var and the user-level config', () => {
    const home = tmp(); mkdirSync(join(home, '.claude-flow'));
    vi.stubEnv('HOME', home); vi.stubEnv('USERPROFILE', home); vi.stubEnv('RUFLO_DAEMON_AI_WORKERS', '');
    expect(new WorkerDaemon(tmp(), { aiWorkersEnabled: true }).getStatus().config.aiWorkersEnabled).toBe(true);
    vi.stubEnv('RUFLO_DAEMON_AI_WORKERS', '1');
    expect(aiOn(tmp())).toBe(true);
    vi.stubEnv('RUFLO_DAEMON_AI_WORKERS', '');
    writeFileSync(join(home, '.claude-flow', 'config.json'), JSON.stringify(cfg));
    expect(aiOn(tmp())).toBe(true);
  });

  it('never hands .env files to a worker prompt', () => {
    for (const c of Object.values(HEADLESS_WORKER_CONFIGS)) expect(c.contextPatterns ?? []).not.toContainEqual(expect.stringContaining('.env'));
  });
});
