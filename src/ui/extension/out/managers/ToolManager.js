"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolManager = void 0;
const events_1 = require("events");
const Permission_1 = require("../types/Permission");
class ToolManager extends events_1.EventEmitter {
    constructor(context) {
        super();
        this.context = context;
        this.tools = new Map();
        this.invocationHistory = [];
        this.permissionLevel = Permission_1.PermissionLevel.Normal;
    }
    registerTool(name, tool) {
        if (this.tools.has(name)) {
            throw new Error(`Tool ${name} already registered`);
        }
        this.tools.set(name, tool);
        this.emit('tool-registered', name);
    }
    async registerDefaultTools() {
        // Register file system tool
        this.registerTool('filesystem', {
            name: 'filesystem',
            description: 'File system operations',
            parameters: [
                {
                    name: 'action',
                    type: 'string',
                    description: 'Action to perform (read, write, delete)',
                    required: true
                },
                {
                    name: 'path',
                    type: 'string',
                    description: 'File path',
                    required: true
                }
            ],
            execute: async (args) => {
                // Simplified implementation for testing
                return {
                    success: true,
                    output: `Executed ${args.action} on ${args.path}`,
                    duration: 10
                };
            }
        });
        // Register terminal tool
        this.registerTool('terminal', {
            name: 'terminal',
            description: 'Terminal command execution',
            parameters: [
                {
                    name: 'command',
                    type: 'string',
                    description: 'Command to execute',
                    required: true
                }
            ],
            execute: async (args) => {
                return {
                    success: true,
                    output: `Executed: ${args.command}`,
                    duration: 100
                };
            }
        });
    }
    getRegisteredTools() {
        return Array.from(this.tools.keys());
    }
    async invokeTool(name, args) {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool ${name} not found`);
        }
        const invocation = {
            id: Math.random().toString(),
            tool: name,
            action: args.action || 'execute',
            args,
            timestamp: Date.now(),
            permitted: false
        };
        // Check permission
        if (!this.checkPermission(name, args.action || 'execute')) {
            invocation.result = {
                success: false,
                error: `Permission denied for ${name}.${args.action || 'execute'}`,
                duration: 0
            };
            this.invocationHistory.push(invocation);
            this.emit('tool-invocation-denied', invocation);
            throw new Error(invocation.result.error);
        }
        invocation.permitted = true;
        const startTime = Date.now();
        try {
            const result = await tool.execute(args);
            invocation.result = result;
            invocation.duration = Date.now() - startTime;
            this.invocationHistory.push(invocation);
            this.emit('tool-invoked', invocation);
            return result;
        }
        catch (error) {
            const errorResult = {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                duration: Date.now() - startTime
            };
            invocation.result = errorResult;
            invocation.duration = Date.now() - startTime;
            this.invocationHistory.push(invocation);
            this.emit('tool-error', invocation);
            throw error;
        }
    }
    checkPermission(tool, action) {
        // Destructive actions
        const destructiveActions = ['delete', 'remove', 'uninstall', 'format'];
        const isDestructive = destructiveActions.includes(action.toLowerCase());
        switch (this.permissionLevel) {
            case Permission_1.PermissionLevel.Restricted:
                // Always require permission
                return false;
            case Permission_1.PermissionLevel.Normal:
                // Require permission for destructive actions
                return !isDestructive;
            case Permission_1.PermissionLevel.Autonomous:
                // No permission required
                return true;
            default:
                return false;
        }
    }
    setPermissionLevel(level) {
        this.permissionLevel = level;
        this.emit('permission-level-changed', level);
    }
    getInvocationHistory() {
        return [...this.invocationHistory];
    }
    clearHistory() {
        this.invocationHistory = [];
        this.emit('history-cleared');
    }
    getTool(name) {
        return this.tools.get(name);
    }
    dispose() {
        this.removeAllListeners();
        this.tools.clear();
        this.invocationHistory = [];
    }
}
exports.ToolManager = ToolManager;
//# sourceMappingURL=ToolManager.js.map