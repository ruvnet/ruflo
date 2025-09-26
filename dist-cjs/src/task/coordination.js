import { EventEmitter } from 'events';
import { generateId } from '../utils/helpers.js';
export class TaskCoordinator extends EventEmitter {
    taskEngine;
    memoryManager;
    todoItems = new Map();
    memoryStore = new Map();
    coordinationSessions = new Map();
    batchOperations = new Map();
    agentCoordination = new Map();
    constructor(taskEngine, memoryManager){
        super(), this.taskEngine = taskEngine, this.memoryManager = memoryManager;
        this.setupCoordinationHandlers();
    }
    setupCoordinationHandlers() {
        this.taskEngine.on('task:created', this.handleTaskCreated.bind(this));
        this.taskEngine.on('task:started', this.handleTaskStarted.bind(this));
        this.taskEngine.on('task:completed', this.handleTaskCompleted.bind(this));
        this.taskEngine.on('task:failed', this.handleTaskFailed.bind(this));
        this.taskEngine.on('task:cancelled', this.handleTaskCancelled.bind(this));
    }
    async createTaskTodos(objective, context, options = {}) {
        const sessionId = context.sessionId;
        this.coordinationSessions.set(sessionId, context);
        const todos = await this.generateTaskBreakdown(objective, options);
        for (const todo of todos){
            this.todoItems.set(todo.id, todo);
            if (options.memoryCoordination && this.memoryManager) {
                await this.storeInMemory(`todo:${todo.id}`, todo, {
                    namespace: 'task_coordination',
                    tags: [
                        'todo',
                        'task_breakdown',
                        sessionId
                    ]
                });
            }
        }
        this.emit('todos:created', {
            sessionId,
            todos,
            context
        });
        return todos;
    }
    async updateTodoProgress(todoId, status, metadata) {
        const todo = this.todoItems.get(todoId);
        if (!todo) {
            throw new Error(`Todo ${todoId} not found`);
        }
        const previousStatus = todo.status;
        todo.status = status;
        todo.metadata = {
            ...todo.metadata,
            ...metadata,
            updatedAt: new Date()
        };
        if (this.memoryManager) {
            await this.storeInMemory(`todo:${todoId}`, todo, {
                namespace: 'task_coordination',
                tags: [
                    'todo',
                    'progress_update'
                ]
            });
        }
        if (status === 'in_progress' && previousStatus === 'pending') {
            await this.createTaskFromTodo(todo);
        }
        this.emit('todo:updated', {
            todoId,
            status,
            previousStatus,
            todo
        });
    }
    async readTodos(sessionId, filter) {
        let todos = Array.from(this.todoItems.values());
        if (sessionId) {
            const sessionTodos = await this.getSessionTodos(sessionId);
            todos = todos.filter((todo)=>sessionTodos.some((st)=>st.id === todo.id));
        }
        if (filter) {
            if (filter.status) {
                todos = todos.filter((todo)=>filter.status.includes(todo.status));
            }
            if (filter.priority) {
                todos = todos.filter((todo)=>filter.priority.includes(todo.priority));
            }
            if (filter.assignedAgent) {
                todos = todos.filter((todo)=>todo.assignedAgent === filter.assignedAgent);
            }
            if (filter.tags) {
                todos = todos.filter((todo)=>todo.tags?.some((tag)=>filter.tags.includes(tag)));
            }
            if (filter.batchOptimized !== undefined) {
                todos = todos.filter((todo)=>todo.batchOptimized === filter.batchOptimized);
            }
        }
        return todos;
    }
    async storeInMemory(key, value, options = {}) {
        const entry = {
            key,
            value,
            timestamp: new Date(),
            namespace: options.namespace,
            tags: options.tags,
            expiresAt: options.expiresAt
        };
        this.memoryStore.set(key, entry);
        if (this.memoryManager) {
            const memoryKey = options.namespace ? `${options.namespace}:${key}` : key;
            await this.memoryManager.store(memoryKey, value, {
                tags: options.tags,
                expiresAt: options.expiresAt
            });
        }
        this.emit('memory:stored', {
            key,
            entry
        });
    }
    async retrieveFromMemory(key, namespace) {
        const memoryKey = namespace ? `${namespace}:${key}` : key;
        if (this.memoryManager) {
            try {
                const value = await this.memoryManager.retrieve(memoryKey);
                if (value !== null) return value;
            } catch (error) {}
        }
        const entry = this.memoryStore.get(key);
        if (!entry) return null;
        if (entry.expiresAt && entry.expiresAt < new Date()) {
            this.memoryStore.delete(key);
            return null;
        }
        return entry.value;
    }
    async queryMemory(query) {
        let entries = Array.from(this.memoryStore.values());
        if (query.namespace) {
            entries = entries.filter((entry)=>entry.namespace === query.namespace);
        }
        if (query.tags) {
            entries = entries.filter((entry)=>entry.tags?.some((tag)=>query.tags.includes(tag)));
        }
        if (query.keyPattern) {
            const pattern = new RegExp(query.keyPattern);
            entries = entries.filter((entry)=>pattern.test(entry.key));
        }
        if (query.since) {
            entries = entries.filter((entry)=>entry.timestamp >= query.since);
        }
        entries.sort((a, b)=>b.timestamp.getTime() - a.timestamp.getTime());
        if (query.limit) {
            entries = entries.slice(0, query.limit);
        }
        return entries;
    }
    async launchParallelAgents(tasks, coordinationContext) {
        const batchId = generateId('batch');
        const agentIds = [];
        const batchOperation = {
            id: batchId,
            type: 'parallel_agents',
            tasks,
            startedAt: new Date(),
            status: 'running',
            results: new Map(),
            errors: new Map()
        };
        this.batchOperations.set(batchId, batchOperation);
        await this.storeInMemory(`batch:${batchId}`, batchOperation, {
            namespace: 'coordination',
            tags: [
                'batch_operation',
                'parallel_agents'
            ]
        });
        for (const task of tasks){
            try {
                const agentId = await this.launchAgent(task, coordinationContext, batchId);
                agentIds.push(agentId);
                this.agentCoordination.set(agentId, {
                    agentId,
                    batchId,
                    objective: task.objective,
                    status: 'running',
                    startedAt: new Date(),
                    memoryKey: task.memoryKey,
                    coordinationContext
                });
            } catch (error) {
                batchOperation.errors.set(task.agentType, error);
            }
        }
        this.emit('agents:launched', {
            batchId,
            agentIds,
            tasks
        });
        return agentIds;
    }
    async coordinateBatchOperations(operations, context) {
        const batchId = generateId('batch_ops');
        const results = new Map();
        const groupedOps = new Map();
        for (const op of operations){
            if (!groupedOps.has(op.type)) {
                groupedOps.set(op.type, []);
            }
            groupedOps.get(op.type).push(op);
        }
        await this.storeInMemory(`batch_ops:${batchId}`, {
            operations,
            groupedOps: Object.fromEntries(groupedOps),
            context,
            startedAt: new Date()
        }, {
            namespace: 'coordination',
            tags: [
                'batch_operations',
                'efficiency'
            ]
        });
        const promises = [];
        for (const [type, ops] of Array.from(groupedOps.entries())){
            promises.push(this.executeBatchOperationType(type, ops, batchId, results));
        }
        await Promise.all(promises);
        this.emit('batch:completed', {
            batchId,
            results,
            context
        });
        return results;
    }
    async coordinateSwarm(objective, context, agents) {
        const swarmId = generateId('swarm');
        await this.storeInMemory(`swarm:${swarmId}`, {
            objective,
            context,
            agents,
            startedAt: new Date(),
            coordinationPattern: context.coordinationMode
        }, {
            namespace: 'swarm_coordination',
            tags: [
                'swarm',
                context.coordinationMode
            ]
        });
        switch(context.coordinationMode){
            case 'centralized':
                await this.coordinateCentralizedSwarm(swarmId, objective, agents);
                break;
            case 'distributed':
                await this.coordinateDistributedSwarm(swarmId, objective, agents);
                break;
            case 'hierarchical':
                await this.coordinateHierarchicalSwarm(swarmId, objective, agents);
                break;
            case 'mesh':
                await this.coordinateMeshSwarm(swarmId, objective, agents);
                break;
            case 'hybrid':
                await this.coordinateHybridSwarm(swarmId, objective, agents);
                break;
        }
    }
    async generateTaskBreakdown(objective, options) {
        const strategy = options.strategy || 'development';
        const todos = [];
        switch(strategy){
            case 'research':
                todos.push({
                    id: generateId('todo'),
                    content: 'Gather initial information and sources',
                    status: 'pending',
                    priority: 'high',
                    batchOptimized: true,
                    parallelExecution: true,
                    memoryKey: 'research_sources',
                    tags: [
                        'research',
                        'information_gathering'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }, {
                    id: generateId('todo'),
                    content: 'Analyze and synthesize findings',
                    status: 'pending',
                    priority: 'medium',
                    dependencies: [
                        'research_sources'
                    ],
                    batchOptimized: true,
                    memoryKey: 'research_analysis',
                    tags: [
                        'research',
                        'analysis'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                break;
            case 'development':
                todos.push({
                    id: generateId('todo'),
                    content: 'Design system architecture',
                    status: 'pending',
                    priority: 'high',
                    memoryKey: 'system_architecture',
                    tags: [
                        'development',
                        'architecture'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }, {
                    id: generateId('todo'),
                    content: 'Implement core functionality',
                    status: 'pending',
                    priority: 'high',
                    dependencies: [
                        'system_architecture'
                    ],
                    batchOptimized: true,
                    parallelExecution: true,
                    memoryKey: 'core_implementation',
                    tags: [
                        'development',
                        'implementation'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }, {
                    id: generateId('todo'),
                    content: 'Write comprehensive tests',
                    status: 'pending',
                    priority: 'medium',
                    dependencies: [
                        'core_implementation'
                    ],
                    batchOptimized: true,
                    memoryKey: 'test_suite',
                    tags: [
                        'development',
                        'testing'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                break;
            case 'analysis':
                todos.push({
                    id: generateId('todo'),
                    content: 'Collect and preprocess data',
                    status: 'pending',
                    priority: 'high',
                    batchOptimized: true,
                    parallelExecution: true,
                    memoryKey: 'analysis_data',
                    tags: [
                        'analysis',
                        'data_collection'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }, {
                    id: generateId('todo'),
                    content: 'Perform statistical analysis',
                    status: 'pending',
                    priority: 'high',
                    dependencies: [
                        'analysis_data'
                    ],
                    batchOptimized: true,
                    memoryKey: 'statistical_results',
                    tags: [
                        'analysis',
                        'statistics'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }, {
                    id: generateId('todo'),
                    content: 'Generate insights and reports',
                    status: 'pending',
                    priority: 'medium',
                    dependencies: [
                        'statistical_results'
                    ],
                    memoryKey: 'analysis_insights',
                    tags: [
                        'analysis',
                        'reporting'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                break;
            default:
                todos.push({
                    id: generateId('todo'),
                    content: `Analyze requirements for: ${objective}`,
                    status: 'pending',
                    priority: 'high',
                    memoryKey: 'requirements_analysis',
                    tags: [
                        'generic',
                        'requirements'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }, {
                    id: generateId('todo'),
                    content: `Execute main tasks for: ${objective}`,
                    status: 'pending',
                    priority: 'high',
                    dependencies: [
                        'requirements_analysis'
                    ],
                    batchOptimized: true,
                    parallelExecution: true,
                    memoryKey: 'main_execution',
                    tags: [
                        'generic',
                        'execution'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                }, {
                    id: generateId('todo'),
                    content: `Validate and finalize results`,
                    status: 'pending',
                    priority: 'medium',
                    dependencies: [
                        'main_execution'
                    ],
                    memoryKey: 'validation_results',
                    tags: [
                        'generic',
                        'validation'
                    ],
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
        }
        return todos;
    }
    async createTaskFromTodo(todo) {
        const taskData = {
            type: todo.tags?.[0] || 'general',
            description: todo.content,
            priority: this.priorityToNumber(todo.priority),
            assignedAgent: todo.assignedAgent,
            tags: todo.tags || [],
            metadata: {
                todoId: todo.id,
                batchOptimized: todo.batchOptimized,
                parallelExecution: todo.parallelExecution,
                memoryKey: todo.memoryKey
            }
        };
        return await this.taskEngine.createTask(taskData);
    }
    priorityToNumber(priority) {
        switch(priority){
            case 'critical':
                return 90;
            case 'high':
                return 80;
            case 'medium':
                return 50;
            case 'low':
                return 20;
            default:
                return 50;
        }
    }
    async launchAgent(task, context, batchId) {
        const agentId = generateId('agent');
        await this.storeInMemory(`agent:${agentId}`, {
            ...task,
            agentId,
            batchId,
            context,
            launchedAt: new Date()
        }, {
            namespace: 'agent_coordination',
            tags: [
                'agent_launch',
                task.agentType
            ]
        });
        return agentId;
    }
    async executeBatchOperationType(type, operations, batchId, results) {
        for (const op of operations){
            try {
                const result = await this.simulateBatchOperation(type, op);
                results.set(`${type}_${op.targets.join('_')}`, result);
            } catch (error) {
                results.set(`${type}_${op.targets.join('_')}_error`, error);
            }
        }
    }
    async simulateBatchOperation(type, operation) {
        await new Promise((resolve)=>setTimeout(resolve, 100));
        return {
            type,
            targets: operation.targets,
            result: `Simulated ${type} operation completed`,
            timestamp: new Date()
        };
    }
    async coordinateCentralizedSwarm(swarmId, objective, agents) {
        await this.storeInMemory(`swarm:${swarmId}:pattern`, {
            type: 'centralized',
            coordinator: 'main',
            agentAssignments: agents.map((agent)=>({
                    agentId: agent.type,
                    role: agent.role,
                    coordinator: 'main'
                }))
        });
    }
    async coordinateDistributedSwarm(swarmId, objective, agents) {
        const coordinators = [
            'research_coord',
            'impl_coord',
            'test_coord'
        ];
        await this.storeInMemory(`swarm:${swarmId}:pattern`, {
            type: 'distributed',
            coordinators,
            agentAssignments: agents.map((agent, index)=>({
                    agentId: agent.type,
                    role: agent.role,
                    coordinator: coordinators[index % coordinators.length]
                }))
        });
    }
    async coordinateHierarchicalSwarm(swarmId, objective, agents) {
        await this.storeInMemory(`swarm:${swarmId}:pattern`, {
            type: 'hierarchical',
            hierarchy: {
                master: 'main_coordinator',
                teamLeads: [
                    'frontend_lead',
                    'backend_lead',
                    'devops_lead'
                ],
                teams: {
                    frontend_lead: agents.filter((a)=>a.type.includes('frontend')),
                    backend_lead: agents.filter((a)=>a.type.includes('backend')),
                    devops_lead: agents.filter((a)=>a.type.includes('devops'))
                }
            }
        });
    }
    async coordinateMeshSwarm(swarmId, objective, agents) {
        await this.storeInMemory(`swarm:${swarmId}:pattern`, {
            type: 'mesh',
            peerConnections: agents.map((agent)=>({
                    agentId: agent.type,
                    peers: agents.filter((a)=>a.type !== agent.type).map((a)=>a.type)
                }))
        });
    }
    async coordinateHybridSwarm(swarmId, objective, agents) {
        await this.storeInMemory(`swarm:${swarmId}:pattern`, {
            type: 'hybrid',
            phases: [
                {
                    phase: 'planning',
                    pattern: 'centralized'
                },
                {
                    phase: 'execution',
                    pattern: 'distributed'
                },
                {
                    phase: 'integration',
                    pattern: 'hierarchical'
                }
            ]
        });
    }
    async getSessionTodos(sessionId) {
        const entries = await this.queryMemory({
            namespace: 'task_coordination',
            tags: [
                'todo',
                sessionId
            ]
        });
        return entries.map((entry)=>entry.value);
    }
    async handleTaskCreated(data) {
        const todoId = data.task.metadata?.todoId;
        if (todoId) {
            await this.updateTodoProgress(todoId, 'in_progress', {
                taskId: data.task.id,
                createdAt: data.task.createdAt
            });
        }
    }
    async handleTaskStarted(data) {
        await this.storeInMemory(`task_execution:${data.taskId}`, {
            status: 'started',
            agentId: data.agentId,
            startedAt: new Date()
        }, {
            namespace: 'task_execution',
            tags: [
                'task_start',
                data.agentId
            ]
        });
    }
    async handleTaskCompleted(data) {
        const task = (await this.taskEngine.getTaskStatus(data.taskId))?.task;
        const todoId = task?.metadata?.todoId;
        if (todoId) {
            await this.updateTodoProgress(todoId, 'completed', {
                completedAt: new Date(),
                result: data.result
            });
        }
        await this.storeInMemory(`task_execution:${data.taskId}`, {
            status: 'completed',
            result: data.result,
            completedAt: new Date()
        }, {
            namespace: 'task_execution',
            tags: [
                'task_completion'
            ]
        });
    }
    async handleTaskFailed(data) {
        await this.storeInMemory(`task_execution:${data.taskId}`, {
            status: 'failed',
            error: data.error.message,
            failedAt: new Date()
        }, {
            namespace: 'task_execution',
            tags: [
                'task_failure'
            ]
        });
    }
    async handleTaskCancelled(data) {
        await this.storeInMemory(`task_execution:${data.taskId}`, {
            status: 'cancelled',
            reason: data.reason,
            cancelledAt: new Date()
        }, {
            namespace: 'task_execution',
            tags: [
                'task_cancellation'
            ]
        });
    }
}

//# sourceMappingURL=coordination.js.map