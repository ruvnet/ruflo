import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { IToolManager } from '../interfaces/IToolManager';
import { Tool, ToolResult, ToolInvocation } from '../types/Tool';
import { PermissionLevel } from '../types/Permission';
export declare class ToolManager extends EventEmitter implements IToolManager {
    private context;
    private tools;
    private invocationHistory;
    private permissionLevel;
    constructor(context: vscode.ExtensionContext);
    registerTool(name: string, tool: Tool): void;
    registerDefaultTools(): Promise<void>;
    getRegisteredTools(): string[];
    invokeTool(name: string, args: any): Promise<ToolResult>;
    checkPermission(tool: string, action: string): boolean;
    setPermissionLevel(level: PermissionLevel): void;
    getInvocationHistory(): ToolInvocation[];
    clearHistory(): void;
    getTool(name: string): Tool | undefined;
    dispose(): void;
}
//# sourceMappingURL=ToolManager.d.ts.map