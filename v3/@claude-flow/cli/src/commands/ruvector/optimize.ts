/**
 * V3 CLI RuVector Optimize Command
 * Optimization analysis and recommendations
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { confirm, select } from '../../prompt.js';

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
 * Optimization recommendation
 */
interface Recommendation {
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  issue: string;
  recommendation: string;
  sql?: string;
  impact: string;
}

/**
 * RuVector optimize command
 */
export const optimizeCommand: Command = {
  name: 'optimize',
  description: 'Optimization analysis and recommendations',
  options: [
    {
      name: 'analyze',
      short: 'a',
      description: 'Analyze current performance',
      type: 'boolean',
      default: true,
    },
    {
      name: 'apply',
      description: 'Apply suggested optimizations',
      type: 'boolean',
      default: false,
    },
    {
      name: 'index',
      short: 'i',
      description: 'Optimize specific index',
      type: 'string',
    },
    {
      name: 'vacuum',
      description: 'Run VACUUM ANALYZE',
      type: 'boolean',
      default: false,
    },
    {
      name: 'reindex',
      description: 'Rebuild indexes',
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
    { command: 'claude-flow ruvector optimize --analyze', description: 'Analyze and show recommendations' },
    { command: 'claude-flow ruvector optimize --apply', description: 'Apply optimizations' },
    { command: 'claude-flow ruvector optimize --vacuum', description: 'Run VACUUM ANALYZE' },
    { command: 'claude-flow ruvector optimize --reindex', description: 'Rebuild all indexes' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const config = getConnectionConfig(ctx);
    const applyOptimizations = ctx.flags.apply as boolean;
    const runVacuum = ctx.flags.vacuum as boolean;
    const runReindex = ctx.flags.reindex as boolean;
    const specificIndex = ctx.flags.index as string;

    output.writeln();
    output.writeln(output.bold('RuVector Optimization Analysis'));
    output.writeln(output.dim('=' .repeat(60)));
    output.writeln();

    if (!config.database) {
      output.printError('Database name is required. Use --database or -d flag, or set PGDATABASE env.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Connecting to PostgreSQL...', spinner: 'dots' });
    spinner.start();

    const recommendations: Recommendation[] = [];

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

      // Check schema exists
      const schemaResult = await client.query(`
        SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1
      `, [config.schema]);

      if (schemaResult.rows.length === 0) {
        output.printError(`Schema "${config.schema}" not found`);
        await client.end();
        return { success: false, exitCode: 1 };
      }

      // Run VACUUM if requested
      if (runVacuum) {
        spinner.setText('Running VACUUM ANALYZE...'); spinner.start();

        const tables = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        `, [config.schema]);

        for (const row of tables.rows) {
          await client.query(`VACUUM ANALYZE ${config.schema}.${row.table_name}`);
        }

        spinner.succeed('VACUUM ANALYZE completed');
      }

      // Rebuild indexes if requested
      if (runReindex) {
        spinner.setText('Rebuilding indexes...'); spinner.start();

        if (specificIndex) {
          await client.query(`REINDEX INDEX ${config.schema}.${specificIndex}`);
          spinner.succeed(`Index ${specificIndex} rebuilt`);
        } else {
          await client.query(`REINDEX SCHEMA ${config.schema}`);
          spinner.succeed('All indexes rebuilt');
        }
      }

      // Analyze table statistics
      spinner.setText('Analyzing table statistics...'); spinner.start();

      const tableStatsResult = await client.query(`
        SELECT
          relname as table_name,
          n_live_tup as live_rows,
          n_dead_tup as dead_rows,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze
        FROM pg_stat_user_tables
        WHERE schemaname = $1
      `, [config.schema]);

      for (const row of tableStatsResult.rows) {
        const deadRatio = row.live_rows > 0 ? row.dead_rows / row.live_rows : 0;

        // Check for high dead tuple ratio
        if (deadRatio > 0.1) {
          recommendations.push({
            category: 'Table Bloat',
            priority: deadRatio > 0.3 ? 'critical' : 'high',
            issue: `Table "${row.table_name}" has ${(deadRatio * 100).toFixed(1)}% dead tuples`,
            recommendation: 'Run VACUUM to reclaim space',
            sql: `VACUUM ANALYZE ${config.schema}.${row.table_name}`,
            impact: 'Reduces storage and improves query performance',
          });
        }

        // Check for missing statistics
        if (!row.last_analyze && !row.last_autoanalyze) {
          recommendations.push({
            category: 'Statistics',
            priority: 'medium',
            issue: `Table "${row.table_name}" has never been analyzed`,
            recommendation: 'Run ANALYZE to collect statistics',
            sql: `ANALYZE ${config.schema}.${row.table_name}`,
            impact: 'Improves query planner decisions',
          });
        }
      }

      spinner.succeed('Table statistics analyzed');

      // Analyze indexes
      spinner.setText('Analyzing index health...'); spinner.start();

      const indexStatsResult = await client.query(`
        SELECT
          i.relname as index_name,
          t.relname as table_name,
          am.amname as index_type,
          pg_relation_size(i.oid) as index_size,
          idx.indisvalid as is_valid,
          idx.indisready as is_ready,
          idx.indislive as is_live,
          pg_stat_user_indexes.idx_scan as scans,
          pg_stat_user_indexes.idx_tup_read as tuples_read,
          pg_stat_user_indexes.idx_tup_fetch as tuples_fetched
        FROM pg_index idx
        JOIN pg_class i ON i.oid = idx.indexrelid
        JOIN pg_class t ON t.oid = idx.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_am am ON am.oid = i.relam
        LEFT JOIN pg_stat_user_indexes ON pg_stat_user_indexes.indexrelid = i.oid
        WHERE n.nspname = $1
      `, [config.schema]);

      for (const row of indexStatsResult.rows) {
        // Check for invalid indexes
        if (!row.is_valid) {
          recommendations.push({
            category: 'Index Health',
            priority: 'critical',
            issue: `Index "${row.index_name}" is invalid`,
            recommendation: 'Rebuild the index',
            sql: `REINDEX INDEX ${config.schema}.${row.index_name}`,
            impact: 'Index is not being used for queries',
          });
        }

        // Check for unused indexes (skip vector indexes as they may be new)
        if (row.scans === 0 && row.index_type !== 'hnsw' && row.index_type !== 'ivfflat') {
          const sizeKB = parseInt(row.index_size, 10) / 1024;
          if (sizeKB > 100) {
            recommendations.push({
              category: 'Unused Index',
              priority: 'low',
              issue: `Index "${row.index_name}" has never been used (${(sizeKB / 1024).toFixed(2)} MB)`,
              recommendation: 'Consider dropping if not needed',
              sql: `-- DROP INDEX IF EXISTS ${config.schema}.${row.index_name}`,
              impact: 'Reduces storage and write overhead',
            });
          }
        }
      }

      spinner.succeed('Index health analyzed');

      // Analyze vector index parameters
      spinner.setText('Analyzing vector index configuration...'); spinner.start();

      const vectorIndexes = indexStatsResult.rows.filter(
        r => r.index_type === 'hnsw' || r.index_type === 'ivfflat'
      );

      for (const idx of vectorIndexes) {
        // Get index options
        const optionsResult = await client.query(`
          SELECT reloptions FROM pg_class
          WHERE relname = $1 AND relnamespace = (
            SELECT oid FROM pg_namespace WHERE nspname = $2
          )
        `, [idx.index_name, config.schema]);

        const options = optionsResult.rows[0]?.reloptions || [];

        if (idx.index_type === 'hnsw') {
          // Check HNSW parameters
          const m = options.find((o: string) => o.startsWith('m='));
          const efConstruction = options.find((o: string) => o.startsWith('ef_construction='));

          const mValue = m ? parseInt(m.split('=')[1], 10) : 16;
          const efValue = efConstruction ? parseInt(efConstruction.split('=')[1], 10) : 64;

          // Get table row count
          const countResult = await client.query(`
            SELECT count(*) as cnt FROM ${config.schema}.${idx.table_name}
          `);
          const rowCount = parseInt(countResult.rows[0].cnt, 10);

          // Recommend higher ef_construction for large datasets
          if (rowCount > 100000 && efValue < 100) {
            recommendations.push({
              category: 'HNSW Tuning',
              priority: 'medium',
              issue: `HNSW index "${idx.index_name}" has ef_construction=${efValue} for ${rowCount.toLocaleString()} vectors`,
              recommendation: 'Consider rebuilding with higher ef_construction for better recall',
              sql: `-- Rebuild with: CREATE INDEX ... WITH (m = ${mValue}, ef_construction = 128)`,
              impact: 'Improves recall at slight build time cost',
            });
          }

          // Recommend higher m for very large datasets
          if (rowCount > 1000000 && mValue < 24) {
            recommendations.push({
              category: 'HNSW Tuning',
              priority: 'medium',
              issue: `HNSW index "${idx.index_name}" has m=${mValue} for ${rowCount.toLocaleString()} vectors`,
              recommendation: 'Consider rebuilding with higher m for better connectivity',
              sql: `-- Rebuild with: CREATE INDEX ... WITH (m = 24, ef_construction = ${efValue})`,
              impact: 'Improves recall and query performance',
            });
          }
        }

        if (idx.index_type === 'ivfflat') {
          // Check IVFFlat lists parameter
          const lists = options.find((o: string) => o.startsWith('lists='));
          const listsValue = lists ? parseInt(lists.split('=')[1], 10) : 100;

          // Get table row count
          const countResult = await client.query(`
            SELECT count(*) as cnt FROM ${config.schema}.${idx.table_name}
          `);
          const rowCount = parseInt(countResult.rows[0].cnt, 10);

          // Recommended lists = sqrt(n)
          const recommendedLists = Math.floor(Math.sqrt(rowCount));

          if (Math.abs(listsValue - recommendedLists) / recommendedLists > 0.5) {
            recommendations.push({
              category: 'IVFFlat Tuning',
              priority: 'medium',
              issue: `IVFFlat index "${idx.index_name}" has lists=${listsValue} (recommended: ~${recommendedLists})`,
              recommendation: 'Consider rebuilding with optimal lists parameter',
              sql: `-- Rebuild with: CREATE INDEX ... WITH (lists = ${recommendedLists})`,
              impact: 'Balances query speed and recall',
            });
          }
        }
      }

      spinner.succeed('Vector index configuration analyzed');

      // Check memory settings
      spinner.setText('Checking PostgreSQL settings...'); spinner.start();

      const settingsResult = await client.query(`
        SELECT name, setting, unit, context
        FROM pg_settings
        WHERE name IN (
          'shared_buffers', 'effective_cache_size', 'work_mem',
          'maintenance_work_mem', 'max_parallel_workers_per_gather'
        )
      `);

      const settings: Record<string, string> = {};
      for (const row of settingsResult.rows) {
        settings[row.name] = row.setting + (row.unit || '');
      }

      // Check work_mem for vector operations
      const workMemMB = parseInt(settings.work_mem || '4096', 10) / 1024;
      if (workMemMB < 64) {
        recommendations.push({
          category: 'Memory Settings',
          priority: 'medium',
          issue: `work_mem is ${workMemMB.toFixed(0)}MB (recommended: 64MB+ for vector ops)`,
          recommendation: 'Increase work_mem for better vector search performance',
          sql: `SET work_mem = '64MB'`,
          impact: 'Improves sorting and index build performance',
        });
      }

      // Check maintenance_work_mem for index building
      const maintMemMB = parseInt(settings.maintenance_work_mem || '65536', 10) / 1024;
      if (maintMemMB < 256) {
        recommendations.push({
          category: 'Memory Settings',
          priority: 'low',
          issue: `maintenance_work_mem is ${maintMemMB.toFixed(0)}MB`,
          recommendation: 'Increase for faster index builds',
          sql: `SET maintenance_work_mem = '256MB'`,
          impact: 'Faster VACUUM and index creation',
        });
      }

      spinner.succeed('PostgreSQL settings checked');

      await client.end();

      // Display recommendations
      output.writeln();

      if (recommendations.length === 0) {
        output.printSuccess('No optimization recommendations - your setup looks good!');
        output.writeln();

        output.printBox([
          'All tables have been analyzed',
          'Indexes are valid and properly configured',
          'Memory settings are adequate',
          '',
          'Tips for maintaining performance:',
          '  - Run VACUUM ANALYZE regularly',
          '  - Monitor dead tuple ratio',
          '  - Rebuild indexes after large batch inserts',
        ].join('\n'), 'Status: Optimal');

        return { success: true, data: { recommendations: [] } };
      }

      // Group by priority
      const critical = recommendations.filter(r => r.priority === 'critical');
      const high = recommendations.filter(r => r.priority === 'high');
      const medium = recommendations.filter(r => r.priority === 'medium');
      const low = recommendations.filter(r => r.priority === 'low');

      output.writeln(output.bold(`Found ${recommendations.length} optimization recommendations:`));
      output.writeln();

      // Display by priority
      const displayRecommendations = (recs: Recommendation[], label: string, color: (s: string) => string) => {
        if (recs.length === 0) return;

        output.writeln(color(`${label} Priority (${recs.length}):`));
        output.writeln();

        for (const rec of recs) {
          output.writeln(`  ${output.bold(rec.category)}: ${rec.issue}`);
          output.writeln(`    ${output.dim('Recommendation:')} ${rec.recommendation}`);
          output.writeln(`    ${output.dim('Impact:')} ${rec.impact}`);
          if (rec.sql) {
            output.writeln(`    ${output.dim('SQL:')} ${output.highlight(rec.sql)}`);
          }
          output.writeln();
        }
      };

      displayRecommendations(critical, 'CRITICAL', output.error.bind(output));
      displayRecommendations(high, 'HIGH', output.warning.bind(output));
      displayRecommendations(medium, 'MEDIUM', output.highlight.bind(output));
      displayRecommendations(low, 'LOW', output.dim.bind(output));

      // Apply optimizations if requested
      if (applyOptimizations && (critical.length > 0 || high.length > 0)) {
        output.writeln(output.dim('-'.repeat(60)));
        output.writeln();

        if (ctx.interactive) {
          const confirmApply = await confirm({
            message: `Apply ${critical.length + high.length} critical/high priority optimizations?`,
            default: false,
          });

          if (confirmApply) {
            const applyClient = new pg.Client({
              host: config.host,
              port: config.port,
              database: config.database,
              user: config.user,
              password: config.password,
              ssl: config.ssl ? { rejectUnauthorized: false } : false,
            });

            await applyClient.connect();

            for (const rec of [...critical, ...high]) {
              if (rec.sql && !rec.sql.startsWith('--')) {
                spinner.setText(`Applying: ${rec.issue}...`); spinner.start();
                try {
                  await applyClient.query(rec.sql);
                  spinner.succeed(`Applied: ${rec.category}`);
                } catch (error) {
                  spinner.fail(`Failed: ${rec.category}`);
                  output.printError(error instanceof Error ? error.message : String(error));
                }
              }
            }

            await applyClient.end();
            output.writeln();
            output.printSuccess('Optimizations applied');
          }
        }
      }

      // Summary
      output.printBox([
        `Total Recommendations: ${recommendations.length}`,
        `  Critical: ${critical.length}`,
        `  High: ${high.length}`,
        `  Medium: ${medium.length}`,
        `  Low: ${low.length}`,
        '',
        'Quick commands:',
        `  claude-flow ruvector optimize --vacuum    # Clean up tables`,
        `  claude-flow ruvector optimize --reindex  # Rebuild indexes`,
        `  claude-flow ruvector optimize --apply    # Apply critical fixes`,
      ].join('\n'), 'Optimization Summary');

      return {
        success: true,
        data: {
          recommendations,
          summary: {
            critical: critical.length,
            high: high.length,
            medium: medium.length,
            low: low.length,
          },
        },
      };
    } catch (error) {
      spinner.fail('Optimization analysis failed');
      output.printError(error instanceof Error ? error.message : String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

export default optimizeCommand;
