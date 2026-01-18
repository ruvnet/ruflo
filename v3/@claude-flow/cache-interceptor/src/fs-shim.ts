/**
 * fs-shim.ts - Replacement for the built-in fs module
 *
 * This is a preload shim that intercepts fs operations for Claude session files.
 * It exports a wrapped version of fs that redirects reads to optimized content.
 */

import * as originalFs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Debug flag
const DEBUG = process.env.CACHE_INTERCEPTOR_DEBUG === 'true';

function log(msg: string): void {
  if (DEBUG) {
    console.error(`[fs-shim] ${msg}`);
  }
}

// Configuration
const OPTIMIZATION_ENABLED = process.env.CACHE_OPTIMIZE !== 'false';
const TARGET_SIZE_BYTES = parseInt(process.env.CACHE_TARGET_SIZE || '500000', 10);
const KEEP_RECENT_MESSAGES = parseInt(process.env.CACHE_KEEP_RECENT || '50', 10);

// Path patterns to intercept
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const INTERCEPT_PATTERN = /\.claude[\/\\]projects[\/\\].*\.jsonl$/;

function shouldIntercept(filePath: string): boolean {
  return INTERCEPT_PATTERN.test(filePath);
}

function safeJsonParse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return { type: 'unknown' };
  }
}

/**
 * Optimize messages to reduce context size
 */
function optimizeMessages(messages: Array<{ line: string; parsed: any }>): string[] {
  if (!OPTIMIZATION_ENABLED) {
    return messages.map(m => m.line);
  }

  const totalSize = messages.reduce((sum, m) => sum + m.line.length, 0);

  // Don't optimize if already under target
  if (totalSize < TARGET_SIZE_BYTES) {
    log(`Size ${(totalSize/1024).toFixed(1)}KB under target, no optimization needed`);
    return messages.map(m => m.line);
  }

  log(`Optimizing: ${(totalSize/1024).toFixed(1)}KB -> target ${(TARGET_SIZE_BYTES/1024).toFixed(1)}KB`);

  // Categorize messages by priority
  const summaries: string[] = [];
  const systemMsgs: string[] = [];
  const userAssistant: Array<{ line: string; idx: number }> = [];
  const fileHistory: string[] = [];
  const queueOps: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const { line, parsed } = messages[i];
    const type = parsed.type;

    if (type === 'summary') {
      summaries.push(line);
    } else if (type === 'system') {
      systemMsgs.push(line);
    } else if (type === 'user' || type === 'assistant') {
      userAssistant.push({ line, idx: i });
    } else if (type === 'file-history-snapshot') {
      fileHistory.push(line);
    } else if (type === 'queue-operation') {
      queueOps.push(line);
    }
  }

  // Build optimized output with priority:
  // 1. All summaries (critical for context recovery)
  // 2. System messages (important for context)
  // 3. Recent user/assistant messages
  // 4. Fill remaining budget with older messages

  const optimized: string[] = [];
  let currentSize = 0;

  // Always include all summaries
  for (const line of summaries) {
    optimized.push(line);
    currentSize += line.length;
  }

  // Include system messages
  for (const line of systemMsgs) {
    if (currentSize + line.length < TARGET_SIZE_BYTES) {
      optimized.push(line);
      currentSize += line.length;
    }
  }

  // Include recent user/assistant (prioritize most recent)
  const recentUA = userAssistant.slice(-KEEP_RECENT_MESSAGES);
  for (const { line } of recentUA) {
    if (currentSize + line.length < TARGET_SIZE_BYTES) {
      optimized.push(line);
      currentSize += line.length;
    }
  }

  // Include most recent file history (just 1 snapshot)
  if (fileHistory.length > 0) {
    const latest = fileHistory[fileHistory.length - 1];
    if (currentSize + latest.length < TARGET_SIZE_BYTES) {
      optimized.push(latest);
      currentSize += latest.length;
    }
  }

  // Fill remaining budget with older user/assistant if space
  const older = userAssistant.slice(0, -KEEP_RECENT_MESSAGES).reverse();
  for (const { line } of older) {
    if (currentSize + line.length < TARGET_SIZE_BYTES) {
      optimized.push(line);
      currentSize += line.length;
    } else {
      break; // Budget exhausted
    }
  }

  const reduction = ((totalSize - currentSize) / totalSize * 100).toFixed(1);
  log(`Optimized: ${messages.length} -> ${optimized.length} messages (${reduction}% reduction)`);

  return optimized;
}

/**
 * Intercepted readFileSync
 */
function shimmedReadFileSync(
  filePath: originalFs.PathOrFileDescriptor,
  options?: { encoding?: BufferEncoding; flag?: string } | BufferEncoding
): string | Buffer {
  const pathStr = filePath.toString();

  // Only intercept Claude session files
  if (!shouldIntercept(pathStr)) {
    return (originalFs.readFileSync as any)(filePath, options);
  }

  log(`Intercepting read: ${pathStr}`);

  try {
    // Read original content
    const originalContent = (originalFs.readFileSync as any)(filePath, 'utf8') as string;
    const originalLines = originalContent.split('\n').filter(l => l.trim());

    if (originalLines.length === 0) {
      return originalContent;
    }

    // Parse all messages
    const messages = originalLines.map(line => ({
      line,
      parsed: safeJsonParse(line),
    }));

    // Optimize
    const optimizedLines = optimizeMessages(messages);

    const content = optimizedLines.join('\n') + '\n';

    log(`Serving optimized: ${originalLines.length} -> ${optimizedLines.length} messages`);

    // Return in requested format
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding === 'utf8' || encoding === 'utf-8') {
      return content;
    }
    return Buffer.from(content, 'utf8');

  } catch (error) {
    log(`Read error: ${error}`);
    return (originalFs.readFileSync as any)(filePath, options);
  }
}

// Replace the fs module in require cache
const Module = require('module');
const originalRequire = Module.prototype.require;

// Create wrapped fs with intercepted methods
const wrappedFs: any = Object.create(originalFs);
wrappedFs.readFileSync = shimmedReadFileSync;

Module.prototype.require = function(id: string) {
  if (id === 'fs' || id === 'node:fs') {
    return wrappedFs;
  }
  return originalRequire.apply(this, arguments);
};

log('fs-shim installed - intercepting fs.readFileSync for Claude sessions');

// Export shimmedReadFileSync for external use
export { shimmedReadFileSync, optimizeMessages };
export default wrappedFs;
