export interface Agent {
    id: string;
    role: AgentRole;
    name: string;
    status: AgentStatus;
    capabilities: string[];
    createdAt: number;
    lastActive: number;
}
export declare enum AgentRole {
    Coordinator = "coordinator",
    Implementer = "implementer",
    Tester = "tester",
    Reflector = "reflector",
    Analyst = "analyst",
    Assistant = "assistant"
}
export interface AgentStatus {
    id: string;
    role: AgentRole;
    state: AgentState;
    currentTask?: string;
    completedTasks: number;
}
export declare enum AgentState {
    Idle = "idle",
    Active = "active",
    Thinking = "thinking",
    Waiting = "waiting",
    Error = "error"
}
//# sourceMappingURL=Agent.d.ts.map