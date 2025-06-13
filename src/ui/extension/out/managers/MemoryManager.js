"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryManager = void 0;
class MemoryManager {
    constructor(globalStorageUri) {
        this.globalStorageUri = globalStorageUri;
        this.storage = new Map();
        this.storagePath = globalStorageUri.fsPath;
    }
    async store(key, value) {
        this.storage.set(key, {
            value,
            timestamp: Date.now()
        });
    }
    async retrieve(key) {
        const item = this.storage.get(key);
        return item?.value;
    }
    async delete(key) {
        this.storage.delete(key);
    }
    async exists(key) {
        return this.storage.has(key);
    }
    async searchSemantic(query, limit = 10) {
        // Simple keyword search for now
        const results = [];
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
    async getRelevantContext(query, maxTokens) {
        const searchResults = await this.searchSemantic(query);
        const contexts = [];
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
    pruneContext(contexts, maxTokens) {
        // Sort by relevance
        contexts.sort((a, b) => b.relevance - a.relevance);
        const pruned = [];
        let totalTokens = 0;
        for (const context of contexts) {
            if (totalTokens + context.tokens <= maxTokens) {
                pruned.push(context);
                totalTokens += context.tokens;
            }
        }
        return pruned;
    }
    getStoragePath() {
        return this.storagePath;
    }
    async getStorageSize() {
        let size = 0;
        for (const [key, value] of this.storage.entries()) {
            size += JSON.stringify({ key, value }).length;
        }
        return size;
    }
    async clearStorage() {
        this.storage.clear();
    }
    dispose() {
        this.storage.clear();
    }
    estimateTokens(text) {
        // Simple estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
}
exports.MemoryManager = MemoryManager;
//# sourceMappingURL=MemoryManager.js.map