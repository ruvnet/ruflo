import { DatabaseError } from '../utils/errors.js';
import { nanoid } from 'nanoid';
export class DatabaseService {
    config;
    logger;
    db;
    initialized = false;
    constructor(config, logger){
        this.config = config;
        this.logger = logger;
    }
    async initialize() {
        if (this.initialized) {
            return;
        }
        try {
            this.logger.info('Initializing database service', {
                type: this.config.type,
                database: this.config.database
            });
            switch(this.config.type){
                case 'sqlite':
                    await this.initializeSQLite();
                    break;
                case 'mysql':
                    await this.initializeMySQL();
                    break;
                case 'postgresql':
                    await this.initializePostgreSQL();
                    break;
                default:
                    throw new DatabaseError(`Unsupported database type: ${this.config.type}`);
            }
            await this.runMigrations();
            this.initialized = true;
            this.logger.info('Database service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize database service', error);
            throw new DatabaseError('Database initialization failed', {
                error
            });
        }
    }
    async shutdown() {
        if (!this.initialized || !this.db) {
            return;
        }
        try {
            if (this.config.type === 'sqlite') {
                await this.db.close();
            } else {
                await this.db.end();
            }
            this.initialized = false;
            this.logger.info('Database service shutdown complete');
        } catch (error) {
            this.logger.error('Error shutting down database service', error);
        }
    }
    async createSwarm(swarm) {
        const id = `swarm_${Date.now()}_${nanoid(10)}`;
        const now = new Date();
        const record = {
            id,
            ...swarm,
            createdAt: now,
            updatedAt: now
        };
        try {
            const query = `
        INSERT INTO swarms (id, name, topology, max_agents, strategy, status, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
            const values = [
                record.id,
                record.name,
                record.topology,
                record.maxAgents,
                record.strategy,
                record.status,
                JSON.stringify(record.config),
                record.createdAt,
                record.updatedAt
            ];
            await this.execute(query, values);
            return record;
        } catch (error) {
            throw new DatabaseError('Failed to create swarm', {
                error,
                swarmId: id
            });
        }
    }
    async getSwarm(id) {
        try {
            const query = 'SELECT * FROM swarms WHERE id = ?';
            const rows = await this.query(query, [
                id
            ]);
            if (rows.length === 0) {
                return null;
            }
            return this.mapSwarmRow(rows[0]);
        } catch (error) {
            throw new DatabaseError('Failed to get swarm', {
                error,
                swarmId: id
            });
        }
    }
    async updateSwarm(id, updates) {
        try {
            const setClause = Object.keys(updates).filter((key)=>key !== 'id' && key !== 'createdAt').map((key)=>`${this.camelToSnake(key)} = ?`).join(', ');
            const values = Object.entries(updates).filter(([key])=>key !== 'id' && key !== 'createdAt').map(([key, value])=>{
                if (key === 'config' && typeof value === 'object') {
                    return JSON.stringify(value);
                }
                return value;
            });
            values.push(new Date());
            values.push(id);
            const query = `UPDATE swarms SET ${setClause}, updated_at = ? WHERE id = ?`;
            await this.execute(query, values);
        } catch (error) {
            throw new DatabaseError('Failed to update swarm', {
                error,
                swarmId: id
            });
        }
    }
    async deleteSwarm(id) {
        try {
            const query = 'UPDATE swarms SET status = ?, destroyed_at = ? WHERE id = ?';
            await this.execute(query, [
                'destroyed',
                new Date(),
                id
            ]);
        } catch (error) {
            throw new DatabaseError('Failed to delete swarm', {
                error,
                swarmId: id
            });
        }
    }
    async listSwarms(filter) {
        try {
            let query = 'SELECT * FROM swarms';
            const values = [];
            if (filter?.status) {
                query += ' WHERE status = ?';
                values.push(filter.status);
            }
            query += ' ORDER BY created_at DESC';
            const rows = await this.query(query, values);
            return rows.map((row)=>this.mapSwarmRow(row));
        } catch (error) {
            throw new DatabaseError('Failed to list swarms', {
                error
            });
        }
    }
    async createAgent(agent) {
        const id = `agent_${Date.now()}_${nanoid(10)}`;
        const now = new Date();
        const record = {
            id,
            ...agent,
            createdAt: now,
            updatedAt: now
        };
        try {
            const query = `
        INSERT INTO agents (id, swarm_id, type, name, status, capabilities, config, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
            const values = [
                record.id,
                record.swarmId,
                record.type,
                record.name,
                record.status,
                JSON.stringify(record.capabilities),
                JSON.stringify(record.config),
                JSON.stringify(record.metadata),
                record.createdAt,
                record.updatedAt
            ];
            await this.execute(query, values);
            return record;
        } catch (error) {
            throw new DatabaseError('Failed to create agent', {
                error,
                agentId: id
            });
        }
    }
    async getAgentsBySwarm(swarmId) {
        try {
            const query = 'SELECT * FROM agents WHERE swarm_id = ? AND status != ? ORDER BY created_at';
            const rows = await this.query(query, [
                swarmId,
                'terminated'
            ]);
            return rows.map((row)=>this.mapAgentRow(row));
        } catch (error) {
            throw new DatabaseError('Failed to get agents by swarm', {
                error,
                swarmId
            });
        }
    }
    async updateAgent(id, updates) {
        try {
            const setClause = Object.keys(updates).filter((key)=>key !== 'id' && key !== 'createdAt').map((key)=>`${this.camelToSnake(key)} = ?`).join(', ');
            const values = Object.entries(updates).filter(([key])=>key !== 'id' && key !== 'createdAt').map(([key, value])=>{
                if ([
                    'capabilities',
                    'config',
                    'metadata'
                ].includes(key) && typeof value === 'object') {
                    return JSON.stringify(value);
                }
                return value;
            });
            values.push(new Date());
            values.push(id);
            const query = `UPDATE agents SET ${setClause}, updated_at = ? WHERE id = ?`;
            await this.execute(query, values);
        } catch (error) {
            throw new DatabaseError('Failed to update agent', {
                error,
                agentId: id
            });
        }
    }
    async createTask(task) {
        const id = `task_${Date.now()}_${nanoid(10)}`;
        const now = new Date();
        const record = {
            id,
            ...task,
            createdAt: now,
            updatedAt: now
        };
        try {
            const query = `
        INSERT INTO tasks (id, swarm_id, description, priority, strategy, status, max_agents, requirements, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
            const values = [
                record.id,
                record.swarmId,
                record.description,
                record.priority,
                record.strategy,
                record.status,
                record.maxAgents,
                JSON.stringify(record.requirements),
                JSON.stringify(record.metadata),
                record.createdAt,
                record.updatedAt
            ];
            await this.execute(query, values);
            return record;
        } catch (error) {
            throw new DatabaseError('Failed to create task', {
                error,
                taskId: id
            });
        }
    }
    async getTasksBySwarm(swarmId) {
        try {
            const query = 'SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC';
            const rows = await this.query(query, [
                swarmId
            ]);
            return rows.map((row)=>this.mapTaskRow(row));
        } catch (error) {
            throw new DatabaseError('Failed to get tasks by swarm', {
                error,
                swarmId
            });
        }
    }
    async updateTask(id, updates) {
        try {
            const setClause = Object.keys(updates).filter((key)=>key !== 'id' && key !== 'createdAt').map((key)=>`${this.camelToSnake(key)} = ?`).join(', ');
            const values = Object.entries(updates).filter(([key])=>key !== 'id' && key !== 'createdAt').map(([key, value])=>{
                if ([
                    'requirements',
                    'metadata',
                    'result'
                ].includes(key) && typeof value === 'object') {
                    return JSON.stringify(value);
                }
                return value;
            });
            values.push(new Date());
            values.push(id);
            const query = `UPDATE tasks SET ${setClause}, updated_at = ? WHERE id = ?`;
            await this.execute(query, values);
        } catch (error) {
            throw new DatabaseError('Failed to update task', {
                error,
                taskId: id
            });
        }
    }
    async recordMetric(metric) {
        const id = `metric_${Date.now()}_${nanoid(8)}`;
        const record = {
            id,
            ...metric,
            timestamp: new Date()
        };
        try {
            const query = `
        INSERT INTO performance_metrics (id, swarm_id, agent_id, metric_type, metric_name, metric_value, unit, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
            const values = [
                record.id,
                record.swarmId,
                record.agentId,
                record.metricType,
                record.metricName,
                record.metricValue,
                record.unit,
                record.timestamp,
                JSON.stringify(record.metadata)
            ];
            await this.execute(query, values);
        } catch (error) {
            throw new DatabaseError('Failed to record metric', {
                error,
                metricId: id
            });
        }
    }
    async getMetrics(filter) {
        try {
            let query = 'SELECT * FROM performance_metrics WHERE 1=1';
            const values = [];
            if (filter.swarmId) {
                query += ' AND swarm_id = ?';
                values.push(filter.swarmId);
            }
            if (filter.agentId) {
                query += ' AND agent_id = ?';
                values.push(filter.agentId);
            }
            if (filter.metricType) {
                query += ' AND metric_type = ?';
                values.push(filter.metricType);
            }
            if (filter.startTime) {
                query += ' AND timestamp >= ?';
                values.push(filter.startTime);
            }
            if (filter.endTime) {
                query += ' AND timestamp <= ?';
                values.push(filter.endTime);
            }
            query += ' ORDER BY timestamp DESC';
            if (filter.limit) {
                query += ' LIMIT ?';
                values.push(filter.limit);
            }
            const rows = await this.query(query, values);
            return rows.map((row)=>this.mapMetricRow(row));
        } catch (error) {
            throw new DatabaseError('Failed to get metrics', {
                error
            });
        }
    }
    async recordEvent(event) {
        const id = `event_${Date.now()}_${nanoid(8)}`;
        const record = {
            id,
            ...event,
            createdAt: new Date()
        };
        try {
            const query = `
        INSERT INTO events (id, swarm_id, agent_id, event_type, event_name, event_data, severity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
            const values = [
                record.id,
                record.swarmId,
                record.agentId,
                record.eventType,
                record.eventName,
                JSON.stringify(record.eventData),
                record.severity,
                record.createdAt
            ];
            await this.execute(query, values);
        } catch (error) {
            this.logger.error('Failed to record event', {
                error,
                event: record
            });
        }
    }
    async getHealthStatus() {
        try {
            const query = 'SELECT 1 as test';
            await this.query(query);
            const swarmCount = await this.query('SELECT COUNT(*) as count FROM swarms WHERE status != ?', [
                'destroyed'
            ]);
            const agentCount = await this.query('SELECT COUNT(*) as count FROM agents WHERE status != ?', [
                'terminated'
            ]);
            const activeTaskCount = await this.query('SELECT COUNT(*) as count FROM tasks WHERE status IN (?, ?, ?)', [
                'pending',
                'assigned',
                'running'
            ]);
            return {
                healthy: true,
                metrics: {
                    totalSwarms: swarmCount[0]?.count || 0,
                    totalAgents: agentCount[0]?.count || 0,
                    activeTasks: activeTaskCount[0]?.count || 0
                }
            };
        } catch (error) {
            return {
                healthy: false,
                error: error instanceof Error ? error.message : 'Unknown database error'
            };
        }
    }
    async initializeSQLite() {
        try {
            const Database = (await import('better-sqlite3')).default;
            this.db = new Database(this.config.database);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 1000');
            this.db.pragma('temp_store = memory');
        } catch (error) {
            throw new DatabaseError('Failed to initialize SQLite', {
                error
            });
        }
    }
    async initializeMySQL() {
        throw new DatabaseError('MySQL support not implemented yet');
    }
    async initializePostgreSQL() {
        throw new DatabaseError('PostgreSQL support not implemented yet');
    }
    async runMigrations() {
        try {
            const migrationQuery = this.config.type === 'sqlite' ? "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'" : "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'migrations'";
            const migrationTable = await this.query(migrationQuery);
            if (migrationTable.length === 0) {
                await this.execute(`
          CREATE TABLE migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename VARCHAR(255) NOT NULL,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
                await this.createTables();
                await this.execute("INSERT INTO migrations (filename) VALUES (?)", [
                    '001_initial_schema.sql'
                ]);
            }
        } catch (error) {
            throw new DatabaseError('Failed to run migrations', {
                error
            });
        }
    }
    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        topology TEXT NOT NULL,
        max_agents INTEGER DEFAULT 8,
        strategy TEXT DEFAULT 'balanced',
        status TEXT DEFAULT 'initializing',
        config TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        destroyed_at TEXT
      )`,
            `CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'spawning',
        capabilities TEXT,
        config TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        terminated_at TEXT,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      )`,
            `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT DEFAULT 'medium',
        strategy TEXT DEFAULT 'adaptive',
        status TEXT DEFAULT 'pending',
        max_agents INTEGER,
        requirements TEXT,
        metadata TEXT,
        result TEXT,
        error_message TEXT,
        assigned_to TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      )`,
            `CREATE TABLE IF NOT EXISTS performance_metrics (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        agent_id TEXT,
        metric_type TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      )`,
            `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        agent_id TEXT,
        event_type TEXT NOT NULL,
        event_name TEXT NOT NULL,
        event_data TEXT,
        severity TEXT DEFAULT 'info',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
        ];
        for (const table of tables){
            await this.execute(table);
        }
    }
    async query(sql, params = []) {
        if (this.config.type === 'sqlite') {
            const stmt = this.db.prepare(sql);
            return stmt.all(...params);
        }
        throw new DatabaseError('Unsupported database operation');
    }
    async execute(sql, params = []) {
        if (this.config.type === 'sqlite') {
            const stmt = this.db.prepare(sql);
            return stmt.run(...params);
        }
        throw new DatabaseError('Unsupported database operation');
    }
    camelToSnake(str) {
        return str.replace(/[A-Z]/g, (letter)=>`_${letter.toLowerCase()}`);
    }
    mapSwarmRow(row) {
        return {
            id: row.id,
            name: row.name,
            topology: row.topology,
            maxAgents: row.max_agents,
            strategy: row.strategy,
            status: row.status,
            config: row.config ? JSON.parse(row.config) : undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            destroyedAt: row.destroyed_at ? new Date(row.destroyed_at) : undefined
        };
    }
    mapAgentRow(row) {
        return {
            id: row.id,
            swarmId: row.swarm_id,
            type: row.type,
            name: row.name,
            status: row.status,
            capabilities: row.capabilities ? JSON.parse(row.capabilities) : undefined,
            config: row.config ? JSON.parse(row.config) : undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            terminatedAt: row.terminated_at ? new Date(row.terminated_at) : undefined
        };
    }
    mapTaskRow(row) {
        return {
            id: row.id,
            swarmId: row.swarm_id,
            description: row.description,
            priority: row.priority,
            strategy: row.strategy,
            status: row.status,
            maxAgents: row.max_agents,
            requirements: row.requirements ? JSON.parse(row.requirements) : undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            result: row.result ? JSON.parse(row.result) : undefined,
            errorMessage: row.error_message,
            assignedTo: row.assigned_to,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
            startedAt: row.started_at ? new Date(row.started_at) : undefined,
            completedAt: row.completed_at ? new Date(row.completed_at) : undefined
        };
    }
    mapMetricRow(row) {
        return {
            id: row.id,
            swarmId: row.swarm_id,
            agentId: row.agent_id,
            metricType: row.metric_type,
            metricName: row.metric_name,
            metricValue: row.metric_value,
            unit: row.unit,
            timestamp: new Date(row.timestamp),
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined
        };
    }
}

//# sourceMappingURL=database-service.js.map