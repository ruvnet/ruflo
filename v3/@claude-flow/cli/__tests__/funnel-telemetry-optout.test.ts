/**
 * ADR-309 operational telemetry + ADR-302/305 opt-in telemetry.
 *
 *  - `ruflo funnel disable` (and every other opt-out source) stops the
 *    SessionStart `hooks refresh-funnel` network call, not just the promo row.
 *  - The messages fetch identifies only the release and OS/CPU family.
 *  - `ruflo funnel telemetry on|off` is the only way to grant the telemetry
 *    consent domain; off (and `funnel disable`) revoke it and delete the ID.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const requestSpy = vi.hoisted(() => vi.fn());
vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>();
  return { ...actual, request: requestSpy, default: { ...actual, request: requestSpy } };
});

import { hooksCommand } from '../src/commands/hooks.js';
import { funnelCommand } from '../src/commands/funnel.js';
import { funnelUserAgent, getFunnelId, hasConsent, launchSurface } from '../src/funnel/index.js';
import type { CommandContext } from '../src/types.js';

const sub = (cmd: typeof hooksCommand, name: string) => {
  const found = cmd.subcommands?.find((c) => c.name === name);
  if (!found?.action) throw new Error(`missing subcommand ${name}`);
  return found.action;
};
const ctx = (args: string[] = [], flags: Record<string, unknown> = {}): CommandContext =>
  ({ args, flags: { quiet: true, ...flags }, cwd: process.cwd(), interactive: false }) as CommandContext;

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-telemetry-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
  for (const k of ['RUFLO_FUNNEL', 'RUFLO_FUNNEL_MESSAGES', 'RUFLO_ENTERPRISE_POLICY', 'CI', 'GITHUB_ACTIONS']) delete process.env[k];
  requestSpy.mockReset();
  // Any request that does get made fails fast (no real network in tests).
  requestSpy.mockImplementation((_opts: unknown, _cb: unknown) => {
    const handlers: Record<string, (e?: unknown) => void> = {};
    const req = {
      on: (ev: string, fn: (e?: unknown) => void) => { handlers[ev] = fn; return req; },
      setTimeout: () => req,
      write: () => true,
      end: () => { queueMicrotask(() => handlers.error?.(new Error('offline'))); },
      destroy: () => undefined,
    };
    return req;
  });
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe('refresh-funnel honors every opt-out (ADR-309)', () => {
  it('makes the messages request when the funnel is on', async () => {
    await sub(hooksCommand, 'refresh-funnel')(ctx());
    expect(requestSpy).toHaveBeenCalledTimes(1);
    const opts = requestSpy.mock.calls[0][0] as { hostname: string; headers: Record<string, string> };
    expect(opts.hostname).toBe('funnel.ruv.io');
    expect(opts.headers['User-Agent']).toMatch(/^ruflo-funnel\/messages ruflo\/\S+ \(\w+; \w+\)$/);
  });

  it('makes no request after `ruflo funnel disable`', async () => {
    await sub(funnelCommand, 'disable')(ctx());
    const res = await sub(hooksCommand, 'refresh-funnel')(ctx());
    expect(requestSpy).not.toHaveBeenCalled();
    expect(res.data).toMatchObject({ refreshed: false, skipped: 'funnel-disabled', decidedBy: 'user-config' });
  });

  it('makes no request when RUFLO_FUNNEL=0', async () => {
    process.env.RUFLO_FUNNEL = '0';
    await sub(hooksCommand, 'refresh-funnel')(ctx());
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('makes no request when the project config disables the funnel', async () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-proj-'));
    const cwd = process.cwd();
    try {
      fs.mkdirSync(path.join(proj, '.claude-flow'), { recursive: true });
      fs.writeFileSync(path.join(proj, '.claude-flow', 'config.json'), JSON.stringify({ funnel: { enabled: false } }));
      fs.writeFileSync(path.join(proj, 'claude-flow.config.json'), JSON.stringify({ funnel: { enabled: false } }));
      process.chdir(proj);
      const res = await sub(hooksCommand, 'refresh-funnel')(ctx());
      expect(requestSpy).not.toHaveBeenCalled();
      expect(res.data).toMatchObject({ skipped: 'funnel-disabled', decidedBy: 'project-config' });
    } finally {
      process.chdir(cwd);
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });
});

describe('funnelUserAgent — release + OS family only', () => {
  it('carries version, platform and arch and nothing else', () => {
    expect(funnelUserAgent('3.72.3', 'linux', 'x64', undefined)).toBe('ruflo-funnel/messages ruflo/3.72.3 (linux; x64)');
  });

  it('appends surface/plugin when the ruflo-core plugin launched the CLI', () => {
    expect(funnelUserAgent('3.72.3', 'linux', 'x64', 'plugin')).toBe('ruflo-funnel/messages ruflo/3.72.3 (linux; x64) surface/plugin');
  });

  it('only names surfaces from the closed allowlist', () => {
    expect(launchSurface({ RUFLO_LAUNCH_SURFACE: 'plugin' })).toBe('plugin');
    expect(launchSurface({ RUFLO_LAUNCH_SURFACE: 'plugin\r\nX-Evil: 1' })).toBeUndefined();
    expect(launchSurface({ RUFLO_LAUNCH_SURFACE: 'my-host-name' })).toBeUndefined();
    expect(launchSurface({})).toBeUndefined();
  });

  it('strips anything that is not a token character', () => {
    const ua = funnelUserAgent('1.0.0\r\nX-Evil: 1', 'darwin (beta)', 'arm64;');
    expect(ua).toBe('ruflo-funnel/messages ruflo/1.0.0X-Evil1 (darwinbeta; arm64)');
    expect(ua).not.toMatch(/[\r\n]/);
  });
});

describe('funnel telemetry on|off (ADR-302 telemetry domain)', () => {
  it('is off by default and creates no ID', () => {
    expect(hasConsent('telemetry')).toBe(false);
    expect(getFunnelId()).toBeNull();
  });

  it('on grants consent and creates the pseudonymous ID; off revokes and deletes it', async () => {
    const on = await sub(funnelCommand, 'telemetry')(ctx(['on']));
    expect(on.success).toBe(true);
    expect(hasConsent('telemetry')).toBe(true);
    expect(getFunnelId()).toMatch(/^[0-9a-f-]{36}$/);

    await sub(funnelCommand, 'telemetry')(ctx(['off']));
    expect(hasConsent('telemetry')).toBe(false);
    expect(getFunnelId()).toBeNull();
    expect(fs.existsSync(path.join(stateDir, 'funnel-id.json'))).toBe(false);
  });

  it('funnel disable also revokes telemetry consent', async () => {
    await sub(funnelCommand, 'telemetry')(ctx(['on']));
    await sub(funnelCommand, 'disable')(ctx());
    expect(hasConsent('telemetry')).toBe(false);
  });

  it('refresh-funnel flushes queued events only with consent', async () => {
    await sub(hooksCommand, 'refresh-funnel')(ctx());
    expect(requestSpy).toHaveBeenCalledTimes(1); // messages only

    requestSpy.mockClear();
    await sub(funnelCommand, 'telemetry')(ctx(['on']));
    fs.writeFileSync(
      path.join(stateDir, 'funnel-events.jsonl'),
      JSON.stringify({ event: 'promo_impression', surface: 'statusline', release: '3.72.3', timestampBucket: '2026-11-06' }) + '\n',
    );
    const res = await sub(hooksCommand, 'refresh-funnel')(ctx());
    const hosts = requestSpy.mock.calls.map((c) => `${(c[0] as { method: string }).method} ${(c[0] as { path: string }).path}`);
    expect(hosts).toEqual(['GET /v1/messages', 'POST /v1/events']);
    expect((res.data as { events?: unknown }).events).toBeDefined();
  });

  it('rejects an unknown option', async () => {
    const res = await sub(funnelCommand, 'telemetry')(ctx(['maybe']));
    expect(res.success).toBe(false);
  });
});
