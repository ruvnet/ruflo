import { Router } from 'express';
import { SwarmCoordinator } from '../swarm/coordinator.js';
import { ValidationError, SwarmError } from '../utils/errors.js';
import { nanoid } from 'nanoid';
export class SwarmApi {
    config;
    logger;
    claudeClient;
    configManager;
    coordinationManager;
    agentManager;
    resourceManager;
    router;
    swarms = new Map();
    constructor(config, logger, claudeClient, configManager, coordinationManager, agentManager, resourceManager){
        this.config = config;
        this.logger = logger;
        this.claudeClient = claudeClient;
        this.configManager = configManager;
        this.coordinationManager = coordinationManager;
        this.agentManager = agentManager;
        this.resourceManager = resourceManager;
        this.router = Router();
        this.setupRoutes();
        this.setupMiddleware();
    }
    getRouter() {
        return this.router;
    }
    setupMiddleware() {
        this.router.use((req, res, next)=>{
            this.logger.info('Swarm API request', {
                method: req.method,
                path: req.path,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            next();
        });
        this.router.use((req, res, next)=>{
            if (req.method === 'POST' || req.method === 'PUT') {
                if (!req.body) {
                    return res.status(400).json({
                        error: 'Request body is required',
                        code: 'MISSING_BODY'
                    });
                }
            }
            next();
        });
        this.router.use((err, req, res, next)=>{
            this.logger.error('Swarm API error', {
                error: err.message,
                stack: err.stack,
                method: req.method,
                path: req.path
            });
            if (err instanceof ValidationError) {
                return res.status(400).json({
                    error: err.message,
                    code: 'VALIDATION_ERROR',
                    details: err.details
                });
            }
            if (err instanceof SwarmError) {
                return res.status(409).json({
                    error: err.message,
                    code: 'SWARM_ERROR',
                    details: err.details
                });
            }
            res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR'
            });
        });
    }
    setupRoutes() {
        this.router.get('/health', async (req, res)=>{
            try {
                const health = await this.getSystemHealth();
                res.json(health);
            } catch (error) {
                res.status(500).json({
                    healthy: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });
        this.router.post('/swarms', this.createSwarm.bind(this));
        this.router.get('/swarms', this.listSwarms.bind(this));
        this.router.get('/swarms/:swarmId', this.getSwarm.bind(this));
        this.router.delete('/swarms/:swarmId', this.destroySwarm.bind(this));
        this.router.post('/swarms/:swarmId/scale', this.scaleSwarm.bind(this));
        this.router.post('/swarms/:swarmId/agents', this.spawnAgent.bind(this));
        this.router.get('/swarms/:swarmId/agents', this.listAgents.bind(this));
        this.router.get('/swarms/:swarmId/agents/:agentId', this.getAgent.bind(this));
        this.router.delete('/swarms/:swarmId/agents/:agentId', this.terminateAgent.bind(this));
        this.router.post('/swarms/:swarmId/tasks', this.orchestrateTask.bind(this));
        this.router.get('/swarms/:swarmId/tasks', this.listTasks.bind(this));
        this.router.get('/swarms/:swarmId/tasks/:taskId', this.getTask.bind(this));
        this.router.delete('/swarms/:swarmId/tasks/:taskId', this.cancelTask.bind(this));
        this.router.get('/swarms/:swarmId/metrics', this.getSwarmMetrics.bind(this));
        this.router.get('/swarms/:swarmId/status', this.getSwarmStatus.bind(this));
        this.router.get('/system/metrics', this.getSystemMetrics.bind(this));
    }
    async createSwarm(req, res) {
        try {
            const request = req.body;
            if (!request.name || !request.topology) {
                return res.status(400).json({
                    error: 'Name and topology are required',
                    code: 'VALIDATION_ERROR'
                });
            }
            const swarmConfig = {
                name: request.name,
                topology: request.topology,
                maxAgents: request.maxAgents || 8,
                strategy: request.strategy || 'balanced',
                ...request.config
            };
            const swarmId = `swarm_${Date.now()}_${nanoid(10)}`;
            const swarm = new SwarmCoordinator(swarmId, swarmConfig, this.logger, this.claudeClient, this.configManager, this.coordinationManager, this.agentManager, this.resourceManager);
            await swarm.initialize();
            this.swarms.set(swarmId, swarm);
            this.logger.info('Swarm created', {
                swarmId,
                name: request.name,
                topology: request.topology
            });
            res.status(201).json({
                swarmId,
                name: request.name,
                topology: request.topology,
                maxAgents: swarmConfig.maxAgents,
                strategy: swarmConfig.strategy,
                status: 'active',
                createdAt: new Date().toISOString()
            });
        } catch (error) {
            throw error;
        }
    }
    async listSwarms(req, res) {
        try {
            const swarmList = Array.from(this.swarms.entries()).map(([swarmId, swarm])=>({
                    swarmId,
                    name: swarm.getConfig().name,
                    topology: swarm.getConfig().topology,
                    agentCount: swarm.getAgentCount(),
                    status: swarm.getStatus(),
                    createdAt: swarm.getCreatedAt()
                }));
            res.json({
                swarms: swarmList,
                total: swarmList.length
            });
        } catch (error) {
            throw error;
        }
    }
    async getSwarm(req, res) {
        try {
            const { swarmId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const config = swarm.getConfig();
            const status = swarm.getStatus();
            const agents = await swarm.getAgents();
            const metrics = await swarm.getMetrics();
            res.json({
                swarmId,
                config,
                status,
                agents: agents.map((agent)=>({
                        id: agent.id,
                        type: agent.type,
                        name: agent.name,
                        status: agent.status,
                        capabilities: agent.capabilities
                    })),
                metrics,
                createdAt: swarm.getCreatedAt()
            });
        } catch (error) {
            throw error;
        }
    }
    async destroySwarm(req, res) {
        try {
            const { swarmId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            await swarm.destroy();
            this.swarms.delete(swarmId);
            this.logger.info('Swarm destroyed', {
                swarmId
            });
            res.json({
                message: 'Swarm destroyed successfully',
                swarmId
            });
        } catch (error) {
            throw error;
        }
    }
    async scaleSwarm(req, res) {
        try {
            const { swarmId } = req.params;
            const { targetSize } = req.body;
            if (!targetSize || targetSize < 1) {
                return res.status(400).json({
                    error: 'Valid targetSize is required',
                    code: 'VALIDATION_ERROR'
                });
            }
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            await swarm.scale(targetSize);
            res.json({
                message: 'Swarm scaled successfully',
                swarmId,
                newSize: targetSize
            });
        } catch (error) {
            throw error;
        }
    }
    async spawnAgent(req, res) {
        try {
            const { swarmId } = req.params;
            const request = req.body;
            if (!request.type) {
                return res.status(400).json({
                    error: 'Agent type is required',
                    code: 'VALIDATION_ERROR'
                });
            }
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const agent = await swarm.spawnAgent({
                type: request.type,
                name: request.name,
                capabilities: request.capabilities || [],
                config: request.config
            });
            res.status(201).json({
                agent: {
                    id: agent.id,
                    type: agent.type,
                    name: agent.name,
                    status: agent.status,
                    capabilities: agent.capabilities
                },
                swarmId
            });
        } catch (error) {
            throw error;
        }
    }
    async orchestrateTask(req, res) {
        try {
            const { swarmId } = req.params;
            const request = req.body;
            if (!request.task) {
                return res.status(400).json({
                    error: "Task description is required",
                    code: 'VALIDATION_ERROR'
                });
            }
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const task = await swarm.orchestrateTask({
                description: request.task,
                priority: request.priority || 'medium',
                strategy: request.strategy || 'adaptive',
                maxAgents: request.maxAgents,
                requirements: request.requirements,
                metadata: request.metadata
            });
            res.status(201).json({
                task: {
                    id: task.id,
                    description: task.description,
                    status: task.status,
                    priority: task.priority,
                    strategy: task.strategy
                },
                swarmId
            });
        } catch (error) {
            throw error;
        }
    }
    async getSwarmMetrics(req, res) {
        try {
            const { swarmId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const metrics = await swarm.getMetrics();
            res.json(metrics);
        } catch (error) {
            throw error;
        }
    }
    async getSwarmStatus(req, res) {
        try {
            const { swarmId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const status = await swarm.getDetailedStatus();
            res.json(status);
        } catch (error) {
            throw error;
        }
    }
    async getSystemHealth() {
        const services = {};
        let allHealthy = true;
        const claudeHealth = this.claudeClient.getHealthStatus();
        services.claude = {
            healthy: claudeHealth?.healthy || false,
            error: claudeHealth?.error
        };
        allHealthy = allHealthy && services.claude.healthy;
        const coordHealth = await this.coordinationManager.getHealthStatus();
        services.coordination = {
            healthy: coordHealth.healthy,
            error: coordHealth.error
        };
        allHealthy = allHealthy && services.coordination.healthy;
        const agentHealth = await this.agentManager.getHealthStatus();
        services.agents = {
            healthy: agentHealth.healthy,
            error: agentHealth.error
        };
        allHealthy = allHealthy && services.agents.healthy;
        const metrics = {
            totalSwarms: this.swarms.size,
            ...coordHealth.metrics,
            ...agentHealth.metrics
        };
        return {
            healthy: allHealthy,
            services,
            metrics
        };
    }
    async getSystemMetrics(req, res) {
        try {
            const systemMetrics = await this.getSystemHealth();
            const swarmMetrics = await Promise.all(Array.from(this.swarms.values()).map(async (swarm)=>{
                const metrics = await swarm.getMetrics();
                return {
                    swarmId: swarm.getId(),
                    ...metrics
                };
            }));
            res.json({
                system: systemMetrics,
                swarms: swarmMetrics,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            throw error;
        }
    }
    async listAgents(req, res) {
        try {
            const { swarmId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const agents = await swarm.getAgents();
            res.json({
                agents: agents.map((agent)=>({
                        id: agent.id,
                        type: agent.type,
                        name: agent.name,
                        status: agent.status,
                        capabilities: agent.capabilities,
                        createdAt: agent.createdAt
                    })),
                total: agents.length
            });
        } catch (error) {
            throw error;
        }
    }
    async getAgent(req, res) {
        try {
            const { swarmId, agentId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const agent = await swarm.getAgent(agentId);
            if (!agent) {
                return res.status(404).json({
                    error: 'Agent not found',
                    code: 'AGENT_NOT_FOUND'
                });
            }
            res.json(agent);
        } catch (error) {
            throw error;
        }
    }
    async terminateAgent(req, res) {
        try {
            const { swarmId, agentId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            await swarm.terminateAgent(agentId);
            res.json({
                message: 'Agent terminated successfully',
                agentId,
                swarmId
            });
        } catch (error) {
            throw error;
        }
    }
    async listTasks(req, res) {
        try {
            const { swarmId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const tasks = await swarm.getTasks();
            res.json({
                tasks: tasks.map((task)=>({
                        id: task.id,
                        description: task.description,
                        status: task.status,
                        priority: task.priority,
                        assignedTo: task.assignedTo,
                        createdAt: task.createdAt,
                        completedAt: task.completedAt
                    })),
                total: tasks.length
            });
        } catch (error) {
            throw error;
        }
    }
    async getTask(req, res) {
        try {
            const { swarmId, taskId } = req.params;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            const task = await swarm.getTask(taskId);
            if (!task) {
                return res.status(404).json({
                    error: 'Task not found',
                    code: 'TASK_NOT_FOUND'
                });
            }
            res.json(task);
        } catch (error) {
            throw error;
        }
    }
    async cancelTask(req, res) {
        try {
            const { swarmId, taskId } = req.params;
            const { reason } = req.body;
            const swarm = this.swarms.get(swarmId);
            if (!swarm) {
                return res.status(404).json({
                    error: 'Swarm not found',
                    code: 'SWARM_NOT_FOUND'
                });
            }
            await swarm.cancelTask(taskId, reason || 'User requested cancellation');
            res.json({
                message: 'Task cancelled successfully',
                taskId,
                swarmId
            });
        } catch (error) {
            throw error;
        }
    }
    async destroy() {
        this.logger.info('Destroying Swarm API');
        for (const [swarmId, swarm] of this.swarms){
            try {
                await swarm.destroy();
            } catch (error) {
                this.logger.error('Error destroying swarm', {
                    swarmId,
                    error
                });
            }
        }
        this.swarms.clear();
    }
}

//# sourceMappingURL=swarm-api.js.map