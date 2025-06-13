import { Context, SearchResult } from '../types/Memory';

export interface IMemoryManager {
    // Storage operations
    store(key: string, value: any): Promise<void>;
    retrieve(key: string): Promise<any>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    
    // Semantic search
    searchSemantic(query: string, limit?: number): Promise<SearchResult[]>;
    
    // Context management
    getRelevantContext(query: string, maxTokens: number): Promise<Context[]>;
    pruneContext(contexts: Context[], maxTokens: number): Context[];
    
    // Storage management
    getStoragePath(): string;
    getStorageSize(): Promise<number>;
    clearStorage(): Promise<void>;
    
    // Lifecycle
    dispose(): void;
}