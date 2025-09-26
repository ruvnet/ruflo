import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import path from 'path';
import { cwd } from '../../node-compat.js';
export class HiveMindMetricsReader {
    constructor(dbPath = null){
        this.dbPath = dbPath || path.join(cwd(), '.hive-mind', 'hive.db');
        this.db = null;
    }
    init() {
        if (existsSync(this.dbPath)) {
            this.db = new Database(this.dbPath, {
                readonly: true
            });
        }
    }
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    getSwarmMetrics(swarmId) {
        if (!this.db) {
            this.init();
        }
        if (!this.db) {
            return null;
        }
        try {
            const swarm = this.db.prepare('SELECT * FROM swarms WHERE id = ?').get(swarmId);
            if (!swarm) {
                return null;
            }
            const agentCount = this.db.prepare('SELECT COUNT(*) as count FROM agents WHERE swarm_id = ?').get(swarmId).count;
            const taskMetrics = this.db.prepare(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
          FROM tasks
          WHERE swarm_id = ?
        `).get(swarmId);
            const memoryCount = this.db.prepare('SELECT COUNT(*) as count FROM collective_memory WHERE swarm_id = ?').get(swarmId).count;
            const consensusCount = this.db.prepare('SELECT COUNT(*) as count FROM consensus_decisions WHERE swarm_id = ?').get(swarmId).count;
            const agents = this.db.prepare('SELECT * FROM agents WHERE swarm_id = ? ORDER BY role DESC, created_at ASC').all(swarmId);
            return {
                ...swarm,
                agent_count: agentCount,
                agents: agents,
                task_metrics: taskMetrics,
                memory_count: memoryCount,
                consensus_count: consensusCount,
                completion_percentage: taskMetrics.total > 0 ? Math.round(taskMetrics.completed / taskMetrics.total * 100) : 0
            };
        } catch (error) {
            console.error('Error reading swarm metrics:', error);
            return null;
        }
    }
    getSessionMetrics(sessionId) {
        if (!this.db) {
            this.init();
        }
        if (!this.db) {
            return null;
        }
        try {
            const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
            if (!session) {
                return null;
            }
            const agentCount = this.db.prepare('SELECT COUNT(*) as count FROM agents WHERE swarm_id = ?').get(session.swarm_id).count;
            const taskMetrics = this.db.prepare(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
          FROM tasks
          WHERE swarm_id = ?
        `).get(session.swarm_id);
            const completionPercentage = taskMetrics.total > 0 ? Math.round(taskMetrics.completed / taskMetrics.total * 100) : session.completion_percentage || 0;
            return {
                ...session,
                agent_count: agentCount,
                task_count: taskMetrics.total,
                completed_tasks: taskMetrics.completed,
                pending_tasks: taskMetrics.pending,
                in_progress_tasks: taskMetrics.in_progress,
                completion_percentage: completionPercentage
            };
        } catch (error) {
            console.error('Error reading session metrics:', error);
            return null;
        }
    }
    getActiveSessions() {
        if (!this.db) {
            this.init();
        }
        if (!this.db) {
            return [];
        }
        try {
            const sessions = this.db.prepare(`
          SELECT * FROM sessions 
          WHERE status = 'active' OR status = 'paused'
          ORDER BY updated_at DESC
        `).all();
            return sessions.map((session)=>{
                const metrics = this.getSessionMetrics(session.id);
                return metrics || session;
            });
        } catch (error) {
            console.error('Error reading active sessions:', error);
            return [];
        }
    }
    getActiveSwarms() {
        if (!this.db) {
            this.init();
        }
        if (!this.db) {
            return [];
        }
        try {
            const swarms = this.db.prepare(`
          SELECT * FROM swarms 
          WHERE status = 'active'
          ORDER BY created_at DESC
        `).all();
            return swarms.map((swarm)=>{
                const metrics = this.getSwarmMetrics(swarm.id);
                return metrics || swarm;
            });
        } catch (error) {
            console.error('Error reading active swarms:', error);
            return [];
        }
    }
    getPerformanceMetrics() {
        if (!this.db) {
            this.init();
        }
        if (!this.db) {
            return null;
        }
        try {
            const overallTasks = this.db.prepare(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            AVG(CASE WHEN status = 'completed' AND completion_time IS NOT NULL 
                THEN (julianday(completion_time) - julianday(created_at)) * 24 * 60 
                ELSE NULL END) as avg_completion_minutes
          FROM tasks
        `).get();
            const agentPerformance = this.db.prepare(`
          SELECT 
            a.type,
            COUNT(DISTINCT a.id) as agent_count,
            COUNT(t.id) as tasks_assigned,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as tasks_completed
          FROM agents a
          LEFT JOIN tasks t ON a.id = t.agent_id
          GROUP BY a.type
          ORDER BY tasks_completed DESC
        `).all();
            const swarmPerformance = this.db.prepare(`
          SELECT 
            s.name,
            s.objective,
            COUNT(DISTINCT a.id) as agent_count,
            COUNT(DISTINCT t.id) as task_count,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_count
          FROM swarms s
          LEFT JOIN agents a ON s.id = a.swarm_id
          LEFT JOIN tasks t ON s.id = t.swarm_id
          WHERE s.status = 'active'
          GROUP BY s.id
          ORDER BY s.created_at DESC
          LIMIT 5
        `).all();
            return {
                overall_tasks: overallTasks,
                agent_performance: agentPerformance,
                swarm_performance: swarmPerformance,
                success_rate: overallTasks.total > 0 ? (overallTasks.completed / overallTasks.total * 100).toFixed(1) : 0
            };
        } catch (error) {
            console.error('Error reading performance metrics:', error);
            return null;
        }
    }
}

//# sourceMappingURL=metrics-reader.js.map