export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    streaming?: boolean;
    metadata?: {
        agent?: string;
        mode?: string;
        tokens?: number;
    };
    toolLog?: {
        tool: string;
        output?: string;
        duration: number;
    };
}

export interface ChatTab {
    id: string;
    title: string;
    active: boolean;
    messages: Message[];
}

export type OperationMode = 'chat' | 'pair-programming' | 'code-review' | 'plan-reflect';

export interface AgentStatus {
    id: string;
    role: string;
    state: 'idle' | 'active' | 'thinking' | 'waiting' | 'error';
    currentTask?: string;
    completedTasks: number;
}

export interface Task {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'in-progress' | 'completed' | 'failed';
    assignedAgent?: string;
    parentTask?: string;
    subtasks?: Task[];
}