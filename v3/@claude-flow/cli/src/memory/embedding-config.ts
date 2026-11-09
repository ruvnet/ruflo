/**
 * embedding-config.ts — one place that decides which embedding model the
 * memory path loads and what dimension its vectors have (#2305).
 *
 * `embeddings init` (commands/embeddings.ts) and the `embeddings_init` MCP
 * tool write `<project>/.claude-flow/embeddings.json` with `{ model,
 * dimension, ... }`. Before this module only those two files read it: the
 * memory path, the AgentDB bridge and the router's task embedder all loaded
 * 'Xenova/all-MiniLM-L6-v2' and assumed 384 dimensions regardless of what the
 * user configured.
 *
 * Precedence: `.claude-flow/embeddings.json` → defaults (MiniLM / 384). There
 * is no embedding-model environment override in this codebase today, so none
 * is invented here.
 *
 * Safety: a store that already holds vectors keeps its recorded dimension.
 * When the configured dimension differs, `resolveEffectiveEmbeddingConfig()`
 * returns the recorded shape and warns once — it never mixes dimensions in one
 * store and never rebuilds or rewrites existing vectors.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFileMaybeEncrypted } from '../fs-secure.js';
import { resolveAgentdbBetterSqlite3 } from './shared-sqlite.js';

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const DEFAULT_EMBEDDING_DIMENSION = 384;

/** Same directory + file name commands/embeddings.ts and embeddings-tools.ts write. */
export const EMBEDDINGS_CONFIG_DIR = '.claude-flow';
export const EMBEDDINGS_CONFIG_FILE = 'embeddings.json';

/** Output dimension of models the CLI offers (`embeddings init`, `init --embedding-model`). */
const KNOWN_MODELS: ReadonlyArray<{ id: string; dimension: number }> = [
  { id: DEFAULT_EMBEDDING_MODEL, dimension: DEFAULT_EMBEDDING_DIMENSION },
  { id: 'Xenova/all-mpnet-base-v2', dimension: 768 },
  { id: 'Xenova/bge-small-en-v1.5', dimension: 384 },
];

export interface EmbeddingConfig {
  /** Model id passed to the transformers `pipeline()` (always namespaced, e.g. `Xenova/...`). */
  model: string;
  dimension: number;
  /** `config` = read from embeddings.json; `recorded` = kept from an existing store; `default` otherwise. */
  source: 'default' | 'config' | 'recorded';
  configPath: string;
}

/** Shape of the vectors an existing store already holds. */
export interface RecordedEmbeddingShape {
  dimension: number;
  model?: string | null;
}

export type RecordedShapeReader = (dbPath: string) => Promise<RecordedEmbeddingShape | null>;

const configCache = new Map<string, EmbeddingConfig>();
const effectiveCache = new Map<string, Promise<EmbeddingConfig>>();
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function knownDimension(model: string): number | undefined {
  const base = model.split('/').pop()?.toLowerCase() ?? '';
  return KNOWN_MODELS.find((m) => m.id.split('/').pop()!.toLowerCase() === base)?.dimension;
}

/**
 * `embeddings init` records the bare name it was given (default
 * `all-MiniLM-L6-v2`), while the MCP tool records `Xenova/...`. The
 * transformers pipeline needs the namespaced id, so bare names get `Xenova/`.
 */
export function normalizeEmbeddingModel(model: string): string {
  const trimmed = model.trim();
  return trimmed.includes('/') ? trimmed : `Xenova/${trimmed}`;
}

function defaults(configPath: string): EmbeddingConfig {
  return {
    model: DEFAULT_EMBEDDING_MODEL,
    dimension: DEFAULT_EMBEDDING_DIMENSION,
    source: 'default',
    configPath,
  };
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function readConfigFile(configPath: string): EmbeddingConfig {
  if (!fs.existsSync(configPath)) return defaults(configPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    warnOnce(
      `malformed:${configPath}`,
      `[embeddings] ${configPath} is not valid JSON (${err instanceof Error ? err.message : String(err)}); ` +
        `using the default embedding model ${DEFAULT_EMBEDDING_MODEL} (${DEFAULT_EMBEDDING_DIMENSION}-dim).`,
    );
    return defaults(configPath);
  }

  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
  const rawModel = obj && typeof obj.model === 'string' && obj.model.trim() ? obj.model : null;
  if (!rawModel) {
    warnOnce(
      `nomodel:${configPath}`,
      `[embeddings] ${configPath} has no "model" string; ` +
        `using the default embedding model ${DEFAULT_EMBEDDING_MODEL} (${DEFAULT_EMBEDDING_DIMENSION}-dim).`,
    );
    return defaults(configPath);
  }

  const model = normalizeEmbeddingModel(rawModel);
  const dimension = isPositiveInt(obj!.dimension) ? obj!.dimension : knownDimension(model);
  if (dimension === undefined) {
    warnOnce(
      `nodim:${configPath}`,
      `[embeddings] ${configPath} sets model "${rawModel}" without a valid "dimension", and its ` +
        `dimension is not known; using the default embedding model ${DEFAULT_EMBEDDING_MODEL} ` +
        `(${DEFAULT_EMBEDDING_DIMENSION}-dim).`,
    );
    return defaults(configPath);
  }
  return { model, dimension, source: 'config', configPath };
}

/**
 * Resolve the configured embedding model + dimension for a project root
 * (default: cwd, which is where `embeddings init` writes its config).
 * Cached per root; never throws.
 */
export function resolveEmbeddingConfig(root: string = process.cwd()): EmbeddingConfig {
  const configPath = path.join(path.resolve(root), EMBEDDINGS_CONFIG_DIR, EMBEDDINGS_CONFIG_FILE);
  const cached = configCache.get(configPath);
  if (cached) return cached;
  const resolved = readConfigFile(configPath);
  configCache.set(configPath, resolved);
  return resolved;
}

/** Pick a model that produces `dimension`-dim vectors, preferring what the store recorded. */
function modelForRecorded(recorded: RecordedEmbeddingShape, configured: EmbeddingConfig): string {
  const recordedModel = recorded.model ? normalizeEmbeddingModel(recorded.model) : null;
  if (recordedModel && knownDimension(recordedModel) === recorded.dimension) return recordedModel;
  // KNOWN_MODELS lists the default first, so a 384-dim store maps to MiniLM.
  const known = KNOWN_MODELS.find((m) => m.dimension === recorded.dimension);
  return known?.id ?? recordedModel ?? configured.model;
}

/**
 * Keep an existing store's recorded dimension when it differs from the
 * configured one. Warns once per store; returns the configured value
 * untouched when there is nothing recorded or the dimensions agree.
 */
export function reconcileWithRecordedShape(
  configured: EmbeddingConfig,
  recorded: RecordedEmbeddingShape | null,
  storeLabel: string,
): EmbeddingConfig {
  if (!recorded || !isPositiveInt(recorded.dimension) || recorded.dimension === configured.dimension) {
    return configured;
  }
  const model = modelForRecorded(recorded, configured);
  warnOnce(
    `mismatch:${storeLabel}`,
    `[embeddings] ${storeLabel} already holds ${recorded.dimension}-dim vectors, but the configured ` +
      `embedding model ${configured.model} produces ${configured.dimension}-dim vectors ` +
      `(${configured.configPath}). Keeping ${recorded.dimension} dimensions (${model}) for this store so ` +
      `vectors are not mixed; nothing was rebuilt. To switch models, start a new memory store.`,
  );
  return { model, dimension: recorded.dimension, source: 'recorded', configPath: configured.configPath };
}

/** The most recently written real (non-hash) vector. */
const RECORDED_SHAPE_SQL = `
  SELECT embedding_dimensions, embedding_model FROM memory_entries
  WHERE embedding IS NOT NULL AND embedding_dimensions > 0
    AND COALESCE(embedding_model, '') NOT LIKE '%hash%'
  ORDER BY rowid DESC LIMIT 1
`;

function toShape(dim: unknown, model: unknown): RecordedEmbeddingShape | null {
  const dimension = Number(dim);
  if (!isPositiveInt(dimension)) return null;
  return { dimension, model: model == null ? null : String(model) };
}

type NativeReadResult = { ok: true; shape: RecordedEmbeddingShape | null } | { ok: false };

/**
 * Readonly native open: cheap, no whole-file load. Uses the better-sqlite3
 * copy AgentDB uses (#3693), so closing it cannot strip AgentDB's WAL.
 * Fails (→ sql.js) on an encrypted file or when no native driver exists.
 */
function readShapeNative(dbPath: string): NativeReadResult {
  const Database = resolveAgentdbBetterSqlite3();
  if (!Database) return { ok: false };
  let db: { prepare(sql: string): { get(): unknown }; close(): void } | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db!.prepare(RECORDED_SHAPE_SQL).get() as
      | { embedding_dimensions?: unknown; embedding_model?: unknown }
      | undefined;
    return { ok: true, shape: row ? toShape(row.embedding_dimensions, row.embedding_model) : null };
  } catch {
    return { ok: false };
  } finally {
    try { db?.close(); } catch { /* best-effort */ }
  }
}

async function readShapeSqlJs(dbPath: string): Promise<RecordedEmbeddingShape | null> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileMaybeEncrypted(dbPath, null));
  try {
    const row = db.exec(RECORDED_SHAPE_SQL)[0]?.values?.[0];
    return row ? toShape(row[0], row[1]) : null;
  } finally {
    db.close();
  }
}

/**
 * Default reader: the most recently written real (non-hash) vector in
 * `memory_entries`. A store with no such vector records nothing, so a fresh
 * or empty database follows the configuration.
 */
export const readRecordedEmbeddingShape: RecordedShapeReader = async (dbPath) => {
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) return null;
  const native = readShapeNative(dbPath);
  if (native.ok) return native.shape;
  try {
    return await readShapeSqlJs(dbPath);
  } catch {
    // Unreadable / legacy schema — nothing recorded we can trust.
    return null;
  }
};

/**
 * The embedding config to actually use: the configured model, unless one of
 * the stores in `dbPaths` already holds vectors of another dimension. The
 * memory path writes the same vectors to memory.db and (through the AgentDB
 * bridge) agentdb-memory.db, so callers pass both and every caller converges
 * on one answer: the first store with recorded vectors wins. Cached per
 * (root, dbPaths).
 */
export function resolveEffectiveEmbeddingConfig(options: {
  root?: string;
  dbPaths?: ReadonlyArray<string | undefined>;
  readRecordedShape?: RecordedShapeReader;
} = {}): Promise<EmbeddingConfig> {
  const root = path.resolve(options.root ?? process.cwd());
  const dbPaths = (options.dbPaths ?? [])
    .filter((p): p is string => typeof p === 'string' && p.length > 0 && p !== ':memory:')
    .map((p) => path.resolve(p));
  const key = `${root}\0${dbPaths.join('\0')}`;
  const cached = effectiveCache.get(key);
  if (cached) return cached;
  const configured = resolveEmbeddingConfig(root);
  const reader = options.readRecordedShape ?? readRecordedEmbeddingShape;
  const pending = (async () => {
    for (const dbPath of dbPaths) {
      let recorded: RecordedEmbeddingShape | null = null;
      try {
        recorded = await reader(dbPath);
      } catch {
        recorded = null;
      }
      if (recorded) return reconcileWithRecordedShape(configured, recorded, dbPath);
    }
    return configured;
  })();
  effectiveCache.set(key, pending);
  return pending;
}

/** Test seam: forget cached resolutions and emitted warnings. */
export function _resetEmbeddingConfigCache(): void {
  configCache.clear();
  effectiveCache.clear();
  warned.clear();
}
