import { EventEmitter } from 'events';
import { IOrchestratorManager, IOrchestratorConfig } from '../interfaces/IOrchestratorManager';
import { OperationMode } from '../types/OperationMode';
import { Task, TaskResult } from '../types/Task';
import { SystemEvent } from '../types/SystemEvent';
import { AgentStatus } from '../types/Agent';
import { IConfigManager } from '../interfaces/IConfigManager';
export declare class OrchestratorManager extends EventEmitter implements IOrchestratorManager {
    private configManager;
    private initialized;
    private currentMode;
    private agents;
    private orchestrator;
    constructor(configManager: IConfigManager);
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
    private getAgentsForMode;
    private spawnAgent;
    private clearAgents;
}
//# sourceMappingURL=OrchestratorManager.d.ts.map