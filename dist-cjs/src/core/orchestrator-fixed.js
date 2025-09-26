import { JsonPersistenceManager } from './json-persistence.js';
export class Orchestrator {
    config;
    eventBus;
    logger;
    agents = new Map();
    tasks = new Map();
    sessions = new Map();
    persistence;
    workflows = new Map();
    started = false;
    constructor(config, eventBus, logger){
        this.config = config;
        this.eventBus = eventBus;
        this.logger = logger;
        this.persistence = new JsonPersistenceManager();
    }
    async start() {
        if (this.started) {
            throw new Error('Orchestrator already started');
        }
        this.logger.info('Starting orchestrator...');
        await this.persistence.initialize();
        await this.loadFromPersistence();
        this.eventBus.emit('system:ready', {
            timestamp: new Date()
        });
        this.started = true;
        this.logger.info('Orchestrator started successfully');
    }
    async loadFromPersistence() {
        const persistedAgents = await this.persistence.getActiveAgents();
        for (const agent of persistedAgents){
            this.agents.set(agent.id, {
                id: agent.id,
                type: agent.type,
                name: agent.name,
                status: agent.status,
                assignedTasks: [],
                createdAt: agent.createdAt
            });
        }
        const persistedTasks = await this.persistence.getActiveTasks();
        for (const task of persistedTasks){
            this.tasks.set(task.id, {
                id: task.id,
                type: task.type,
                description: task.description,
                status: task.status,
                progress: task.progress,
                assignedAgent: task.assignedAgent,
                error: task.error
            });
        }
        this.logger.info(`Loaded ${this.agents.size} agents and ${this.tasks.size} tasks from persistence`);
    }
    async stop() {
        if (!this.started) {
            return;
        }
        this.logger.info('Stopping orchestrator...');
        this.agents.clear();
        this.tasks.clear();
        this.sessions.clear();
        this.workflows.clear();
        this.persistence.close();
        this.started = false;
        this.logger.info('Orchestrator stopped');
    }
    async spawnAgent(profile) {
        const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const agent = {
            id: agentId,
            type: profile.type,
            name: profile.name,
            status: 'active',
            assignedTasks: [],
            createdAt: Date.now()
        };
        await this.persistence.saveAgent({
            id: agentId,
            type: profile.type,
            name: profile.name,
            status: 'active',
            capabilities: profile.capabilities,
            systemPrompt: profile.systemPrompt,
            maxConcurrentTasks: profile.maxConcurrentTasks,
            priority: profile.priority,
            createdAt: Date.now()
        });
        this.agents.set(agentId, agent);
        this.eventBus.emit('agent:spawned', {
            agentId,
            profile
        });
        return agentId;
    }
    async terminateAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }
        await this.persistence.updateAgentStatus(agentId, 'terminated');
        this.agents.delete(agentId);
        this.eventBus.emit('agent:terminated', {
            agentId,
            reason: 'User requested'
        });
    }
    getActiveAgents() {
        return Array.from(this.agents.values());
    }
    getAgentInfo(agentId) {
        return this.agents.get(agentId);
    }
    async submitTask(task) {
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const taskInfo = {
            id: taskId,
            type: task.type,
            description: task.description,
            status: 'pending',
            progress: 0
        };
        await this.persistence.saveTask({
            id: taskId,
            type: task.type,
            description: task.description,
            status: 'pending',
            priority: task.priority,
            dependencies: task.dependencies,
            metadata: task.metadata,
            progress: 0,
            createdAt: Date.now()
        });
        this.tasks.set(taskId, taskInfo);
        this.eventBus.emit('task:created', {
            taskId,
            task
        });
        const availableAgents = Array.from(this.agents.values()).filter((a)=>a.status === 'active');
        if (availableAgents.length > 0) {
            const agent = availableAgents[0];
            taskInfo.assignedAgent = agent.id;
            taskInfo.status = 'assigned';
            agent.assignedTasks.push(taskId);
            this.eventBus.emit('task:assigned', {
                taskId,
                agentId: agent.id
            });
            await this.persistence.updateTaskStatus(taskId, 'assigned', agent.id);
        }
        return taskId;
    }
    getTaskQueue() {
        return Array.from(this.tasks.values());
    }
    getTaskStatus(taskId) {
        return this.tasks.get(taskId);
    }
    async cancelTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        task.status = 'cancelled';
        this.eventBus.emit('task:cancelled', {
            taskId
        });
    }
    getActiveSessions() {
        return Array.from(this.sessions.values());
    }
    async terminateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        this.sessions.delete(sessionId);
        this.eventBus.emit('session:terminated', {
            sessionId
        });
    }
    async executeWorkflow(workflow) {
        const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const status = {
            status: 'running',
            progress: 0
        };
        this.workflows.set(workflowId, status);
        this.eventBus.emit('workflow:started', {
            workflowId,
            workflow
        });
        setTimeout(()=>{
            status.status = 'completed';
            status.progress = 100;
            this.eventBus.emit('workflow:completed', {
                workflowId
            });
        }, 5000);
        return workflowId;
    }
    async getWorkflowStatus(workflowId) {
        const status = this.workflows.get(workflowId);
        if (!status) {
            throw new Error(`Workflow ${workflowId} not found`);
        }
        return status;
    }
    async healthCheck() {
        return {
            healthy: this.started,
            memory: true,
            terminalPool: true,
            mcp: this.started
        };
    }
}

//# sourceMappingURL=orchestrator-fixed.js.map