/**
 * The session hook (`session.js`, written by init) stores `current.json` and
 * `session-<n>.json` archives shaped `{ id, startedAt, ... }` in the same
 * directory session_save uses. session_list already reads both shapes
 * (ADR-093 F6); session_info and session_current returned an undefined
 * sessionId and time for them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionTools } from '../src/mcp-tools/session-tools.js';

const tool = (name: string) => {
  const t = sessionTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

const startedAt = '2026-10-27T10:00:00.000Z';

describe('session tools read session-hook records', () => {
  let dir: string;
  let sessionDir: string;
  let prevCwd: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-session-hook-shape-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    await tool('session_save').handler({ name: 'saved', includeMemory: false, includeTasks: false, includeAgents: false });
    sessionDir = join(dir, '.claude-flow', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const hookRecord = { id: 'session-1761559200000', startedAt, cwd: dir, context: {}, metrics: { edits: 0, commands: 0, tasks: 0, errors: 0 } };
    writeFileSync(join(sessionDir, 'session-1761559200000.json'), JSON.stringify({ ...hookRecord, endedAt: startedAt }));
    const current = join(sessionDir, 'current.json');
    writeFileSync(current, JSON.stringify(hookRecord));
    // The hook rewrites current.json on every update, so it is the newest file.
    const later = new Date(Date.now() + 60_000);
    utimesSync(current, later, later);
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('session_info reports the id and start time of an archived hook session', async () => {
    const info = await tool('session_info').handler({ sessionId: 'session-1761559200000' }) as Record<string, unknown>;
    expect(info.error).toBeUndefined();
    expect(info.sessionId).toBe('session-1761559200000');
    expect(info.name).toBe('session-1761559200000');
    expect(info.savedAt).toBe(startedAt);
  });

  it('session_current reports the id and start time of current.json', async () => {
    const current = await tool('session_current').handler({}) as Record<string, unknown>;
    expect(current.status).toBe('active');
    expect(current.sessionId).toBe('session-1761559200000');
    expect(current.startedAt).toBe(startedAt);
  });

  it('session_info still reports a saved session as written', async () => {
    const list = await tool('session_list').handler({ sortBy: 'name' }) as { sessions: Array<{ sessionId: string; name: string }> };
    const saved = list.sessions.find(s => s.name === 'saved');
    expect(saved).toBeDefined();
    const info = await tool('session_info').handler({ sessionId: saved!.sessionId }) as Record<string, unknown>;
    expect(info.sessionId).toBe(saved!.sessionId);
    expect(info.name).toBe('saved');
    expect(typeof info.savedAt).toBe('string');
    expect(info.savedAt).not.toBe('');
  });
});
