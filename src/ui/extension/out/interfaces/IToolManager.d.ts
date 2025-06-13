import { Tool, ToolResult, ToolInvocation } from '../types/Tool';
import { PermissionLevel } from '../types/Permission';
export interface IToolManager {
    registerTool(name: string, tool: Tool): void;
    registerDefaultTools(): Promise<void>;
    getRegisteredTools(): string[];
    invokeTool(name: string, args: any): Promise<ToolResult>;
    checkPermission(tool: string, action: string): boolean;
    setPermissionLevel(level: PermissionLevel): void;
    getInvocationHistory(): ToolInvocation[];
    clearHistory(): void;
    dispose(): void;
}
//# sourceMappingURL=IToolManager.d.ts.map