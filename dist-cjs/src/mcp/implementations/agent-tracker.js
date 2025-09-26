let AgentTracker = class AgentTracker {
    constructor(){
        this.agents = new Map();
        this.swarms = new Map();
        this.tasks = new Map();
    }
    trackAgent(agentId, agentData) {
        this.agents.set(agentId, {
            ...agentData,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
        });
        if (agentData.swarmId && this.swarms.has(agentData.swarmId)) {
            const swarm = this.swarms.get(agentData.swarmId);
            swarm.agentCount = (swarm.agentCount || 0) + 1;
            swarm.activeAgents = (swarm.activeAgents || 0) + 1;
        }
    }
    trackSwarm(swarmId, swarmData) {
        this.swarms.set(swarmId, {
            ...swarmData,
            agentCount: 0,
            activeAgents: 0,
            taskCount: 0,
            pendingTasks: 0,
            completedTasks: 0,
            createdAt: new Date().toISOString()
        });
    }
    trackTask(taskId, taskData) {
        this.tasks.set(taskId, {
            ...taskData,
            createdAt: new Date().toISOString(),
            status: taskData.status || 'pending'
        });
        if (taskData.swarmId && this.swarms.has(taskData.swarmId)) {
            const swarm = this.swarms.get(taskData.swarmId);
            swarm.taskCount = (swarm.taskCount || 0) + 1;
            if (taskData.status === 'pending') {
                swarm.pendingTasks = (swarm.pendingTasks || 0) + 1;
            }
        }
    }
    getAgents(swarmId) {
        const agents = [];
        for (const [id, agent] of this.agents){
            if (!swarmId || agent.swarmId === swarmId) {
                agents.push({
                    id,
                    ...agent
                });
            }
        }
        return agents;
    }
    storeTaskResult(taskId, result) {
        if (this.tasks.has(taskId)) {
            const task = this.tasks.get(taskId);
            task.result = result;
            task.completedAt = new Date().toISOString();
            this.updateTaskStatus(taskId, 'completed');
            return true;
        }
        this.tasks.set(taskId, {
            id: taskId,
            result: result,
            status: 'completed',
            completedAt: new Date().toISOString()
        });
        return true;
    }
    getTaskResult(taskId) {
        const task = this.tasks.get(taskId);
        return task ? task.result : null;
    }
    getSwarmStatus(swarmId) {
        if (!this.swarms.has(swarmId)) {
            const agents = this.getAgents(swarmId);
            return {
                swarmId,
                agentCount: agents.length,
                activeAgents: agents.filter((a)=>a.status === 'active').length,
                taskCount: 0,
                pendingTasks: 0,
                completedTasks: 0
            };
        }
        return this.swarms.get(swarmId);
    }
    updateTaskStatus(taskId, status) {
        if (this.tasks.has(taskId)) {
            const task = this.tasks.get(taskId);
            const oldStatus = task.status;
            task.status = status;
            task.lastUpdated = new Date().toISOString();
            if (task.swarmId && this.swarms.has(task.swarmId)) {
                const swarm = this.swarms.get(task.swarmId);
                if (oldStatus === 'pending' && status !== 'pending') {
                    swarm.pendingTasks = Math.max(0, (swarm.pendingTasks || 0) - 1);
                }
                if (status === 'completed' && oldStatus !== 'completed') {
                    swarm.completedTasks = (swarm.completedTasks || 0) + 1;
                }
            }
        }
    }
};
const tracker = new AgentTracker();
if (typeof module !== 'undefined' && module.exports) {
    module.exports = tracker;
}
if (typeof global !== 'undefined') {
    global.agentTracker = tracker;
}

//# sourceMappingURL=agent-tracker.js.map