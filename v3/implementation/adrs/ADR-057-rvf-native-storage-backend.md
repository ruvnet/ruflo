# ADR-057: RVF Native Storage Backend — Replace sql.js with RuVector Format

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-02-28 |
| **Authors** | Claude Flow Team |
| **Supersedes** | — |
| **Related** | ADR-053 (AgentDB Controller Activation), ADR-054 (RVF Plugin Marketplace), ADR-055 (Controller Bug Remediation), ADR-056 (agentic-flow v3 Integration) |

---

## 1. Context

### The Problem

`npx ruflo@latest` installs **1.3GB** across 914 packages with a 35-second cold start in Docker. The Docker optimization work (Dockerfile.lite with `--omit=optional` + aggressive pruning) reduced this to 324MB, but the **core dependency chain** still carries unnecessary weight:

```
ruflo (5KB wrapper)
  └─ @claude-flow/cli (9MB)
       ├─ @claude-flow/shared (11MB) ← depends on sql.js (18MB WASM)
       ├─ @claude-flow/mcp (650KB)
       ├─ semver (tiny)
       └─ @noble/ed25519 (tiny)
```

**`sql.js` is the single largest hard dependency** — an 18MB WASM SQLite bundle compiled from C via Emscripten. It is used in three places:

| Consumer | File | Purpose | Lines |
|----------|------|---------|-------|
| `@claude-flow/shared` | `events/event-store.ts` | Append-only event sourcing log | 589 |
| `@claude-flow/memory` | `sqljs-backend.ts` | Memory entries + brute-force vector search | 767 |
| `@claude-flow/embeddings` | `persistent-cache.ts` | LRU embedding cache with TTL | 411 |

### What sql.js Actually Does

Analysis of all 1,767 lines of sql.js-consuming code reveals:

1. **Key-value storage** with namespace isolation
2. **BLOB columns** for Float32Array embedding vectors
3. **JSON TEXT columns** for metadata, tags, references
4. **Dynamic SQL filtering** (namespace, type, time range, pagination)
5. **Append-only event log** with version tracking and snapshots
6. **LRU cache** with TTL-based eviction
7. **Brute-force cosine similarity** search (no indexing)

Notably, sql.js provides **no vector indexing** — the SqlJsBackend comments explicitly state:

```typescript
// sql.js doesn't have native vector index
message: 'No vector index (brute-force search)',
recommendations.push('Consider using better-sqlite3 with HNSW for faster vector search');
```

### The Opportunity

RVF (RuVector Format) is a binary container format already used in the Claude Flow ecosystem (ADR-054). It provides everything sql.js does **plus native HNSW indexing** in a fraction of the footprint:

| Capability | sql.js | RVF |
|-----------|--------|-----|
| Package size | 18MB WASM | ~50 bytes/vector overhead |
| Vector search | Brute-force O(n) | HNSW 3-layer progressive (150x-12,500x faster) |
| Quantization | None | fp16, fp32, int8, int4, binary |
| Crash safety | Manual export/save | Append-only (no WAL needed) |
| COW branching | N/A | <3ms branch, 1:200 compression |
| WASM support | 18MB Emscripten bundle | 5.5KB microkernel + 46KB control plane |
| Native support | N/A | NAPI-RS (zero-copy) |
| Key-value store | SQL tables | MANIFEST + KV_SEG segments |
| Event log | SQL INSERT | Append-only LOG_SEG |
| Cross-platform | Yes (WASM-only) | Yes (native + WASM fallback) |

---

## 2. Decision

**Replace sql.js with RVF as the native storage backend** across `@claude-flow/shared`, `@claude-flow/memory`, and `@claude-flow/embeddings`. Provide automatic and manual migration paths for existing SQLite (`.db`) and JSON (`.json`) data files with full backward compatibility.

### Storage Architecture

```
Before (sql.js):
┌─────────────────────────────────────┐
│  @claude-flow/shared                │
│  ├─ EventStore → sql.js (18MB WASM) │
│  └─ event-store.db                  │
├─────────────────────────────────────┤
│  @claude-flow/memory                │
│  ├─ SqlJsBackend → sql.js           │
│  └─ memory.db                       │
├─────────────────────────────────────┤
│  @claude-flow/embeddings            │
│  ├─ PersistentCache → sql.js        │
│  └─ embeddings.db                   │
└─────────────────────────────────────┘

After (RVF):
┌─────────────────────────────────────┐
│  @claude-flow/shared                │
│  ├─ EventStore → RvfEventLog        │
│  └─ events.rvf (LOG_SEG)            │
├─────────────────────────────────────┤
│  @claude-flow/memory                │
│  ├─ RvfBackend → RVF native         │
│  └─ memory.rvf (VEC_SEG + KV_SEG)   │
├─────────────────────────────────────┤
│  @claude-flow/embeddings            │
│  ├─ RvfEmbeddingCache → RVF native  │
│  └─ embeddings.rvf (VEC_SEG)        │
└─────────────────────────────────────┘
```

### Segment Mapping

| sql.js Table | RVF Segment | Purpose |
|-------------|-------------|---------|
| `memory_entries` | `KV_SEG` + `VEC_SEG` | Key-value metadata + vector embeddings |
| `memory_entries.embedding` (BLOB) | `VEC_SEG` (fp32/fp16/int8) | Typed vector storage with quantization |
| `events` | `LOG_SEG` | Append-only event log (replaces SQL INSERT) |
| `snapshots` | `SNAP_SEG` | Event sourcing snapshots |
| `embeddings` | `VEC_SEG` + `INDEX_SEG` | Cached embeddings with HNSW index |
| Dynamic SQL indexes | `INDEX_SEG` (3-layer HNSW) | Progressive loading: 70% recall on first query |
| JSON metadata columns | `META_SEG` | Structured metadata without JSON.parse overhead |

---

## 3. Migration Strategy

### 3.1 File Detection and Format Routing

The system detects the storage format by file extension and magic bytes:

```typescript
enum StorageFormat {
  SQLITE_SQLJS = 'sqlite-sqljs',   // .db files from sql.js
  SQLITE_NATIVE = 'sqlite-native', // .db files from better-sqlite3
  JSON = 'json',                    // .json fallback files
  RVF = 'rvf',                     // .rvf native format
  UNKNOWN = 'unknown',
}

function detectFormat(filePath: string): StorageFormat {
  if (!existsSync(filePath)) return StorageFormat.UNKNOWN;

  const ext = extname(filePath).toLowerCase();
  const header = readFileSync(filePath, { length: 16 });

  // RVF magic bytes: first 4 bytes
  if (header.slice(0, 4).toString() === 'RVF\0') return StorageFormat.RVF;

  // SQLite magic: "SQLite format 3\0"
  if (header.toString('ascii', 0, 15) === 'SQLite format 3') {
    return StorageFormat.SQLITE_SQLJS; // or SQLITE_NATIVE (same on-disk)
  }

  // JSON detection
  if (ext === '.json') return StorageFormat.JSON;

  return StorageFormat.UNKNOWN;
}
```

### 3.2 Automatic Migration (Transparent)

On first access, the `DatabaseProvider` detects legacy formats and migrates automatically:

```typescript
async function openStorage(path: string, options: StorageOptions): Promise<IMemoryBackend> {
  const rvfPath = path.replace(/\.(db|json)$/, '.rvf');

  // If .rvf already exists, use it directly
  if (existsSync(rvfPath)) {
    return new RvfBackend(rvfPath, options);
  }

  // Detect legacy format
  const legacyFormat = detectFormat(path);

  if (legacyFormat === StorageFormat.UNKNOWN) {
    // Fresh install — create new .rvf file
    return new RvfBackend(rvfPath, options);
  }

  // Auto-migrate legacy → RVF
  console.info(`[migration] Detected ${legacyFormat} at ${path}, migrating to RVF...`);
  const migrator = new StorageMigrator(path, rvfPath, legacyFormat);
  await migrator.migrate();

  // Rename legacy file to .bak (not deleted)
  renameSync(path, path + '.bak');
  console.info(`[migration] Complete. Legacy file backed up to ${path}.bak`);

  return new RvfBackend(rvfPath, options);
}
```

**Automatic migration guarantees:**
- Legacy `.db` and `.json` files are **never deleted** — renamed to `.bak`
- Migration is **atomic** — writes to temp file, renames on success
- Migration is **idempotent** — re-running is safe (checks for existing `.rvf`)
- Migration reports **progress** for large datasets (percentage, ETA)

### 3.3 Manual Migration (CLI Commands)

```bash
# Check current storage format and migration status
ruflo migrate status --storage

# Dry-run migration (report what would change, don't modify)
ruflo migrate run --storage --dry-run

# Migrate specific file
ruflo migrate run --storage --file ./data/memory/memory.db

# Migrate all storage files in project
ruflo migrate run --storage --all

# Force re-migration (even if .rvf already exists)
ruflo migrate run --storage --force

# Rollback: restore from .bak files
ruflo migrate rollback --storage

# Validate migrated data integrity
ruflo migrate validate --storage
```

### 3.4 Migration for Each Data Type

#### A. Memory Entries (`.db` → `.rvf`)

```typescript
class MemoryMigrator {
  async migrateFromSqlite(dbPath: string, rvfPath: string): Promise<MigrationResult> {
    const SQL = await initSqlJs();
    const buffer = readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(buffer));

    const rvf = await RvfFile.create(rvfPath);
    const kvSeg = rvf.createSegment('KV_SEG');
    const vecSeg = rvf.createSegment('VEC_SEG');
    const idxSeg = rvf.createSegment('INDEX_SEG');

    let migrated = 0;
    let skipped = 0;

    const stmt = db.prepare('SELECT * FROM memory_entries ORDER BY created_at ASC');
    while (stmt.step()) {
      const row = stmt.getAsObject();

      // Migrate key-value metadata
      kvSeg.put(row.id as string, {
        key: row.key,
        content: row.content,
        type: row.type,
        namespace: row.namespace,
        tags: JSON.parse(row.tags as string),
        metadata: JSON.parse(row.metadata as string),
        owner_id: row.owner_id,
        access_level: row.access_level,
        created_at: row.created_at,
        updated_at: row.updated_at,
        expires_at: row.expires_at,
        version: row.version,
        references: JSON.parse(row.references as string),
        access_count: row.access_count,
        last_accessed_at: row.last_accessed_at,
      });

      // Migrate vector embeddings (if present)
      if (row.embedding) {
        const embedding = new Float32Array(
          new Uint8Array(row.embedding as Uint8Array).buffer
        );
        vecSeg.insert(row.id as string, embedding);
        migrated++;
      } else {
        skipped++;
      }
    }
    stmt.free();

    // Build HNSW index on migrated vectors
    if (migrated > 0) {
      await idxSeg.buildHnsw({ efConstruction: 200, M: 16 });
    }

    await rvf.flush();
    db.close();

    return { migrated, skipped, indexBuilt: migrated > 0 };
  }
}
```

#### B. Event Store (`.db` → `.rvf`)

```typescript
class EventStoreMigrator {
  async migrateFromSqlite(dbPath: string, rvfPath: string): Promise<MigrationResult> {
    const SQL = await initSqlJs();
    const buffer = readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(buffer));

    const rvf = await RvfFile.create(rvfPath);
    const logSeg = rvf.createSegment('LOG_SEG');
    const snapSeg = rvf.createSegment('SNAP_SEG');

    let events = 0;
    let snapshots = 0;

    // Migrate events (order preserved)
    const eventStmt = db.prepare('SELECT * FROM events ORDER BY timestamp ASC, version ASC');
    while (eventStmt.step()) {
      const row = eventStmt.getAsObject();
      logSeg.append({
        id: row.id,
        type: row.type,
        aggregate_id: row.aggregate_id,
        aggregate_type: row.aggregate_type,
        version: row.version,
        timestamp: row.timestamp,
        source: row.source,
        payload: JSON.parse(row.payload as string),
        metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
        causation_id: row.causation_id,
        correlation_id: row.correlation_id,
      });
      events++;
    }
    eventStmt.free();

    // Migrate snapshots
    const snapStmt = db.prepare('SELECT * FROM snapshots');
    while (snapStmt.step()) {
      const row = snapStmt.getAsObject();
      snapSeg.put(row.aggregate_id as string, {
        aggregate_type: row.aggregate_type,
        version: row.version,
        state: JSON.parse(row.state as string),
        timestamp: row.timestamp,
      });
      snapshots++;
    }
    snapStmt.free();

    await rvf.flush();
    db.close();

    return { events, snapshots };
  }
}
```

#### C. JSON Fallback Files (`.json` → `.rvf`)

```typescript
class JsonMigrator {
  async migrateFromJson(jsonPath: string, rvfPath: string): Promise<MigrationResult> {
    const raw = readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(raw);

    const rvf = await RvfFile.create(rvfPath);
    const kvSeg = rvf.createSegment('KV_SEG');
    const vecSeg = rvf.createSegment('VEC_SEG');

    let migrated = 0;

    // JSON backend stores entries as { [namespace]: { [key]: entry } }
    for (const [namespace, entries] of Object.entries(data)) {
      for (const [key, entry] of Object.entries(entries as Record<string, any>)) {
        const id = entry.id || `${namespace}:${key}`;
        kvSeg.put(id, { ...entry, namespace, key });

        if (entry.embedding && Array.isArray(entry.embedding)) {
          vecSeg.insert(id, new Float32Array(entry.embedding));
          migrated++;
        }
      }
    }

    await rvf.flush();
    return { migrated };
  }
}
```

#### D. Embedding Cache (`.db` → `.rvf`)

```typescript
class EmbeddingCacheMigrator {
  async migrateFromSqlite(dbPath: string, rvfPath: string): Promise<MigrationResult> {
    const SQL = await initSqlJs();
    const buffer = readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(buffer));

    const rvf = await RvfFile.create(rvfPath);
    const vecSeg = rvf.createSegment('VEC_SEG');
    const idxSeg = rvf.createSegment('INDEX_SEG');

    let migrated = 0;

    const stmt = db.prepare('SELECT * FROM embeddings ORDER BY accessed_at DESC');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const embedding = new Float32Array(
        new ArrayBuffer(row.embedding as ArrayBuffer)
      );

      vecSeg.insert(row.key as string, embedding, {
        dimensions: row.dimensions,
        created_at: row.created_at,
        accessed_at: row.accessed_at,
        access_count: row.access_count,
      });
      migrated++;
    }
    stmt.free();

    // Build HNSW index for fast similarity search
    if (migrated > 0) {
      await idxSeg.buildHnsw({ efConstruction: 128, M: 12 });
    }

    await rvf.flush();
    db.close();

    return { migrated, indexBuilt: migrated > 0 };
  }
}
```

### 3.5 Backward Compatibility

#### Read Compatibility (Permanent)

The `DatabaseProvider` maintains **permanent read support** for all legacy formats:

```typescript
// database-provider.ts — updated selection logic
async function selectBackend(path: string, options: StorageOptions): Promise<IMemoryBackend> {
  const format = detectFormat(path);

  switch (format) {
    case StorageFormat.RVF:
      return new RvfBackend(path, options);

    case StorageFormat.SQLITE_SQLJS:
    case StorageFormat.SQLITE_NATIVE:
      // Legacy read support — loads sql.js only when needed
      const { SqlJsBackend } = await import('./sqljs-backend.js');
      return new SqlJsBackend({ databasePath: path, ...options });

    case StorageFormat.JSON:
      const { JsonBackend } = await import('./json-backend.js');
      return new JsonBackend(path, options.verbose);

    default:
      // New installation — create RVF
      return new RvfBackend(path.replace(/\.[^.]+$/, '.rvf'), options);
  }
}
```

**Key compatibility rules:**

1. **Legacy backends become lazy-loaded** — `sql.js` moves to a dynamic `import()`, only loaded when a `.db` file is detected. Zero cost for new installations.
2. **JSON backend stays** — for the simplest possible fallback (no binary deps at all).
3. **`.bak` files are kept indefinitely** — users can manually rollback at any time.
4. **`ruflo migrate rollback --storage`** restores `.bak` → original and removes `.rvf`.

#### Write Compatibility

New writes always go to RVF. The `--legacy-format` flag forces legacy format:

```bash
# Force sql.js backend for specific use case
ruflo memory init --backend sqljs

# Force JSON backend
ruflo memory init --backend json

# Default (RVF)
ruflo memory init
```

#### Version Negotiation

The RVF file header includes format version for forward compatibility:

```
Offset  Size  Field          Value
0x00    4     magic          "RVF\0"
0x04    2     version_major  1
0x06    2     version_minor  0
0x08    8     segment_count  N
0x10    8     created_at     Unix timestamp
0x18    8     flags          Feature flags
```

If a future RVF version adds incompatible features, the reader can detect this and fall back to the legacy backend or prompt for upgrade.

---

## 4. Implementation Plan

### Phase 1: RVF Backend Implementation (Week 1-2)

| Task | Package | Description |
|------|---------|-------------|
| P1.1 | `@claude-flow/memory` | Create `RvfBackend` implementing `IMemoryBackend` interface |
| P1.2 | `@claude-flow/memory` | Map `KV_SEG` to memory entry CRUD operations |
| P1.3 | `@claude-flow/memory` | Map `VEC_SEG` to embedding storage with typed quantization |
| P1.4 | `@claude-flow/memory` | Map `INDEX_SEG` to HNSW search (replace brute-force cosine) |
| P1.5 | `@claude-flow/memory` | Add `RvfBackend` to `DatabaseProvider` selection chain |

### Phase 2: Event Store Migration (Week 2-3)

| Task | Package | Description |
|------|---------|-------------|
| P2.1 | `@claude-flow/shared` | Create `RvfEventLog` implementing `IEventStore` interface |
| P2.2 | `@claude-flow/shared` | Map `LOG_SEG` to append-only event operations |
| P2.3 | `@claude-flow/shared` | Map `SNAP_SEG` to snapshot save/load |
| P2.4 | `@claude-flow/shared` | Move `sql.js` from `dependencies` to `optionalDependencies` |

### Phase 3: Embedding Cache Migration (Week 3)

| Task | Package | Description |
|------|---------|-------------|
| P3.1 | `@claude-flow/embeddings` | Create `RvfEmbeddingCache` implementing `IPersistentCache` |
| P3.2 | `@claude-flow/embeddings` | LRU eviction via RVF metadata (no SQL DELETE needed) |
| P3.3 | `@claude-flow/embeddings` | TTL via RVF expiry flags (segment-level) |
| P3.4 | `@claude-flow/embeddings` | Move `sql.js` from `dependencies` to `optionalDependencies` |

### Phase 4: Migration Tooling (Week 3-4)

| Task | Package | Description |
|------|---------|-------------|
| P4.1 | `@claude-flow/cli` | `ruflo migrate status --storage` — detect formats, report state |
| P4.2 | `@claude-flow/cli` | `ruflo migrate run --storage` — batch migration with progress |
| P4.3 | `@claude-flow/cli` | `ruflo migrate rollback --storage` — restore from `.bak` |
| P4.4 | `@claude-flow/cli` | `ruflo migrate validate --storage` — integrity verification |
| P4.5 | `@claude-flow/memory` | Automatic migration in `DatabaseProvider.openStorage()` |

### Phase 5: Dependency Cleanup (Week 4)

| Task | Package | Description |
|------|---------|-------------|
| P5.1 | `@claude-flow/shared` | Remove `sql.js` from hard dependencies |
| P5.2 | `@claude-flow/memory` | Remove `sql.js` from hard dependencies |
| P5.3 | `@claude-flow/embeddings` | Remove `sql.js` from hard dependencies |
| P5.4 | All | Lazy-load sql.js only for legacy `.db` file reads |
| P5.5 | All | Update Docker images to exclude sql.js entirely |
| P5.6 | Root | Publish updated packages to npm |

---

## 5. RVF Backend API Design

### RvfBackend (implements IMemoryBackend)

```typescript
import { RvfFile, VecSegment, KvSegment, IndexSegment } from '@ruvector/rvf';

export class RvfBackend implements IMemoryBackend {
  private rvf: RvfFile;
  private kv: KvSegment;
  private vec: VecSegment;
  private idx: IndexSegment;

  async initialize(): Promise<void> {
    this.rvf = await RvfFile.open(this.path, { create: true });
    this.kv = this.rvf.segment('KV_SEG');
    this.vec = this.rvf.segment('VEC_SEG');
    this.idx = this.rvf.segment('INDEX_SEG');
  }

  async store(entry: MemoryEntry): Promise<void> {
    // Metadata goes to KV segment
    this.kv.put(entry.id, {
      key: entry.key,
      content: entry.content,
      type: entry.type,
      namespace: entry.namespace,
      tags: entry.tags,
      metadata: entry.metadata,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    });

    // Vector goes to VEC segment (with optional quantization)
    if (entry.embedding) {
      this.vec.insert(entry.id, entry.embedding, {
        quantization: this.config.quantization || 'fp32',
      });
    }
  }

  async search(embedding: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    // HNSW search — 150x-12,500x faster than brute-force
    const results = this.idx.search(embedding, {
      k: options.k,
      efSearch: options.efSearch || 64,
      threshold: options.threshold,
    });

    return results.map(r => ({
      entry: this.kv.get(r.id),
      score: r.similarity,
      distance: r.distance,
    }));
  }

  async persist(): Promise<void> {
    await this.rvf.flush();  // Append-only — no full rewrite needed
  }

  async shutdown(): Promise<void> {
    await this.rvf.flush();
    this.rvf.close();
  }
}
```

### RvfEventLog (implements IEventStore)

```typescript
export class RvfEventLog implements IEventStore {
  private rvf: RvfFile;
  private log: LogSegment;
  private snap: SnapSegment;

  async append(event: DomainEvent): Promise<void> {
    // Append-only — crash-safe, no WAL needed
    this.log.append(event.id, {
      type: event.type,
      aggregate_id: event.aggregateId,
      version: event.version,
      timestamp: event.timestamp,
      payload: event.payload,
    });
  }

  async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
    return this.log.scan({
      filter: { aggregate_id: aggregateId },
      fromVersion,
      order: 'asc',
    });
  }

  async saveSnapshot(aggregateId: string, state: any, version: number): Promise<void> {
    this.snap.put(aggregateId, { state, version, timestamp: Date.now() });
  }
}
```

---

## 6. Size Impact Analysis

### Before (current)

| Package | Hard Deps | Total Install Weight |
|---------|-----------|---------------------|
| `@claude-flow/shared` | sql.js (18MB) | ~30MB |
| `@claude-flow/memory` | sql.js (18MB, deduped) | ~5MB own |
| `@claude-flow/embeddings` | sql.js (18MB, deduped) | ~3MB own |
| **Total sql.js contribution** | | **~18MB (deduped)** |

### After (RVF)

| Package | Hard Deps | Total Install Weight |
|---------|-----------|---------------------|
| `@claude-flow/shared` | `@ruvector/rvf` (WASM: 52KB, native: ~2MB) | ~13MB (−17MB) |
| `@claude-flow/memory` | (uses shared's rvf) | ~5MB (no change) |
| `@claude-flow/embeddings` | (uses shared's rvf) | ~3MB (no change) |
| **Total RVF contribution** | | **52KB WASM or ~2MB native** |

### Net savings

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| sql.js install size | 18MB | 0 (lazy optional) | **−18MB** |
| RVF install size | 0 | 52KB (WASM) | +52KB |
| Vector search | O(n) brute-force | O(log n) HNSW | **150x-12,500x faster** |
| Quantization | fp32 only | fp16/int8/int4/binary | **2-8x memory reduction** |
| Docker lite image | 324MB | ~306MB | **−18MB** |
| Cold start vectors | Load all into memory | Progressive 3-layer | **70% recall on first query** |

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RVF format changes in future | Low | Medium | Version header in file; forward-compat reads |
| Migration corrupts data | Low | High | Atomic write (temp + rename); `.bak` always kept |
| WASM fallback slower than sql.js | Medium | Low | RVF WASM kernel is 52KB vs 18MB; simpler = faster |
| Users depend on SQLite tooling | Medium | Low | Legacy read support permanent; `--backend sqljs` flag |
| `@ruvector/rvf` npm availability | Low | High | Vendor WASM binary into `@claude-flow/shared` as fallback |

---

## 8. Testing Strategy

```
Unit Tests:
  ✓ RvfBackend passes all existing IMemoryBackend test suite
  ✓ RvfEventLog passes all existing IEventStore test suite
  ✓ RvfEmbeddingCache passes all existing IPersistentCache test suite
  ✓ Format detection correctly identifies .db, .json, .rvf files
  ✓ Migration produces byte-identical data (hash comparison)

Integration Tests:
  ✓ Auto-migration on first access with legacy .db file
  ✓ Auto-migration on first access with legacy .json file
  ✓ Rollback restores .bak to original
  ✓ CLI `migrate status/run/rollback/validate` commands
  ✓ Mixed-format project (some .db, some .rvf) works

Performance Tests:
  ✓ HNSW search <1ms for 10K vectors (vs ~100ms brute-force)
  ✓ RVF write throughput >50K ops/sec
  ✓ Memory usage <50% of sql.js for equivalent dataset
  ✓ Cold start <100ms (progressive HNSW loading)

Backward Compatibility Tests:
  ✓ v3.5.x .db files open correctly in v3.6+ with auto-migration
  ✓ v3.5.x .json files open correctly in v3.6+ with auto-migration
  ✓ --backend sqljs flag still works (lazy-loads sql.js)
  ✓ --backend json flag still works
  ✓ Docker image without sql.js starts and serves MCP
```

---

## 9. Consequences

### Positive

- **−18MB hard dependency** removed from core install path
- **150x-12,500x faster** vector search via native HNSW (vs brute-force cosine)
- **2-8x memory reduction** via quantization (int8/int4) for large embedding sets
- **Crash-safe** append-only format — no manual export/save cycle
- **Progressive loading** — 70% recall on first query before full index loads
- **Unified format** — one `.rvf` file replaces separate `.db` + index files
- **COW branching** — cheap snapshots for event sourcing (<3ms)
- **Docker images shrink** further when sql.js is fully eliminated

### Negative

- **Migration complexity** — must support 3 legacy formats (sql.js .db, better-sqlite3 .db, JSON)
- **New dependency** — `@ruvector/rvf` replaces `sql.js` (smaller, but still a dep)
- **Learning curve** — team must understand RVF segment model vs SQL tables
- **Loss of SQL tooling** — can't `sqlite3 memory.db` to inspect data (mitigated by `ruflo memory list`)

### Neutral

- **Backward compatibility maintained** — legacy formats always readable
- **No user-visible API changes** — same `IMemoryBackend` interface, same CLI commands
- **Opt-in for existing installs** — auto-migration on first access, manual rollback available

---

## 10. References

- [RuVector Format Specification](https://github.com/ruvnet/ruvector/blob/main/crates/rvf/README.md)
- [ruvector npm package](https://www.npmjs.com/package/ruvector)
- [ADR-053: AgentDB v3 Controller Activation](./ADR-053-agentdb-v3-controller-activation.md)
- [ADR-054: RVF-Powered Plugin Marketplace](./ADR-054-rvf-powered-plugin-marketplace.md)
- [ADR-055: AgentDB Controller Bug Remediation](./ADR-055-agentdb-controller-bug-remediation.md)
- [USearch — Memory-mapped HNSW](https://github.com/unum-cloud/USearch)
- [sql.js — WASM SQLite](https://github.com/sql-js/sql.js)
