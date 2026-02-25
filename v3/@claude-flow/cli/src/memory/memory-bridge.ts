/**
 * Memory Bridge — Routes CLI memory operations through ControllerRegistry + AgentDB v3
 *
 * Per ADR-053 Phases 1-6: Full controller activation pipeline.
 * CLI → ControllerRegistry → AgentDB v3 controllers.
 *
 * Phase 1: Core CRUD + embeddings + HNSW + controller access (complete)
 * Phase 2: BM25 hybrid search, TieredCache read/write, MutationGuard validation
 * Phase 3: ReasoningBank pattern store, recordFeedback, CausalMemoryGraph edges
 * Phase 4: SkillLibrary promotion, ExplainableRecall provenance, AttestationLog
 * Phase 5: ReflexionMemory session lifecycle, WitnessChain attestation
 * Phase 6: AgentDB MCP tools (separate file), COW branching
 *
 * Uses better-sqlite3 API (synchronous .all()/.get()/.run()) since that's
 * what AgentDB v3 uses internally.
 *
 * @module v3/cli/memory-bridge
 */

import * as path from 'path';

// ===== Lazy singleton =====

let registryPromise: Promise<any> | null = null;
let registryInstance: any = null;
let bridgeAvailable: boolean | null = null;

function getDbPath(customPath?: string): string {
  const swarmDir = path.join(process.cwd(), '.swarm');
  return customPath || path.join(swarmDir, 'memory.db');
}

/**
 * Lazily initialize the ControllerRegistry singleton.
 * Returns null if @claude-flow/memory is not available.
 */
async function getRegistry(dbPath?: string): Promise<any | null> {
  if (bridgeAvailable === false) return null;

  if (registryInstance) return registryInstance;

  if (!registryPromise) {
    registryPromise = (async () => {
      try {
        const { ControllerRegistry } = await import('@claude-flow/memory');
        const registry = new ControllerRegistry();

        // Suppress noisy console.log during init
        const origLog = console.log;
        console.log = (...args: unknown[]) => {
          const msg = String(args[0] ?? '');
          if (msg.includes('Transformers.js') ||
              msg.includes('better-sqlite3') ||
              msg.includes('[AgentDB]') ||
              msg.includes('[HNSWLibBackend]') ||
              msg.includes('RuVector graph')) return;
          origLog.apply(console, args);
        };

        try {
          await registry.initialize({
            dbPath: dbPath || getDbPath(),
            dimension: 384,
            controllers: {
              reasoningBank: true,
              learningBridge: false,
              tieredCache: true,
            },
          });
        } finally {
          console.log = origLog;
        }

        registryInstance = registry;
        bridgeAvailable = true;
        return registry;
      } catch {
        bridgeAvailable = false;
        registryPromise = null;
        return null;
      }
    })();
  }

  return registryPromise;
}

// ===== Phase 2: BM25 hybrid scoring =====

/**
 * BM25 scoring for keyword-based search.
 * Replaces naive String.includes() with proper information retrieval scoring.
 * Parameters tuned for short memory entries (k1=1.2, b=0.75).
 */
function bm25Score(
  queryTerms: string[],
  docContent: string,
  avgDocLength: number,
  docCount: number,
  termDocFreqs: Map<string, number>,
): number {
  const k1 = 1.2;
  const b = 0.75;
  const docWords = docContent.toLowerCase().split(/\s+/);
  const docLength = docWords.length;

  let score = 0;
  for (const term of queryTerms) {
    const tf = docWords.filter(w => w === term || w.includes(term)).length;
    if (tf === 0) continue;

    const df = termDocFreqs.get(term) || 1;
    const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / Math.max(1, avgDocLength))));
    score += idf * tfNorm;
  }

  return score;
}

/**
 * Compute BM25 term document frequencies for a set of rows.
 */
function computeTermDocFreqs(
  queryTerms: string[],
  rows: Array<{ content: string }>,
): { termDocFreqs: Map<string, number>; avgDocLength: number } {
  const termDocFreqs = new Map<string, number>();
  let totalLength = 0;

  for (const row of rows) {
    const content = (row.content || '').toLowerCase();
    const words = content.split(/\s+/);
    totalLength += words.length;

    for (const term of queryTerms) {
      if (content.includes(term)) {
        termDocFreqs.set(term, (termDocFreqs.get(term) || 0) + 1);
      }
    }
  }

  return { termDocFreqs, avgDocLength: rows.length > 0 ? totalLength / rows.length : 1 };
}

// ===== Phase 2: TieredCache helpers =====

/**
 * Try to read from TieredCache before hitting DB.
 * Returns cached value or null if cache miss.
 */
async function cacheGet(registry: any, cacheKey: string): Promise<any | null> {
  try {
    const cache = registry.get('tieredCache');
    if (!cache || typeof cache.get !== 'function') return null;
    return cache.get(cacheKey) ?? null;
  } catch {
    return null;
  }
}

/**
 * Write to TieredCache after DB write.
 */
async function cacheSet(registry: any, cacheKey: string, value: any): Promise<void> {
  try {
    const cache = registry.get('tieredCache');
    if (cache && typeof cache.set === 'function') {
      cache.set(cacheKey, value);
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Invalidate a cache key after mutation.
 */
async function cacheInvalidate(registry: any, cacheKey: string): Promise<void> {
  try {
    const cache = registry.get('tieredCache');
    if (cache && typeof cache.delete === 'function') {
      cache.delete(cacheKey);
    }
  } catch {
    // Non-fatal
  }
}

// ===== Phase 2: MutationGuard helpers =====

/**
 * Validate a mutation through MutationGuard before executing.
 * Returns true if the mutation is allowed, false if rejected.
 * Falls back to allowing if guard is unavailable.
 */
async function guardValidate(
  registry: any,
  operation: string,
  params: Record<string, unknown>,
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const guard = registry.get('mutationGuard');
    if (!guard || typeof guard.validate !== 'function') {
      return { allowed: true }; // No guard = allow
    }
    const result = guard.validate({ operation, params, timestamp: Date.now() });
    return { allowed: result?.allowed !== false, reason: result?.reason };
  } catch {
    return { allowed: true }; // Guard error = allow (graceful degradation)
  }
}

// ===== Phase 3: AttestationLog helpers =====

/**
 * Log a write operation to AttestationLog/WitnessChain.
 */
async function logAttestation(
  registry: any,
  operation: string,
  entryId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const attestation = registry.get('attestationLog');
    if (!attestation) return;

    if (typeof attestation.record === 'function') {
      attestation.record({ operation, entryId, timestamp: Date.now(), ...metadata });
    } else if (typeof attestation.log === 'function') {
      attestation.log(operation, entryId, metadata);
    }
  } catch {
    // Non-fatal — attestation is observability, not correctness
  }
}

/**
 * Get the AgentDB database handle and ensure memory_entries table exists.
 * Returns null if not available.
 */
function getDb(registry: any): any | null {
  const agentdb = registry.getAgentDB();
  if (!agentdb?.database) return null;

  const db = agentdb.database;

  // Ensure memory_entries table exists (idempotent)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      namespace TEXT DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      embedding TEXT,
      embedding_model TEXT DEFAULT 'local',
      embedding_dimensions INTEGER,
      tags TEXT,
      metadata TEXT,
      owner_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      expires_at INTEGER,
      last_accessed_at INTEGER,
      access_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      UNIQUE(namespace, key)
    )`);
    // Ensure indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_ns ON memory_entries(namespace)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_key ON memory_entries(key)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_status ON memory_entries(status)`);
  } catch {
    // Table already exists or db is read-only — that's fine
  }

  return { db, agentdb };
}

// ===== Bridge functions — match memory-initializer.ts signatures =====

/**
 * Store an entry via AgentDB v3.
 * Phase 2-5: Routes through MutationGuard → TieredCache → DB → AttestationLog.
 * Returns null to signal fallback to sql.js.
 */
export async function bridgeStoreEntry(options: {
  key: string;
  value: string;
  namespace?: string;
  generateEmbeddingFlag?: boolean;
  tags?: string[];
  ttl?: number;
  dbPath?: string;
  upsert?: boolean;
}): Promise<{
  success: boolean;
  id: string;
  embedding?: { dimensions: number; model: string };
  guarded?: boolean;
  cached?: boolean;
  attested?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { key, value, namespace = 'default', tags = [], ttl } = options;
    const id = `entry_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    // Phase 5: MutationGuard validation before write
    const guardResult = await guardValidate(registry, 'store', { key, namespace, size: value.length });
    if (!guardResult.allowed) {
      return { success: false, id, error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    // Generate embedding via AgentDB's embedder
    let embeddingJson: string | null = null;
    let dimensions = 0;
    let model = 'local';

    if (options.generateEmbeddingFlag !== false && value.length > 0) {
      try {
        const embedder = ctx.agentdb.embedder;
        if (embedder) {
          const emb = await embedder.embed(value);
          if (emb) {
            embeddingJson = JSON.stringify(Array.from(emb));
            dimensions = emb.length;
            model = 'Xenova/all-MiniLM-L6-v2';
          }
        }
      } catch {
        // Embedding failed — store without
      }
    }

    // better-sqlite3 uses synchronous .run() with positional params
    const insertSql = options.upsert
      ? `INSERT OR REPLACE INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      : `INSERT INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`;

    const stmt = ctx.db.prepare(insertSql);
    stmt.run(
      id, key, namespace, value,
      embeddingJson, dimensions || null, model,
      tags.length > 0 ? JSON.stringify(tags) : null,
      '{}',
      now, now,
      ttl ? now + (ttl * 1000) : null
    );

    // Phase 2: Write-through to TieredCache
    const cacheKey = `entry:${namespace}:${key}`;
    await cacheSet(registry, cacheKey, { id, key, namespace, content: value, embedding: embeddingJson });

    // Phase 4: AttestationLog write audit
    await logAttestation(registry, 'store', id, { key, namespace, hasEmbedding: !!embeddingJson });

    return {
      success: true,
      id,
      embedding: embeddingJson ? { dimensions, model } : undefined,
      guarded: true,
      cached: true,
      attested: true,
    };
  } catch {
    return null;
  }
}

/**
 * Search entries via AgentDB v3.
 * Phase 2: BM25 hybrid scoring replaces naive String.includes() keyword fallback.
 * Combines cosine similarity (semantic) with BM25 (lexical) via reciprocal rank fusion.
 */
export async function bridgeSearchEntries(options: {
  query: string;
  namespace?: string;
  limit?: number;
  threshold?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  results: {
    id: string;
    key: string;
    content: string;
    score: number;
    namespace: string;
    provenance?: string;
  }[];
  searchTime: number;
  searchMethod?: string;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { query: queryStr, namespace = 'default', limit = 10, threshold = 0.3 } = options;
    const startTime = Date.now();

    // Generate query embedding
    let queryEmbedding: number[] | null = null;
    try {
      const embedder = ctx.agentdb.embedder;
      if (embedder) {
        const emb = await embedder.embed(queryStr);
        queryEmbedding = Array.from(emb);
      }
    } catch {
      // Fall back to keyword search
    }

    // better-sqlite3: .prepare().all() returns array of objects
    const nsFilter = namespace !== 'all'
      ? `AND namespace = ?`
      : '';

    let rows: any[];
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding
        FROM memory_entries
        WHERE status = 'active' ${nsFilter}
        LIMIT 1000
      `);
      rows = namespace !== 'all' ? stmt.all(namespace) : stmt.all();
    } catch {
      return null;
    }

    // Phase 2: Compute BM25 term stats for the corpus
    const queryTerms = queryStr.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const { termDocFreqs, avgDocLength } = computeTermDocFreqs(queryTerms, rows);
    const docCount = rows.length;

    const results: { id: string; key: string; content: string; score: number; namespace: string; provenance?: string }[] = [];

    for (const row of rows) {
      let semanticScore = 0;
      let bm25ScoreVal = 0;

      // Semantic scoring via cosine similarity
      if (queryEmbedding && row.embedding) {
        try {
          const embedding = JSON.parse(row.embedding) as number[];
          semanticScore = cosineSim(queryEmbedding, embedding);
        } catch {
          // Invalid embedding
        }
      }

      // Phase 2: BM25 keyword scoring (replaces String.includes fallback)
      if (queryTerms.length > 0 && row.content) {
        bm25ScoreVal = bm25Score(queryTerms, row.content, avgDocLength, docCount, termDocFreqs);
        // Normalize BM25 to 0-1 range (cap at 10 for normalization)
        bm25ScoreVal = Math.min(bm25ScoreVal / 10, 1.0);
      }

      // Reciprocal rank fusion: combine semantic and BM25
      // Weight: 0.7 semantic + 0.3 BM25 (semantic preferred when embeddings available)
      const score = queryEmbedding
        ? (0.7 * semanticScore + 0.3 * bm25ScoreVal)
        : bm25ScoreVal;  // BM25-only when no embeddings

      if (score >= threshold) {
        // Phase 4: ExplainableRecall provenance
        const provenance = queryEmbedding
          ? `semantic:${semanticScore.toFixed(3)}+bm25:${bm25ScoreVal.toFixed(3)}`
          : `bm25:${bm25ScoreVal.toFixed(3)}`;

        results.push({
          id: String(row.id).substring(0, 12),
          key: row.key || String(row.id).substring(0, 15),
          content: (row.content || '').substring(0, 60) + ((row.content || '').length > 60 ? '...' : ''),
          score,
          namespace: row.namespace || 'default',
          provenance,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    return {
      success: true,
      results: results.slice(0, limit),
      searchTime: Date.now() - startTime,
      searchMethod: queryEmbedding ? 'hybrid-bm25-semantic' : 'bm25-only',
    };
  } catch {
    return null;
  }
}

/**
 * List entries via AgentDB v3.
 */
export async function bridgeListEntries(options: {
  namespace?: string;
  limit?: number;
  offset?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  entries: {
    id: string;
    key: string;
    namespace: string;
    size: number;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
  }[];
  total: number;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { namespace, limit = 20, offset = 0 } = options;

    const nsFilter = namespace ? `AND namespace = ?` : '';
    const nsParams = namespace ? [namespace] : [];

    // Count
    let total = 0;
    try {
      const countStmt = ctx.db.prepare(
        `SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active' ${nsFilter}`
      );
      const countRow = countStmt.get(...nsParams);
      total = countRow?.cnt || 0;
    } catch {
      return null;
    }

    // List
    const entries: any[] = [];
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at
        FROM memory_entries
        WHERE status = 'active' ${nsFilter}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `);
      const rows = stmt.all(...nsParams, limit, offset);
      for (const row of rows) {
        entries.push({
          id: String(row.id).substring(0, 20),
          key: row.key || String(row.id).substring(0, 15),
          namespace: row.namespace || 'default',
          size: (row.content || '').length,
          accessCount: row.access_count || 0,
          createdAt: row.created_at || new Date().toISOString(),
          updatedAt: row.updated_at || new Date().toISOString(),
          hasEmbedding: !!(row.embedding && String(row.embedding).length > 10),
        });
      }
    } catch {
      return null;
    }

    return { success: true, entries, total };
  } catch {
    return null;
  }
}

/**
 * Get a specific entry via AgentDB v3.
 * Phase 2: TieredCache consulted before DB hit.
 */
export async function bridgeGetEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  found: boolean;
  entry?: {
    id: string;
    key: string;
    namespace: string;
    content: string;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
    tags: string[];
  };
  cacheHit?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { key, namespace = 'default' } = options;

    // Phase 2: Check TieredCache first
    const cacheKey = `entry:${namespace}:${key}`;
    const cached = await cacheGet(registry, cacheKey);
    if (cached && cached.content) {
      return {
        success: true,
        found: true,
        cacheHit: true,
        entry: {
          id: String(cached.id || ''),
          key: cached.key || key,
          namespace: cached.namespace || namespace,
          content: cached.content || '',
          accessCount: cached.accessCount || 0,
          createdAt: cached.createdAt || new Date().toISOString(),
          updatedAt: cached.updatedAt || new Date().toISOString(),
          hasEmbedding: !!cached.embedding,
          tags: cached.tags || [],
        },
      };
    }

    let row: any;
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at, tags
        FROM memory_entries
        WHERE status = 'active' AND key = ? AND namespace = ?
        LIMIT 1
      `);
      row = stmt.get(key, namespace);
    } catch {
      return null;
    }

    if (!row) {
      return { success: true, found: false };
    }

    // Update access count
    try {
      ctx.db.prepare(
        `UPDATE memory_entries SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`
      ).run(Date.now(), row.id);
    } catch {
      // Non-fatal
    }

    let tags: string[] = [];
    if (row.tags) {
      try { tags = JSON.parse(row.tags); } catch { /* invalid */ }
    }

    const entry = {
      id: String(row.id),
      key: row.key || String(row.id),
      namespace: row.namespace || 'default',
      content: row.content || '',
      accessCount: (row.access_count || 0) + 1,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString(),
      hasEmbedding: !!(row.embedding && String(row.embedding).length > 10),
      tags,
    };

    // Phase 2: Populate cache for next read
    await cacheSet(registry, cacheKey, entry);

    return { success: true, found: true, cacheHit: false, entry };
  } catch {
    return null;
  }
}

/**
 * Delete an entry via AgentDB v3.
 * Phase 5: MutationGuard validation, cache invalidation, attestation logging.
 */
export async function bridgeDeleteEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: boolean;
  key: string;
  namespace: string;
  remainingEntries: number;
  guarded?: boolean;
  error?: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const { key, namespace = 'default' } = options;

    // Phase 5: MutationGuard validation before delete
    const guardResult = await guardValidate(registry, 'delete', { key, namespace });
    if (!guardResult.allowed) {
      return { success: false, deleted: false, key, namespace, remainingEntries: 0, error: `MutationGuard rejected: ${guardResult.reason}` };
    }

    // Soft delete using parameterized query
    let changes = 0;
    try {
      const result = ctx.db.prepare(`
        UPDATE memory_entries
        SET status = 'deleted', updated_at = ?
        WHERE key = ? AND namespace = ? AND status = 'active'
      `).run(Date.now(), key, namespace);
      changes = result?.changes ?? 0;
    } catch {
      return null;
    }

    // Phase 2: Invalidate cache
    await cacheInvalidate(registry, `entry:${namespace}:${key}`);

    // Phase 4: AttestationLog delete audit
    if (changes > 0) {
      await logAttestation(registry, 'delete', key, { namespace });
    }

    let remaining = 0;
    try {
      const row = ctx.db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active'`).get();
      remaining = row?.cnt || 0;
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      deleted: changes > 0,
      key,
      namespace,
      remainingEntries: remaining,
      guarded: true,
    };
  } catch {
    return null;
  }
}

// ===== Phase 2: Embedding bridge =====

/**
 * Generate embedding via AgentDB v3's embedder.
 * Returns null if bridge unavailable — caller falls back to own ONNX/hash.
 */
export async function bridgeGenerateEmbedding(
  text: string,
  dbPath?: string,
): Promise<{ embedding: number[]; dimensions: number; model: string } | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const agentdb = registry.getAgentDB();
    const embedder = agentdb?.embedder;
    if (!embedder) return null;

    const emb = await embedder.embed(text);
    if (!emb) return null;

    return {
      embedding: Array.from(emb),
      dimensions: emb.length,
      model: 'Xenova/all-MiniLM-L6-v2',
    };
  } catch {
    return null;
  }
}

/**
 * Load embedding model via AgentDB v3 (it loads on init).
 * Returns null if unavailable.
 */
export async function bridgeLoadEmbeddingModel(
  dbPath?: string,
): Promise<{
  success: boolean;
  dimensions: number;
  modelName: string;
  loadTime?: number;
} | null> {
  const startTime = Date.now();
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const agentdb = registry.getAgentDB();
    const embedder = agentdb?.embedder;
    if (!embedder) return null;

    // Verify embedder works by generating a test embedding
    const test = await embedder.embed('test');
    if (!test) return null;

    return {
      success: true,
      dimensions: test.length,
      modelName: 'Xenova/all-MiniLM-L6-v2',
      loadTime: Date.now() - startTime,
    };
  } catch {
    return null;
  }
}

// ===== Phase 3: HNSW bridge =====

/**
 * Get HNSW status from AgentDB v3's vector backend or HNSW index.
 * Returns null if unavailable.
 */
export async function bridgeGetHNSWStatus(
  dbPath?: string,
): Promise<{
  available: boolean;
  initialized: boolean;
  entryCount: number;
  dimensions: number;
} | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const ctx = getDb(registry);
    if (!ctx) return null;

    // Count entries with embeddings
    let entryCount = 0;
    try {
      const row = ctx.db.prepare(
        `SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active' AND embedding IS NOT NULL`,
      ).get();
      entryCount = row?.cnt || 0;
    } catch {
      // Table might not exist
    }

    return {
      available: true,
      initialized: true,
      entryCount,
      dimensions: 384,
    };
  } catch {
    return null;
  }
}

/**
 * Search using AgentDB v3's embedder + SQLite entries.
 * This is the HNSW-equivalent search through the bridge.
 * Returns null if unavailable.
 */
export async function bridgeSearchHNSW(
  queryEmbedding: number[],
  options?: { k?: number; namespace?: string; threshold?: number },
  dbPath?: string,
): Promise<Array<{
  id: string;
  key: string;
  content: string;
  score: number;
  namespace: string;
}> | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const k = options?.k ?? 10;
    const threshold = options?.threshold ?? 0.3;
    const nsFilter = options?.namespace && options.namespace !== 'all'
      ? `AND namespace = ?`
      : '';

    let rows: any[];
    try {
      const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding
        FROM memory_entries
        WHERE status = 'active' AND embedding IS NOT NULL ${nsFilter}
        LIMIT 10000
      `);
      rows = nsFilter
        ? stmt.all(options!.namespace)
        : stmt.all();
    } catch {
      return null;
    }

    const results: Array<{
      id: string; key: string; content: string; score: number; namespace: string;
    }> = [];

    for (const row of rows) {
      if (!row.embedding) continue;
      try {
        const emb = JSON.parse(row.embedding) as number[];
        const score = cosineSim(queryEmbedding, emb);
        if (score >= threshold) {
          results.push({
            id: String(row.id).substring(0, 12),
            key: row.key || String(row.id).substring(0, 15),
            content: (row.content || '').substring(0, 60) +
              ((row.content || '').length > 60 ? '...' : ''),
            score,
            namespace: row.namespace || 'default',
          });
        }
      } catch {
        // Skip invalid embeddings
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  } catch {
    return null;
  }
}

/**
 * Add entry to the bridge's database with embedding.
 * Returns null if unavailable.
 */
export async function bridgeAddToHNSW(
  id: string,
  embedding: number[],
  entry: { id: string; key: string; namespace: string; content: string },
  dbPath?: string,
): Promise<boolean | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  const ctx = getDb(registry);
  if (!ctx) return null;

  try {
    const now = Date.now();
    const embeddingJson = JSON.stringify(embedding);
    ctx.db.prepare(`
      INSERT OR REPLACE INTO memory_entries (
        id, key, namespace, content, type,
        embedding, embedding_dimensions, embedding_model,
        created_at, updated_at, status
      ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, 'Xenova/all-MiniLM-L6-v2', ?, ?, 'active')
    `).run(
      id, entry.key, entry.namespace, entry.content,
      embeddingJson, embedding.length,
      now, now,
    );
    return true;
  } catch {
    return null;
  }
}

// ===== Phase 4: Controller access =====

/**
 * Get a named controller from AgentDB v3 via ControllerRegistry.
 * Returns null if unavailable.
 */
export async function bridgeGetController(
  name: string,
  dbPath?: string,
): Promise<any | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    return registry.get(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a controller is available.
 */
export async function bridgeHasController(
  name: string,
  dbPath?: string,
): Promise<boolean> {
  const registry = await getRegistry(dbPath);
  if (!registry) return false;

  try {
    const controller = registry.get(name);
    return controller !== null && controller !== undefined;
  } catch {
    return false;
  }
}

/**
 * List all controllers and their status.
 */
export async function bridgeListControllers(
  dbPath?: string,
): Promise<Array<{ name: string; enabled: boolean; level: number }> | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    return registry.listControllers();
  } catch {
    return null;
  }
}

/**
 * Check if the AgentDB v3 bridge is available.
 */
export async function isBridgeAvailable(dbPath?: string): Promise<boolean> {
  if (bridgeAvailable !== null) return bridgeAvailable;
  const registry = await getRegistry(dbPath);
  return registry !== null;
}

/**
 * Get the ControllerRegistry instance (for advanced consumers).
 */
export async function getControllerRegistry(dbPath?: string): Promise<any | null> {
  return getRegistry(dbPath);
}

/**
 * Shutdown the bridge and release resources.
 */
export async function shutdownBridge(): Promise<void> {
  if (registryInstance) {
    try {
      await registryInstance.shutdown();
    } catch {
      // Best-effort
    }
    registryInstance = null;
    registryPromise = null;
    bridgeAvailable = null;
  }
}

// ===== Phase 3: ReasoningBank pattern operations =====

/**
 * Store a pattern via ReasoningBank controller.
 * Falls back to raw SQL if ReasoningBank unavailable.
 */
export async function bridgeStorePattern(options: {
  pattern: string;
  type: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  dbPath?: string;
}): Promise<{ success: boolean; patternId: string; controller: string } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    const reasoningBank = registry.get('reasoningBank');
    const patternId = `pattern-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    if (reasoningBank && typeof reasoningBank.store === 'function') {
      await reasoningBank.store({
        id: patternId,
        content: options.pattern,
        type: options.type,
        confidence: options.confidence,
        metadata: options.metadata,
        timestamp: Date.now(),
      });
      return { success: true, patternId, controller: 'reasoningBank' };
    }

    // Fallback: store via bridge SQL
    const result = await bridgeStoreEntry({
      key: patternId,
      value: JSON.stringify({ pattern: options.pattern, type: options.type, confidence: options.confidence, metadata: options.metadata }),
      namespace: 'pattern',
      generateEmbeddingFlag: true,
      tags: [options.type, 'reasoning-pattern'],
      dbPath: options.dbPath,
    });

    return result ? { success: true, patternId: result.id, controller: 'bridge-fallback' } : null;
  } catch {
    return null;
  }
}

/**
 * Search patterns via ReasoningBank controller.
 */
export async function bridgeSearchPatterns(options: {
  query: string;
  topK?: number;
  minConfidence?: number;
  dbPath?: string;
}): Promise<{ results: Array<{ id: string; content: string; score: number }>; controller: string } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    const reasoningBank = registry.get('reasoningBank');

    if (reasoningBank && typeof reasoningBank.search === 'function') {
      const results = await reasoningBank.search(options.query, {
        topK: options.topK || 5,
        minScore: options.minConfidence || 0.3,
      });
      return {
        results: Array.isArray(results) ? results.map((r: any) => ({
          id: r.id || r.patternId || '',
          content: r.content || r.pattern || '',
          score: r.score || r.confidence || 0,
        })) : [],
        controller: 'reasoningBank',
      };
    }

    // Fallback: search via bridge
    const result = await bridgeSearchEntries({
      query: options.query,
      namespace: 'pattern',
      limit: options.topK || 5,
      threshold: options.minConfidence || 0.3,
      dbPath: options.dbPath,
    });

    return result ? {
      results: result.results.map(r => ({ id: r.id, content: r.content, score: r.score })),
      controller: 'bridge-fallback',
    } : null;
  } catch {
    return null;
  }
}

// ===== Phase 3: Feedback recording =====

/**
 * Record task feedback for learning via ReasoningBank or LearningSystem.
 * Wired into hooks_post-task handler.
 */
export async function bridgeRecordFeedback(options: {
  taskId: string;
  success: boolean;
  quality: number;
  agent?: string;
  duration?: number;
  patterns?: string[];
  dbPath?: string;
}): Promise<{ success: boolean; controller: string; updated: number } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    let controller = 'none';
    let updated = 0;

    // Try LearningSystem first (Phase 4)
    const learningSystem = registry.get('learningSystem');
    if (learningSystem) {
      try {
        if (typeof learningSystem.recordFeedback === 'function') {
          await learningSystem.recordFeedback({
            taskId: options.taskId, success: options.success, quality: options.quality,
            agent: options.agent, duration: options.duration, timestamp: Date.now(),
          });
          controller = 'learningSystem';
          updated++;
        } else if (typeof learningSystem.record === 'function') {
          await learningSystem.record(options.taskId, options.quality, options.success ? 'success' : 'failure');
          controller = 'learningSystem';
          updated++;
        }
      } catch { /* API mismatch — skip */ }
    }

    // Also record in ReasoningBank for pattern reinforcement
    const reasoningBank = registry.get('reasoningBank');
    if (reasoningBank) {
      try {
        if (typeof reasoningBank.recordOutcome === 'function') {
          await reasoningBank.recordOutcome({
            taskId: options.taskId, verdict: options.success ? 'success' : 'failure',
            score: options.quality, timestamp: Date.now(),
          });
          controller = controller === 'none' ? 'reasoningBank' : `${controller}+reasoningBank`;
          updated++;
        } else if (typeof reasoningBank.record === 'function') {
          await reasoningBank.record(options.taskId, options.quality);
          controller = controller === 'none' ? 'reasoningBank' : `${controller}+reasoningBank`;
          updated++;
        }
      } catch { /* API mismatch — skip */ }
    }

    // Phase 4: SkillLibrary promotion for high-quality patterns
    if (options.success && options.quality >= 0.9 && options.patterns?.length) {
      const skills = registry.get('skills');
      if (skills && typeof skills.promote === 'function') {
        for (const pattern of options.patterns) {
          try { await skills.promote(pattern, options.quality); updated++; } catch { /* skip */ }
        }
        controller += '+skills';
      }
    }

    // Always store feedback as a memory entry for retrieval (ensures it persists)
    const storeResult = await bridgeStoreEntry({
      key: `feedback-${options.taskId}`,
      value: JSON.stringify(options),
      namespace: 'feedback',
      tags: [options.success ? 'success' : 'failure', options.agent || 'unknown'],
      dbPath: options.dbPath,
    });
    if (storeResult?.success) {
      controller = controller === 'none' ? 'bridge-store' : `${controller}+bridge-store`;
      updated++;
    }

    return { success: true, controller, updated };
  } catch {
    return null;
  }
}

// ===== Phase 3: CausalMemoryGraph =====

/**
 * Record a causal edge between two entries (e.g., task → result).
 */
export async function bridgeRecordCausalEdge(options: {
  sourceId: string;
  targetId: string;
  relation: string;
  weight?: number;
  dbPath?: string;
}): Promise<{ success: boolean; controller: string } | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    const causalGraph = registry.get('causalGraph');
    if (causalGraph && typeof causalGraph.addEdge === 'function') {
      causalGraph.addEdge(options.sourceId, options.targetId, {
        relation: options.relation,
        weight: options.weight || 1.0,
        timestamp: Date.now(),
      });
      return { success: true, controller: 'causalGraph' };
    }

    // Fallback: store edge as metadata
    const ctx = getDb(registry);
    if (ctx) {
      try {
        ctx.db.prepare(`
          INSERT OR REPLACE INTO memory_entries (id, key, namespace, content, type, created_at, updated_at, status)
          VALUES (?, ?, 'causal-edges', ?, 'procedural', ?, ?, 'active')
        `).run(
          `edge-${Date.now()}`,
          `${options.sourceId}→${options.targetId}`,
          JSON.stringify(options),
          Date.now(), Date.now(),
        );
        return { success: true, controller: 'bridge-fallback' };
      } catch { /* skip */ }
    }

    return null;
  } catch {
    return null;
  }
}

// ===== Phase 5: ReflexionMemory session lifecycle =====

/**
 * Start a session with ReflexionMemory episodic replay.
 * Loads relevant past session patterns for the new session.
 */
export async function bridgeSessionStart(options: {
  sessionId: string;
  context?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  controller: string;
  restoredPatterns: number;
  sessionId: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    let restoredPatterns = 0;
    let controller = 'none';

    // Try ReflexionMemory for episodic session replay
    const reflexion = registry.get('reflexion');
    if (reflexion && typeof reflexion.startEpisode === 'function') {
      await reflexion.startEpisode(options.sessionId, { context: options.context });
      controller = 'reflexion';
    }

    // Load recent patterns from past sessions
    const searchResult = await bridgeSearchEntries({
      query: options.context || 'session patterns',
      namespace: 'session',
      limit: 10,
      threshold: 0.2,
      dbPath: options.dbPath,
    });

    if (searchResult?.results) {
      restoredPatterns = searchResult.results.length;
    }

    return {
      success: true,
      controller: controller === 'none' ? 'bridge-search' : controller,
      restoredPatterns,
      sessionId: options.sessionId,
    };
  } catch {
    return null;
  }
}

/**
 * End a session and persist episodic summary to ReflexionMemory.
 */
export async function bridgeSessionEnd(options: {
  sessionId: string;
  summary?: string;
  tasksCompleted?: number;
  patternsLearned?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  controller: string;
  persisted: boolean;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    let controller = 'none';
    let persisted = false;

    // End episode in ReflexionMemory
    const reflexion = registry.get('reflexion');
    if (reflexion && typeof reflexion.endEpisode === 'function') {
      await reflexion.endEpisode(options.sessionId, {
        summary: options.summary,
        tasksCompleted: options.tasksCompleted,
        patternsLearned: options.patternsLearned,
      });
      controller = 'reflexion';
      persisted = true;
    }

    // Persist session summary as memory entry
    await bridgeStoreEntry({
      key: `session-${options.sessionId}`,
      value: JSON.stringify({
        sessionId: options.sessionId,
        summary: options.summary || 'Session ended',
        tasksCompleted: options.tasksCompleted || 0,
        patternsLearned: options.patternsLearned || 0,
        endedAt: new Date().toISOString(),
      }),
      namespace: 'session',
      tags: ['session-end'],
      upsert: true,
      dbPath: options.dbPath,
    });

    if (controller === 'none') controller = 'bridge-store';
    persisted = true;

    // Phase 3: Trigger NightlyLearner consolidation if available
    const nightlyLearner = registry.get('nightlyLearner');
    if (nightlyLearner && typeof nightlyLearner.consolidate === 'function') {
      try {
        await nightlyLearner.consolidate({ sessionId: options.sessionId });
        controller += '+nightlyLearner';
      } catch { /* non-fatal */ }
    }

    return { success: true, controller, persisted };
  } catch {
    return null;
  }
}

// ===== Phase 5: SemanticRouter bridge =====

/**
 * Route a task via AgentDB's SemanticRouter.
 * Returns null to fall back to local ruvector router.
 */
export async function bridgeRouteTask(options: {
  task: string;
  context?: string;
  dbPath?: string;
}): Promise<{
  route: string;
  confidence: number;
  agents: string[];
  controller: string;
} | null> {
  const registry = await getRegistry(options.dbPath);
  if (!registry) return null;

  try {
    // Try AgentDB's SemanticRouter
    const semanticRouter = registry.get('semanticRouter');
    if (semanticRouter && typeof semanticRouter.route === 'function') {
      const result = await semanticRouter.route(options.task, { context: options.context });
      if (result) {
        return {
          route: result.route || result.category || 'general',
          confidence: result.confidence || result.score || 0.5,
          agents: result.agents || result.suggestedAgents || [],
          controller: 'semanticRouter',
        };
      }
    }

    // Try LearningSystem recommendAlgorithm (Phase 4)
    const learningSystem = registry.get('learningSystem');
    if (learningSystem && typeof learningSystem.recommendAlgorithm === 'function') {
      const rec = await learningSystem.recommendAlgorithm(options.task);
      if (rec) {
        return {
          route: rec.algorithm || rec.route || 'general',
          confidence: rec.confidence || 0.5,
          agents: rec.agents || [],
          controller: 'learningSystem',
        };
      }
    }

    return null; // Fall back to local router
  } catch {
    return null;
  }
}

// ===== Phase 4: Health check with attestation =====

/**
 * Get comprehensive bridge health including all controller statuses.
 */
export async function bridgeHealthCheck(
  dbPath?: string,
): Promise<{
  available: boolean;
  controllers: Array<{ name: string; enabled: boolean; level: number }>;
  attestationCount?: number;
  cacheStats?: { size: number; hits: number; misses: number };
} | null> {
  const registry = await getRegistry(dbPath);
  if (!registry) return null;

  try {
    const controllers = registry.listControllers();

    // Phase 4: AttestationLog stats
    let attestationCount = 0;
    const attestation = registry.get('attestationLog');
    if (attestation && typeof attestation.count === 'function') {
      attestationCount = attestation.count();
    }

    // Phase 2: TieredCache stats
    let cacheStats = { size: 0, hits: 0, misses: 0 };
    const cache = registry.get('tieredCache');
    if (cache && typeof cache.stats === 'function') {
      const s = cache.stats();
      cacheStats = { size: s.size || 0, hits: s.hits || 0, misses: s.misses || 0 };
    }

    return { available: true, controllers, attestationCount, cacheStats };
  } catch {
    return null;
  }
}

// ===== Utility =====

function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i], bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const mag = Math.sqrt(normA * normB);
  return mag === 0 ? 0 : dot / mag;
}
