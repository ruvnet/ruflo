import { PermissionLevel } from '../types/Permission';
export interface IConfigManager {
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
//# sourceMappingURL=IConfigManager.d.ts.map