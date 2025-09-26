import Database from 'better-sqlite3';
import chalk from 'chalk';
import ora from 'ora';
export async function optimizeHiveMindDatabase(dbPath, options = {}) {
    const spinner = ora('Optimizing Hive Mind database...').start();
    try {
        const db = new Database(dbPath, {
            verbose: options.verbose ? console.log : null
        });
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        const schemaVersion = getSchemaVersion(db);
        spinner.text = `Current schema version: ${schemaVersion}`;
        let optimizationsApplied = [];
        if (schemaVersion < 1.1) {
            spinner.text = 'Applying performance indexes...';
            applyBasicIndexes(db);
            optimizationsApplied.push('Basic performance indexes');
        }
        if (schemaVersion < 1.2) {
            spinner.text = 'Applying advanced indexes...';
            applyAdvancedIndexes(db);
            optimizationsApplied.push('Advanced query optimization');
        }
        if (schemaVersion < 1.3) {
            spinner.text = 'Adding performance tracking...';
            addPerformanceTracking(db);
            optimizationsApplied.push('Performance monitoring tables');
        }
        if (schemaVersion < 1.4) {
            spinner.text = 'Optimizing memory management...';
            addMemoryOptimization(db);
            optimizationsApplied.push('Memory optimization features');
        }
        if (schemaVersion < 1.5) {
            spinner.text = 'Adding behavioral analysis...';
            addBehavioralTracking(db);
            optimizationsApplied.push('Behavioral pattern tracking');
        }
        spinner.text = 'Updating query statistics...';
        db.exec('ANALYZE');
        if (options.vacuum) {
            spinner.text = 'Vacuuming database...';
            db.exec('VACUUM');
            optimizationsApplied.push('Database vacuumed');
        }
        updateSchemaVersion(db, 1.5);
        db.close();
        spinner.succeed('Database optimization complete!');
        if (optimizationsApplied.length > 0) {
            console.log('\n' + chalk.green('✓') + ' Optimizations applied:');
            optimizationsApplied.forEach((opt)=>{
                console.log('  - ' + opt);
            });
        } else {
            console.log('\n' + chalk.yellow('ℹ') + ' Database already optimized');
        }
        return {
            success: true,
            optimizations: optimizationsApplied
        };
    } catch (error) {
        spinner.fail('Database optimization failed');
        console.error(chalk.red('Error:'), error.message);
        return {
            success: false,
            error: error.message
        };
    }
}
function getSchemaVersion(db) {
    try {
        const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='schema_version'
    `).get();
        if (!tableExists) {
            db.exec(`
        CREATE TABLE schema_version (
          version REAL PRIMARY KEY,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          description TEXT
        )
      `);
            db.prepare(`
        INSERT INTO schema_version (version, description) 
        VALUES (1.0, 'Initial schema')
      `).run();
            return 1.0;
        }
        const result = db.prepare(`
      SELECT version FROM schema_version 
      ORDER BY version DESC LIMIT 1
    `).get();
        return result ? result.version : 1.0;
    } catch (error) {
        return 1.0;
    }
}
function updateSchemaVersion(db, version, description = '') {
    db.prepare(`
    INSERT OR REPLACE INTO schema_version (version, description) 
    VALUES (?, ?)
  `).run(version, description || `Updated to version ${version}`);
}
function applyBasicIndexes(db) {
    ensureRequiredColumns(db);
    const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row)=>row.name);
    const tableSet = new Set(tables);
    const indexes = [];
    if (tableSet.has('swarms')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_swarms_status ON swarms(status)', 'CREATE INDEX IF NOT EXISTS idx_swarms_created ON swarms(created_at)');
    }
    if (tableSet.has('agents')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_agents_swarm ON agents(swarm_id)', 'CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type)', 'CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)');
    }
    if (tableSet.has('tasks')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_tasks_swarm ON tasks(swarm_id)', 'CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id)', 'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)', 'CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC)');
    }
    if (tableSet.has('collective_memory')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_memory_swarm ON collective_memory(swarm_id)', 'CREATE INDEX IF NOT EXISTS idx_memory_key ON collective_memory(key)', 'CREATE INDEX IF NOT EXISTS idx_memory_type ON collective_memory(type)');
    }
    if (tableSet.has('consensus_decisions')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_consensus_swarm ON consensus_decisions(swarm_id)', 'CREATE INDEX IF NOT EXISTS idx_consensus_created ON consensus_decisions(created_at)');
    }
    indexes.forEach((sql)=>{
        try {
            db.exec(sql);
        } catch (error) {
            console.warn(`Warning: Could not create index: ${error.message}`);
        }
    });
}
function ensureRequiredColumns(db) {
    const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row)=>row.name);
    const tableSet = new Set(tables);
    if (tableSet.has('tasks')) {
        const hasPriority = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
      WHERE name = 'priority'
    `).get();
        if (!hasPriority || hasPriority.count === 0) {
            try {
                db.exec('ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 5');
                console.log('Added missing priority column to tasks table');
            } catch (error) {
                if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                    throw error;
                }
            }
        }
        const hasCompletedAt = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
      WHERE name = 'completed_at'
    `).get();
        if (!hasCompletedAt || hasCompletedAt.count === 0) {
            try {
                db.exec('ALTER TABLE tasks ADD COLUMN completed_at DATETIME');
                console.log('Added missing completed_at column to tasks table');
            } catch (error) {
                if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                    throw error;
                }
            }
        }
        const hasResult = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
      WHERE name = 'result'
    `).get();
        if (!hasResult || hasResult.count === 0) {
            try {
                db.exec('ALTER TABLE tasks ADD COLUMN result TEXT');
                console.log('Added missing result column to tasks table');
            } catch (error) {
                if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                    throw error;
                }
            }
        }
    }
    if (tableSet.has('swarms')) {
        const hasUpdatedAt = db.prepare(`
      SELECT COUNT(*) as count FROM pragma_table_info('swarms') 
      WHERE name = 'updated_at'
    `).get();
        if (!hasUpdatedAt || hasUpdatedAt.count === 0) {
            try {
                db.exec('ALTER TABLE swarms ADD COLUMN updated_at DATETIME');
                console.log('Added missing updated_at column to swarms table');
            } catch (error) {
                if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                    throw error;
                }
            }
        }
    }
}
function applyAdvancedIndexes(db) {
    const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all().map((row)=>row.name);
    const tableSet = new Set(tables);
    const indexes = [];
    if (tableSet.has('tasks')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_tasks_swarm_status ON tasks(swarm_id, status)', 'CREATE INDEX IF NOT EXISTS idx_tasks_full ON tasks(swarm_id, agent_id, status, priority)', "CREATE INDEX IF NOT EXISTS idx_tasks_pending ON tasks(swarm_id, priority) WHERE status = 'pending'");
    }
    if (tableSet.has('agents')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_agents_swarm_type ON agents(swarm_id, type)', 'CREATE INDEX IF NOT EXISTS idx_agents_full ON agents(swarm_id, type, status, role)');
    }
    if (tableSet.has('collective_memory')) {
        indexes.push('CREATE INDEX IF NOT EXISTS idx_memory_swarm_key ON collective_memory(swarm_id, key)');
    }
    if (tableSet.has('swarms')) {
        indexes.push("CREATE INDEX IF NOT EXISTS idx_swarms_active ON swarms(id, name) WHERE status = 'active'");
    }
    indexes.forEach((sql)=>{
        try {
            db.exec(sql);
        } catch (error) {
            console.warn(`Warning: Could not create index: ${error.message}`);
        }
    });
}
function addPerformanceTracking(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS agent_performance (
      agent_id TEXT PRIMARY KEY,
      tasks_completed INTEGER DEFAULT 0,
      tasks_failed INTEGER DEFAULT 0,
      avg_completion_time REAL,
      success_rate REAL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS swarm_performance (
      swarm_id TEXT PRIMARY KEY,
      total_tasks INTEGER DEFAULT 0,
      completed_tasks INTEGER DEFAULT 0,
      avg_consensus_time REAL,
      memory_efficiency REAL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (swarm_id) REFERENCES swarms(id)
    )
  `);
    db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_agent_performance
    AFTER UPDATE OF status ON tasks
    WHEN NEW.status = 'completed' OR NEW.status = 'failed'
    BEGIN
      INSERT OR REPLACE INTO agent_performance (agent_id, tasks_completed, tasks_failed)
      VALUES (
        NEW.agent_id,
        COALESCE((SELECT tasks_completed FROM agent_performance WHERE agent_id = NEW.agent_id), 0) + 
          CASE WHEN NEW.status = 'completed' THEN 1 ELSE 0 END,
        COALESCE((SELECT tasks_failed FROM agent_performance WHERE agent_id = NEW.agent_id), 0) + 
          CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END
      );
    END
  `);
}
function addMemoryOptimization(db) {
    const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name = 'collective_memory'
  `).all();
    if (tables.length === 0) {
        console.log('collective_memory table does not exist, skipping memory optimization');
        return;
    }
    const hasAccessCount = db.prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('collective_memory') 
    WHERE name = 'access_count'
  `).get();
    if (!hasAccessCount || hasAccessCount.count === 0) {
        try {
            db.exec(`
        ALTER TABLE collective_memory 
        ADD COLUMN access_count INTEGER DEFAULT 0
      `);
            console.log('Added access_count column to collective_memory table');
        } catch (error) {
            if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                throw error;
            }
        }
    }
    const hasAccessedAt = db.prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('collective_memory') 
    WHERE name = 'accessed_at'
  `).get();
    if (!hasAccessedAt || hasAccessedAt.count === 0) {
        try {
            db.exec(`
        ALTER TABLE collective_memory 
        ADD COLUMN accessed_at DATETIME
      `);
            console.log('Added accessed_at column to collective_memory table');
        } catch (error) {
            if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                throw error;
            }
        }
    }
    const hasCompressed = db.prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('collective_memory') 
    WHERE name = 'compressed'
  `).get();
    if (!hasCompressed || hasCompressed.count === 0) {
        try {
            db.exec(`
        ALTER TABLE collective_memory 
        ADD COLUMN compressed INTEGER DEFAULT 0
      `);
        } catch (error) {
            if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                throw error;
            }
        }
    }
    const hasSize = db.prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('collective_memory') 
    WHERE name = 'size'
  `).get();
    if (!hasSize || hasSize.count === 0) {
        try {
            db.exec(`
        ALTER TABLE collective_memory 
        ADD COLUMN size INTEGER DEFAULT 0
      `);
        } catch (error) {
            if (!error.message.includes('duplicate column') && !error.message.includes('no such table')) {
                throw error;
            }
        }
    }
    db.exec(`
    CREATE VIEW IF NOT EXISTS memory_usage_summary AS
    SELECT 
      swarm_id,
      COUNT(*) as total_entries,
      SUM(LENGTH(value)) as total_size,
      AVG(access_count) as avg_access_count,
      COUNT(CASE WHEN access_count = 0 THEN 1 END) as unused_entries
    FROM collective_memory
    GROUP BY swarm_id
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS memory_cleanup_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      swarm_id TEXT,
      entries_removed INTEGER,
      space_reclaimed INTEGER,
      cleanup_type TEXT,
      performed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
function addBehavioralTracking(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS agent_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent_id TEXT,
      to_agent_id TEXT,
      interaction_type TEXT,
      swarm_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_agent_id) REFERENCES agents(id),
      FOREIGN KEY (to_agent_id) REFERENCES agents(id),
      FOREIGN KEY (swarm_id) REFERENCES swarms(id)
    )
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS behavioral_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      swarm_id TEXT,
      pattern_type TEXT,
      pattern_data TEXT, -- JSON
      confidence REAL,
      first_observed DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_observed DATETIME DEFAULT CURRENT_TIMESTAMP,
      occurrence_count INTEGER DEFAULT 1,
      FOREIGN KEY (swarm_id) REFERENCES swarms(id)
    )
  `);
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_interactions_swarm ON agent_interactions(swarm_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_agents ON agent_interactions(from_agent_id, to_agent_id);
    CREATE INDEX IF NOT EXISTS idx_patterns_swarm_type ON behavioral_patterns(swarm_id, pattern_type);
  `);
}
export async function performMaintenance(dbPath, options = {}) {
    const spinner = ora('Performing database maintenance...').start();
    try {
        const db = new Database(dbPath);
        if (options.cleanMemory) {
            const hasMemoryTable = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='collective_memory'
      `).get();
            if (hasMemoryTable) {
                spinner.text = 'Cleaning old memory entries...';
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - (options.memoryRetentionDays || 30));
                try {
                    const result = db.prepare(`
            DELETE FROM collective_memory 
            WHERE accessed_at < ? AND access_count < 5
          `).run(cutoffDate.toISOString());
                    console.log(chalk.green(`✓ Removed ${result.changes} old memory entries`));
                } catch (error) {
                    console.warn(chalk.yellow(`⚠ Could not clean memory entries: ${error.message}`));
                }
            } else {
                console.log(chalk.yellow('⚠ collective_memory table not found, skipping memory cleanup'));
            }
        }
        if (options.archiveTasks) {
            spinner.text = 'Archiving completed tasks...';
            db.exec(`
        CREATE TABLE IF NOT EXISTS tasks_archive AS 
        SELECT * FROM tasks WHERE 1=0
      `);
            const hasCompletedAt = db.prepare(`
        SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
        WHERE name = 'completed_at'
      `).get();
            let archived = {
                changes: 0
            };
            if (hasCompletedAt && hasCompletedAt.count > 0) {
                const archiveCutoff = new Date();
                archiveCutoff.setDate(archiveCutoff.getDate() - (options.taskRetentionDays || 7));
                db.exec(`
          INSERT INTO tasks_archive 
          SELECT * FROM tasks 
          WHERE status = 'completed' AND completed_at < '${archiveCutoff.toISOString()}'
        `);
                archived = db.prepare(`
          DELETE FROM tasks 
          WHERE status = 'completed' AND completed_at < ?
        `).run(archiveCutoff.toISOString());
            } else {
                const archiveCutoff = new Date();
                archiveCutoff.setDate(archiveCutoff.getDate() - (options.taskRetentionDays || 7));
                db.exec(`
          INSERT INTO tasks_archive 
          SELECT * FROM tasks 
          WHERE status = 'completed' AND created_at < '${archiveCutoff.toISOString()}'
        `);
                archived = db.prepare(`
          DELETE FROM tasks 
          WHERE status = 'completed' AND created_at < ?
        `).run(archiveCutoff.toISOString());
            }
            console.log(chalk.green(`✓ Archived ${archived.changes} completed tasks`));
        }
        spinner.text = 'Updating database statistics...';
        db.exec('ANALYZE');
        if (options.checkIntegrity) {
            spinner.text = 'Checking database integrity...';
            const integrityCheck = db.prepare('PRAGMA integrity_check').get();
            if (integrityCheck.integrity_check === 'ok') {
                console.log(chalk.green('✓ Database integrity check passed'));
            } else {
                console.log(chalk.yellow('⚠ Database integrity issues detected'));
            }
        }
        db.close();
        spinner.succeed('Database maintenance complete!');
    } catch (error) {
        spinner.fail('Database maintenance failed');
        console.error(chalk.red('Error:'), error.message);
    }
}
export async function generateOptimizationReport(dbPath) {
    try {
        const db = new Database(dbPath, {
            readonly: true
        });
        const report = {
            schemaVersion: getSchemaVersion(db),
            tables: {},
            indexes: [],
            performance: {}
        };
        const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all();
        for (const table of tables){
            const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
            const size = db.prepare(`
        SELECT SUM(pgsize) as size FROM dbstat WHERE name=?
      `).get(table.name);
            report.tables[table.name] = {
                rowCount: count.count,
                sizeBytes: size?.size || 0
            };
        }
        report.indexes = db.prepare(`
      SELECT name, tbl_name FROM sqlite_master WHERE type='index'
    `).all();
        let avgTaskTime = {
            avg_minutes: 0
        };
        try {
            const hasCompletedAt = db.prepare(`
        SELECT COUNT(*) as count FROM pragma_table_info('tasks') 
        WHERE name = 'completed_at'
      `).get();
            if (hasCompletedAt && hasCompletedAt.count > 0) {
                avgTaskTime = db.prepare(`
          SELECT AVG(julianday(completed_at) - julianday(created_at)) * 24 * 60 as avg_minutes
          FROM tasks WHERE completed_at IS NOT NULL
        `).get();
            }
        } catch (error) {
            console.warn('Could not calculate average task time:', error.message);
        }
        report.performance.avgTaskCompletionMinutes = avgTaskTime?.avg_minutes || 0;
        db.close();
        return report;
    } catch (error) {
        console.error('Error generating report:', error);
        return null;
    }
}
export default {
    optimizeHiveMindDatabase,
    performMaintenance,
    generateOptimizationReport
};

//# sourceMappingURL=db-optimizer.js.map