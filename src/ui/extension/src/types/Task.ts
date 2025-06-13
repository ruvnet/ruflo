export interface Task {
    id: string;
    type: TaskType;
    title: string;
    description: string;
    assignedAgent?: string;
    parentTask?: string;
    subtasks?: Task[];
    status: TaskStatus;
    priority: TaskPriority;
    createdAt: number;
    updatedAt: number;
    result?: any;
    error?: string;
}

export enum TaskType {
    Implementation = 'implementation',
    Analysis = 'analysis',
    Testing = 'testing',
    Documentation = 'documentation',
    Refactoring = 'refactoring'
}

export enum TaskStatus {
    Pending = 'pending',
    InProgress = 'in-progress',
    Completed = 'completed',
    Failed = 'failed',
    Cancelled = 'cancelled'
}

export enum TaskPriority {
    Low = 'low',
    Medium = 'medium',
    High = 'high',
    Critical = 'critical'
}

export interface TaskResult {
    taskId: string;
    status: TaskStatus;
    output?: any;
    error?: string;
    duration: number;
}