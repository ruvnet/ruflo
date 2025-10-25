import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
export class MetricsReader {
    metricsDir = '.claude-flow/metrics';
    sessionsDir = '.claude-flow/sessions';
    async getSystemMetrics() {
        try {
            const filePath = path.join(this.metricsDir, 'system-metrics.json');
            const content = await fs.readFile(filePath, 'utf8');
            const metrics = JSON.parse(content);
            return metrics.length > 0 ? metrics[metrics.length - 1] : null;
        } catch (error) {
            return null;
        }
    }
    async getTaskMetrics() {
        try {
            const filePath = path.join(this.metricsDir, 'task-metrics.json');
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return [];
        }
    }
    async getPerformanceMetrics() {
        try {
            const filePath = path.join(this.metricsDir, 'performance.json');
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }
    async getActiveAgents() {
        try {
            const perfMetrics = await this.getPerformanceMetrics();
            const sessionFiles = await this.getSessionFiles();
            const agents = [];
            for (const file of sessionFiles){
                try {
                    const content = await fs.readFile(path.join(this.sessionsDir, 'pair', file), 'utf8');
                    const sessionData = JSON.parse(content);
                    if (sessionData.agents && Array.isArray(sessionData.agents)) {
                        agents.push(...sessionData.agents);
                    }
                } catch  {}
            }
            if (agents.length === 0 && perfMetrics) {
                const activeCount = perfMetrics.activeAgents || 0;
                const totalCount = perfMetrics.totalAgents || 0;
                for(let i = 0; i < totalCount; i++){
                    agents.push({
                        id: `agent-${i + 1}`,
                        name: `Agent ${i + 1}`,
                        type: i === 0 ? 'orchestrator' : 'worker',
                        status: i < activeCount ? 'active' : 'idle',
                        activeTasks: i < activeCount ? 1 : 0,
                        lastActivity: Date.now() - i * 1000
                    });
                }
            }
            return agents;
        } catch (error) {
            return [];
        }
    }
    async getSessionStatus() {
        try {
            const sessionFiles = await this.getSessionFiles();
            if (sessionFiles.length === 0) {
                return null;
            }
            const mostRecentFile = sessionFiles[sessionFiles.length - 1];
            const content = await fs.readFile(path.join(this.sessionsDir, 'pair', mostRecentFile), 'utf8');
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }
    async getRecentTasks(limit = 10) {
        try {
            const taskMetrics = await this.getTaskMetrics();
            return taskMetrics.sort((a, b)=>b.timestamp - a.timestamp).slice(0, limit).map((task)=>({
                    id: task.id,
                    type: task.type,
                    status: task.success ? 'completed' : 'failed',
                    startTime: task.timestamp - task.duration,
                    endTime: task.timestamp,
                    duration: task.duration
                }));
        } catch (error) {
            return [];
        }
    }
    async getOverallHealth() {
        try {
            const systemMetrics = await this.getSystemMetrics();
            const perfMetrics = await this.getPerformanceMetrics();
            if (!systemMetrics && !perfMetrics) {
                return 'error';
            }
            if (systemMetrics && systemMetrics.memoryUsagePercent > 90) {
                return 'error';
            }
            if (systemMetrics && systemMetrics.memoryUsagePercent > 75) {
                return 'warning';
            }
            if (systemMetrics && systemMetrics.cpuLoad > 0.8) {
                return 'warning';
            }
            if (perfMetrics && perfMetrics.totalTasks > 0) {
                const failureRate = perfMetrics.failedTasks / perfMetrics.totalTasks;
                if (failureRate > 0.5) {
                    return 'error';
                }
                if (failureRate > 0.2) {
                    return 'warning';
                }
            }
            return 'healthy';
        } catch (error) {
            return 'error';
        }
    }
    async getSessionFiles() {
        try {
            const files = await fs.readdir(path.join(this.sessionsDir, 'pair'));
            return files.filter((f)=>f.endsWith('.json')).sort();
        } catch (error) {
            return [];
        }
    }
    async getMCPServerStatus() {
        try {
            const { stdout } = await execAsync('ps aux | grep -E "mcp-server\\.js|claude-flow mcp start" | grep -v grep | wc -l');
            const processCount = parseInt(stdout.trim(), 10);
            const { stdout: orchestratorOut } = await execAsync('ps aux | grep -E "claude-flow start" | grep -v grep | wc -l');
            const orchestratorRunning = parseInt(orchestratorOut.trim(), 10) > 0;
            const isRunning = processCount > 0;
            let port = 3000;
            try {
                const { stdout: portOut } = await execAsync('lsof -i :3000 2>/dev/null | grep LISTEN | wc -l');
                if (parseInt(portOut.trim(), 10) === 0) {
                    port = null;
                }
            } catch  {}
            return {
                running: isRunning,
                processCount,
                orchestratorRunning,
                port,
                connections: processCount > 0 ? Math.max(1, processCount - 1) : 0
            };
        } catch (error) {
            return {
                running: false,
                processCount: 0,
                orchestratorRunning: false,
                port: null,
                connections: 0
            };
        }
    }
}

//# sourceMappingURL=metrics-reader.js.map               processCount: 0,
                orchestratorRunning: false,
                port: null,
                connections: 0
            };
        }
    }
};
export { MetricsReader };

//# sourceMappingURL=metrics-reader.js.map