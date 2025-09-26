import { EventEmitter } from 'node:events';
export class AgentRegistry extends EventEmitter {
    memory;
    namespace;
    cache = new Map();
    cacheExpiry = 60000;
    lastCacheUpdate = 0;
    constructor(memory, namespace = 'agents'){
        super();
        this.memory = memory;
        this.namespace = namespace;
    }
    async initialize() {
        await this.loadFromMemory();
        this.emit('registry:initialized');
    }
    async registerAgent(agent, tags = []) {
        const entry = {
            agent,
            createdAt: new Date(),
            lastUpdated: new Date(),
            tags: [
                ...tags,
                agent.type,
                agent.status
            ],
            metadata: {
                registeredBy: 'agent-manager',
                version: '1.0.0'
            }
        };
        const key = this.getAgentKey(agent.id.id);
        await this.memory.store(key, entry, {
            type: 'agent-registry',
            tags: entry.tags,
            partition: this.namespace
        });
        this.cache.set(agent.id.id, entry);
        this.emit('agent:registered', {
            agentId: agent.id.id,
            agent
        });
    }
    async updateAgent(agentId, updates) {
        const entry = await this.getAgentEntry(agentId);
        if (!entry) {
            throw new Error(`Agent ${agentId} not found in registry`);
        }
        entry.agent = {
            ...entry.agent,
            ...updates
        };
        entry.lastUpdated = new Date();
        entry.tags = [
            entry.agent.type,
            entry.agent.status,
            ...entry.tags.filter((t)=>t !== entry.agent.type && t !== entry.agent.status)
        ];
        const key = this.getAgentKey(agentId);
        await this.memory.store(key, entry, {
            type: 'agent-registry',
            tags: entry.tags,
            partition: this.namespace
        });
        this.cache.set(agentId, entry);
        this.emit('agent:updated', {
            agentId,
            agent: entry.agent
        });
    }
    async unregisterAgent(agentId, preserveHistory = true) {
        const entry = await this.getAgentEntry(agentId);
        if (!entry) {
            return;
        }
        if (preserveHistory) {
            const archiveKey = this.getArchiveKey(agentId);
            await this.memory.store(archiveKey, {
                ...entry,
                archivedAt: new Date(),
                reason: 'agent_removed'
            }, {
                type: 'agent-archive',
                tags: [
                    ...entry.tags,
                    'archived'
                ],
                partition: 'archived'
            });
        }
        const key = this.getAgentKey(agentId);
        await this.memory.deleteEntry(key);
        this.cache.delete(agentId);
        this.emit('agent:unregistered', {
            agentId,
            preserved: preserveHistory
        });
    }
    async getAgent(agentId) {
        const entry = await this.getAgentEntry(agentId);
        return entry?.agent || null;
    }
    async getAgentEntry(agentId) {
        if (this.cache.has(agentId) && this.isCacheValid()) {
            return this.cache.get(agentId) || null;
        }
        const key = this.getAgentKey(agentId);
        const memoryEntry = await this.memory.retrieve(key);
        if (memoryEntry && memoryEntry.value) {
            const registryEntry = memoryEntry.value;
            this.cache.set(agentId, registryEntry);
            return registryEntry;
        }
        return null;
    }
    async queryAgents(query = {}) {
        await this.refreshCacheIfNeeded();
        let agents = Array.from(this.cache.values()).map((entry)=>entry.agent);
        if (query.type) {
            agents = agents.filter((agent)=>agent.type === query.type);
        }
        if (query.status) {
            agents = agents.filter((agent)=>agent.status === query.status);
        }
        if (query.healthThreshold !== undefined) {
            agents = agents.filter((agent)=>agent.health >= query.healthThreshold);
        }
        if (query.namePattern) {
            const pattern = new RegExp(query.namePattern, 'i');
            agents = agents.filter((agent)=>pattern.test(agent.name));
        }
        if (query.tags && query.tags.length > 0) {
            const entries = Array.from(this.cache.values());
            const matchingEntries = entries.filter((entry)=>query.tags.some((tag)=>entry.tags.includes(tag)));
            agents = matchingEntries.map((entry)=>entry.agent);
        }
        if (query.createdAfter) {
            const entries = Array.from(this.cache.values());
            const matchingEntries = entries.filter((entry)=>entry.createdAt >= query.createdAfter);
            agents = matchingEntries.map((entry)=>entry.agent);
        }
        if (query.lastActiveAfter) {
            agents = agents.filter((agent)=>agent.metrics.lastActivity >= query.lastActiveAfter);
        }
        return agents;
    }
    async getAllAgents() {
        return this.queryAgents();
    }
    async getAgentsByType(type) {
        return this.queryAgents({
            type
        });
    }
    async getAgentsByStatus(status) {
        return this.queryAgents({
            status
        });
    }
    async getHealthyAgents(threshold = 0.7) {
        return this.queryAgents({
            healthThreshold: threshold
        });
    }
    async getStatistics() {
        const agents = await this.getAllAgents();
        const stats = {
            totalAgents: agents.length,
            byType: {},
            byStatus: {},
            averageHealth: 0,
            activeAgents: 0,
            totalUptime: 0,
            tasksCompleted: 0,
            successRate: 0
        };
        if (agents.length === 0) {
            return stats;
        }
        for (const agent of agents){
            stats.byType[agent.type] = (stats.byType[agent.type] || 0) + 1;
            stats.byStatus[agent.status] = (stats.byStatus[agent.status] || 0) + 1;
            if (agent.status === 'idle' || agent.status === 'busy') {
                stats.activeAgents++;
            }
            stats.totalUptime += agent.metrics.totalUptime;
            stats.tasksCompleted += agent.metrics.tasksCompleted;
        }
        stats.averageHealth = agents.reduce((sum, agent)=>sum + agent.health, 0) / agents.length;
        const totalTasks = agents.reduce((sum, agent)=>sum + agent.metrics.tasksCompleted + agent.metrics.tasksFailed, 0);
        if (totalTasks > 0) {
            stats.successRate = stats.tasksCompleted / totalTasks;
        }
        return stats;
    }
    async searchByCapabilities(requiredCapabilities) {
        const agents = await this.getAllAgents();
        return agents.filter((agent)=>{
            const capabilities = [
                ...agent.capabilities.languages,
                ...agent.capabilities.frameworks,
                ...agent.capabilities.domains,
                ...agent.capabilities.tools
            ];
            return requiredCapabilities.every((required)=>capabilities.some((cap)=>cap.toLowerCase().includes(required.toLowerCase())));
        });
    }
    async findBestAgent(taskType, requiredCapabilities = [], preferredAgent) {
        let candidates = await this.getHealthyAgents(0.5);
        if (requiredCapabilities.length > 0) {
            candidates = await this.searchByCapabilities(requiredCapabilities);
        }
        if (preferredAgent) {
            const preferred = candidates.find((agent)=>agent.id.id === preferredAgent || agent.name === preferredAgent);
            if (preferred) return preferred;
        }
        candidates = candidates.filter((agent)=>agent.status === 'idle' && agent.workload < 0.8 && agent.capabilities.maxConcurrentTasks > 0);
        if (candidates.length === 0) return null;
        const scored = candidates.map((agent)=>({
                agent,
                score: this.calculateAgentScore(agent, taskType, requiredCapabilities)
            }));
        scored.sort((a, b)=>b.score - a.score);
        return scored[0]?.agent || null;
    }
    async storeCoordinationData(agentId, data) {
        const key = `coordination:${agentId}`;
        await this.memory.store(key, {
            agentId,
            data,
            timestamp: new Date()
        }, {
            type: 'agent-coordination',
            tags: [
                'coordination',
                agentId
            ],
            partition: this.namespace
        });
    }
    async getCoordinationData(agentId) {
        const key = `coordination:${agentId}`;
        const result = await this.memory.retrieve(key);
        return result?.value || null;
    }
    async loadFromMemory() {
        try {
            const entries = await this.memory.query({
                type: 'state',
                namespace: this.namespace
            });
            this.cache.clear();
            for (const entry of entries){
                if (entry.value && entry.value.agent) {
                    this.cache.set(entry.value.agent.id.id, entry.value);
                }
            }
            this.lastCacheUpdate = Date.now();
        } catch (error) {
            console.warn('Failed to load agent registry from memory:', error);
        }
    }
    async refreshCacheIfNeeded() {
        if (!this.isCacheValid()) {
            await this.loadFromMemory();
        }
    }
    isCacheValid() {
        return Date.now() - this.lastCacheUpdate < this.cacheExpiry;
    }
    getAgentKey(agentId) {
        return `agent:${agentId}`;
    }
    getArchiveKey(agentId) {
        return `archived:${agentId}:${Date.now()}`;
    }
    calculateAgentScore(agent, taskType, requiredCapabilities) {
        let score = 0;
        score += agent.health * 40;
        score += agent.metrics.successRate * 30;
        const availability = 1 - agent.workload;
        score += availability * 20;
        if (requiredCapabilities.length > 0) {
            const agentCaps = [
                ...agent.capabilities.languages,
                ...agent.capabilities.frameworks,
                ...agent.capabilities.domains,
                ...agent.capabilities.tools
            ];
            const matches = requiredCapabilities.filter((required)=>agentCaps.some((cap)=>cap.toLowerCase().includes(required.toLowerCase())));
            score += matches.length / requiredCapabilities.length * 10;
        }
        return score;
    }
}

//# sourceMappingURL=agent-registry.js.map