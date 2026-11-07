import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ projectRoot: '', vectorDbOptions: [] as Record<string, unknown>[] }));

vi.mock('../src/mcp-tools/types.js', () => ({
  getProjectCwd: () => state.projectRoot,
}));

vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('module')>();
  return {
    ...actual,
    createRequire: (url: string) => {
      const originalRequire = actual.createRequire(url);
      return (id: string) => id === '@ruvector/router'
        ? {
            DistanceMetric: { Cosine: 'Cosine' },
            VectorDb: class {
              constructor(options: Record<string, unknown>) {
                state.vectorDbOptions.push(options);
              }
              insert(): void {}
              search(): unknown[] { return []; }
            },
          }
        : originalRequire(id);
    },
  };
});

import { resetSemanticRouterForTests, routeTaskForBench } from '../src/mcp-tools/hooks-tools.js';

let projectRoot: string;
let originalMemoryPath: string | undefined;

beforeEach(() => {
  originalMemoryPath = process.env.CLAUDE_FLOW_MEMORY_PATH;
  delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  projectRoot = mkdtempSync(join(tmpdir(), 'ruflo-router-db-'));
  state.projectRoot = projectRoot;
  state.vectorDbOptions.length = 0;
  resetSemanticRouterForTests();
});

afterEach(() => {
  if (originalMemoryPath === undefined) {
    delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  } else {
    process.env.CLAUDE_FLOW_MEMORY_PATH = originalMemoryPath;
  }
  resetSemanticRouterForTests();
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('semantic router storage path (#4741)', () => {
  it('keeps the native database under the default memory root', async () => {
    await routeTaskForBench('write a test', { embedder: 'hash' });

    expect(state.vectorDbOptions).toHaveLength(1);
    expect(state.vectorDbOptions[0].storagePath).toBe(join(projectRoot, '.swarm', 'ruvector.db'));
    expect(existsSync(join(projectRoot, '.swarm'))).toBe(true);
  });

  it('respects a configured memory root', async () => {
    process.env.CLAUDE_FLOW_MEMORY_PATH = 'custom-memory';
    await routeTaskForBench('write a test', { embedder: 'hash' });

    expect(state.vectorDbOptions).toHaveLength(1);
    expect(state.vectorDbOptions[0].storagePath).toBe(join(projectRoot, 'custom-memory', 'ruvector.db'));
    expect(existsSync(join(projectRoot, 'custom-memory'))).toBe(true);
  });
});
