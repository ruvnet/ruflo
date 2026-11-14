/**
 * #4736 / ADR-531: workflow handlers did load -> mutate -> writeFileSync with no
 * lock, so concurrent MCP servers (separate processes) lost each other's
 * workflows. These tests spawn real child processes against one project dir.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolsUrl = pathToFileURL(join(packageDir, 'src/mcp-tools/workflow-tools.ts')).href;

// Each child waits for a shared start instant so the writers genuinely overlap.
const CHILD_SOURCE = `
import { workflowTools } from ${JSON.stringify(toolsUrl)};
const [op, startAt, arg] = process.argv.slice(2);
const tool = (name, input) => workflowTools.find((t) => t.name === name).handler(input);
while (Date.now() < Number(startAt)) { /* spin until the shared start instant */ }
let out;
if (op === 'create') out = await tool('workflow_create', { name: arg });
else if (op === 'execute') out = await tool('workflow_execute', { workflowId: arg });
console.log(JSON.stringify(out));
`;

let projectDir = '';
let childFile = '';

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ruflo-4736-wf-'));
  childFile = join(projectDir, 'child.mts');
  writeFileSync(childFile, CHILD_SOURCE);
  process.env.CLAUDE_FLOW_CWD = projectDir;
});
afterEach(() => {
  delete process.env.CLAUDE_FLOW_CWD;
  rmSync(projectDir, { recursive: true, force: true });
});

function runChild(op: string, startAt: number, arg: string): Promise<any> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', childFile, op, String(startAt), arg], {
      cwd: packageDir,
      env: { ...process.env, CLAUDE_FLOW_CWD: projectDir },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`child ${op} exited ${code}: ${stderr}`));
      resolvePromise(JSON.parse(stdout.trim().split('\n').pop()!));
    });
  });
}

const readStore = () => JSON.parse(readFileSync(join(projectDir, '.claude-flow/workflows/store.json'), 'utf-8'));

describe('workflow store survives concurrent processes (#4736)', () => {
  it('persists every workflow created by 10 simultaneous processes', async () => {
    const startAt = Date.now() + 4000;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => runChild('create', startAt, `wf-${i}`)),
    );
    const ids = results.map((r) => r.workflowId);
    expect(new Set(ids).size).toBe(10);
    const store = readStore();
    expect(Object.keys(store.workflows).sort()).toEqual([...ids].sort());
  }, 60_000);

  it('does not lose workflows created while another process executes one', async () => {
    const { workflowTools } = await import('../src/mcp-tools/workflow-tools.js');
    const create = workflowTools.find((t) => t.name === 'workflow_create')!;
    const steps = Array.from({ length: 4 }, (_, i) => ({ name: `wait-${i}`, type: 'wait', config: { ms: 250 } }));
    const a = (await create.handler({ name: 'running-A', steps })) as { workflowId: string };

    const startAt = Date.now() + 4000;
    const [executed, ...created] = await Promise.all([
      runChild('execute', startAt, a.workflowId),
      ...Array.from({ length: 8 }, (_, i) => runChild('create', startAt + i * 150, `other-${i}`)),
    ]);

    expect(executed).toMatchObject({ status: 'completed', stepsCompleted: 4 });
    const store = readStore();
    expect(Object.keys(store.workflows)).toHaveLength(9);
    for (const r of created) expect(store.workflows[r.workflowId]).toBeDefined();
    expect(store.workflows[a.workflowId].status).toBe('completed');
    expect(store.workflows[a.workflowId].steps.every((s: { status: string }) => s.status === 'completed')).toBe(true);
  }, 60_000);
});
