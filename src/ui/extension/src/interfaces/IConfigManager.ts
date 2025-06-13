import { PermissionLevel } from '../types/Permission';

export interface IConfigManager {
    // Initialization
    initialize(): Promise<void>;
    
    // API configuration
    getApiKey(): Promise<string>;
    setApiKey(key: string): Promise<void>;
    getModel(): string;
    setModel(model: string): Promise<void>;
    
    // Settings
    getMaxTokens(): number;
    setMaxTokens(tokens: number): Promise<void>;
    getPermissionLevel(): PermissionLevel;
    setPermissionLevel(level: PermissionLevel): Promise<void>;
    
    // Configuration management
    get<T>(key: string, defaultValue?: T): T;
    set(key: string, value: any): Promise<void>;
    
    // Lifecycle
    dispose(): void;
}