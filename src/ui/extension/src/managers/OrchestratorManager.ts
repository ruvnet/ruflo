import { EventEmitter } from 'events';
import { IOrchestratorManager, IOrchestratorConfig } from '../interfaces/IOrchestratorManager';
import { OperationMode } from '../types/OperationMode';
import { Task, TaskResult, TaskStatus, TaskType, TaskPriority } from '../types/Task';
import { SystemEvent, EventType } from '../types/SystemEvent';
import { AgentStatus, AgentRole, AgentState } from '../types/Agent';
import { IConfigManager } from '../interfaces/IConfigManager';

export class OrchestratorManager extends EventEmitter implements IOrchestratorManager {
    private initialized = false;
    private currentMode: OperationMode = OperationMode.Chat;
    private agents: Map<string, AgentStatus> = new Map();
    private orchestrator: any; // Will be the actual claude-flow orchestrator

    constructor(private configManager: IConfigManager) {
        super();
    }

    async initialize(config: IOrchestratorConfig): Promise<void> {
        if (this.initialized) {
            throw new Error('Orchestrator already initialized');
        }

        try {
            // In production, this would initialize the actual claude-flow orchestrator
            // For now, we'll simulate it
            this.orchestrator = {
                initialize: async () => {},
                spawnAgent: async (config: any) => ({ id: Math.random().toString(), ...config }),
                clearAgents: async () => {},
                setWorkflow: async (workflow: string) => {},
                assignTask: async (task: any) => {},
                on: (event: string, handler: Function) => {}
            };

            await this.orchestrator.initialize();
            this.initialized = true;
            this.emit('initialized');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    async switchMode(mode: OperationMode): Promise<void> {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }

        try {
            // Clear existing agents
            await this.clearAgents();

            // Set new mode
            this.currentMode = mode;

            // Spawn agents based on mode
            const agentsToSpawn = this.getAgentsForMode(mode);
            for (const agentConfig of agentsToSpawn) {
                await this.spawnAgent(agentConfig);
            }

            this.emit('mode-changed', mode);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    getCurrentMode(): OperationMode {
        return this.currentMode;
    }

    async executeTask(task: Task): Promise<TaskResult> {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }

        const startTime = Date.now();
        
        try {
            this.emit('task-started', task);
            
            // Simulate task execution
            await this.orchestrator.assignTask(task);
            
            const result: TaskResult = {
                taskId: task.id,
                status: TaskStatus.Completed,
                output: { message: 'Task completed successfully' },
                duration: Date.now() - startTime
            };

            this.emit('task-completed', result);
            return result;
        } catch (error) {
            const result: TaskResult = {
                taskId: task.id,
                status: TaskStatus.Failed,
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime
            };

            this.emit('task-failed', result);
            return result;
        }
    }

    async processMessage(message: string, mode: OperationMode): Promise<void> {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }

        try {
            // Ensure we're in the correct mode
            if (this.currentMode !== mode) {
                await this.switchMode(mode);
            }

            // Create a task for the message
            const task: Task = {
                id: Math.random().toString(),
                type: TaskType.Implementation,
                title: 'Process user message',
                description: message,
                status: TaskStatus.Pending,
                priority: TaskPriority.High,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            // Execute the task
            await this.executeTask(task);

            // Simulate agent response
            this.emit('agent-message', {
                type: EventType.AGENT_MESSAGE,
                source: 'assistant',
                timestamp: Date.now(),
                payload: {
                    agent: 'assistant',
                    message: `I'll help you with: ${message}`
                }
            });
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async stopExecution(): Promise<void> {
        // Stop all active tasks
        this.emit('execution-stopped');
    }

    getActiveAgents(): AgentStatus[] {
        return Array.from(this.agents.values());
    }

    subscribeToEvents(handler: (event: SystemEvent) => void): () => void {
        const events = [
            EventType.AGENT_SPAWNED,
            EventType.AGENT_MESSAGE,
            EventType.TASK_CREATED,
            EventType.TASK_COMPLETED,
            EventType.ERROR_OCCURRED
        ];

        events.forEach(eventType => {
            this.on(eventType, handler);
        });

        // Return unsubscribe function
        return () => {
            events.forEach(eventType => {
                this.removeListener(eventType, handler);
            });
        };
    }

    dispose(): void {
        this.removeAllListeners();
        this.agents.clear();
        this.initialized = false;
    }

    private getAgentsForMode(mode: OperationMode): any[] {
        switch (mode) {
            case OperationMode.Chat:
                return [{ role: AgentRole.Assistant, name: 'Claude' }];
            
            case OperationMode.PairProgramming:
                return [{ role: AgentRole.Assistant, name: 'Pair Programmer' }];
            
            case OperationMode.CodeReview:
                return [{ role: AgentRole.Analyst, name: 'Code Reviewer' }];
            
            case OperationMode.PlanReflect:
                return [
                    { role: AgentRole.Coordinator, name: 'Planner' },
                    { role: AgentRole.Implementer, name: 'Coder' },
                    { role: AgentRole.Reflector, name: 'Reviewer' }
                ];
            
            default:
                return [{ role: AgentRole.Assistant, name: 'Claude' }];
        }
    }

    private async spawnAgent(config: any): Promise<void> {
        const agent = await this.orchestrator.spawnAgent(config);
        
        const agentStatus: AgentStatus = {
            id: agent.id,
            role: config.role,
            state: AgentState.Idle,
            completedTasks: 0
        };

        this.agents.set(agent.id, agentStatus);
        
        this.emit(EventType.AGENT_SPAWNED, {
            type: EventType.AGENT_SPAWNED,
            source: 'orchestrator',
            timestamp: Date.now(),
            payload: agentStatus
        });
    }

    private async clearAgents(): Promise<void> {
        await this.orchestrator.clearAgents();
        this.agents.clear();
    }
}