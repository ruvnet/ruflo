/**
 * Session Rewriter - Directly rewrites Claude session files with optimized content
 *
 * This approach modifies the actual JSONL file before Claude reads it,
 * bypassing the need for fs interception (which doesn't work for parent process).
 *
 * Strategy:
 * 1. Read current session JSONL
 * 2. Apply advanced optimization (FlashAttention + Temporal + GNN)
 * 3. Write optimized content back to file
 * 4. Claude reads the smaller, optimized file
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAdvancedOptimizer, type OptimizationResult, type ScoringContext } from './advanced-optimizer.js';

// ============================================================================
// Configuration
// ============================================================================

export interface RewriterConfig {
  targetSizeBytes: number;
  keepRecentMessages: number;
  backupEnabled: boolean;
  backupDir: string;
  maxBackups: number;
  dryRun: boolean;
  verbose: boolean;
}

const DEFAULT_REWRITER_CONFIG: RewriterConfig = {
  targetSizeBytes: parseInt(process.env.CACHE_TARGET_SIZE || '500000', 10),
  keepRecentMessages: parseInt(process.env.CACHE_KEEP_RECENT || '50', 10),
  backupEnabled: true,
  backupDir: path.join(os.homedir(), '.claude', 'cache-backups'),
  maxBackups: 5,
  dryRun: false,
  verbose: process.env.CACHE_INTERCEPTOR_DEBUG === 'true',
};

// ============================================================================
// Session Finder
// ============================================================================

interface SessionInfo {
  path: string;
  size: number;
  messageCount: number;
  lastModified: Date;
}

export function findSessions(projectDir?: string): SessionInfo[] {
  const claudeProjectsDir = projectDir || path.join(os.homedir(), '.claude', 'projects');
  const sessions: SessionInfo[] = [];

  function scanDir(dir: string): void {
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.jsonl')) {
          try {
            const stats = fs.statSync(fullPath);
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim());

            sessions.push({
              path: fullPath,
              size: stats.size,
              messageCount: lines.length,
              lastModified: stats.mtime,
            });
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  scanDir(claudeProjectsDir);
  return sessions.sort((a, b) => b.size - a.size);
}

export function findCurrentSession(): SessionInfo | null {
  const sessions = findSessions();
  if (sessions.length === 0) return null;

  // Return most recently modified session
  return sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())[0];
}

export function findLargestSession(): SessionInfo | null {
  const sessions = findSessions();
  if (sessions.length === 0) return null;

  return sessions[0]; // Already sorted by size
}

// ============================================================================
// Session Rewriter
// ============================================================================

export class SessionRewriter {
  private config: RewriterConfig;
  private optimizer = createAdvancedOptimizer();

  constructor(config: Partial<RewriterConfig> = {}) {
    this.config = { ...DEFAULT_REWRITER_CONFIG, ...config };
    this.optimizer.updateConfig({
      targetSizeBytes: this.config.targetSizeBytes,
      keepRecentMessages: this.config.keepRecentMessages,
    });
  }

  private log(msg: string): void {
    if (this.config.verbose) {
      console.error(`[SessionRewriter] ${msg}`);
    }
  }

  /**
   * Rewrite a session file with optimized content
   */
  async rewrite(sessionPath: string, context?: Partial<ScoringContext>): Promise<{
    success: boolean;
    originalSize: number;
    optimizedSize: number;
    originalMessages: number;
    optimizedMessages: number;
    reductionPercent: number;
    metrics?: OptimizationResult['metrics'];
    error?: string;
  }> {
    try {
      // Read original file
      if (!fs.existsSync(sessionPath)) {
        return { success: false, originalSize: 0, optimizedSize: 0, originalMessages: 0, optimizedMessages: 0, reductionPercent: 0, error: 'File not found' };
      }

      const originalContent = fs.readFileSync(sessionPath, 'utf8');
      const originalSize = originalContent.length;
      const originalLines = originalContent.split('\n').filter(l => l.trim());
      const originalMessages = originalLines.length;

      this.log(`Processing: ${sessionPath}`);
      this.log(`Original: ${(originalSize / 1024 / 1024).toFixed(2)} MB, ${originalMessages} messages`);

      // Skip if already small
      if (originalSize < this.config.targetSizeBytes) {
        this.log(`Already under target size, skipping`);
        return {
          success: true,
          originalSize,
          optimizedSize: originalSize,
          originalMessages,
          optimizedMessages: originalMessages,
          reductionPercent: 0,
        };
      }

      // Parse messages
      const messages = originalLines.map(line => {
        try {
          return { line, parsed: JSON.parse(line) };
        } catch {
          return { line, parsed: { type: 'unknown' } };
        }
      });

      // Run advanced optimization
      const result = await this.optimizer.optimize(messages, context);

      const optimizedContent = result.optimizedLines.join('\n') + '\n';
      const optimizedSize = optimizedContent.length;
      const optimizedMessages = result.optimizedLines.length;

      const reductionPercent = ((originalSize - optimizedSize) / originalSize) * 100;

      this.log(`Optimized: ${(optimizedSize / 1024 / 1024).toFixed(2)} MB, ${optimizedMessages} messages`);
      this.log(`Reduction: ${reductionPercent.toFixed(1)}%`);

      if (this.config.dryRun) {
        this.log('Dry run - not writing file');
        return {
          success: true,
          originalSize,
          optimizedSize,
          originalMessages,
          optimizedMessages,
          reductionPercent,
          metrics: result.metrics,
        };
      }

      // Backup original
      if (this.config.backupEnabled) {
        await this.createBackup(sessionPath, originalContent);
      }

      // Write optimized content
      fs.writeFileSync(sessionPath, optimizedContent);
      this.log(`Wrote optimized content to ${sessionPath}`);

      return {
        success: true,
        originalSize,
        optimizedSize,
        originalMessages,
        optimizedMessages,
        reductionPercent,
        metrics: result.metrics,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log(`Error: ${errMsg}`);
      return {
        success: false,
        originalSize: 0,
        optimizedSize: 0,
        originalMessages: 0,
        optimizedMessages: 0,
        reductionPercent: 0,
        error: errMsg,
      };
    }
  }

  /**
   * Rewrite the current (most recent) session
   */
  async rewriteCurrentSession(context?: Partial<ScoringContext>): Promise<ReturnType<SessionRewriter['rewrite']>> {
    const session = findCurrentSession();
    if (!session) {
      return {
        success: false,
        originalSize: 0,
        optimizedSize: 0,
        originalMessages: 0,
        optimizedMessages: 0,
        reductionPercent: 0,
        error: 'No session found',
      };
    }

    return this.rewrite(session.path, context);
  }

  /**
   * Rewrite the largest session
   */
  async rewriteLargestSession(context?: Partial<ScoringContext>): Promise<ReturnType<SessionRewriter['rewrite']>> {
    const session = findLargestSession();
    if (!session) {
      return {
        success: false,
        originalSize: 0,
        optimizedSize: 0,
        originalMessages: 0,
        optimizedMessages: 0,
        reductionPercent: 0,
        error: 'No session found',
      };
    }

    return this.rewrite(session.path, context);
  }

  /**
   * Rewrite all sessions that exceed target size
   */
  async rewriteAllLargeSessions(context?: Partial<ScoringContext>): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    totalOriginalSize: number;
    totalOptimizedSize: number;
    results: Array<ReturnType<SessionRewriter['rewrite']> extends Promise<infer R> ? R & { path: string } : never>;
  }> {
    const sessions = findSessions().filter(s => s.size > this.config.targetSizeBytes);

    const results: Array<Awaited<ReturnType<SessionRewriter['rewrite']>> & { path: string }> = [];
    let succeeded = 0;
    let failed = 0;
    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;

    for (const session of sessions) {
      const result = await this.rewrite(session.path, context);
      results.push({ ...result, path: session.path });

      if (result.success) {
        succeeded++;
        totalOriginalSize += result.originalSize;
        totalOptimizedSize += result.optimizedSize;
      } else {
        failed++;
      }
    }

    return {
      processed: sessions.length,
      succeeded,
      failed,
      totalOriginalSize,
      totalOptimizedSize,
      results,
    };
  }

  /**
   * Create a backup of the session file
   */
  private async createBackup(sessionPath: string, content: string): Promise<void> {
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
    }

    const sessionName = path.basename(sessionPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${sessionName}.${timestamp}.backup`;
    const backupPath = path.join(this.config.backupDir, backupName);

    fs.writeFileSync(backupPath, content);
    this.log(`Backup created: ${backupPath}`);

    // Clean old backups
    await this.cleanOldBackups(sessionName);
  }

  /**
   * Remove old backups beyond maxBackups limit
   */
  private async cleanOldBackups(sessionName: string): Promise<void> {
    if (!fs.existsSync(this.config.backupDir)) return;

    const backups = fs.readdirSync(this.config.backupDir)
      .filter(f => f.startsWith(sessionName) && f.endsWith('.backup'))
      .map(f => ({
        name: f,
        path: path.join(this.config.backupDir, f),
        mtime: fs.statSync(path.join(this.config.backupDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Remove old backups
    for (let i = this.config.maxBackups; i < backups.length; i++) {
      fs.unlinkSync(backups[i].path);
      this.log(`Removed old backup: ${backups[i].name}`);
    }
  }

  /**
   * Restore from most recent backup
   */
  async restoreFromBackup(sessionPath: string): Promise<boolean> {
    const sessionName = path.basename(sessionPath);

    if (!fs.existsSync(this.config.backupDir)) {
      this.log('No backup directory found');
      return false;
    }

    const backups = fs.readdirSync(this.config.backupDir)
      .filter(f => f.startsWith(sessionName) && f.endsWith('.backup'))
      .map(f => ({
        name: f,
        path: path.join(this.config.backupDir, f),
        mtime: fs.statSync(path.join(this.config.backupDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (backups.length === 0) {
      this.log('No backups found for this session');
      return false;
    }

    const latestBackup = backups[0];
    const content = fs.readFileSync(latestBackup.path, 'utf8');
    fs.writeFileSync(sessionPath, content);

    this.log(`Restored from backup: ${latestBackup.name}`);
    return true;
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export async function runCLI(args: string[]): Promise<void> {
  const command = args[0] || 'current';

  const verbose = args.includes('--verbose') || args.includes('-v');
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const targetSize = args.find(a => a.startsWith('--target='))?.split('=')[1];

  const config: Partial<RewriterConfig> = {
    verbose,
    dryRun,
    targetSizeBytes: targetSize ? parseInt(targetSize, 10) : undefined,
  };

  const rewriter = new SessionRewriter(config);

  switch (command) {
    case 'current':
    case 'rewrite': {
      console.log('Rewriting current session...\n');
      const result = await rewriter.rewriteCurrentSession();

      if (result.success) {
        console.log(`✓ Session optimized:`);
        console.log(`  Original: ${(result.originalSize / 1024 / 1024).toFixed(2)} MB (${result.originalMessages} messages)`);
        console.log(`  Optimized: ${(result.optimizedSize / 1024 / 1024).toFixed(2)} MB (${result.optimizedMessages} messages)`);
        console.log(`  Reduction: ${result.reductionPercent.toFixed(1)}%`);

        if (result.metrics) {
          console.log(`\n  Advanced Metrics:`);
          console.log(`    Tiers: Hot=${result.metrics.tiersDistribution.hot}, Warm=${result.metrics.tiersDistribution.warm}, Cold=${result.metrics.tiersDistribution.cold}`);
          console.log(`    GNN Clusters: ${result.metrics.gnnClusters}`);
          console.log(`    Avg Relevance: ${result.metrics.averageRelevance.toFixed(3)}`);
          console.log(`    Processing: ${result.metrics.processingTimeMs}ms`);
        }
      } else {
        console.log(`✗ Failed: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case 'largest': {
      console.log('Rewriting largest session...\n');
      const result = await rewriter.rewriteLargestSession();

      if (result.success) {
        console.log(`✓ Session optimized:`);
        console.log(`  Original: ${(result.originalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Optimized: ${(result.optimizedSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Reduction: ${result.reductionPercent.toFixed(1)}%`);
      } else {
        console.log(`✗ Failed: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case 'all': {
      console.log('Rewriting all large sessions...\n');
      const result = await rewriter.rewriteAllLargeSessions();

      console.log(`Processed: ${result.processed} sessions`);
      console.log(`Succeeded: ${result.succeeded}`);
      console.log(`Failed: ${result.failed}`);
      console.log(`Total reduction: ${(result.totalOriginalSize / 1024 / 1024).toFixed(2)} MB → ${(result.totalOptimizedSize / 1024 / 1024).toFixed(2)} MB`);
      break;
    }

    case 'list': {
      const sessions = findSessions();
      console.log(`Found ${sessions.length} sessions:\n`);
      for (const s of sessions) {
        const sizeMB = (s.size / 1024 / 1024).toFixed(2);
        const needsOptimization = s.size > (config.targetSizeBytes || 500000);
        const marker = needsOptimization ? '⚠️' : '✓';
        console.log(`  ${marker} ${sizeMB} MB | ${s.messageCount} msgs | ${s.lastModified.toISOString()}`);
        console.log(`    ${s.path}`);
      }
      break;
    }

    case 'help':
    default:
      console.log(`
Session Rewriter - Optimize Claude session files with advanced intelligence

Usage:
  npx ts-node session-rewriter.ts <command> [options]

Commands:
  current    Rewrite the most recent session (default)
  largest    Rewrite the largest session
  all        Rewrite all sessions exceeding target size
  list       List all sessions with sizes

Options:
  --verbose, -v     Show detailed output
  --dry-run, -n     Preview changes without writing
  --target=<bytes>  Target size in bytes (default: 500000)

Environment Variables:
  CACHE_TARGET_SIZE         Target size in bytes
  CACHE_KEEP_RECENT         Number of recent messages to keep
  CACHE_INTERCEPTOR_DEBUG   Enable debug output

Examples:
  npx ts-node session-rewriter.ts current
  npx ts-node session-rewriter.ts all --dry-run --verbose
  npx ts-node session-rewriter.ts largest --target=1000000
`);
      break;
  }
}

// Run if executed directly
if (require.main === module) {
  runCLI(process.argv.slice(2)).catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
