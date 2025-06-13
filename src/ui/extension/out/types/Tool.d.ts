export interface Tool {
    name: string;
    description: string;
    parameters: ToolParameter[];
    execute: (args: any) => Promise<ToolResult>;
}
export interface ToolParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    required: boolean;
    default?: any;
}
export interface ToolResult {
    success: boolean;
    output?: any;
    error?: string;
    duration: number;
}
export interface ToolInvocation {
    id: string;
    tool: string;
    action: string;
    args: any;
    result?: ToolResult;
    timestamp: number;
    duration?: number;
    permitted: boolean;
}
//# sourceMappingURL=Tool.d.ts.map