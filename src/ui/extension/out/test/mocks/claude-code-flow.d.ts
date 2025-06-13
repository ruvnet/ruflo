import { EventEmitter } from 'events';
export declare class Orchestrator extends EventEmitter {
    private config;
    private initialized;
    private agents;
    constructor(config: any);
    initialize(): Promise<void>;
    spawnAgent(config: any): Promise<any>;
    clearAgents(): Promise<void>;
    setWorkflow(workflow: string): Promise<void>;
    assignTask(task: any): Promise<void>;
    registerTool(tool: any): void;
    getAgents(): any[];
}
//# sourceMappingURL=claude-code-flow.d.ts.map