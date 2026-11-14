/**
 * #4736 / ADR-531: concurrent MCP servers lost task updates because every
 * handler did loadTaskStore -> mutate -> writeFileSync. This drives the real
 * handlers from N separate Node processes released at the same instant.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TASK_TOOLS = resolve(fileURLToPath(new URL('../src/mcp-tools/task-tools.ts', import.meta.url)));
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const WORKERS = 8;

const CHILD = `
import { existsSync, writeFileSync } from 'node:fs';
const [,, toolsPath, tool, argsJson, readyFile, goFile] = process.argv;
const { taskTools } = await import(toolsPath);
const handler = taskTools.find((t) => t.name === tool).handler;
writeFileSync(readyFile, '1');
while (!existsSync(goFile)) { /* spin until released */ }
const result = await handler(JSON.parse(argsJson));
process.stdout.write(JSON.stringify(result));
`;

interface Call { tool: string; args: Record<string, unknown> }

describe('task store concurrency (#4736)', () => {
  let dir: string;
  let ctl: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-task-4736-'));
    ctl = mkdtempSync(join(tmpdir(), 'ruflo-task-4736-ctl-'));
    writeFileSync(join(ctl, 'child.mjs'), CHILD);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(ctl, { recursive: true, force: true });
  });

  /** Run every call in its own process, released together once all are ready. */
  async function runConcurrently(calls: Call[]): Promise<any[]> {
    const go = join(ctl, 'go');
    const runs = calls.map((call, i) => new Promise<any>((done, fail) => {
      const child = spawn(process.execPath, [
        '--import', TSX, join(ctl, 'child.mjs'),
        TASK_TOOLS, call.tool, JSON.stringify(call.args), join(ctl, `ready-${i}`), go,
      ], { env: { ...process.env, CLAUDE_FLOW_CWD: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => (code === 0 ? done(JSON.parse(out)) : fail(new Error(`child ${i} exit ${code}: ${err}`))));
    }));
    const deadline = Date.now() + 60_000;
    while (readdirSync(ctl).filter((f) => f.startsWith('ready-')).length < calls.length) {
      if (Date.now() > deadline) throw new Error('children never became ready');
      await new Promise((r) => setTimeout(r, 20));
    }
    writeFileSync(go, '1');
    return Promise.all(runs);
  }

  const readStore = () => {
    const path = join(dir, '.claude-flow', 'tasks', 'store.json');
    expect(existsSync(path)).toBe(true);
    return JSON.parse(readFileSync(path, 'utf-8')) as { tasks: Record<string, any> };
  };

  it('persists every task from concurrent task_create calls', async () => {
    const results = await runConcurrently(Array.from({ length: WORKERS }, (_, i) => ({
      tool: 'task_create', args: { type: 'feature', description: `task ${i}` },
    })));
    const ids = results.map((r) => r.taskId);
    expect(new Set(ids).size).toBe(WORKERS);
    const store = readStore();
    expect(Object.keys(store.tasks).sort()).toEqual([...ids].sort());
  }, 90_000);

  it('persists concurrent status updates to different tasks', async () => {
    const ids = Array.from({ length: WORKERS }, (_, i) => `task-seed-${i}`);
    const tasks = Object.fromEntries(ids.map((taskId) => [taskId, {
      taskId, type: 'feature', description: taskId, priority: 'normal', status: 'pending', progress: 0,
      assignedTo: [], tags: [], createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
    }]));
    mkdirSync(join(dir, '.claude-flow', 'tasks'), { recursive: true });
    writeFileSync(join(dir, '.claude-flow', 'tasks', 'store.json'), JSON.stringify({ tasks, version: '3.0.0' }));

    const updates = await runConcurrently(ids.map((taskId, i) => ({
      tool: 'task_update', args: { taskId, status: 'in_progress', progress: i * 10 },
    })));
    expect(updates.every((u) => u.success === true)).toBe(true);

    const store = readStore();
    ids.forEach((taskId, i) => {
      expect(store.tasks[taskId].status).toBe('in_progress');
      expect(store.tasks[taskId].progress).toBe(i * 10);
    });
  }, 120_000);
});
