/**
 * #4736 — hive-mind writes to the agent stores must take the same lock as
 * agent_spawn. hive-mind_join rewrites `agents/store.json` (agent_spawn's
 * store) and `agents.json` (hive-mind_spawn's store); it used to read them,
 * then write the copy back without the lock, erasing agents spawned in
 * between. Each call runs in its own process, released together (see
 * json-store-concurrency.test.ts for why one process cannot show the race).
 *
 * Only the agent stores are asserted: hive-mind `state.json` (the workers
 * roster) is still a plain read-modify-write and is a separate follow-up.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const srcDir = resolve(__dirname, '..', 'src', 'mcp-tools');
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const WORKER = `
const [modulePath, exportName, toolName, inputJson] = process.argv.slice(2);
const tools = (await import(modulePath))[exportName];
const tool = tools.find((t) => t.name === toolName);
process.stdout.write('ready\\n');
await new Promise((go) => process.stdin.once('data', go));
const result = await tool.handler(JSON.parse(inputJson));
process.stdout.write(JSON.stringify(result) + '\\n');
process.exit(0);
`;

interface Call { file: string; exportName: string; tool: string; input: Record<string, unknown> }

let workdir: string;
let worker: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'ruflo-hive-race-'));
  worker = join(workdir, 'worker.mts');
  writeFileSync(worker, WORKER);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

async function race(calls: Call[]): Promise<any[]> {
  const children = calls.map(({ file, exportName, tool, input }) => {
    const child = spawn(
      process.execPath,
      ['--import', tsxLoader, worker, pathToFileURL(join(srcDir, file)).href, exportName, tool, JSON.stringify(input)],
      { cwd: workdir, env: { ...process.env, CLAUDE_FLOW_CWD: workdir, RUFLO_HIVE_REQUIRE_AUTH: '' }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stderr!.on('data', (d) => { err += d; });
    const ready = new Promise<void>((res) => {
      child.stdout!.on('data', (d) => {
        out += d;
        if (out.startsWith('ready\n')) res();
      });
    });
    const done = new Promise<any>((res, rej) => {
      child.on('exit', (code) => {
        const line = out.split('\n')[1];
        if (code !== 0 || !line) rej(new Error(`${tool} worker exited ${code}: ${err.slice(-2000)}`));
        else res(JSON.parse(line));
      });
    });
    return { child, ready, done };
  });
  await Promise.all(children.map((c) => c.ready));
  for (const c of children) c.child.stdin!.write('go\n');
  return Promise.all(children.map((c) => c.done));
}

const hive = (tool: string, input: Record<string, unknown>): Call =>
  ({ file: 'hive-mind-tools.ts', exportName: 'hiveMindTools', tool, input });
const agent = (tool: string, input: Record<string, unknown>): Call =>
  ({ file: 'agent-tools.ts', exportName: 'agentTools', tool, input });
const readAgents = (...path: string[]) =>
  JSON.parse(readFileSync(join(workdir, '.claude-flow', ...path), 'utf-8')).agents as Record<string, any>;
const record = (agentId: string) => ({
  agentId, agentType: 'coder', status: 'idle', health: 1, taskCount: 0, config: {}, createdAt: new Date().toISOString(),
});

describe('hive-mind agent-store writes under concurrent agent_spawn (#4736)', () => {
  it('keeps every agent when hive-mind_join, hive-mind_spawn and agent_spawn overlap', async () => {
    const joinIds = Array.from({ length: 5 }, (_, i) => `join-${i}`);
    const hiveIds = Array.from({ length: 3 }, (_, i) => `hive-${i}`);
    const spawnIds = Array.from({ length: 6 }, (_, i) => `spawn-${i}`);
    mkdirSync(join(workdir, '.claude-flow', 'agents'), { recursive: true });
    writeFileSync(join(workdir, '.claude-flow', 'agents', 'store.json'),
      JSON.stringify({ agents: Object.fromEntries(joinIds.map((id) => [id, record(id)])), version: '3.0.0' }));
    writeFileSync(join(workdir, '.claude-flow', 'agents.json'),
      JSON.stringify({ agents: Object.fromEntries(hiveIds.map((id) => [id, record(id)])) }));

    const [init] = await race([hive('hive-mind_init', { maxAgents: 50 })]);
    expect(init.success).toBe(true);

    const results = await race([
      ...joinIds.map((agentId) => hive('hive-mind_join', { agentId, role: 'specialist' })),
      ...hiveIds.map((agentId) => hive('hive-mind_join', { agentId, role: 'scout' })),
      ...spawnIds.map((agentId) => agent('agent_spawn', { agentType: 'coder', agentId, model: 'sonnet' })),
      hive('hive-mind_spawn', { count: 2, prefix: 'hspawn-a' }),
      hive('hive-mind_spawn', { count: 2, prefix: 'hspawn-b' }),
    ]);
    results.forEach((r) => expect(r.success, JSON.stringify(r)).toBe(true));
    const hiveSpawned = results.flatMap((r) => (r.workers ?? []).map((w: { agentId: string }) => w.agentId));
    expect(hiveSpawned).toHaveLength(4);

    const canonical = readAgents('agents', 'store.json');
    expect(Object.keys(canonical).sort()).toEqual([...joinIds, ...spawnIds].sort());
    for (const id of joinIds) expect(canonical[id].config.hiveRole).toBe('specialist');

    const hiveStore = readAgents('agents.json');
    expect(Object.keys(hiveStore).sort()).toEqual([...hiveIds, ...hiveSpawned].sort());
    for (const id of hiveIds) expect(hiveStore[id].config.hiveRole).toBe('scout');
  }, 120_000);
});
