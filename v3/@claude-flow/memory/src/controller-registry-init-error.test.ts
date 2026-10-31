/**
 * #4622: when AgentDB's native vector store is locked by another process,
 * AgentDB logs why and falls back to a backend that rejects the same file as
 * the wrong format. The registry must report the lock, not only the fallback.
 *
 * `agentdb` is replaced with a stand-in that does what AgentDB's backend
 * factory does in that case: log the first failure, then throw the last.
 */
import { describe, it, expect, vi } from 'vitest';

const mode = vi.hoisted(() => ({ fail: true }));

vi.mock('agentdb', () => {
  class FakeAgentDB {
    constructor(_cfg: { dbPath: string }) {}
    async initialize() {
      if (!mode.fail) return;
      console.log('[AgentDB] RuVector initialization failed, trying RVF backend');
      console.log('[AgentDB] Reason: Database already open. Cannot acquire lock');
      throw new Error('file is not a database\n    at SqlJsRvfBackend.initialize');
    }
    async close() {}
    getController() { return null; }
  }
  return { AgentDB: FakeAgentDB, default: FakeAgentDB };
});

import { ControllerRegistry, describeAgentdbInitFailure } from './controller-registry.js';

describe('describeAgentdbInitFailure', () => {
  it('leads with the first backend failure and names the fallback error', () => {
    const text = describeAgentdbInitFailure('file is not a database', ['Database already open. Cannot acquire lock']);
    expect(text.startsWith('Database already open. Cannot acquire lock (fallback backend then failed: file is not a database)')).toBe(true);
    expect(text).toContain('ruflo mcp start --transport http');
  });

  it('returns the final error alone when nothing else was logged', () => {
    expect(describeAgentdbInitFailure('boom\nstack', [])).toBe('boom');
  });

  it('explains a bare format rejection without claiming corruption', () => {
    const text = describeAgentdbInitFailure('file is not a database', []);
    expect(text).toContain('does not mean the file is corrupt');
    expect(text).toContain('ruflo mcp start --transport http');
  });

  it('adds the shared-owner hint only for lock contention', () => {
    expect(describeAgentdbInitFailure('file is not a database', ['ENOENT: no such file'])).not.toContain('mcp start');
  });
});

describe('ControllerRegistry AgentDB init failure (#4622)', () => {
  it('keeps the original lock error and exposes it', async () => {
    mode.fail = true;
    const reg = new ControllerRegistry();
    const unavailable: Array<{ reason: string }> = [];
    reg.on('agentdb:unavailable', (e) => unavailable.push(e));
    await reg.initialize({ dbPath: '/tmp/ruflo-4622-test/agentdb-memory.db', controllers: {} as any });

    expect(reg.getAgentDB()).toBeNull();
    const err = reg.getAgentDBInitError();
    expect(err).toMatch(/^Database already open\. Cannot acquire lock \(fallback backend then failed: file is not a database\)/);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].reason).toBe(err);
    await reg.shutdown();
  });

  it('reports no error when AgentDB opens', async () => {
    mode.fail = false;
    const reg = new ControllerRegistry();
    await reg.initialize({ dbPath: '/tmp/ruflo-4622-test/agentdb-memory.db', controllers: {} as any });
    expect(reg.getAgentDB()).not.toBeNull();
    expect(reg.getAgentDBInitError()).toBeNull();
    await reg.shutdown();
  });
});
