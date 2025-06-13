import { Context, SearchResult } from '../types/Memory';
export interface IMemoryManager {
    store(key: string, value: any): Promise<void>;
    retrieve(key: string): Promise<any>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    searchSemantic(query: string, limit?: number): Promise<SearchResult[]>;
    getRelevantContext(query: string, maxTokens: number): Promise<Context[]>;
    pruneContext(contexts: Context[], maxTokens: number): Context[];
    getStoragePath(): string;
    getStorageSize(): Promise<number>;
    clearStorage(): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=IMemoryManager.d.ts.map