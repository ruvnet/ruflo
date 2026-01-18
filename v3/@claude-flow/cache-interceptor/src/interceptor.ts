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

/**
 * Extract project name from file path
 */
function extractProjectName(filePath: string): string {
  const normalized = normalizePath(filePath);
  // Pattern: .claude/projects/PROJECT_NAME/session.jsonl
  const match = normalized.match(/\.claude\/projects\/([^/]+)\//);
  return match ? match[1] : 'unknown';
}

// ============================================================================
// Multi-Session Management
// ============================================================================

/**
 * Clean up stale sessions (no heartbeat within SESSION_TIMEOUT_MS)
 */
function cleanupStaleSessions(): void {
  if (!db) return;
  try {
    const timeoutSeconds = SESSION_TIMEOUT_MS / 1000;
    db.run(`
      UPDATE active_sessions
      SET is_active = 0
      WHERE datetime(last_heartbeat, '+' || ? || ' seconds') < datetime('now')
    `, [timeoutSeconds]);

    // Also clean up process locks
    db.run(`
      DELETE FROM process_locks
      WHERE datetime(expires_at) < datetime('now')
    `);

    logInfo('Cleaned up stale sessions');
  } catch (error) {
    logError(`Cleanup error: ${error}`);
  }
}

/**
 * Register this process as owner of a session
 */
function registerSession(sessionId: string, filePath: string): void {
  if (!db) return;
  try {
    const hostname = os.hostname();
    const projectName = extractProjectName(filePath);

    db.run(`
      INSERT INTO active_sessions (session_id, pid, hostname, file_path, project_name, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        pid = excluded.pid,
        hostname = excluded.hostname,
        file_path = excluded.file_path,
        last_heartbeat = datetime('now'),
        is_active = 1
    `, [sessionId, PROCESS_ID, hostname, filePath, projectName]);

    currentSessionId = sessionId;
    startHeartbeat();

    logInfo(`Registered session ${sessionId.slice(0, 8)}... (PID: ${PROCESS_ID})`);
  } catch (error) {
    logError(`Register session error: ${error}`);
  }
}

/**
 * Update heartbeat for current session
 */
function updateHeartbeat(): void {
  if (!db || !currentSessionId) return;
  try {
    db.run(`
      UPDATE active_sessions
      SET last_heartbeat = datetime('now'), is_active = 1
      WHERE session_id = ? AND pid = ?
    `, [currentSessionId, PROCESS_ID]);

    // Persist on each heartbeat
    schedulePersist();
  } catch (error) {
    // Silently ignore heartbeat errors
  }
}

/**
 * Start heartbeat timer
 */
function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(updateHeartbeat, HEARTBEAT_INTERVAL_MS);
  // Don't prevent process exit
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

/**
 * Stop heartbeat timer
 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Discover all active sessions across the filesystem
 */
function discoverAllSessions(): Array<{
  sessionId: string;
  pid: number;
  projectName: string;
  filePath: string;
  isActive: boolean;
  lastHeartbeat: string;
}> {
  if (!db) return [];
  try {
    const result = db.exec(`
      SELECT session_id, pid, project_name, file_path, is_active, last_heartbeat
      FROM active_sessions
      ORDER BY last_heartbeat DESC
    `);

    return (result[0]?.values || []).map(row => ({
      sessionId: row[0] as string,
      pid: row[1] as number,
      projectName: row[2] as string,
      filePath: row[3] as string,
      isActive: (row[4] as number) === 1,
      lastHeartbeat: row[5] as string,
    }));
  } catch {
    return [];
  }
}

/**
 * Discover sessions from filesystem (scan Claude projects directory)
 */
function discoverSessionsFromFilesystem(): Array<{
  sessionId: string;
  filePath: string;
  projectName: string;
  size: number;
  mtime: Date;
}> {
  const sessions: Array<{
    sessionId: string;
    filePath: string;
    projectName: string;
    size: number;
    mtime: Date;
  }> = [];

  try {
    if (!originalFs.existsSync(CLAUDE_PROJECTS_DIR)) {
      return sessions;
    }

    // Scan all project directories
    const projects = originalFs.readdirSync(CLAUDE_PROJECTS_DIR);

    for (const project of projects) {
      const projectPath = path.join(CLAUDE_PROJECTS_DIR, project);

      try {
        const stat = originalFs.statSync(projectPath);
        if (!stat.isDirectory()) continue;

        // Find all JSONL files in project directory
        const files = originalFs.readdirSync(projectPath);

        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;

          const sessionId = parseSessionId(file);
          if (!sessionId) continue;

          const filePath = path.join(projectPath, file);
          const fileStat = originalFs.statSync(filePath);

          sessions.push({
            sessionId,
            filePath,
            projectName: project,
            size: fileStat.size,
            mtime: fileStat.mtime,
          });
        }
      } catch {
        // Skip inaccessible directories
      }
    }
  } catch (error) {
    logError(`Filesystem scan error: ${error}`);
  }

  return sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Check if a session belongs to this process
 */
function isOwnSession(sessionId: string): boolean {
  if (!db) return true; // If no DB, allow all
  try {
    const result = db.exec(
      'SELECT pid FROM active_sessions WHERE session_id = ? AND is_active = 1',
      [sessionId]
    );
    if (!result[0]?.values?.length) return true; // No owner, allow
    const ownerPid = result[0].values[0][0] as number;
    return ownerPid === PROCESS_ID;
  } catch {
    return true;
  }
}

/**
 * Acquire a lock for database operations
 */
function acquireLock(lockKey: string, timeoutMs = 5000): boolean {
  if (!db) return true;
  try {
    const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

    // Try to acquire lock
    db.run(`
      INSERT INTO process_locks (lock_key, pid, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(lock_key) DO UPDATE SET
        pid = CASE
          WHEN datetime(expires_at) < datetime('now') THEN excluded.pid
          WHEN pid = excluded.pid THEN excluded.pid
          ELSE pid
        END,
        expires_at = CASE
          WHEN datetime(expires_at) < datetime('now') THEN excluded.expires_at
          WHEN pid = excluded.pid THEN excluded.expires_at
          ELSE expires_at
        END
    `, [lockKey, PROCESS_ID, expiresAt]);

    // Check if we got the lock
    const result = db.exec(
      'SELECT pid FROM process_locks WHERE lock_key = ?',
      [lockKey]
    );
    return (result[0]?.values[0]?.[0] as number) === PROCESS_ID;
  } catch {
    return true; // Allow on error
  }
}

/**
 * Release a lock
 */
function releaseLock(lockKey: string): void {
  if (!db) return;
  try {
    db.run(
      'DELETE FROM process_locks WHERE lock_key = ? AND pid = ?',
      [lockKey, PROCESS_ID]
    );
  } catch {
    // Ignore errors
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

      // Enable WAL mode for better concurrent access (critical for multi-session)
      db.run('PRAGMA journal_mode = WAL');
      db.run('PRAGMA synchronous = NORMAL');
      db.run('PRAGMA busy_timeout = 5000'); // 5s timeout for locked database

      // Create schema
      db.run(`
        -- Active sessions registry (for multi-process coordination)
        CREATE TABLE IF NOT EXISTS active_sessions (
          session_id TEXT PRIMARY KEY,
          pid INTEGER NOT NULL,
          hostname TEXT,
          started_at TEXT DEFAULT (datetime('now')),
          last_heartbeat TEXT DEFAULT (datetime('now')),
          file_path TEXT,
          project_name TEXT,
          is_active INTEGER DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_active_sessions_pid ON active_sessions(pid);
        CREATE INDEX IF NOT EXISTS idx_active_sessions_heartbeat ON active_sessions(last_heartbeat);

        -- Messages table (mirrors JSONL content)
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          line_number INTEGER NOT NULL,
          type TEXT,
          content TEXT NOT NULL,
          timestamp TEXT,
          pid INTEGER,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(session_id, line_number)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_pid ON messages(pid);

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

        -- Process lock table (for file locking simulation)
        CREATE TABLE IF NOT EXISTS process_locks (
          lock_key TEXT PRIMARY KEY,
          pid INTEGER NOT NULL,
          acquired_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT
        );
      `);

      // Clean up stale sessions on startup
      cleanupStaleSessions();

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

// ============================================================================
// Cache Optimization Settings
// ============================================================================

const OPTIMIZATION_ENABLED = process.env.CACHE_OPTIMIZE !== 'false';
const TARGET_SIZE_BYTES = parseInt(process.env.CACHE_TARGET_SIZE || '500000', 10); // 500KB target
const KEEP_RECENT_MESSAGES = parseInt(process.env.CACHE_KEEP_RECENT || '50', 10);

/**
 * Optimize messages to reduce size while preserving important context
 */
function optimizeMessages(messages: Array<{ line: string; parsed: any }>): string[] {
  if (!OPTIMIZATION_ENABLED) {
    return messages.map(m => m.line);
  }

  const totalSize = messages.reduce((sum, m) => sum + m.line.length, 0);

  // If under target, no optimization needed
  if (totalSize < TARGET_SIZE_BYTES) {
    logInfo(`Size ${(totalSize/1024).toFixed(1)}KB under target, no optimization`);
    return messages.map(m => m.line);
  }

  logInfo(`Optimizing: ${(totalSize/1024).toFixed(1)}KB -> target ${(TARGET_SIZE_BYTES/1024).toFixed(1)}KB`);

  const optimized: string[] = [];
  const kept = {
    summaries: 0,
    user: 0,
    assistant: 0,
    system: 0,
    progress: 0,
    other: 0,
    removed: 0,
  };

  // Priority-based selection
  // 1. ALL summaries (most valuable - compressed context)
  // 2. ALL system messages (session metadata)
  // 3. Recent user/assistant messages
  // 4. Skip most progress messages (verbose, low value)

  const summaries: string[] = [];
  const systemMsgs: string[] = [];
  const userAssistant: Array<{ line: string; idx: number }> = [];
  const progressMsgs: string[] = [];
  const otherMsgs: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const { line, parsed } = messages[i];
    const type = parsed?.type || 'unknown';

    switch (type) {
      case 'summary':
        summaries.push(line);
        break;
      case 'system':
        systemMsgs.push(line);
        break;
      case 'user':
      case 'assistant':
        userAssistant.push({ line, idx: i });
        break;
      case 'progress':
        progressMsgs.push(line);
        break;
      default:
        otherMsgs.push(line);
    }
  }

  // Always keep all summaries
  for (const line of summaries) {
    optimized.push(line);
    kept.summaries++;
  }

  // Always keep system messages
  for (const line of systemMsgs) {
    optimized.push(line);
    kept.system++;
  }

  // Keep recent user/assistant messages (conversation flow)
  const recentUA = userAssistant.slice(-KEEP_RECENT_MESSAGES * 2);
  for (const { line } of recentUA) {
    optimized.push(line);
    if (line.includes('"type":"user"')) kept.user++;
    else kept.assistant++;
  }

  // Calculate remaining budget
  let currentSize = optimized.reduce((sum, l) => sum + l.length, 0);
  const remainingBudget = TARGET_SIZE_BYTES - currentSize;

  // Add progress messages if we have budget (keep only completion ones)
  if (remainingBudget > 10000) {
    const completedProgress = progressMsgs.filter(p =>
      p.includes('"status":"completed"') || p.includes('"status":"success"')
    ).slice(-20);

    for (const line of completedProgress) {
      if (currentSize + line.length < TARGET_SIZE_BYTES) {
        optimized.push(line);
        currentSize += line.length;
        kept.progress++;
      }
    }
  }

  kept.removed = messages.length - optimized.length;

  const newSize = optimized.reduce((sum, l) => sum + l.length, 0);
  const reduction = ((totalSize - newSize) / totalSize * 100).toFixed(1);

  logInfo(`Optimized: ${messages.length} -> ${optimized.length} messages (${reduction}% reduction)`);
  logInfo(`  Kept: ${kept.summaries} summaries, ${kept.user} user, ${kept.assistant} assistant, ${kept.system} system, ${kept.progress} progress`);
  logInfo(`  Removed: ${kept.removed} low-priority messages`);

  return optimized;
}

/**
 * Intercepted readFileSync - returns OPTIMIZED content to reduce Claude's context
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
  if (!sessionId) {
    return originalFs.readFileSync(filePath, options as any);
  }

  try {
    // Read original file
    const originalContent = originalFs.readFileSync(filePath, 'utf8') as string;
    const originalLines = originalContent.split('\n').filter(l => l.trim());

    if (originalLines.length === 0) {
      return originalContent;
    }

    // Parse all messages
    const messages = originalLines.map(line => ({
      line,
      parsed: safeJsonParse(line),
    }));

    // Optimize to reduce size
    const optimizedLines = optimizeMessages(messages);

    const content = optimizedLines.join('\n') + '\n';

    logInfo(`Serving optimized cache: ${originalLines.length} -> ${optimizedLines.length} messages`);

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

  // Auto-register session on first write (multi-session support)
  if (currentSessionId !== sessionId) {
    registerSession(sessionId, pathStr);
  }

  // Acquire lock for concurrent write safety
  const lockKey = `write:${sessionId}`;
  if (!acquireLock(lockKey)) {
    logInfo(`Waiting for lock on session ${sessionId.slice(0, 8)}...`);
    // Retry after brief delay
    setTimeout(() => {
      interceptedAppendFileSync(filePath, data, options);
    }, 100);
    return;
  }

  try {
    const content = data.toString();
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      releaseLock(lockKey);
      return;
    }

    // Get current max line number
    const result = db.exec(
      'SELECT COALESCE(MAX(line_number), 0) FROM messages WHERE session_id = ?',
      [sessionId]
    );
    let lineNumber = (result[0]?.values[0]?.[0] as number) || 0;

    // Batch insert for performance (now includes PID for tracking)
    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO messages (session_id, line_number, type, content, timestamp, pid) VALUES (?, ?, ?, ?, ?, ?)'
    );

    for (const line of lines) {
      lineNumber++;

      // Parse message
      const parsed = safeJsonParse(line);
      const type = parsed?.type || 'unknown';
      const timestamp = parsed?.timestamp || null;

      insertStmt.run([sessionId, lineNumber, type, line, timestamp, PROCESS_ID]);

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
      INSERT INTO sessions (session_id, project_path, message_count, last_accessed)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        message_count = message_count + ?,
        last_accessed = datetime('now')
    `, [sessionId, extractProjectName(pathStr), lines.length, lines.length]);

    logInfo(`Stored ${lines.length} messages for session ${sessionId.slice(0, 8)}... (PID: ${PROCESS_ID})`);

    // Schedule database persistence
    schedulePersist();

  } catch (error) {
    logError(`Write error: ${error}`);
  } finally {
    releaseLock(lockKey);
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

  // =========================================================================
  // Multi-Session Management API
  // =========================================================================

  /**
   * Get all active sessions (from registry)
   */
  getActiveSessions(): Array<{
    sessionId: string;
    pid: number;
    projectName: string;
    isActive: boolean;
    lastHeartbeat: string;
  }> {
    return discoverAllSessions();
  },

  /**
   * Discover all sessions from filesystem
   */
  discoverSessions(): Array<{
    sessionId: string;
    filePath: string;
    projectName: string;
    size: number;
    mtime: Date;
  }> {
    return discoverSessionsFromFilesystem();
  },

  /**
   * Get session owned by a specific PID
   */
  getSessionByPid(pid: number): {
    sessionId: string;
    projectName: string;
    filePath: string;
  } | null {
    if (!db) return null;
    try {
      const result = db.exec(
        'SELECT session_id, project_name, file_path FROM active_sessions WHERE pid = ? AND is_active = 1',
        [pid]
      );
      if (!result[0]?.values?.length) return null;
      const row = result[0].values[0];
      return {
        sessionId: row[0] as string,
        projectName: row[1] as string,
        filePath: row[2] as string,
      };
    } catch {
      return null;
    }
  },

  /**
   * Get current process session
   */
  getCurrentSession(): {
    sessionId: string | null;
    pid: number;
    startTime: number;
  } {
    return {
      sessionId: currentSessionId,
      pid: PROCESS_ID,
      startTime: PROCESS_START_TIME,
    };
  },

  /**
   * Get messages for current process session only
   */
  getOwnMessages(): any[] {
    if (!currentSessionId) return [];
    return this.getSession(currentSessionId);
  },

  /**
   * Check if session is owned by this process
   */
  isOwnSession(sessionId: string): boolean {
    return isOwnSession(sessionId);
  },

  /**
   * Get multi-process stats
   */
  getMultiProcessStats(): {
    currentPid: number;
    currentSession: string | null;
    activeSessions: number;
    totalSessions: number;
    staleSessionCount: number;
  } {
    if (!db) {
      return {
        currentPid: PROCESS_ID,
        currentSession: currentSessionId,
        activeSessions: 0,
        totalSessions: 0,
        staleSessionCount: 0,
      };
    }
    try {
      const active = db.exec('SELECT COUNT(*) FROM active_sessions WHERE is_active = 1')[0]?.values[0]?.[0] as number || 0;
      const total = db.exec('SELECT COUNT(*) FROM active_sessions')[0]?.values[0]?.[0] as number || 0;
      const stale = db.exec('SELECT COUNT(*) FROM active_sessions WHERE is_active = 0')[0]?.values[0]?.[0] as number || 0;

      return {
        currentPid: PROCESS_ID,
        currentSession: currentSessionId,
        activeSessions: active,
        totalSessions: total,
        staleSessionCount: stale,
      };
    } catch {
      return {
        currentPid: PROCESS_ID,
        currentSession: currentSessionId,
        activeSessions: 0,
        totalSessions: 0,
        staleSessionCount: 0,
      };
    }
  },

  /**
   * Force cleanup of stale sessions
   */
  cleanupStaleSessions(): void {
    cleanupStaleSessions();
  },

  /**
   * Sync session data from filesystem to database (for recovery)
   */
  syncFromFilesystem(sessionId: string): { synced: number; errors: number } {
    if (!db) return { synced: 0, errors: 1 };

    const sessions = discoverSessionsFromFilesystem();
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) return { synced: 0, errors: 1 };

    try {
      const content = originalFs.readFileSync(session.filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      let synced = 0;
      const insertStmt = db.prepare(
        'INSERT OR IGNORE INTO messages (session_id, line_number, type, content, timestamp, pid) VALUES (?, ?, ?, ?, ?, ?)'
      );

      for (let i = 0; i < lines.length; i++) {
        const parsed = safeJsonParse(lines[i]);
        insertStmt.run([
          sessionId,
          i + 1,
          parsed?.type || 'unknown',
          lines[i],
          parsed?.timestamp || null,
          null, // Unknown PID for historical data
        ]);
        synced++;
      }

      insertStmt.free();
      schedulePersist();

      return { synced, errors: 0 };
    } catch (error) {
      logError(`Sync error: ${error}`);
      return { synced: 0, errors: 1 };
    }
  },
};

// ============================================================================
// Installation
// ============================================================================

/**
 * Cleanup function for process exit
 */
function cleanup(): void {
  // Stop heartbeat
  stopHeartbeat();

  // Mark session as inactive
  if (db && currentSessionId) {
    try {
      db.run(
        'UPDATE active_sessions SET is_active = 0 WHERE session_id = ? AND pid = ?',
        [currentSessionId, PROCESS_ID]
      );
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Persist database
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistDatabase();
}

/**
 * Install the interceptor (patches fs module)
 * Uses Module._load hook for compatibility with modern Node.js
 */
export async function install(): Promise<void> {
  await initDatabase();

  if (!initialized || !db) {
    logError('Database not initialized, skipping interception');
    return;
  }

  // Modern Node.js protects fs properties, so we use Module hook instead
  try {
    const Module = require('module');
    const originalLoad = Module._load;

    Module._load = function(request: string, parent: any, isMain: boolean) {
      const result = originalLoad.call(this, request, parent, isMain);

      // Intercept fs module
      if (request === 'fs' || request === 'node:fs') {
        // Return a proxy that wraps fs functions
        return new Proxy(result, {
          get(target, prop) {
            if (prop === 'readFileSync') {
              return interceptedReadFileSync;
            }
            if (prop === 'appendFileSync') {
              return interceptedAppendFileSync;
            }
            return target[prop];
          }
        });
      }
      return result;
    };

    logInfo('Installed via Module._load hook');

    // Also patch Module.prototype.require for already-loaded cases
    // This ensures fs is intercepted even when required after our hook
    const originalRequire = Module.prototype.require;

    // Create wrapped fs by copying all properties
    const cachedFs = require('fs');
    const wrappedFs: any = {};

    // Copy all properties from fs
    for (const key of Object.keys(cachedFs)) {
      wrappedFs[key] = cachedFs[key];
    }
    Object.assign(wrappedFs, cachedFs);

    // Override with our intercepted versions
    wrappedFs.readFileSync = interceptedReadFileSync;
    wrappedFs.appendFileSync = interceptedAppendFileSync;

    Module.prototype.require = function(id: string) {
      if (id === 'fs' || id === 'node:fs') {
        return wrappedFs;
      }
      return originalRequire.apply(this, arguments as any);
    };

    logInfo('Installed Module.prototype.require patch')

  } catch (err) {
    // Fallback: try direct assignment (older Node.js)
    try {
      Object.defineProperty(fs, 'readFileSync', {
        value: interceptedReadFileSync,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(fs, 'appendFileSync', {
        value: interceptedAppendFileSync,
        writable: true,
        configurable: true,
      });
      logInfo('Installed via defineProperty');
    } catch (e) {
      logError(`Could not patch fs: ${e}`);
    }
  }

  // Handle process exit - cleanup sessions and persist
  process.on('exit', cleanup);

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  // Also handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logError(`Uncaught exception: ${error}`);
    cleanup();
    process.exit(1);
  });

  logInfo('✓ Installed - intercepting Claude Code cache operations');
  logInfo(`  Platform: ${os.platform()}`);
  logInfo(`  Claude dir: ${CLAUDE_DIR}`);
  logInfo(`  DB path: ${INTERCEPTOR_DB_PATH}`);
  logInfo(`  Process ID: ${PROCESS_ID}`);
  logInfo(`  Multi-session: ENABLED`);
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
export {
  initDatabase,
  persistDatabase,
  INTERCEPTOR_DB_PATH,
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  // Multi-session exports
  PROCESS_ID,
  discoverSessionsFromFilesystem,
  discoverAllSessions,
  registerSession,
  cleanupStaleSessions,
  isOwnSession,
  acquireLock,
  releaseLock,
};
