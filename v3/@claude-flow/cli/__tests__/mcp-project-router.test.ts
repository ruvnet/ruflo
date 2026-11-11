import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectIsolationRouter } from '../src/mcp-project-router.js';

describe('ProjectIsolationRouter', () => {
  let baseDir: string;
  let globalCwd: string;
  let stateDir: string;
  let projAlpha: string;
  let projBeta: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'ruflo-router-test-'));
    globalCwd = join(baseDir, 'home');
    stateDir = join(globalCwd, '.claude-flow');
    projAlpha = join(baseDir, 'workspace', 'alpha-app');
    projBeta = join(baseDir, 'workspace', 'beta-api');

    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(projAlpha, '.claude-flow', 'agents'), { recursive: true });
    mkdirSync(join(projAlpha, 'src', 'components'), { recursive: true });
    mkdirSync(join(projBeta, '.git'), { recursive: true });
    mkdirSync(join(projBeta, 'services'), { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('rejects container/home dirs and resolves nested files inside marked workspaces', () => {
    const router = new ProjectIsolationRouter({
      globalCwd,
      stateDir,
      projectParentRoots: [join(baseDir, 'workspace')],
      disablePersistence: true,
    });

    expect(router.normalizeProjectRoot(homedir())).toBeNull();
    expect(router.normalizeProjectRoot(globalCwd)).toBeNull();
    expect(router.normalizeProjectRoot(join(baseDir, 'workspace'))).toBeNull();

    const nestedAlphaFile = join(projAlpha, 'src', 'components', 'App.tsx');
    writeFileSync(nestedAlphaFile, 'export {}');
    expect(router.resolveProjectRoot({ filePath: nestedAlphaFile })).toBe(projAlpha);

    const nestedBetaDir = join(projBeta, 'services');
    expect(router.resolveProjectRoot({ workingDir: nestedBetaDir })).toBe(projBeta);
  });

  it('learns swarm/agent/task ID ownership across calls and routes subsequent ID-only lookups correctly', () => {
    const router = new ProjectIsolationRouter({
      globalCwd,
      stateDir,
      disablePersistence: true,
    });

    expect(router.resolveProjectRoot({ projectPath: projAlpha })).toBe(projAlpha);
    router.learnIdsFromResult(
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              swarmId: 'swarm-alpha-1',
              agentId: 'agent-alpha-ui',
              taskId: 'task-alpha-9',
            }),
          },
        ],
      },
      projAlpha,
    );

    expect(router.resolveProjectRoot({ projectPath: projBeta })).toBe(projBeta);
    router.learnIdsFromResult({ swarmId: 'swarm-beta-2', taskId: 'task-beta-4' }, projBeta);

    expect(router.resolveProjectRoot({ taskId: 'task-alpha-9' })).toBe(projAlpha);
    expect(router.resolveProjectRoot({ assignedTo: ['agent-alpha-ui'] })).toBe(projAlpha);
    expect(router.resolveProjectRoot({ swarmId: 'swarm-beta-2' })).toBe(projBeta);
    expect(router.resolveProjectRoot({ description: `Fix build inside ${projAlpha}/src` })).toBe(projAlpha);
    expect(router.resolveProjectRoot({ key: 'unscoped-global-note' })).toBe(globalCwd);
  });

  it('injects optional projectPath into tools/list and strips only non-native routing hints', () => {
    const router = new ProjectIsolationRouter({
      globalCwd,
      stateDir,
      disablePersistence: true,
    });

    const augmented = router.augmentToolSchemas([
      {
        name: 'memory_store',
        description: 'Store memory',
        inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } },
      },
      {
        name: 'custom_native_tool',
        description: 'Accepts native projectPath',
        inputSchema: { type: 'object', properties: { projectPath: { type: 'string' } } },
      },
    ]);

    expect(augmented[0].inputSchema?.properties).toHaveProperty('projectPath');
    expect(router.stripRouterOnlyHints('memory_store', { key: 'k', projectPath: projAlpha, workspace: projAlpha })).toEqual({
      key: 'k',
    });
    expect(router.stripRouterOnlyHints('custom_native_tool', { projectPath: projAlpha, workspace: projAlpha })).toEqual({
      projectPath: projAlpha,
    });
  });
});
