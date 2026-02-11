/**
 * V3 CLI RuVector Migrate Command
 * Database migration management for RuVector
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { confirm, select } from '../../prompt.js';

/**
 * Migration definition
 */
interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
  checksum?: string;
}

/**
 * Available migrations
 */
const MIGRATIONS: Migration[] = [
  {
    version: '1.0.0',
    name: 'Initial RuVector setup',
    up: '-- Initial setup handled by init command',
    down: '-- Drop all tables in schema',
  },
  {
    version: '1.1.0',
    name: 'Add full-text search',
    up: `
      CREATE INDEX IF NOT EXISTS idx_embeddings_content_fts
      ON {{schema}}.embeddings
      USING gin (to_tsvector('english', COALESCE(content, '')));

      ALTER TABLE {{schema}}.embeddings
      ADD COLUMN IF NOT EXISTS search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED;
    `,
    down: `
      DROP INDEX IF EXISTS {{schema}}.idx_embeddings_content_fts;
      ALTER TABLE {{schema}}.embeddings DROP COLUMN IF EXISTS search_vector;
    `,
  },
  {
    version: '1.2.0',
    name: 'Add embedding statistics',
    up: `
      CREATE TABLE IF NOT EXISTS {{schema}}.embedding_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        namespace VARCHAR(128) NOT NULL,
        total_vectors INTEGER DEFAULT 0,
        avg_magnitude FLOAT,
        dimension_stats JSONB,
        computed_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_embedding_stats_namespace
      ON {{schema}}.embedding_stats (namespace);
    `,
    down: `
      DROP TABLE IF EXISTS {{schema}}.embedding_stats;
    `,
  },
  {
    version: '1.3.0',
    name: 'Add query cache',
    up: `
      CREATE TABLE IF NOT EXISTS {{schema}}.query_cache (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        query_hash VARCHAR(64) NOT NULL UNIQUE,
        query_embedding vector(1536),
        result_ids UUID[],
        result_scores FLOAT[],
        hit_count INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_accessed TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_query_cache_hash
      ON {{schema}}.query_cache (query_hash);

      CREATE INDEX IF NOT EXISTS idx_query_cache_last_accessed
      ON {{schema}}.query_cache (last_accessed);
    `,
    down: `
      DROP TABLE IF EXISTS {{schema}}.query_cache;
    `,
  },
  {
    version: '1.4.0',
    name: 'Add batch operations support',
    up: `
      CREATE TABLE IF NOT EXISTS {{schema}}.batch_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_type VARCHAR(64) NOT NULL,
        status VARCHAR(32) DEFAULT 'pending',
        total_items INTEGER DEFAULT 0,
        processed_items INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_batch_jobs_status
      ON {{schema}}.batch_jobs (status);
    `,
    down: `
      DROP TABLE IF EXISTS {{schema}}.batch_jobs;
    `,
  },
  {
    version: '1.5.0',
    name: 'Add pattern learning',
    up: `
      CREATE TABLE IF NOT EXISTS {{schema}}.neural_patterns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pattern_type VARCHAR(64) NOT NULL,
        input_embedding vector(1536),
        output_embedding vector(1536),
        weight_matrix JSONB,
        activation VARCHAR(32) DEFAULT 'relu',
        accuracy FLOAT,
        training_steps INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_neural_patterns_type
      ON {{schema}}.neural_patterns (pattern_type);

      CREATE INDEX IF NOT EXISTS idx_neural_patterns_input_hnsw
      ON {{schema}}.neural_patterns
      USING hnsw (input_embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
    `,
    down: `
      DROP TABLE IF EXISTS {{schema}}.neural_patterns;
    `,
  },
];

/**
 * Get PostgreSQL connection config from context
 */
function getConnectionConfig(ctx: CommandContext) {
  return {
    host: (ctx.flags.host as string) || process.env.PGHOST || 'localhost',
    port: parseInt((ctx.flags.port as string) || process.env.PGPORT || '5432', 10),
    database: (ctx.flags.database as string) || process.env.PGDATABASE || '',
    user: (ctx.flags.user as string) || process.env.PGUSER || 'postgres',
    password: (ctx.flags.password as string) || process.env.PGPASSWORD || '',
    ssl: (ctx.flags.ssl as boolean) || process.env.PGSSLMODE === 'require',
    schema: (ctx.flags.schema as string) || 'claude_flow',
  };
}

/**
 * Calculate simple checksum for migration SQL
 */
function calculateChecksum(sql: string): string {
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * RuVector migrate command
 */
export const migrateCommand: Command = {
  name: 'migrate',
  description: 'Run database migrations',
  options: [
    {
      name: 'up',
      description: 'Run pending migrations (default)',
      type: 'boolean',
      default: true,
    },
    {
      name: 'down',
      description: 'Rollback last migration',
      type: 'boolean',
      default: false,
    },
    {
      name: 'to',
      description: 'Migrate to specific version',
      type: 'string',
    },
    {
      name: 'dry-run',
      description: 'Show SQL without executing',
      type: 'boolean',
      default: false,
    },
    {
      name: 'force',
      description: 'Force migration even if dirty',
      type: 'boolean',
      default: false,
    },
    {
      name: 'host',
      short: 'h',
      description: 'PostgreSQL host',
      type: 'string',
      default: 'localhost',
    },
    {
      name: 'port',
      short: 'p',
      description: 'PostgreSQL port',
      type: 'number',
      default: 5432,
    },
    {
      name: 'database',
      short: 'd',
      description: 'Database name',
      type: 'string',
    },
    {
      name: 'user',
      short: 'u',
      description: 'Database user',
      type: 'string',
    },
    {
      name: 'password',
      description: 'Database password',
      type: 'string',
    },
    {
      name: 'ssl',
      description: 'Enable SSL',
      type: 'boolean',
      default: false,
    },
    {
      name: 'schema',
      short: 's',
      description: 'Schema name',
      type: 'string',
      default: 'claude_flow',
    },
  ],
  examples: [
    { command: 'claude-flow ruvector migrate --up', description: 'Run pending migrations' },
    { command: 'claude-flow ruvector migrate --down', description: 'Rollback last migration' },
    { command: 'claude-flow ruvector migrate --to 1.2.0', description: 'Migrate to version 1.2.0' },
    { command: 'claude-flow ruvector migrate --dry-run', description: 'Preview migration SQL' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const config = getConnectionConfig(ctx);
    const dryRun = ctx.flags['dry-run'] as boolean;
    const force = ctx.flags.force as boolean;
    const targetVersion = ctx.flags.to as string;
    const rollback = ctx.flags.down as boolean;

    output.writeln();
    output.writeln(output.bold('RuVector Migration'));
    output.writeln(output.dim('=' .repeat(60)));
    output.writeln();

    if (!config.database) {
      output.printError('Database name is required. Use --database or -d flag, or set PGDATABASE env.');
      return { success: false, exitCode: 1 };
    }

    if (dryRun) {
      output.printInfo('Dry run mode: SQL will be shown but not executed');
      output.writeln();
    }

    const spinner = output.createSpinner({ text: 'Connecting to PostgreSQL...', spinner: 'dots' });
    spinner.start();

    try {
      // Import pg
      let pg: typeof import('pg') | null = null;
      try {
        pg = await import('pg');
      } catch {
        spinner.fail('PostgreSQL driver not found');
        output.printError('Install pg package: npm install pg');
        return { success: false, exitCode: 1 };
      }

      const client = new pg.Client({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : false,
      });

      await client.connect();
      spinner.succeed('Connected to PostgreSQL');

      // Check if schema and migrations table exist
      spinner.setText('Checking migration status...'); spinner.start();

      const schemaExists = await client.query(`
        SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1
      `, [config.schema]);

      if (schemaExists.rows.length === 0) {
        spinner.fail(`Schema "${config.schema}" not found`);
        output.printError('Run `claude-flow ruvector init` first');
        await client.end();
        return { success: false, exitCode: 1 };
      }

      // Get applied migrations
      const appliedResult = await client.query(`
        SELECT version, name, applied_at, checksum
        FROM ${config.schema}.migrations
        ORDER BY version ASC
      `);

      const appliedVersions = new Set(appliedResult.rows.map(r => r.version));
      spinner.succeed(`Found ${appliedVersions.size} applied migrations`);

      // Determine migrations to run
      let migrationsToRun: Migration[] = [];
      let direction = 'up';

      if (rollback) {
        direction = 'down';
        // Get the last applied migration
        const lastApplied = appliedResult.rows[appliedResult.rows.length - 1];
        if (!lastApplied) {
          output.printWarning('No migrations to rollback');
          await client.end();
          return { success: true };
        }
        const migration = MIGRATIONS.find(m => m.version === lastApplied.version);
        if (migration) {
          migrationsToRun = [migration];
        }
      } else if (targetVersion) {
        // Migrate to specific version
        const targetIdx = MIGRATIONS.findIndex(m => m.version === targetVersion);
        if (targetIdx === -1) {
          output.printError(`Version ${targetVersion} not found`);
          await client.end();
          return { success: false, exitCode: 1 };
        }

        const currentVersions = Array.from(appliedVersions);
        const currentIdx = currentVersions.length > 0
          ? MIGRATIONS.findIndex(m => m.version === currentVersions[currentVersions.length - 1])
          : -1;

        if (targetIdx > currentIdx) {
          // Migrate up
          migrationsToRun = MIGRATIONS.slice(currentIdx + 1, targetIdx + 1)
            .filter(m => !appliedVersions.has(m.version));
        } else if (targetIdx < currentIdx) {
          // Migrate down
          direction = 'down';
          migrationsToRun = MIGRATIONS.slice(targetIdx + 1, currentIdx + 1)
            .filter(m => appliedVersions.has(m.version))
            .reverse();
        }
      } else {
        // Run all pending migrations
        migrationsToRun = MIGRATIONS.filter(m => !appliedVersions.has(m.version));
      }

      if (migrationsToRun.length === 0) {
        output.printSuccess('Database is up to date');

        // Show current migration status
        output.writeln();
        output.writeln(output.highlight('Applied Migrations:'));
        output.printTable({
          columns: [
            { key: 'version', header: 'Version', width: 12 },
            { key: 'name', header: 'Name', width: 35 },
            { key: 'applied', header: 'Applied At', width: 22 },
          ],
          data: appliedResult.rows.map(r => ({
            version: r.version,
            name: r.name,
            applied: new Date(r.applied_at).toISOString().replace('T', ' ').substring(0, 19),
          })),
        });

        await client.end();
        return { success: true };
      }

      // Show migrations to run
      output.writeln();
      output.writeln(output.highlight(`Migrations to ${direction === 'up' ? 'apply' : 'rollback'}:`));
      output.printTable({
        columns: [
          { key: 'version', header: 'Version', width: 12 },
          { key: 'name', header: 'Name', width: 40 },
          { key: 'direction', header: 'Direction', width: 10 },
        ],
        data: migrationsToRun.map(m => ({
          version: m.version,
          name: m.name,
          direction: direction === 'up' ? output.success('UP') : output.warning('DOWN'),
        })),
      });
      output.writeln();

      // Dry run: show SQL
      if (dryRun) {
        for (const migration of migrationsToRun) {
          const sql = direction === 'up' ? migration.up : migration.down;
          const resolvedSql = sql.replace(/\{\{schema\}\}/g, config.schema);

          output.writeln(output.bold(`-- Migration ${migration.version}: ${migration.name}`));
          output.writeln(output.dim('-- Direction: ' + direction.toUpperCase()));
          output.writeln();
          output.writeln(resolvedSql);
          output.writeln();
        }
        await client.end();
        return { success: true, data: { dryRun: true, migrations: migrationsToRun.map(m => m.version) } };
      }

      // Confirm before running
      if (ctx.interactive && !force) {
        const confirmRun = await confirm({
          message: `Run ${migrationsToRun.length} migration(s)?`,
          default: true,
        });
        if (!confirmRun) {
          output.printInfo('Migration cancelled');
          await client.end();
          return { success: false, exitCode: 0 };
        }
      }

      // Run migrations
      const results: { version: string; success: boolean; error?: string }[] = [];

      for (const migration of migrationsToRun) {
        spinner.setText(`Running migration ${migration.version}: ${migration.name}...`); spinner.start();

        try {
          const sql = direction === 'up' ? migration.up : migration.down;
          const resolvedSql = sql.replace(/\{\{schema\}\}/g, config.schema);

          await client.query('BEGIN');

          // Execute migration SQL
          await client.query(resolvedSql);

          // Update migrations table
          if (direction === 'up') {
            const checksum = calculateChecksum(resolvedSql);
            await client.query(`
              INSERT INTO ${config.schema}.migrations (version, name, checksum)
              VALUES ($1, $2, $3)
              ON CONFLICT (version) DO UPDATE SET applied_at = NOW()
            `, [migration.version, migration.name, checksum]);
          } else {
            await client.query(`
              DELETE FROM ${config.schema}.migrations WHERE version = $1
            `, [migration.version]);
          }

          await client.query('COMMIT');
          spinner.succeed(`Migration ${migration.version} ${direction === 'up' ? 'applied' : 'rolled back'}`);
          results.push({ version: migration.version, success: true });
        } catch (error) {
          await client.query('ROLLBACK');
          spinner.fail(`Migration ${migration.version} failed`);
          const errorMessage = error instanceof Error ? error.message : String(error);
          output.printError(errorMessage);
          results.push({ version: migration.version, success: false, error: errorMessage });

          if (!force) {
            output.printWarning('Stopping migration due to error. Use --force to continue.');
            break;
          }
        }
      }

      await client.end();

      // Summary
      output.writeln();
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        output.printSuccess(`All ${successful} migration(s) completed successfully`);
      } else {
        output.printWarning(`${successful} succeeded, ${failed} failed`);
      }

      return {
        success: failed === 0,
        data: { results },
        exitCode: failed > 0 ? 1 : 0,
      };
    } catch (error) {
      spinner.fail('Migration failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

export default migrateCommand;
