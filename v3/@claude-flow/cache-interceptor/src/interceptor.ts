/**
 * Claude Code Cache Interceptor
 *
 * Cross-platform (Linux, macOS, Windows) interceptor that redirects
 * Claude Code's file I/O through an optimized SQLite-backed storage layer.
 *
 * Usage:
 *   NODE_OPTIONS="--require /path/to/interceptor.js" claude
 *
 * Or via wrapper:
 *   claude-optimized (sets NODE_OPTIONS and runs claude)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import initSqlJs, { Database } from 'sql.js';

// ============================================================================
// Cross-Platform Path Resolution
// ============================================================================

function getClaudeDir(): string {
  const platform = os.platform();
  const home = os.homedir();

  switch (platform) {
    case 'win32':
      // Windows: %APPDATA%\Claude or %USERPROFILE%\.claude
      return process.env.APPDATA
        ? path.join(process.env.APPDATA, 'Claude')
        : path.join(home, '.claude');
    case 'darwin':
      // macOS: ~/Library/Application Support/Claude or ~/.claude
      const macSupport = path.join(home, 'Library', 'Application Support', 'Claude');
      if (fs.existsSync(macSupport)) return macSupport;
      return path.join(home, '.claude');
    default:
      // Linux and others: ~/.claude
      return path.join(home, '.claude');
  }
}

function getInterceptorDbPath(): string {
  const platform = os.platform();
  const home = os.homedir();

  switch (platform) {
    case 'win32':
      return process.env.APPDATA
        ? path.join(process.env.APPDATA, 'claude-flow', 'cache-interceptor.db')
        : path.join(home, '.claude-flow', 'cache-interceptor.db');
    default:
      return path.join(home, '.claude-flow', 'cache-interceptor.db');
  }
}

// Configuration
const CLAUDE_DIR = getClaudeDir();
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const INTERCEPTOR_DB_PATH = getInterceptorDbPath();

// Cross-platform path pattern matching
function createInterceptPatterns(): RegExp[] {
  const sep = path.sep.replace(/\\/g, '\\\\'); // Escape backslash for regex
  return [
    new RegExp(`\\.claude${sep}projects${sep}.*\\.jsonl$`),
    new RegExp(`\\.claude${sep}history\\.jsonl$`),
    // Also match forward slashes (normalized paths)
    /\.claude\/projects\/.*\.jsonl$/,
    /\.claude\/history\.jsonl$/,
  ];
}

const INTERCEPT_PATTERNS = createInterceptPatterns();

// ============================================================================
// State Management
// ============================================================================

let db: Database | null = null;
let initialized = false;
let sqlJsPromise: Promise<void> | null = null;

// Process identification for multi-session isolation
const PROCESS_ID = process.pid;
const PROCESS_START_TIME = Date.now();
const HEARTBEAT_INTERVAL_MS = 5000;
const SESSION_TIMEOUT_MS = 30000; // Consider session stale after 30s without heartbeat

// Track active session for THIS process
let currentSessionId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// Original fs functions (before patching)
const originalFs = {
  readFileSync: fs.readFileSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
  appendFileSync: fs.appendFileSync.bind(fs),
  existsSync: fs.existsSync.bind(fs),
  statSync: fs.statSync.bind(fs),
  readdirSync: fs.readdirSync.bind(fs),
  mkdirSync: fs.mkdirSync.bind(fs),
  unlinkSync: fs.unlinkSync.bind(fs),
  renameSync: fs.renameSync.bind(fs),
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize path for cross-platform comparison
 */
function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
}

/**
 * Check if a path should be intercepted
 */
function shouldIntercept(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return INTERCEPT_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Parse session ID from file path (cross-platform)
 */
function parseSessionId(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/([a-f0-9-]{36})\.jsonl$/);
  return match ? match[1] : null;
}

/**
 * Ensure directory exists (cross-platform)
 */
function ensureDir(dirPath: string): void {
  try {
    if (!originalFs.existsSync(dirPath)) {
      originalFs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (error) {
    // Ignore errors (directory might already exist due to race)
  }
}

/**
 * Safe JSON parse
 */
function safeJsonParse(str: string): any | null {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// ============================================================================
// Database Management
// ============================================================================

/**
 * Get sql.js WASM locator based on platform
 */
function getSqlJsConfig(): any {
  // sql.js needs to locate its WASM file
  // Try multiple locations for cross-platform compatibility
  const possiblePaths = [
    // npm package location
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    // Project node_modules
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    // Global node_modules
    path.join(os.homedir(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];

  for (const wasmPath of possiblePaths) {
    if (originalFs.existsSync(wasmPath)) {
      return { locateFile: () => wasmPath };
    }
  }

  // Let sql.js try to find it itself
  return {};
}

/**
 * Initialize the SQLite database
 */
async function initDatabase(): Promise<void> {
  if (initialized) return;
  if (sqlJsPromise) {
    await sqlJsPromise;
    return;
  }

  sqlJsPromise = (async () => {
    try {
      const SQL = await initSqlJs(getSqlJsConfig());

      // Try to load existing database
      try {
        if (originalFs.existsSync(INTERCEPTOR_DB_PATH)) {
          const existingData = originalFs.readFileSync(INTERCEPTOR_DB_PATH);
          db = new SQL.Database(existingData);
        } else {
          db = new SQL.Database();
        }
      } catch {
        db = new SQL.Database();
      }

      // Create schema
      db.run(`
        -- Messages table (mirrors JSONL content)
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          line_number INTEGER NOT NULL,
          type TEXT,
          content TEXT NOT NULL,
          timestamp TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(session_id, line_number)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

        -- Summaries (compacted conversations)
        CREATE TABLE IF NOT EXISTS summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          original_size INTEGER,
          compressed_size INTEGER,
          patterns_json TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);

        -- Learned patterns
        CREATE TABLE IF NOT EXISTS patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pattern_type TEXT NOT NULL,
          pattern_key TEXT NOT NULL,
          pattern_value TEXT NOT NULL,
          confidence REAL DEFAULT 0.5,
          usage_count INTEGER DEFAULT 1,
          last_used TEXT DEFAULT (datetime('now')),
          UNIQUE(pattern_type, pattern_key)
        );

        CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
        CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC);

        -- Session metadata
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          project_path TEXT,
          first_message TEXT,
          message_count INTEGER DEFAULT 0,
          total_size INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          last_accessed TEXT DEFAULT (datetime('now'))
        );

        -- Optimized context cache
        CREATE TABLE IF NOT EXISTS context_cache (
          cache_key TEXT PRIMARY KEY,
          context TEXT NOT NULL,
          token_estimate INTEGER,
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT
        );
      `);

      initialized = true;
      logInfo('Database initialized at ' + INTERCEPTOR_DB_PATH);

    } catch (error) {
      logError('Failed to initialize database: ' + error);
      // Continue without interception if DB fails
    }
  })();

  await sqlJsPromise;
}

// ============================================================================
// Logging (Cross-platform, non-blocking)
// ============================================================================

const LOG_ENABLED = process.env.CACHE_INTERCEPTOR_DEBUG === 'true';

function logInfo(message: string): void {
  if (LOG_ENABLED) {
    process.stderr.write(`[CacheInterceptor] ${message}\n`);
  }
}

function logError(message: string): void {
  process.stderr.write(`[CacheInterceptor ERROR] ${message}\n`);
}

// ============================================================================
// File System Interception
// ============================================================================

/**
 * Intercepted readFileSync
 */
function interceptedReadFileSync(
  filePath: fs.PathOrFileDescriptor,
  options?: { encoding?: BufferEncoding; flag?: string } | BufferEncoding
): string | Buffer {
  const pathStr = filePath.toString();

  // Quick path: don't intercept if not a Claude file
  if (!shouldIntercept(pathStr)) {
    return originalFs.readFileSync(filePath, options as any);
  }

  const sessionId = parseSessionId(pathStr);
  if (!sessionId || !db || !initialized) {
    return originalFs.readFileSync(filePath, options as any);
  }

  try {
    // Read from SQLite
    const stmt = db.prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY line_number');
    stmt.bind([sessionId]);

    const lines: string[] = [];
    while (stmt.step()) {
      lines.push(stmt.get()[0] as string);
    }
    stmt.free();

    if (lines.length === 0) {
      // Fall back to original file if DB is empty
      return originalFs.readFileSync(filePath, options as any);
    }

    const content = lines.join('\n') + '\n';
    logInfo(`Read ${lines.length} messages for session ${sessionId.slice(0, 8)}...`);

    // Return in requested format
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding === 'utf8' || encoding === 'utf-8') {
      return content;
    }
    return Buffer.from(content, 'utf8');

  } catch (error) {
    logError(`Read error: ${error}`);
    return originalFs.readFileSync(filePath, options as any);
  }
}

/**
 * Intercepted appendFileSync (main write path for Claude Code)
 */
function interceptedAppendFileSync(
  filePath: fs.PathOrFileDescriptor,
  data: string | Uint8Array,
  options?: fs.WriteFileOptions
): void {
  const pathStr = filePath.toString();

  // Always write to original file first (for compatibility)
  originalFs.appendFileSync(filePath, data, options);

  // Quick path: don't intercept if not a Claude file
  if (!shouldIntercept(pathStr) || !db || !initialized) {
    return;
  }

  const sessionId = parseSessionId(pathStr);
  if (!sessionId) return;

  try {
    const content = data.toString();
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) return;

    // Get current max line number
    const result = db.exec(
      'SELECT COALESCE(MAX(line_number), 0) FROM messages WHERE session_id = ?',
      [sessionId]
    );
    let lineNumber = (result[0]?.values[0]?.[0] as number) || 0;

    // Batch insert for performance
    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO messages (session_id, line_number, type, content, timestamp) VALUES (?, ?, ?, ?, ?)'
    );

    for (const line of lines) {
      lineNumber++;

      // Parse message
      const parsed = safeJsonParse(line);
      const type = parsed?.type || 'unknown';
      const timestamp = parsed?.timestamp || null;

      insertStmt.run([sessionId, lineNumber, type, line, timestamp]);

      // Extract summaries for pattern learning
      if (type === 'summary' && parsed?.summary) {
        db.run(
          'INSERT INTO summaries (session_id, summary, original_size) VALUES (?, ?, ?)',
          [sessionId, parsed.summary, line.length]
        );
      }
    }

    insertStmt.free();

    // Update session metadata
    db.run(`
      INSERT INTO sessions (session_id, message_count, last_accessed)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        message_count = message_count + ?,
        last_accessed = datetime('now')
    `, [sessionId, lines.length, lines.length]);

    logInfo(`Stored ${lines.length} messages for session ${sessionId.slice(0, 8)}...`);

    // Schedule database persistence
    schedulePersist();

  } catch (error) {
    logError(`Write error: ${error}`);
  }
}

// ============================================================================
// Database Persistence
// ============================================================================

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DELAY_MS = 2000; // Batch writes for efficiency

function schedulePersist(): void {
  if (persistTimer) return;

  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistDatabase();
  }, PERSIST_DELAY_MS);
}

function persistDatabase(): void {
  if (!db) return;

  try {
    const data = db.export();
    const dir = path.dirname(INTERCEPTOR_DB_PATH);
    ensureDir(dir);

    // Atomic write (write to temp, then rename)
    const tempPath = INTERCEPTOR_DB_PATH + '.tmp';
    originalFs.writeFileSync(tempPath, Buffer.from(data));
    fs.renameSync(tempPath, INTERCEPTOR_DB_PATH);

    logInfo('Database persisted');
  } catch (error) {
    logError(`Persist error: ${error}`);
  }
}

// ============================================================================
// Query API (for external tools)
// ============================================================================

export const CacheQuery = {
  /**
   * Get all messages for a session
   */
  getSession(sessionId: string): any[] {
    if (!db) return [];
    try {
      const stmt = db.prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY line_number');
      stmt.bind([sessionId]);
      const results: any[] = [];
      while (stmt.step()) {
        const parsed = safeJsonParse(stmt.get()[0] as string);
        if (parsed) results.push(parsed);
      }
      stmt.free();
      return results;
    } catch {
      return [];
    }
  },

  /**
   * Get messages by type
   */
  getMessagesByType(sessionId: string, type: string): any[] {
    if (!db) return [];
    try {
      const stmt = db.prepare(
        'SELECT content FROM messages WHERE session_id = ? AND type = ? ORDER BY line_number'
      );
      stmt.bind([sessionId, type]);
      const results: any[] = [];
      while (stmt.step()) {
        const parsed = safeJsonParse(stmt.get()[0] as string);
        if (parsed) results.push(parsed);
      }
      stmt.free();
      return results;
    } catch {
      return [];
    }
  },

  /**
   * Get all summaries
   */
  getAllSummaries(): Array<{ session_id: string; summary: string; created_at: string }> {
    if (!db) return [];
    try {
      const result = db.exec('SELECT session_id, summary, created_at FROM summaries ORDER BY created_at DESC');
      return (result[0]?.values || []).map(row => ({
        session_id: row[0] as string,
        summary: row[1] as string,
        created_at: row[2] as string,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Store a learned pattern
   */
  storePattern(type: string, key: string, value: string, confidence = 0.5): void {
    if (!db) return;
    try {
      db.run(`
        INSERT INTO patterns (pattern_type, pattern_key, pattern_value, confidence)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(pattern_type, pattern_key) DO UPDATE SET
          pattern_value = excluded.pattern_value,
          confidence = MAX(confidence, excluded.confidence),
          usage_count = usage_count + 1,
          last_used = datetime('now')
      `, [type, key, value, confidence]);
      schedulePersist();
    } catch {}
  },

  /**
   * Get learned patterns
   */
  getPatterns(type?: string, minConfidence = 0.5): Array<{ type: string; key: string; value: string; confidence: number }> {
    if (!db) return [];
    try {
      const query = type
        ? 'SELECT pattern_type, pattern_key, pattern_value, confidence FROM patterns WHERE pattern_type = ? AND confidence >= ? ORDER BY confidence DESC'
        : 'SELECT pattern_type, pattern_key, pattern_value, confidence FROM patterns WHERE confidence >= ? ORDER BY confidence DESC';
      const result = db.exec(query, type ? [type, minConfidence] : [minConfidence]);
      return (result[0]?.values || []).map(row => ({
        type: row[0] as string,
        key: row[1] as string,
        value: row[2] as string,
        confidence: row[3] as number,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Get optimized context for injection
   */
  getOptimizedContext(maxChars = 16000): string {
    if (!db) return '';

    try {
      // Get high-confidence patterns
      const patterns = this.getPatterns(undefined, 0.7).slice(0, 20);

      // Get recent summaries
      const summaries = this.getAllSummaries().slice(0, 5);

      let context = '## Learned Patterns\n';
      for (const p of patterns) {
        context += `- [${p.type}] ${p.key}: ${p.value}\n`;
      }

      context += '\n## Recent Context Summaries\n';
      for (const s of summaries) {
        context += `${s.summary}\n---\n`;
      }

      return context.slice(0, maxChars);
    } catch {
      return '';
    }
  },

  /**
   * Get database stats
   */
  getStats(): { messages: number; summaries: number; patterns: number; sessions: number } {
    if (!db) return { messages: 0, summaries: 0, patterns: 0, sessions: 0 };
    try {
      const messages = db.exec('SELECT COUNT(*) FROM messages')[0]?.values[0]?.[0] as number || 0;
      const summaries = db.exec('SELECT COUNT(*) FROM summaries')[0]?.values[0]?.[0] as number || 0;
      const patterns = db.exec('SELECT COUNT(*) FROM patterns')[0]?.values[0]?.[0] as number || 0;
      const sessions = db.exec('SELECT COUNT(DISTINCT session_id) FROM messages')[0]?.values[0]?.[0] as number || 0;
      return { messages, summaries, patterns, sessions };
    } catch {
      return { messages: 0, summaries: 0, patterns: 0, sessions: 0 };
    }
  },
};

// ============================================================================
// Installation
// ============================================================================

/**
 * Install the interceptor (patches fs module)
 */
export async function install(): Promise<void> {
  await initDatabase();

  if (!initialized || !db) {
    logError('Database not initialized, skipping interception');
    return;
  }

  // Patch fs module
  (fs as any).readFileSync = interceptedReadFileSync;
  (fs as any).appendFileSync = interceptedAppendFileSync;

  // Handle process exit
  process.on('exit', () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistDatabase();
    }
  });

  process.on('SIGINT', () => {
    persistDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    persistDatabase();
    process.exit(0);
  });

  logInfo('✓ Installed - intercepting Claude Code cache operations');
  logInfo(`  Platform: ${os.platform()}`);
  logInfo(`  Claude dir: ${CLAUDE_DIR}`);
  logInfo(`  DB path: ${INTERCEPTOR_DB_PATH}`);
}

/**
 * Auto-install if loaded via --require
 */
if (require.main !== module) {
  install().catch(err => {
    logError(`Install failed: ${err}`);
  });
}

// Export for direct usage
export { initDatabase, persistDatabase, INTERCEPTOR_DB_PATH, CLAUDE_DIR };
