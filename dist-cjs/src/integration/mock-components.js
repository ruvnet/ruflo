export class MockConfigManager {
    config = {};
    static getInstance() {
        return new MockConfigManager();
    }
    async load() {
        this.config = {
            agents: {
                maxAgents: 10
            },
            swarm: {
                topology: 'mesh'
            },
            memory: {
                backend: 'memory'
            }
        };
    }
    get(path) {
        const keys = path.split('.');
        let value = this.config;
        for (const key of keys){
            value = value?.[key];
            if (value === undefined) break;
        }
        return value;
    }
    set(path, value) {
        const keys = path.split('.');
        let obj = this.config;
        for(let i = 0; i < keys.length - 1; i++){
            const key = keys[i];
            if (!(key in obj)) {
                obj[key] = {};
            }
            obj = obj[key];
        }
        obj[keys[keys.length - 1]] = value;
    }
    async initialize() {
        await this.load();
    }
    async shutdown() {}
    healthCheck() {
        return Promise.resolve({
            component: 'configManager',
            healthy: true,
            message: 'Mock config manager healthy',
            timestamp: Date.now()
        });
    }
}
export class MockMemoryManager {
    storage = new Map();
    async initialize() {}
    async shutdown() {}
    async get(key) {
        return this.storage.get(key) || null;
    }
    async set(key, value) {
        this.storage.set(key, value);
    }
    async delete(key) {
        return this.storage.delete(key);
    }
    async keys(pattern) {
        const allKeys = Array.from(this.storage.keys());
        if (!pattern) return allKeys;
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return allKeys.filter((key)=>regex.test(key));
    }
    healthCheck() {
        return Promise.resolve({
            component: 'memoryManager',
            healthy: true,
            message: 'Mock memory manager healthy',
            timestamp: Date.now()
        });
    }
    getMetrics() {
        return Promise.resolve({
            storageSize: this.storage.size,
            memoryUsage: process.memoryUsage().heapUsed
        });
    }
}
export class MockAgentManager {
    eventBus;
    logger;
    agents = new Map();
    constructor(eventBus, logger){
        this.eventBus = eventBus;
        this.logger = logger;
    }
    async initialize() {}
    async shutdown() {}
    async spawnAgent(type, config) {
        const agentId = `mock-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.agents.set(agentId, {
            id: agentId,
            type,
            config,
            status: 'active',
            createdAt: new Date()
        });
        return agentId;
    }
    async terminateAgent(agentId) {
        this.agents.delete(agentId);
    }
    async listAgents() {
        return Array.from(this.agents.values());
    }
    async getAgent(agentId) {
        return this.agents.get(agentId) || null;
    }
    async sendMessage(message) {
        return {
            success: true,
            id: `msg-${Date.now()}`
        };
    }
    healthCheck() {
        return Promise.resolve({
            component: 'agentManager',
            healthy: true,
            message: 'Mock agent manager healthy',
            timestamp: Date.now()
        });
    }
    getMetrics() {
        return Promise.resolve({
            activeAgents: this.agents.size,
            totalAgents: this.agents.size
        });
    }
}
export class MockSwarmCoordinator {
    eventBus;
    logger;
    memoryManager;
    swarms = new Map();
    constructor(eventBus, logger, memoryManager){
        this.eventBus = eventBus;
        this.logger = logger;
        this.memoryManager = memoryManager;
    }
    async initialize() {}
    async shutdown() {}
    async createSwarm(config) {
        const swarmId = `mock-swarm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.swarms.set(swarmId, {
            id: swarmId,
            config,
            status: 'active',
            agents: [],
            createdAt: new Date()
        });
        return swarmId;
    }
    async getSwarmStatus(swarmId) {
        const swarm = this.swarms.get(swarmId);
        return swarm || null;
    }
    async spawnAgentInSwarm(swarmId, agentConfig) {
        const agentId = `mock-swarm-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const swarm = this.swarms.get(swarmId);
        if (swarm) {
            swarm.agents.push(agentId);
        }
        return agentId;
    }
    async getSwarmAgents(swarmId) {
        const swarm = this.swarms.get(swarmId);
        return swarm?.agents || [];
    }
    healthCheck() {
        return Promise.resolve({
            component: 'swarmCoordinator',
            healthy: true,
            message: 'Mock swarm coordinator healthy',
            timestamp: Date.now()
        });
    }
    getMetrics() {
        return Promise.resolve({
            activeSwarms: this.swarms.size,
            totalAgents: Array.from(this.swarms.values()).reduce((sum, swarm)=>sum + swarm.agents.length, 0)
        });
    }
}
export class MockTaskEngine {
    eventBus;
    logger;
    memoryManager;
    tasks = new Map();
    constructor(eventBus, logger, memoryManager){
        this.eventBus = eventBus;
        this.logger = logger;
        this.memoryManager = memoryManager;
    }
    async initialize() {}
    async shutdown() {}
    async createTask(taskConfig) {
        const taskId = `mock-task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.tasks.set(taskId, {
            id: taskId,
            ...taskConfig,
            status: 'pending',
            createdAt: new Date()
        });
        return taskId;
    }
    async getTaskStatus(taskId) {
        return this.tasks.get(taskId) || null;
    }
    async getActiveTasks(swarmId) {
        const allTasks = Array.from(this.tasks.values());
        return swarmId ? allTasks.filter((task)=>task.swarmId === swarmId && task.status === 'active') : allTasks.filter((task)=>task.status === 'active');
    }
    healthCheck() {
        return Promise.resolve({
            component: 'taskEngine',
            healthy: true,
            message: 'Mock task engine healthy',
            timestamp: Date.now()
        });
    }
    getMetrics() {
        const tasks = Array.from(this.tasks.values());
        return Promise.resolve({
            totalTasks: tasks.length,
            activeTasks: tasks.filter((t)=>t.status === 'active').length,
            queuedTasks: tasks.filter((t)=>t.status === 'pending').length,
            completedTasks: tasks.filter((t)=>t.status === 'completed').length
        });
    }
}
export class MockRealTimeMonitor {
    eventBus;
    logger;
    constructor(eventBus, logger){
        this.eventBus = eventBus;
        this.logger = logger;
    }
    async initialize() {}
    async shutdown() {}
    attachToOrchestrator(orchestrator) {}
    attachToAgentManager(agentManager) {}
    attachToSwarmCoordinator(swarmCoordinator) {}
    attachToTaskEngine(taskEngine) {}
    healthCheck() {
        return Promise.resolve({
            component: 'monitor',
            healthy: true,
            message: 'Mock monitor healthy',
            timestamp: Date.now()
        });
    }
}
export class MockMcpServer {
    eventBus;
    logger;
    constructor(eventBus, logger){
        this.eventBus = eventBus;
        this.logger = logger;
    }
    async initialize() {}
    async shutdown() {}
    attachToOrchestrator(orchestrator) {}
    attachToAgentManager(agentManager) {}
    attachToSwarmCoordinator(swarmCoordinator) {}
    attachToTaskEngine(taskEngine) {}
    attachToMemoryManager(memoryManager) {}
    healthCheck() {
        return Promise.resolve({
            component: 'mcpServer',
            healthy: true,
            message: 'Mock MCP server healthy',
            timestamp: Date.now()
        });
    }
}
export class MockOrchestrator {
    configManager;
    eventBus;
    logger;
    constructor(configManager, eventBus, logger){
        this.configManager = configManager;
        this.eventBus = eventBus;
        this.logger = logger;
    }
    async initialize() {}
    async shutdown() {}
    setAgentManager(agentManager) {}
    healthCheck() {
        return Promise.resolve({
            component: 'orchestrator',
            healthy: true,
            message: 'Mock orchestrator healthy',
            timestamp: Date.now()
        });
    }
}

//# sourceMappingURL=mock-components.js.map