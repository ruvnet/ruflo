/**
 * #4730: after terminal_create + terminal_close, terminal_execute still ran
 * the command and reported success, then set the session back to "active".
 * A session whose status is not "active" must error and must not run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminalTools } from '../src/mcp-tools/terminal-tools.js';

const createTool = terminalTools.find(t => t.name === 'terminal_create')!;
const closeTool = terminalTools.find(t => t.name === 'terminal_close')!;
const executeTool = terminalTools.find(t => t.name === 'terminal_execute')!;

type ToolResult = {
  success: boolean;
  error?: string;
  sessionId?: string;
  output?: string;
};

interface StoredSession {
  id: string;
  status: string;
  history: unknown[];
}

function readStore(dir: string): { sessions: Record<string, StoredSession> } {
  return JSON.parse(readFileSync(join(dir, '.claude-flow', 'terminals', 'store.json'), 'utf-8'));
}

describe('terminal_execute on a non-active session (#4730)', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let prevEncrypt: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-terminal-execute-closed-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    prevEncrypt = process.env.CLAUDE_FLOW_ENCRYPT_AT_REST;
    process.env.CLAUDE_FLOW_CWD = dir;
    delete process.env.CLAUDE_FLOW_ENCRYPT_AT_REST;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    if (prevEncrypt === undefined) delete process.env.CLAUDE_FLOW_ENCRYPT_AT_REST;
    else process.env.CLAUDE_FLOW_ENCRYPT_AT_REST = prevEncrypt;
    rmSync(dir, { recursive: true, force: true });
  });

  it('errors after terminal_close and does not run the command', async () => {
    const created = await createTool.handler({ name: 'closed-session' }) as ToolResult;
    expect(created.success).toBe(true);
    const sessionId = created.sessionId!;

    const closed = await closeTool.handler({ sessionId }) as ToolResult;
    expect(closed.success).toBe(true);

    const marker = join(dir, 'ran.txt');
    const result = await executeTool.handler({
      sessionId,
      command: `echo still-running > "${marker}"`,
    }) as ToolResult;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session is not active (closed)');
    expect(result.output).toBeUndefined();
    expect(existsSync(marker)).toBe(false);

    const store = readStore(dir);
    expect(store.sessions[sessionId].status).toBe('closed');
    expect(store.sessions[sessionId].history).toEqual([]);
    expect(Object.keys(store.sessions)).toEqual([sessionId]);
  });

  it('rejects an idle session the same way', async () => {
    const created = await createTool.handler({ name: 'idle-session' }) as ToolResult;
    const sessionId = created.sessionId!;
    const store = readStore(dir);
    store.sessions[sessionId].status = 'idle';
    writeFileSync(join(dir, '.claude-flow', 'terminals', 'store.json'), JSON.stringify(store));

    const marker = join(dir, 'ran.txt');
    const result = await executeTool.handler({
      sessionId,
      command: `echo still-running > "${marker}"`,
    }) as ToolResult;

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session is not active (idle)');
    expect(existsSync(marker)).toBe(false);
    expect(readStore(dir).sessions[sessionId].status).toBe('idle');
  });

  it('still executes in an active session', async () => {
    const created = await createTool.handler({ name: 'live-session' }) as ToolResult;
    const result = await executeTool.handler({
      sessionId: created.sessionId,
      command: 'echo still-running',
    }) as ToolResult;

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe(created.sessionId);
    expect(result.output?.trim()).toBe('still-running');
    expect(readStore(dir).sessions[created.sessionId!].status).toBe('active');
  });

  it('still creates a default session when no sessionId is given and none is active', async () => {
    const created = await createTool.handler({}) as ToolResult;
    const closed = await closeTool.handler({ sessionId: created.sessionId }) as ToolResult;
    expect(closed.success).toBe(true);

    const result = await executeTool.handler({ command: 'echo hi' }) as ToolResult;
    expect(result.success).toBe(true);
    expect(result.sessionId).not.toBe(created.sessionId);
    expect(result.output?.trim()).toBe('hi');
  });
});
