export function isAgentId(obj) {
    return obj && typeof obj.id === 'string' && typeof obj.swarmId === 'string';
}
export function isTaskId(obj) {
    return obj && typeof obj.id === 'string' && typeof obj.swarmId === 'string';
}
export function isSwarmEvent(obj) {
    return obj && typeof obj.id === 'string' && typeof obj.type === 'string';
}
export function isTaskDefinition(obj) {
    return obj && isTaskId(obj.id) && typeof obj.type === 'string';
}
export function isAgentState(obj) {
    return obj && isAgentId(obj.id) && typeof obj.status === 'string';
}
export const SWARM_CONSTANTS = {
    DEFAULT_TASK_TIMEOUT: 5 * 60 * 1000,
    DEFAULT_AGENT_TIMEOUT: 30 * 1000,
    DEFAULT_HEARTBEAT_INTERVAL: 10 * 1000,
    MAX_AGENTS_PER_SWARM: 100,
    MAX_TASKS_PER_AGENT: 10,
    MAX_RETRIES: 3,
    MIN_QUALITY_THRESHOLD: 0.7,
    DEFAULT_QUALITY_THRESHOLD: 0.8,
    HIGH_QUALITY_THRESHOLD: 0.9,
    DEFAULT_THROUGHPUT_TARGET: 10,
    DEFAULT_LATENCY_TARGET: 1000,
    DEFAULT_RELIABILITY_TARGET: 0.95,
    DEFAULT_MEMORY_LIMIT: 512 * 1024 * 1024,
    DEFAULT_CPU_LIMIT: 1.0,
    DEFAULT_DISK_LIMIT: 1024 * 1024 * 1024
};
export default {
    SWARM_CONSTANTS,
    isAgentId,
    isTaskId,
    isSwarmEvent,
    isTaskDefinition,
    isAgentState
};

//# sourceMappingURL=types.js.map