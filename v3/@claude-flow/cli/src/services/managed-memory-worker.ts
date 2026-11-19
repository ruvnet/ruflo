/** Fixed child entry. Native dependency loading must never move into the MCP parent. */
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const NAMESPACE = 'managed-workflow-evidence';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;
const TYPES = ['code-review', 'migration', 'research', 'test-generation', 'implementation', 'other'];
type Request = { v: 1; requestId: string; operation: 'index'; id: string; value: string; taskType: string } | { v: 1; requestId: string; operation: 'recall'; taskType: string; allowedIds: string[] };
type Row = { key: string; namespace: string; content: string; hasEmbedding?: boolean };
export type NativeMemoryAdapter = {
  getEntry: (options: Record<string, unknown>) => Promise<{ success: boolean; found: boolean; entry?: Row } | null>;
  storeEntry: (options: Record<string, unknown>) => Promise<{ success: boolean; persistWarning?: unknown; embedding?: { dimensions?: number }; error?: unknown } | null>;
  searchEntries: (options: Record<string, unknown>) => Promise<{ success: boolean; results: Array<{ key: string; namespace: string; score: number }> } | null>;
};

function requestOf(raw: unknown): Request {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw)) > 80_000) throw new Error('invalid-request');
  const r = raw as Record<string, unknown>;
  const keys = r.operation === 'index' ? ['v', 'requestId', 'operation', 'id', 'value', 'taskType'] : ['v', 'requestId', 'operation', 'taskType', 'allowedIds'];
  if (r.v !== 1 || typeof r.requestId !== 'string' || !UUID.test(r.requestId) || !['index', 'recall'].includes(String(r.operation)) || Object.keys(r).length !== keys.length || Object.keys(r).some(k => !keys.includes(k)) || !TYPES.includes(String(r.taskType))) throw new Error('invalid-request');
  if (r.operation === 'index' && (typeof r.id !== 'string' || !HASH.test(r.id) || typeof r.value !== 'string' || Buffer.byteLength(r.value) > 8192)) throw new Error('invalid-request');
  if (r.operation === 'recall' && (!Array.isArray(r.allowedIds) || r.allowedIds.length > 500 || r.allowedIds.some(id => typeof id !== 'string' || !HASH.test(id)))) throw new Error('invalid-request');
  return r as unknown as Request;
}

const validRow = (row: Row | undefined, key: string): row is Row => !!row && row.key === key && row.namespace === NAMESPACE && typeof row.content === 'string' && Buffer.byteLength(row.content) <= 8192;

/** Pure operation seam for host tests. Serialized callers cannot supply an adapter. */
export async function executeManagedMemory(raw: unknown, adapter: NativeMemoryAdapter, dbPath: string, beforeWrite?: () => Promise<void>) {
  const r = requestOf(raw);
  if (r.operation === 'index') {
    const existing = await adapter.getEntry({ key: r.id, namespace: NAMESPACE, dbPath });
    if (!existing?.success) throw new Error('backend-unavailable');
    if (existing.found) {
      if (!validRow(existing.entry, r.id) || existing.entry.content !== r.value) throw new Error('conflicting-index');
      return { v: 1, requestId: r.requestId, ok: true, operation: 'index', durable: true, hasEmbedding: existing.entry.hasEmbedding === true };
    }
    await beforeWrite?.();
    const result = await adapter.storeEntry({ key: r.id, namespace: NAMESPACE, value: r.value, tags: ['managed-workflow', r.taskType], generateEmbeddingFlag: true, upsert: false, requireNative: true, appendOnly: true, dbPath, provenanceType: 'system_observation' });
    if (!result?.success || result.persistWarning) throw new Error('persistence-unconfirmed');
    // Observe the exact durable row after the append. Neither success nor a
    // signed local ledger alone establishes that the native row exists.
    const stored = await adapter.getEntry({ key: r.id, namespace: NAMESPACE, dbPath });
    if (!stored?.success || !stored.found || !validRow(stored.entry, r.id) || stored.entry.content !== r.value) throw new Error('persistence-unconfirmed');
    return { v: 1, requestId: r.requestId, ok: true, operation: 'index', durable: true, hasEmbedding: stored.entry.hasEmbedding === true };
  }
  const result = await adapter.searchEntries({ query: `managed workflow ${r.taskType}`, namespace: NAMESPACE, limit: 20, threshold: 0, dbPath });
  if (!result?.success || !Array.isArray(result.results)) return { v: 1, requestId: r.requestId, ok: true, operation: 'recall', available: false, rows: [] };
  const allowed = new Set(r.allowedIds), seen = new Set<string>();
  const rows: Array<{ key: string; namespace: string; score: number; content: string }> = [];
  for (const hit of result.results.slice(0, 20)) {
    if (!hit || hit.namespace !== NAMESPACE || typeof hit.key !== 'string' || !HASH.test(hit.key) || !allowed.has(hit.key) || seen.has(hit.key) || !Number.isFinite(hit.score) || hit.score < -1 || hit.score > 1) continue;
    seen.add(hit.key);
    const hydrated = await adapter.getEntry({ key: hit.key, namespace: NAMESPACE, dbPath });
    if (hydrated?.success && hydrated.found && validRow(hydrated.entry, hit.key)) rows.push({ key: hit.key, namespace: NAMESPACE, score: hit.score, content: hydrated.entry.content });
  }
  return { v: 1, requestId: r.requestId, ok: true, operation: 'recall', available: true, rows };
}

function databasePath(): string {
  const root = realpathSync(process.cwd()), dir = join(root, '.swarm');
  if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) throw new Error('backend-unavailable');
  const path = join(dir, 'memory.db');
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())) throw new Error('backend-unavailable');
  return path;
}

async function loadNative(dbPath: string): Promise<NativeMemoryAdapter> {
  // Transformers.js does not consistently honor the Python offline env flags.
  // Configure the exact module identity AgentDB loads, before registry init.
  const require = createRequire(import.meta.url);
  const memoryEntry = require.resolve('@claude-flow/memory');
  const agentEntry = createRequire(memoryEntry).resolve('agentdb');
  const owner = createRequire(agentEntry);
  for (const name of ['@huggingface/transformers', '@xenova/transformers']) {
    let path: string;
    try { path = owner.resolve(name); } catch { continue; }
    const modulePath = pathToFileURL(path).href;
    const model = await import(modulePath) as { env?: { allowRemoteModels: boolean } };
    if (model.env) model.env.allowRemoteModels = false;
  }
  const js = new URL('../memory/memory-bridge.js', import.meta.url);
  const moduleUrl = existsSync(fileURLToPath(js)) ? js : new URL('../memory/memory-bridge.ts', import.meta.url);
  // Deliberately nonliteral import: targeted boundary builds do not pull the
  // optional native dependency graph into the parent compilation.
  const modulePath = moduleUrl.href;
  const bridge = await import(modulePath) as Record<string, any>;
  const registry = await bridge.getControllerRegistry(dbPath);
  const agentdb = registry?.getAgentDB?.(), db = agentdb?.database;
  if (!db || agentdb.isWasm === true || typeof db.inTransaction !== 'boolean' || typeof db.transaction !== 'function' || db.memory !== false || typeof db.name !== 'string' || resolve(db.name) !== resolve(dbPath)) throw new Error('backend-unavailable');
  return { getEntry: bridge.bridgeGetEntry, searchEntries: bridge.bridgeSearchEntries, storeEntry: bridge.bridgeStoreEntry };
}

if (typeof process.send === 'function' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let busy = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let adapter: Promise<NativeMemoryAdapter> | undefined;
  let pendingGrant: { id: string; grant: string; resolve: () => void } | undefined;
  const ask = (id: string, phase: 'ready' | 'before-write') => new Promise<void>(resolve => {
    pendingGrant = { id, grant: phase === 'ready' ? 'execute' : 'write', resolve };
    process.send?.({ v: 1, requestId: id, phase });
  });
  process.once('disconnect', () => process.exit(0));
  process.on('message', async value => {
    if (value && typeof value === 'object' && 'grant' in value) {
      const message = value as Record<string, unknown>;
      if (Object.keys(message).length === 3 && message.v === 1 && message.requestId === pendingGrant?.id && message.grant === pendingGrant?.grant) { const grant = pendingGrant; pendingGrant = undefined; grant?.resolve(); }
      return;
    }
    if (idle) clearTimeout(idle);
    let request: Request;
    try { request = requestOf(value); } catch { process.send?.({ v: 1, ok: false, error: 'invalid-request' }); return; }
    if (busy) { process.send?.({ v: 1, requestId: request.requestId, ok: false, error: 'worker-busy' }); return; }
    busy = true;
    try {
      const path = databasePath();
      adapter ??= loadNative(path);
      const native = await adapter;
      await ask(request.requestId, 'ready');
      const result = await executeManagedMemory(request, native, path, () => ask(request.requestId, 'before-write'));
      if (Buffer.byteLength(JSON.stringify(result)) > 200_000) throw new Error('result-limit');
      process.send?.(result);
    } catch {
      // Upstream errors may carry prompts, SQL, paths or credentials.
      process.send?.({ v: 1, requestId: request.requestId, ok: false, error: 'native-operation-unavailable' });
    } finally {
      busy = false; idle = setTimeout(() => process.exit(0), 5000);
    }
  });
}
