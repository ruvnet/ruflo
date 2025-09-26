export function isObject(value) {
    return typeof value === 'object' && value !== null;
}
export function isError(value) {
    return value instanceof Error;
}
export function hasMessage(value) {
    return isObject(value) && 'message' in value && typeof value.message === 'string';
}
export function hasStack(value) {
    return isObject(value) && 'stack' in value && typeof value.stack === 'string';
}
export function isErrorLike(value) {
    return hasMessage(value);
}
export function hasCode(value) {
    return isObject(value) && 'code' in value && (typeof value.code === 'string' || typeof value.code === 'number');
}
export function hasAgentId(value) {
    return isObject(value) && 'agentId' in value && isObject(value.agentId) && 'id' in value.agentId && typeof value.agentId.id === 'string';
}
export function hasPid(value) {
    return isObject(value) && 'pid' in value && typeof value.pid === 'number';
}
export function getErrorMessage(error) {
    if (typeof error === 'string') {
        return error;
    }
    if (isError(error)) {
        return error.message;
    }
    if (hasMessage(error)) {
        return error.message;
    }
    return String(error);
}
export function getErrorStack(error) {
    if (isError(error)) {
        return error.stack;
    }
    if (hasStack(error)) {
        return error.stack;
    }
    return undefined;
}
export function isString(value) {
    return typeof value === 'string';
}
export function isNumber(value) {
    return typeof value === 'number' && !isNaN(value);
}
export function isBoolean(value) {
    return typeof value === 'boolean';
}
export function isArray(value) {
    return Array.isArray(value);
}
export function isFunction(value) {
    return typeof value === 'function';
}
export function isNullOrUndefined(value) {
    return value === null || value === undefined;
}
export function isDefined(value) {
    return value !== null && value !== undefined;
}
export function hasAgentLoad(value) {
    return isObject(value) && 'agentId' in value && isObject(value.agentId) && 'id' in value.agentId && typeof value.agentId.id === 'string' && 'load' in value && typeof value.load === 'number';
}
export function hasAgentTask(value) {
    return isObject(value) && 'agentId' in value && isObject(value.agentId) && 'id' in value.agentId && typeof value.agentId.id === 'string' && 'task' in value;
}
export function hasWorkStealingData(value) {
    return isObject(value) && 'sourceAgent' in value && isObject(value.sourceAgent) && 'id' in value.sourceAgent && typeof value.sourceAgent.id === 'string' && 'targetAgent' in value && isObject(value.targetAgent) && 'id' in value.targetAgent && typeof value.targetAgent.id === 'string' && 'taskCount' in value && typeof value.taskCount === 'number';
}

//# sourceMappingURL=type-guards.js.map