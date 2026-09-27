/** Routing outcome store: project-scoped, hashed prompts, compiled patterns. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_ROUTING_OUTCOMES,
  compileLearnedPatterns,
  extractRoutingKeywords,
  hashPrompt,
  learnedPatternsPath,
  loadRoutingOutcomes,
  routingOutcomesPath,
  saveRoutingOutcomes,
  storableRoutingKeywords,
  toRoutingOutcomeRow,
  type RoutingOutcomeRow,
} from '../src/services/routing-outcome-store.js';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'ruflo-outcomes-')); });
afterEach(() => { rmSync(project, { recursive: true, force: true }); });

const row = (agent: string, words: string, success: boolean, quality = 0.9): RoutingOutcomeRow =>
  toRoutingOutcomeRow({ task: words, agent, success, quality });

describe('routing outcome store', () => {
  it('resolves both files under the project directory', () => {
    expect(routingOutcomesPath(project)).toBe(join(project, '.claude-flow', 'routing-outcomes.json'));
    expect(learnedPatternsPath(project)).toBe(join(project, '.claude-flow', 'learned-patterns.json'));
  });

  it('never keeps prompt text, only a hash and keywords', () => {
    const secret = 'deploy with token sk-live-abc123 to the staging cluster';
    const r = toRoutingOutcomeRow({ task: secret, agent: 'coder', success: true, quality: 0.9 });
    expect(r.task).toBeUndefined();
    expect(r.promptHash).toBe(hashPrompt(secret));
    expect(r.promptHash).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(r.keywords).toEqual(storableRoutingKeywords(secret));
    expect(r.keywords).toEqual(expect.arrayContaining(['deploy', 'token', 'staging', 'cluster']));
    expect(JSON.stringify(r)).not.toMatch(/sk-live|abc123/);
    expect(r.outcome).toBe('success');
    expect(r.source).toBe('mcp');
  });

  it('stores only plain-word keywords (no credential- or id-shaped tokens)', () => {
    const text = 'rotate key AKIAIOSFODNN7EXAMPLE and ghp_abcdefghijklmnopqrstuvwxyz0123 for 550e8400-e29b-41d4-a716 in auth-service';
    const kept = storableRoutingKeywords(text);
    // `_` splits tokens, so a prefix like `ghp` survives; the secret bodies do not.
    expect(kept).toEqual(['rotate', 'key', 'ghp', 'auth-service']);
    expect(kept.join(' ')).not.toMatch(/akia|abcdefghij|550e8400|e29b|a716/);
    expect(storableRoutingKeywords('-xyz- abc- deploy- -build')).toEqual([]);
  });

  it('caps the store and writes atomically (no temp files left)', () => {
    const rows = Array.from({ length: MAX_ROUTING_OUTCOMES + 25 }, (_, i) => row('coder', `task ${i} refactor`, true));
    saveRoutingOutcomes(rows, project);
    expect(loadRoutingOutcomes(routingOutcomesPath(project))).toHaveLength(MAX_ROUTING_OUTCOMES);
    expect(readdirSync(join(project, '.claude-flow')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('compiles learned patterns from labelled successes only', () => {
    const rows: RoutingOutcomeRow[] = [
      ...Array.from({ length: 3 }, () => row('security-auditor', 'audit vulnerability injection scan', true)),
      ...Array.from({ length: 3 }, () => row('tester', 'write unit tests coverage vitest', true)),
      // A hook row: completed, outcome unknown. Counted, never learned from.
      { ...row('coder', 'audit vulnerability injection scan', false), outcome: 'unknown', source: 'hook' },
    ];
    saveRoutingOutcomes(rows, project);
    const compiled = JSON.parse(readFileSync(learnedPatternsPath(project), 'utf-8'));
    expect(compiled.version).toBe(1);
    expect(compiled.outcomes).toBe(7);
    expect(compiled.labelled).toBe(6);
    expect(Object.keys(compiled.patterns).sort()).toEqual(['learned-security-auditor', 'learned-tester']);
    expect(compiled.patterns['learned-security-auditor'].keywords).toContain('vulnerability');
    expect(compiled.patterns['learned-security-auditor'].support).toBe(3);
  });

  it('produces no patterns from unknown or failed outcomes', () => {
    const file = join(project, 'learned.json');
    const compiled = compileLearnedPatterns([
      { ...row('coder', 'fix bug parser', false), outcome: 'unknown' },
      row('coder', 'fix bug parser', false),
    ], file);
    expect(compiled.labelled).toBe(0);
    expect(compiled.patterns).toEqual({});
  });

  it('ignores a missing, malformed or oversized store instead of throwing', () => {
    const file = routingOutcomesPath(project);
    expect(loadRoutingOutcomes(file)).toEqual([]);
    mkdirSync(join(project, '.claude-flow'), { recursive: true });
    writeFileSync(file, '{not json');
    expect(loadRoutingOutcomes(file)).toEqual([]);
    writeFileSync(file, JSON.stringify({ outcomes: [] }) + ' '.repeat(5 * 1024 * 1024 + 1));
    expect(loadRoutingOutcomes(file)).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });
});
