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
    // Initialization
    initialize(config: IOrchestratorConfig): Promise<void>;
    isInitialized(): boolean;
    
    // Mode management
    switchMode(mode: OperationMode): Promise<void>;
    getCurrentMode(): OperationMode;
    
    // Task execution
    executeTask(task: Task): Promise<TaskResult>;
    processMessage(message: string, mode: OperationMode): Promise<void>;
    stopExecution(): Promise<void>;
    
    // Agent management
    getActiveAgents(): AgentStatus[];
    
    // Event handling
    subscribeToEvents(handler: (event: SystemEvent) => void): () => void;
    
    // Lifecycle
    dispose(): void;
}