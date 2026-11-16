import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectIsolationRouter, resolveRealPath } from '../src/mcp-project-router.js';

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

  it('rejects direct symlinks to container or home directories', () => {
    const router = new ProjectIsolationRouter({
      globalCwd,
      stateDir,
      disablePersistence: true,
    });

    const symlinkGlobalCwd = join(baseDir, 'symlink-global-cwd');
    const symlinkHome = join(baseDir, 'symlink-home');
    symlinkSync(globalCwd, symlinkGlobalCwd);
    symlinkSync(homedir(), symlinkHome);

    expect(router.normalizeProjectRoot(symlinkGlobalCwd)).toBeNull();
    expect(router.normalizeProjectRoot(symlinkHome)).toBeNull();
    expect(router.resolveProjectRoot({ projectPath: symlinkGlobalCwd })).toBe(router.globalCwd);
    expect(router.resolveProjectRoot({ projectPath: symlinkHome })).toBe(router.globalCwd);
    expect(router.resolveProjectRoot({ cwd: symlinkGlobalCwd })).toBe(router.globalCwd);
  });

  it('rejects nested paths through symlinks targeting container directories without markers', () => {
    const router = new ProjectIsolationRouter({
      globalCwd,
      stateDir,
      disablePersistence: true,
    });

    const symlinkGlobalCwd = join(baseDir, 'symlink-global-cwd-nested');
    symlinkSync(globalCwd, symlinkGlobalCwd);

    // 1. Non-existent nested leaf inside symlinked container
    const nonExistentNestedFile = join(symlinkGlobalCwd, 'unmarked-dir', 'deep-leaf.ts');
    expect(router.normalizeProjectRoot(nonExistentNestedFile, false)).toBeNull();
    expect(router.resolveProjectRoot({ filePath: nonExistentNestedFile })).toBe(router.globalCwd);

    // 2. Existing unmarked nested directory inside symlinked container
    const unmarkedRealDir = join(globalCwd, 'unmarked-sub');
    mkdirSync(unmarkedRealDir, { recursive: true });
    const symlinkedUnmarkedDir = join(symlinkGlobalCwd, 'unmarked-sub');
    const nestedFileInsideUnmarked = join(symlinkedUnmarkedDir, 'file.txt');
    writeFileSync(join(unmarkedRealDir, 'file.txt'), 'hello');

    expect(router.normalizeProjectRoot(symlinkedUnmarkedDir, false)).toBeNull();
    expect(router.normalizeProjectRoot(nestedFileInsideUnmarked, false)).toBeNull();
    expect(router.resolveProjectRoot({ filePath: nestedFileInsideUnmarked })).toBe(router.globalCwd);
    expect(router.resolveProjectRoot({ workingDir: symlinkedUnmarkedDir })).toBe(router.globalCwd);
  });

  it('resolves symlinks targeting valid workspaces to canonical root and deduplicates workers', () => {
    const router = new ProjectIsolationRouter({
      globalCwd,
      stateDir,
      projectParentRoots: [join(baseDir, 'workspace')],
      disablePersistence: true,
    });

    const symlinkAlpha = join(baseDir, 'symlink-alpha');
    symlinkSync(projAlpha, symlinkAlpha);

    const canonicalAlpha = router.normalizeProjectRoot(projAlpha);
    const resolvedSymlinkRoot = router.normalizeProjectRoot(symlinkAlpha);

    // Both must normalize to the exact same canonical realpath
    expect(resolvedSymlinkRoot).not.toBeNull();
    expect(resolvedSymlinkRoot).toBe(canonicalAlpha);

    // Nested path through symlinked workspace resolves to canonical root
    const symlinkedNestedFile = join(symlinkAlpha, 'src', 'components', 'App.tsx');
    expect(router.resolveProjectRoot({ filePath: symlinkedNestedFile })).toBe(canonicalAlpha);

    // Both projectPath via symlink and real path return identical routing destination
    expect(router.resolveProjectRoot({ projectPath: symlinkAlpha })).toBe(canonicalAlpha);
    expect(router.resolveProjectRoot({ projectPath: projAlpha })).toBe(canonicalAlpha);

    // Verify worker map deduplication: a worker keyed by canonicalAlpha serves both
    const fakeWorker = {
      projectRoot: canonicalAlpha!,
      label: 'alpha-app',
      disposed: false,
      lastUsedMs: Date.now(),
    } as any;
    router.workers.set(canonicalAlpha!, fakeWorker);

    const targetFromSymlink = router.resolveProjectRoot({ projectPath: symlinkAlpha });
    const targetFromReal = router.resolveProjectRoot({ projectPath: projAlpha });

    expect(router.workers.get(targetFromSymlink)).toBe(fakeWorker);
    expect(router.workers.get(targetFromReal)).toBe(fakeWorker);
  });

  it('safely resolves realpath even for non-existent nested leaf paths through symlinks', () => {
    const symlinkAlpha = join(baseDir, 'symlink-alpha-helper');
    symlinkSync(projAlpha, symlinkAlpha);

    const nonExistentFile = join(symlinkAlpha, 'does', 'not', 'exist', 'file.ts');
    const resolved = resolveRealPath(nonExistentFile);

    const canonicalAlpha = resolveRealPath(projAlpha);
    expect(resolved).toBe(join(canonicalAlpha, 'does', 'not', 'exist', 'file.ts'));
  });
});
