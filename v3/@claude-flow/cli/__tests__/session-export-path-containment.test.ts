/**
 * SECURITY: session_export wrote the session JSON to whatever `outputPath` the
 * MCP caller passed, so a caller could create or overwrite files anywhere the
 * MCP server process can write. Exports are now contained to the project root.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { sessionTools } from '../src/mcp-tools/session-tools.js';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';

const call = (name: string, input: any): Promise<any> => sessionTools.find(t => t.name === name)!.handler(input) as Promise<any>;
let outside: string;

beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-export-contain-'));
  outside = mkdtempSync(join(tmpdir(), 'ruflo-export-outside-'));
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', join(state.cwd, '.swarm'));
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  _resetMemoryRootCache();
  for (const kind of ['tasks', 'agents']) {
    mkdirSync(join(state.cwd, '.claude-flow', kind), { recursive: true });
    writeFileSync(join(state.cwd, '.claude-flow', kind, 'store.json'), JSON.stringify({ [kind]: {} }));
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetMemoryRootCache();
  rmSync(state.cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

async function saved() {
  return (await call('session_save', { name: 'cp', includeTasks: true, includeAgents: true })).sessionId as string;
}

it('writes a relative or absolute path inside the project', async () => {
  const id = await saved();
  const rel = await call('session_export', { sessionId: id, outputPath: 'exports.json' });
  expect(rel.error).toBeUndefined();
  expect(JSON.parse(readFileSync(join(state.cwd, 'exports.json'), 'utf8')).sessionId).toBe(id);
  mkdirSync(join(state.cwd, 'out'));
  const abs = await call('session_export', { sessionId: id, outputPath: join(state.cwd, 'out', 'a.json') });
  expect(abs.error).toBeUndefined();
  expect(existsSync(join(state.cwd, 'out', 'a.json'))).toBe(true);
});

it('refuses absolute and relative paths outside the project', async () => {
  const id = await saved();
  for (const outputPath of [join(outside, 'x.json'), join('..', 'escape.json'), '../../etc-like.json']) {
    const result = await call('session_export', { sessionId: id, outputPath });
    expect(result.error).toMatch(/inside the project/);
    expect(result.path ?? null).toBeNull();
  }
  expect(existsSync(join(outside, 'x.json'))).toBe(false);
});

it('refuses to write through a symlinked directory or file', async () => {
  const id = await saved();
  symlinkSync(outside, join(state.cwd, 'linkdir'));
  writeFileSync(join(outside, 'victim.json'), 'original');
  symlinkSync(join(outside, 'victim.json'), join(state.cwd, 'linkfile.json'));
  for (const outputPath of ['linkdir/x.json', 'linkfile.json']) {
    const result = await call('session_export', { sessionId: id, outputPath });
    expect(result.error).toMatch(/inside the project/);
  }
  expect(existsSync(join(outside, 'x.json'))).toBe(false);
  expect(readFileSync(join(outside, 'victim.json'), 'utf8')).toBe('original');
});
