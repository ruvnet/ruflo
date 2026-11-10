/**
 * terminal_execute with a sessionId that is not in the store silently created
 * a new "Default Terminal" (with a different id, the project cwd and an empty
 * env) and ran the command there, instead of reporting the unknown session
 * like terminal_close and terminal_history do.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminalTools } from '../src/mcp-tools/terminal-tools.js';

const executeTool = terminalTools.find(t => t.name === 'terminal_execute')!;

type ExecuteResult = { success: boolean; error?: string; sessionId?: string; output?: string };

describe('terminal_execute with an unknown sessionId', () => {
  let dir: string;
  let storePath: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-terminal-execute-unknown-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    const storeDir = join(dir, '.claude-flow', 'terminals');
    mkdirSync(storeDir, { recursive: true });
    storePath = join(storeDir, 'store.json');
    writeFileSync(storePath, JSON.stringify({
      version: '3.0.0',
      sessions: {
        'term-a': {
          id: 'term-a',
          name: 'term-a',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActivity: '2026-01-01T00:00:00.000Z',
          workingDir: dir,
          history: [],
          env: {},
        },
      },
    }));
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports the session as not found and runs nothing', async () => {
    const marker = join(dir, 'ran.txt');
    const result = await executeTool.handler({
      sessionId: 'term-missing',
      command: `echo x > "${marker}"`,
    }) as ExecuteResult;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
    expect(() => readFileSync(marker)).toThrow();
  });

  it('does not add a replacement session to the store', async () => {
    await executeTool.handler({ sessionId: 'term-missing', command: 'echo hi' });
    const store = JSON.parse(readFileSync(storePath, 'utf-8'));
    expect(Object.keys(store.sessions)).toEqual(['term-a']);
  });

  it('still runs in the given session when it exists', async () => {
    const result = await executeTool.handler({ sessionId: 'term-a', command: 'echo hi' }) as ExecuteResult;
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('term-a');
    expect(result.output?.trim()).toBe('hi');
  });

  it('still creates a default session when no sessionId is given and none is active', async () => {
    const store = JSON.parse(readFileSync(storePath, 'utf-8'));
    store.sessions['term-a'].status = 'closed';
    writeFileSync(storePath, JSON.stringify(store));

    const result = await executeTool.handler({ command: 'echo hi' }) as ExecuteResult;
    expect(result.success).toBe(true);
    expect(result.sessionId).not.toBe('term-a');
  });
});
