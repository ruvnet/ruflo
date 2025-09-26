import { EventEmitter } from 'events';
import { generateId } from '../utils/helpers.js';
export class TaskEngine extends EventEmitter {
    maxConcurrent;
    memoryManager;
    tasks = new Map();
    executions = new Map();
    workflows = new Map();
    resources = new Map();
    dependencyGraph = new Map();
    readyQueue = [];
    runningTasks = new Set();
    cancelledTasks = new Set();
    taskState = new Map();
    constructor(maxConcurrent = 10, memoryManager){
        super(), this.maxConcurrent = maxConcurrent, this.memoryManager = memoryManager;
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.on('task:created', this.handleTaskCreated.bind(this));
        this.on('task:completed', this.handleTaskCompleted.bind(this));
        this.on('task:failed', this.handleTaskFailed.bind(this));
        this.on('task:cancelled', this.handleTaskCancelled.bind(this));
    }
    async createTask(taskData) {
        const task = {
            id: taskData.id || generateId('task'),
            type: taskData.type || 'general',
            description: taskData.description || '',
            priority: taskData.priority || 0,
            status: 'pending',
            input: taskData.input || {},
            createdAt: new Date(),
            dependencies: taskData.dependencies || [],
            resourceRequirements: taskData.resourceRequirements || [],
            schedule: taskData.schedule,
            retryPolicy: taskData.retryPolicy || {
                maxAttempts: 3,
                backoffMs: 1000,
                backoffMultiplier: 2
            },
            timeout: taskData.timeout || 300000,
            tags: taskData.tags || [],
            estimatedDurationMs: taskData.estimatedDurationMs,
            progressPercentage: 0,
            checkpoints: [],
            rollbackStrategy: taskData.rollbackStrategy || 'previous-checkpoint',
            metadata: taskData.metadata || {}
        };
        this.tasks.set(task.id, task);
        this.updateDependencyGraph(task);
        if (this.memoryManager) {
            await this.memoryManager.store(`task:${task.id}`, task);
        }
        this.emit('task:created', {
            task
        });
        this.scheduleTask(task);
        return task;
    }
    async listTasks(filter, sort, limit, offset) {
        let filteredTasks = Array.from(this.tasks.values());
        if (filter) {
            filteredTasks = filteredTasks.filter((task)=>{
                if (filter.status && !filter.status.includes(task.status)) return false;
                if (filter.assignedAgent && !filter.assignedAgent.includes(task.assignedAgent || '')) return false;
                if (filter.priority) {
                    if (filter.priority.min !== undefined && task.priority < filter.priority.min) return false;
                    if (filter.priority.max !== undefined && task.priority > filter.priority.max) return false;
                }
                if (filter.tags && !filter.tags.some((tag)=>task.tags.includes(tag))) return false;
                if (filter.createdAfter && task.createdAt < filter.createdAfter) return false;
                if (filter.createdBefore && task.createdAt > filter.createdBefore) return false;
                if (filter.dueBefore && task.schedule?.deadline && task.schedule.deadline > filter.dueBefore) return false;
                if (filter.search && !this.matchesSearch(task, filter.search)) return false;
                return true;
            });
        }
        if (sort) {
            filteredTasks.sort((a, b)=>{
                const direction = sort.direction === 'desc' ? -1 : 1;
                switch(sort.field){
                    case 'createdAt':
                        return direction * (a.createdAt.getTime() - b.createdAt.getTime());
                    case 'priority':
                        return direction * (a.priority - b.priority);
                    case 'deadline':
                        const aDeadline = a.schedule?.deadline?.getTime() || 0;
                        const bDeadline = b.schedule?.deadline?.getTime() || 0;
                        return direction * (aDeadline - bDeadline);
                    case 'estimatedDuration':
                        return direction * ((a.estimatedDurationMs || 0) - (b.estimatedDurationMs || 0));
                    default:
                        return 0;
                }
            });
        }
        const total = filteredTasks.length;
        const startIndex = offset || 0;
        const endIndex = limit ? startIndex + limit : filteredTasks.length;
        const tasks = filteredTasks.slice(startIndex, endIndex);
        return {
            tasks,
            total,
            hasMore: endIndex < total
        };
    }
    async getTaskStatus(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        const execution = this.executions.get(taskId);
        const dependencies = await Promise.all(task.dependencies.map(async (dep)=>{
            const depTask = this.tasks.get(dep.taskId);
            if (!depTask) throw new Error(`Dependency task ${dep.taskId} not found`);
            const satisfied = this.isDependencySatisfied(dep, depTask);
            return {
                task: depTask,
                satisfied
            };
        }));
        const dependents = Array.from(this.tasks.values()).filter((t)=>t.dependencies.some((dep)=>dep.taskId === taskId));
        const resourceStatus = task.resourceRequirements.map((req)=>{
            const resource = this.resources.get(req.resourceId);
            return {
                required: req,
                available: !!resource,
                allocated: resource?.lockedBy === taskId
            };
        });
        return {
            task,
            execution,
            dependencies,
            dependents,
            resourceStatus
        };
    }
    async cancelTask(taskId, reason = 'User requested', rollback = true) {
        const task = this.tasks.get(taskId);
        if (!task) throw new Error(`Task ${taskId} not found`);
        if (task.status === 'completed') {
            throw new Error(`Cannot cancel completed task ${taskId}`);
        }
        this.cancelledTasks.add(taskId);
        if (this.runningTasks.has(taskId)) {
            this.runningTasks.delete(taskId);
            const execution = this.executions.get(taskId);
            if (execution) {
                execution.status = 'cancelled';
                execution.completedAt = new Date();
            }
        }
        await this.releaseTaskResources(taskId);
        if (rollback && task.checkpoints.length > 0) {
            await this.rollbackTask(task);
        }
        task.status = 'cancelled';
        task.metadata = {
            ...task.metadata,
            cancellationReason: reason,
            cancelledAt: new Date()
        };
        if (this.memoryManager) {
            await this.memoryManager.store(`task:${taskId}`, task);
        }
        this.emit('task:cancelled', {
            taskId,
            reason
        });
        const dependents = Array.from(this.tasks.values()).filter((t)=>t.dependencies.some((dep)=>dep.taskId === taskId));
        for (const dependent of dependents){
            if (dependent.status === 'pending' || dependent.status === 'queued') {
                await this.cancelTask(dependent.id, `Dependency ${taskId} was cancelled`);
            }
        }
    }
    async executeWorkflow(workflow) {
        this.workflows.set(workflow.id, workflow);
        for (const task of workflow.tasks){
            this.tasks.set(task.id, task);
            this.updateDependencyGraph(task);
        }
        await this.processWorkflow(workflow);
    }
    async createWorkflow(workflowData) {
        const workflow = {
            id: workflowData.id || generateId('workflow'),
            name: workflowData.name || 'Unnamed Workflow',
            description: workflowData.description || '',
            version: workflowData.version || '1.0.0',
            tasks: workflowData.tasks || [],
            variables: workflowData.variables || {},
            parallelism: workflowData.parallelism || {
                maxConcurrent: this.maxConcurrent,
                strategy: 'priority-based'
            },
            errorHandling: workflowData.errorHandling || {
                strategy: 'fail-fast',
                maxRetries: 3
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: workflowData.createdBy || 'system'
        };
        this.workflows.set(workflow.id, workflow);
        if (this.memoryManager) {
            await this.memoryManager.store(`workflow:${workflow.id}`, workflow);
        }
        return workflow;
    }
    getDependencyGraph() {
        const nodes = Array.from(this.tasks.values()).map((task)=>({
                id: task.id,
                label: task.description,
                status: task.status,
                priority: task.priority,
                progress: task.progressPercentage,
                estimatedDuration: task.estimatedDurationMs,
                tags: task.tags
            }));
        const edges = [];
        for (const task of Array.from(this.tasks.values())){
            for (const dep of task.dependencies){
                edges.push({
                    from: dep.taskId,
                    to: task.id,
                    type: dep.type,
                    lag: dep.lag
                });
            }
        }
        return {
            nodes,
            edges
        };
    }
    updateDependencyGraph(task) {
        if (!this.dependencyGraph.has(task.id)) {
            this.dependencyGraph.set(task.id, new Set());
        }
        for (const dep of task.dependencies){
            if (!this.dependencyGraph.has(dep.taskId)) {
                this.dependencyGraph.set(dep.taskId, new Set());
            }
            this.dependencyGraph.get(dep.taskId).add(task.id);
        }
    }
    scheduleTask(task) {
        if (this.areTaskDependenciesSatisfied(task)) {
            this.readyQueue.push(task.id);
            this.processReadyQueue();
        }
    }
    areTaskDependenciesSatisfied(task) {
        return task.dependencies.every((dep)=>{
            const depTask = this.tasks.get(dep.taskId);
            return depTask && this.isDependencySatisfied(dep, depTask);
        });
    }
    isDependencySatisfied(dependency, depTask) {
        switch(dependency.type){
            case 'finish-to-start':
                return depTask.status === 'completed';
            case 'start-to-start':
                return depTask.status !== 'pending';
            case 'finish-to-finish':
                return depTask.status === 'completed';
            case 'start-to-finish':
                return depTask.status !== 'pending';
            default:
                return depTask.status === 'completed';
        }
    }
    async processReadyQueue() {
        while(this.readyQueue.length > 0 && this.runningTasks.size < this.maxConcurrent){
            const taskId = this.readyQueue.shift();
            if (this.cancelledTasks.has(taskId)) continue;
            const task = this.tasks.get(taskId);
            if (!task) continue;
            await this.executeTask(task);
        }
    }
    async executeTask(task) {
        if (!await this.acquireTaskResources(task)) {
            this.readyQueue.unshift(task.id);
            return;
        }
        const execution = {
            id: generateId('execution'),
            taskId: task.id,
            agentId: task.assignedAgent || 'system',
            startedAt: new Date(),
            status: 'running',
            progress: 0,
            metrics: {
                cpuUsage: 0,
                memoryUsage: 0,
                diskIO: 0,
                networkIO: 0,
                customMetrics: {}
            },
            logs: []
        };
        this.executions.set(task.id, execution);
        this.runningTasks.add(task.id);
        task.status = 'running';
        task.startedAt = new Date();
        this.emit('task:started', {
            taskId: task.id,
            agentId: execution.agentId
        });
        try {
            await this.simulateTaskExecution(task, execution);
            task.status = 'completed';
            task.completedAt = new Date();
            task.progressPercentage = 100;
            execution.status = 'completed';
            execution.completedAt = new Date();
            this.emit('task:completed', {
                taskId: task.id,
                result: task.output
            });
        } catch (error) {
            task.status = 'failed';
            task.error = error;
            execution.status = 'failed';
            execution.completedAt = new Date();
            this.emit('task:failed', {
                taskId: task.id,
                error
            });
        } finally{
            this.runningTasks.delete(task.id);
            await this.releaseTaskResources(task.id);
            if (this.memoryManager) {
                await this.memoryManager.store(`task:${task.id}`, task);
                await this.memoryManager.store(`execution:${execution.id}`, execution);
            }
        }
    }
    async simulateTaskExecution(task, execution) {
        const steps = 10;
        for(let i = 0; i <= steps; i++){
            if (this.cancelledTasks.has(task.id)) {
                throw new Error('Task was cancelled');
            }
            task.progressPercentage = i / steps * 100;
            execution.progress = task.progressPercentage;
            if (i % Math.ceil(steps / 4) === 0) {
                await this.createCheckpoint(task, `Step ${i} completed`);
            }
            await new Promise((resolve)=>setTimeout(resolve, 100));
        }
        task.output = {
            result: 'Task completed successfully',
            timestamp: new Date()
        };
    }
    async createCheckpoint(task, description) {
        const checkpoint = {
            id: generateId('checkpoint'),
            timestamp: new Date(),
            description,
            state: {
                ...this.taskState.get(task.id) || {}
            },
            artifacts: []
        };
        task.checkpoints.push(checkpoint);
        if (this.memoryManager) {
            await this.memoryManager.store(`checkpoint:${checkpoint.id}`, checkpoint);
        }
    }
    async rollbackTask(task) {
        if (task.checkpoints.length === 0) return;
        const targetCheckpoint = task.rollbackStrategy === 'initial-state' ? task.checkpoints[0] : task.checkpoints[task.checkpoints.length - 1];
        this.taskState.set(task.id, {
            ...targetCheckpoint.state
        });
        const targetIndex = task.checkpoints.findIndex((cp)=>cp.id === targetCheckpoint.id);
        task.checkpoints = task.checkpoints.slice(0, targetIndex + 1);
        task.progressPercentage = Math.max(0, task.progressPercentage - 25);
    }
    async acquireTaskResources(task) {
        for (const requirement of task.resourceRequirements){
            const resource = this.resources.get(requirement.resourceId);
            if (!resource) return false;
            if (resource.locked && requirement.exclusive) return false;
            resource.locked = true;
            resource.lockedBy = task.id;
            resource.lockedAt = new Date();
        }
        return true;
    }
    async releaseTaskResources(taskId) {
        for (const resource of Array.from(this.resources.values())){
            if (resource.lockedBy === taskId) {
                resource.locked = false;
                resource.lockedBy = undefined;
                resource.lockedAt = undefined;
            }
        }
    }
    matchesSearch(task, search) {
        const searchLower = search.toLowerCase();
        return task.description.toLowerCase().includes(searchLower) || task.type.toLowerCase().includes(searchLower) || task.tags.some((tag)=>tag.toLowerCase().includes(searchLower)) || (task.assignedAgent ? task.assignedAgent.toLowerCase().includes(searchLower) : false);
    }
    async processWorkflow(workflow) {
        for (const task of workflow.tasks){
            this.scheduleTask(task);
        }
    }
    handleTaskCreated(data) {}
    handleTaskCompleted(data) {
        const dependents = Array.from(this.tasks.values()).filter((task)=>task.dependencies.some((dep)=>dep.taskId === data.taskId));
        for (const dependent of dependents){
            if (this.areTaskDependenciesSatisfied(dependent)) {
                this.readyQueue.push(dependent.id);
            }
        }
        this.processReadyQueue();
    }
    handleTaskFailed(data) {
        const task = this.tasks.get(data.taskId);
        if (!task) return;
        if (task.retryPolicy && (task.metadata.retryCount || 0) < task.retryPolicy.maxAttempts) {
            const currentRetryCount = task.metadata.retryCount || 0;
            task.metadata = {
                ...task.metadata,
                retryCount: currentRetryCount + 1,
                lastRetryAt: new Date()
            };
            task.status = 'pending';
            setTimeout(()=>{
                this.scheduleTask(task);
            }, task.retryPolicy.backoffMs * Math.pow(task.retryPolicy.backoffMultiplier, currentRetryCount));
        }
    }
    handleTaskCancelled(data) {}
}

//# sourceMappingURL=engine.js.map