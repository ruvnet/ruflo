/**
 * #4622: a registry whose AgentDB failed to open (e.g. its native vector
 * store is locked by another stdio MCP process) still initialises, so the
 * bridge cached it as healthy and recorded no reason. Database operations then
 * fell back to sql.js, whose WAL refusal hid the lock. The bridge now records
 * the registry's own AgentDB failure and does not report itself available.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  __setMemoryBridgeRegistryFactoryForTests,
  _resetRegistryCacheForTest,
  getBridgeFailureReason,
  isBridgeAvailable,
} from '../src/memory/memory-bridge.js';

function fakeRegistry(initError: string | null, hasRecord = true) {
  const controllers = new Map<string, unknown>();
  const reg: Record<string, unknown> = {
    initialize: async () => {},
    shutdown: async () => {},
    getAgentDB: () => (initError ? null : {}),
    get: (name: string) => controllers.get(name),
    set: (name: string, value: unknown) => { controllers.set(name, value); },
  };
  if (hasRecord) reg.getAgentDBInitError = () => initError;
  return reg;
}

let dir: string | undefined;
function dbFile(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-4622-'));
  return path.join(fs.realpathSync(dir), 'agentdb-memory.db');
}

afterEach(() => {
  _resetRegistryCacheForTest();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('memory bridge: AgentDB init failure (#4622)', () => {
  it('records the registry\'s AgentDB failure and reports the bridge unavailable', async () => {
    const lock = 'Database already open. Cannot acquire lock (fallback backend then failed: file is not a database)';
    __setMemoryBridgeRegistryFactoryForTests(() => fakeRegistry(lock));
    const db = dbFile();

    expect(await isBridgeAvailable(db)).toBe(false);
    expect(getBridgeFailureReason(db)).toBe(`AgentDB did not open ${db}: ${lock}`);
  });

  it('records nothing when AgentDB opened', async () => {
    __setMemoryBridgeRegistryFactoryForTests(() => fakeRegistry(null));
    const db = dbFile();

    expect(await isBridgeAvailable(db)).toBe(true);
    expect(getBridgeFailureReason(db)).toBeNull();
  });

  it('changes nothing for an older registry without the record', async () => {
    __setMemoryBridgeRegistryFactoryForTests(() => fakeRegistry('ignored', false));
    const db = dbFile();

    expect(await isBridgeAvailable(db)).toBe(true);
    expect(getBridgeFailureReason(db)).toBeNull();
  });
});
