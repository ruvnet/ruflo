/**
 * #4736 / ADR-531 — cross-process lost updates in the agent store.
 * N real Node processes call the real agent_spawn / agent_update /
 * agent_terminate handlers at once against one project directory.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, '..');
// Resolve tsx through Node (works whether deps sit at the repo root or in v3/), not a fixed .bin path.
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
const agentToolsPath = join(cliRoot, 'src/mcp-tools/agent-tools.ts');
const WORKERS = 8;

const CHILD = `
import { existsSync } from 'node:fs';
const [, , toolsPath, gate, tool, inputJson] = process.argv;
const { agentTools } = await import(toolsPath);
const handler = agentTools.find((t) => t.name === tool).handler;
while (!existsSync(gate)) await new Promise((r) => setTimeout(r, 1));
const result = await handler(JSON.parse(inputJson));
console.log('RESULT:' + JSON.stringify(result));
`;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ruflo-agent-4736-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runChild(gate: string, tool: string, input: object): Promise<any> {
  const script = join(dir, `child-${Math.random().toString(36).slice(2)}.mts`);
  writeFileSync(script, CHILD);
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, script, agentToolsPath, gate, tool, JSON.stringify(input)], {
      cwd: cliRoot,
      env: { ...process.env, CLAUDE_FLOW_CWD: dir, CLAUDE_FLOW_ROUTER_TRAJECTORY: '0', CLAUDE_FLOW_RUN_TRANSCRIPTS: '0' },
    });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const line = out.split('\n').find((l) => l.startsWith('RESULT:'));
      if (code !== 0 || !line) return reject(new Error(`child exit ${code}: ${err || out}`));
      resolveRun(JSON.parse(line.slice('RESULT:'.length)));
    });
  });
}

/** Start all children, release them together once each is ready to run. */
async function race(calls: Array<[string, object]>): Promise<any[]> {
  const gate = join(dir, 'go');
  const running = calls.map(([tool, input]) => runChild(gate, tool, input));
  await new Promise((r) => setTimeout(r, 4000));
  writeFileSync(gate, '1');
  return Promise.all(running);
}

const storePath = () => join(dir, '.claude-flow/agents/store.json');
const readAgents = () => JSON.parse(readFileSync(storePath(), 'utf8')).agents as Record<string, any>;

describe('agent store cross-process concurrency (#4736)', () => {
  it('persists every agent when 8 processes call agent_spawn at once', async () => {
    const ids = Array.from({ length: WORKERS }, (_, i) => `spawn-${i}`);
    const results = await race(ids.map((agentId) => ['agent_spawn', { agentType: 'coder', agentId, model: 'sonnet' }]));
    for (const r of results) expect(r.success).toBe(true);
    expect(Object.keys(readAgents()).sort()).toEqual([...ids].sort());
    expect(existsSync(`${storePath()}.lock`)).toBe(false);
  }, 120_000);

  it('persists concurrent updates and terminations of different agents', async () => {
    const ids = Array.from({ length: WORKERS }, (_, i) => `seed-${i}`);
    mkdirSync(join(dir, '.claude-flow/agents'), { recursive: true });
    const agents = Object.fromEntries(ids.map((agentId) => [agentId, {
      agentId, agentType: 'coder', status: 'idle', health: 1, taskCount: 0, config: {}, createdAt: new Date().toISOString(),
    }]));
    writeFileSync(storePath(), JSON.stringify({ agents, version: '3.0.0' }));
    const results = await race(ids.map((agentId, i): [string, object] => i % 2 === 0
      ? ['agent_update', { agentId, taskCount: i + 1, config: { marker: agentId } }]
      : ['agent_terminate', { agentId }]));
    for (const r of results) expect(r.success).toBe(true);
    const after = readAgents();
    ids.forEach((agentId, i) => {
      if (i % 2 === 0) {
        expect(after[agentId].taskCount).toBe(i + 1);
        expect(after[agentId].config.marker).toBe(agentId);
        expect(after[agentId].status).toBe('idle');
      } else {
        expect(after[agentId].status).toBe('terminated');
      }
    });
  }, 120_000);
});
