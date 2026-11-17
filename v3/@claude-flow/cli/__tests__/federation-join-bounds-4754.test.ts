import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '', sockets: [] as string[] }));
vi.mock('node:os', async (original) => ({
  ...await original<typeof import('node:os')>(), homedir: () => state.root,
}));
vi.mock('nostr-tools/pure', () => ({
  generateSecretKey: () => new Uint8Array(32).fill(1),
  getPublicKey: () => 'public-test-key',
  finalizeEvent: (event: object) => ({ ...event, id: 'signed-test-event' }),
}));
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: class extends EventEmitter {
    constructor(url: string) {
      super();
      state.sockets.push(url);
      queueMicrotask(() => this.emit('message', Buffer.from('["AUTH","local-test"]')));
    }
    send() {
      queueMicrotask(() => this.emit('message', Buffer.from('["OK","signed-test-event",true,""]')));
    }
    close() {}
  } };
});
import { xFederationJoinTools } from '../src/mcp-tools/x-federation-join.js';
const joinTool = xFederationJoinTools[0];

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'ruflo-join-bounds-'));
  state.sockets.length = 0;
  vi.stubEnv('RUFLO_NOSTR_KEY_FILE', '');
  vi.stubEnv('RUFLO_X_RELAY_WS', '');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected registration'); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(state.root, { recursive: true, force: true });
});

describe('federation join caller bounds (#4754)', () => {
  it.each(['outside.key', '.ruflo/../outside.key', '.ruflo-escape/key', '.ruflo'])(
    'rejects a key outside the allowed file subtree: %s', async (name) => {
      const keyFile = join(state.root, name);
      await expect(joinTool.handler({ keyFile })).rejects.toThrow(/keyFile|\.ruflo/);
      expect(state.sockets).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      expect(existsSync(join(state.root, 'outside.key'))).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')('rejects a symlink under the allowed subtree', async () => {
    const directory = join(state.root, '.ruflo');
    mkdirSync(directory);
    const keyFile = join(directory, 'key');
    symlinkSync(join(state.root, 'outside.key'), keyFile);

    await expect(joinTool.handler({ keyFile })).rejects.toThrow(/symlink|keyFile/);
    expect(existsSync(join(state.root, 'outside.key'))).toBe(false);
    expect(state.sockets).toEqual([]);
  });

  it.each(['wss://other.invalid', 'ws://relay.ruv.io', 'wss://user@relay.ruv.io',
    'wss://relay.ruv.io/#fragment', 'wss://relay.ruv.io:1234'])(
    'rejects an unconfigured or insecure relay %s before creating a key', async (relayWs) => {
      await expect(joinTool.handler({ relayWs })).rejects.toThrow(/relayWs|configured|wss/);
      expect(existsSync(join(state.root, '.ruflo'))).toBe(false);
      expect(state.sockets).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('accepts an inside key path and the normalized configured relay', async () => {
    const keyFile = join(state.root, '.ruflo', 'nested', 'key');

    expect(await joinTool.handler({ keyFile, relayWs: 'wss://relay.ruv.io/' })).toMatchObject({
      ok: true, keyCreated: true, alreadyMember: true,
    });
    expect(existsSync(keyFile)).toBe(true);
    expect(state.sockets).toHaveLength(1);
  });

  it('keeps operator-owned key and relay configuration when no key override is supplied', async () => {
    const keyFile = join(state.root, 'host-owned.key');
    vi.stubEnv('RUFLO_NOSTR_KEY_FILE', keyFile);
    vi.stubEnv('RUFLO_X_RELAY_WS', 'wss://configured.invalid/membership');

    expect(await joinTool.handler({})).toMatchObject({ ok: true });
    expect(existsSync(keyFile)).toBe(true);
    expect(state.sockets).toEqual(['wss://configured.invalid/membership']);
    await expect(joinTool.handler({ keyFile })).rejects.toThrow(/keyFile|\.ruflo/);
  });

  it.skipIf(process.platform !== 'win32')('accepts case-insensitive Windows root spelling', async () => {
    expect(await joinTool.handler({ keyFile: join(state.root, '.RUFLO', 'key') }))
      .toMatchObject({ ok: true, keyCreated: true });
  });

  it('permits a loopback ws relay only when explicitly configured by the host', async () => {
    vi.stubEnv('RUFLO_X_RELAY_WS', 'ws://127.0.0.1:12345');
    expect(await joinTool.handler({ relayWs: 'ws://127.0.0.1:12345/' })).toMatchObject({ ok: true });
    await expect(joinTool.handler({ relayWs: 'ws://127.0.0.1:54321' })).rejects.toThrow(/configured|relayWs/);
  });
});
