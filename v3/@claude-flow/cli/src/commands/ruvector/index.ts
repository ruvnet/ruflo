/**
 * V3 CLI RuVector PostgreSQL Bridge Command
 * Management commands for RuVector PostgreSQL integration
 *
 * Features:
 * - pgvector integration for vector operations
 * - Attention mechanism embeddings
 * - Graph Neural Network support
 * - Hyperbolic embeddings (Poincare ball)
 * - Performance benchmarking
 * - Migration management
 *
 * Created with care by ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// Import subcommands
import { initCommand } from './init.js';
import { migrateCommand } from './migrate.js';
import { statusCommand } from './status.js';
import { benchmarkCommand } from './benchmark.js';
import { optimizeCommand } from './optimize.js';
import { backupCommand } from './backup.js';
import { setupCommand } from './setup.js';
import { importCommand } from './import.js';

/**
 * RuVector PostgreSQL Bridge main command
 */
export const ruvectorCommand: Command = {
  name: 'ruvector',
  description: 'RuVector PostgreSQL Bridge management',
  aliases: ['rv', 'pgvector'],
  subcommands: [
    initCommand,
    setupCommand,
    importCommand,
    migrateCommand,
    statusCommand,
    benchmarkCommand,
    optimizeCommand,
    backupCommand,
  ],
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
      name: 'schema',
      short: 's',
      description: 'Schema name',
      type: 'string',
      default: 'claude_flow',
    },
  ],
  examples: [
    { command: 'claude-flow ruvector setup', description: 'Output Docker files and SQL for setup' },
    { command: 'claude-flow ruvector import --input memory.json', description: 'Import from sql.js/JSON export' },
    { command: 'claude-flow ruvector init --database mydb', description: 'Initialize RuVector in PostgreSQL' },
    { command: 'claude-flow ruvector status --verbose', description: 'Check connection and schema status' },
    { command: 'claude-flow ruvector migrate --up', description: 'Run pending migrations' },
    { command: 'claude-flow ruvector benchmark --vectors 10000', description: 'Run performance benchmark' },
    { command: 'claude-flow ruvector optimize --analyze', description: 'Analyze and suggest optimizations' },
    { command: 'claude-flow ruvector backup --output backup.sql', description: 'Backup RuVector data' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    // Default action: show help/status overview
    output.writeln();
    output.writeln(output.bold('RuVector PostgreSQL Bridge'));
    output.writeln(output.dim('=' .repeat(60)));
    output.writeln();

    output.printBox([
      'RuVector provides PostgreSQL integration for Claude Flow with:',
      '',
      '  - pgvector extension for vector operations',
      '  - Attention mechanism embeddings',
      '  - Graph Neural Network (GNN) support',
      '  - Hyperbolic embeddings (Poincare ball model)',
      '  - HNSW indexing (optimized)',
      '',
      'Available subcommands:',
      '',
      '  setup      Output Docker files and SQL for setup',
      '  import     Import from sql.js/JSON to PostgreSQL',
      '  init       Initialize RuVector in PostgreSQL',
      '  migrate    Run database migrations',
      '  status     Check connection and schema status',
      '  benchmark  Run performance benchmarks',
      '  optimize   Analyze and optimize performance',
      '  backup     Backup and restore data',
    ].join('\n'), 'RuVector PostgreSQL Bridge');

    output.writeln();
    output.printInfo('Run `claude-flow ruvector <command> --help` for details');
    output.writeln();

    return { success: true };
  },
};

export default ruvectorCommand;

// Re-export subcommands for direct access
export { initCommand } from './init.js';
export { setupCommand } from './setup.js';
export { importCommand } from './import.js';
export { migrateCommand } from './migrate.js';
export { statusCommand } from './status.js';
export { benchmarkCommand } from './benchmark.js';
export { optimizeCommand } from './optimize.js';
export { backupCommand } from './backup.js';
