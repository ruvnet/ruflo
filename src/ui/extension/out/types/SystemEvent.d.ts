export interface SystemEvent {
    id: string;
    type: EventType;
    source: string;
    timestamp: number;
    payload: any;
}
export declare enum EventType {
    AGENT_SPAWNED = "agent.spawned",
    AGENT_MESSAGE = "agent.message",
    AGENT_TERMINATED = "agent.terminated",
    AGENT_ERROR = "agent.error",
    TASK_CREATED = "task.created",
    TASK_ASSIGNED = "task.assigned",
    TASK_STARTED = "task.started",
    TASK_COMPLETED = "task.completed",
    TASK_FAILED = "task.failed",
    TOOL_INVOKED = "tool.invoked",
    TOOL_COMPLETED = "tool.completed",
    TOOL_FAILED = "tool.failed",
    MODE_CHANGED = "system.mode_changed",
    ERROR_OCCURRED = "system.error",
    MEMORY_UPDATED = "system.memory_updated"
}
//# sourceMappingURL=SystemEvent.d.ts.map