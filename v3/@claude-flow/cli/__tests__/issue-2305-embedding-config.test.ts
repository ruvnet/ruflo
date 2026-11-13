/**
 * #2305 — the memory path ignored `.claude-flow/embeddings.json`.
 *
 * `embeddings init` writes `{ model, dimension }` there, but memory init
 * (memory-initializer.ts), the AgentDB bridge and the router's task embedder
 * all hardcoded 'Xenova/all-MiniLM-L6-v2' / 384. These tests pin:
 *
 *  1. no config → MiniLM/384, unchanged;
 *  2. a 768-dim model in the config → used by memory init and task-embedder;
 *  3. an existing store whose recorded dimension differs → recorded dimension
 *     kept, plus exactly one warning (no mixing, no rebuild);
 *  4. malformed JSON → defaults plus a warning.
 *
 * London-school: the transformers packages are mocked and only record which
 * model id `pipeline()` was asked for; the project root is a temp dir served
 * through a `process.cwd()` spy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const local = vi.hoisted(() => ({
  hfModels: [] as string[],
  xenModels: [] as string[],
  dimFor(model: string): number {
    return /mpnet/i.test(model) ? 768 : 384;
  },
}));

vi.mock('@huggingface/transformers', () => ({
  pipeline: async (_task: string, model: string) => {
    local.hfModels.push(model);
    const dim = local.dimFor(model);
    return async () => ({ data: new Float32Array(dim).fill(0.25) });
  },
  env: {},
}));
vi.mock('@xenova/transformers', () => ({
  pipeline: async (_task: string, model: string) => {
    local.xenModels.push(model);
    const dim = local.dimFor(model);
    return async (input: string | string[]) => {
      const n = Array.isArray(input) ? input.length : 1;
      return { data: new Float32Array(n * dim).fill(0.25), dims: [n, dim] };
    };
  },
  env: {},
}));
vi.mock('agentic-flow/reasoningbank', () => ({ computeEmbedding: undefined }));
vi.mock('ruvector', () => ({ initOnnxEmbedder: undefined, getOptimizedOnnxEmbedder: undefined }));
vi.mock('../src/memory/intelligence.js', () => ({
  initializeIntelligence: vi.fn(async () => ({ reasoningBankEnabled: false, sonaEnabled: false })),
}));

const MPNET_CONFIG = { model: 'Xenova/all-mpnet-base-v2', modelPath: '/x', dimension: 768 };

let root: string;

function writeConfig(body: string): void {
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  writeFileSync(join(root, '.claude-flow', 'embeddings.json'), body);
}

/** A memory.db whose newest real vector is `dimension`-dim, written by sql.js. */
async function writeStore(dimension: number, model: string): Promise<string> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE memory_entries (id TEXT, key TEXT, embedding TEXT,
    embedding_dimensions INTEGER, embedding_model TEXT)`);
  db.run(`INSERT INTO memory_entries VALUES ('a', 'k', ?, ?, ?)`, [
    JSON.stringify(new Array(dimension).fill(0.1)), dimension, model,
  ]);
  const dir = join(root, '.swarm');
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'memory.db');
  writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  return dbPath;
}

async function freshConfigModule() {
  const mod = await import('../src/memory/embedding-config.js');
  mod._resetEmbeddingConfigCache();
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-2305-')));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  local.hfModels = [];
  local.xenModels = [];
  delete process.env.CLAUDE_FLOW_MEMORY_PATH;
  delete process.env.CLAUDE_FLOW_DB_PATH;
  delete process.env.RUFLO_REQUIRE_REAL_EMBEDDINGS;
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  rmSync(root, { recursive: true, force: true });
});

describe('resolveEmbeddingConfig', () => {
  it('defaults to MiniLM/384 when no embeddings.json exists', async () => {
    const { resolveEmbeddingConfig } = await freshConfigModule();
    expect(resolveEmbeddingConfig(root)).toMatchObject({
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: 384,
      source: 'default',
    });
  });

  it('reads model and dimension written by `embeddings init`, namespacing a bare model name', async () => {
    writeConfig(JSON.stringify({ model: 'all-mpnet-base-v2', dimension: 768 }));
    const { resolveEmbeddingConfig } = await freshConfigModule();
    expect(resolveEmbeddingConfig(root)).toMatchObject({
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      source: 'config',
    });
  });

  it('falls back to defaults with one warning when the JSON is malformed', async () => {
    writeConfig('{ "model": "Xenova/all-mpnet-base-v2", ');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolveEmbeddingConfig } = await freshConfigModule();
    const cfg = resolveEmbeddingConfig(root);
    resolveEmbeddingConfig(root);
    expect(cfg).toMatchObject({ model: 'Xenova/all-MiniLM-L6-v2', dimension: 384, source: 'default' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/not valid JSON/);
  });
});

describe('existing store with a different recorded dimension', () => {
  it('keeps the recorded dimension and warns once instead of mixing vectors', async () => {
    writeConfig(JSON.stringify(MPNET_CONFIG));
    const dbPath = await writeStore(384, 'Xenova/all-MiniLM-L6-v2');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolveEffectiveEmbeddingConfig } = await freshConfigModule();

    const eff = await resolveEffectiveEmbeddingConfig({ root, dbPaths: [dbPath] });
    await resolveEffectiveEmbeddingConfig({ root, dbPaths: [dbPath] });

    expect(eff).toMatchObject({ model: 'Xenova/all-MiniLM-L6-v2', dimension: 384, source: 'recorded' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/384-dim vectors.*768-dim/s);
  });

  it('follows the config when the store holds no real vectors yet', async () => {
    writeConfig(JSON.stringify(MPNET_CONFIG));
    const dbPath = await writeStore(128, 'hash-fallback');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolveEffectiveEmbeddingConfig } = await freshConfigModule();

    const eff = await resolveEffectiveEmbeddingConfig({ root, dbPaths: [dbPath] });
    expect(eff).toMatchObject({ model: 'Xenova/all-mpnet-base-v2', dimension: 768, source: 'config' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('memory init (loadEmbeddingModel) uses the resolved config', () => {
  it('loads MiniLM/384 when nothing is configured (unchanged default)', async () => {
    const init = await import('../src/memory/memory-initializer.js');
    const res = await init.loadEmbeddingModel();
    expect(local.hfModels).toEqual(['Xenova/all-MiniLM-L6-v2']);
    expect(res).toMatchObject({ success: true, dimensions: 384, modelName: 'Xenova/all-MiniLM-L6-v2' });
  });

  it('loads the configured 768-dim model', async () => {
    writeConfig(JSON.stringify(MPNET_CONFIG));
    const init = await import('../src/memory/memory-initializer.js');
    const res = await init.loadEmbeddingModel();
    expect(local.hfModels).toEqual(['Xenova/all-mpnet-base-v2']);
    expect(res).toMatchObject({ success: true, dimensions: 768, modelName: 'Xenova/all-mpnet-base-v2' });
  });

  it('keeps an existing 384-dim store on MiniLM and warns', async () => {
    writeConfig(JSON.stringify(MPNET_CONFIG));
    await writeStore(384, 'Xenova/all-MiniLM-L6-v2');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const init = await import('../src/memory/memory-initializer.js');
    const res = await init.loadEmbeddingModel();
    expect(local.hfModels).toEqual(['Xenova/all-MiniLM-L6-v2']);
    expect(res.dimensions).toBe(384);
    expect(warn.mock.calls.filter((c) => /Keeping 384 dimensions/.test(String(c[0])))).toHaveLength(1);
  });

  it('seeds a fresh store\'s vector_indexes with the configured dimension', async () => {
    const init = await import('../src/memory/memory-initializer.js');
    const sql = init.getInitialMetadata('hybrid', 768);
    expect(sql).toMatch(/\('default', 'default', 768\)/);
    expect(init.getInitialMetadata('hybrid')).toMatch(/\('default', 'default', 384\)/);
  });
});

describe('task-embedder uses the resolved config', () => {
  it('loads MiniLM when nothing is configured', async () => {
    const te = await import('../src/ruvector/task-embedder.js');
    te.__resetTaskEmbedderForTests();
    const v = await te.embedTaskWithCache('route this task');
    expect(local.xenModels).toEqual(['Xenova/all-MiniLM-L6-v2']);
    expect(v).toHaveLength(384);
  });

  it('loads the configured 768-dim model', async () => {
    writeConfig(JSON.stringify(MPNET_CONFIG));
    const te = await import('../src/ruvector/task-embedder.js');
    te.__resetTaskEmbedderForTests();
    const v = await te.embedTaskWithCache('route this task');
    expect(local.xenModels).toEqual(['Xenova/all-mpnet-base-v2']);
    expect(v).toHaveLength(768);
  });
});

describe('AgentDB bridge registry uses the resolved config', () => {
  class RecordingRegistry {
    static options: Array<{ dbPath: string; embeddingModel: string; dimension: number; embeddingGenerator?: unknown }> = [];
    async initialize(options: { dbPath: string; embeddingModel: string; dimension: number; embeddingGenerator?: unknown }) {
      RecordingRegistry.options.push(options);
    }
    get() { return null; }
    getAgentDB() { return null; }
    async shutdown() {}
  }

  async function openBridge() {
    delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    RecordingRegistry.options = [];
    const bridge = await import('../src/memory/memory-bridge.js');
    bridge._resetRegistryCacheForTest();
    bridge.__setMemoryBridgeRegistryFactoryForTests(() => new RecordingRegistry());
    const agentdbPath = join(root, '.swarm', 'agentdb-memory.db');
    expect(await bridge.getControllerRegistry(agentdbPath)).not.toBeNull();
    await bridge.shutdownBridge();
    return RecordingRegistry.options;
  }

  it('opens AgentDB with MiniLM/384 when nothing is configured', async () => {
    const [opts] = await openBridge();
    expect(opts).toMatchObject({ embeddingModel: 'Xenova/all-MiniLM-L6-v2', dimension: 384 });
    expect(opts.embeddingGenerator).toBeUndefined(); // #4984: default model keeps AgentDB's own embedder
  });

  it('opens AgentDB with the configured 768-dim model', async () => {
    writeConfig(JSON.stringify(MPNET_CONFIG));
    const [opts] = await openBridge();
    expect(opts).toMatchObject({ embeddingModel: 'Xenova/all-mpnet-base-v2', dimension: 768 });
    // #4984: AgentDB hardcodes MiniLM, so a configured model must arrive as an embedder.
    expect(typeof opts.embeddingGenerator).toBe('function');
  });

  it('keeps 384 when only memory.db holds 384-dim vectors, so the bridge cannot mix stores', async () => {
    writeConfig(JSON.stringify(MPNET_CONFIG));
    await writeStore(384, 'Xenova/all-MiniLM-L6-v2'); // memory.db only; agentdb-memory.db absent
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [opts] = await openBridge();
    expect(opts).toMatchObject({ embeddingModel: 'Xenova/all-MiniLM-L6-v2', dimension: 384 });
    expect(opts.embeddingGenerator).toBeUndefined(); // store pinned to 384/MiniLM: no mixing
    expect(warn.mock.calls.filter((c) => /Keeping 384 dimensions/.test(String(c[0])))).toHaveLength(1);
  });
});
