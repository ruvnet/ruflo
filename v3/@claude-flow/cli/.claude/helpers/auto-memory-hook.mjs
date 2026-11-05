#!/usr/bin/env node
/**
 * Auto Memory Bridge Hook (ADR-048/049)
 *
 * Wires AutoMemoryBridge + LearningBridge + MemoryGraph into Claude Code
 * session lifecycle. Called by settings.json SessionStart/SessionEnd hooks.
 *
 * Usage:
 *   node auto-memory-hook.mjs import   # SessionStart: import auto memory files into backend
 *   node auto-memory-hook.mjs sync     # SessionEnd: sync insights back to MEMORY.md
 *   node auto-memory-hook.mjs status   # Show bridge status
 *   node auto-memory-hook.mjs read <namespace> <key>   # Read-only exact lookup, prints JSON
 *
 * import and sync exit 1 when they fail (never 2, which Claude Code treats as
 * "block"), so a failed write is visible without stopping the session.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, rmSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Executable modules resolve only from the helper's own install root. A
// home-level helper can serve an untrusted project, so CLAUDE_PROJECT_DIR must
// never decide which JavaScript gets imported.
const MODULE_ROOT = join(__dirname, '../..');
// Home-level helpers can serve a different project. Keep the memory writer on
// the same project root as intelligence.cjs, which reads CLAUDE_PROJECT_DIR.
// PROJECT_ROOT is for data only.
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR
  ? resolve(process.env.CLAUDE_PROJECT_DIR)
  : MODULE_ROOT;
const DATA_DIR = join(PROJECT_ROOT, '.claude-flow', 'data');
const STORE_PATH = join(DATA_DIR, 'auto-memory-store.json');

// Colors
const GREEN = '\x1b[0;32m';
const CYAN = '\x1b[0;36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const YELLOW = '\x1b[0;33m';
const log = (msg) => console.log(`${CYAN}[AutoMemory] ${msg}${RESET}`);
const success = (msg) => console.log(`${GREEN}[AutoMemory] ✓ ${msg}${RESET}`);
const dim = (msg) => console.log(`  ${DIM}${msg}${RESET}`);

// #2545: fail LOUD instead of a silent dim skip. When @claude-flow/memory cannot
// be resolved, self-learning imports are a no-op — the user must see this and be
// told exactly how to fix it (on both stdout, so it shows in the Claude Code hook
// transcript, and stderr, per the issue's requested channel).
function warnMemoryUnavailable() {
  const line1 = `[AutoMemory] @claude-flow/memory not resolvable from ${MODULE_ROOT} — self-learning imports are DISABLED.`;
  const line2 = '             Fix: npm i -D @claude-flow/memory   (or re-run: npx ruflo@latest init, then npx ruflo@latest doctor --fix)';
  console.log(`${YELLOW}${line1}${RESET}`);
  console.log(`${YELLOW}${line2}${RESET}`);
  process.stderr.write(`${line1}\n${line2}\n`);
}

const DEBUG = !!(process.env.RUFLO_DEBUG || process.env.DEBUG);

/** A command failure whose message is already complete; main prints it and exits 1. */
class HookFailure extends Error {}

// ── Graceful shutdown (FIX 3) ───────────────────────────────────────────────
// Track the backend in use so a SIGTERM/SIGINT mid-run can still flush it
// (the JSON backend persists; a SQLite-backed one closes/flushes WAL) instead
// of leaving a half-written store or a stale lock behind.
let activeBackend = null;
let shuttingDown = false;
function trackBackend(b) { activeBackend = b; return b; }
async function gracefulExit(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (DEBUG) process.stderr.write(`[AutoMemory] received ${signal}, flushing backend before exit\n`);
  try {
    if (activeBackend && typeof activeBackend.shutdown === 'function') await activeBackend.shutdown();
  } catch { /* best effort — never block exit on cleanup */ }
  process.exit(0);
}
process.on('SIGTERM', () => { gracefulExit('SIGTERM'); });
process.on('SIGINT', () => { gracefulExit('SIGINT'); });

// The data directory is created lazily by import and sync only, so the
// read-only `read` subcommand never creates directories (#4685).
function ensureDataDir() { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); }

// ============================================================================
// Store write safety (#4058): intelligence.cjs read-modify-writes the same
// file from the session-end hook, so writes are atomic (temp + rename) and
// serialised by a short directory lock. The lock is advisory and fails open:
// a hook must never hang, so after ~2 s it proceeds without it.
// ============================================================================

const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10000;
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function withStoreLock(storePath, fn) {
  const lock = storePath + '.lock';
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  for (;;) {
    try { mkdirSync(lock); held = true; break; } catch (e) {
      if (!e || e.code !== 'EEXIST') break;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { recursive: true, force: true }); continue; }
      } catch { /* lock vanished: retry */ }
      if (Date.now() > deadline) break;
      sleepSync(10);
    }
  }
  try { return fn(); } finally { if (held) { try { rmdirSync(lock); } catch { /* already gone */ } } }
}

function writeFileAtomic(filePath, text) {
  const tmp = filePath + '.' + process.pid + '.tmp';
  try {
    writeFileSync(tmp, text, 'utf-8');
    renameSync(tmp, filePath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}

// ============================================================================
// Strict store reads (#4685): only ENOENT means "no store yet". A read or
// parse failure, a non-array document, or an entry without a unique string id
// is an error, and the file is never rewritten, so its bytes stay intact.
// ============================================================================

class StoreError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function parseStoreText(text, filePath) {
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new StoreError('STORE_PARSE_FAILED', `${filePath} is not valid JSON (${e.message}); left unchanged`, e);
  }
  if (!Array.isArray(data)) {
    throw new StoreError('STORE_NOT_ARRAY', `${filePath} does not hold a JSON array; left unchanged`);
  }
  const seen = new Set();
  for (let i = 0; i < data.length; i++) {
    const e = data[i];
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      throw new StoreError('STORE_BAD_ENTRY', `${filePath} entry ${i} is not an object; left unchanged`);
    }
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new StoreError('STORE_BAD_ID', `${filePath} entry ${i} has no string id; left unchanged`);
    }
    if (seen.has(e.id)) {
      // intelligence.cjs de-duplicates the store by id when it consolidates,
      // which repairs a duplicate an older writer left behind.
      throw new StoreError('STORE_DUPLICATE_ID', `${filePath} holds duplicate id ${JSON.stringify(e.id)}; left unchanged`);
    }
    seen.add(e.id);
  }
  return data;
}

/** The parsed entries, or null when the file does not exist. Anything else throws a StoreError. */
function readStoreFile(filePath) {
  let text;
  try { text = readFileSync(filePath, 'utf-8'); } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    const why = (e && (e.code || e.message)) || String(e);
    throw new StoreError('STORE_READ_FAILED', `cannot read ${filePath} (${why}); left unchanged`, e);
  }
  return parseStoreText(text, filePath);
}

/**
 * Re-read the store and check that every expected entry is present and equal
 * under `same`, and that every deleted id is gone. Throws on any mismatch.
 */
function verifyStoreFile(filePath, expected, deletedIds, same) {
  const onDisk = readStoreFile(filePath);
  if (onDisk === null) throw new StoreError('STORE_READBACK_MISMATCH', `${filePath} is missing after the write`);
  const byId = new Map(onDisk.map((e) => [e.id, e]));
  for (const [id, want] of expected) {
    const got = byId.get(id);
    if (!got) throw new StoreError('STORE_READBACK_MISMATCH', `${filePath} readback is missing entry ${JSON.stringify(id)}`);
    if (!same(got, want)) throw new StoreError('STORE_READBACK_MISMATCH', `${filePath} readback differs for entry ${JSON.stringify(id)}`);
  }
  for (const id of deletedIds) {
    if (!expected.has(id) && byId.has(id)) {
      throw new StoreError('STORE_READBACK_MISMATCH', `${filePath} readback still holds deleted entry ${JSON.stringify(id)}`);
    }
  }
  return onDisk;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameRecord = (a, b) => a.namespace === b.namespace && a.key === b.key && a.content === b.content;

// Claude Code shares one auto-memory directory across every worktree of a
// repository, but findGitRoot() in the memory package stops at a worktree's
// `.git` FILE and keys the directory by the worktree path (#4058). Resolve the
// main checkout through git's common dir so both agree. No shell is involved.
function mainCheckoutRoot(dir) {
  try {
    if (!statSync(join(dir, '.git')).isFile()) return null;
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!common) return null;
    const abs = resolve(dir, common);
    return abs.endsWith('/.git') || abs.endsWith('\\.git') ? dirname(abs) : null;
  } catch { return null; }
}

function worktreeMemoryDir() {
  const main = mainCheckoutRoot(PROJECT_ROOT);
  if (!main) return undefined;
  const key = main.split(sep).join('/').replace(/[\/_:]/g, '-');
  return join(process.env.HOME || process.env.USERPROFILE || homedir(), '.claude', 'projects', key, 'memory');
}

// ============================================================================
// Simple JSON File Backend (implements IMemoryBackend interface)
// ============================================================================

class JsonFileBackend {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = new Map();
    this.loadedIds = new Set();
    this.deletedIds = new Set();
    // Entries this instance wrote (or deleted), so a caller can confirm them on disk.
    this.written = new Map();
    this.storePresent = false;
  }

  async initialize() {
    // Throws on anything but a missing file, so a damaged store is never
    // mistaken for an empty one and later overwritten (#4685).
    const data = readStoreFile(this.filePath);
    this.storePresent = data !== null;
    for (const entry of data || []) { this.entries.set(entry.id, entry); this.loadedIds.add(entry.id); }
  }

  _track(entry) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new StoreError('STORE_BAD_ID', 'refusing to store an entry without a string id');
    }
    this.entries.set(entry.id, entry);
    this.written.set(entry.id, entry);
    this.deletedIds.delete(entry.id);
  }

  _forget(id) {
    this.deletedIds.add(id);
    this.written.delete(id);
    return this.entries.delete(id);
  }

  async shutdown() { this._persist(); }
  async store(entry) { this._track(entry); this._persist(); }
  async get(id) { return this.entries.get(id) ?? null; }
  async getByKey(key, ns) {
    for (const e of this.entries.values()) {
      if (e.key === key && (!ns || e.namespace === ns)) return e;
    }
    return null;
  }
  async update(id, updates) {
    const e = this.entries.get(id);
    if (!e) return null;
    if (updates.metadata) Object.assign(e.metadata, updates.metadata);
    if (updates.content !== undefined) e.content = updates.content;
    if (updates.tags) e.tags = updates.tags;
    e.updatedAt = Date.now();
    this.written.set(id, e);
    this._persist();
    return e;
  }
  async delete(id) { return this._forget(id); }
  async query(opts) {
    let results = [...this.entries.values()];
    if (opts?.namespace) results = results.filter(e => e.namespace === opts.namespace);
    // MemoryQuery.type is the query mode (semantic|exact|prefix|tag|hybrid), not
    // the entry's memory type: the bridge asks for { type: 'hybrid' } and a strict
    // entry-type match returned nothing, so sync always reported 0 (#4058).
    const MODES = ['semantic', 'exact', 'prefix', 'tag', 'hybrid'];
    if (opts?.type && !MODES.includes(opts.type)) results = results.filter(e => e.type === opts.type);
    if (opts?.memoryType) results = results.filter(e => e.type === opts.memoryType);
    if (opts?.key) results = results.filter(e => e.key === opts.key);
    if (opts?.keyPrefix) results = results.filter(e => typeof e.key === 'string' && e.key.startsWith(opts.keyPrefix));
    if (Array.isArray(opts?.tags) && opts.tags.length) results = results.filter(e => opts.tags.every(t => (e.tags || []).includes(t)));
    if (opts?.updatedAfter) results = results.filter(e => (e.updatedAt || 0) > opts.updatedAfter);
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }
  async search() { return []; } // No vector search in JSON backend
  async bulkInsert(entries) { for (const e of entries) this._track(e); this._persist(); }
  async bulkDelete(ids) { let n = 0; for (const id of ids) { if (this._forget(id)) n++; } this._persist(); return n; }
  async count() { return this.entries.size; }
  async listNamespaces() {
    const ns = new Set();
    for (const e of this.entries.values()) ns.add(e.namespace || 'default');
    return [...ns];
  }
  async clearNamespace(ns) {
    let n = 0;
    for (const [id, e] of [...this.entries]) {
      if (e.namespace === ns) { this._forget(id); n++; }
    }
    this._persist();
    return n;
  }
  async getStats() {
    return {
      totalEntries: this.entries.size,
      entriesByNamespace: {},
      entriesByType: { semantic: 0, episodic: 0, procedural: 0, working: 0, cache: 0 },
      memoryUsage: 0, avgQueryTime: 0, avgSearchTime: 0,
    };
  }
  async healthCheck() {
    return {
      status: 'healthy',
      components: {
        storage: { status: 'healthy', latency: 0 },
        index: { status: 'healthy', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(), issues: [], recommendations: [],
    };
  }

  // Errors propagate (#4685): a failed read, write or rename must reject the
  // store/bulkInsert/shutdown call instead of resolving with an in-memory-only
  // update. The readback runs inside the lock so a parallel writer cannot race it.
  _persist() {
    withStoreLock(this.filePath, () => {
      // Keep entries another writer (intelligence.cjs, a parallel hook) added
      // after we loaded; ours win on the same id, and our own deletes stay deleted.
      // A missing file is the only case that writes without merging.
      const merged = new Map(this.entries);
      for (const e of readStoreFile(this.filePath) || []) {
        if (!merged.has(e.id) && !this.loadedIds.has(e.id) && !this.deletedIds.has(e.id)) merged.set(e.id, e);
      }
      writeFileAtomic(this.filePath, JSON.stringify([...merged.values()], null, 2));
      verifyStoreFile(this.filePath, merged, this.deletedIds, sameJson);
      for (const id of merged.keys()) this.loadedIds.add(id);
      this.entries = merged;
      this.storePresent = true;
    });
  }
}

// ============================================================================
// Resolve memory package path (local dev or npm installed)
// ============================================================================

async function loadMemoryPackage() {
  // Strategy 0 (#2545): sidecar recorded by `init` / `doctor --fix`. On the
  // documented `npx ruflo` path @claude-flow/memory (an optionalDependency of
  // the CLI) lands in the npx cache, which is NOT on the walk-up path from the
  // project — so init resolves it from the CLI's own context and records the
  // absolute path here. This is the only strategy that works on that install.
  try {
    const sidecar = join(MODULE_ROOT, '.claude-flow', 'memory-package.json');
    if (existsSync(sidecar)) {
      const rec = JSON.parse(readFileSync(sidecar, 'utf-8'));
      if (rec?.distPath && existsSync(rec.distPath)) {
        return await import(`file://${rec.distPath}`);
      }
    }
  } catch { /* fall through */ }

  // Strategy 1: Local dev (built dist)
  const localDist = join(MODULE_ROOT, 'v3/@claude-flow/memory/dist/index.js');
  if (existsSync(localDist)) {
    try {
      return await import(`file://${localDist}`);
    } catch { /* fall through */ }
  }

  // Strategy 2: Use createRequire for CJS-style resolution (handles nested node_modules
  // when installed as a transitive dependency via npx ruflo / npx @claude-flow/cli@latest)
  try {
    const { createRequire } = await import('module');
    const require = createRequire(join(MODULE_ROOT, 'package.json'));
    return require('@claude-flow/memory');
  } catch { /* fall through */ }

  // Strategy 3: ESM import (works when @claude-flow/memory is a direct dependency)
  try {
    return await import('@claude-flow/memory');
  } catch { /* fall through */ }

  // Strategy 4: Walk up from MODULE_ROOT looking for @claude-flow/memory in any node_modules
  let searchDir = MODULE_ROOT;
  const { parse } = await import('path');
  while (searchDir !== parse(searchDir).root) {
    const candidate = join(searchDir, 'node_modules', '@claude-flow', 'memory', 'dist', 'index.js');
    if (existsSync(candidate)) {
      try {
        return await import(`file://${candidate}`);
      } catch { /* fall through */ }
    }
    searchDir = dirname(searchDir);
  }

  return null;
}

// ============================================================================
// Read config from .claude-flow/config.yaml
// ============================================================================

function readConfig() {
  const configPath = join(PROJECT_ROOT, '.claude-flow', 'config.yaml');
  const defaults = {
    learningBridge: { enabled: true, sonaMode: 'balanced', confidenceDecayRate: 0.005, accessBoostAmount: 0.03, consolidationThreshold: 10 },
    memoryGraph: { enabled: true, pageRankDamping: 0.85, maxNodes: 5000, similarityThreshold: 0.8 },
    agentScopes: { enabled: true, defaultScope: 'project' },
  };

  if (!existsSync(configPath)) return defaults;

  try {
    const yaml = readFileSync(configPath, 'utf-8');
    // Simple YAML parser for the memory section
    const getBool = (key) => {
      const match = yaml.match(new RegExp(`${key}:\\s*(true|false)`, 'i'));
      return match ? match[1] === 'true' : undefined;
    };

    const lbEnabled = getBool('learningBridge[\\s\\S]*?enabled');
    if (lbEnabled !== undefined) defaults.learningBridge.enabled = lbEnabled;

    const mgEnabled = getBool('memoryGraph[\\s\\S]*?enabled');
    if (mgEnabled !== undefined) defaults.memoryGraph.enabled = mgEnabled;

    const asEnabled = getBool('agentScopes[\\s\\S]*?enabled');
    if (asEnabled !== undefined) defaults.agentScopes.enabled = asEnabled;

    return defaults;
  } catch {
    return defaults;
  }
}

// ============================================================================
// Commands
// ============================================================================

async function doImport() {
  log('Importing auto memory files into bridge...');

  const memPkg = await loadMemoryPackage();
  if (!memPkg || !memPkg.AutoMemoryBridge) {
    warnMemoryUnavailable();
    return;
  }

  const config = readConfig();
  ensureDataDir();
  const backend = trackBackend(new JsonFileBackend(STORE_PATH));
  await backend.initialize();

  const bridgeConfig = {
    workingDir: PROJECT_ROOT,
    syncMode: 'on-session-end',
  };
  const wtDir = worktreeMemoryDir();
  if (wtDir) bridgeConfig.memoryDir = wtDir;

  // Wire learning if enabled and available
  if (config.learningBridge.enabled && memPkg.LearningBridge) {
    bridgeConfig.learning = {
      sonaMode: config.learningBridge.sonaMode,
      confidenceDecayRate: config.learningBridge.confidenceDecayRate,
      accessBoostAmount: config.learningBridge.accessBoostAmount,
      consolidationThreshold: config.learningBridge.consolidationThreshold,
    };
  }

  // Wire graph if enabled and available
  if (config.memoryGraph.enabled && memPkg.MemoryGraph) {
    bridgeConfig.graph = {
      pageRankDamping: config.memoryGraph.pageRankDamping,
      maxNodes: config.memoryGraph.maxNodes,
      similarityThreshold: config.memoryGraph.similarityThreshold,
    };
  }

  const bridge = new memPkg.AutoMemoryBridge(backend, bridgeConfig);
  const fileErrors = [];
  if (typeof bridge.on === 'function') bridge.on('import:file-error', (info) => { fileErrors.push(info?.file || 'unknown'); });

  // Success is reported only after the import, the final persist and a fresh
  // readback of every entry this run wrote have all succeeded (#4685).
  const failures = [];
  let result = null;
  try {
    result = await bridge.importFromAutoMemory();
  } catch (err) {
    failures.push(`import: ${err.message}`);
  }
  try {
    await backend.shutdown();
    verifyStoreFile(STORE_PATH, backend.written, backend.deletedIds, sameRecord);
  } catch (err) {
    failures.push(`persist: ${err.message}`);
  }
  if (fileErrors.length) failures.push(`unreadable source file(s): ${fileErrors.join(', ')}`);
  if (failures.length) throw new HookFailure(`Import failed: ${failures.join('; ')}`);

  success(`Imported ${result.imported} entries (${result.skipped} skipped), verified in ${STORE_PATH}`);
  dim(`├─ Backend entries: ${await backend.count()}`);
  dim(`├─ Learning: ${config.learningBridge.enabled ? 'active' : 'disabled'}`);
  dim(`├─ Graph: ${config.memoryGraph.enabled ? 'active' : 'disabled'}`);
  dim(`└─ Agent scopes: ${config.agentScopes.enabled ? 'active' : 'disabled'}`);
}

// A store committed to the repository came from whoever wrote the repo. Its
// entries must never be promoted into the user's own Claude Code memory,
// which the model loads every session as the user's notes.
function storeIsRepoTracked() {
  if (!existsSync(STORE_PATH)) return false;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', STORE_PATH], { cwd: PROJECT_ROOT, stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function doSync() {
  log('Syncing insights to auto memory files...');
  if (storeIsRepoTracked()) {
    dim('Skipping sync: the memory store is committed to this repository, so its entries are not this machine\'s');
    return;
  }

  const memPkg = await loadMemoryPackage();
  if (!memPkg || !memPkg.AutoMemoryBridge) {
    warnMemoryUnavailable();
    return;
  }

  const config = readConfig();
  ensureDataDir();
  const backend = trackBackend(new JsonFileBackend(STORE_PATH));
  await backend.initialize();

  const entryCount = await backend.count();
  if (entryCount === 0) {
    dim('No entries to sync');
    await backend.shutdown();
    return;
  }

  const bridgeConfig = {
    workingDir: PROJECT_ROOT,
    syncMode: 'on-session-end',
  };
  const wtDir = worktreeMemoryDir();
  if (wtDir) bridgeConfig.memoryDir = wtDir;

  if (config.learningBridge.enabled && memPkg.LearningBridge) {
    bridgeConfig.learning = {
      sonaMode: config.learningBridge.sonaMode,
      confidenceDecayRate: config.learningBridge.confidenceDecayRate,
      consolidationThreshold: config.learningBridge.consolidationThreshold,
    };
  }

  if (config.memoryGraph.enabled && memPkg.MemoryGraph) {
    bridgeConfig.graph = {
      pageRankDamping: config.memoryGraph.pageRankDamping,
      maxNodes: config.memoryGraph.maxNodes,
    };
  }

  const bridge = new memPkg.AutoMemoryBridge(backend, bridgeConfig);

  let syncError = null;
  try {
    const syncResult = await bridge.syncToAutoMemory();
    success(`Synced ${syncResult.synced} entries to auto memory`);
    dim(`├─ Categories updated: ${syncResult.categories?.join(', ') || 'none'}`);
    dim(`└─ Backend entries: ${entryCount}`);

    // Curate MEMORY.md index with graph-aware ordering
    let indexSkipped = null;
    if (typeof bridge.on === 'function') bridge.on('index:skipped', (info) => { indexSkipped = info; });
    await bridge.curateIndex();
    if (indexSkipped) dim(`MEMORY.md index unchanged (${indexSkipped.reason || 'nothing to curate'})`);
    else success('Curated MEMORY.md index');
  } catch (err) {
    syncError = err;
  }

  if (bridge.destroy) bridge.destroy();
  await backend.shutdown();
  if (syncError) throw new HookFailure(`Sync failed: ${syncError.message}`);
}

async function doStatus() {
  const memPkg = await loadMemoryPackage();
  const config = readConfig();

  const sidecar = join(MODULE_ROOT, '.claude-flow', 'memory-package.json');
  const hasSidecar = existsSync(sidecar);

  console.log('\n=== Auto Memory Bridge Status ===\n');
  console.log(`  Package:        ${memPkg ? '✅ Available' : '❌ Not found — self-learning DISABLED (fix: npm i -D @claude-flow/memory)'}`);
  console.log(`  Resolver:       ${hasSidecar ? '✅ .claude-flow/memory-package.json' : '⏸ no sidecar (run: npx ruflo@latest doctor --fix)'}`);
  console.log(`  Store:          ${existsSync(STORE_PATH) ? '✅ ' + STORE_PATH : '⏸ Not initialized'}`);
  console.log(`  LearningBridge: ${config.learningBridge.enabled ? '✅ Enabled' : '⏸ Disabled'}`);
  console.log(`  MemoryGraph:    ${config.memoryGraph.enabled ? '✅ Enabled' : '⏸ Disabled'}`);
  console.log(`  AgentScopes:    ${config.agentScopes.enabled ? '✅ Enabled' : '⏸ Disabled'}`);

  try {
    const data = readStoreFile(STORE_PATH);
    if (data) console.log(`  Entries:        ${data.length}`);
  } catch (err) {
    console.log(`  Entries:        ❌ ${err.message}`);
  }

  console.log('');
}

// Read-only exact lookup (#4685). It never loads the memory package, creates a
// directory, takes the write lock or calls shutdown, so it cannot change the store.
const READ_SCHEMA_VERSION = 1;
async function doRead(namespace, key) {
  const out = { schemaVersion: READ_SCHEMA_VERSION, store: STORE_PATH, storePresent: false, namespace: namespace ?? null, key: key ?? null, found: false, entry: null };
  const refuse = (code, message) => {
    out.error = { code, message };
    console.log(JSON.stringify(out, null, 2));
    return 1;
  };
  if (typeof namespace !== 'string' || !namespace || typeof key !== 'string' || !key) {
    return refuse('USAGE', 'usage: auto-memory-hook.mjs read <namespace> <key>');
  }
  const backend = new JsonFileBackend(STORE_PATH);
  try {
    await backend.initialize();
  } catch (err) {
    out.storePresent = true; // initialize() only throws for a file that exists
    return refuse(err.code || 'STORE_READ_FAILED', err.message);
  }
  out.storePresent = backend.storePresent;
  const matches = await backend.query({ namespace, key });
  if (matches.length > 1) return refuse('AMBIGUOUS_KEY', `${matches.length} entries share namespace ${JSON.stringify(namespace)} and key ${JSON.stringify(key)}`);
  if (matches.length === 1) { out.found = true; out.entry = matches[0]; }
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

// ============================================================================
// Main
// ============================================================================

// Older settings.json files run `node -e "…import(file)" import`, where the
// subcommand lands in argv[1] and argv[2] is empty, so both hooks fell through
// to `status` and never imported or synced (#4058). Accept that shape too.
const COMMANDS = ['import', 'sync', 'status', 'read'];
const argvBase = process.argv[2] ? 2 : 1;
const command = process.argv[2] || (COMMANDS.includes(process.argv[1]) ? process.argv[1] : 'status');
const commandArgs = process.argv.slice(argvBase + 1);

// Dynamic import() failures can surface as unhandled rejections on a later
// microtask even when the awaiting call site already caught them, which would
// otherwise force a non-zero exit. Swallow to keep hooks exit-0, but surface the
// reason under RUFLO_DEBUG/DEBUG so genuine async bugs aren't silently hidden
// (FIX 2 — the previous `() => {}` discarded every rejection process-wide).
process.on('unhandledRejection', (reason) => {
  if (DEBUG) {
    const detail = reason && reason.message ? reason.message : String(reason);
    process.stderr.write(`[AutoMemory] unhandledRejection (suppressed): ${detail}\n`);
  }
});

// A failed import or sync exits 1, never 2: Claude Code treats exit 2 from a
// hook as "block", while exit 1 is a non-blocking error it shows to the user,
// so the session carries on and the failure is no longer hidden (#4685).
let exitCode = 0;
try {
  switch (command) {
    case 'import': await doImport(); break;
    case 'sync': await doSync(); break;
    case 'status': await doStatus(); break;
    case 'read': exitCode = await doRead(commandArgs[0], commandArgs[1]); break;
    default:
      console.log('Usage: auto-memory-hook.mjs <import|sync|status|read <namespace> <key>>');
      break;
  }
} catch (err) {
  exitCode = 1;
  const detail = err && err.message ? err.message : String(err);
  const line = err instanceof HookFailure ? `[AutoMemory] ${detail}` : `[AutoMemory] ${command} failed: ${detail}`;
  try { process.stderr.write(`${line}\n`); } catch (_) {}
}
// Force exit — process.exitCode alone isn't enough if async errors override it
process.exit(exitCode);
