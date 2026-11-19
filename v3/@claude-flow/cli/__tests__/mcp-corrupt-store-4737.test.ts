/**
 * #4737: a corrupt workflow, hive-mind, or swarm store is preserved and
 * reported. A parse error used to return an empty store, and the next save
 * overwrote the file (#4685 class).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { hiveMindTools } from '../src/mcp-tools/hive-mind-tools.js';
import { readPreservedJsonStore } from '../src/mcp-tools/record-store.js';
import { loadSwarmStore, swarmTools } from '../src/mcp-tools/swarm-tools.js';
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';

const tool = (tools: { name: string; handler: (input: Record<string, unknown>) => Promise<unknown> }[], name: string) => {
  const found = tools.find(entry => entry.name === name);
  if (!found) throw new Error(`MCP tool not registered: ${name}`);
  return found;
};

const workflowList = tool(workflowTools, 'workflow_list');
const workflowCreate = tool(workflowTools, 'workflow_create');
const hiveStatus = tool(hiveMindTools, 'hive-mind_status');
const hiveInit = tool(hiveMindTools, 'hive-mind_init');
const swarmStatus = tool(swarmTools, 'swarm_status');
const swarmInit = tool(swarmTools, 'swarm_init');

const CORRUPT = '{"workflows":{"keep":true}, broken';

function corruptCopies(file: string): string[] {
  const dir = dirname(file);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(file)}.corrupt-`;
  return readdirSync(dir).filter(name => name.startsWith(prefix)).sort();
}

describe('readPreservedJsonStore (#4737)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-4737-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reuses an identical backup instead of copying on every read', () => {
    const file = join(dir, 'store.json');
    writeFileSync(file, CORRUPT);
    for (let i = 0; i < 5; i++) {
      expect(() => readPreservedJsonStore(file, 'workflow', () => ({ workflows: {} }))).toThrow(/backed up to/);
    }
    expect(corruptCopies(file)).toHaveLength(1);

    writeFileSync(file, CORRUPT + ' more');
    expect(() => readPreservedJsonStore(file, 'workflow', () => ({ workflows: {} }))).toThrow(/backed up to/);
    expect(corruptCopies(file)).toHaveLength(2);
  });

  it('treats a missing file as empty and writes nothing', () => {
    const file = join(dir, 'store.json');
    const store = readPreservedJsonStore(file, 'workflow', () => ({ workflows: {}, version: '3.0.0' }));
    expect(store).toEqual({ workflows: {}, version: '3.0.0' });
    expect(existsSync(file)).toBe(false);
    expect(corruptCopies(file)).toEqual([]);
  });

  it('backs up unparseable JSON, reports it, and leaves the original bytes', () => {
    const file = join(dir, 'store.json');
    writeFileSync(file, CORRUPT, { mode: 0o600 });
    const before = readFileSync(file);

    expect(() => readPreservedJsonStore(file, 'workflow', () => ({ workflows: {} })))
      .toThrow(/Invalid workflow store at .*store\.json.*corrupt file backed up to .*store\.json\.corrupt-\d+.*existing data was preserved/);

    expect(readFileSync(file)).toEqual(before);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const copies = corruptCopies(file);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/\.corrupt-\d+$/);
    const backup = join(dir, copies[0]);
    expect(readFileSync(backup)).toEqual(before);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
  });

  it('backs up a non-object document instead of treating it as an empty store', () => {
    for (const text of ['[]', 'null', '"nope"', '1']) {
      const file = join(dir, `store-${text.length}.json`);
      writeFileSync(file, text);
      expect(() => readPreservedJsonStore(file, 'hive-mind', () => ({ initialized: false }))).toThrow(/existing data was preserved/);
      expect(readFileSync(file, 'utf8')).toBe(text);
      expect(corruptCopies(file)).toHaveLength(1);
    }
  });

  it('backs up an object whose record map is the wrong type', () => {
    const file = join(dir, 'store.json');
    const text = JSON.stringify({ swarms: [], version: '3.0.0' });
    writeFileSync(file, text);
    expect(() => readPreservedJsonStore(
      file,
      'swarm',
      () => ({ swarms: {}, version: '3.0.0' }),
      (store) => {
        const swarms = (store as { swarms?: unknown }).swarms;
        return swarms === undefined || (!!swarms && typeof swarms === 'object' && !Array.isArray(swarms));
      },
    )).toThrow(/Invalid swarm store/);
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(corruptCopies(file)).toHaveLength(1);
  });

  it('returns a valid object and does not create a backup', () => {
    const file = join(dir, 'store.json');
    const text = JSON.stringify({ swarms: { a: { swarmId: 'a' } }, version: '3.0.0' });
    writeFileSync(file, text);
    const store = readPreservedJsonStore<{ swarms: Record<string, unknown>; version: string }>(
      file,
      'swarm',
      () => ({ swarms: {}, version: '3.0.0' }),
    );
    expect(store.swarms.a).toEqual({ swarmId: 'a' });
    expect(corruptCopies(file)).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('reports an unreadable path without backing it up or replacing it', () => {
    const file = join(dir, 'store.json');
    mkdirSync(file);
    expect(() => readPreservedJsonStore(file, 'workflow', () => ({ workflows: {} }))).toThrow();
    expect(statSync(file).isDirectory()).toBe(true);
    expect(corruptCopies(file)).toEqual([]);
  });
});

describe('workflow, hive-mind, and swarm tools preserve a corrupt store (#4737)', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-4737-tools-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  const cases: Array<{
    label: string;
    file: (root: string) => string;
    text: string;
    read: () => Promise<unknown>;
    write: () => Promise<unknown>;
  }> = [
    {
      label: 'workflow',
      file: root => join(root, '.claude-flow', 'workflows', 'store.json'),
      text: CORRUPT,
      read: () => workflowList.handler({}),
      write: () => workflowCreate.handler({ name: 'should-not-land' }),
    },
    {
      label: 'hive-mind',
      file: root => join(root, '.claude-flow', 'hive-mind', 'state.json'),
      text: '{"initialized":true,"hiveToken":"secret-token", oops',
      read: () => hiveStatus.handler({}),
      write: () => hiveInit.handler({ topology: 'mesh' }),
    },
    {
      label: 'swarm',
      file: root => join(root, '.claude-flow', 'swarm', 'swarm-state.json'),
      text: '{"swarms":{"swarm-1":{"status":"running"}}, trailing',
      read: () => swarmStatus.handler({}),
      write: () => swarmInit.handler({ topology: 'mesh' }),
    },
  ];

  for (const entry of cases) {
    it(`${entry.label}: a read and a later save report the error and do not overwrite the file`, async () => {
      const file = entry.file(dir);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, entry.text, { mode: 0o600 });
      chmodSync(file, 0o600);

      await expect(entry.read()).rejects.toThrow(new RegExp(`Invalid ${entry.label} store`));
      await expect(entry.write()).rejects.toThrow(/existing data was preserved/);

      expect(readFileSync(file, 'utf8')).toBe(entry.text);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const copies = corruptCopies(file);
      expect(copies.length).toBeGreaterThan(0);
      expect(copies.every(name => new RegExp(`^${basename(file).replace('.', '\\.')}\\.corrupt-\\d+(-\\d+)?$`).test(name))).toBe(true);
      for (const name of copies) {
        expect(readFileSync(join(dirname(file), name), 'utf8')).toBe(entry.text);
      }
    });
  }

  it('a missing store is still empty, and a valid store still loads', async () => {
    const listed = await workflowList.handler({}) as { workflows: unknown[]; total: number };
    expect(listed.total).toBe(0);
    expect(existsSync(join(dir, '.claude-flow', 'workflows', 'store.json'))).toBe(false);

    const created = await workflowCreate.handler({ name: 'kept' }) as { workflowId: string };
    const storePath = join(dir, '.claude-flow', 'workflows', 'store.json');
    const again = await workflowList.handler({}) as { workflows: Array<{ workflowId: string }>; total: number };
    expect(again.total).toBe(1);
    expect(again.workflows[0].workflowId).toBe(created.workflowId);
    expect(corruptCopies(storePath)).toEqual([]);

    const hivePath = join(dir, '.claude-flow', 'hive-mind', 'state.json');
    mkdirSync(dirname(hivePath), { recursive: true });
    writeFileSync(hivePath, JSON.stringify({
      initialized: true,
      topology: 'mesh',
      workers: [],
      consensus: { pending: [], history: [] },
      sharedMemory: {},
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    }));
    const hive = await hiveStatus.handler({}) as { status: string; topology: string };
    expect(hive.status).toBe('active');
    expect(hive.topology).toBe('mesh');
    expect(corruptCopies(hivePath)).toEqual([]);

    const swarmPath = join(dir, '.claude-flow', 'swarm', 'swarm-state.json');
    mkdirSync(dirname(swarmPath), { recursive: true });
    writeFileSync(swarmPath, JSON.stringify({
      swarms: {
        'swarm-1': {
          swarmId: 'swarm-1',
          topology: 'mesh',
          maxAgents: 3,
          status: 'paused',
          agents: [],
          tasks: [],
          config: {},
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      },
      version: '3.0.0',
    }));
    const swarm = await swarmStatus.handler({}) as { swarmId: string; status: string };
    expect(swarm.swarmId).toBe('swarm-1');
    expect(swarm.status).toBe('paused');
    expect(corruptCopies(swarmPath)).toEqual([]);
    expect(Object.getPrototypeOf(loadSwarmStore().swarms)).toBeNull();
  });

  it('gives a missing swarm record map a null prototype and does not create the file', () => {
    const swarmPath = join(dir, '.claude-flow', 'swarm', 'swarm-state.json');
    const store = loadSwarmStore();
    expect(Object.getPrototypeOf(store.swarms)).toBeNull();
    expect(store.swarms.constructor).toBeUndefined();
    expect(existsSync(swarmPath)).toBe(false);
  });

  it('a workflow store whose workflows map is an array is not replaced by defaults', async () => {
    const file = join(dir, '.claude-flow', 'workflows', 'store.json');
    mkdirSync(dirname(file), { recursive: true });
    const text = JSON.stringify({ workflows: ['not-a-map'], templates: {}, version: '3.0.0' });
    writeFileSync(file, text);

    await expect(workflowList.handler({})).rejects.toThrow(/Invalid workflow store/);
    await expect(workflowCreate.handler({ name: 'should-not-land' })).rejects.toThrow(/existing data was preserved/);
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(corruptCopies(file).length).toBeGreaterThan(0);
  });
});
