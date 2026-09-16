/**
 * SONAAdapter Test Suite
 *
 * Covers sonaModeFromEnv() / RUFLO_INTELLIGENCE_MODE precedence and timing,
 * since this module previously had no dedicated test coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SONAAdapter, sonaModeFromEnv } from '../sona-adapter.js';

const ENV_KEY = 'RUFLO_INTELLIGENCE_MODE';

describe('sonaModeFromEnv', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it('returns undefined when unset', () => {
    delete process.env[ENV_KEY];
    expect(sonaModeFromEnv()).toBeUndefined();
  });

  it('returns the mode for a recognised value', () => {
    process.env[ENV_KEY] = 'research';
    expect(sonaModeFromEnv()).toBe('research');
  });

  it('trims whitespace around the value', () => {
    process.env[ENV_KEY] = '  edge  ';
    expect(sonaModeFromEnv()).toBe('edge');
  });

  it('returns undefined for an unrecognised value (never silently picks a mode)', () => {
    process.env[ENV_KEY] = 'not-a-real-mode';
    expect(sonaModeFromEnv()).toBeUndefined();
  });

  it('is re-read fresh on every call, not cached at module load', () => {
    delete process.env[ENV_KEY];
    expect(sonaModeFromEnv()).toBeUndefined();

    process.env[ENV_KEY] = 'batch';
    expect(sonaModeFromEnv()).toBe('batch');
  });
});

describe('SONAAdapter mode resolution', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it('falls back to balanced when RUFLO_INTELLIGENCE_MODE is unset', () => {
    delete process.env[ENV_KEY];
    const adapter = new SONAAdapter();
    expect(adapter.getMode()).toBe('balanced');
  });

  it('picks up RUFLO_INTELLIGENCE_MODE when no explicit mode is passed', () => {
    process.env[ENV_KEY] = 'research';
    const adapter = new SONAAdapter();
    expect(adapter.getMode()).toBe('research');
  });

  it('an explicit config.mode wins over RUFLO_INTELLIGENCE_MODE', () => {
    process.env[ENV_KEY] = 'research';
    const adapter = new SONAAdapter({ mode: 'edge' });
    expect(adapter.getMode()).toBe('edge');
  });

  it('reads RUFLO_INTELLIGENCE_MODE freshly on each construction', () => {
    delete process.env[ENV_KEY];
    const before = new SONAAdapter();
    expect(before.getMode()).toBe('balanced');

    process.env[ENV_KEY] = 'edge';
    const after = new SONAAdapter();
    expect(after.getMode()).toBe('edge');
  });
});
