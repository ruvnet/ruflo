"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestratorManager = void 0;
const events_1 = require("events");
const OperationMode_1 = require("../types/OperationMode");
const Task_1 = require("../types/Task");
const SystemEvent_1 = require("../types/SystemEvent");
const Agent_1 = require("../types/Agent");
class OrchestratorManager extends events_1.EventEmitter {
    constructor(configManager) {
        super();
        this.configManager = configManager;
        this.initialized = false;
        this.currentMode = OperationMode_1.OperationMode.Chat;
        this.agents = new Map();
    }
    async initialize(config) {
        if (this.initialized) {
            throw new Error('Orchestrator already initialized');
        }
        try {
            // In production, this would initialize the actual claude-flow orchestrator
            // For now, we'll simulate it
            this.orchestrator = {
                initialize: async () => { },
                spawnAgent: async (config) => ({ id: Math.random().toString(), ...config }),
                clearAgents: async () => { },
                setWorkflow: async (workflow) => { },
                assignTask: async (task) => { },
                on: (event, handler) => { }
            };
            await this.orchestrator.initialize();
            this.initialized = true;
            this.emit('initialized');
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    isInitialized() {
        return this.initialized;
    }
    async switchMode(mode) {
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
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    getCurrentMode() {
        return this.currentMode;
    }
    async executeTask(task) {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }
        const startTime = Date.now();
        try {
            this.emit('task-started', task);
            // Simulate task execution
            await this.orchestrator.assignTask(task);
            const result = {
                taskId: task.id,
                status: Task_1.TaskStatus.Completed,
                output: { message: 'Task completed successfully' },
                duration: Date.now() - startTime
            };
            this.emit('task-completed', result);
            return result;
        }
        catch (error) {
            const result = {
                taskId: task.id,
                status: Task_1.TaskStatus.Failed,
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime
            };
            this.emit('task-failed', result);
            return result;
        }
    }
    async processMessage(message, mode) {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized');
        }
        try {
            // Ensure we're in the correct mode
            if (this.currentMode !== mode) {
                await this.switchMode(mode);
            }
            // Create a task for the message
            const task = {
                id: Math.random().toString(),
                type: Task_1.TaskType.Implementation,
                title: 'Process user message',
                description: message,
                status: Task_1.TaskStatus.Pending,
                priority: Task_1.TaskPriority.High,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            // Execute the task
            await this.executeTask(task);
            // Simulate agent response
            this.emit('agent-message', {
                type: SystemEvent_1.EventType.AGENT_MESSAGE,
                source: 'assistant',
                timestamp: Date.now(),
                payload: {
                    agent: 'assistant',
                    message: `I'll help you with: ${message}`
                }
            });
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async stopExecution() {
        // Stop all active tasks
        this.emit('execution-stopped');
    }
    getActiveAgents() {
        return Array.from(this.agents.values());
    }
    subscribeToEvents(handler) {
        const events = [
            SystemEvent_1.EventType.AGENT_SPAWNED,
            SystemEvent_1.EventType.AGENT_MESSAGE,
            SystemEvent_1.EventType.TASK_CREATED,
            SystemEvent_1.EventType.TASK_COMPLETED,
            SystemEvent_1.EventType.ERROR_OCCURRED
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
    dispose() {
        this.removeAllListeners();
        this.agents.clear();
        this.initialized = false;
    }
    getAgentsForMode(mode) {
        switch (mode) {
            case OperationMode_1.OperationMode.Chat:
                return [{ role: Agent_1.AgentRole.Assistant, name: 'Claude' }];
            case OperationMode_1.OperationMode.PairProgramming:
                return [{ role: Agent_1.AgentRole.Assistant, name: 'Pair Programmer' }];
            case OperationMode_1.OperationMode.CodeReview:
                return [{ role: Agent_1.AgentRole.Analyst, name: 'Code Reviewer' }];
            case OperationMode_1.OperationMode.PlanReflect:
                return [
                    { role: Agent_1.AgentRole.Coordinator, name: 'Planner' },
                    { role: Agent_1.AgentRole.Implementer, name: 'Coder' },
                    { role: Agent_1.AgentRole.Reflector, name: 'Reviewer' }
                ];
            default:
                return [{ role: Agent_1.AgentRole.Assistant, name: 'Claude' }];
        }
    }
    async spawnAgent(config) {
        const agent = await this.orchestrator.spawnAgent(config);
        const agentStatus = {
            id: agent.id,
            role: config.role,
            state: Agent_1.AgentState.Idle,
            completedTasks: 0
        };
        this.agents.set(agent.id, agentStatus);
        this.emit(SystemEvent_1.EventType.AGENT_SPAWNED, {
            type: SystemEvent_1.EventType.AGENT_SPAWNED,
            source: 'orchestrator',
            timestamp: Date.now(),
            payload: agentStatus
        });
    }
    async clearAgents() {
        await this.orchestrator.clearAgents();
        this.agents.clear();
    }
}
exports.OrchestratorManager = OrchestratorManager;
//# sourceMappingURL=OrchestratorManager.js.map