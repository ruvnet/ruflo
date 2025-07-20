// Workflow state management and persistence
import { EventEmitter } from 'events';
import { Database } from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowExecution, WorkflowDefinition, WorkflowLog } from '../workflow-engine';

export interface WorkflowSnapshot {
  id: string;
  executionId: string;
  timestamp: Date;
  state: any;
  checksum: string;
  metadata?: Record<string, any>;
}

export interface WorkflowStateStore {
  saveExecution(execution: WorkflowExecution): Promise<void>;
  updateExecution(execution: WorkflowExecution): Promise<void>;
  getExecution(executionId: string): Promise<WorkflowExecution | null>;
  deleteExecution(executionId: string): Promise<void>;
  
  saveSnapshot(snapshot: WorkflowSnapshot): Promise<void>;
  getLatestSnapshot(executionId: string): Promise<WorkflowSnapshot | null>;
  getSnapshot(snapshotId: string): Promise<WorkflowSnapshot | null>;
  deleteSnapshots(executionId: string): Promise<void>;
  
  saveWorkflowDefinition(workflow: WorkflowDefinition): Promise<void>;
  getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinition | null>;
  
  saveLogs(logs: WorkflowLog[], executionId: string): Promise<void>;
  getLogs(executionId: string, limit?: number): Promise<WorkflowLog[]>;
}

// SQLite implementation of WorkflowStateStore
export class SQLiteWorkflowStateStore implements WorkflowStateStore {
  private db: Database;
  private initialized = false;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.createTables();
    this.initialized = true;
  }

  private createTables(): Promise<void> {
    return new Promise((resolve, reject) => {
      const createTablesSQL = `
        -- Workflow definitions table
        CREATE TABLE IF NOT EXISTS workflow_definitions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          version TEXT NOT NULL,
          definition TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Workflow executions table
        CREATE TABLE IF NOT EXISTS workflow_executions (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          status TEXT NOT NULL,
          start_time DATETIME NOT NULL,
          end_time DATETIME,
          current_step TEXT,
          variables TEXT,
          results TEXT,
          error_message TEXT,
          parent_execution_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id)
        );

        -- Workflow snapshots table
        CREATE TABLE IF NOT EXISTS workflow_snapshots (
          id TEXT PRIMARY KEY,
          execution_id TEXT NOT NULL,
          timestamp DATETIME NOT NULL,
          state TEXT NOT NULL,
          checksum TEXT NOT NULL,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
        );

        -- Workflow logs table
        CREATE TABLE IF NOT EXISTS workflow_logs (
          id TEXT PRIMARY KEY,
          execution_id TEXT NOT NULL,
          timestamp DATETIME NOT NULL,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          step_id TEXT,
          data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
        );

        -- Create indexes for better performance
        CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON workflow_executions(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_executions_status ON workflow_executions(status);
        CREATE INDEX IF NOT EXISTS idx_snapshots_execution_id ON workflow_snapshots(execution_id);
        CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON workflow_snapshots(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_execution_id ON workflow_logs(execution_id);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON workflow_logs(timestamp);
      `;

      this.db.exec(createTablesSQL, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async saveExecution(execution: WorkflowExecution): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO workflow_executions (
          id, workflow_id, status, start_time, end_time, current_step,
          variables, results, error_message, parent_execution_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        execution.id,
        execution.workflowId,
        execution.status,
        execution.startTime.toISOString(),
        execution.endTime?.toISOString() || null,
        execution.currentStep || null,
        JSON.stringify(execution.variables),
        JSON.stringify(execution.results),
        null, // error_message will be updated separately
        null  // parent_execution_id
      ];

      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async updateExecution(execution: WorkflowExecution): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE workflow_executions 
        SET status = ?, end_time = ?, current_step = ?, variables = ?, 
            results = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      const params = [
        execution.status,
        execution.endTime?.toISOString() || null,
        execution.currentStep || null,
        JSON.stringify(execution.variables),
        JSON.stringify(execution.results),
        execution.logs.find(l => l.level === 'error')?.message || null,
        execution.id
      ];

      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM workflow_executions WHERE id = ?
      `;

      this.db.get(sql, [executionId], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          // Convert database row to WorkflowExecution
          const execution: WorkflowExecution = {
            id: row.id,
            workflowId: row.workflow_id,
            status: row.status,
            startTime: new Date(row.start_time),
            endTime: row.end_time ? new Date(row.end_time) : undefined,
            currentStep: row.current_step,
            variables: JSON.parse(row.variables || '{}'),
            results: JSON.parse(row.results || '{}'),
            logs: [] // Logs are loaded separately
          };
          resolve(execution);
        }
      });
    });
  }

  async deleteExecution(executionId: string): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      // Delete in order due to foreign key constraints
      const deleteStatements = [
        'DELETE FROM workflow_logs WHERE execution_id = ?',
        'DELETE FROM workflow_snapshots WHERE execution_id = ?',
        'DELETE FROM workflow_executions WHERE id = ?'
      ];

      let completed = 0;
      const total = deleteStatements.length;

      deleteStatements.forEach(sql => {
        this.db.run(sql, [executionId], (err) => {
          if (err) {
            reject(err);
            return;
          }
          completed++;
          if (completed === total) {
            resolve();
          }
        });
      });
    });
  }

  async saveSnapshot(snapshot: WorkflowSnapshot): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO workflow_snapshots (
          id, execution_id, timestamp, state, checksum, metadata
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      const params = [
        snapshot.id,
        snapshot.executionId,
        snapshot.timestamp.toISOString(),
        JSON.stringify(snapshot.state),
        snapshot.checksum,
        JSON.stringify(snapshot.metadata || {})
      ];

      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getLatestSnapshot(executionId: string): Promise<WorkflowSnapshot | null> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM workflow_snapshots 
        WHERE execution_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 1
      `;

      this.db.get(sql, [executionId], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          const snapshot: WorkflowSnapshot = {
            id: row.id,
            executionId: row.execution_id,
            timestamp: new Date(row.timestamp),
            state: JSON.parse(row.state),
            checksum: row.checksum,
            metadata: JSON.parse(row.metadata || '{}')
          };
          resolve(snapshot);
        }
      });
    });
  }

  async getSnapshot(snapshotId: string): Promise<WorkflowSnapshot | null> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM workflow_snapshots WHERE id = ?`;

      this.db.get(sql, [snapshotId], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          const snapshot: WorkflowSnapshot = {
            id: row.id,
            executionId: row.execution_id,
            timestamp: new Date(row.timestamp),
            state: JSON.parse(row.state),
            checksum: row.checksum,
            metadata: JSON.parse(row.metadata || '{}')
          };
          resolve(snapshot);
        }
      });
    });
  }

  async deleteSnapshots(executionId: string): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM workflow_snapshots WHERE execution_id = ?`;

      this.db.run(sql, [executionId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async saveWorkflowDefinition(workflow: WorkflowDefinition): Promise<void> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO workflow_definitions (
          id, name, description, version, definition, updated_at
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      const params = [
        workflow.id,
        workflow.name,
        workflow.description,
        workflow.version,
        JSON.stringify(workflow)
      ];

      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinition | null> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `SELECT definition FROM workflow_definitions WHERE id = ?`;

      this.db.get(sql, [workflowId], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve(JSON.parse(row.definition));
        }
      });
    });
  }

  async saveLogs(logs: WorkflowLog[], executionId: string): Promise<void> {
    await this.initialize();

    if (logs.length === 0) return;

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO workflow_logs (
          id, execution_id, timestamp, level, message, step_id, data
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const stmt = this.db.prepare(sql);
      let completed = 0;

      logs.forEach(log => {
        const params = [
          uuidv4(),
          executionId,
          log.timestamp.toISOString(),
          log.level,
          log.message,
          log.stepId || null,
          JSON.stringify(log.data || {})
        ];

        stmt.run(params, (err: any) => {
          if (err) {
            reject(err);
            return;
          }
          completed++;
          if (completed === logs.length) {
            stmt.finalize(() => resolve());
          }
        });
      });
    });
  }

  async getLogs(executionId: string, limit = 1000): Promise<WorkflowLog[]> {
    await this.initialize();

    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM workflow_logs 
        WHERE execution_id = ? 
        ORDER BY timestamp ASC 
        LIMIT ?
      `;

      this.db.all(sql, [executionId, limit], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const logs: WorkflowLog[] = rows.map(row => ({
            timestamp: new Date(row.timestamp),
            level: row.level,
            message: row.message,
            stepId: row.step_id,
            data: JSON.parse(row.data || '{}')
          }));
          resolve(logs);
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

// Workflow State Manager - High-level interface
export class WorkflowStateManager extends EventEmitter {
  private store: WorkflowStateStore;
  private snapshotTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(store: WorkflowStateStore) {
    super();
    this.store = store;
  }

  async saveExecution(execution: WorkflowExecution): Promise<void> {
    await this.store.saveExecution(execution);
    this.emit('execution:saved', { executionId: execution.id });
  }

  async updateExecution(execution: WorkflowExecution): Promise<void> {
    await this.store.updateExecution(execution);
    
    // Save logs separately
    if (execution.logs.length > 0) {
      await this.store.saveLogs(execution.logs, execution.id);
      execution.logs = []; // Clear logs after saving to prevent duplicates
    }
    
    this.emit('execution:updated', { executionId: execution.id });
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    const execution = await this.store.getExecution(executionId);
    if (execution) {
      // Load logs
      execution.logs = await this.store.getLogs(executionId);
    }
    return execution;
  }

  async createSnapshot(executionId: string, state: any): Promise<string> {
    const snapshot: WorkflowSnapshot = {
      id: uuidv4(),
      executionId,
      timestamp: new Date(),
      state,
      checksum: this.calculateChecksum(state)
    };

    await this.store.saveSnapshot(snapshot);
    this.emit('snapshot:created', { snapshotId: snapshot.id, executionId });
    
    return snapshot.id;
  }

  async restoreFromSnapshot(snapshotId: string): Promise<WorkflowExecution | null> {
    const snapshot = await this.store.getSnapshot(snapshotId);
    if (!snapshot) return null;

    return snapshot.state;
  }

  async enableAutoSnapshots(executionId: string, intervalMs = 60000): Promise<void> {
    // Clear existing timer
    const existingTimer = this.snapshotTimers.get(executionId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Set up new timer
    const timer = setInterval(async () => {
      try {
        const execution = await this.getExecution(executionId);
        if (execution && execution.status === 'running') {
          await this.createSnapshot(executionId, execution);
        } else {
          // Stop timer if execution is not running
          this.disableAutoSnapshots(executionId);
        }
      } catch (error) {
        this.emit('error', { error, executionId, operation: 'auto-snapshot' });
      }
    }, intervalMs);

    this.snapshotTimers.set(executionId, timer);
    this.emit('auto-snapshots:enabled', { executionId, intervalMs });
  }

  disableAutoSnapshots(executionId: string): void {
    const timer = this.snapshotTimers.get(executionId);
    if (timer) {
      clearInterval(timer);
      this.snapshotTimers.delete(executionId);
      this.emit('auto-snapshots:disabled', { executionId });
    }
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    await this.store.saveWorkflowDefinition(workflow);
    this.emit('workflow:saved', { workflowId: workflow.id });
  }

  async getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    return this.store.getWorkflowDefinition(workflowId);
  }

  async cleanup(executionId: string): Promise<void> {
    this.disableAutoSnapshots(executionId);
    
    // Optional: Clean up old snapshots (keep only latest 10)
    await this.cleanupOldSnapshots(executionId);
    
    this.emit('cleanup:completed', { executionId });
  }

  private async cleanupOldSnapshots(executionId: string, keepCount = 10): Promise<void> {
    // This would require additional SQL to delete old snapshots
    // Implementation depends on specific requirements
  }

  private calculateChecksum(state: any): string {
    // Simple checksum implementation
    const stateString = JSON.stringify(state);
    let hash = 0;
    for (let i = 0; i < stateString.length; i++) {
      const char = stateString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  async shutdown(): Promise<void> {
    // Clear all timers
    for (const timer of this.snapshotTimers.values()) {
      clearInterval(timer);
    }
    this.snapshotTimers.clear();

    // Close store if it supports it
    if ('close' in this.store && typeof this.store.close === 'function') {
      await this.store.close();
    }

    this.removeAllListeners();
  }
}