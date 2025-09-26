/**
 * Memory Migration Utility
 *
 * Helps migrate from old CollectiveMemory to new SharedMemory/SwarmMemory
 *
 * @module memory/migration
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { SharedMemory } from './shared-memory.js';
import { SwarmMemory } from './swarm-memory.js';
import { getProjectRoot, getSwarmDir, getHiveMindDir } from '../utils/project-root.js';

export class MemoryMigration {
  constructor(options = {}) {
    this.options = {
      oldDbPath: path.join(getHiveMindDir(), 'hive.db'),
      newDbPath: path.join(getHiveMindDir(), 'memory.db'),
      swarmDbPath: path.join(getSwarmDir(), 'swarm-memory.db'),
      dryRun: options.dryRun || false,
      verbose: options.verbose || false,
      ...options,
    };

    this.stats = {
      total: 0,
      migrated: 0,
      skipped: 0,
      errors: 0,
    };
  }

  /**
   * Run the migration
   */
  async migrate() {
    console.log('Starting memory migration...');

    try {
      // Check if old database exists
      const oldDbExists = await this._fileExists(this.options.oldDbPath);
      if (!oldDbExists) {
        console.log('No old database found. Nothing to migrate.');
        return { success: true, stats: this.stats };
      }

      // Initialize new memory systems
      const sharedMemory = new SharedMemory({
        directory: path.dirname(this.options.newDbPath),
        filename: path.basename(this.options.newDbPath),
      });

      const swarmMemory = new SwarmMemory({
        directory: path.dirname(this.options.swarmDbPath),
        filename: path.basename(this.options.swarmDbPath),
      });

      if (!this.options.dryRun) {
        await sharedMemory.initialize();
        await swarmMemory.initialize();
      }

      // Open old database
      const oldDb = new Database(this.options.oldDbPath, { readonly: true });

      // Migrate collective_memory table
      await this._migrateCollectiveMemory(oldDb, sharedMemory);

      // Migrate memory table
      await this._migrateMemoryTable(oldDb, sharedMemory);

      // Migrate swarm-specific data
      await this._migrateSwarmData(oldDb, swarmMemory);

      // Close connections
      oldDb.close();

      if (!this.options.dryRun) {
        await sharedMemory.close();
        await swarmMemory.close();
      }

      console.log('\nMigration completed!');
      console.log(`Total entries: ${this.stats.total}`);
      console.log(`Migrated: ${this.stats.migrated}`);
      console.log(`Skipped: ${this.stats.skipped}`);
      console.log(`Errors: ${this.stats.errors}`);

      return {
        success: true,
        stats: this.stats,
      };
    } catch (error) {
      console.error('Migration failed:', error);
      return {
        success: false,
        error: error.message,
        stats: this.stats,
      };
    }
  }

  /**
   * Migrate collective_memory table
   */
  async _migrateCollectiveMemory(oldDb, sharedMemory) {
    console.log('\nMigrating collective_memory entries...');

    try {
      const rows = oldDb
        .prepare(
          `
        SELECT * FROM collective_memory 
        ORDER BY created_at ASC
      `,
        )
        .all();

      for (const row of rows) {
        this.stats.total++;

        try {
          // Parse the swarm_id from the key if needed
          const keyParts = row.key.split(':');
          const namespace = this._determineNamespace(row.type);

          // Prepare value
          let value = row.value;
          if (row.compressed) {
            // Handle compressed data if needed
            value = JSON.parse(value);
          }

          if (this.options.dryRun) {
            if (this.options.verbose) {
              console.log(`Would migrate: ${row.key} -> ${namespace}`);
            }
          } else {
            await sharedMemory.store(row.key, value, {
              namespace,
              ttl: this._calculateTTL(row.type),
              metadata: {
                originalId: row.id,
                swarmId: row.swarm_id,
                createdBy: row.created_by,
                confidence: row.confidence,
                migratedAt: new Date().toISOString(),
              },
            });
          }

          this.stats.migrated++;
        } catch (error) {
          console.error(`Error migrating ${row.key}:`, error.message);
          this.stats.errors++;
        }

        // Progress indicator
        if (this.stats.total % 100 === 0) {
          process.stdout.write('.');
        }
      }
    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log('collective_memory table not found, skipping...');
      } else {
        throw error;
      }
    }
  }

  /**
   * Migrate memory table (from hive-mind schema)
   */
  async _migrateMemoryTable(oldDb, sharedMemory) {
    console.log('\n\nMigrating memory table entries...');

    try {
      const rows = oldDb
        .prepare(
          `
        SELECT * FROM memory 
        ORDER BY created_at ASC
      `,
        )
        .all();

      for (const row of rows) {
        this.stats.total++;

        try {
          if (this.options.dryRun) {
            if (this.options.verbose) {
              console.log(`Would migrate: ${row.key} (${row.namespace})`);
            }
          } else {
            await sharedMemory.store(row.key, row.value, {
              namespace: row.namespace,
              ttl: row.ttl,
              metadata: row.metadata ? JSON.parse(row.metadata) : null,
            });
          }

          this.stats.migrated++;
        } catch (error) {
          console.error(`Error migrating ${row.key}:`, error.message);
          this.stats.errors++;
        }

        // Progress indicator
        if (this.stats.total % 100 === 0) {
          process.stdout.write('.');
        }
      }
    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log('memory table not found, skipping...');
      } else {
        throw error;
      }
    }
  }

  /**
   * Migrate swarm-specific data
   */
  async _migrateSwarmData(oldDb, swarmMemory) {
    console.log('\n\nMigrating swarm-specific data...');

    // Migrate agents
    await this._migrateAgents(oldDb, swarmMemory);

    // Migrate tasks
    await this._migrateTasks(oldDb, swarmMemory);

    // Migrate neural patterns
    await this._migratePatterns(oldDb, swarmMemory);

    // Migrate consensus data
    await this._migrateConsensus(oldDb, swarmMemory);
  }

  /**
   * Migrate agents table
   */
  async _migrateAgents(oldDb, swarmMemory) {
    try {
      const agents = oldDb
        .prepare(
          `
        SELECT * FROM agents
      `,
        )
        .all();

      console.log(`\nMigrating ${agents.length} agents...`);

      for (const agent of agents) {
        if (!this.options.dryRun) {
          await swarmMemory.storeAgent(agent.id, {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            status: agent.status,
            capabilities: JSON.parse(agent.capabilities),
            currentTaskId: agent.current_task_id,
            messageCount: agent.message_count,
            errorCount: agent.error_count,
            successCount: agent.success_count,
            createdAt: agent.created_at,
            lastActiveAt: agent.last_active_at,
            metadata: agent.metadata ? JSON.parse(agent.metadata) : {},
          });
        }
        this.stats.migrated++;
      }
    } catch (error) {
      if (!error.message.includes('no such table')) {
        console.error('Error migrating agents:', error.message);
      }
    }
  }

  /**
   * Migrate tasks table
   */
  async _migrateTasks(oldDb, swarmMemory) {
    try {
      const tasks = oldDb
        .prepare(
          `
        SELECT * FROM tasks
      `,
        )
        .all();

      console.log(`\nMigrating ${tasks.length} tasks...`);

      for (const task of tasks) {
        if (!this.options.dryRun) {
          await swarmMemory.storeTask(task.id, {
            id: task.id,
            description: task.description,
            priority: task.priority,
            strategy: task.strategy,
            status: task.status,
            progress: task.progress,
            result: task.result ? JSON.parse(task.result) : null,
            error: task.error,
            dependencies: task.dependencies ? JSON.parse(task.dependencies) : [],
            assignedAgents: task.assigned_agents ? JSON.parse(task.assigned_agents) : [],
            requireConsensus: !!task.require_consensus,
            consensusAchieved: !!task.consensus_achieved,
            maxAgents: task.max_agents,
            requiredCapabilities: task.required_capabilities
              ? JSON.parse(task.required_capabilities)
              : [],
            createdAt: task.created_at,
            assignedAt: task.assigned_at,
            startedAt: task.started_at,
            completedAt: task.completed_at,
            metadata: task.metadata ? JSON.parse(task.metadata) : {},
          });
        }
        this.stats.migrated++;
      }
    } catch (error) {
      if (!error.message.includes('no such table')) {
        console.error('Error migrating tasks:', error.message);
      }
    }
  }

  /**
   * Migrate neural patterns
   */
  async _migratePatterns(oldDb, swarmMemory) {
    try {
      const patterns = oldDb
        .prepare(
          `
        SELECT * FROM neural_patterns
      `,
        )
        .all();

      console.log(`\nMigrating ${patterns.length} neural patterns...`);

      for (const pattern of patterns) {
        if (!this.options.dryRun) {
          await swarmMemory.storePattern(pattern.id, {
            id: pattern.id,
            type: pattern.pattern_type,
            data: JSON.parse(pattern.pattern_data),
            confidence: pattern.confidence,
            usageCount: pattern.usage_count,
            successRate: pattern.success_rate,
            createdAt: pattern.created_at,
            lastUsedAt: pattern.last_used_at,
            metadata: pattern.metadata ? JSON.parse(pattern.metadata) : {},
          });
        }
        this.stats.migrated++;
      }
    } catch (error) {
      if (!error.message.includes('no such table')) {
        console.error('Error migrating patterns:', error.message);
      }
    }
  }

  /**
   * Migrate consensus data
   */
  async _migrateConsensus(oldDb, swarmMemory) {
    try {
      const consensus = oldDb
        .prepare(
          `
        SELECT * FROM consensus
      `,
        )
        .all();

      console.log(`\nMigrating ${consensus.length} consensus records...`);

      for (const record of consensus) {
        if (!this.options.dryRun) {
          await swarmMemory.storeConsensus(record.id, {
            id: record.id,
            taskId: record.task_id,
            proposal: JSON.parse(record.proposal),
            threshold: record.required_threshold,
            currentVotes: record.current_votes,
            totalVoters: record.total_voters,
            votes: JSON.parse(record.votes),
            status: record.status,
            createdAt: record.created_at,
            deadlineAt: record.deadline_at,
            completedAt: record.completed_at,
          });
        }
        this.stats.migrated++;
      }
    } catch (error) {
      if (!error.message.includes('no such table')) {
        console.error('Error migrating consensus:', error.message);
      }
    }
  }

  /**
   * Helper methods
   */

  _determineNamespace(type) {
    const typeMap = {
      knowledge: 'hive:knowledge',
      context: 'hive:context',
      task: 'hive:task',
      result: 'hive:result',
      error: 'hive:error',
      metric: 'hive:metric',
      consensus: 'hive:consensus',
      system: 'hive:system',
    };

    return typeMap[type] || 'default';
  }

  _calculateTTL(type) {
    const ttlMap = {
      context: 3600, // 1 hour
      task: 1800, // 30 minutes
      error: 86400, // 24 hours
      metric: 3600, // 1 hour
    };

    return ttlMap[type] || null;
  }

  async _fileExists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * CLI interface for migration
 */
export async function runMigration(options = {}) {
  const migration = new MemoryMigration(options);
  return await migration.migrate();
}

// Export default
export default MemoryMigration;
