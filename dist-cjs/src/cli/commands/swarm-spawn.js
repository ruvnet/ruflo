const swarmStates = new Map();
export function initializeSwarm(swarmId, objective) {
    swarmStates.set(swarmId, {
        swarmId: swarmId,
        objective,
        agents: new Map(),
        startTime: Date.now()
    });
}
export async function spawnSwarmAgent(swarmId, agentType, task) {
    const swarm = swarmStates.get(swarmId);
    if (!swarm) {
        throw new Error(`Swarm ${swarmId} not found`);
    }
    const agentId = `${swarmId}-agent-${Date.now()}`;
    const agent = {
        id: agentId,
        type: agentType,
        status: 'active',
        name: `${agentType}-${agentId}`,
        task: task
    };
    swarm.agents.set(agentId, agent);
    console.log(`[SWARM] Spawned ${agentType} agent: ${agentId}`);
    console.log(`[SWARM] Task: ${task}`);
    return agentId;
}
export async function monitorSwarm(swarmId) {
    const swarm = swarmStates.get(swarmId);
    if (!swarm) {
        throw new Error(`Swarm ${swarmId} not found`);
    }
    let running = true;
    const interval = setInterval(()=>{
        if (!running) {
            clearInterval(interval);
            return;
        }
        console.log(`[MONITOR] Swarm ${swarmId} - Agents: ${swarm.agents.size}`);
        const activeAgents = Array.from(swarm.agents.values()).filter((a)=>a.status === 'active').length;
        console.log(`[MONITOR] Active: ${activeAgents}`);
    }, 5000);
    setTimeout(()=>{
        running = false;
    }, 60 * 60 * 1000);
}
export function getSwarmState(swarmId) {
    return swarmStates.get(swarmId);
}

//# sourceMappingURL=swarm-spawn.js.map