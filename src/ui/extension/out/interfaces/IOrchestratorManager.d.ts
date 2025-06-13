import { EventEmitter } from 'events';
import { OperationMode } from '../types/OperationMode';
import { Task, TaskResult } from '../types/Task';
import { SystemEvent } from '../types/SystemEvent';
import { AgentStatus } from '../types/Agent';
export interface IOrchestratorConfig {
    apiKey: string;
    model: string;
    maxTokens: number;
    memoryPath: string;
}
export interface IOrchestratorManager extends EventEmitter {
    initialize(config: IOrchestratorConfig): Promise<void>;
    isInitialized(): boolean;
    switchMode(mode: OperationMode): Promise<void>;
    getCurrentMode(): OperationMode;
    executeTask(task: Task): Promise<TaskResult>;
    processMessage(message: string, mode: OperationMode): Promise<void>;
    stopExecution(): Promise<void>;
    getActiveAgents(): AgentStatus[];
    subscribeToEvents(handler: (event: SystemEvent) => void): () => void;
    dispose(): void;
}
//# sourceMappingURL=IOrchestratorManager.d.ts.map