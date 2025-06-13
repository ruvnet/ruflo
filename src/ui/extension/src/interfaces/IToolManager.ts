import { Tool, ToolResult, ToolInvocation } from '../types/Tool';
import { PermissionLevel } from '../types/Permission';

export interface IToolManager {
    // Tool registration
    registerTool(name: string, tool: Tool): void;
    registerDefaultTools(): Promise<void>;
    getRegisteredTools(): string[];
    
    // Tool invocation
    invokeTool(name: string, args: any): Promise<ToolResult>;
    
    // Permission management
    checkPermission(tool: string, action: string): boolean;
    setPermissionLevel(level: PermissionLevel): void;
    
    // History and logging
    getInvocationHistory(): ToolInvocation[];
    clearHistory(): void;
    
    // Lifecycle
    dispose(): void;
}