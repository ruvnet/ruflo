let DAAManager = class DAAManager {
    constructor(){
        this.agents = new Map();
        this.resources = new Map();
        this.communications = new Map();
        this.consensus = new Map();
        this.capabilities = new Map();
        this.metrics = {
            totalAgents: 0,
            activeAgents: 0,
            resourceUtilization: 0,
            communicationLatency: 0,
            consensusTime: 0,
            faultCount: 0
        };
    }
    daa_agent_create(config) {
        const agentId = `daa_agent_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const agent = {
            id: agentId,
            type: config.agent_type || config.type || 'generic',
            capabilities: config.capabilities || [],
            resources: config.resources || {},
            status: 'initializing',
            created: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            tasks: [],
            metadata: config.metadata || {}
        };
        this.agents.set(agentId, agent);
        this.metrics.totalAgents++;
        this.metrics.activeAgents++;
        this.initializeAgent(agent);
        if (global.agentTracker) {
            global.agentTracker.trackAgent(agentId, agent);
        }
        return {
            success: true,
            agentId: agentId,
            agent: agent,
            timestamp: new Date().toISOString()
        };
    }
    daa_capability_match(args) {
        const requirements = args.task_requirements || [];
        const availableAgents = args.available_agents || [];
        const matches = [];
        const agentsToCheck = availableAgents.length > 0 ? availableAgents.map((id)=>this.agents.get(id)).filter(Boolean) : Array.from(this.agents.values());
        for (const agent of agentsToCheck){
            if (agent.status !== 'active' && agent.status !== 'initializing') continue;
            const score = this.calculateCapabilityScore(agent.capabilities, requirements);
            if (score > 0) {
                matches.push({
                    agentId: agent.id,
                    agentType: agent.type,
                    score: score,
                    capabilities: agent.capabilities,
                    matchedRequirements: agent.capabilities.filter((cap)=>requirements.some((req)=>this.matchCapability(cap, req)))
                });
            }
        }
        matches.sort((a, b)=>b.score - a.score);
        return {
            success: true,
            matches: matches,
            totalCandidates: matches.length,
            bestMatch: matches[0] || null,
            timestamp: new Date().toISOString()
        };
    }
    daa_resource_alloc(args) {
        const resources = args.resources || {};
        const agents = args.agents || [];
        const allocationId = `alloc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const allocation = {
            id: allocationId,
            resources: resources,
            agents: agents,
            allocated: {},
            timestamp: new Date().toISOString()
        };
        const agentCount = agents.length || 1;
        const allocatedPerAgent = {};
        for (const [resourceType, amount] of Object.entries(resources)){
            allocatedPerAgent[resourceType] = Math.floor(amount / agentCount);
        }
        for (const agentId of agents){
            allocation.allocated[agentId] = allocatedPerAgent;
            const agent = this.agents.get(agentId);
            if (agent) {
                agent.resources = {
                    ...agent.resources,
                    ...allocatedPerAgent
                };
                agent.lastActivity = new Date().toISOString();
            }
        }
        this.resources.set(allocationId, allocation);
        this.metrics.resourceUtilization = this.calculateResourceUtilization();
        return {
            success: true,
            allocationId: allocationId,
            allocation: allocation,
            utilization: this.metrics.resourceUtilization,
            timestamp: new Date().toISOString()
        };
    }
    daa_lifecycle_manage(args) {
        const agentId = args.agentId || args.agent_id;
        const action = args.action;
        const agent = this.agents.get(agentId);
        if (!agent) {
            return {
                success: false,
                error: `Agent ${agentId} not found`,
                timestamp: new Date().toISOString()
            };
        }
        let result = {
            success: true
        };
        const previousStatus = agent.status;
        switch(action){
            case 'start':
                agent.status = 'active';
                this.metrics.activeAgents++;
                result.message = 'Agent started';
                break;
            case 'stop':
                agent.status = 'stopped';
                this.metrics.activeAgents--;
                result.message = 'Agent stopped';
                break;
            case 'pause':
                agent.status = 'paused';
                result.message = 'Agent paused';
                break;
            case 'resume':
                agent.status = 'active';
                result.message = 'Agent resumed';
                break;
            case 'terminate':
                agent.status = 'terminated';
                this.metrics.activeAgents--;
                this.metrics.totalAgents--;
                result.message = 'Agent terminated';
                break;
            default:
                result.success = false;
                result.error = `Unknown action: ${action}`;
        }
        if (result.success) {
            agent.lastActivity = new Date().toISOString();
            result.agentId = agentId;
            result.previousStatus = previousStatus;
            result.currentStatus = agent.status;
        }
        result.timestamp = new Date().toISOString();
        return result;
    }
    daa_communication(args) {
        const from = args.from;
        const to = args.to;
        const message = args.message;
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const communication = {
            id: messageId,
            from: from,
            to: to,
            message: message,
            timestamp: new Date().toISOString(),
            delivered: false
        };
        const sender = this.agents.get(from);
        const receiver = this.agents.get(to);
        if (!sender) {
            return {
                success: false,
                error: `Sender agent ${from} not found`,
                timestamp: new Date().toISOString()
            };
        }
        if (!receiver) {
            return {
                success: false,
                error: `Receiver agent ${to} not found`,
                timestamp: new Date().toISOString()
            };
        }
        this.communications.set(messageId, communication);
        communication.delivered = true;
        communication.deliveredAt = new Date().toISOString();
        sender.lastActivity = new Date().toISOString();
        receiver.lastActivity = new Date().toISOString();
        return {
            success: true,
            messageId: messageId,
            from: from,
            to: to,
            delivered: true,
            timestamp: new Date().toISOString()
        };
    }
    daa_consensus(args) {
        const agents = args.agents || [];
        const proposal = args.proposal || {};
        const consensusId = `consensus_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const votes = new Map();
        for (const agentId of agents){
            const agent = this.agents.get(agentId);
            if (agent && agent.status === 'active') {
                const vote = Math.random() > 0.3;
                votes.set(agentId, vote);
            }
        }
        const totalVotes = votes.size;
        const approvals = Array.from(votes.values()).filter((v)=>v).length;
        const approved = approvals > totalVotes / 2;
        const consensus = {
            id: consensusId,
            proposal: proposal,
            agents: agents,
            votes: Object.fromEntries(votes),
            totalVotes: totalVotes,
            approvals: approvals,
            rejections: totalVotes - approvals,
            approved: approved,
            timestamp: new Date().toISOString()
        };
        this.consensus.set(consensusId, consensus);
        return {
            success: true,
            consensusId: consensusId,
            approved: approved,
            votes: consensus.votes,
            summary: {
                total: totalVotes,
                approvals: approvals,
                rejections: totalVotes - approvals,
                approvalRate: totalVotes > 0 ? approvals / totalVotes : 0
            },
            timestamp: new Date().toISOString()
        };
    }
    initializeAgent(agent) {
        setTimeout(()=>{
            agent.status = 'active';
            agent.lastActivity = new Date().toISOString();
        }, 100);
    }
    calculateCapabilityScore(agentCaps, requirements) {
        if (!agentCaps || !requirements) return 0;
        let matches = 0;
        for (const req of requirements){
            if (agentCaps.some((cap)=>this.matchCapability(cap, req))) {
                matches++;
            }
        }
        return requirements.length > 0 ? matches / requirements.length : 0;
    }
    matchCapability(capability, requirement) {
        return capability.toLowerCase().includes(requirement.toLowerCase()) || requirement.toLowerCase().includes(capability.toLowerCase());
    }
    calculateResourceUtilization() {
        let totalAllocated = 0;
        let totalCapacity = 0;
        for (const allocation of this.resources.values()){
            for (const amount of Object.values(allocation.resources)){
                totalCapacity += amount;
            }
            for (const agentAlloc of Object.values(allocation.allocated)){
                for (const amount of Object.values(agentAlloc)){
                    totalAllocated += amount;
                }
            }
        }
        return totalCapacity > 0 ? totalAllocated / totalCapacity : 0;
    }
};
const daaManager = new DAAManager();
if (typeof module !== 'undefined' && module.exports) {
    module.exports = daaManager;
}
if (typeof global !== 'undefined') {
    global.daaManager = daaManager;
}

//# sourceMappingURL=daa-tools.js.map