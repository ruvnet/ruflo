import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
export class CollectiveMemory extends EventEmitter {
    constructor(config = {}){
        super();
        this.config = {
            persistenceDir: config.persistenceDir || './data/hive-memory',
            maxMemorySize: config.maxMemorySize || 100 * 1024 * 1024,
            compressionThreshold: config.compressionThreshold || 10 * 1024,
            syncInterval: config.syncInterval || 30000,
            defaultTTL: config.defaultTTL || 7 * 24 * 60 * 60 * 1000,
            maxCacheSize: config.maxCacheSize || 1000,
            enableCompression: config.enableCompression !== false,
            enablePatternDetection: config.enablePatternDetection !== false,
            shardCount: config.shardCount || 16,
            ...config
        };
        this.memory = new Map();
        this.memoryIndex = new Map();
        this.accessLog = new Map();
        this.shards = new Map();
        this.patterns = new Map();
        this.relationships = new Map();
        this.hotKeys = new Set();
        this.coldKeys = new Set();
        this.persistenceQueue = [];
        this.lastSync = 0;
        this.isDirty = false;
        this.stats = {
            totalKeys: 0,
            totalSize: 0,
            cacheHits: 0,
            cacheMisses: 0,
            patternDetections: 0,
            compressionSaved: 0,
            lastCleanup: 0
        };
        this.initialized = false;
        this.init();
    }
    async init() {
        try {
            await fs.mkdir(this.config.persistenceDir, {
                recursive: true
            });
            await this.loadFromDisk();
            this.initializeShards();
            this.startBackgroundTasks();
            this.initialized = true;
            this.emit('initialized');
            console.log(`Collective memory initialized with ${this.memory.size} entries`);
        } catch (error) {
            console.error('Failed to initialize collective memory:', error);
            throw error;
        }
    }
    initializeShards() {
        for(let i = 0; i < this.config.shardCount; i++){
            this.shards.set(i, {
                id: i,
                keys: new Set(),
                size: 0,
                lastAccess: Date.now(),
                hotness: 0
            });
        }
    }
    getShardForKey(key) {
        const hash = this.hashKey(key);
        return hash % this.config.shardCount;
    }
    hashKey(key) {
        let hash = 0;
        for(let i = 0; i < key.length; i++){
            const char = key.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
    async store(key, value, options = {}) {
        if (!this.initialized) {
            throw new Error('Memory system not initialized');
        }
        const namespace = options.namespace || 'default';
        const ttl = options.ttl || this.config.defaultTTL;
        const agent = options.agent || 'system';
        const tags = options.tags || [];
        const priority = options.priority || 'normal';
        const compression = options.compression !== false && this.config.enableCompression;
        const fullKey = `${namespace}:${key}`;
        const serializedValue = JSON.stringify(value);
        const originalSize = Buffer.byteLength(serializedValue, 'utf8');
        let storedValue = serializedValue;
        let compressed = false;
        let compressionRatio = 1;
        if (compression && originalSize > this.config.compressionThreshold) {
            const compressedValue = await this.compressData(serializedValue);
            if (compressedValue.length < originalSize * 0.8) {
                storedValue = compressedValue;
                compressed = true;
                compressionRatio = originalSize / compressedValue.length;
                this.stats.compressionSaved += originalSize - compressedValue.length;
            }
        }
        const entry = {
            key: fullKey,
            value: storedValue,
            originalValue: value,
            size: Buffer.byteLength(storedValue, 'utf8'),
            originalSize,
            compressed,
            compressionRatio,
            namespace,
            agent,
            tags: new Set(tags),
            priority,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            expiresAt: ttl ? Date.now() + ttl : null,
            version: 1,
            accessCount: 0,
            lastAccessed: Date.now(),
            accessHistory: [],
            relationships: new Set(),
            derivedFrom: options.derivedFrom ? new Set([
                options.derivedFrom
            ]) : new Set(),
            persistent: options.persistent !== false,
            shareable: options.shareable !== false,
            cacheable: options.cacheable !== false
        };
        const existingEntry = this.memory.get(fullKey);
        if (existingEntry) {
            entry.version = existingEntry.version + 1;
            entry.createdAt = existingEntry.createdAt;
            entry.accessCount = existingEntry.accessCount;
            entry.accessHistory = existingEntry.accessHistory;
            entry.relationships = existingEntry.relationships;
        }
        this.memory.set(fullKey, entry);
        this.updateIndex(fullKey, entry);
        this.updateShard(fullKey, entry);
        this.stats.totalKeys = this.memory.size;
        this.stats.totalSize += entry.size;
        if (existingEntry) {
            this.stats.totalSize -= existingEntry.size;
        }
        this.isDirty = true;
        this.queueForPersistence(entry);
        if (this.config.enablePatternDetection) {
            this.detectPatterns(entry);
        }
        this.updateRelationships(fullKey, entry);
        this.emit('stored', {
            key: fullKey,
            size: entry.size,
            compressed,
            agent,
            namespace
        });
        if (this.memory.size > this.config.maxCacheSize) {
            await this.cleanup();
        }
        return fullKey;
    }
    async retrieve(key, options = {}) {
        const namespace = options.namespace || 'default';
        const fullKey = `${namespace}:${key}`;
        const agent = options.agent || 'system';
        const decompress = options.decompress !== false;
        let entry = this.memory.get(fullKey);
        if (entry) {
            this.stats.cacheHits++;
        } else {
            this.stats.cacheMisses++;
            entry = await this.loadFromDisk(fullKey);
            if (entry) {
                this.memory.set(fullKey, entry);
            }
        }
        if (!entry) {
            return null;
        }
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            await this.delete(key, {
                namespace
            });
            return null;
        }
        entry.accessCount++;
        entry.lastAccessed = Date.now();
        entry.accessHistory.push({
            agent,
            timestamp: Date.now(),
            operation: 'read'
        });
        if (entry.accessHistory.length > 100) {
            entry.accessHistory = entry.accessHistory.slice(-50);
        }
        this.updateHotness(fullKey, entry);
        this.logAccess(fullKey, agent, 'read');
        this.emit('retrieved', {
            key: fullKey,
            agent,
            accessCount: entry.accessCount
        });
        if (entry.compressed && decompress) {
            if (entry.originalValue) {
                return entry.originalValue;
            }
            try {
                const decompressed = await this.decompressData(entry.value);
                const parsed = JSON.parse(decompressed);
                entry.originalValue = parsed;
                return parsed;
            } catch (error) {
                console.error(`Failed to decompress data for key ${fullKey}:`, error);
                return null;
            }
        }
        if (entry.originalValue) {
            return entry.originalValue;
        }
        try {
            return JSON.parse(entry.value);
        } catch (error) {
            console.error(`Failed to parse data for key ${fullKey}:`, error);
            return null;
        }
    }
    async delete(key, options = {}) {
        const namespace = options.namespace || 'default';
        const fullKey = `${namespace}:${key}`;
        const entry = this.memory.get(fullKey);
        if (!entry) {
            return false;
        }
        this.memory.delete(fullKey);
        this.removeFromIndex(fullKey);
        this.removeFromShard(fullKey);
        this.stats.totalKeys = this.memory.size;
        this.stats.totalSize -= entry.size;
        this.removeRelationships(fullKey);
        this.queueForDeletion(fullKey);
        this.emit('deleted', {
            key: fullKey
        });
        return true;
    }
    async search(query, options = {}) {
        const namespace = options.namespace;
        const tags = options.tags;
        const agent = options.agent;
        const limit = options.limit || 100;
        const sortBy = options.sortBy || 'relevance';
        let results = [];
        for (const [key, entry] of this.memory){
            if (namespace && entry.namespace !== namespace) continue;
            if (agent && entry.agent !== agent) continue;
            let score = 0;
            if (key.toLowerCase().includes(query.toLowerCase())) {
                score += 10;
            }
            if (tags && tags.length > 0) {
                const matchingTags = tags.filter((tag)=>entry.tags.has(tag));
                score += matchingTags.length * 5;
            }
            if (entry.originalValue) {
                const content = JSON.stringify(entry.originalValue).toLowerCase();
                if (content.includes(query.toLowerCase())) {
                    score += 3;
                }
            }
            if (score > 0) {
                results.push({
                    key,
                    entry,
                    score,
                    relevance: score
                });
            }
        }
        switch(sortBy){
            case 'relevance':
                results.sort((a, b)=>b.score - a.score);
                break;
            case 'recent':
                results.sort((a, b)=>b.entry.lastAccessed - a.entry.lastAccessed);
                break;
            case 'created':
                results.sort((a, b)=>b.entry.createdAt - a.entry.createdAt);
                break;
            case 'access':
                results.sort((a, b)=>b.entry.accessCount - a.entry.accessCount);
                break;
        }
        return results.slice(0, limit).map((r)=>({
                key: r.key,
                value: r.entry.originalValue || JSON.parse(r.entry.value),
                score: r.score,
                metadata: {
                    namespace: r.entry.namespace,
                    agent: r.entry.agent,
                    tags: Array.from(r.entry.tags),
                    accessCount: r.entry.accessCount,
                    lastAccessed: r.entry.lastAccessed,
                    createdAt: r.entry.createdAt
                }
            }));
    }
    getRelatedKeys(key, options = {}) {
        const namespace = options.namespace || 'default';
        const fullKey = `${namespace}:${key}`;
        const maxResults = options.limit || 10;
        const relationships = this.relationships.get(fullKey);
        if (!relationships) {
            return [];
        }
        return Array.from(relationships.entries()).map(([relatedKey, strength])=>({
                key: relatedKey,
                strength,
                entry: this.memory.get(relatedKey)
            })).filter((r)=>r.entry).sort((a, b)=>b.strength - a.strength).slice(0, maxResults);
    }
    async shareMemory(fromAgent, toAgent, keys, options = {}) {
        const shared = [];
        const namespace = options.namespace || 'default';
        for (const key of keys){
            const fullKey = `${namespace}:${key}`;
            const entry = this.memory.get(fullKey);
            if (!entry || !entry.shareable) {
                continue;
            }
            const sharedKey = `shared:${toAgent}:${key}`;
            await this.store(sharedKey, entry.originalValue || JSON.parse(entry.value), {
                namespace: 'shared',
                agent: toAgent,
                derivedFrom: fullKey,
                tags: [
                    ...entry.tags,
                    'shared',
                    'from:' + fromAgent
                ],
                ttl: options.ttl || entry.expiresAt ? entry.expiresAt - Date.now() : undefined
            });
            shared.push({
                originalKey: fullKey,
                sharedKey: `shared:${sharedKey}`,
                agent: toAgent
            });
        }
        this.emit('memory:shared', {
            fromAgent,
            toAgent,
            keys: shared.length
        });
        return shared;
    }
    detectPatterns(entry) {
        this.detectCoAccessPatterns(entry);
        this.detectTemporalPatterns(entry);
        this.detectContentPatterns(entry);
        this.detectAgentPatterns(entry);
    }
    detectCoAccessPatterns(entry) {
        const recentAccesses = Array.from(this.accessLog.entries()).filter(([_, log])=>Date.now() - log.timestamp < 3600000).map(([key, log])=>key);
        if (recentAccesses.length < 2) return;
        for (const accessedKey of recentAccesses){
            if (accessedKey === entry.key) continue;
            const pattern = this.patterns.get(`co-access:${entry.key}:${accessedKey}`) || {
                type: 'co-access',
                keys: [
                    entry.key,
                    accessedKey
                ],
                frequency: 0,
                confidence: 0,
                lastSeen: 0
            };
            pattern.frequency++;
            pattern.lastSeen = Date.now();
            pattern.confidence = Math.min(1.0, pattern.frequency / 10);
            this.patterns.set(`co-access:${entry.key}:${accessedKey}`, pattern);
            if (pattern.confidence > 0.7) {
                this.updateRelationship(entry.key, accessedKey, pattern.confidence);
            }
        }
    }
    detectTemporalPatterns(entry) {
        if (entry.accessHistory.length < 5) return;
        const intervals = [];
        for(let i = 1; i < entry.accessHistory.length; i++){
            intervals.push(entry.accessHistory[i].timestamp - entry.accessHistory[i - 1].timestamp);
        }
        const avgInterval = intervals.reduce((sum, interval)=>sum + interval, 0) / intervals.length;
        const variance = intervals.reduce((sum, interval)=>sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
        if (variance < avgInterval * 0.2) {
            const pattern = {
                type: 'temporal',
                key: entry.key,
                avgInterval,
                confidence: 1 - variance / avgInterval,
                nextPredicted: entry.lastAccessed + avgInterval
            };
            this.patterns.set(`temporal:${entry.key}`, pattern);
        }
    }
    updateRelationship(key1, key2, strength) {
        if (!this.relationships.has(key1)) {
            this.relationships.set(key1, new Map());
        }
        if (!this.relationships.has(key2)) {
            this.relationships.set(key2, new Map());
        }
        this.relationships.get(key1).set(key2, strength);
        this.relationships.get(key2).set(key1, strength);
    }
    updateIndex(key, entry) {
        for (const tag of entry.tags){
            if (!this.memoryIndex.has(`tag:${tag}`)) {
                this.memoryIndex.set(`tag:${tag}`, new Set());
            }
            this.memoryIndex.get(`tag:${tag}`).add(key);
        }
        if (!this.memoryIndex.has(`agent:${entry.agent}`)) {
            this.memoryIndex.set(`agent:${entry.agent}`, new Set());
        }
        this.memoryIndex.get(`agent:${entry.agent}`).add(key);
        if (!this.memoryIndex.has(`namespace:${entry.namespace}`)) {
            this.memoryIndex.set(`namespace:${entry.namespace}`, new Set());
        }
        this.memoryIndex.get(`namespace:${entry.namespace}`).add(key);
    }
    updateShard(key, entry) {
        const shardId = this.getShardForKey(key);
        const shard = this.shards.get(shardId);
        if (!shard.keys.has(key)) {
            shard.keys.add(key);
            shard.size += entry.size;
        }
        shard.lastAccess = Date.now();
        shard.hotness = Math.min(10, shard.hotness + 0.1);
    }
    updateHotness(key, entry) {
        const now = Date.now();
        const recentAccesses = entry.accessHistory.filter((access)=>now - access.timestamp < 3600000).length;
        if (recentAccesses > 5) {
            this.hotKeys.add(key);
            this.coldKeys.delete(key);
        } else if (recentAccesses === 0 && now - entry.lastAccessed > 86400000) {
            this.coldKeys.add(key);
            this.hotKeys.delete(key);
        }
    }
    logAccess(key, agent, operation) {
        this.accessLog.set(key, {
            key,
            agent,
            operation,
            timestamp: Date.now()
        });
        if (this.accessLog.size > 10000) {
            const entries = Array.from(this.accessLog.entries()).sort(([, a], [, b])=>b.timestamp - a.timestamp).slice(0, 5000);
            this.accessLog.clear();
            for (const [key, log] of entries){
                this.accessLog.set(key, log);
            }
        }
    }
    async compressData(data) {
        return Buffer.from(data).toString('base64');
    }
    async decompressData(data) {
        return Buffer.from(data, 'base64').toString();
    }
    queueForPersistence(entry) {
        this.persistenceQueue.push({
            action: 'store',
            entry
        });
    }
    queueForDeletion(key) {
        this.persistenceQueue.push({
            action: 'delete',
            key
        });
    }
    async saveToDisk() {
        if (!this.isDirty && this.persistenceQueue.length === 0) {
            return;
        }
        try {
            for (const item of this.persistenceQueue){
                if (item.action === 'store') {
                    const filename = path.join(this.config.persistenceDir, `${item.entry.namespace}_${this.hashKey(item.entry.key) % 100}.json`);
                    let data = {};
                    try {
                        const existing = await fs.readFile(filename, 'utf8');
                        data = JSON.parse(existing);
                    } catch (error) {}
                    data[item.entry.key] = {
                        ...item.entry,
                        accessHistory: [],
                        originalValue: undefined
                    };
                    await fs.writeFile(filename, JSON.stringify(data, null, 2));
                } else if (item.action === 'delete') {
                    const namespace = item.key.split(':')[0];
                    const filename = path.join(this.config.persistenceDir, `${namespace}_${this.hashKey(item.key) % 100}.json`);
                    try {
                        const existing = await fs.readFile(filename, 'utf8');
                        const data = JSON.parse(existing);
                        delete data[item.key];
                        await fs.writeFile(filename, JSON.stringify(data, null, 2));
                    } catch (error) {}
                }
            }
            this.persistenceQueue = [];
            this.isDirty = false;
            this.lastSync = Date.now();
            this.emit('persisted', {
                entries: this.memory.size
            });
        } catch (error) {
            console.error('Failed to save memory to disk:', error);
            this.emit('persistence:error', error);
        }
    }
    async loadFromDisk(specificKey = null) {
        try {
            const files = await fs.readdir(this.config.persistenceDir);
            for (const file of files){
                if (!file.endsWith('.json')) continue;
                const filepath = path.join(this.config.persistenceDir, file);
                const data = JSON.parse(await fs.readFile(filepath, 'utf8'));
                for (const [key, entry] of Object.entries(data)){
                    if (specificKey && key !== specificKey) continue;
                    entry.tags = new Set(entry.tags || []);
                    entry.relationships = new Set(entry.relationships || []);
                    entry.derivedFrom = new Set(entry.derivedFrom || []);
                    entry.accessHistory = [];
                    entry.originalValue = undefined;
                    this.memory.set(key, entry);
                    this.updateIndex(key, entry);
                    this.updateShard(key, entry);
                    if (specificKey === key) {
                        return entry;
                    }
                }
            }
            return specificKey ? null : true;
        } catch (error) {
            console.error('Failed to load memory from disk:', error);
            return null;
        }
    }
    startBackgroundTasks() {
        setInterval(()=>{
            this.saveToDisk();
        }, this.config.syncInterval);
        setInterval(()=>{
            this.cleanup();
        }, 60000);
        setInterval(()=>{
            this.updateStatistics();
        }, 10000);
    }
    async cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.memory){
            if (entry.expiresAt && now > entry.expiresAt) {
                await this.delete(key.split(':')[1], {
                    namespace: entry.namespace
                });
                cleaned++;
                continue;
            }
            if (this.memory.size > this.config.maxCacheSize * 0.9) {
                const daysSinceAccess = (now - entry.lastAccessed) / 86400000;
                if (daysSinceAccess > 7 && entry.accessCount < 2) {
                    await this.delete(key.split(':')[1], {
                        namespace: entry.namespace
                    });
                    cleaned++;
                }
            }
        }
        this.stats.lastCleanup = now;
        if (cleaned > 0) {
            this.emit('cleanup:completed', {
                entriesRemoved: cleaned
            });
        }
    }
    updateStatistics() {
        this.stats.totalKeys = this.memory.size;
        this.stats.totalSize = Array.from(this.memory.values()).reduce((sum, entry)=>sum + entry.size, 0);
    }
    getStatistics() {
        const hitRate = this.stats.cacheHits + this.stats.cacheMisses > 0 ? this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) : 0;
        return {
            ...this.stats,
            hitRate,
            hotKeys: this.hotKeys.size,
            coldKeys: this.coldKeys.size,
            patterns: this.patterns.size,
            relationships: this.relationships.size,
            shards: Array.from(this.shards.values()).map((s)=>({
                    id: s.id,
                    keyCount: s.keys.size,
                    size: s.size,
                    hotness: s.hotness
                })),
            memoryUsage: {
                used: this.stats.totalSize,
                max: this.config.maxMemorySize,
                percentage: this.stats.totalSize / this.config.maxMemorySize * 100
            }
        };
    }
    removeFromIndex(key) {
        for (const [indexKey, keys] of this.memoryIndex){
            if (keys.has(key)) {
                keys.delete(key);
                if (keys.size === 0) {
                    this.memoryIndex.delete(indexKey);
                }
            }
        }
    }
    removeFromShard(key) {
        const shardId = this.getShardForKey(key);
        const shard = this.shards.get(shardId);
        if (shard && shard.keys.has(key)) {
            shard.keys.delete(key);
            const entry = this.memory.get(key);
            if (entry) {
                shard.size -= entry.size;
            }
        }
    }
    removeRelationships(key) {
        const relationships = this.relationships.get(key);
        if (relationships) {
            for (const relatedKey of relationships.keys()){
                const relatedRels = this.relationships.get(relatedKey);
                if (relatedRels) {
                    relatedRels.delete(key);
                    if (relatedRels.size === 0) {
                        this.relationships.delete(relatedKey);
                    }
                }
            }
            this.relationships.delete(key);
        }
    }
    async shutdown() {
        console.log('Shutting down collective memory...');
        await this.saveToDisk();
        this.emit('shutdown');
        this.removeAllListeners();
    }
}

//# sourceMappingURL=memory.js.map