import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { IOrchestratorManager, IOrchestratorConfig } from '../interfaces/IOrchestratorManager';
import { OperationMode } from '../types/OperationMode';
import { Task, TaskResult, TaskStatus, TaskType, TaskPriority } from '../types/Task';
import { SystemEvent, EventType } from '../types/SystemEvent';
import { AgentStatus, AgentRole, AgentState } from '../types/Agent';
import { IConfigManager } from '../interfaces/IConfigManager';
import { ClaudeFlowCLIAdapter } from '../adapters/ClaudeFlowCLIAdapter';

export class OrchestratorManagerWithCLI extends EventEmitter implements IOrchestratorManager {
    private initialized = false;
    private currentMode: OperationMode = OperationMode.Chat;
    private agents: Map<string, AgentStatus> = new Map();
    private cliAdapter: ClaudeFlowCLIAdapter;
    private workspaceRoot: string;

    constructor(private configManager: IConfigManager) {
        super();
        
        // Get workspace root
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.cliAdapter = new ClaudeFlowCLIAdapter(this.workspaceRoot);
        
        this.setupCLIListeners();
    }

    private setupCLIListeners(): void {
        // Handle messages from claude-flow
        this.cliAdapter.on('message', (message) => {
            this.emit('agent-message', {
                type: EventType.AGENT_MESSAGE,
                source: 'claude-flow',
                timestamp: Date.now(),
                payload: {
                    agent: message.metadata?.agent || 'assistant',
                    message: message.content
                }
            });
        });

        // Handle agent updates
        this.cliAdapter.on('agent_update', (agents) => {
            this.updateAgents(agents);
            this.emit('agent-update', this.getActiveAgents());
        });

        // Handle task updates
        this.cliAdapter.on('task_update', (tasks) => {
            this.emit('task-update', tasks);
        });

        // Handle tool executions
        this.cliAdapter.on('tool_execution', (execution) => {
            this.emit('tool-executed', {
                type: EventType.TOOL_INVOKED,
                source: 'claude-flow',
                timestamp: Date.now(),
                payload: execution
            });
        });

        // Handle errors
        this.cliAdapter.on('error', (error) => {
            this.emit('error', error);
            vscode.window.showErrorMessage(`Claude-Flow Error: ${error.message}`);
        });

        // Handle session events
        this.cliAdapter.on('session_started', (data) => {
            vscode.window.showInformationMessage(`Claude-Flow session started in ${data.mode} mode`);
        });

        this.cliAdapter.on('session_ended', (data) => {
            this.agents.clear();
            this.emit('agent-update', []);
        });
    }

    async initialize(config: IOrchestratorConfig): Promise<void> {
        if (this.initialized) {
            throw new Error('Orchestrator already initialized');
        }

        try {
            // Set API key in environment
            if (config.apiKey) {
                process.env.ANTHROPIC_API_KEY = config.apiKey;
            }

            // Initialize CLI adapter
            await this.cliAdapter.initialize();
            
            // Start initial session
            await this.cliAdapter.startSession(this.getClaudeFlowMode(this.currentMode));
            
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
            // Stop current session
            await this.cliAdapter.stopSession();
            
            // Clear agents
            this.agents.clear();
            
            // Start new session with new mode
            this.currentMode = mode;
            await this.cliAdapter.startSession(this.getClaudeFlowMode(mode));
            
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
            
            // For now, tasks are handled through the message interface
            // In a more sophisticated implementation, we could use claude-flow's task system
            await this.cliAdapter.sendMessage(`Execute task: ${task.title}\n${task.description}`);
            
            // Since claude-flow is async, we return a pending result
            // Real results will come through events
            const result: TaskResult = {
                taskId: task.id,
                status: TaskStatus.InProgress,
                duration: Date.now() - startTime
            };

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

            // Send message to claude-flow
            await this.cliAdapter.sendMessage(message);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async stopExecution(): Promise<void> {
        await this.cliAdapter.stopSession();
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
        this.cliAdapter.stopSession().catch(() => {});
        this.removeAllListeners();
        this.agents.clear();
        this.initialized = false;
    }

    private getClaudeFlowMode(mode: OperationMode): string {
        switch (mode) {
            case OperationMode.Chat:
                return 'ask';
            case OperationMode.PairProgramming:
                return 'code';
            case OperationMode.CodeReview:
                return 'security-review';
            case OperationMode.PlanReflect:
                return 'architect';
            default:
                return 'ask';
        }
    }

    private updateAgents(agentData: any[]): void {
        // Update agent statuses based on claude-flow data
        this.agents.clear();
        
        if (Array.isArray(agentData)) {
            agentData.forEach((agent, index) => {
                const agentStatus: AgentStatus = {
                    id: agent.id || `agent-${index}`,
                    role: this.mapAgentRole(agent.role || agent.type),
                    state: this.mapAgentState(agent.state || agent.status),
                    currentTask: agent.currentTask || agent.task,
                    completedTasks: agent.completedTasks || 0
                };
                
                this.agents.set(agentStatus.id, agentStatus);
            });
        }
    }

    private mapAgentRole(role: string): AgentRole {
        const roleMap: Record<string, AgentRole> = {
            'coordinator': AgentRole.Coordinator,
            'implementer': AgentRole.Implementer,
            'tester': AgentRole.Tester,
            'reflector': AgentRole.Reflector,
            'analyst': AgentRole.Analyst,
            'assistant': AgentRole.Assistant,
            'coder': AgentRole.Implementer,
            'reviewer': AgentRole.Analyst
        };
        
        return roleMap[role.toLowerCase()] || AgentRole.Assistant;
    }

    private mapAgentState(state: string): AgentState {
        const stateMap: Record<string, AgentState> = {
            'idle': AgentState.Idle,
            'active': AgentState.Active,
            'thinking': AgentState.Thinking,
            'waiting': AgentState.Waiting,
            'error': AgentState.Error,
            'working': AgentState.Active,
            'processing': AgentState.Thinking
        };
        
        return stateMap[state.toLowerCase()] || AgentState.Idle;
    }

    // Additional methods for advanced features
    
    async runTDD(feature: string): Promise<void> {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }
        
        await this.cliAdapter.runTDD(feature);
    }

    async startSwarm(agents: string[], task: string): Promise<void> {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }
        
        await this.cliAdapter.startSwarm(agents, task);
    }

    async queryMemory(query: string): Promise<string> {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }
        
        return await this.cliAdapter.memoryQuery(query);
    }

    async storeMemory(key: string, value: string): Promise<void> {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }
        
        await this.cliAdapter.memoryStore(key, value);
    }
}