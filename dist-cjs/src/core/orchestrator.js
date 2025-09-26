import { SystemEvents } from '../utils/types.js';
import { SystemError, InitializationError, ShutdownError } from '../utils/errors.js';
import { delay, retry, circuitBreaker } from '../utils/helpers.js';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { ClaudeAPIClient } from '../api/claude-client.js';
import { ConfigManager } from '../config/config-manager.js';
let SessionManager = class SessionManager {
    terminalManager;
    memoryManager;
    eventBus;
    logger;
    config;
    sessions = new Map();
    sessionProfiles = new Map();
    persistencePath;
    persistenceCircuitBreaker;
    constructor(terminalManager, memoryManager, eventBus, logger, config){
        this.terminalManager = terminalManager;
        this.memoryManager = memoryManager;
        this.eventBus = eventBus;
        this.logger = logger;
        this.config = config;
        this.persistencePath = join(config.orchestrator.dataDir || './data', 'sessions.json');
        this.persistenceCircuitBreaker = circuitBreaker('SessionPersistence', {
            threshold: 5,
            timeout: 30000,
            resetTimeout: 60000
        });
    }
    async createSession(profile) {
        try {
            const terminalId = await retry(()=>this.terminalManager.spawnTerminal(profile), {
                maxAttempts: 3,
                initialDelay: 1000
            });
            const memoryBankId = await retry(()=>this.memoryManager.createBank(profile.id), {
                maxAttempts: 3,
                initialDelay: 1000
            });
            const session = {
                id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                agentId: profile.id,
                terminalId,
                startTime: new Date(),
                status: 'active',
                lastActivity: new Date(),
                memoryBankId
            };
            this.sessions.set(session.id, session);
            this.sessionProfiles.set(session.id, profile);
            this.logger.info('Session created', {
                sessionId: session.id,
                agentId: profile.id,
                terminalId,
                memoryBankId
            });
            this.persistSessions().catch((error)=>this.logger.error('Failed to persist sessions', error));
            return session;
        } catch (error) {
            this.logger.error('Failed to create session', {
                agentId: profile.id,
                error
            });
            throw new SystemError(`Failed to create session for agent ${profile.id}`, {
                error
            });
        }
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    getActiveSessions() {
        return Array.from(this.sessions.values()).filter((session)=>session.status === 'active' || session.status === 'idle');
    }
    async terminateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        try {
            session.status = 'terminated';
            session.endTime = new Date();
            await Promise.race([
                this.terminalManager.terminateTerminal(session.terminalId),
                delay(5000).then(()=>{
                    throw new Error('Terminal termination timeout');
                })
            ]).catch((error)=>{
                this.logger.error('Error terminating terminal', {
                    sessionId,
                    error
                });
            });
            await Promise.race([
                this.memoryManager.closeBank(session.memoryBankId),
                delay(5000).then(()=>{
                    throw new Error('Memory bank close timeout');
                })
            ]).catch((error)=>{
                this.logger.error('Error closing memory bank', {
                    sessionId,
                    error
                });
            });
            this.sessionProfiles.delete(sessionId);
            this.logger.info('Session terminated', {
                sessionId,
                duration: session.endTime.getTime() - session.startTime.getTime()
            });
            this.persistSessions().catch((error)=>this.logger.error('Failed to persist sessions', error));
        } catch (error) {
            this.logger.error('Error during session termination', {
                sessionId,
                error
            });
            throw error;
        }
    }
    async terminateAllSessions() {
        const sessions = this.getActiveSessions();
        const batchSize = 5;
        for(let i = 0; i < sessions.length; i += batchSize){
            const batch = sessions.slice(i, i + batchSize);
            await Promise.allSettled(batch.map((session)=>this.terminateSession(session.id)));
        }
    }
    removeSession(sessionId) {
        this.sessions.delete(sessionId);
        this.sessionProfiles.delete(sessionId);
    }
    async persistSessions() {
        if (!this.config.orchestrator.persistSessions) {
            return;
        }
        try {
            await this.persistenceCircuitBreaker.execute(async ()=>{
                const data = {
                    sessions: Array.from(this.sessions.values()).map((session)=>({
                            ...session,
                            profile: this.sessionProfiles.get(session.id)
                        })).filter((s)=>s.profile),
                    taskQueue: [],
                    metrics: {
                        completedTasks: 0,
                        failedTasks: 0,
                        totalTaskDuration: 0
                    },
                    savedAt: new Date()
                };
                await mkdir(dirname(this.persistencePath), {
                    recursive: true
                });
                await writeFile(this.persistencePath, JSON.stringify(data, null, 2), 'utf8');
                this.logger.debug('Sessions persisted', {
                    count: data.sessions.length
                });
            });
        } catch (error) {
            this.logger.error('Failed to persist sessions', error);
        }
    }
    async restoreSessions() {
        if (!this.config.orchestrator.persistSessions) {
            return;
        }
        try {
            const data = await readFile(this.persistencePath, 'utf8');
            const persistence = JSON.parse(data);
            const sessionsToRestore = persistence.sessions.filter((s)=>s.status === 'active' || s.status === 'idle');
            for (const sessionData of sessionsToRestore){
                try {
                    const session = await this.createSession(sessionData.profile);
                    Object.assign(session, {
                        id: sessionData.id,
                        startTime: new Date(sessionData.startTime),
                        lastActivity: new Date(sessionData.lastActivity)
                    });
                    this.logger.info('Session restored', {
                        sessionId: session.id
                    });
                } catch (error) {
                    this.logger.error('Failed to restore session', {
                        sessionId: sessionData.id,
                        error
                    });
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Failed to restore sessions', error);
            }
        }
    }
};
export class Orchestrator {
    config;
    terminalManager;
    memoryManager;
    coordinationManager;
    mcpServer;
    eventBus;
    logger;
    initialized = false;
    shutdownInProgress = false;
    sessionManager;
    healthCheckInterval;
    maintenanceInterval;
    metricsInterval;
    agents = new Map();
    taskQueue = [];
    taskHistory = new Map();
    startTime = Date.now();
    claudeClient;
    configManager;
    metrics = {
        completedTasks: 0,
        failedTasks: 0,
        totalTaskDuration: 0
    };
    healthCheckCircuitBreaker;
    taskAssignmentCircuitBreaker;
    constructor(config, terminalManager, memoryManager, coordinationManager, mcpServer, eventBus, logger){
        this.config = config;
        this.terminalManager = terminalManager;
        this.memoryManager = memoryManager;
        this.coordinationManager = coordinationManager;
        this.mcpServer = mcpServer;
        this.eventBus = eventBus;
        this.logger = logger;
        this.sessionManager = new SessionManager(terminalManager, memoryManager, eventBus, logger, config);
        this.configManager = ConfigManager.getInstance();
        this.healthCheckCircuitBreaker = circuitBreaker('HealthCheck', {
            threshold: 3,
            timeout: 10000,
            resetTimeout: 30000
        });
        this.taskAssignmentCircuitBreaker = circuitBreaker('TaskAssignment', {
            threshold: 5,
            timeout: 5000,
            resetTimeout: 20000
        });
    }
    async initialize() {
        if (this.initialized) {
            throw new InitializationError('Orchestrator already initialized');
        }
        this.logger.info('Initializing orchestrator...');
        const startTime = Date.now();
        try {
            await Promise.all([
                this.initializeComponent('Terminal Manager', ()=>this.terminalManager.initialize()),
                this.initializeComponent('Memory Manager', ()=>this.memoryManager.initialize()),
                this.initializeComponent('Coordination Manager', ()=>this.coordinationManager.initialize())
            ]);
            await this.initializeComponent('MCP Server', ()=>this.mcpServer.start());
            if (this.configManager.isClaudeAPIConfigured()) {
                try {
                    this.claudeClient = new ClaudeAPIClient(this.logger, this.configManager);
                    this.logger.info('Claude API client initialized', {
                        model: this.claudeClient.getConfig().model,
                        temperature: this.claudeClient.getConfig().temperature
                    });
                } catch (error) {
                    this.logger.warn('Failed to initialize Claude API client', error);
                }
            }
            await this.sessionManager.restoreSessions();
            this.setupEventHandlers();
            this.startHealthChecks();
            this.startMaintenanceTasks();
            this.startMetricsCollection();
            this.initialized = true;
            const initDuration = Date.now() - startTime;
            this.eventBus.emit(SystemEvents.SYSTEM_READY, {
                timestamp: new Date()
            });
            this.logger.info('Orchestrator initialized successfully', {
                duration: initDuration
            });
        } catch (error) {
            this.logger.error('Failed to initialize orchestrator', error);
            await this.emergencyShutdown();
            throw new InitializationError('Orchestrator', {
                error
            });
        }
    }
    async shutdown() {
        if (!this.initialized || this.shutdownInProgress) {
            return;
        }
        this.shutdownInProgress = true;
        this.logger.info('Shutting down orchestrator...');
        const shutdownStart = Date.now();
        try {
            this.stopBackgroundTasks();
            await this.sessionManager.persistSessions();
            await this.processShutdownTasks();
            await this.sessionManager.terminateAllSessions();
            await Promise.race([
                this.shutdownComponents(),
                delay(this.config.orchestrator.shutdownTimeout)
            ]);
            const shutdownDuration = Date.now() - shutdownStart;
            this.eventBus.emit(SystemEvents.SYSTEM_SHUTDOWN, {
                reason: 'Graceful shutdown'
            });
            this.logger.info('Orchestrator shutdown complete', {
                duration: shutdownDuration
            });
        } catch (error) {
            this.logger.error('Error during shutdown', error);
            await this.emergencyShutdown();
            throw new ShutdownError('Failed to shutdown gracefully', {
                error
            });
        } finally{
            this.initialized = false;
            this.shutdownInProgress = false;
        }
    }
    async spawnAgent(profile) {
        if (!this.initialized) {
            throw new SystemError('Orchestrator not initialized');
        }
        if (this.agents.size >= this.config.orchestrator.maxConcurrentAgents) {
            throw new SystemError('Maximum concurrent agents reached');
        }
        this.validateAgentProfile(profile);
        this.logger.info('Spawning agent', {
            agentId: profile.id,
            type: profile.type
        });
        try {
            const session = await retry(()=>this.sessionManager.createSession(profile), {
                maxAttempts: 3,
                initialDelay: 2000
            });
            this.agents.set(profile.id, profile);
            this.eventBus.emit(SystemEvents.AGENT_SPAWNED, {
                agentId: profile.id,
                profile,
                sessionId: session.id
            });
            this.startAgentHealthMonitoring(profile.id);
            return session.id;
        } catch (error) {
            this.logger.error('Failed to spawn agent', {
                agentId: profile.id,
                error
            });
            throw error;
        }
    }
    async terminateAgent(agentId) {
        if (!this.initialized) {
            throw new SystemError('Orchestrator not initialized');
        }
        const profile = this.agents.get(agentId);
        if (!profile) {
            throw new SystemError(`Agent not found: ${agentId}`);
        }
        this.logger.info('Terminating agent', {
            agentId
        });
        try {
            await this.cancelAgentTasks(agentId);
            const sessions = this.sessionManager.getActiveSessions().filter((session)=>session.agentId === agentId);
            await Promise.allSettled(sessions.map((session)=>this.sessionManager.terminateSession(session.id)));
            this.agents.delete(agentId);
            this.eventBus.emit(SystemEvents.AGENT_TERMINATED, {
                agentId,
                reason: 'User requested'
            });
        } catch (error) {
            this.logger.error('Failed to terminate agent', {
                agentId,
                error
            });
            throw error;
        }
    }
    async assignTask(task) {
        if (!this.initialized) {
            throw new SystemError('Orchestrator not initialized');
        }
        this.validateTask(task);
        this.taskHistory.set(task.id, task);
        try {
            await this.taskAssignmentCircuitBreaker.execute(async ()=>{
                if (!task.assignedAgent) {
                    if (this.taskQueue.length >= this.config.orchestrator.taskQueueSize) {
                        throw new SystemError('Task queue is full');
                    }
                    this.taskQueue.push(task);
                    this.eventBus.emit(SystemEvents.TASK_CREATED, {
                        task
                    });
                    await this.processTaskQueue();
                    return;
                }
                const agent = this.agents.get(task.assignedAgent);
                if (!agent) {
                    throw new SystemError(`Agent not found: ${task.assignedAgent}`);
                }
                await this.coordinationManager.assignTask(task, task.assignedAgent);
                this.eventBus.emit(SystemEvents.TASK_ASSIGNED, {
                    taskId: task.id,
                    agentId: task.assignedAgent
                });
            });
        } catch (error) {
            this.logger.error('Failed to assign task', {
                taskId: task.id,
                error
            });
            throw error;
        }
    }
    async getHealthStatus() {
        try {
            return await this.healthCheckCircuitBreaker.execute(async ()=>{
                const components = {};
                const [terminal, memory, coordination, mcp] = await Promise.allSettled([
                    this.getComponentHealth('Terminal Manager', async ()=>await this.terminalManager.getHealthStatus()),
                    this.getComponentHealth('Memory Manager', async ()=>await this.memoryManager.getHealthStatus()),
                    this.getComponentHealth('Coordination Manager', async ()=>await this.coordinationManager.getHealthStatus()),
                    this.getComponentHealth('MCP Server', async ()=>await this.mcpServer.getHealthStatus())
                ]);
                components.terminal = this.processHealthResult(terminal, 'Terminal Manager');
                components.memory = this.processHealthResult(memory, 'Memory Manager');
                components.coordination = this.processHealthResult(coordination, 'Coordination Manager');
                components.mcp = this.processHealthResult(mcp, 'MCP Server');
                components.orchestrator = {
                    name: 'Orchestrator',
                    status: 'healthy',
                    lastCheck: new Date(),
                    metrics: {
                        uptime: Date.now() - this.startTime,
                        activeAgents: this.agents.size,
                        queuedTasks: this.taskQueue.length,
                        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024
                    }
                };
                const statuses = Object.values(components).map((c)=>c.status);
                let overallStatus = 'healthy';
                if (statuses.some((s)=>s === 'unhealthy')) {
                    overallStatus = 'unhealthy';
                } else if (statuses.some((s)=>s === 'degraded')) {
                    overallStatus = 'degraded';
                }
                return {
                    status: overallStatus,
                    components,
                    timestamp: new Date()
                };
            });
        } catch (error) {
            this.logger.error('Health check failed', error);
            return {
                status: 'degraded',
                components: {
                    orchestrator: {
                        name: 'Orchestrator',
                        status: 'degraded',
                        lastCheck: new Date(),
                        error: 'Health check circuit breaker open'
                    }
                },
                timestamp: new Date()
            };
        }
    }
    async getMetrics() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        const avgTaskDuration = this.metrics.completedTasks > 0 ? this.metrics.totalTaskDuration / this.metrics.completedTasks : 0;
        return {
            uptime: Date.now() - this.startTime,
            totalAgents: this.agents.size,
            activeAgents: this.sessionManager.getActiveSessions().length,
            totalTasks: this.taskHistory.size,
            completedTasks: this.metrics.completedTasks,
            failedTasks: this.metrics.failedTasks,
            queuedTasks: this.taskQueue.length,
            avgTaskDuration,
            memoryUsage: memUsage,
            cpuUsage: cpuUsage,
            timestamp: new Date()
        };
    }
    async performMaintenance() {
        this.logger.debug('Performing maintenance tasks');
        try {
            await this.cleanupTerminatedSessions();
            await this.cleanupTaskHistory();
            await Promise.allSettled([
                this.terminalManager.performMaintenance(),
                this.memoryManager.performMaintenance(),
                this.coordinationManager.performMaintenance()
            ]);
            await this.sessionManager.persistSessions();
            if (global.gc) {
                global.gc();
            }
            this.logger.debug('Maintenance tasks completed');
        } catch (error) {
            this.logger.error('Error during maintenance', error);
        }
    }
    setupEventHandlers() {
        this.eventBus.on(SystemEvents.TASK_STARTED, (data)=>{
            const { taskId, agentId } = data;
            const task = this.taskHistory.get(taskId);
            if (task) {
                task.status = 'running';
                task.startedAt = new Date();
            }
        });
        this.eventBus.on(SystemEvents.TASK_COMPLETED, async (data)=>{
            const { taskId, result } = data;
            const task = this.taskHistory.get(taskId);
            if (task) {
                task.status = 'completed';
                task.completedAt = new Date();
                if (result !== undefined) {
                    task.output = result;
                }
                this.metrics.completedTasks++;
                if (task.startedAt) {
                    this.metrics.totalTaskDuration += task.completedAt.getTime() - task.startedAt.getTime();
                }
            }
            await this.processTaskQueue();
        });
        this.eventBus.on(SystemEvents.TASK_FAILED, async (data)=>{
            const { taskId, error } = data;
            const task = this.taskHistory.get(taskId);
            if (task) {
                task.status = 'failed';
                task.completedAt = new Date();
                task.error = error;
                this.metrics.failedTasks++;
            }
            await this.handleTaskFailure(taskId, error);
        });
        this.eventBus.on(SystemEvents.AGENT_ERROR, async (data)=>{
            const { agentId, error } = data;
            this.logger.error('Agent error', {
                agentId,
                error
            });
            await this.handleAgentError(agentId, error);
        });
        this.eventBus.on(SystemEvents.AGENT_IDLE, async (data)=>{
            const { agentId } = data;
            const sessions = this.sessionManager.getActiveSessions().filter((s)=>s.agentId === agentId);
            sessions.forEach((s)=>s.status = 'idle');
            await this.processTaskQueue();
        });
        this.eventBus.on(SystemEvents.SYSTEM_ERROR, (data)=>{
            const { error, component } = data;
            this.logger.error('System error', {
                component,
                error
            });
            this.handleSystemError(component, error);
        });
        this.eventBus.on(SystemEvents.DEADLOCK_DETECTED, (data)=>{
            const { agents, resources } = data;
            this.logger.error('Deadlock detected', {
                agents,
                resources
            });
            this.resolveDeadlock(agents, resources);
        });
    }
    startHealthChecks() {
        this.healthCheckInterval = setInterval(async ()=>{
            try {
                const health = await this.getHealthStatus();
                this.eventBus.emit(SystemEvents.SYSTEM_HEALTHCHECK, {
                    status: health
                });
                if (health.status === 'unhealthy') {
                    this.logger.warn('System health check failed', health);
                    await this.recoverUnhealthyComponents(health);
                }
            } catch (error) {
                this.logger.error('Health check error', error);
            }
        }, this.config.orchestrator.healthCheckInterval);
    }
    startMaintenanceTasks() {
        this.maintenanceInterval = setInterval(async ()=>{
            await this.performMaintenance();
        }, this.config.orchestrator.maintenanceInterval || 300000);
    }
    startMetricsCollection() {
        this.metricsInterval = setInterval(async ()=>{
            try {
                const metrics = await this.getMetrics();
                this.logger.debug('Metrics collected', metrics);
                this.eventBus.emit('metrics:collected', metrics);
            } catch (error) {
                this.logger.error('Metrics collection error', error);
            }
        }, this.config.orchestrator.metricsInterval || 60000);
    }
    stopBackgroundTasks() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
    }
    async shutdownComponents() {
        const shutdownTasks = [
            this.shutdownComponent('Terminal Manager', ()=>this.terminalManager.shutdown()),
            this.shutdownComponent('Memory Manager', ()=>this.memoryManager.shutdown()),
            this.shutdownComponent('Coordination Manager', ()=>this.coordinationManager.shutdown()),
            this.shutdownComponent('MCP Server', ()=>this.mcpServer.stop())
        ];
        const results = await Promise.allSettled(shutdownTasks);
        results.forEach((result, index)=>{
            if (result.status === 'rejected') {
                const componentName = [
                    'Terminal Manager',
                    'Memory Manager',
                    'Coordination Manager',
                    'MCP Server'
                ][index];
                this.logger.error(`Failed to shutdown ${componentName}`, result.reason);
            }
        });
    }
    async emergencyShutdown() {
        this.logger.warn('Performing emergency shutdown');
        try {
            await Promise.allSettled([
                this.terminalManager.shutdown().catch(()=>{}),
                this.memoryManager.shutdown().catch(()=>{}),
                this.coordinationManager.shutdown().catch(()=>{}),
                this.mcpServer.stop().catch(()=>{})
            ]);
        } catch (error) {
            this.logger.error('Emergency shutdown error', error);
        }
    }
    async processTaskQueue() {
        if (this.taskQueue.length === 0) {
            return;
        }
        const availableAgents = await this.getAvailableAgents();
        while(this.taskQueue.length > 0 && availableAgents.length > 0){
            const task = this.taskQueue.shift();
            const agent = this.selectAgentForTask(task, availableAgents);
            if (agent) {
                task.assignedAgent = agent.id;
                task.status = 'assigned';
                try {
                    await this.coordinationManager.assignTask(task, agent.id);
                    this.eventBus.emit(SystemEvents.TASK_ASSIGNED, {
                        taskId: task.id,
                        agentId: agent.id
                    });
                    const index = availableAgents.indexOf(agent);
                    availableAgents.splice(index, 1);
                } catch (error) {
                    this.taskQueue.unshift(task);
                    this.logger.error('Failed to assign task', {
                        taskId: task.id,
                        error
                    });
                    break;
                }
            } else {
                this.taskQueue.unshift(task);
                break;
            }
        }
    }
    async getAvailableAgents() {
        const sessions = this.sessionManager.getActiveSessions();
        const available = [];
        for (const session of sessions){
            if (session.status === 'idle' || session.status === 'active') {
                const profile = this.agents.get(session.agentId);
                if (profile) {
                    try {
                        const taskCount = await this.coordinationManager.getAgentTaskCount(profile.id);
                        if (taskCount < profile.maxConcurrentTasks) {
                            available.push(profile);
                        }
                    } catch (error) {
                        this.logger.error('Failed to get agent task count', {
                            agentId: profile.id,
                            error
                        });
                    }
                }
            }
        }
        return available.sort((a, b)=>b.priority - a.priority);
    }
    selectAgentForTask(task, agents) {
        const scoredAgents = agents.map((agent)=>{
            let score = agent.priority * 10;
            const requiredCapabilities = task.metadata?.requiredCapabilities || [];
            const matchedCapabilities = requiredCapabilities.filter((cap)=>agent.capabilities.includes(cap)).length;
            if (requiredCapabilities.length > 0 && matchedCapabilities === 0) {
                return {
                    agent,
                    score: -1
                };
            }
            score += matchedCapabilities * 5;
            if (task.type === agent.type) {
                score += 20;
            }
            return {
                agent,
                score
            };
        });
        const eligibleAgents = scoredAgents.filter(({ score })=>score >= 0);
        if (eligibleAgents.length === 0) {
            return undefined;
        }
        eligibleAgents.sort((a, b)=>b.score - a.score);
        return eligibleAgents[0].agent;
    }
    async getComponentHealth(name, check) {
        try {
            const result = await Promise.race([
                check(),
                delay(5000).then(()=>({
                        healthy: false,
                        error: 'Health check timeout'
                    }))
            ]);
            const health = {
                name,
                status: result.healthy ? 'healthy' : 'unhealthy',
                lastCheck: new Date()
            };
            if (result.error !== undefined) {
                health.error = result.error;
            }
            if ('metrics' in result && result.metrics !== undefined) {
                health.metrics = result.metrics;
            }
            return health;
        } catch (error) {
            return {
                name,
                status: 'unhealthy',
                lastCheck: new Date(),
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    processHealthResult(result, componentName) {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            return {
                name: componentName,
                status: 'unhealthy',
                lastCheck: new Date(),
                error: result.reason?.message || 'Health check failed'
            };
        }
    }
    async initializeComponent(name, init) {
        try {
            await retry(init, {
                maxAttempts: 3,
                initialDelay: 2000
            });
            this.logger.info(`${name} initialized`);
        } catch (error) {
            this.logger.error(`Failed to initialize ${name}`, error);
            throw new InitializationError(name, {
                error
            });
        }
    }
    async shutdownComponent(name, shutdown) {
        try {
            await Promise.race([
                shutdown(),
                delay(10000)
            ]);
            this.logger.info(`${name} shut down`);
        } catch (error) {
            this.logger.error(`Failed to shutdown ${name}`, error);
            throw error;
        }
    }
    validateAgentProfile(profile) {
        if (!profile.id || !profile.name || !profile.type) {
            throw new Error('Invalid agent profile: missing required fields');
        }
        if (profile.maxConcurrentTasks < 1) {
            throw new Error('Invalid agent profile: maxConcurrentTasks must be at least 1');
        }
        if (this.agents.has(profile.id)) {
            throw new Error(`Agent with ID ${profile.id} already exists`);
        }
    }
    validateTask(task) {
        if (!task.id || !task.type || !task.description) {
            throw new Error('Invalid task: missing required fields');
        }
        if (task.priority < 0 || task.priority > 100) {
            throw new Error('Invalid task: priority must be between 0 and 100');
        }
        if (this.taskHistory.has(task.id)) {
            throw new Error(`Task with ID ${task.id} already exists`);
        }
    }
    async handleAgentError(agentId, error) {
        const profile = this.agents.get(agentId);
        if (!profile) {
            return;
        }
        this.logger.error('Handling agent error', {
            agentId,
            error
        });
        const errorCount = profile.metadata?.errorCount || 0;
        profile.metadata = {
            ...profile.metadata,
            errorCount: errorCount + 1
        };
        if (errorCount < 3) {
            try {
                await this.terminateAgent(agentId);
                await delay(2000);
                await this.spawnAgent({
                    ...profile,
                    metadata: {
                        ...profile.metadata,
                        errorCount: 0
                    }
                });
                this.logger.info('Agent restarted after error', {
                    agentId
                });
            } catch (restartError) {
                this.logger.error('Failed to restart agent', {
                    agentId,
                    error: restartError
                });
            }
        } else {
            this.logger.error('Agent exceeded error threshold, terminating', {
                agentId,
                errorCount
            });
            await this.terminateAgent(agentId);
        }
    }
    async handleTaskFailure(taskId, error) {
        const task = this.taskHistory.get(taskId);
        if (!task) {
            return;
        }
        const retryCount = task.metadata?.retryCount || 0;
        const maxRetries = this.config.orchestrator.taskMaxRetries || 3;
        if (retryCount < maxRetries) {
            task.metadata = {
                ...task.metadata,
                retryCount: retryCount + 1
            };
            task.status = 'queued';
            delete task.assignedAgent;
            setTimeout(()=>{
                this.taskQueue.push(task);
                this.processTaskQueue();
            }, Math.pow(2, retryCount) * 1000);
            this.logger.info('Task queued for retry', {
                taskId,
                retryCount: retryCount + 1
            });
        } else {
            this.logger.error('Task exceeded retry limit', {
                taskId,
                retryCount
            });
        }
    }
    handleSystemError(component, error) {
        this.logger.error('Handling system error', {
            component,
            error
        });
    }
    async resolveDeadlock(agents, resources) {
        this.logger.warn('Resolving deadlock', {
            agents,
            resources
        });
        const agentProfiles = agents.map((id)=>this.agents.get(id)).filter(Boolean);
        if (agentProfiles.length === 0) {
            return;
        }
        agentProfiles.sort((a, b)=>a.priority - b.priority);
        const targetAgent = agentProfiles[0];
        await this.cancelAgentTasks(targetAgent.id);
        this.logger.info('Deadlock resolved by cancelling tasks', {
            agentId: targetAgent.id
        });
    }
    async cancelAgentTasks(agentId) {
        try {
            const tasks = await this.coordinationManager.getAgentTasks(agentId);
            for (const task of tasks){
                await this.coordinationManager.cancelTask(task.id);
                const trackedTask = this.taskHistory.get(task.id);
                if (trackedTask) {
                    trackedTask.status = 'cancelled';
                    trackedTask.completedAt = new Date();
                }
                this.eventBus.emit(SystemEvents.TASK_CANCELLED, {
                    taskId: task.id,
                    reason: 'Agent termination'
                });
            }
        } catch (error) {
            this.logger.error('Failed to cancel agent tasks', {
                agentId,
                error
            });
        }
    }
    startAgentHealthMonitoring(agentId) {}
    async recoverUnhealthyComponents(health) {
        for (const [name, component] of Object.entries(health.components)){
            if (component.status === 'unhealthy') {
                this.logger.warn('Attempting to recover unhealthy component', {
                    name
                });
                switch(name){
                    case 'Terminal Manager':
                        break;
                    case 'Memory Manager':
                        break;
                    case 'Coordination Manager':
                        break;
                    case 'MCP Server':
                        break;
                }
            }
        }
    }
    async cleanupTerminatedSessions() {
        const allSessions = this.sessionManager.getActiveSessions();
        const terminatedSessions = allSessions.filter((s)=>s.status === 'terminated');
        const cutoffTime = Date.now() - (this.config.orchestrator.sessionRetentionMs || 3600000);
        for (const session of terminatedSessions){
            const typedSession = session;
            if (typedSession.endTime && typedSession.endTime.getTime() < cutoffTime) {
                await this.sessionManager.terminateSession(typedSession.id);
                this.logger.debug('Cleaned up old session', {
                    sessionId: typedSession.id
                });
            }
        }
    }
    async cleanupTaskHistory() {
        const cutoffTime = Date.now() - (this.config.orchestrator.taskHistoryRetentionMs || 86400000);
        for (const [taskId, task] of this.taskHistory.entries()){
            if (task.completedAt && task.completedAt.getTime() < cutoffTime) {
                this.taskHistory.delete(taskId);
                this.logger.debug('Cleaned up old task', {
                    taskId
                });
            }
        }
    }
    async processShutdownTasks() {
        const criticalTasks = this.taskQueue.filter((t)=>t.priority >= 90 || t.metadata?.critical === true);
        if (criticalTasks.length > 0) {
            this.logger.info('Processing critical tasks before shutdown', {
                count: criticalTasks.length
            });
        }
    }
    getClaudeClient() {
        return this.claudeClient;
    }
    updateClaudeConfig(config) {
        this.configManager.setClaudeConfig(config);
        if (this.claudeClient) {
            this.claudeClient.updateConfig(config);
        } else if (this.configManager.isClaudeAPIConfigured()) {
            try {
                this.claudeClient = new ClaudeAPIClient(this.logger, this.configManager);
                this.logger.info('Claude API client initialized with new configuration');
            } catch (error) {
                this.logger.error('Failed to initialize Claude API client', error);
            }
        }
    }
    async executeClaudeRequest(prompt, options) {
        if (!this.claudeClient) {
            this.logger.error('Claude API client not initialized');
            return null;
        }
        try {
            const response = await this.claudeClient.complete(prompt, options);
            return response;
        } catch (error) {
            this.logger.error('Claude API request failed', error);
            return null;
        }
    }
}

//# sourceMappingURL=orchestrator.js.map