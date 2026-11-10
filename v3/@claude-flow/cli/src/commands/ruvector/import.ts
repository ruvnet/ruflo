/**
 * V3 CLI RuVector Import Command
 * Import data from sql.js/JSON memory to RuVector PostgreSQL
 *
 * Usage:
 *   npx claude-flow ruvector import --input memory-export.json
 *   npx claude-flow ruvector import --from-memory
 *   npx claude-flow ruvector import --input data.json --batch-size 100
 *
 * Created with care by ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import * as fs from 'fs';
import * as path from 'path';
import { validateTimestamp } from './pg-utils.js';

/**
 * Memory entry structure from sql.js/JSON export
 */
interface MemoryEntry {
  key: string;
  value: string | object;
  namespace?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  created_at?: string;
  updated_at?: string;
}

/**
 * Import statistics
 */
interface ImportStats {
  total: number;
  imported: number;
  skipped: number;
  errors: number;
  withEmbeddings: number;
  byNamespace: Record<string, number>;
}

/**
 * Format a ruvector embedding array for PostgreSQL
 * Validates each element is a finite number to prevent SQL injection via crafted arrays.
 */
function formatEmbedding(embedding: number[], dimensions: number = 384): string {
  // Validate every element is a finite number (prevents SQL injection via crafted JSON)
  for (let i = 0; i < embedding.length; i++) {
    if (typeof embedding[i] !== 'number' || !Number.isFinite(embedding[i])) {
      throw new Error(`Invalid embedding value at index ${i}: expected finite number, got ${typeof embedding[i]}`);
    }
  }

  // Ensure correct dimensions by padding or truncating
  const padded = [...embedding];
  while (padded.length < dimensions) {
    padded.push(0);
  }
  if (padded.length > dimensions) {
    padded.length = dimensions;
  }
  return `'[${padded.join(',')}]'::ruvector(${dimensions})`;
}

/**
 * Escape string for PostgreSQL
 */
function escapeString(str: string): string {
  return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

/**
 * Generate SQL INSERT statement for a memory entry
 */
function generateInsertSQL(entry: MemoryEntry): string {
  const key = escapeString(entry.key);
  const value = typeof entry.value === 'string'
    ? escapeString(entry.value)
    : escapeString(JSON.stringify(entry.value));
  const namespace = escapeString(entry.namespace || 'default');
  const metadata = entry.metadata ? escapeString(JSON.stringify(entry.metadata)) : '{}';

  let embeddingClause = 'NULL';
  if (entry.embedding && Array.isArray(entry.embedding) && entry.embedding.length > 0) {
    embeddingClause = formatEmbedding(entry.embedding);
  }

  // DA-HIGH-3: Validate timestamps to prevent SQL injection via crafted JSON
  const createdAt = entry.created_at
    ? `'${escapeString(validateTimestamp(String(entry.created_at)))}'::timestamptz`
    : 'NOW()';
  const updatedAt = entry.updated_at
    ? `'${escapeString(validateTimestamp(String(entry.updated_at)))}'::timestamptz`
    : 'NOW()';

  return `INSERT INTO claude_flow.memory_entries (key, value, embedding, namespace, metadata, created_at, updated_at)
VALUES (
  '${key}',
  '${value}',
  ${embeddingClause},
  '${namespace}',
  '${metadata}'::jsonb,
  ${createdAt},
  ${updatedAt}
)
ON CONFLICT (key, namespace) DO UPDATE SET
  value = EXCLUDED.value,
  embedding = COALESCE(EXCLUDED.embedding, claude_flow.memory_entries.embedding),
  metadata = EXCLUDED.metadata,
  updated_at = NOW();`;
}

/**
 * RuVector Import command - import from sql.js/JSON to PostgreSQL
 */
export const importCommand: Command = {
  name: 'import',
  description: 'Import data from sql.js/JSON memory to RuVector PostgreSQL',
  aliases: ['load', 'migrate-data'],
  options: [
    {
      name: 'input',
      short: 'i',
      description: 'Input JSON file path',
      type: 'string',
    },
    {
      name: 'from-memory',
      description: 'Export from current Claude-Flow memory and import',
      type: 'boolean',
      default: false,
    },
    {
      name: 'output',
      short: 'o',
      description: 'Output SQL file instead of executing (dry-run)',
      type: 'string',
    },
    {
      name: 'batch-size',
      short: 'b',
      description: 'Batch size for imports',
      type: 'number',
      default: 100,
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
      default: 'claude_flow',
    },
    {
      name: 'user',
      short: 'u',
      description: 'Database user',
      type: 'string',
      default: 'claude',
    },
    {
      name: 'password',
      description: 'Database password (or use PGPASSWORD env var)',
      type: 'string',
    },
    {
      name: 'container',
      short: 'c',
      description: 'Docker container name to exec into',
      type: 'string',
      default: 'ruvector-postgres',
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Verbose output',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'claude-flow ruvector import --input memory-export.json', description: 'Import from JSON file' },
    { command: 'claude-flow ruvector import --input data.json --output import.sql', description: 'Generate SQL file (dry-run)' },
    { command: 'claude-flow ruvector import --from-memory', description: 'Export current memory and import' },
    { command: 'claude-flow ruvector import --input data.json --container my-postgres', description: 'Import using custom container' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const inputFile = ctx.flags.input as string | undefined;
    const fromMemory = (ctx.flags.fromMemory ?? ctx.flags['from-memory']) as boolean;
    const outputFile = ctx.flags.output as string | undefined;
    const batchSizeFlag = ctx.flags.batchSize ?? ctx.flags['batch-size'] ?? 100;
    const batchSize = typeof batchSizeFlag === 'string' ? Number(batchSizeFlag) : batchSizeFlag;
    const containerName = (ctx.flags.container as string) || 'ruvector-postgres';
    const verbose = ctx.flags.verbose as boolean;

    output.writeln();
    output.writeln(output.bold('RuVector PostgreSQL Import'));
    output.writeln(output.dim('=' .repeat(50)));
    output.writeln();

    if (typeof batchSize !== 'number' || !Number.isSafeInteger(batchSize) || batchSize < 1) {
      const message = '--batch-size must be a positive integer';
      output.printError(message);
      return { success: false, message };
    }

    // Validate input
    if (!inputFile && !fromMemory) {
      output.printError('Either --input <file> or --from-memory is required');
      output.writeln();
      output.printInfo('Examples:');
      output.writeln('  claude-flow ruvector import --input memory-export.json');
      output.writeln('  claude-flow ruvector import --from-memory');
      return { success: false, message: 'Missing input source' };
    }

    let entries: MemoryEntry[] = [];

    // Load entries from JSON file
    if (inputFile) {
      if (!fs.existsSync(inputFile)) {
        output.printError(`Input file not found: ${inputFile}`);
        return { success: false, message: 'File not found' };
      }

      try {
        output.printInfo(`Reading: ${inputFile}`);
        const content = fs.readFileSync(inputFile, 'utf-8');
        const data = JSON.parse(content);

        // Handle different JSON formats
        if (Array.isArray(data)) {
          entries = data;
        } else if (data.entries && Array.isArray(data.entries)) {
          entries = data.entries;
        } else if (data.results && Array.isArray(data.results)) {
          entries = data.results;
        } else if (typeof data === 'object') {
          // Convert object format { key: value } to entries
          entries = Object.entries(data).map(([key, value]) => ({
            key,
            value: typeof value === 'object' ? JSON.stringify(value) : String(value),
          }));
        }

        output.printSuccess(`Loaded ${entries.length} entries from file`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.printError(`Failed to parse JSON: ${errorMessage}`);
        return { success: false, message: errorMessage };
      }
    }

    // Export from current memory
    if (fromMemory) {
      output.printInfo('Exporting from current Claude-Flow memory...');
      output.printWarning('Note: Run "npx claude-flow memory list --format json > memory-export.json" first');
      output.printInfo('Then use: npx claude-flow ruvector import --input memory-export.json');
      return { success: false, message: 'Use explicit JSON export first' };
    }

    if (entries.length === 0) {
      output.printWarning('No entries to import');
      return { success: true };
    }

    // Calculate statistics
    const stats: ImportStats = {
      total: entries.length,
      imported: 0,
      skipped: 0,
      errors: 0,
      withEmbeddings: 0,
      byNamespace: {},
    };

    // Generate SQL statements
    const sqlStatements: string[] = [];

    sqlStatements.push('-- RuVector PostgreSQL Import');
    sqlStatements.push(`-- Generated: ${new Date().toISOString()}`);
    sqlStatements.push(`-- Total entries: ${entries.length}`);
    sqlStatements.push('');
    sqlStatements.push('BEGIN;');
    sqlStatements.push('');

    const inserts: string[] = [];
    for (const entry of entries) {
      try {
        // Track statistics
        const ns = entry.namespace || 'default';
        stats.byNamespace[ns] = (stats.byNamespace[ns] || 0) + 1;

        if (entry.embedding && entry.embedding.length > 0) {
          stats.withEmbeddings++;
        }

        inserts.push(generateInsertSQL(entry));
        stats.imported++;

        if (verbose) {
          output.writeln(output.dim(`  Processed: ${entry.key} (${ns})`));
        }
      } catch (error) {
        stats.errors++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.printWarning(`Skipped entry "${entry.key}": ${errorMessage}`);
      }
    }

    // Send each batch as one statement while keeping ordered upserts in the same transaction.
    for (let offset = 0; offset < inserts.length; offset += batchSize) {
      const batch = inserts.slice(offset, offset + batchSize).join('\n\n');
      let tag = 'ruvector_batch';
      // A value containing the delimiter must stay inside the block.
      while (batch.includes(`$${tag}$`)) tag += '_';
      sqlStatements.push(`DO $${tag}$\nBEGIN\n${batch}\nEND;\n$${tag}$;`, '');
    }

    sqlStatements.push('COMMIT;');
    sqlStatements.push('');
    sqlStatements.push(`-- Import complete: ${stats.imported} entries`);

    const fullSQL = sqlStatements.join('\n');

    // Output SQL file (dry-run)
    if (outputFile) {
      try {
        output.printInfo(`Writing SQL to: ${outputFile}`);
        fs.writeFileSync(outputFile, fullSQL);
        output.printSuccess(`SQL file created: ${outputFile}`);

        output.writeln();
        output.printInfo('To execute the import:');
        output.writeln(`  docker exec -i ${containerName} psql -U claude -d claude_flow < ${outputFile}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.printError(`Failed to write SQL file: ${errorMessage}`);
        return { success: false, message: errorMessage };
      }
    } else {
      // Execute directly via docker exec
      output.printInfo(`Importing to PostgreSQL via container: ${containerName}`);
      output.writeln();

      // Write to temp file for execution
      const tempFile = path.join(process.cwd(), '.ruvector-import-temp.sql');
      try {
        fs.writeFileSync(tempFile, fullSQL);

        output.printInfo('Executing import...');
        output.writeln();
        output.writeln(output.dim('Command:'));
        output.writeln(output.dim(`  docker exec -i ${containerName} psql -U claude -d claude_flow < ${tempFile}`));
        output.writeln();

        // Execute via child_process (CRIT-02: use execFileSync to prevent command injection)
        const { execFileSync } = await import('child_process');

        // Validate containerName: alphanumeric, hyphens, underscores, dots only
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
          throw new Error(`Invalid container name: ${containerName}`);
        }

        try {
          const sqlContent = fs.readFileSync(tempFile, 'utf-8');
          const result = execFileSync('docker', [
            'exec', '-i', containerName,
            'psql', '-U', 'claude', '-d', 'claude_flow',
          ], {
            encoding: 'utf-8',
            timeout: 60000,
            input: sqlContent,
          });

          if (verbose) {
            output.writeln(output.dim(result));
          }

          output.printSuccess('Import completed successfully!');
        } catch (execError) {
          const execErrorMessage = execError instanceof Error ? execError.message : String(execError);
          output.printError(`Import failed: ${execErrorMessage}`);
          output.writeln();
          output.printInfo('You can manually run the import with:');
          output.writeln(`  docker exec -i ${containerName} psql -U claude -d claude_flow < ${tempFile}`);
          return { success: false, message: execErrorMessage };
        } finally {
          // Clean up temp file
          try {
            fs.unlinkSync(tempFile);
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.printError(`Failed to create temp file: ${errorMessage}`);
        return { success: false, message: errorMessage };
      }
    }

    // Print statistics
    output.writeln();
    output.printBox([
      'Import Statistics',
      '',
      `  Total entries:     ${stats.total}`,
      `  Imported:          ${stats.imported}`,
      `  With embeddings:   ${stats.withEmbeddings}`,
      `  Errors:            ${stats.errors}`,
      '',
      'By Namespace:',
      ...Object.entries(stats.byNamespace).map(([ns, count]) => `  ${ns}: ${count}`),
    ].join('\n'), 'Import Complete');

    output.writeln();

    // Show verification command
    output.printInfo('To verify the import:');
    output.writeln(`  docker exec ${containerName} psql -U claude -d claude_flow -c "SELECT COUNT(*) FROM claude_flow.memory_entries;"`);
    output.writeln();

    return { success: true };
  },
};

export default importCommand;
