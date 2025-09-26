export function createTaskCreateCommand(context) {
    return {
        name: 'create',
        description: 'Create a new task',
        execute: async (args)=>{
            try {
                const task = await context.taskEngine.createTask(args);
                context.logger?.info('Task created successfully', {
                    taskId: task.id
                });
                return task;
            } catch (error) {
                context.logger?.error('Failed to create task', error);
                throw error;
            }
        }
    };
}
export function createTaskListCommand(context) {
    return {
        name: 'list',
        description: 'List all tasks',
        execute: async (filter, sort, limit, offset)=>{
            try {
                const result = await context.taskEngine.listTasks(filter, sort, limit, offset);
                context.logger?.info('Tasks listed successfully', {
                    count: result.tasks.length
                });
                return result;
            } catch (error) {
                context.logger?.error('Failed to list tasks', error);
                throw error;
            }
        }
    };
}
export function createTaskStatusCommand(context) {
    return {
        name: 'status',
        description: 'Get task status',
        execute: async (taskId)=>{
            try {
                const status = await context.taskEngine.getTaskStatus(taskId);
                if (!status) {
                    throw new Error(`Task ${taskId} not found`);
                }
                context.logger?.info('Task status retrieved', {
                    taskId
                });
                return status;
            } catch (error) {
                context.logger?.error('Failed to get task status', error);
                throw error;
            }
        }
    };
}
export function createTaskCancelCommand(context) {
    return {
        name: 'cancel',
        description: 'Cancel a task',
        execute: async (taskId, reason = 'User requested', rollback = true)=>{
            try {
                await context.taskEngine.cancelTask(taskId, reason, rollback);
                context.logger?.info('Task cancelled successfully', {
                    taskId,
                    reason
                });
                return {
                    success: true,
                    taskId,
                    reason
                };
            } catch (error) {
                context.logger?.error('Failed to cancel task', error);
                throw error;
            }
        }
    };
}
export function createTaskWorkflowCommand(context) {
    return {
        name: 'workflow',
        description: 'Manage task workflows',
        execute: async (action, ...args)=>{
            try {
                switch(action){
                    case 'create':
                        const [workflowData] = args;
                        const createdWorkflow = await context.taskEngine.createWorkflow(workflowData);
                        context.logger?.info('Workflow created successfully', {
                            workflowId: createdWorkflow.id
                        });
                        return createdWorkflow;
                    case 'execute':
                        const [workflowToExecute] = args;
                        await context.taskEngine.executeWorkflow(workflowToExecute);
                        context.logger?.info('Workflow execution started', {
                            workflowId: workflowToExecute.id
                        });
                        return {
                            success: true,
                            workflowId: workflowToExecute.id
                        };
                    case 'list':
                        context.logger?.info('Workflow list requested');
                        return {
                            workflows: []
                        };
                    case 'get':
                        const [workflowId] = args;
                        context.logger?.info('Workflow details requested', {
                            workflowId
                        });
                        return {
                            workflowId
                        };
                    default:
                        throw new Error(`Unknown workflow action: ${action}`);
                }
            } catch (error) {
                context.logger?.error('Workflow operation failed', error);
                throw error;
            }
        }
    };
}

//# sourceMappingURL=commands.js.map