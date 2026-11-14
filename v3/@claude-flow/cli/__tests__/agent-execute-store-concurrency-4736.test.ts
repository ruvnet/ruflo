/**
 * #4736 / ADR-531 — agent_execute (executeAgentTask) registry writes and the
 * agent_spawn → swarm-store push, exercised from real concurrent processes.
 * The provider is a local HTTP stub (ANTHROPIC_BASE_URL), so there is no network.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, '..');
// Resolve tsx through Node (works whether deps sit at the repo root or in v3/), not a fixed .bin path.
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
const agentToolsPath = join(cliRoot, 'src/mcp-tools/agent-tools.ts');

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
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      // Hold each call open so executions overlap with the other writers.
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_stub', model: 'claude-sonnet-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'stub output' }],
          usage: { input_tokens: 3, output_tokens: 2 },
        }));
      }, 900);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ruflo-exec-4736-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runChild(gate: string, tool: string, input: object): Promise<any> {
  const script = join(dir, `child-${Math.random().toString(36).slice(2)}.mts`);
  writeFileSync(script, CHILD);
  const env: NodeJS.ProcessEnv = {
    ...process.env, CLAUDE_FLOW_CWD: dir, CLAUDE_FLOW_ROUTER_TRAJECTORY: '0', CLAUDE_FLOW_RUN_TRANSCRIPTS: '0',
    ANTHROPIC_API_KEY: 'stub-key', ANTHROPIC_BASE_URL: baseUrl,
  };
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'OPENROUTER_API_KEY', 'OLLAMA_API_KEY', 'OLLAMA_BASE_URL']) delete env[k];
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, script, agentToolsPath, gate, tool, JSON.stringify(input)], { cwd: cliRoot, env });
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

/**
 * Release `wave1` together, then `wave2` after `lateMs` so the second wave lands
 * while wave-1 provider calls are in flight (i.e. around executeAgentTask's
 * completion write).
 */
async function race(wave1: Array<[string, object]>, wave2: Array<[string, object]> = [], lateMs = 850): Promise<any[]> {
  const gate1 = join(dir, 'go1');
  const gate2 = join(dir, 'go2');
  const running = [
    ...wave1.map(([tool, input]) => runChild(gate1, tool, input)),
    ...wave2.map(([tool, input]) => runChild(gate2, tool, input)),
  ];
  await new Promise((r) => setTimeout(r, 4000));
  writeFileSync(gate1, '1');
  await new Promise((r) => setTimeout(r, lateMs));
  writeFileSync(gate2, '1');
  return Promise.all(running);
}

const agentStorePath = () => join(dir, '.claude-flow/agents/store.json');
const swarmStatePath = () => join(dir, '.claude-flow/swarm/swarm-state.json');
const readAgents = () => JSON.parse(readFileSync(agentStorePath(), 'utf8')).agents as Record<string, any>;
const seedAgent = (agentId: string) => ({
  agentId, agentType: 'coder', status: 'idle', health: 1, taskCount: 0, config: {}, createdAt: new Date().toISOString(),
});

describe('agent_execute / swarm push cross-process concurrency (#4736)', () => {
  it('keeps every execution, update and spawn when executeAgentTask overlaps other writers', async () => {
    const execIds = Array.from({ length: 6 }, (_, i) => `exec-${i}`);
    const updIds = Array.from({ length: 4 }, (_, i) => `upd-${i}`);
    const spawnIds = Array.from({ length: 8 }, (_, i) => `spawn-${i}`);
    mkdirSync(join(dir, '.claude-flow/agents'), { recursive: true });
    writeFileSync(agentStorePath(), JSON.stringify({
      agents: Object.fromEntries([...execIds, ...updIds].map((id) => [id, seedAgent(id)])), version: '3.0.0',
    }));

    const execCalls = execIds.map((agentId): [string, object] => ['agent_execute', { agentId, prompt: 'hello' }]);
    const others: Array<[string, object]> = [
      // Updates land on the executing agents (during their provider call) and on idle ones.
      ...execIds.map((agentId): [string, object] => ['agent_update', { agentId, config: { marker: agentId } }]),
      ...updIds.map((agentId, i): [string, object] => ['agent_update', { agentId, taskCount: i + 10, config: { marker: agentId } }]),
      ...spawnIds.map((agentId): [string, object] => ['agent_spawn', { agentType: 'coder', agentId, model: 'sonnet' }]),
    ];
    // Wave 1 = executors + half the others (race the busy-mark write); wave 2 = the
    // other half, released while the provider call is in flight (races the completion write).
    const results = await race(
      [...execCalls, ...others.filter((_, i) => i % 2 === 0)],
      others.filter((_, i) => i % 2 === 1),
    );
    results.forEach((r) => expect(r.success).toBe(true));

    const agents = readAgents();
    expect(Object.keys(agents).sort()).toEqual([...execIds, ...updIds, ...spawnIds].sort());
    for (const id of execIds) {
      expect(agents[id].taskCount).toBe(1);
      expect(agents[id].executionHistory).toHaveLength(1);
      expect(agents[id].status).toBe('idle');
      expect(agents[id].config.marker).toBe(id);
    }
    updIds.forEach((id, i) => {
      expect(agents[id].taskCount).toBe(i + 10);
      expect(agents[id].config.marker).toBe(id);
    });
    expect(existsSync(`${agentStorePath()}.lock`)).toBe(false);
  }, 180_000);

  it('records every agent id in swarms[id].agents when 6 processes agent_spawn into one swarm', async () => {
    const swarmId = 'swarm-4736';
    mkdirSync(join(dir, '.claude-flow/swarm'), { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(swarmStatePath(), JSON.stringify({
      version: '3.0.0',
      swarms: { [swarmId]: {
        swarmId, topology: 'hierarchical', maxAgents: 50, status: 'running', agents: [], tasks: [],
        config: {}, createdAt: now, updatedAt: now,
      } },
    }));
    const ids = Array.from({ length: 6 }, (_, i) => `swarm-agent-${i}`);
    const results = await race(ids.map((agentId): [string, object] => ['agent_spawn', { agentType: 'coder', agentId, model: 'sonnet', swarmId }]));
    results.forEach((r) => expect(r.success).toBe(true));

    const swarm = JSON.parse(readFileSync(swarmStatePath(), 'utf8')).swarms[swarmId];
    expect([...swarm.agents].sort()).toEqual([...ids].sort());
    expect(Object.keys(readAgents()).sort()).toEqual([...ids].sort());
  }, 180_000);
});
