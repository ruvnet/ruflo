import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
// No live memory DB: the memory a session holds is the .claude-flow/memory store below.
vi.mock('../src/memory/memory-initializer.js', () => ({
  resolveDbPath: () => join(state.cwd, '.swarm', 'memory.db'),
  listEntries: async () => ({ success: true, entries: [], total: 0 }),
  storeEntry: async () => ({ success: true }),
}));
vi.mock('../src/memory/memory-bridge.js', () => ({
  siblingAgentDbPath: () => join(state.cwd, '.swarm', 'agentdb-memory.db'),
}));
// Route the CLI straight to the real session tool handlers (no policy layer).
vi.mock('../src/mcp-client.js', async () => {
  const { sessionTools } = await import('../src/mcp-tools/session-tools.js');
  return {
    MCPClientError: class extends Error {},
    callMCPTool: async (name: string, input: Record<string, unknown>) =>
      sessionTools.find((tool) => tool.name === name)!.handler(input),
  };
});
vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'createSpinner'
    ? () => ({ start() {}, succeed() {}, fail() {} })
    : (value: unknown) => value,
}) }));
import { sessionCommand } from '../src/commands/session.js';
import { CommandParser } from '../src/parser.js';

const kinds = ['agents', 'memory', 'tasks'];
const store = (kind: string) => join(state.cwd, '.claude-flow', kind, 'store.json');
const field = (kind: string) => (kind === 'memory' ? 'entries' : kind);
const write = (kind: string, value: string) =>
  writeFileSync(store(kind), JSON.stringify({ [field(kind)]: { a: { key: 'a', value } } }));
const read = (kind: string) => JSON.parse(readFileSync(store(kind), 'utf-8'))[field(kind)].a.value;

async function session(argv: string[]): Promise<any> {
  const parser = new CommandParser();
  parser.registerCommand(sessionCommand);
  const { flags, positional } = parser.parse(['session', ...argv]);
  const subcommand = sessionCommand.subcommands!.find((command) => command.name === argv[0])!;
  const result = await subcommand.action!({ args: positional, flags, cwd: state.cwd, interactive: false });
  expect(result?.success).toBe(true);
  return result?.data;
}

beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'session-component-flags-'));
  vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '0');
  for (const kind of kinds) {
    mkdirSync(join(state.cwd, '.claude-flow', kind), { recursive: true });
    write(kind, 'saved');
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(state.cwd, { recursive: true, force: true });
});

describe('session component flags through the real command parser', () => {
  it.each([
    [['--memory-only'], { agents: 'live', memory: 'saved', tasks: 'live' }],
    [['--agents-only'], { agents: 'saved', memory: 'live', tasks: 'live' }],
    [['--tasks-only'], { agents: 'live', memory: 'live', tasks: 'saved' }],
    [[], { agents: 'saved', memory: 'saved', tasks: 'saved' }],
  ])('restore %j overwrites only the selected stores', async (flags, expected) => {
    const { sessionId } = await session(['save', '-n', 'checkpoint']);
    for (const kind of kinds) write(kind, 'live');
    await session(['restore', sessionId, '--force', ...flags]);
    expect(Object.fromEntries(kinds.map((kind) => [kind, read(kind)]))).toEqual(expected);
  });

  it.each([
    [[], ['agents', 'memory', 'tasks']],
    [['--no-include-memory'], ['agents', 'tasks']],
    [['--include-memory', 'false'], ['agents', 'tasks']],
    [['--no-include-agents'], ['memory', 'tasks']],
    [['--no-include-tasks'], ['agents', 'memory']],
  ])('save %j stores %j', async (flags, stored) => {
    const { path } = await session(['save', '-n', 'checkpoint', ...flags]);
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf-8')).data).sort()).toEqual(stored);
  });

  it.each([
    [[], ['agents', 'memory', 'tasks']],
    [['--no-include-memory'], ['agents', 'tasks']],
    [['--include-memory', 'false'], ['agents', 'tasks']],
  ])('export %j writes %j', async (flags, exported) => {
    const { sessionId } = await session(['save', '-n', 'checkpoint']);
    await session(['export', sessionId, '-o', 'out.json', ...flags]);
    expect(Object.keys(JSON.parse(readFileSync(join(state.cwd, 'out.json'), 'utf-8')).data).sort()).toEqual(exported);
  });
});
