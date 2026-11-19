/**
 * session_import and workflow_validate read a caller-named file. Over MCP the
 * path must stay inside the project (as memory_import already does), and a
 * parse failure must not echo the file's contents back to the caller.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: vi.fn() }));

import { sessionTools } from '../src/mcp-tools/session-tools.js';
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
import { localCliContext } from '../src/mcp-tools/path-containment.js';

const CANARY = 'CANARY-7f3a-outside-project';
const tool = (name: string) => [...sessionTools, ...workflowTools].find(t => t.name === name)!;
const run = (name: string, input: Record<string, unknown>, context?: unknown) =>
  (tool(name).handler as (i: unknown, c?: unknown) => Promise<any>)(input, context);
const importSession = (inputPath: string, context?: unknown) => run('session_import', { inputPath }, context);
const validateWorkflow = (file: string, context?: unknown) => run('workflow_validate', { file }, context);

let base: string;
let outside: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ruflo-read-containment-'));
  state.cwd = join(base, 'project');
  mkdirSync(state.cwd);
  outside = join(base, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), `${CANARY}\nsecond line`);
  writeFileSync(join(outside, 'session.json'), JSON.stringify({ name: 'external' }));
  writeFileSync(join(outside, 'workflow.json'), JSON.stringify({ steps: [{ name: CANARY, agent: CANARY }] }));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('MCP callers cannot read files outside the project', () => {
  it.each([
    ['absolute path', () => join(outside, 'secret.txt')],
    ['relative traversal', () => '../outside/secret.txt'],
  ])('session_import refuses an %s without echoing contents', async (_label, path) => {
    const result = await importSession(path());
    expect(result.error).toMatch(/inside the project directory/);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it.each(['secret.txt', 'workflow.json'])('workflow_validate refuses outside file %s without echoing contents', async name => {
    const result = await validateWorkflow(join(outside, name));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/inside the project directory/);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('refuses a symlink inside the project that points outside', async () => {
    symlinkSync(join(outside, 'secret.txt'), join(state.cwd, 'link.json'));
    expect(JSON.stringify(await importSession('link.json'))).not.toContain('CANARY');
    expect(JSON.stringify(await validateWorkflow('link.json'))).not.toContain('CANARY');
    expect((await importSession('link.json')).error).toMatch(/not a symlink/);
  });

  it('does not quote file contents in parse errors for files inside the project', async () => {
    writeFileSync(join(state.cwd, 'bad.json'), `${CANARY} is not json`);
    const imported = await importSession(join(state.cwd, 'bad.json'));
    expect(imported.error).toMatch(/invalid session json/i);
    expect(JSON.stringify(imported)).not.toContain('CANARY');
    const validated = await validateWorkflow(join(state.cwd, 'bad.json'));
    expect(validated.errors[0].message).toMatch(/not valid JSON/);
    expect(JSON.stringify(validated)).not.toContain('CANARY');
  });

  it('still reads valid files inside the project', async () => {
    writeFileSync(join(state.cwd, 'session.json'), JSON.stringify({ name: 'inside' }));
    expect(await importSession('session.json')).toMatchObject({ name: 'inside' });
    writeFileSync(join(state.cwd, 'workflow.json'), JSON.stringify({ steps: [{ name: 's', agent: 'coder' }] }));
    expect(await validateWorkflow('workflow.json')).toMatchObject({ valid: true, stats: { stages: 1, agents: 1 } });
  });
});

describe('the local CLI may still name files outside the project', () => {
  it('session import and workflow validate accept an operator-chosen path', async () => {
    expect(await importSession(join(outside, 'session.json'), localCliContext())).toMatchObject({ name: 'external' });
    expect(await validateWorkflow(join(outside, 'workflow.json'), localCliContext())).toMatchObject({ valid: true });
  });

  it('reports a missing file plainly', async () => {
    expect((await importSession(join(outside, 'nope.json'), localCliContext())).error).toMatch(/File not found/);
  });
});
