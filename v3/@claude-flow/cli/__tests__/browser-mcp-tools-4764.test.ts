import { join } from 'node:path';
import Ajv from 'ajv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserTools } from '../src/mcp-tools/browser-tools.js';
import { browserSessionTools } from '../src/mcp-tools/browser-session-tools.js';
import type { MCPToolResult } from '../src/mcp-tools/types.js';

const driver = vi.hoisted(() => {
  const runSessionCommand = vi.fn();
  const childProcess = {
    execFileSync: vi.fn(),
    execFile: Object.assign(vi.fn(), {
      // Match execFile's custom promisifier, which returns both stdout and stderr.
      [Symbol.for('nodejs.util.promisify.custom')]: runSessionCommand,
    }),
  };
  return { childProcess, runSessionCommand };
});

vi.mock('child_process', () => driver.childProcess);
vi.mock('node:child_process', () => driver.childProcess);
vi.mock('../src/runtime/browser-command.js', () => ({
  resolveAgentBrowserLaunch: () => ({ command: 'agent-browser', argsPrefix: [] }),
  resolveNpxLaunch: () => ({ command: 'npx', argsPrefix: [] }),
}));

// Exercise the same ruvector fallback regardless of what is installed on the host.
vi.mock('node:module', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:module')>(),
  createRequire: () => ({
    resolve: () => { throw new Error('ruvector unavailable in test'); },
  }),
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  mkdir: vi.fn().mockRejectedValue(new Error('Session directory writes are disabled in this test')),
}));

const ajv = new Ajv();
const session = 'mock-session-4764';
const url = 'https://example.invalid/';
const browserExec = driver.childProcess.execFileSync;
const sessionExec = driver.runSessionCommand;

function getTool(name: string) {
  const tool = [...browserTools, ...browserSessionTools].find(candidate => candidate.name === name);
  if (!tool) throw new Error('Missing browser tool: ' + name);
  return tool;
}

function checkRequiredStrings(name: string, input: Record<string, unknown>, required: readonly string[]) {
  const validate = ajv.compile(getTool(name).inputSchema);
  expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
  for (const field of required) {
    const missing = { ...input };
    delete missing[field];
    expect(validate(missing), 'missing ' + field).toBe(false);
    expect(validate.errors?.[0]).toMatchObject({ keyword: 'required', params: { missingProperty: field } });

    expect(validate({ ...input, [field]: 42 }), 'numeric ' + field).toBe(false);
    expect(validate.errors?.[0]).toMatchObject({
      keyword: 'type',
      instancePath: '/' + field,
      params: { type: 'string' },
    });
  }
}

async function expectToolError(name: string, input: Record<string, unknown>, expected: Record<string, unknown>) {
  const result = await getTool(name).handler(input) as MCPToolResult;
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
  expect(JSON.parse(result.content[0].text!)).toMatchObject({ success: false, ...expected });
}

function expectNoDriverCalls() {
  expect(browserExec).not.toHaveBeenCalled();
  expect(sessionExec).not.toHaveBeenCalled();
}

beforeEach(() => {
  browserExec.mockReset();
  browserExec.mockImplementation(() => { throw new Error('Unexpected browser command'); });
  sessionExec.mockReset();
  sessionExec.mockRejectedValue(new Error('Unexpected session command'));
});

const browserCases = [
  {
    name: 'browser_open',
    input: { url, waitUntil: 'load', args: ['--no-sandbox'] },
    required: ['url'],
    invalidField: 'url',
    argv: ['open', url, '--wait-until', 'load', '--args', '--no-sandbox'],
    driverError: 'Navigation failed',
  },
  {
    name: 'browser_click',
    input: { target: '@e1', button: 'right', count: 2 },
    required: ['target'],
    invalidField: 'target',
    argv: ['click', '@e1', '--button', 'right', '--count', '2'],
    driverError: 'Element not found',
  },
  {
    name: 'browser_fill',
    input: { target: '#email', value: 'test@example.invalid' },
    required: ['target', 'value'],
    invalidField: 'value',
    argv: ['fill', '#email', 'test@example.invalid'],
    driverError: 'Element is read-only',
  },
  {
    name: 'browser_type',
    input: { target: '#search', text: 'offline test', delay: 10 },
    required: ['target', 'text'],
    invalidField: 'text',
    argv: ['type', '#search', 'offline test', '--delay', '10'],
    driverError: 'Element is not editable',
  },
  {
    name: 'browser_press',
    input: { key: 'Enter' },
    required: ['key'],
    invalidField: 'key',
    argv: ['press', 'Enter'],
    driverError: 'Key dispatch failed',
  },
  {
    name: 'browser_get-text',
    input: { target: '#message' },
    required: ['target'],
    invalidField: 'target',
    argv: ['get', 'text', '#message'],
    driverError: 'Element detached',
  },
  {
    name: 'browser_eval',
    input: { script: 'document.title' },
    required: ['script'],
    invalidField: 'script',
    argv: ['eval', 'document.title'],
    driverError: 'Execution context was destroyed',
  },
];

describe.each(browserCases)('$name', ({ name, input, required, invalidField, argv, driverError }) => {
  it('validates required fields and their types in the advertised schema', () => {
    checkRequiredStrings(name, { ...input, session }, required);
  });

  it('rejects malformed input before invoking the driver', async () => {
    await expectToolError(name, { ...input, session, [invalidField]: 42 }, {
      error: invalidField + ' must be a string',
    });
    expectNoDriverCalls();
  });

  it('dispatches the requested argv and reports a driver failure as an MCP error', async () => {
    browserExec.mockImplementationOnce(() => {
      throw Object.assign(new Error('Mock driver exited'), {
        status: 1,
        stdout: JSON.stringify({ success: false, error: driverError }),
      });
    });

    await expectToolError(name, { ...input, session }, { error: driverError });
    expect(browserExec).toHaveBeenCalledTimes(1);
    expect(browserExec).toHaveBeenCalledWith(
      'agent-browser', ['--session', session, '--json', ...argv], expect.any(Object),
    );
    expect(sessionExec).not.toHaveBeenCalled();
  });
});

describe('browser_session_record', () => {
  const name = 'browser_session_record';
  const input = { url, task: 'Read test page', session, rvf_dir: 'mock-sessions' };
  const rvfPath = join(input.rvf_dir, session + '.rvf');

  it('validates the required URL and task in the advertised schema', () => {
    checkRequiredStrings(name, input, ['url', 'task']);
  });

  it('rejects an invalid session identifier before invoking the driver', async () => {
    await expectToolError(name, { ...input, session: '../other' }, {
      error: expect.stringMatching(/^session .*path traversal/),
    });
    expectNoDriverCalls();
  });

  it('reports a failed open after the agent-browser fallback also fails', async () => {
    sessionExec
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(Object.assign(new Error('Missing driver'), { code: 'ENOENT' }))
      .mockRejectedValueOnce(Object.assign(new Error('Mock open failed'), { stderr: 'Mock browser unavailable' }));

    await expectToolError(name, input, {
      error: 'browser open failed',
      detail: 'Mock open failed',
      stderr: 'Mock browser unavailable',
      sessionId: session,
      rvfPath,
    });

    const openArgs = ['--session', session, '--json', 'open', url];
    expect(sessionExec.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['npx', ['-y', 'ruvector@0.3.12', 'rvf', 'create', rvfPath, '--dimension', '384']],
      ['npx', ['-y', 'ruvector@0.3.12', 'hooks', 'trajectory-begin',
        '--context', session + ': ' + input.task, '--agent', 'browser-session']],
      ['agent-browser', openArgs],
      ['npx', ['--yes', 'agent-browser', ...openArgs]],
    ]);
    expect(browserExec).not.toHaveBeenCalled();
  });
});

describe('browser_session_end', () => {
  const name = 'browser_session_end';
  const input = { session, rvf_path: join('mock-sessions', session + '.rvf'), verdict: 'partial' };

  it('validates required strings and rejects an unknown verdict in the advertised schema', () => {
    checkRequiredStrings(name, input, ['session', 'rvf_path', 'verdict']);
    const validate = ajv.compile(getTool(name).inputSchema);
    expect(validate({ ...input, verdict: 'unknown' })).toBe(false);
    expect(validate.errors?.[0]).toMatchObject({ keyword: 'enum', instancePath: '/verdict' });
  });

  it('rejects an unknown verdict before invoking the driver', async () => {
    await expectToolError(name, { ...input, verdict: 'unknown' }, { error: 'invalid verdict: unknown' });
    expectNoDriverCalls();
  });

  it('reports a trajectory failure and skips compaction and indexing', async () => {
    sessionExec.mockRejectedValueOnce(Object.assign(new Error('Mock trajectory failed'), {
      stderr: 'No active trajectory',
    }));

    await expectToolError(name, input, {
      error: 'trajectory-end failed',
      detail: 'Mock trajectory failed',
      stderr: 'No active trajectory',
    });
    expect(sessionExec).toHaveBeenCalledTimes(1);
    expect(sessionExec).toHaveBeenCalledWith(
      'npx', ['-y', 'ruvector@0.3.12', 'hooks', 'trajectory-end', '--quality', '0.5'], expect.any(Object),
    );
    expect(browserExec).not.toHaveBeenCalled();
  });
});
