/**
 * V3 CLI RuVector Status Command
 * Check connection and schema status
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

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
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * RuVector status command
 */
export const statusCommand: Command = {
  name: 'status',
  description: 'Check connection and schema status',
  options: [
    {
      name: 'verbose',
      short: 'v',
      description: 'Show detailed information',
      type: 'boolean',
      default: false,
    },
    {
      name: 'json',
      description: 'Output as JSON',
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
    { command: 'claude-flow ruvector status', description: 'Check basic status' },
    { command: 'claude-flow ruvector status --verbose', description: 'Show detailed info' },
    { command: 'claude-flow ruvector status --json', description: 'Output as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const config = getConnectionConfig(ctx);
    const verbose = ctx.flags.verbose as boolean;
    const jsonOutput = ctx.flags.json as boolean;

    if (!jsonOutput) {
      output.writeln();
      output.writeln(output.bold('RuVector PostgreSQL Status'));
      output.writeln(output.dim('=' .repeat(60)));
      output.writeln();
    }

    if (!config.database) {
      if (jsonOutput) {
        output.printJson({ error: 'Database name required' });
      } else {
        output.printError('Database name is required. Use --database or -d flag, or set PGDATABASE env.');
      }
      return { success: false, exitCode: 1 };
    }

    const statusData: Record<string, unknown> = {
      connection: {},
      pgvector: {},
      ruvector: {},
      tables: [],
      indexes: [],
      migrations: [],
    };

    const spinner = output.createSpinner({ text: 'Connecting to PostgreSQL...', spinner: 'dots' });
    if (!jsonOutput) spinner.start();

    try {
      // Import pg
      let pg: typeof import('pg') | null = null;
      try {
        pg = await import('pg');
      } catch {
        if (!jsonOutput) spinner.fail('PostgreSQL driver not found');
        if (jsonOutput) {
          output.printJson({ error: 'pg package not installed' });
        } else {
          output.printError('Install pg package: npm install pg');
        }
        return { success: false, exitCode: 1 };
      }

      const startTime = Date.now();
      const client = new pg.Client({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : false,
      });

      await client.connect();
      const connectionTime = Date.now() - startTime;

      if (!jsonOutput) spinner.succeed(`Connected in ${connectionTime}ms`);

      statusData.connection = {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        ssl: config.ssl,
        latency: connectionTime,
        status: 'connected',
      };

      // Get PostgreSQL version
      const versionResult = await client.query('SELECT version()');
      const pgVersion = versionResult.rows[0].version;
      (statusData.connection as Record<string, unknown>).pgVersion = pgVersion;

      // Check pgvector extension
      if (!jsonOutput) spinner.setText('Checking pgvector extension...'); spinner.start();

      const extensionResult = await client.query(`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `);

      if (extensionResult.rows.length === 0) {
        statusData.pgvector = { installed: false };
        if (!jsonOutput) {
          spinner.succeed(output.warning('pgvector extension not installed'));
        }
      } else {
        statusData.pgvector = {
          installed: true,
          version: extensionResult.rows[0].extversion,
        };
        if (!jsonOutput) {
          spinner.succeed(`pgvector v${extensionResult.rows[0].extversion} installed`);
        }
      }

      // Check schema exists
      if (!jsonOutput) spinner.setText(`Checking schema "${config.schema}"...`); spinner.start();

      const schemaResult = await client.query(`
        SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1
      `, [config.schema]);

      if (schemaResult.rows.length === 0) {
        statusData.ruvector = { initialized: false };
        if (!jsonOutput) {
          spinner.succeed(output.warning(`Schema "${config.schema}" not found`));
          output.printInfo('Run `claude-flow ruvector init` to initialize');
        }

        if (jsonOutput) {
          output.printJson(statusData);
        }

        await client.end();
        return { success: true, data: statusData };
      }

      if (!jsonOutput) spinner.succeed(`Schema "${config.schema}" found`);

      // Get RuVector metadata
      if (!jsonOutput) spinner.setText('Loading RuVector metadata...'); spinner.start();

      try {
        const metadataResult = await client.query(`
          SELECT key, value FROM ${config.schema}.metadata
        `);

        const metadata: Record<string, unknown> = {};
        for (const row of metadataResult.rows) {
          metadata[row.key] = JSON.parse(row.value);
        }

        statusData.ruvector = {
          initialized: true,
          version: metadata.ruvector_version || 'unknown',
          dimensions: metadata.dimensions || 1536,
          initializedAt: metadata.initialized_at,
        };

        if (!jsonOutput) spinner.succeed('RuVector metadata loaded');
      } catch {
        statusData.ruvector = { initialized: true, version: 'unknown' };
        if (!jsonOutput) spinner.succeed(output.warning('Could not load RuVector metadata'));
      }

      // Get table statistics
      if (!jsonOutput) spinner.setText('Gathering table statistics...'); spinner.start();

      const tablesResult = await client.query(`
        SELECT
          t.table_name,
          pg_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) as table_size,
          pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) as total_size,
          (SELECT count(*) FROM ${config.schema}.embeddings) as row_count
        FROM information_schema.tables t
        WHERE t.table_schema = $1
        ORDER BY t.table_name
      `, [config.schema]);

      const tableStats: { name: string; rows: number; size: string; totalSize: string }[] = [];

      for (const row of tablesResult.rows) {
        // Get row count for each table
        let rowCount = 0;
        try {
          const countResult = await client.query(`
            SELECT count(*) as cnt FROM ${config.schema}.${row.table_name}
          `);
          rowCount = parseInt(countResult.rows[0].cnt, 10);
        } catch {
          // Skip if can't count
        }

        tableStats.push({
          name: row.table_name,
          rows: rowCount,
          size: formatBytes(parseInt(row.table_size, 10)),
          totalSize: formatBytes(parseInt(row.total_size, 10)),
        });
      }

      statusData.tables = tableStats;
      if (!jsonOutput) spinner.succeed(`Found ${tableStats.length} tables`);

      // Get index information
      if (verbose) {
        if (!jsonOutput) spinner.setText('Gathering index information...'); spinner.start();

        const indexResult = await client.query(`
          SELECT
            i.relname as index_name,
            t.relname as table_name,
            am.amname as index_type,
            pg_relation_size(i.oid) as index_size,
            idx.indisvalid as is_valid,
            idx.indisunique as is_unique
          FROM pg_index idx
          JOIN pg_class i ON i.oid = idx.indexrelid
          JOIN pg_class t ON t.oid = idx.indrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN pg_am am ON am.oid = i.relam
          WHERE n.nspname = $1
          ORDER BY t.relname, i.relname
        `, [config.schema]);

        statusData.indexes = indexResult.rows.map(row => ({
          name: row.index_name,
          table: row.table_name,
          type: row.index_type,
          size: formatBytes(parseInt(row.index_size, 10)),
          valid: row.is_valid,
          unique: row.is_unique,
        }));

        if (!jsonOutput) spinner.succeed(`Found ${indexResult.rows.length} indexes`);
      }

      // Get migration status
      if (!jsonOutput) spinner.setText('Checking migration status...'); spinner.start();

      try {
        const migrationsResult = await client.query(`
          SELECT version, name, applied_at
          FROM ${config.schema}.migrations
          ORDER BY version ASC
        `);

        statusData.migrations = migrationsResult.rows.map(row => ({
          version: row.version,
          name: row.name,
          appliedAt: row.applied_at,
        }));

        if (!jsonOutput) spinner.succeed(`${migrationsResult.rows.length} migrations applied`);
      } catch {
        statusData.migrations = [];
        if (!jsonOutput) spinner.succeed(output.warning('Could not read migrations table'));
      }

      await client.end();

      // Output results
      if (jsonOutput) {
        output.printJson(statusData);
      } else {
        output.writeln();

        // Connection info
        output.writeln(output.highlight('Connection:'));
        output.printTable({
          columns: [
            { key: 'property', header: 'Property', width: 20 },
            { key: 'value', header: 'Value', width: 40 },
          ],
          data: [
            { property: 'Host', value: config.host },
            { property: 'Port', value: String(config.port) },
            { property: 'Database', value: config.database },
            { property: 'User', value: config.user },
            { property: 'SSL', value: config.ssl ? 'Enabled' : 'Disabled' },
            { property: 'Latency', value: `${connectionTime}ms` },
          ],
        });
        output.writeln();

        // pgvector info
        output.writeln(output.highlight('pgvector Extension:'));
        const pgvectorData = statusData.pgvector as { installed: boolean; version?: string };
        output.writeln(`  Status: ${pgvectorData.installed ? output.success('Installed') : output.error('Not Installed')}`);
        if (pgvectorData.version) {
          output.writeln(`  Version: ${pgvectorData.version}`);
        }
        output.writeln();

        // RuVector info
        output.writeln(output.highlight('RuVector:'));
        const ruvectorData = statusData.ruvector as { initialized: boolean; version?: string; dimensions?: number };
        output.writeln(`  Initialized: ${ruvectorData.initialized ? output.success('Yes') : output.error('No')}`);
        if (ruvectorData.version) {
          output.writeln(`  Version: ${ruvectorData.version}`);
        }
        if (ruvectorData.dimensions) {
          output.writeln(`  Dimensions: ${ruvectorData.dimensions}`);
        }
        output.writeln();

        // Table statistics
        output.writeln(output.highlight('Table Statistics:'));
        output.printTable({
          columns: [
            { key: 'name', header: 'Table', width: 30 },
            { key: 'rows', header: 'Rows', width: 12 },
            { key: 'size', header: 'Size', width: 12 },
            { key: 'totalSize', header: 'Total Size', width: 12 },
          ],
          data: tableStats,
        });
        output.writeln();

        // Index information (verbose only)
        if (verbose && (statusData.indexes as unknown[]).length > 0) {
          output.writeln(output.highlight('Index Health:'));
          output.printTable({
            columns: [
              { key: 'name', header: 'Index', width: 35 },
              { key: 'table', header: 'Table', width: 20 },
              { key: 'type', header: 'Type', width: 10 },
              { key: 'size', header: 'Size', width: 10 },
              { key: 'status', header: 'Status', width: 10 },
            ],
            data: (statusData.indexes as { name: string; table: string; type: string; size: string; valid: boolean }[]).map(idx => ({
              ...idx,
              status: idx.valid ? output.success('Valid') : output.error('Invalid'),
            })),
          });
          output.writeln();
        }

        // Migration status
        output.writeln(output.highlight('Migrations:'));
        const migrations = statusData.migrations as { version: string; name: string; appliedAt: string }[];
        if (migrations.length === 0) {
          output.writeln('  No migrations applied');
        } else {
          output.printTable({
            columns: [
              { key: 'version', header: 'Version', width: 12 },
              { key: 'name', header: 'Name', width: 35 },
              { key: 'appliedAt', header: 'Applied At', width: 22 },
            ],
            data: migrations.map(m => ({
              ...m,
              appliedAt: new Date(m.appliedAt).toISOString().replace('T', ' ').substring(0, 19),
            })),
          });
        }
        output.writeln();

        // Summary
        const embeddingsTable = tableStats.find(t => t.name === 'embeddings');
        if (embeddingsTable) {
          output.printBox([
            `Total Vectors: ${embeddingsTable.rows.toLocaleString()}`,
            `Storage Used: ${embeddingsTable.totalSize}`,
            `Schema: ${config.schema}`,
            `Migrations: ${migrations.length} applied`,
          ].join('\n'), 'Summary');
        }
      }

      return { success: true, data: statusData };
    } catch (error) {
      if (!jsonOutput) spinner.fail('Status check failed');

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (jsonOutput) {
        output.printJson({ error: errorMessage });
      } else {
        output.printError(errorMessage);
      }

      return { success: false, exitCode: 1 };
    }
  },
};

export default statusCommand;
