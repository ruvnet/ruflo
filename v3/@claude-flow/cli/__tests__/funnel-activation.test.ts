/**
 * Activation funnel (adoption plan item 3): init_completed, first_agent_run,
 * session_active. All consent-gated; markers survive a queue flush.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  recordInitCompleted,
  recordFirstAgentRun,
  recordSessionActive,
  shouldOfferTelemetry,
} from '../src/funnel/activation.js';
import { recordConsent } from '../src/funnel/index.js';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;
let savedTTY: { out: boolean | undefined; in: boolean | undefined };

const queue = () => {
  const f = path.join(stateDir, 'funnel-events.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const flushQueue = () => fs.rmSync(path.join(stateDir, 'funnel-events.jsonl'), { force: true });

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-activation-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
  for (const k of ['RUFLO_FUNNEL', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE']) delete process.env[k];
  savedTTY = { out: process.stdout.isTTY, in: process.stdin.isTTY };
});

afterEach(() => {
  process.env = savedEnv;
  Object.defineProperty(process.stdout, 'isTTY', { value: savedTTY.out, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: savedTTY.in, configurable: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe('without telemetry consent', () => {
  it('records nothing at all', () => {
    expect(recordInitCompleted('3.73.0')).toBe(false);
    expect(recordFirstAgentRun('3.73.0')).toBe(false);
    expect(recordSessionActive('3.73.0')).toBe(false);
    expect(queue()).toEqual([]);
    expect(fs.existsSync(path.join(stateDir, 'funnel-activation.json'))).toBe(false);
  });
});

describe('with telemetry consent', () => {
  beforeEach(() => { recordConsent('telemetry', true, 'test'); });

  it('records init_completed on the init surface, daily-bucketed', () => {
    expect(recordInitCompleted('3.73.0', new Date('2026-11-06T15:04:05Z'))).toBe(true);
    expect(queue()).toMatchObject([{ event: 'init_completed', surface: 'init', release: '3.73.0', timestampBucket: '2026-11-06' }]);
    expect(JSON.stringify(queue())).not.toMatch(/15:04/);
  });

  it('records first_agent_run once ever, even after the queue is flushed', () => {
    expect(recordFirstAgentRun('3.73.0')).toBe(true);
    flushQueue(); // a successful flush removes sent events from the queue
    expect(recordFirstAgentRun('3.73.0')).toBe(false);
    expect(queue()).toEqual([]);
  });

  it('records session_active at most once per UTC day', () => {
    const d1 = new Date('2026-11-06T01:00:00Z');
    expect(recordSessionActive('3.73.0', d1)).toBe(true);
    expect(recordSessionActive('3.73.0', new Date('2026-11-06T23:00:00Z'))).toBe(false);
    flushQueue();
    expect(recordSessionActive('3.73.0', new Date('2026-11-07T00:30:00Z'))).toBe(true);
    expect(queue()).toMatchObject([{ event: 'session_active', surface: 'cli', timestampBucket: '2026-11-07' }]);
  });
});

describe('shouldOfferTelemetry (one-time init question)', () => {
  const tty = (v: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', { value: v, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: v, configurable: true });
  };

  it('asks in an interactive terminal when no receipt exists', () => {
    tty(true);
    expect(shouldOfferTelemetry({ cwd: stateDir })).toBe(true);
  });

  it('never asks without a TTY, in CI, with the flag, or once answered either way', () => {
    tty(false);
    expect(shouldOfferTelemetry({ cwd: stateDir })).toBe(false);
    tty(true);
    expect(shouldOfferTelemetry({ cwd: stateDir, env: { ...process.env, CI: 'true' } })).toBe(false);
    expect(shouldOfferTelemetry({ cwd: stateDir, noTelemetryPrompt: true })).toBe(false);
    recordConsent('telemetry', false, 'init-prompt');
    expect(shouldOfferTelemetry({ cwd: stateDir })).toBe(false);
  });

  it('never asks when the funnel is disabled', () => {
    tty(true);
    expect(shouldOfferTelemetry({ cwd: stateDir, env: { ...process.env, RUFLO_FUNNEL: '0' } })).toBe(false);
  });
});
