/**
 * #4735: LocalReasoningBank.flushToDisk() wrote its whole in-memory list,
 * erasing patterns added by another process. A corrupt patterns.json was also
 * ignored and then overwritten. Flushes now merge under the cooperating-writer
 * lock, carry tombstones, and quarantine corrupt files.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'patterns-merge-4735-'));
const patternsPath = join(scratch, '.claude-flow', 'neural', 'patterns.json');
let originalCwd: string;

function pattern(id: string, content: string) {
  const now = Date.now();
  return {
    id,
    type: 'test',
    embedding: [0.1, 0.2, 0.3],
    content,
    confidence: 0.8,
    usageCount: 0,
    createdAt: now,
    lastUsedAt: now,
  };
}

beforeAll(() => {
  originalCwd = process.cwd();
  process.chdir(scratch);
  mkdirSync(join(scratch, '.claude-flow'), { recursive: true });
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(scratch, { recursive: true, force: true });
});

beforeEach(async () => {
  const intel = await import('../src/memory/intelligence.js');
  intel.clearIntelligence();
  rmSync(patternsPath, { force: true });
  rmSync(dirname(patternsPath), { recursive: true, force: true });
  await intel.initializeIntelligence();
});

describe('LocalReasoningBank cross-process pattern persistence (#4735)', () => {
  it('keeps a pattern written by another process during flush', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const bank = intel.getReasoningBank()!;

    bank.store({ ...pattern('local-a', 'local pattern A') });
    mkdirSync(dirname(patternsPath), { recursive: true });
    writeFileSync(patternsPath, JSON.stringify([pattern('external-b', 'external pattern B')]));

    bank.flushToDisk();

    const ids = JSON.parse(readFileSync(patternsPath, 'utf-8')).map((p: { id: string }) => p.id);
    expect(ids).toContain('local-a');
    expect(ids).toContain('external-b');
  });

  it('does not resurrect a locally deleted pattern from disk', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const bank = intel.getReasoningBank()!;

    bank.store({ ...pattern('local-a', 'local pattern A') });
    bank.flushToDisk();

    mkdirSync(dirname(patternsPath), { recursive: true });
    writeFileSync(patternsPath, JSON.stringify([
      pattern('local-a', 'local pattern A'),
      pattern('external-b', 'external pattern B'),
    ]));

    bank.delete('local-a');
    bank.flushToDisk();

    const ids = JSON.parse(readFileSync(patternsPath, 'utf-8')).map((p: { id: string }) => p.id);
    expect(ids).toEqual(['external-b']);
  });

  it('preserves a corrupt patterns file instead of overwriting it', async () => {
    const intel = await import('../src/memory/intelligence.js');
    mkdirSync(dirname(patternsPath), { recursive: true });
    writeFileSync(patternsPath, '{broken');

    intel.clearIntelligence();
    await intel.initializeIntelligence();
    const freshBank = intel.getReasoningBank()!;
    freshBank.store({ ...pattern('after-corrupt', 'new pattern') });
    freshBank.flushToDisk();

    const corruptFiles = readdirSync(dirname(patternsPath)).filter(name => name.includes('.corrupt-'));
    expect(corruptFiles.length).toBeGreaterThan(0);
    expect(readFileSync(join(dirname(patternsPath), corruptFiles[0]), 'utf-8')).toBe('{broken');
    expect(JSON.parse(readFileSync(patternsPath, 'utf-8')).map((p: { id: string }) => p.id))
      .toContain('after-corrupt');
  });
});
