import * as vscode from 'vscode';
import { IConfigManager } from '../interfaces/IConfigManager';
import { PermissionLevel } from '../types/Permission';
export declare class ConfigManager implements IConfigManager {
    private context;
    private static readonly CONFIG_KEY;
    private configuration;
    constructor(context: vscode.ExtensionContext);
    initialize(): Promise<void>;
    getApiKey(): Promise<string>;
    setApiKey(key: string): Promise<void>;
    getModel(): string;
    setModel(model: string): Promise<void>;
    getMaxTokens(): number;
    setMaxTokens(tokens: number): Promise<void>;
    getPermissionLevel(): PermissionLevel;
    setPermissionLevel(level: PermissionLevel): Promise<void>;
    get<T>(key: string, defaultValue?: T): T;
    set(key: string, value: any): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=ConfigManager.d.ts.map