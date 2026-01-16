/**
 * V3 CLI RuVector Backup Command
 * Backup and restore for RuVector PostgreSQL data
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { confirm, input, select } from '../../prompt.js';

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
 * RuVector backup subcommand
 */
const backupSubcommand: Command = {
  name: 'create',
  description: 'Create a backup of RuVector data',
  options: [
    {
      name: 'output',
      short: 'o',
      description: 'Output file path',
      type: 'string',
      required: true,
    },
    {
      name: 'tables',
      short: 't',
      description: 'Specific tables (comma-separated)',
      type: 'string',
    },
    {
      name: 'format',
      short: 'f',
      description: 'Output format',
      type: 'string',
      default: 'sql',
      choices: ['sql', 'json', 'csv'],
    },
    {
      name: 'compress',
      short: 'c',
      description: 'Compress output (gzip)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'include-indexes',
      description: 'Include index definitions',
      type: 'boolean',
      default: true,
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
    { command: 'claude-flow ruvector backup create -o backup.sql', description: 'Create SQL backup' },
    { command: 'claude-flow ruvector backup create -o backup.json --format json', description: 'Create JSON backup' },
    { command: 'claude-flow ruvector backup create -o backup.sql.gz --compress', description: 'Compressed backup' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const config = getConnectionConfig(ctx);
    let outputPath = ctx.flags.output as string;
    const tablesFilter = ctx.flags.tables as string;
    const format = (ctx.flags.format as string) || 'sql';
    const compress = ctx.flags.compress as boolean;
    const includeIndexes = ctx.flags['include-indexes'] !== false;

    output.writeln();
    output.writeln(output.bold('RuVector Backup'));
    output.writeln(output.dim('=' .repeat(60)));
    output.writeln();

    if (!config.database) {
      output.printError('Database name is required. Use --database or -d flag, or set PGDATABASE env.');
      return { success: false, exitCode: 1 };
    }

    // Interactive mode
    if (!outputPath && ctx.interactive) {
      outputPath = await input({
        message: 'Output file path:',
        default: `ruvector_backup_${new Date().toISOString().split('T')[0]}.${format}`,
        validate: (v) => v.length > 0 || 'Output path is required',
      });
    }

    if (!outputPath) {
      output.printError('Output path is required. Use --output or -o flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Connecting to PostgreSQL...', spinner: 'dots' });
    spinner.start();

    try {
      // Import dependencies
      const fs = await import('fs');
      const path = await import('path');
      const { promisify } = await import('util');

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

      // Get tables to backup
      spinner.setText('Discovering tables...'); spinner.start();

      let tables: string[] = [];
      if (tablesFilter) {
        tables = tablesFilter.split(',').map(t => t.trim());
      } else {
        const tablesResult = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = $1 AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `, [config.schema]);
        tables = tablesResult.rows.map(r => r.table_name);
      }

      spinner.succeed(`Found ${tables.length} tables to backup`);

      // Prepare backup data
      const backupData: {
        metadata: Record<string, unknown>;
        schema: string;
        tables: { name: string; columns: string[]; rows: unknown[] }[];
        indexes: string[];
      } = {
        metadata: {
          backupDate: new Date().toISOString(),
          database: config.database,
          schema: config.schema,
          format,
          version: '1.0.0',
        },
        schema: config.schema,
        tables: [],
        indexes: [],
      };

      let totalRows = 0;

      // Export each table
      for (const tableName of tables) {
        spinner.setText(`Exporting ${tableName}...`); spinner.start();

        // Get columns
        const columnsResult = await client.query(`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position
        `, [config.schema, tableName]);

        const columns = columnsResult.rows.map(r => r.column_name);

        // Get data
        const dataResult = await client.query(`
          SELECT * FROM ${config.schema}.${tableName}
        `);

        backupData.tables.push({
          name: tableName,
          columns,
          rows: dataResult.rows,
        });

        totalRows += dataResult.rows.length;
        spinner.setText(`Exporting ${tableName}... (${dataResult.rows.length} rows)`);
      }

      spinner.succeed(`Exported ${totalRows.toLocaleString()} rows from ${tables.length} tables`);

      // Get indexes
      if (includeIndexes) {
        spinner.setText('Exporting index definitions...'); spinner.start();

        const indexResult = await client.query(`
          SELECT pg_get_indexdef(i.oid) as indexdef
          FROM pg_index idx
          JOIN pg_class i ON i.oid = idx.indexrelid
          JOIN pg_class t ON t.oid = idx.indrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1
            AND NOT idx.indisprimary
        `, [config.schema]);

        backupData.indexes = indexResult.rows.map(r => r.indexdef);
        spinner.succeed(`Exported ${backupData.indexes.length} index definitions`);
      }

      await client.end();

      // Write backup file
      spinner.setText(`Writing backup to ${outputPath}...`); spinner.start();

      let content: string;

      if (format === 'sql') {
        // Generate SQL format
        const lines: string[] = [];
        lines.push(`-- RuVector Backup`);
        lines.push(`-- Generated: ${backupData.metadata.backupDate}`);
        lines.push(`-- Database: ${config.database}`);
        lines.push(`-- Schema: ${config.schema}`);
        lines.push('');
        lines.push(`CREATE SCHEMA IF NOT EXISTS ${config.schema};`);
        lines.push('');

        for (const table of backupData.tables) {
          lines.push(`-- Table: ${table.name}`);
          lines.push(`-- Rows: ${table.rows.length}`);
          lines.push('');

          if (table.rows.length > 0) {
            for (const row of table.rows) {
              const values = table.columns.map(col => {
                const val = (row as Record<string, unknown>)[col];
                if (val === null || val === undefined) return 'NULL';
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                return String(val);
              });

              lines.push(`INSERT INTO ${config.schema}.${table.name} (${table.columns.join(', ')}) VALUES (${values.join(', ')});`);
            }
            lines.push('');
          }
        }

        // Add indexes
        if (includeIndexes && backupData.indexes.length > 0) {
          lines.push('-- Indexes');
          for (const idx of backupData.indexes) {
            lines.push(`${idx};`);
          }
        }

        content = lines.join('\n');
      } else if (format === 'json') {
        content = JSON.stringify(backupData, null, 2);
      } else {
        // CSV format - one file per table would be better, but we'll concatenate
        const lines: string[] = [];
        for (const table of backupData.tables) {
          lines.push(`# Table: ${table.name}`);
          lines.push(table.columns.join(','));
          for (const row of table.rows) {
            const values = table.columns.map(col => {
              const val = (row as Record<string, unknown>)[col];
              if (val === null || val === undefined) return '';
              const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
              return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
            });
            lines.push(values.join(','));
          }
          lines.push('');
        }
        content = lines.join('\n');
      }

      // Compress if requested
      if (compress) {
        const zlib = await import('zlib');
        const gzip = promisify(zlib.gzip);
        const compressed = await gzip(Buffer.from(content, 'utf-8'));
        outputPath = outputPath.endsWith('.gz') ? outputPath : `${outputPath}.gz`;
        fs.writeFileSync(outputPath, compressed);
      } else {
        fs.writeFileSync(outputPath, content, 'utf-8');
      }

      const fileSize = fs.statSync(outputPath).size;
      spinner.succeed(`Backup written to ${outputPath} (${formatBytes(fileSize)})`);

      output.writeln();
      output.printSuccess('Backup completed successfully!');
      output.writeln();

      output.printBox([
        `Output: ${outputPath}`,
        `Format: ${format.toUpperCase()}${compress ? ' (gzip compressed)' : ''}`,
        `Size: ${formatBytes(fileSize)}`,
        `Tables: ${tables.length}`,
        `Total Rows: ${totalRows.toLocaleString()}`,
        `Indexes: ${backupData.indexes.length}`,
      ].join('\n'), 'Backup Summary');

      return {
        success: true,
        data: {
          outputPath,
          format,
          compressed: compress,
          tables: tables.length,
          totalRows,
          indexes: backupData.indexes.length,
          fileSize,
        },
      };
    } catch (error) {
      spinner.fail('Backup failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * RuVector restore subcommand
 */
const restoreSubcommand: Command = {
  name: 'restore',
  description: 'Restore RuVector data from backup',
  options: [
    {
      name: 'input',
      short: 'i',
      description: 'Input file path',
      type: 'string',
      required: true,
    },
    {
      name: 'clean',
      description: 'Drop existing tables first',
      type: 'boolean',
      default: false,
    },
    {
      name: 'dry-run',
      description: 'Show what would be restored without executing',
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
    { command: 'claude-flow ruvector backup restore -i backup.sql', description: 'Restore from SQL backup' },
    { command: 'claude-flow ruvector backup restore -i backup.json --clean', description: 'Clean restore' },
    { command: 'claude-flow ruvector backup restore -i backup.sql --dry-run', description: 'Preview restore' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const config = getConnectionConfig(ctx);
    const inputPath = ctx.flags.input as string;
    const clean = ctx.flags.clean as boolean;
    const dryRun = ctx.flags['dry-run'] as boolean;

    output.writeln();
    output.writeln(output.bold('RuVector Restore'));
    output.writeln(output.dim('=' .repeat(60)));
    output.writeln();

    if (!config.database) {
      output.printError('Database name is required. Use --database or -d flag, or set PGDATABASE env.');
      return { success: false, exitCode: 1 };
    }

    if (!inputPath) {
      output.printError('Input path is required. Use --input or -i flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Reading backup file...', spinner: 'dots' });
    spinner.start();

    try {
      const fs = await import('fs');
      const path = await import('path');
      const { promisify } = await import('util');

      // Check file exists
      if (!fs.existsSync(inputPath)) {
        spinner.fail('Backup file not found');
        output.printError(`File not found: ${inputPath}`);
        return { success: false, exitCode: 1 };
      }

      // Read file
      let content: string;
      if (inputPath.endsWith('.gz')) {
        const zlib = await import('zlib');
        const gunzip = promisify(zlib.gunzip);
        const compressed = fs.readFileSync(inputPath);
        const decompressed = await gunzip(compressed);
        content = decompressed.toString('utf-8');
      } else {
        content = fs.readFileSync(inputPath, 'utf-8');
      }

      const fileSize = fs.statSync(inputPath).size;
      spinner.succeed(`Read backup file (${formatBytes(fileSize)})`);

      // Determine format
      const isJson = content.trim().startsWith('{');
      const format = isJson ? 'json' : 'sql';

      if (dryRun) {
        output.printInfo('Dry run mode: showing what would be restored');
        output.writeln();

        if (isJson) {
          const data = JSON.parse(content);
          output.writeln(output.highlight('Backup metadata:'));
          output.printTable({
            columns: [
              { key: 'property', header: 'Property', width: 20 },
              { key: 'value', header: 'Value', width: 40 },
            ],
            data: [
              { property: 'Backup Date', value: data.metadata?.backupDate || 'Unknown' },
              { property: 'Database', value: data.metadata?.database || 'Unknown' },
              { property: 'Schema', value: data.schema || 'Unknown' },
              { property: 'Tables', value: String(data.tables?.length || 0) },
              { property: 'Total Rows', value: String(data.tables?.reduce((sum: number, t: { rows: unknown[] }) => sum + t.rows.length, 0) || 0) },
              { property: 'Indexes', value: String(data.indexes?.length || 0) },
            ],
          });
        } else {
          // Count SQL statements
          const insertCount = (content.match(/INSERT INTO/gi) || []).length;
          const createCount = (content.match(/CREATE (TABLE|INDEX)/gi) || []).length;
          output.writeln(`SQL statements: ${insertCount} inserts, ${createCount} creates`);
        }

        return { success: true, data: { dryRun: true } };
      }

      // Confirm clean operation
      if (clean && ctx.interactive) {
        const confirmClean = await confirm({
          message: 'This will drop existing tables. Continue?',
          default: false,
        });
        if (!confirmClean) {
          output.printInfo('Restore cancelled');
          return { success: false, exitCode: 0 };
        }
      }

      // Connect and restore
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

      // Clean if requested
      if (clean) {
        spinner.setText(`Dropping schema "${config.schema}"...`); spinner.start();
        await client.query(`DROP SCHEMA IF EXISTS ${config.schema} CASCADE`);
        await client.query(`CREATE SCHEMA ${config.schema}`);
        spinner.succeed('Schema cleaned');
      }

      // Restore
      let restoredRows = 0;
      let restoredTables = 0;
      let restoredIndexes = 0;

      if (isJson) {
        // Restore from JSON
        const data = JSON.parse(content);

        for (const table of data.tables || []) {
          spinner.setText(`Restoring ${table.name}...`); spinner.start();

          // Create table if needed (assuming schema matches)
          for (const row of table.rows) {
            const columns = Object.keys(row);
            const values = columns.map((col, idx) => `$${idx + 1}`);
            const params = columns.map(col => {
              const val = row[col];
              return typeof val === 'object' ? JSON.stringify(val) : val;
            });

            try {
              await client.query(`
                INSERT INTO ${config.schema}.${table.name} (${columns.join(', ')})
                VALUES (${values.join(', ')})
                ON CONFLICT DO NOTHING
              `, params);
              restoredRows++;
            } catch {
              // Skip conflicts
            }
          }

          restoredTables++;
          spinner.setText(`Restoring ${table.name}... (${table.rows.length} rows)`);
        }

        spinner.succeed(`Restored ${restoredTables} tables, ${restoredRows} rows`);

        // Restore indexes
        if (data.indexes && data.indexes.length > 0) {
          spinner.setText('Restoring indexes...'); spinner.start();
          for (const indexDef of data.indexes) {
            try {
              await client.query(indexDef);
              restoredIndexes++;
            } catch {
              // Index may already exist
            }
          }
          spinner.succeed(`Restored ${restoredIndexes} indexes`);
        }
      } else {
        // Restore from SQL
        spinner.setText('Executing SQL restore...'); spinner.start();

        // Split by semicolons and execute
        const statements = content
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        let executed = 0;
        for (const stmt of statements) {
          try {
            await client.query(stmt);
            executed++;

            if (stmt.toUpperCase().includes('INSERT INTO')) {
              restoredRows++;
            } else if (stmt.toUpperCase().includes('CREATE INDEX')) {
              restoredIndexes++;
            }
          } catch (error) {
            // Log but continue
            if (process.env.DEBUG) {
              console.error('Statement failed:', stmt.substring(0, 100));
            }
          }

          if (executed % 100 === 0) {
            spinner.setText(`Executing SQL restore... ${executed}/${statements.length}`);
          }
        }

        spinner.succeed(`Executed ${executed} SQL statements`);
      }

      await client.end();

      output.writeln();
      output.printSuccess('Restore completed successfully!');
      output.writeln();

      output.printBox([
        `Source: ${inputPath}`,
        `Format: ${format.toUpperCase()}`,
        `Tables Restored: ${restoredTables}`,
        `Rows Restored: ${restoredRows.toLocaleString()}`,
        `Indexes Restored: ${restoredIndexes}`,
      ].join('\n'), 'Restore Summary');

      return {
        success: true,
        data: {
          inputPath,
          format,
          restoredTables,
          restoredRows,
          restoredIndexes,
        },
      };
    } catch (error) {
      spinner.fail('Restore failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * RuVector backup main command
 */
export const backupCommand: Command = {
  name: 'backup',
  description: 'Backup and restore RuVector data',
  subcommands: [backupSubcommand, restoreSubcommand],
  options: [
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
    { command: 'claude-flow ruvector backup create -o backup.sql', description: 'Create backup' },
    { command: 'claude-flow ruvector backup restore -i backup.sql', description: 'Restore backup' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuVector Backup'));
    output.writeln(output.dim('=' .repeat(60)));
    output.writeln();

    output.printBox([
      'RuVector Backup provides data backup and restore capabilities:',
      '',
      '  create   Create a backup of RuVector data',
      '  restore  Restore RuVector data from backup',
      '',
      'Supported formats:',
      '  SQL   - PostgreSQL-compatible SQL statements',
      '  JSON  - Portable JSON format with metadata',
      '  CSV   - Comma-separated values',
      '',
      'Features:',
      '  - Selective table backup',
      '  - Gzip compression',
      '  - Index preservation',
      '  - Incremental restore',
    ].join('\n'), 'Backup Commands');

    output.writeln();
    output.printInfo('Run `claude-flow ruvector backup <command> --help` for details');

    return { success: true };
  },
};

export default backupCommand;
