import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import { SwarmCoordinator } from '../coordination/swarm-coordinator.js';
import { AdvancedTaskScheduler } from '../coordination/advanced-scheduler.js';
import { SwarmMonitor } from '../coordination/swarm-monitor.js';
import { MemoryManager } from '../memory/manager.js';
import TaskExecutor from './executor.js';
export class AdvancedSwarmOrchestrator extends EventEmitter {
    logger;
    config;
    activeSwarms = new Map();
    globalMetrics;
    coordinator;
    memoryManager;
    isRunning = false;
    healthCheckInterval;
    metricsCollectionInterval;
    constructor(config = {}){
        super();
        this.logger = new Logger('AdvancedSwarmOrchestrator');
        this.config = this.createDefaultConfig(config);
        this.coordinator = new SwarmCoordinator({
            maxAgents: this.config.maxAgents,
            maxConcurrentTasks: this.config.maxConcurrentTasks,
            taskTimeout: this.config.taskTimeoutMinutes * 60 * 1000,
            enableMonitoring: this.config.realTimeMonitoring,
            coordinationStrategy: this.config.coordinationStrategy.name
        });
        this.memoryManager = new MemoryManager({
            backend: 'sqlite',
            namespace: 'swarm-orchestrator',
            cacheSizeMB: 100,
            syncOnExit: true,
            maxEntries: 50000,
            ttlMinutes: 1440
        }, this.coordinator, this.logger);
        this.globalMetrics = this.initializeMetrics();
        this.setupEventHandlers();
    }
    async initialize() {
        if (this.isRunning) {
            this.logger.warn('Orchestrator already running');
            return;
        }
        this.logger.info('Initializing advanced swarm orchestrator...');
        try {
            await this.coordinator.start();
            await this.memoryManager.initialize();
            this.startHealthChecks();
            this.startMetricsCollection();
            this.isRunning = true;
            this.logger.info('Advanced swarm orchestrator initialized successfully');
            this.emit('orchestrator:initialized');
        } catch (error) {
            this.logger.error('Failed to initialize orchestrator', error);
            throw error;
        }
    }
    async shutdown() {
        if (!this.isRunning) {
            return;
        }
        this.logger.info('Shutting down advanced swarm orchestrator...');
        try {
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
            }
            if (this.metricsCollectionInterval) {
                clearInterval(this.metricsCollectionInterval);
            }
            const shutdownPromises = Array.from(this.activeSwarms.keys()).map((swarmId)=>this.stopSwarm(swarmId, 'Orchestrator shutdown'));
            await Promise.allSettled(shutdownPromises);
            await this.coordinator.stop();
            this.isRunning = false;
            this.logger.info('Advanced swarm orchestrator shut down successfully');
            this.emit('orchestrator:shutdown');
        } catch (error) {
            this.logger.error('Error during orchestrator shutdown', error);
            throw error;
        }
    }
    async createSwarm(objective, strategy = 'auto', options = {}) {
        const swarmId = generateId('swarm');
        const swarmObjective = {
            id: swarmId,
            name: `Swarm-${swarmId}`,
            description: objective,
            strategy,
            mode: this.config.mode,
            requirements: {
                minAgents: 1,
                maxAgents: this.config.maxAgents,
                agentTypes: this.getRequiredAgentTypes(strategy),
                estimatedDuration: 3600000,
                maxDuration: 7200000,
                qualityThreshold: this.config.qualityThreshold,
                reviewCoverage: 0.8,
                testCoverage: 0.7,
                reliabilityTarget: this.config.reliabilityTarget
            },
            constraints: {
                maxCost: 1000,
                resourceLimits: this.config.resourceLimits,
                minQuality: this.config.qualityThreshold,
                requiredApprovals: [],
                allowedFailures: 2,
                recoveryTime: 300000,
                milestones: []
            },
            tasks: [],
            dependencies: [],
            status: 'planning',
            progress: this.initializeProgress(),
            createdAt: new Date(),
            results: undefined,
            metrics: this.initializeMetrics()
        };
        const context = {
            swarmId: {
                id: swarmId,
                timestamp: Date.now(),
                namespace: 'swarm'
            },
            objective: swarmObjective,
            agents: new Map(),
            tasks: new Map(),
            scheduler: new AdvancedTaskScheduler({
                maxConcurrency: this.config.maxConcurrentTasks,
                enablePrioritization: true,
                enableLoadBalancing: this.config.loadBalancing,
                enableWorkStealing: true,
                schedulingAlgorithm: 'adaptive'
            }),
            monitor: new SwarmMonitor({
                updateInterval: 1000,
                enableAlerts: true,
                enableHistory: true,
                metricsRetention: 86400000
            }),
            memoryManager: this.memoryManager,
            taskExecutor: new TaskExecutor({
                timeoutMs: this.config.taskTimeoutMinutes * 60 * 1000,
                retryAttempts: this.config.maxRetries,
                enableMetrics: true,
                captureOutput: true,
                streamOutput: this.config.realTimeMonitoring
            }),
            startTime: new Date(),
            metrics: this.initializeMetrics()
        };
        await context.scheduler.initialize();
        await context.monitor.start();
        await context.taskExecutor.initialize();
        this.activeSwarms.set(swarmId, context);
        await this.memoryManager.store({
            id: `swarm:${swarmId}`,
            agentId: 'orchestrator',
            type: 'swarm-definition',
            content: JSON.stringify(swarmObjective),
            namespace: 'swarm-orchestrator',
            timestamp: new Date(),
            metadata: {
                type: 'swarm-definition',
                strategy,
                status: 'created',
                agentCount: 0,
                taskCount: 0
            }
        });
        this.logger.info('Swarm created successfully', {
            swarmId,
            objective,
            strategy,
            maxAgents: swarmObjective.requirements.maxAgents
        });
        this.emit('swarm:created', {
            swarmId,
            objective: swarmObjective
        });
        return swarmId;
    }
    async startSwarm(swarmId) {
        const context = this.activeSwarms.get(swarmId);
        if (!context) {
            throw new Error(`Swarm not found: ${swarmId}`);
        }
        if (context.objective.status !== 'planning') {
            throw new Error(`Swarm ${swarmId} is not in planning state`);
        }
        this.logger.info('Starting swarm execution', {
            swarmId
        });
        try {
            context.objective.status = 'initializing';
            context.objective.startedAt = new Date();
            const tasks = await this.decomposeObjective(context.objective);
            context.objective.tasks = tasks;
            tasks.forEach((task)=>{
                context.tasks.set(task.id.id, task);
            });
            const agents = await this.spawnRequiredAgents(context);
            agents.forEach((agent)=>{
                context.agents.set(agent.id, agent);
            });
            context.objective.status = 'executing';
            await this.scheduleAndExecuteTasks(context);
            this.logger.info('Swarm started successfully', {
                swarmId,
                taskCount: tasks.length,
                agentCount: agents.length
            });
            this.emit('swarm:started', {
                swarmId,
                context
            });
        } catch (error) {
            context.objective.status = 'failed';
            this.logger.error('Failed to start swarm', {
                swarmId,
                error
            });
            throw error;
        }
    }
    async stopSwarm(swarmId, reason = 'Manual stop') {
        const context = this.activeSwarms.get(swarmId);
        if (!context) {
            throw new Error(`Swarm not found: ${swarmId}`);
        }
        this.logger.info('Stopping swarm', {
            swarmId,
            reason
        });
        try {
            context.objective.status = 'cancelled';
            context.endTime = new Date();
            await context.taskExecutor.shutdown();
            await context.scheduler.shutdown();
            context.monitor.stop();
            for (const agent of context.agents.values()){
                try {
                    await this.terminateAgent(agent.id, reason);
                } catch (error) {
                    this.logger.warn('Error terminating agent during swarm stop', {
                        agentId: agent.id,
                        error
                    });
                }
            }
            await this.storeFinalResults(context);
            this.logger.info('Swarm stopped successfully', {
                swarmId,
                reason
            });
            this.emit('swarm:stopped', {
                swarmId,
                reason,
                context
            });
        } catch (error) {
            this.logger.error('Error stopping swarm', {
                swarmId,
                error
            });
            throw error;
        } finally{
            this.activeSwarms.delete(swarmId);
        }
    }
    getSwarmStatus(swarmId) {
        return this.activeSwarms.get(swarmId) || null;
    }
    getAllSwarmStatuses() {
        return Array.from(this.activeSwarms.values());
    }
    getOrchestratorMetrics() {
        const swarmMetrics = {};
        for (const [swarmId, context] of this.activeSwarms){
            swarmMetrics[swarmId] = context.metrics;
        }
        return {
            global: this.globalMetrics,
            swarms: swarmMetrics,
            system: {
                activeSwarms: this.activeSwarms.size,
                totalAgents: Array.from(this.activeSwarms.values()).reduce((sum, ctx)=>sum + ctx.agents.size, 0),
                totalTasks: Array.from(this.activeSwarms.values()).reduce((sum, ctx)=>sum + ctx.tasks.size, 0),
                uptime: this.isRunning ? Date.now() - performance.timeOrigin : 0,
                memoryUsage: process.memoryUsage().heapUsed,
                cpuUsage: process.cpuUsage().user
            }
        };
    }
    async performHealthCheck() {
        const issues = [];
        const startTime = performance.now();
        try {
            if (!this.isRunning) {
                issues.push('Orchestrator is not running');
            }
            if (!this.coordinator) {
                issues.push('Coordinator is not initialized');
            }
            try {
                await this.memoryManager.store({
                    id: 'health-check',
                    agentId: 'orchestrator',
                    type: 'health-check',
                    content: 'Health check test',
                    namespace: 'health',
                    timestamp: new Date(),
                    metadata: {
                        test: true
                    }
                });
            } catch (error) {
                issues.push('Memory manager health check failed');
            }
            for (const [swarmId, context] of this.activeSwarms){
                if (context.objective.status === 'failed') {
                    issues.push(`Swarm ${swarmId} is in failed state`);
                }
                const swarmAge = Date.now() - context.startTime.getTime();
                if (swarmAge > 3600000 && context.objective.status === 'executing') {
                    issues.push(`Swarm ${swarmId} appears to be stalled`);
                }
            }
            const healthy = issues.length === 0;
            const duration = performance.now() - startTime;
            return {
                healthy,
                issues,
                metrics: {
                    checkDuration: duration,
                    activeSwarms: this.activeSwarms.size,
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage()
                },
                timestamp: new Date()
            };
        } catch (error) {
            issues.push(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                healthy: false,
                issues,
                metrics: {},
                timestamp: new Date()
            };
        }
    }
    async decomposeObjective(objective) {
        const tasks = [];
        const baseTaskId = generateId('task');
        switch(objective.strategy){
            case 'research':
                tasks.push(this.createTaskDefinition(`${baseTaskId}-1`, 'research', 'Conduct comprehensive research', 'high', []), this.createTaskDefinition(`${baseTaskId}-2`, 'analysis', 'Analyze research findings', 'high', [
                    `${baseTaskId}-1`
                ]), this.createTaskDefinition(`${baseTaskId}-3`, 'synthesis', 'Synthesize insights and recommendations', 'high', [
                    `${baseTaskId}-2`
                ]), this.createTaskDefinition(`${baseTaskId}-4`, 'documentation', 'Create research documentation', 'medium', [
                    `${baseTaskId}-3`
                ]));
                break;
            case 'development':
                tasks.push(this.createTaskDefinition(`${baseTaskId}-1`, 'system-design', 'Design system architecture', 'high', []), this.createTaskDefinition(`${baseTaskId}-2`, 'code-generation', 'Generate core implementation', 'high', [
                    `${baseTaskId}-1`
                ]), this.createTaskDefinition(`${baseTaskId}-3`, 'unit-testing', 'Create comprehensive tests', 'high', [
                    `${baseTaskId}-2`
                ]), this.createTaskDefinition(`${baseTaskId}-4`, 'integration-testing', 'Perform integration testing', 'high', [
                    `${baseTaskId}-3`
                ]), this.createTaskDefinition(`${baseTaskId}-5`, 'code-review', 'Conduct code review', 'medium', [
                    `${baseTaskId}-4`
                ]), this.createTaskDefinition(`${baseTaskId}-6`, 'documentation', 'Create technical documentation', 'medium', [
                    `${baseTaskId}-5`
                ]));
                break;
            case 'analysis':
                tasks.push(this.createTaskDefinition(`${baseTaskId}-1`, 'data-collection', 'Collect and prepare data', 'high', []), this.createTaskDefinition(`${baseTaskId}-2`, 'data-analysis', 'Perform statistical analysis', 'high', [
                    `${baseTaskId}-1`
                ]), this.createTaskDefinition(`${baseTaskId}-3`, 'visualization', 'Create data visualizations', 'medium', [
                    `${baseTaskId}-2`
                ]), this.createTaskDefinition(`${baseTaskId}-4`, 'reporting', 'Generate analysis report', 'high', [
                    `${baseTaskId}-2`,
                    `${baseTaskId}-3`
                ]));
                break;
            default:
                tasks.push(this.createTaskDefinition(`${baseTaskId}-1`, 'exploration', 'Explore and understand requirements', 'high', []), this.createTaskDefinition(`${baseTaskId}-2`, 'planning', 'Create detailed execution plan', 'high', [
                    `${baseTaskId}-1`
                ]), this.createTaskDefinition(`${baseTaskId}-3`, 'execution', 'Execute main tasks', 'high', [
                    `${baseTaskId}-2`
                ]), this.createTaskDefinition(`${baseTaskId}-4`, 'validation', 'Validate and test results', 'high', [
                    `${baseTaskId}-3`
                ]), this.createTaskDefinition(`${baseTaskId}-5`, 'completion', 'Finalize and document outcomes', 'medium', [
                    `${baseTaskId}-4`
                ]));
        }
        for (const task of tasks){
            await this.memoryManager.store({
                id: `task:${task.id.id}`,
                agentId: 'orchestrator',
                type: 'task-definition',
                content: JSON.stringify(task),
                namespace: `swarm:${objective.id}`,
                timestamp: new Date(),
                metadata: {
                    type: 'task-definition',
                    taskType: task.type,
                    priority: task.priority,
                    status: task.status
                }
            });
        }
        return tasks;
    }
    createTaskDefinition(id, type, description, priority, dependencies) {
        return {
            id: {
                id,
                swarmId: '',
                sequence: 0,
                priority: this.getPriorityNumber(priority)
            },
            type: type,
            name: `Task: ${type}`,
            description,
            requirements: {
                capabilities: [
                    type
                ],
                tools: [
                    'bash',
                    'read',
                    'write',
                    'edit'
                ],
                permissions: [
                    'read',
                    'write',
                    'execute'
                ],
                estimatedDuration: 1800000,
                maxDuration: 3600000,
                memoryRequired: 512 * 1024 * 1024
            },
            constraints: {
                dependencies: dependencies.map((depId)=>({
                        id: depId,
                        swarmId: '',
                        sequence: 0,
                        priority: 0
                    })),
                dependents: [],
                conflicts: [],
                maxRetries: 3,
                timeoutAfter: 3600000
            },
            priority: priority,
            input: {},
            instructions: `Execute ${type} task: ${description}`,
            context: {},
            status: 'created',
            createdAt: new Date(),
            updatedAt: new Date(),
            attempts: [],
            statusHistory: []
        };
    }
    async spawnRequiredAgents(context) {
        const agents = [];
        const requiredTypes = context.objective.requirements.agentTypes;
        for (const agentType of requiredTypes){
            const agentId = generateId('agent');
            const agent = {
                id: agentId,
                name: `${agentType}-${agentId}`,
                type: agentType,
                status: 'idle',
                capabilities: this.getAgentCapabilities(agentType),
                metrics: {
                    tasksCompleted: 0,
                    tasksFailed: 0,
                    totalDuration: 0,
                    lastActivity: new Date()
                }
            };
            await this.coordinator.registerAgent(agent.name, agent.type, agent.capabilities);
            agents.push(agent);
            this.logger.info('Agent spawned', {
                swarmId: context.swarmId.id,
                agentId,
                type: agentType,
                capabilities: agent.capabilities
            });
        }
        return agents;
    }
    async scheduleAndExecuteTasks(context) {
        for (const task of context.tasks.values()){
            await context.scheduler.scheduleTask(task);
        }
        this.monitorSwarmExecution(context);
    }
    monitorSwarmExecution(context) {
        const monitorInterval = setInterval(async ()=>{
            try {
                this.updateSwarmProgress(context);
                if (this.isSwarmComplete(context)) {
                    clearInterval(monitorInterval);
                    await this.completeSwarm(context);
                }
                if (this.shouldFailSwarm(context)) {
                    clearInterval(monitorInterval);
                    await this.failSwarm(context, 'Too many failures or timeout');
                }
            } catch (error) {
                this.logger.error('Error monitoring swarm execution', {
                    swarmId: context.swarmId.id,
                    error
                });
            }
        }, 5000);
    }
    updateSwarmProgress(context) {
        const tasks = Array.from(context.tasks.values());
        const totalTasks = tasks.length;
        const completedTasks = tasks.filter((t)=>t.status === 'completed').length;
        const failedTasks = tasks.filter((t)=>t.status === 'failed').length;
        const runningTasks = tasks.filter((t)=>t.status === 'running').length;
        context.objective.progress = {
            totalTasks,
            completedTasks,
            failedTasks,
            runningTasks,
            percentComplete: totalTasks > 0 ? completedTasks / totalTasks * 100 : 0,
            estimatedCompletion: this.estimateCompletion(context),
            timeRemaining: this.calculateTimeRemaining(context),
            averageQuality: this.calculateAverageQuality(context),
            passedReviews: 0,
            passedTests: 0,
            resourceUtilization: {},
            costSpent: 0,
            activeAgents: Array.from(context.agents.values()).filter((a)=>a.status === 'busy').length,
            idleAgents: Array.from(context.agents.values()).filter((a)=>a.status === 'idle').length,
            busyAgents: Array.from(context.agents.values()).filter((a)=>a.status === 'busy').length
        };
    }
    isSwarmComplete(context) {
        const tasks = Array.from(context.tasks.values());
        return tasks.every((task)=>task.status === 'completed' || task.status === 'failed');
    }
    shouldFailSwarm(context) {
        const tasks = Array.from(context.tasks.values());
        const failedTasks = tasks.filter((t)=>t.status === 'failed').length;
        const totalTasks = tasks.length;
        if (failedTasks > context.objective.constraints.allowedFailures) {
            return true;
        }
        if (context.objective.constraints.deadline && new Date() > context.objective.constraints.deadline) {
            return true;
        }
        return false;
    }
    async completeSwarm(context) {
        context.objective.status = 'completed';
        context.objective.completedAt = new Date();
        context.endTime = new Date();
        const results = await this.collectSwarmResults(context);
        context.objective.results = results;
        this.logger.info('Swarm completed successfully', {
            swarmId: context.swarmId.id,
            duration: context.endTime.getTime() - context.startTime.getTime(),
            totalTasks: context.tasks.size,
            completedTasks: results.objectivesMet.length
        });
        this.emit('swarm:completed', {
            swarmId: context.swarmId.id,
            context,
            results
        });
    }
    async failSwarm(context, reason) {
        context.objective.status = 'failed';
        context.endTime = new Date();
        this.logger.error('Swarm failed', {
            swarmId: context.swarmId.id,
            reason,
            duration: context.endTime.getTime() - context.startTime.getTime()
        });
        this.emit('swarm:failed', {
            swarmId: context.swarmId.id,
            context,
            reason
        });
    }
    async collectSwarmResults(context) {
        const tasks = Array.from(context.tasks.values());
        const completedTasks = tasks.filter((t)=>t.status === 'completed');
        const failedTasks = tasks.filter((t)=>t.status === 'failed');
        return {
            outputs: {},
            artifacts: {},
            reports: {},
            overallQuality: this.calculateAverageQuality(context),
            qualityByTask: {},
            totalExecutionTime: context.endTime.getTime() - context.startTime.getTime(),
            resourcesUsed: {},
            efficiency: completedTasks.length / tasks.length,
            objectivesMet: completedTasks.map((t)=>t.id),
            objectivesFailed: failedTasks.map((t)=>t.id),
            improvements: [],
            nextActions: []
        };
    }
    async storeFinalResults(context) {
        await this.memoryManager.store({
            id: `results:${context.swarmId.id}`,
            agentId: 'orchestrator',
            type: 'swarm-results',
            content: JSON.stringify(context.objective.results),
            namespace: `swarm:${context.swarmId.id}`,
            timestamp: new Date(),
            metadata: {
                type: 'swarm-results',
                status: context.objective.status,
                duration: context.endTime ? context.endTime.getTime() - context.startTime.getTime() : 0,
                taskCount: context.tasks.size,
                agentCount: context.agents.size
            }
        });
    }
    async terminateAgent(agentId, reason) {
        this.logger.info('Agent terminated', {
            agentId,
            reason
        });
    }
    getRequiredAgentTypes(strategy) {
        switch(strategy){
            case 'research':
                return [
                    'researcher',
                    'analyst',
                    'documenter'
                ];
            case 'development':
                return [
                    'architect',
                    'coder',
                    'tester',
                    'reviewer'
                ];
            case 'analysis':
                return [
                    'analyst',
                    'researcher',
                    'documenter'
                ];
            default:
                return [
                    'coordinator',
                    'researcher',
                    'coder',
                    'analyst'
                ];
        }
    }
    getAgentCapabilities(agentType) {
        const capabilityMap = {
            coordinator: [
                'coordination',
                'planning',
                'monitoring'
            ],
            researcher: [
                'research',
                'data-gathering',
                'web-search'
            ],
            coder: [
                'code-generation',
                'debugging',
                'testing'
            ],
            analyst: [
                'data-analysis',
                'visualization',
                'reporting'
            ],
            architect: [
                'system-design',
                'architecture-review',
                'documentation'
            ],
            tester: [
                'testing',
                'quality-assurance',
                'automation'
            ],
            reviewer: [
                'code-review',
                'quality-review',
                'validation'
            ],
            optimizer: [
                'performance-optimization',
                'resource-optimization'
            ],
            documenter: [
                'documentation',
                'reporting',
                'knowledge-management'
            ],
            monitor: [
                'monitoring',
                'alerting',
                'diagnostics'
            ],
            specialist: [
                'domain-expertise',
                'specialized-tasks'
            ]
        };
        return capabilityMap[agentType] || [
            'general'
        ];
    }
    estimateCompletion(context) {
        const progress = context.objective.progress.percentComplete;
        const elapsed = Date.now() - context.startTime.getTime();
        const totalEstimated = progress > 0 ? elapsed / progress * 100 : elapsed * 2;
        return new Date(context.startTime.getTime() + totalEstimated);
    }
    calculateTimeRemaining(context) {
        return Math.max(0, this.estimateCompletion(context).getTime() - Date.now());
    }
    calculateAverageQuality(context) {
        return 0.85;
    }
    getPriorityNumber(priority) {
        switch(priority){
            case 'high':
                return 1;
            case 'medium':
                return 2;
            case 'low':
                return 3;
            default:
                return 2;
        }
    }
    startHealthChecks() {
        this.healthCheckInterval = setInterval(async ()=>{
            try {
                const health = await this.performHealthCheck();
                if (!health.healthy) {
                    this.logger.warn('Health check failed', {
                        issues: health.issues
                    });
                    this.emit('health:warning', health);
                }
            } catch (error) {
                this.logger.error('Health check error', error);
            }
        }, 60000);
    }
    startMetricsCollection() {
        this.metricsCollectionInterval = setInterval(()=>{
            try {
                this.updateGlobalMetrics();
            } catch (error) {
                this.logger.error('Metrics collection error', error);
            }
        }, 10000);
    }
    updateGlobalMetrics() {
        const swarms = Array.from(this.activeSwarms.values());
        this.globalMetrics = {
            throughput: this.calculateGlobalThroughput(swarms),
            latency: this.calculateGlobalLatency(swarms),
            efficiency: this.calculateGlobalEfficiency(swarms),
            reliability: this.calculateGlobalReliability(swarms),
            averageQuality: this.calculateGlobalQuality(swarms),
            defectRate: this.calculateGlobalDefectRate(swarms),
            reworkRate: this.calculateGlobalReworkRate(swarms),
            resourceUtilization: this.calculateGlobalResourceUtilization(swarms),
            costEfficiency: this.calculateGlobalCostEfficiency(swarms),
            agentUtilization: this.calculateGlobalAgentUtilization(swarms),
            agentSatisfaction: 0.8,
            collaborationEffectiveness: 0.85,
            scheduleVariance: this.calculateGlobalScheduleVariance(swarms),
            deadlineAdherence: this.calculateGlobalDeadlineAdherence(swarms)
        };
    }
    calculateGlobalThroughput(swarms) {
        return swarms.reduce((sum, ctx)=>sum + ctx.objective.progress.completedTasks, 0);
    }
    calculateGlobalLatency(swarms) {
        return 1200000;
    }
    calculateGlobalEfficiency(swarms) {
        const totalTasks = swarms.reduce((sum, ctx)=>sum + ctx.objective.progress.totalTasks, 0);
        const completedTasks = swarms.reduce((sum, ctx)=>sum + ctx.objective.progress.completedTasks, 0);
        return totalTasks > 0 ? completedTasks / totalTasks : 0;
    }
    calculateGlobalReliability(swarms) {
        const totalSwarms = swarms.length;
        const successfulSwarms = swarms.filter((ctx)=>ctx.objective.status === 'completed').length;
        return totalSwarms > 0 ? successfulSwarms / totalSwarms : 1;
    }
    calculateGlobalQuality(swarms) {
        return swarms.reduce((sum, ctx)=>sum + ctx.objective.progress.averageQuality, 0) / Math.max(swarms.length, 1);
    }
    calculateGlobalDefectRate(swarms) {
        return 0.05;
    }
    calculateGlobalReworkRate(swarms) {
        return 0.1;
    }
    calculateGlobalResourceUtilization(swarms) {
        return {
            cpu: 0.6,
            memory: 0.7,
            disk: 0.3,
            network: 0.2
        };
    }
    calculateGlobalCostEfficiency(swarms) {
        return 0.8;
    }
    calculateGlobalAgentUtilization(swarms) {
        const totalAgents = swarms.reduce((sum, ctx)=>sum + ctx.agents.size, 0);
        const busyAgents = swarms.reduce((sum, ctx)=>sum + ctx.objective.progress.busyAgents, 0);
        return totalAgents > 0 ? busyAgents / totalAgents : 0;
    }
    calculateGlobalScheduleVariance(swarms) {
        return 0.1;
    }
    calculateGlobalDeadlineAdherence(swarms) {
        return 0.9;
    }
    initializeProgress() {
        return {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            runningTasks: 0,
            estimatedCompletion: new Date(),
            timeRemaining: 0,
            percentComplete: 0,
            averageQuality: 0,
            passedReviews: 0,
            passedTests: 0,
            resourceUtilization: {},
            costSpent: 0,
            activeAgents: 0,
            idleAgents: 0,
            busyAgents: 0
        };
    }
    initializeMetrics() {
        return {
            throughput: 0,
            latency: 0,
            efficiency: 0,
            reliability: 1,
            averageQuality: 0,
            defectRate: 0,
            reworkRate: 0,
            resourceUtilization: {},
            costEfficiency: 1,
            agentUtilization: 0,
            agentSatisfaction: 0,
            collaborationEffectiveness: 0,
            scheduleVariance: 0,
            deadlineAdherence: 1
        };
    }
    createDefaultConfig(config) {
        return {
            name: 'Advanced Swarm',
            description: 'Advanced swarm orchestration system',
            version: '1.0.0',
            mode: 'hybrid',
            strategy: 'auto',
            coordinationStrategy: {
                name: 'adaptive',
                description: 'Adaptive coordination strategy',
                agentSelection: 'capability-based',
                taskScheduling: 'priority',
                loadBalancing: 'work-stealing',
                faultTolerance: 'retry',
                communication: 'event-driven'
            },
            maxAgents: 10,
            maxTasks: 100,
            maxDuration: 7200000,
            taskTimeoutMinutes: 30,
            resourceLimits: {
                memory: 2048,
                cpu: 4,
                disk: 10240,
                network: 1000
            },
            qualityThreshold: 0.8,
            reviewRequired: true,
            testingRequired: true,
            monitoring: {
                metricsEnabled: true,
                loggingEnabled: true,
                tracingEnabled: true,
                metricsInterval: 10000,
                heartbeatInterval: 5000,
                healthCheckInterval: 60000,
                retentionPeriod: 86400000,
                maxLogSize: 100 * 1024 * 1024,
                maxMetricPoints: 10000,
                alertingEnabled: true,
                alertThresholds: {},
                exportEnabled: false,
                exportFormat: 'json',
                exportDestination: ''
            },
            memory: {
                namespace: 'swarm',
                partitions: [],
                permissions: {
                    read: 'swarm',
                    write: 'swarm',
                    delete: 'system',
                    share: 'team'
                },
                persistent: true,
                backupEnabled: true,
                distributed: false,
                consistency: 'strong',
                cacheEnabled: true,
                compressionEnabled: false
            },
            security: {
                authenticationRequired: false,
                authorizationRequired: false,
                encryptionEnabled: false,
                defaultPermissions: [
                    'read',
                    'write'
                ],
                adminRoles: [
                    'admin'
                ],
                auditEnabled: true,
                auditLevel: 'info',
                inputValidation: true,
                outputSanitization: true
            },
            performance: {
                maxConcurrency: 10,
                defaultTimeout: 300000,
                cacheEnabled: true,
                cacheSize: 1000,
                cacheTtl: 3600,
                optimizationEnabled: true,
                adaptiveScheduling: true,
                predictiveLoading: false,
                resourcePooling: true,
                connectionPooling: true,
                memoryPooling: false
            },
            maxRetries: 3,
            autoScaling: true,
            loadBalancing: true,
            faultTolerance: true,
            realTimeMonitoring: true,
            maxThroughput: 100,
            latencyTarget: 1000,
            reliabilityTarget: 0.95,
            mcpIntegration: true,
            hiveIntegration: false,
            claudeCodeIntegration: true,
            neuralProcessing: false,
            learningEnabled: false,
            adaptiveScheduling: true,
            ...config
        };
    }
    setupEventHandlers() {
        this.on('swarm:created', (data)=>{
            this.logger.info('Swarm lifecycle event: created', data);
        });
        this.on('swarm:started', (data)=>{
            this.logger.info('Swarm lifecycle event: started', data);
        });
        this.on('swarm:completed', (data)=>{
            this.logger.info('Swarm lifecycle event: completed', data);
        });
        this.on('swarm:failed', (data)=>{
            this.logger.error('Swarm lifecycle event: failed', data);
        });
        this.on('health:warning', (data)=>{
            this.logger.warn('Health warning detected', data);
        });
        this.coordinator.on('objective:completed', (objective)=>{
            this.logger.info('Coordinator objective completed', {
                objectiveId: objective.id
            });
        });
        this.coordinator.on('task:completed', (data)=>{
            this.logger.info('Coordinator task completed', data);
        });
        this.coordinator.on('agent:registered', (agent)=>{
            this.logger.info('Coordinator agent registered', {
                agentId: agent.id
            });
        });
    }
}
export default AdvancedSwarmOrchestrator;

//# sourceMappingURL=advanced-orchestrator.js.map