/**
 * V3 CLI RuVector Init Command
 * Initialize RuVector PostgreSQL Bridge
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { confirm, input, select } from '../../prompt.js';

/**
 * Get PostgreSQL connection config from context flags and environment
 */
function getConnectionConfig(ctx: CommandContext): {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  schema: string;
} {
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
 * Initialize RuVector in PostgreSQL
 */
export const initCommand: Command = {
  name: 'init',
  description: 'Initialize RuVector in PostgreSQL',
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
      required: true,
    },
    {
      name: 'user',
      short: 'u',
      description: 'Database user',
      type: 'string',
      default: 'postgres',
    },
    {
      name: 'password',
      description: 'Database password (or use PGPASSWORD env)',
      type: 'string',
    },
    {
      name: 'ssl',
      description: 'Enable SSL connection',
      type: 'boolean',
      default: false,
    },
    {
      name: 'schema',
      short: 's',
      description: 'Schema name for RuVector tables',
      type: 'string',
      default: 'claude_flow',
    },
    {
      name: 'force',
      short: 'f',
      description: 'Force re-initialization (drops existing schema)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'dimensions',
      description: 'Default vector dimensions',
      type: 'number',
      default: 1536,
    },
    {
      name: 'index-type',
      description: 'Default index type (hnsw, ivfflat)',
      type: 'string',
      default: 'hnsw',
      choices: ['hnsw', 'ivfflat'],
    },
  ],
  examples: [
    { command: 'claude-flow ruvector init -d mydb', description: 'Initialize with database name' },
    { command: 'claude-flow ruvector init -d mydb -h db.example.com --ssl', description: 'Remote with SSL' },
    { command: 'claude-flow ruvector init -d mydb --force', description: 'Force re-initialization' },
    { command: 'claude-flow ruvector init -d mydb --dimensions 768', description: 'Custom vector dimensions' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let config = getConnectionConfig(ctx);

    output.writeln();
    output.writeln(output.bold('RuVector PostgreSQL Initialization'));
    output.writeln(output.dim('=' .repeat(60)));
    output.writeln();

    // Interactive mode if database not specified
    if (!config.database && ctx.interactive) {
      config.database = await input({
        message: 'Database name:',
        validate: (v) => v.length > 0 || 'Database name is required',
      });

      const useRemote = await confirm({
        message: 'Connect to remote PostgreSQL?',
        default: false,
      });

      if (useRemote) {
        config.host = await input({
          message: 'PostgreSQL host:',
          default: 'localhost',
        });
        config.port = parseInt(await input({
          message: 'PostgreSQL port:',
          default: '5432',
        }), 10);
        config.ssl = await confirm({
          message: 'Enable SSL?',
          default: true,
        });
      }

      config.user = await input({
        message: 'Database user:',
        default: 'postgres',
      });

      if (!config.password) {
        config.password = await input({
          message: 'Database password (or set PGPASSWORD):',
        });
      }
    }

    if (!config.database) {
      output.printError('Database name is required. Use --database or -d flag.');
      return { success: false, exitCode: 1 };
    }

    const force = ctx.flags.force as boolean;
    const dimensions = parseInt((ctx.flags.dimensions as string) || '1536', 10);
    const indexType = (ctx.flags['index-type'] as string) || 'hnsw';

    // Show configuration
    output.writeln(output.highlight('Connection Configuration:'));
    output.printTable({
      columns: [
        { key: 'setting', header: 'Setting', width: 20 },
        { key: 'value', header: 'Value', width: 40 },
      ],
      data: [
        { setting: 'Host', value: config.host },
        { setting: 'Port', value: String(config.port) },
        { setting: 'Database', value: config.database },
        { setting: 'User', value: config.user },
        { setting: 'SSL', value: config.ssl ? 'Enabled' : 'Disabled' },
        { setting: 'Schema', value: config.schema },
        { setting: 'Dimensions', value: String(dimensions) },
        { setting: 'Index Type', value: indexType.toUpperCase() },
      ],
    });

    output.writeln();

    if (force) {
      output.printWarning('Force mode: existing schema will be dropped!');
      if (ctx.interactive) {
        const confirmDrop = await confirm({
          message: `Drop and recreate schema "${config.schema}"?`,
          default: false,
        });
        if (!confirmDrop) {
          output.printInfo('Initialization cancelled');
          return { success: false, exitCode: 0 };
        }
      }
    }

    const spinner = output.createSpinner({ text: 'Connecting to PostgreSQL...', spinner: 'dots' });
    spinner.start();

    try {
      // Check for pg module
      let pg: typeof import('pg') | null = null;
      try {
        pg = await import('pg');
      } catch {
        spinner.fail('PostgreSQL driver not found');
        output.printError('Install pg package: npm install pg');
        return { success: false, exitCode: 1 };
      }

      // Connect to PostgreSQL
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

      // Check pgvector extension
      spinner.setText('Checking pgvector extension...'); spinner.start();
      const extensionResult = await client.query(`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `);

      if (extensionResult.rows.length === 0) {
        spinner.succeed('pgvector not installed, attempting to create...');
        try {
          await client.query('CREATE EXTENSION IF NOT EXISTS vector');
          spinner.succeed('pgvector extension created');
        } catch (error) {
          spinner.fail('Failed to create pgvector extension');
          output.printError('Please install pgvector manually: https://github.com/pgvector/pgvector');
          await client.end();
          return { success: false, exitCode: 1 };
        }
      } else {
        spinner.succeed(`pgvector v${extensionResult.rows[0].extversion} found`);
      }

      // Drop schema if force mode
      if (force) {
        spinner.setText(`Dropping schema "${config.schema}"...`); spinner.start();
        await client.query(`DROP SCHEMA IF EXISTS ${config.schema} CASCADE`);
        spinner.succeed(`Schema "${config.schema}" dropped`);
      }

      // Create schema
      spinner.setText(`Creating schema "${config.schema}"...`); spinner.start();
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${config.schema}`);
      spinner.succeed(`Schema "${config.schema}" created`);

      // Create tables
      spinner.setText('Creating RuVector tables...'); spinner.start();

      // Vector embeddings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${config.schema}.embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          key VARCHAR(512) NOT NULL,
          namespace VARCHAR(128) NOT NULL DEFAULT 'default',
          content TEXT,
          embedding vector(${dimensions}),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(key, namespace)
        )
      `);

      // Attention patterns table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${config.schema}.attention_patterns (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          pattern_name VARCHAR(256) NOT NULL,
          query_embedding vector(${dimensions}),
          key_embedding vector(${dimensions}),
          value_embedding vector(${dimensions}),
          attention_weights JSONB,
          context TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // GNN adjacency table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${config.schema}.gnn_edges (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_id UUID NOT NULL,
          target_id UUID NOT NULL,
          edge_type VARCHAR(64) NOT NULL DEFAULT 'related',
          weight FLOAT DEFAULT 1.0,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(source_id, target_id, edge_type)
        )
      `);

      // Hyperbolic embeddings table (Poincare ball)
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${config.schema}.hyperbolic_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity_id UUID NOT NULL,
          embedding vector(${dimensions}),
          curvature FLOAT DEFAULT -1.0,
          hierarchy_level INTEGER DEFAULT 0,
          parent_id UUID,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Migrations tracking table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${config.schema}.migrations (
          id SERIAL PRIMARY KEY,
          version VARCHAR(64) NOT NULL UNIQUE,
          name VARCHAR(256) NOT NULL,
          applied_at TIMESTAMPTZ DEFAULT NOW(),
          checksum VARCHAR(64)
        )
      `);

      // RuVector metadata table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${config.schema}.metadata (
          key VARCHAR(128) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Store initialization metadata
      await client.query(`
        INSERT INTO ${config.schema}.metadata (key, value)
        VALUES ('ruvector_version', '"1.0.0"')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `);

      await client.query(`
        INSERT INTO ${config.schema}.metadata (key, value)
        VALUES ('dimensions', '${dimensions}')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `);

      await client.query(`
        INSERT INTO ${config.schema}.metadata (key, value)
        VALUES ('initialized_at', '"${new Date().toISOString()}"')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `);

      spinner.succeed('RuVector tables created');

      // Create indexes
      spinner.setText(`Creating ${indexType.toUpperCase()} indexes...`); spinner.start();

      if (indexType === 'hnsw') {
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_embeddings_vector_hnsw
          ON ${config.schema}.embeddings
          USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_attention_query_hnsw
          ON ${config.schema}.attention_patterns
          USING hnsw (query_embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_hyperbolic_embedding_hnsw
          ON ${config.schema}.hyperbolic_embeddings
          USING hnsw (embedding vector_cosine_ops)
          WITH (m = 16, ef_construction = 64)
        `);
      } else {
        // IVFFlat indexes
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_embeddings_vector_ivfflat
          ON ${config.schema}.embeddings
          USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 100)
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_attention_query_ivfflat
          ON ${config.schema}.attention_patterns
          USING ivfflat (query_embedding vector_cosine_ops)
          WITH (lists = 100)
        `);
      }

      // Additional standard indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_embeddings_namespace
        ON ${config.schema}.embeddings (namespace)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_embeddings_key
        ON ${config.schema}.embeddings (key)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gnn_source
        ON ${config.schema}.gnn_edges (source_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gnn_target
        ON ${config.schema}.gnn_edges (target_id)
      `);

      spinner.succeed(`${indexType.toUpperCase()} indexes created`);

      // Record initial migration
      await client.query(`
        INSERT INTO ${config.schema}.migrations (version, name)
        VALUES ('1.0.0', 'Initial RuVector setup')
        ON CONFLICT (version) DO NOTHING
      `);

      await client.end();

      output.writeln();
      output.printSuccess('RuVector PostgreSQL Bridge initialized successfully!');
      output.writeln();

      output.printBox([
        'Created tables:',
        `  - ${config.schema}.embeddings (vector storage)`,
        `  - ${config.schema}.attention_patterns (attention mechanism)`,
        `  - ${config.schema}.gnn_edges (graph pattern network)`,
        `  - ${config.schema}.hyperbolic_embeddings (Poincare ball)`,
        `  - ${config.schema}.migrations (version tracking)`,
        `  - ${config.schema}.metadata (configuration)`,
        '',
        'Created indexes:',
        `  - ${indexType.toUpperCase()} vector similarity index`,
        '  - B-tree indexes on key, namespace',
        '  - GNN edge indexes',
        '',
        'Next steps:',
        '  1. Run migrations: claude-flow ruvector migrate --up',
        '  2. Check status: claude-flow ruvector status --verbose',
        '  3. Run benchmark: claude-flow ruvector benchmark',
      ].join('\n'), 'Initialization Complete');

      return {
        success: true,
        data: {
          schema: config.schema,
          dimensions,
          indexType,
          tables: ['embeddings', 'attention_patterns', 'gnn_edges', 'hyperbolic_embeddings', 'migrations', 'metadata'],
        },
      };
    } catch (error) {
      spinner.fail('Initialization failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

export default initCommand;
