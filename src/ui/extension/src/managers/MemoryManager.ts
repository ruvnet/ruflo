import * as vscode from 'vscode';
import * as path from 'path';
import { IMemoryManager } from '../interfaces/IMemoryManager';
import { Context, SearchResult } from '../types/Memory';

export class MemoryManager implements IMemoryManager {
    private storage: Map<string, any> = new Map();
    private storagePath: string;

    constructor(private globalStorageUri: vscode.Uri) {
        this.storagePath = globalStorageUri.fsPath;
    }

    async store(key: string, value: any): Promise<void> {
        this.storage.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    async retrieve(key: string): Promise<any> {
        const item = this.storage.get(key);
        return item?.value;
    }

    async delete(key: string): Promise<void> {
        this.storage.delete(key);
    }

    async exists(key: string): Promise<boolean> {
        return this.storage.has(key);
    }

    async searchSemantic(query: string, limit: number = 10): Promise<SearchResult[]> {
        // Simple keyword search for now
        const results: SearchResult[] = [];
        
        for (const [key, item] of this.storage.entries()) {
            const content = JSON.stringify(item.value).toLowerCase();
            if (content.includes(query.toLowerCase())) {
                results.push({
                    id: key,
                    content: item.value,
                    score: 1.0, // Simple match
                    source: 'memory',
                    metadata: { timestamp: item.timestamp }
                });
            }
        }

        return results.slice(0, limit);
    }

    async getRelevantContext(query: string, maxTokens: number): Promise<Context[]> {
        const searchResults = await this.searchSemantic(query);
        const contexts: Context[] = [];

        for (const result of searchResults) {
            contexts.push({
                id: result.id,
                content: JSON.stringify(result.content),
                source: result.source,
                relevance: result.score,
                tokens: this.estimateTokens(JSON.stringify(result.content)),
                timestamp: result.metadata?.timestamp || Date.now()
            });
        }

        return this.pruneContext(contexts, maxTokens);
    }

    pruneContext(contexts: Context[], maxTokens: number): Context[] {
        // Sort by relevance
        contexts.sort((a, b) => b.relevance - a.relevance);

        const pruned: Context[] = [];
        let totalTokens = 0;

        for (const context of contexts) {
            if (totalTokens + context.tokens <= maxTokens) {
                pruned.push(context);
                totalTokens += context.tokens;
            }
        }

        return pruned;
    }

    getStoragePath(): string {
        return this.storagePath;
    }

    async getStorageSize(): Promise<number> {
        let size = 0;
        for (const [key, value] of this.storage.entries()) {
            size += JSON.stringify({ key, value }).length;
        }
        return size;
    }

    async clearStorage(): Promise<void> {
        this.storage.clear();
    }

    dispose(): void {
        this.storage.clear();
    }

    private estimateTokens(text: string): number {
        // Simple estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
}