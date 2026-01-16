/**
 * RuVector PostgreSQL Bridge - Migration Manager
 *
 * Handles database migrations for the RuVector PostgreSQL integration.
 * Supports up/down migrations, rollback, and migration tracking.
 *
 * @module @claude-flow/plugins/integrations/ruvector/migrations
 * @version 1.0.0
 */

import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Migration file metadata
 */
export interface MigrationFile {
  /** Migration number (e.g., 001, 002) */
  readonly number: number;
  /** Migration name (e.g., 'create_extension') */
  readonly name: string;
  /** Full filename */
  readonly filename: string;
  /** SQL content for up migration */
  readonly upSql: string;
  /** SQL content for down migration (extracted from comments) */
  readonly downSql: string | null;
  /** MD5 checksum of the file */
  readonly checksum: string;
}

/**
 * Applied migration record from database
 */
export interface AppliedMigration {
  readonly id: number;
  readonly name: string;
  readonly appliedAt: Date;
  readonly checksum: string | null;
  readonly executionTimeMs: number | null;
  readonly rolledBackAt: Date | null;
}

/**
 * Migration result
 */
export interface MigrationResult {
  readonly success: boolean;
  readonly migration: string;
  readonly direction: 'up' | 'down';
  readonly executionTimeMs: number;
  readonly error?: string;
}

/**
 * Database client interface (minimal subset needed for migrations)
 */
export interface DatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  connect?(): Promise<void>;
  end?(): Promise<void>;
}

/**
 * Migration manager options
 */
export interface MigrationManagerOptions {
  /** Directory containing migration files */
  readonly migrationsDir?: string;
  /** Schema name for migrations table */
  readonly schema?: string;
  /** Table name for tracking migrations */
  readonly tableName?: string;
  /** Enable verbose logging */
  readonly verbose?: boolean;
  /** Custom logger */
  readonly logger?: Logger;
}

/**
 * Logger interface
 */
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

// ============================================================================
// Default Logger
// ============================================================================

const defaultLogger: Logger = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate MD5 checksum of a string
 */
function md5(content: string): string {
  // Simple hash implementation for checksum
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Extract rollback SQL from migration file comments
 */
function extractRollbackSql(content: string): string | null {
  const rollbackMatch = content.match(
    /-- ={10,}\s*\n-- Rollback Script\s*\n-- ={10,}\s*\n([\s\S]*?)$/
  );

  if (rollbackMatch) {
    // Remove comment prefixes and extract SQL
    const rollbackContent = rollbackMatch[1]
      .split('\n')
      .map(line => line.replace(/^--\s?/, ''))
      .join('\n')
      .trim();

    return rollbackContent || null;
  }

  return null;
}

/**
 * Parse migration filename
 */
function parseMigrationFilename(filename: string): { number: number; name: string } | null {
  const match = filename.match(/^(\d{3})_(.+)\.sql$/);
  if (!match) return null;

  return {
    number: parseInt(match[1], 10),
    name: match[2],
  };
}

// ============================================================================
// Migration Manager Class
// ============================================================================

/**
 * Manages database migrations for RuVector PostgreSQL Bridge
 */
export class MigrationManager {
  private readonly client: DatabaseClient;
  private readonly migrationsDir: string;
  private readonly schema: string;
  private readonly tableName: string;
  private readonly verbose: boolean;
  private readonly logger: Logger;

  constructor(client: DatabaseClient, options: MigrationManagerOptions = {}) {
    this.client = client;
    this.migrationsDir = options.migrationsDir ?? join(__dirname, '.');
    this.schema = options.schema ?? 'claude_flow';
    this.tableName = options.tableName ?? 'migrations';
    this.verbose = options.verbose ?? false;
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Initialize the migrations tracking table
   */
  async initialize(): Promise<void> {
    this.log('Initializing migrations table...');

    // Create schema if not exists
    await this.client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);

    // Create migrations tracking table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.${this.tableName} (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum TEXT,
        execution_time_ms INTEGER,
        rolled_back_at TIMESTAMPTZ
      )
    `);

    this.log('Migrations table initialized');
  }

  /**
   * Load all migration files from the migrations directory
   */
  async loadMigrations(): Promise<MigrationFile[]> {
    this.log(`Loading migrations from ${this.migrationsDir}`);

    const files = await readdir(this.migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    const migrations: MigrationFile[] = [];

    for (const filename of sqlFiles) {
      const parsed = parseMigrationFilename(filename);
      if (!parsed) {
        this.logger.warn(`Skipping invalid migration filename: ${filename}`);
        continue;
      }

      const filepath = join(this.migrationsDir, filename);
      const content = await readFile(filepath, 'utf-8');

      migrations.push({
        number: parsed.number,
        name: `${parsed.number.toString().padStart(3, '0')}_${parsed.name}`,
        filename,
        upSql: content,
        downSql: extractRollbackSql(content),
        checksum: md5(content),
      });
    }

    this.log(`Found ${migrations.length} migration files`);
    return migrations;
  }

  /**
   * Get list of applied migrations from database
   */
  async getAppliedMigrations(): Promise<AppliedMigration[]> {
    try {
      const result = await this.client.query<{
        id: number;
        name: string;
        applied_at: Date;
        checksum: string | null;
        execution_time_ms: number | null;
        rolled_back_at: Date | null;
      }>(`
        SELECT id, name, applied_at, checksum, execution_time_ms, rolled_back_at
        FROM ${this.schema}.${this.tableName}
        WHERE rolled_back_at IS NULL
        ORDER BY id
      `);

      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        appliedAt: row.applied_at,
        checksum: row.checksum,
        executionTimeMs: row.execution_time_ms,
        rolledBackAt: row.rolled_back_at,
      }));
    } catch (error) {
      // Table might not exist yet
      return [];
    }
  }

  /**
   * Get pending migrations (not yet applied)
   */
  async getPendingMigrations(): Promise<MigrationFile[]> {
    const allMigrations = await this.loadMigrations();
    const appliedMigrations = await this.getAppliedMigrations();
    const appliedNames = new Set(appliedMigrations.map(m => m.name));

    return allMigrations.filter(m => !appliedNames.has(m.name));
  }

  /**
   * Run a single migration (up)
   */
  async runMigration(migration: MigrationFile): Promise<MigrationResult> {
    const startTime = Date.now();
    this.log(`Running migration: ${migration.name}`);

    try {
      // Execute the migration SQL
      await this.client.query(migration.upSql);

      const executionTimeMs = Date.now() - startTime;

      // Record the migration (ignore if already recorded by the migration itself)
      await this.client.query(`
        INSERT INTO ${this.schema}.${this.tableName} (name, checksum, execution_time_ms)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO UPDATE SET
          checksum = EXCLUDED.checksum,
          execution_time_ms = EXCLUDED.execution_time_ms
      `, [migration.name, migration.checksum, executionTimeMs]);

      this.log(`Migration ${migration.name} completed in ${executionTimeMs}ms`);

      return {
        success: true,
        migration: migration.name,
        direction: 'up',
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Migration ${migration.name} failed: ${errorMessage}`);

      return {
        success: false,
        migration: migration.name,
        direction: 'up',
        executionTimeMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Rollback a single migration (down)
   */
  async rollbackMigration(migration: MigrationFile): Promise<MigrationResult> {
    const startTime = Date.now();
    this.log(`Rolling back migration: ${migration.name}`);

    if (!migration.downSql) {
      return {
        success: false,
        migration: migration.name,
        direction: 'down',
        executionTimeMs: 0,
        error: 'No rollback SQL available for this migration',
      };
    }

    try {
      // Execute the rollback SQL
      await this.client.query(migration.downSql);

      const executionTimeMs = Date.now() - startTime;

      // Mark the migration as rolled back
      await this.client.query(`
        UPDATE ${this.schema}.${this.tableName}
        SET rolled_back_at = NOW()
        WHERE name = $1
      `, [migration.name]);

      this.log(`Rollback of ${migration.name} completed in ${executionTimeMs}ms`);

      return {
        success: true,
        migration: migration.name,
        direction: 'down',
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Rollback of ${migration.name} failed: ${errorMessage}`);

      return {
        success: false,
        migration: migration.name,
        direction: 'down',
        executionTimeMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Run all pending migrations
   */
  async up(): Promise<MigrationResult[]> {
    await this.initialize();

    const pending = await this.getPendingMigrations();

    if (pending.length === 0) {
      this.log('No pending migrations');
      return [];
    }

    this.log(`Running ${pending.length} pending migrations`);

    const results: MigrationResult[] = [];

    for (const migration of pending) {
      const result = await this.runMigration(migration);
      results.push(result);

      if (!result.success) {
        this.logger.error('Migration failed, stopping');
        break;
      }
    }

    return results;
  }

  /**
   * Rollback the last N migrations
   */
  async down(count: number = 1): Promise<MigrationResult[]> {
    const allMigrations = await this.loadMigrations();
    const applied = await this.getAppliedMigrations();

    if (applied.length === 0) {
      this.log('No migrations to rollback');
      return [];
    }

    // Get the last N applied migrations in reverse order
    const toRollback = applied
      .slice(-count)
      .reverse();

    this.log(`Rolling back ${toRollback.length} migrations`);

    const results: MigrationResult[] = [];

    for (const appliedMigration of toRollback) {
      const migration = allMigrations.find(m => m.name === appliedMigration.name);

      if (!migration) {
        results.push({
          success: false,
          migration: appliedMigration.name,
          direction: 'down',
          executionTimeMs: 0,
          error: 'Migration file not found',
        });
        continue;
      }

      const result = await this.rollbackMigration(migration);
      results.push(result);

      if (!result.success) {
        this.logger.error('Rollback failed, stopping');
        break;
      }
    }

    return results;
  }

  /**
   * Rollback all migrations
   */
  async reset(): Promise<MigrationResult[]> {
    const applied = await this.getAppliedMigrations();
    return this.down(applied.length);
  }

  /**
   * Get migration status
   */
  async status(): Promise<{
    applied: AppliedMigration[];
    pending: MigrationFile[];
    total: number;
  }> {
    const allMigrations = await this.loadMigrations();
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations();

    return {
      applied,
      pending,
      total: allMigrations.length,
    };
  }

  /**
   * Verify migration checksums
   */
  async verify(): Promise<{
    valid: boolean;
    mismatches: Array<{ name: string; expected: string; actual: string }>;
  }> {
    const allMigrations = await this.loadMigrations();
    const applied = await this.getAppliedMigrations();

    const mismatches: Array<{ name: string; expected: string; actual: string }> = [];

    for (const appliedMigration of applied) {
      const migration = allMigrations.find(m => m.name === appliedMigration.name);

      if (migration && appliedMigration.checksum && migration.checksum !== appliedMigration.checksum) {
        mismatches.push({
          name: appliedMigration.name,
          expected: appliedMigration.checksum,
          actual: migration.checksum,
        });
      }
    }

    return {
      valid: mismatches.length === 0,
      mismatches,
    };
  }

  /**
   * Force re-run a specific migration
   */
  async rerun(migrationName: string): Promise<MigrationResult> {
    const allMigrations = await this.loadMigrations();
    const migration = allMigrations.find(m => m.name === migrationName || m.filename === migrationName);

    if (!migration) {
      return {
        success: false,
        migration: migrationName,
        direction: 'up',
        executionTimeMs: 0,
        error: 'Migration not found',
      };
    }

    // First rollback if applied
    const applied = await this.getAppliedMigrations();
    const isApplied = applied.some(a => a.name === migration.name);

    if (isApplied) {
      const rollbackResult = await this.rollbackMigration(migration);
      if (!rollbackResult.success) {
        return rollbackResult;
      }
    }

    // Then run again
    return this.runMigration(migration);
  }

  private log(message: string): void {
    if (this.verbose) {
      this.logger.info(message);
    }
  }
}

// ============================================================================
// CLI Helper Functions
// ============================================================================

/**
 * Run migrations from command line
 */
export async function runMigrationsFromCLI(
  client: DatabaseClient,
  command: 'up' | 'down' | 'reset' | 'status' | 'verify',
  options: MigrationManagerOptions & { count?: number } = {}
): Promise<void> {
  const manager = new MigrationManager(client, { ...options, verbose: true });

  switch (command) {
    case 'up': {
      const results = await manager.up();
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      console.log(`\nMigrations complete: ${successful} successful, ${failed} failed`);
      break;
    }

    case 'down': {
      const results = await manager.down(options.count ?? 1);
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      console.log(`\nRollbacks complete: ${successful} successful, ${failed} failed`);
      break;
    }

    case 'reset': {
      const results = await manager.reset();
      console.log(`\nReset complete: ${results.length} migrations rolled back`);
      break;
    }

    case 'status': {
      const status = await manager.status();
      console.log('\nMigration Status:');
      console.log(`  Total: ${status.total}`);
      console.log(`  Applied: ${status.applied.length}`);
      console.log(`  Pending: ${status.pending.length}`);

      if (status.applied.length > 0) {
        console.log('\nApplied Migrations:');
        for (const m of status.applied) {
          console.log(`  - ${m.name} (${m.appliedAt.toISOString()})`);
        }
      }

      if (status.pending.length > 0) {
        console.log('\nPending Migrations:');
        for (const m of status.pending) {
          console.log(`  - ${m.name}`);
        }
      }
      break;
    }

    case 'verify': {
      const verification = await manager.verify();
      if (verification.valid) {
        console.log('\nAll migration checksums are valid');
      } else {
        console.log('\nChecksum mismatches found:');
        for (const m of verification.mismatches) {
          console.log(`  - ${m.name}: expected ${m.expected}, got ${m.actual}`);
        }
      }
      break;
    }
  }
}

// ============================================================================
// Export Default Instance Factory
// ============================================================================

/**
 * Create a new MigrationManager instance
 */
export function createMigrationManager(
  client: DatabaseClient,
  options?: MigrationManagerOptions
): MigrationManager {
  return new MigrationManager(client, options);
}

export default MigrationManager;
