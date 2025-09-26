export function fixAgentMetrics(data) {
    if (!data) {
        return {
            success: true,
            agentId: null,
            metrics: {
                tasksCompleted: 0,
                successRate: 0,
                avgExecutionTime: 0,
                neuralNetworks: [],
                memoryUsage: 0,
                cpuUsage: 0
            },
            timestamp: new Date().toISOString()
        };
    }
    if (data.metrics && !Array.isArray(data.metrics.neuralNetworks)) {
        data.metrics.neuralNetworks = [];
    }
    if (data.neuralNetworks && !Array.isArray(data.neuralNetworks)) {
        data.neuralNetworks = [];
    }
    return data;
}
export function fixSwarmMonitor(data) {
    if (!data) {
        return {
            success: true,
            monitoring: {
                swarmId: null,
                status: 'active',
                recentEvents: [],
                agentActivity: [],
                taskProgress: [],
                resourceUsage: {
                    cpu: 0,
                    memory: 0,
                    network: 0
                }
            },
            timestamp: new Date().toISOString()
        };
    }
    if (data.monitoring && !Array.isArray(data.monitoring.recentEvents)) {
        data.monitoring.recentEvents = [];
    }
    if (data.recentEvents && !Array.isArray(data.recentEvents)) {
        data.recentEvents = [];
    }
    return data;
}
export function fixNeuralTrain(args) {
    if (!args.agentId && !args.agent_id) {
        args.agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    if (args.agent_id && !args.agentId) {
        args.agentId = args.agent_id;
    }
    if (typeof args.agentId !== 'string') {
        args.agentId = String(args.agentId || '');
    }
    if (!args.iterations && !args.epochs) {
        args.iterations = 10;
    }
    if (args.epochs && !args.iterations) {
        args.iterations = args.epochs;
    }
    return args;
}
export function wrapRuvSwarmResponse(toolName, response) {
    try {
        let data = response;
        if (typeof response === 'string') {
            try {
                data = JSON.parse(response);
            } catch  {
                data = {
                    output: response
                };
            }
        }
        switch(toolName){
            case 'agent_metrics':
            case 'mcp__ruv-swarm__agent_metrics':
                return fixAgentMetrics(data);
            case 'swarm_monitor':
            case 'mcp__ruv-swarm__swarm_monitor':
                return fixSwarmMonitor(data);
            case 'neural_train':
            case 'mcp__ruv-swarm__neural_train':
                return data;
            default:
                return data;
        }
    } catch (error) {
        console.error(`Error wrapping response for ${toolName}:`, error);
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fixAgentMetrics,
        fixSwarmMonitor,
        fixNeuralTrain,
        wrapRuvSwarmResponse
    };
}

//# sourceMappingURL=mcp-error-fixes.js.map