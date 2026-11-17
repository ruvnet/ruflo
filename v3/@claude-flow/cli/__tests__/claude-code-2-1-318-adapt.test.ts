/**
 * Claude Code 2.1.290–2.1.318 adaptations:
 *  - 2.1.302: `claude -p` with no permission mode may start in manual mode, so
 *    headless argv gets an explicit `--permission-mode` (default auto).
 *  - 2.1.318: `credential_expires_at` in the `claude -p` JSON result.
 *  - 2.1.295: `onFailure: "block"` on the pre-bash safety gate.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HEADLESS_PERMISSION_MODE,
  headlessPermissionArgs,
  PERMISSION_MODE_ENV,
} from '../src/mods/headless-plugins.js';
import { normalizeCredentialExpiry, parseClaudePrintJsonEnvelope } from '../src/services/headless-worker-executor.js';
import { generateSettings } from '../src/init/settings-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../src/init/types.js';

describe('headlessPermissionArgs (Claude Code 2.1.302)', () => {
  it('adds --permission-mode auto to print-mode argv', () => {
    expect(DEFAULT_HEADLESS_PERMISSION_MODE).toBe('auto');
    expect(headlessPermissionArgs(['-p'], {})).toEqual(['--permission-mode', 'auto']);
    expect(headlessPermissionArgs(['--print', '--output-format', 'json'], {})).toEqual(['--permission-mode', 'auto']);
  });

  it('leaves interactive argv alone', () => {
    expect(headlessPermissionArgs(['--mcp-config=x.json'], {})).toEqual([]);
  });

  it("keeps a caller's own mode or skip flag", () => {
    expect(headlessPermissionArgs(['-p', '--permission-mode', 'plan'], {})).toEqual([]);
    expect(headlessPermissionArgs(['-p', '--permission-mode=plan'], {})).toEqual([]);
    expect(headlessPermissionArgs(['-p', '--dangerously-skip-permissions'], {})).toEqual([]);
  });

  it('honours the env override, none, and ignores an unknown mode', () => {
    expect(headlessPermissionArgs(['-p'], { [PERMISSION_MODE_ENV]: 'acceptEdits' })).toEqual(['--permission-mode', 'acceptEdits']);
    expect(headlessPermissionArgs(['-p'], { [PERMISSION_MODE_ENV]: 'none' })).toEqual([]);
    expect(headlessPermissionArgs(['-p'], { [PERMISSION_MODE_ENV]: '' })).toEqual([]);
    expect(headlessPermissionArgs(['-p'], { [PERMISSION_MODE_ENV]: 'yolo; rm -rf /' })).toEqual(['--permission-mode', 'auto']);
  });
});

describe('credential_expires_at (Claude Code 2.1.318)', () => {
  it('normalises ISO strings and epoch seconds or milliseconds', () => {
    expect(normalizeCredentialExpiry('2026-12-01T00:00:00Z')).toBe('2026-12-01T00:00:00.000Z');
    expect(normalizeCredentialExpiry(1796083200)).toBe('2026-12-01T00:00:00.000Z');
    expect(normalizeCredentialExpiry(1796083200000)).toBe('2026-12-01T00:00:00.000Z');
  });

  it('drops anything that is not a date', () => {
    for (const v of [undefined, null, '', 'soon', -5, 0, NaN, {}, []]) expect(normalizeCredentialExpiry(v)).toBeUndefined();
  });

  it('reads the field from the envelope, and its absence stays absent', () => {
    const withIt = parseClaudePrintJsonEnvelope(JSON.stringify({ result: 'ok', credential_expires_at: '2026-12-01T00:00:00Z' }));
    expect(withIt?.credentialExpiresAt).toBe('2026-12-01T00:00:00.000Z');
    const without = parseClaudePrintJsonEnvelope(JSON.stringify({ result: 'ok' }));
    expect(without?.result).toBe('ok');
    expect(without?.credentialExpiresAt).toBeUndefined();
  });
});

describe('onFailure: block on the pre-bash gate (Claude Code 2.1.295)', () => {
  it('init writes onFailure: block on the PreToolUse Bash hook only', () => {
    const s = generateSettings(DEFAULT_INIT_OPTIONS) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> };
    const bash = s.hooks.PreToolUse.find((m) => m.matcher === 'Bash')!;
    expect(bash.hooks[0]!.onFailure).toBe('block');
    for (const [event, groups] of Object.entries(s.hooks)) {
      if (event === 'PreToolUse') continue;
      for (const g of groups) for (const h of g.hooks) expect(h.onFailure, event).toBeUndefined();
    }
  });
});
