/**
 * progress_sync (ruvnet/ruflo#4767).
 *
 * The tool reads the real repo to compute progress, and writes its metrics to
 * the repo root, which is fixed at module load (not read from CLAUDE_FLOW_CWD).
 * Writes are captured here so the test never touches the real repo. This lives
 * in its own file because the fs mock would break store-backed tests elsewhere.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, writeFileSync: vi.fn() };
});

import { writeFileSync } from 'fs';
import { join } from 'path';
import { progressTools } from '../src/mcp-tools/progress-tools.js';

const progressSync = progressTools.find((t) => t.name === 'progress_sync');

describe('progress_sync', () => {
  it('returns the progress and persists the metrics file', async () => {
    const result = await progressSync!.handler({});

    expect(typeof result.progress).toBe('number');
    expect(result.persisted).toBe(true);
    expect(result.message).toBe(`Progress synced: ${result.progress}%`);
    expect(typeof result.lastUpdated).toBe('string');

    const written = vi.mocked(writeFileSync).mock.calls.find(([path]) =>
      String(path).endsWith(join('.claude-flow', 'metrics', 'v3-progress.json')),
    );
    expect(written).toBeDefined();
    expect(JSON.parse(String(written![1]))).toMatchObject({ source: 'V3ProgressService' });
  }, 120_000);
});
