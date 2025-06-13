import * as vscode from 'vscode';
import { IMemoryManager } from '../interfaces/IMemoryManager';
import { Context, SearchResult } from '../types/Memory';
export declare class MemoryManager implements IMemoryManager {
    private globalStorageUri;
    private storage;
    private storagePath;
    constructor(globalStorageUri: vscode.Uri);
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
    private estimateTokens;
}
//# sourceMappingURL=MemoryManager.d.ts.map