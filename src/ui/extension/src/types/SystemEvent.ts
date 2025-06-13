export interface SystemEvent {
    id: string;
    type: EventType;
    source: string;
    timestamp: number;
    payload: any;
}

export enum EventType {
    // Agent events
    AGENT_SPAWNED = 'agent.spawned',
    AGENT_MESSAGE = 'agent.message',
    AGENT_TERMINATED = 'agent.terminated',
    AGENT_ERROR = 'agent.error',
    
    // Task events
    TASK_CREATED = 'task.created',
    TASK_ASSIGNED = 'task.assigned',
    TASK_STARTED = 'task.started',
    TASK_COMPLETED = 'task.completed',
    TASK_FAILED = 'task.failed',
    
    // Tool events
    TOOL_INVOKED = 'tool.invoked',
    TOOL_COMPLETED = 'tool.completed',
    TOOL_FAILED = 'tool.failed',
    
    // System events
    MODE_CHANGED = 'system.mode_changed',
    ERROR_OCCURRED = 'system.error',
    MEMORY_UPDATED = 'system.memory_updated'
}