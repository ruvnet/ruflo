export class ClaudeFlowError extends Error {
    code;
    details;
    constructor(message, code, details){
        super(message), this.code = code, this.details = details;
        this.name = 'ClaudeFlowError';
        Error.captureStackTrace(this, this.constructor);
    }
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            details: this.details,
            stack: this.stack
        };
    }
}
export class TerminalError extends ClaudeFlowError {
    constructor(message, details){
        super(message, 'TERMINAL_ERROR', details);
        this.name = 'TerminalError';
    }
}
export class TerminalSpawnError extends TerminalError {
    code = 'TERMINAL_SPAWN_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export class TerminalCommandError extends TerminalError {
    code = 'TERMINAL_COMMAND_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export class MemoryError extends ClaudeFlowError {
    constructor(message, details){
        super(message, 'MEMORY_ERROR', details);
        this.name = 'MemoryError';
    }
}
export class MemoryBackendError extends MemoryError {
    code = 'MEMORY_BACKEND_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export class MemoryConflictError extends MemoryError {
    code = 'MEMORY_CONFLICT_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export class CoordinationError extends ClaudeFlowError {
    constructor(message, details){
        super(message, 'COORDINATION_ERROR', details);
        this.name = 'CoordinationError';
    }
}
export class DeadlockError extends CoordinationError {
    agents;
    resources;
    code = 'DEADLOCK_ERROR';
    constructor(message, agents, resources){
        super(message, {
            agents,
            resources
        }), this.agents = agents, this.resources = resources;
    }
}
export class ResourceLockError extends CoordinationError {
    code = 'RESOURCE_LOCK_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export class MCPError extends ClaudeFlowError {
    constructor(message, details){
        super(message, 'MCP_ERROR', details);
        this.name = 'MCPError';
    }
}
export class MCPTransportError extends MCPError {
    code = 'MCP_TRANSPORT_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export class MCPMethodNotFoundError extends MCPError {
    code = 'MCP_METHOD_NOT_FOUND';
    constructor(method){
        super(`Method not found: ${method}`, {
            method
        });
    }
}
export class ConfigError extends ClaudeFlowError {
    constructor(message, details){
        super(message, 'CONFIG_ERROR', details);
        this.name = 'ConfigError';
    }
}
export class ValidationError extends ConfigError {
    code = 'VALIDATION_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export class TaskError extends ClaudeFlowError {
    constructor(message, details){
        super(message, 'TASK_ERROR', details);
        this.name = 'TaskError';
    }
}
export class TaskTimeoutError extends TaskError {
    code = 'TASK_TIMEOUT_ERROR';
    constructor(taskId, timeout){
        super(`Task ${taskId} timed out after ${timeout}ms`, {
            taskId,
            timeout
        });
    }
}
export class TaskDependencyError extends TaskError {
    code = 'TASK_DEPENDENCY_ERROR';
    constructor(taskId, dependencies){
        super(`Task ${taskId} has unmet dependencies`, {
            taskId,
            dependencies
        });
    }
}
export class SystemError extends ClaudeFlowError {
    constructor(message, details){
        super(message, 'SYSTEM_ERROR', details);
        this.name = 'SystemError';
    }
}
export class InitializationError extends SystemError {
    code = 'INITIALIZATION_ERROR';
    constructor(componentOrMessage, details){
        const message = componentOrMessage.includes('initialize') ? componentOrMessage : `Failed to initialize ${componentOrMessage}`;
        super(message, details ? {
            component: componentOrMessage,
            ...details
        } : {
            component: componentOrMessage
        });
    }
}
export class ShutdownError extends SystemError {
    code = 'SHUTDOWN_ERROR';
    constructor(message, details){
        super(message, details);
    }
}
export function isClaudeFlowError(error) {
    return error instanceof ClaudeFlowError;
}
export function formatError(error) {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}
export function getErrorDetails(error) {
    if (isClaudeFlowError(error)) {
        return error.details;
    }
    return undefined;
}

//# sourceMappingURL=errors.js.map