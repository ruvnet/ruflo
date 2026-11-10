/**
 * #4674: every initialize created a session, and the server only ever answers
 * through the newest one (currentSession). Superseded sessions were never
 * addressed again but held a slot until the 30-minute expiry, so 100
 * short-lived clients exhausted maxSessions and the next initialize failed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMCPServer, createSessionManager } from '../src/index.js';
import type { ILogger } from '../src/types.js';

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as ILogger;

describe('SessionManager.reserveCapacity (#4674)', () => {
  it('does nothing while there is room', () => {
    const manager = createSessionManager(logger, { maxSessions: 2 });
    const a = manager.createSession('http');
    expect(manager.reserveCapacity()).toBeUndefined();
    expect(manager.getSession(a.id)).toBeDefined();
    manager.destroy();
  });

  it('closes the least recently active session other than the kept one', () => {
    const manager = createSessionManager(logger, { maxSessions: 2 });
    const oldest = manager.createSession('http');
    const kept = manager.createSession('http');
    oldest.lastActivityAt = new Date(Date.now() - 60_000);
    kept.lastActivityAt = new Date(Date.now() - 120_000); // older still, but protected

    expect(manager.reserveCapacity(kept.id)).toBe(oldest.id);
    expect(manager.getSession(oldest.id)).toBeUndefined();
    expect(manager.getSession(kept.id)).toBeDefined();
    expect(() => manager.createSession('http')).not.toThrow();
    manager.destroy();
  });
});

describe('MCPServer initialize past maxSessions (#4674)', () => {
  let server: ReturnType<typeof createMCPServer>;
  afterEach(async () => { await server.stop(); });

  it('keeps accepting short-lived clients and still serves requests', async () => {
    server = createMCPServer({ name: 'Test Server', transport: 'in-process' }, logger);
    const handle = (request: Record<string, unknown>) =>
      (server as unknown as { handleRequest(r: unknown): Promise<any> }).handleRequest({ jsonrpc: '2.0', ...request });

    for (let i = 0; i < 105; i++) {
      const res = await handle({
        id: i,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: `client-${i}`, version: '1' } },
      });
      expect(res.error, `initialize #${i}`).toBeUndefined();
    }

    expect(server.getSessions().length).toBeLessThanOrEqual(100);
    const list = await handle({ id: 'list', method: 'tools/list', params: {} });
    expect(list.error).toBeUndefined();
    expect(Array.isArray(list.result?.tools)).toBe(true);
  });
});
