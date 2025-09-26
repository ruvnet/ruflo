import { EventEmitter } from 'node:events';
export class BaseAgent extends EventEmitter {
    id;
    type;
    status = 'initializing';
    capabilities;
    config;
    environment;
    metrics;
    workload = 0;
    health = 1.0;
    lastHeartbeat = new Date();
    currentTasks = [];
    taskHistory = [];
    errorHistory = [];
    collaborators = [];
    childAgents = [];
    endpoints = [];
    logger;
    eventBus;
    memory;
    heartbeatInterval;
    metricsInterval;
    isShuttingDown = false;
    constructor(id, type, config, environment, logger, eventBus, memory){
        super();
        this.id = id;
        this.type = type;
        this.logger = logger;
        this.eventBus = eventBus;
        this.memory = memory;
        this.capabilities = {
            ...this.getDefaultCapabilities(),
            ...config.capabilities
        };
        this.config = {
            ...this.getDefaultConfig(),
            ...config
        };
        this.environment = {
            ...this.getDefaultEnvironment(),
            ...environment
        };
        this.metrics = this.createDefaultMetrics();
        this.setupEventHandlers();
    }
    async initialize() {
        this.logger.info('Initializing agent', {
            agentId: this.id,
            type: this.type
        });
        this.status = 'initializing';
        this.emit('agent:status-changed', {
            agentId: this.id,
            status: this.status
        });
        this.startHeartbeat();
        this.startMetricsCollection();
        await this.saveState();
        this.status = 'idle';
        this.emit('agent:status-changed', {
            agentId: this.id,
            status: this.status
        });
        this.emit('agent:ready', {
            agentId: this.id
        });
        this.logger.info('Agent initialized successfully', {
            agentId: this.id,
            type: this.type
        });
    }
    async shutdown() {
        this.logger.info('Shutting down agent', {
            agentId: this.id,
            type: this.type
        });
        this.isShuttingDown = true;
        this.status = 'terminating';
        this.emit('agent:status-changed', {
            agentId: this.id,
            status: this.status
        });
        await this.waitForTasksCompletion();
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        await this.saveState();
        this.status = 'terminated';
        this.emit('agent:status-changed', {
            agentId: this.id,
            status: this.status
        });
        this.emit('agent:shutdown', {
            agentId: this.id
        });
        this.logger.info('Agent shutdown complete', {
            agentId: this.id,
            type: this.type
        });
    }
    async assignTask(task) {
        if (this.status !== 'idle') {
            throw new Error(`Agent ${this.id} is not available (status: ${this.status})`);
        }
        if (this.currentTasks.length >= this.capabilities.maxConcurrentTasks) {
            throw new Error(`Agent ${this.id} has reached maximum concurrent tasks`);
        }
        this.logger.info('Task assigned to agent', {
            agentId: this.id,
            taskId: task.id,
            taskType: task.type
        });
        this.currentTasks.push(task.id);
        this.status = 'busy';
        this.workload = this.currentTasks.length / this.capabilities.maxConcurrentTasks;
        this.emit('agent:task-assigned', {
            agentId: this.id,
            taskId: task.id
        });
        this.emit('agent:status-changed', {
            agentId: this.id,
            status: this.status
        });
        try {
            const startTime = Date.now();
            const result = await this.executeTask(task);
            const executionTime = Date.now() - startTime;
            this.updateTaskMetrics(task.id, executionTime, true);
            this.currentTasks = this.currentTasks.filter((id)=>id !== task.id);
            this.taskHistory.push(task.id);
            this.status = this.currentTasks.length > 0 ? 'busy' : 'idle';
            this.workload = this.currentTasks.length / this.capabilities.maxConcurrentTasks;
            this.emit('agent:task-completed', {
                agentId: this.id,
                taskId: task.id,
                result,
                executionTime
            });
            this.logger.info('Task completed successfully', {
                agentId: this.id,
                taskId: task.id,
                executionTime
            });
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.updateTaskMetrics(task.id, 0, false);
            this.addError({
                timestamp: new Date(),
                type: 'task_execution_failed',
                message: errorMessage,
                context: {
                    taskId: task.id,
                    taskType: task.type
                },
                severity: 'high',
                resolved: false
            });
            this.currentTasks = this.currentTasks.filter((id)=>id !== task.id);
            this.status = this.currentTasks.length > 0 ? 'busy' : 'idle';
            this.workload = this.currentTasks.length / this.capabilities.maxConcurrentTasks;
            this.emit('agent:task-failed', {
                agentId: this.id,
                taskId: task.id,
                error: errorMessage
            });
            this.logger.error('Task execution failed', {
                agentId: this.id,
                taskId: task.id,
                error: errorMessage
            });
            throw error;
        }
    }
    getAgentInfo() {
        return {
            id: {
                id: this.id,
                swarmId: 'default',
                type: this.type,
                instance: 1
            },
            name: `${this.type}-${this.id.slice(-8)}`,
            type: this.type,
            status: this.status,
            capabilities: this.capabilities,
            config: this.config,
            environment: this.environment,
            metrics: this.metrics,
            workload: this.workload,
            health: this.health,
            lastHeartbeat: this.lastHeartbeat,
            currentTasks: this.currentTasks,
            taskHistory: this.taskHistory,
            errorHistory: this.errorHistory,
            collaborators: this.collaborators,
            childAgents: this.childAgents,
            endpoints: this.endpoints
        };
    }
    getAgentStatus() {
        return {
            id: this.id,
            type: this.type,
            status: this.status,
            health: this.health,
            workload: this.workload,
            currentTasks: this.currentTasks.length,
            totalTasksCompleted: this.metrics.tasksCompleted,
            successRate: this.metrics.successRate,
            averageExecutionTime: this.metrics.averageExecutionTime,
            lastActivity: this.metrics.lastActivity,
            uptime: Date.now() - this.metrics.totalUptime
        };
    }
    getCurrentTasks() {
        return [
            ...this.currentTasks
        ];
    }
    getTaskHistory() {
        return [
            ...this.taskHistory
        ];
    }
    getErrorHistory() {
        return [
            ...this.errorHistory
        ];
    }
    getLastTaskCompletedTime() {
        return this.metrics.lastActivity;
    }
    updateHealth(health) {
        this.health = Math.max(0, Math.min(1, health));
        this.emit('agent:health-changed', {
            agentId: this.id,
            health: this.health
        });
    }
    addCollaborator(agentId) {
        if (!this.collaborators.find((c)=>c.id === agentId.id)) {
            this.collaborators.push(agentId);
            this.emit('agent:collaborator-added', {
                agentId: this.id,
                collaborator: agentId
            });
        }
    }
    removeCollaborator(agentId) {
        this.collaborators = this.collaborators.filter((c)=>c.id !== agentId);
        this.emit('agent:collaborator-removed', {
            agentId: this.id,
            collaborator: agentId
        });
    }
    getDefaultEnvironment() {
        return {
            runtime: 'deno',
            version: '1.40.0',
            workingDirectory: `./agents/${this.type}`,
            tempDirectory: `./tmp/${this.type}`,
            logDirectory: `./logs/${this.type}`,
            apiEndpoints: {},
            credentials: {},
            availableTools: [],
            toolConfigs: {}
        };
    }
    createDefaultMetrics() {
        return {
            tasksCompleted: 0,
            tasksFailed: 0,
            averageExecutionTime: 0,
            successRate: 1.0,
            cpuUsage: 0,
            memoryUsage: 0,
            diskUsage: 0,
            networkUsage: 0,
            codeQuality: 0.8,
            testCoverage: 0,
            bugRate: 0,
            userSatisfaction: 0.8,
            totalUptime: Date.now(),
            lastActivity: new Date(),
            responseTime: 0
        };
    }
    setupEventHandlers() {
        this.eventBus.on('system:shutdown', ()=>{
            if (!this.isShuttingDown) {
                this.shutdown().catch((error)=>{
                    this.logger.error('Error during agent shutdown', {
                        agentId: this.id,
                        error: error instanceof Error ? error.message : String(error)
                    });
                });
            }
        });
    }
    startHeartbeat() {
        this.heartbeatInterval = setInterval(()=>{
            if (!this.isShuttingDown) {
                this.sendHeartbeat();
            }
        }, this.config.heartbeatInterval || 10000);
    }
    startMetricsCollection() {
        this.metricsInterval = setInterval(()=>{
            if (!this.isShuttingDown) {
                this.collectMetrics();
            }
        }, 30000);
    }
    sendHeartbeat() {
        this.lastHeartbeat = new Date();
        this.eventBus.emit('agent:heartbeat', {
            agentId: this.id,
            timestamp: this.lastHeartbeat,
            metrics: this.metrics
        });
    }
    async collectMetrics() {
        const recentTasksTime = this.getRecentTasksAverageTime();
        this.metrics.responseTime = recentTasksTime;
        if (this.currentTasks.length > 0) {
            this.metrics.lastActivity = new Date();
        }
        const totalTasks = this.metrics.tasksCompleted + this.metrics.tasksFailed;
        if (totalTasks > 0) {
            this.metrics.successRate = this.metrics.tasksCompleted / totalTasks;
        }
        await this.memory.store(`agent:${this.id}:metrics`, this.metrics, {
            type: 'agent-metrics',
            tags: [
                'metrics',
                this.type,
                this.id
            ],
            partition: 'metrics'
        });
    }
    updateTaskMetrics(taskId, executionTime, success) {
        if (success) {
            this.metrics.tasksCompleted++;
            const totalTime = this.metrics.averageExecutionTime * (this.metrics.tasksCompleted - 1) + executionTime;
            this.metrics.averageExecutionTime = totalTime / this.metrics.tasksCompleted;
        } else {
            this.metrics.tasksFailed++;
        }
        this.metrics.lastActivity = new Date();
    }
    addError(error) {
        this.errorHistory.push(error);
        if (this.errorHistory.length > 50) {
            this.errorHistory.shift();
        }
        this.eventBus.emit('agent:error', {
            agentId: this.id,
            error
        });
        const healthImpact = {
            low: 0.01,
            medium: 0.05,
            high: 0.1,
            critical: 0.2
        }[error.severity] || 0.05;
        this.updateHealth(this.health - healthImpact);
    }
    getRecentTasksAverageTime() {
        return this.metrics.averageExecutionTime;
    }
    async waitForTasksCompletion() {
        if (this.currentTasks.length === 0) return;
        return new Promise((resolve)=>{
            const checkTasks = ()=>{
                if (this.currentTasks.length === 0) {
                    resolve();
                } else {
                    setTimeout(checkTasks, 1000);
                }
            };
            checkTasks();
        });
    }
    async saveState() {
        try {
            await this.memory.store(`agent:${this.id}:state`, this.getAgentInfo(), {
                type: 'agent-state',
                tags: [
                    'state',
                    this.type,
                    this.id
                ],
                partition: 'state'
            });
        } catch (error) {
            this.logger.error('Failed to save agent state', {
                agentId: this.id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

//# sourceMappingURL=base-agent.js.map