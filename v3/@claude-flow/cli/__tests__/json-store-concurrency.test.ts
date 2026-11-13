/**
 * Concurrent writers to the MCP JSON stores must not lose each other's updates.
 *
 * The stores did a plain load → change → writeFileSync. Two processes doing
 * that at once both read the same file, and the last write erased the other's
 * change while both reported success: 4 of 4 racers won the same
 * claims_claim, and 8 concurrent task_create calls kept 1 task.
 *
 * The race is between processes: inside one Node process these handlers run
 * one after another, so a Promise.all test would pass without the fix. Each
 * racer is a separate child process. All of them load the tools, report
 * `ready`, and wait; only then is `go` sent to every child at once, so the
 * calls overlap regardless of how slowly the children start.
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

interface Race { tool: string; input: Record<string, unknown> }

let workdir: string;
let worker: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'ruflo-store-race-'));
  worker = join(workdir, 'worker.mts');
  writeFileSync(worker, WORKER);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** Run every call in its own process, released together; resolves to each result. */
async function race(file: string, exportName: string, calls: Race[]): Promise<any[]> {
  const modulePath = pathToFileURL(join(srcDir, file)).href;
  const children = calls.map(({ tool, input }) => {
    const child = spawn(
      process.execPath,
      ['--import', tsxLoader, worker, modulePath, exportName, tool, JSON.stringify(input)],
      { cwd: workdir, env: { ...process.env, CLAUDE_FLOW_CWD: workdir }, stdio: ['pipe', 'pipe', 'pipe'] },
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

function readStore(...path: string[]): any {
  return JSON.parse(readFileSync(join(workdir, '.claude-flow', ...path), 'utf-8'));
}

describe('MCP JSON stores under concurrent writers', () => {
  it('keeps every task from 8 concurrent task_create calls', async () => {
    const results = await race('task-tools.ts', 'taskTools', Array.from({ length: 8 }, (_, i) => ({
      tool: 'task_create', input: { type: 'feature', description: `racer ${i}` },
    })));
    expect(results.every((r) => r.success !== false)).toBe(true);
    const tasks = Object.values(readStore('tasks', 'store.json').tasks) as any[];
    expect(tasks.map((t) => t.description).sort()).toEqual(results.map((_, i) => `racer ${i}`).sort());
  }, 60_000);

  it('lets exactly one of 4 concurrent claims_claim calls win the same issue', async () => {
    for (let round = 0; round < 3; round++) {
      const issueId = `issue-${round}`;
      const results = await race('claims-tools.ts', 'claimsTools', Array.from({ length: 4 }, (_, i) => ({
        tool: 'claims_claim', input: { issueId, claimant: `agent:racer-${i}:coder` },
      })));
      const winners = results.filter((r) => r.success === true);
      expect(winners).toHaveLength(1);
      expect(readStore('claims', 'claims.json').claims[issueId].claimant)
        .toEqual(winners[0].claim.claimant);
    }
  }, 120_000);

  it('keeps every workflow from 8 concurrent workflow_create calls', async () => {
    const results = await race('workflow-tools.ts', 'workflowTools', Array.from({ length: 8 }, (_, i) => ({
      tool: 'workflow_create', input: { name: `racer ${i}` },
    })));
    expect(results.every((r) => r.success !== false)).toBe(true);
    const workflows = Object.values(readStore('workflows', 'store.json').workflows) as any[];
    expect(workflows.map((w) => w.name).sort()).toEqual(results.map((_, i) => `racer ${i}`).sort());
  }, 60_000);

  it('lets exactly one of 4 concurrent workflow_execute calls start the same workflow', async () => {
    const workflowId = 'workflow-race';
    mkdirSync(join(workdir, '.claude-flow', 'workflows'), { recursive: true });
    writeFileSync(join(workdir, '.claude-flow', 'workflows', 'store.json'), JSON.stringify({
      workflows: {
        [workflowId]: {
          workflowId, name: 'race', status: 'ready', currentStep: 0, variables: {},
          // A wait step keeps the winner running while the others try to start.
          steps: [{ stepId: 'step-1', name: 'wait', type: 'wait', config: { ms: 1500 }, status: 'pending' }],
          createdAt: new Date().toISOString(),
        },
      },
      templates: {},
      version: '3.0.0',
    }));

    const results = await race('workflow-tools.ts', 'workflowTools', Array.from({ length: 4 }, () => ({
      tool: 'workflow_execute', input: { workflowId },
    })));
    expect(results.filter((r) => r.status === 'completed')).toHaveLength(1);
    expect(results.filter((r) => r.error === 'Workflow already running')).toHaveLength(3);
  }, 60_000);

  it('keeps every update from 8 concurrent agent_update calls on different agents', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `agent-${i}`);
    const agents = Object.fromEntries(ids.map((agentId) => [agentId, {
      agentId, agentType: 'coder', status: 'idle', health: 1, taskCount: 0, config: {},
      createdAt: new Date().toISOString(),
    }]));
    mkdirSync(join(workdir, '.claude-flow', 'agents'), { recursive: true });
    writeFileSync(join(workdir, '.claude-flow', 'agents', 'store.json'), JSON.stringify({ agents, version: '3.0.0' }));

    const results = await race('agent-tools.ts', 'agentTools', ids.map((agentId, i) => ({
      tool: 'agent_update', input: { agentId, taskCount: i + 1 },
    })));
    expect(results.every((r) => r.success !== false)).toBe(true);
    const saved = readStore('agents', 'store.json').agents;
    expect(ids.map((id) => saved[id].taskCount)).toEqual(ids.map((_, i) => i + 1));
  }, 60_000);
});
