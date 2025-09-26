export class HiveDashboard {
    orchestrator;
    protocol;
    refreshInterval = 1000;
    updateCallback;
    constructor(orchestrator, protocol){
        this.orchestrator = orchestrator;
        this.protocol = protocol;
    }
    startMonitoring(callback) {
        this.updateCallback = callback;
        this.update();
        const interval = setInterval(()=>{
            this.update();
        }, this.refreshInterval);
        return ()=>clearInterval(interval);
    }
    update() {
        const data = this.collectDashboardData();
        if (this.updateCallback) {
            this.updateCallback(data);
        }
    }
    collectDashboardData() {
        const perfMetrics = this.orchestrator.getPerformanceMetrics();
        const commStats = this.protocol.getStatistics();
        return {
            swarmId: 'current-swarm',
            status: this.determineSwarmStatus(perfMetrics),
            agents: this.getAgentStatuses(),
            tasks: this.getTaskProgress(),
            consensus: this.getConsensusMetrics(),
            communication: this.getCommunicationStats(commStats),
            performance: this.getPerformanceMetrics(perfMetrics),
            timestamp: Date.now()
        };
    }
    determineSwarmStatus(metrics) {
        if (metrics.executingTasks > 0) return 'executing';
        if (metrics.pendingTasks > 0) return 'active';
        if (metrics.completedTasks === metrics.totalTasks) return 'completed';
        return 'initializing';
    }
    getAgentStatuses() {
        return [
            {
                id: 'queen-1',
                name: 'Queen-Genesis',
                type: 'queen',
                status: 'thinking',
                workload: 85,
                votes: 15,
                contributions: 42
            },
            {
                id: 'architect-1',
                name: 'Architect-1',
                type: 'architect',
                status: 'executing',
                currentTask: 'Design system architecture',
                workload: 70,
                votes: 8,
                contributions: 23
            },
            {
                id: 'worker-1',
                name: 'Worker-1',
                type: 'worker',
                status: 'voting',
                workload: 45,
                votes: 12,
                contributions: 31
            }
        ];
    }
    getTaskProgress() {
        const taskGraph = this.orchestrator.getTaskGraph();
        return taskGraph.nodes.map((node)=>({
                id: node.id,
                type: node.type,
                description: `${node.type} task`,
                status: node.status,
                assignedTo: node.assignedTo,
                progress: this.calculateTaskProgress(node.status),
                dependencies: []
            }));
    }
    calculateTaskProgress(status) {
        switch(status){
            case 'completed':
                return 100;
            case 'executing':
                return 50;
            case 'assigned':
                return 25;
            case 'voting':
                return 10;
            case 'pending':
                return 0;
            default:
                return 0;
        }
    }
    getConsensusMetrics() {
        const metrics = this.orchestrator.getPerformanceMetrics();
        return {
            totalDecisions: metrics.totalDecisions,
            approvedDecisions: metrics.approvedDecisions,
            rejectedDecisions: metrics.totalDecisions - metrics.approvedDecisions,
            averageConsensus: metrics.consensusRate,
            currentVotes: []
        };
    }
    getCommunicationStats(stats) {
        return {
            totalMessages: stats.totalMessages,
            messageRate: stats.totalMessages / 10,
            channelActivity: stats.messagesByType,
            knowledgeShared: stats.knowledgeEntries
        };
    }
    getPerformanceMetrics(metrics) {
        return {
            tasksCompleted: metrics.completedTasks,
            tasksPending: metrics.pendingTasks,
            avgExecutionTime: metrics.avgExecutionTime,
            successRate: metrics.totalTasks > 0 ? metrics.completedTasks / metrics.totalTasks : 0,
            qualityScore: 0.85
        };
    }
    static formatConsoleOutput(data) {
        const output = [];
        output.push('🐝 Hive Mind Dashboard');
        output.push('═══════════════════════════════════════════════════════════════');
        output.push(`Status: ${data.status.toUpperCase()} | Time: ${new Date(data.timestamp).toLocaleTimeString()}`);
        output.push('');
        output.push('👥 Agent Status');
        output.push('───────────────────────────────────────────────────────────────');
        for (const agent of data.agents){
            const statusIcon = this.getStatusIcon(agent.status);
            const workloadBar = this.createProgressBar(agent.workload);
            output.push(`${statusIcon} ${agent.name} (${agent.type})`);
            output.push(`   Status: ${agent.status} | Workload: ${workloadBar} ${agent.workload}%`);
            if (agent.currentTask) {
                output.push(`   Task: ${agent.currentTask}`);
            }
            output.push(`   Votes: ${agent.votes} | Contributions: ${agent.contributions}`);
            output.push('');
        }
        output.push('📋 Task Progress');
        output.push('───────────────────────────────────────────────────────────────');
        for (const task of data.tasks){
            const progressBar = this.createProgressBar(task.progress);
            const statusIcon = this.getTaskStatusIcon(task.status);
            output.push(`${statusIcon} ${task.type}: ${task.description}`);
            output.push(`   Progress: ${progressBar} ${task.progress}%`);
            if (task.assignedTo) {
                output.push(`   Assigned to: ${task.assignedTo}`);
            }
            output.push('');
        }
        output.push('🗳️ Consensus Metrics');
        output.push('───────────────────────────────────────────────────────────────');
        output.push(`Total Decisions: ${data.consensus.totalDecisions}`);
        output.push(`Approved: ${data.consensus.approvedDecisions} | Rejected: ${data.consensus.rejectedDecisions}`);
        output.push(`Average Consensus: ${(data.consensus.averageConsensus * 100).toFixed(1)}%`);
        output.push('');
        output.push('📊 Performance');
        output.push('───────────────────────────────────────────────────────────────');
        output.push(`Tasks: ${data.performance.tasksCompleted}/${data.performance.tasksCompleted + data.performance.tasksPending} completed`);
        output.push(`Success Rate: ${(data.performance.successRate * 100).toFixed(1)}%`);
        output.push(`Quality Score: ${(data.performance.qualityScore * 100).toFixed(1)}%`);
        output.push(`Avg Execution Time: ${(data.performance.avgExecutionTime / 1000).toFixed(1)}s`);
        output.push('');
        output.push('💬 Communication');
        output.push('───────────────────────────────────────────────────────────────');
        output.push(`Total Messages: ${data.communication.totalMessages}`);
        output.push(`Message Rate: ${data.communication.messageRate.toFixed(1)}/min`);
        output.push(`Knowledge Shared: ${data.communication.knowledgeShared} entries`);
        return output.join('\\n');
    }
    static getStatusIcon(status) {
        switch(status){
            case 'idle':
                return '😴';
            case 'thinking':
                return '🤔';
            case 'voting':
                return '🗳️';
            case 'executing':
                return '⚡';
            case 'communicating':
                return '💬';
            default:
                return '❓';
        }
    }
    static getTaskStatusIcon(status) {
        switch(status){
            case 'pending':
                return '⭕';
            case 'voting':
                return '🗳️';
            case 'assigned':
                return '📌';
            case 'executing':
                return '🔄';
            case 'reviewing':
                return '🔍';
            case 'completed':
                return '✅';
            case 'failed':
                return '❌';
            default:
                return '❓';
        }
    }
    static createProgressBar(percentage, width = 20) {
        const filled = Math.round(percentage / 100 * width);
        const empty = width - filled;
        return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
    }
    exportData() {
        const data = this.collectDashboardData();
        return JSON.stringify(data, null, 2);
    }
    getEventStream() {
        return async function*() {
            while(true){
                yield {
                    type: 'update',
                    timestamp: Date.now()
                };
                await new Promise((resolve)=>setTimeout(resolve, 1000));
            }
        }();
    }
}

//# sourceMappingURL=hive-dashboard.js.map