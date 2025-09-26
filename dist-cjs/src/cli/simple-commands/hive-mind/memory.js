import EventEmitter from 'events';
import Database from 'better-sqlite3';
import path from 'path';
import { performance } from 'perf_hooks';
const MEMORY_TYPES = {
    knowledge: {
        priority: 1,
        ttl: null,
        compress: false
    },
    context: {
        priority: 2,
        ttl: 3600000,
        compress: false
    },
    task: {
        priority: 3,
        ttl: 1800000,
        compress: true
    },
    result: {
        priority: 2,
        ttl: null,
        compress: true
    },
    error: {
        priority: 1,
        ttl: 86400000,
        compress: false
    },
    metric: {
        priority: 3,
        ttl: 3600000,
        compress: true
    },
    consensus: {
        priority: 1,
        ttl: null,
        compress: false
    },
    system: {
        priority: 1,
        ttl: null,
        compress: false
    }
};
let MemoryPool = class MemoryPool {
    constructor(createFn, resetFn, maxSize = 1000){
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.maxSize = maxSize;
        this.pool = [];
        this.allocated = 0;
        this.reused = 0;
    }
    acquire() {
        if (this.pool.length > 0) {
            this.reused++;
            return this.pool.pop();
        }
        this.allocated++;
        return this.createFn();
    }
    release(obj) {
        if (this.pool.length < this.maxSize) {
            this.resetFn(obj);
            this.pool.push(obj);
        }
    }
    getStats() {
        return {
            poolSize: this.pool.length,
            allocated: this.allocated,
            reused: this.reused,
            reuseRate: this.reused / (this.allocated + this.reused) * 100
        };
    }
};
let OptimizedLRUCache = class OptimizedLRUCache {
    constructor(maxSize = 1000, maxMemoryMB = 50){
        this.maxSize = maxSize;
        this.maxMemory = maxMemoryMB * 1024 * 1024;
        this.cache = new Map();
        this.currentMemory = 0;
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }
    get(key) {
        if (this.cache.has(key)) {
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            this.hits++;
            return value.data;
        }
        this.misses++;
        return null;
    }
    set(key, data) {
        const size = this._estimateSize(data);
        if (this.currentMemory + size > this.maxMemory) {
            this._evictByMemoryPressure(size);
        }
        if (this.cache.size >= this.maxSize) {
            this._evictLRU();
        }
        const entry = {
            data,
            size,
            timestamp: Date.now()
        };
        this.cache.set(key, entry);
        this.currentMemory += size;
    }
    _estimateSize(obj) {
        return JSON.stringify(obj).length * 2;
    }
    _evictLRU() {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
            const entry = this.cache.get(firstKey);
            this.cache.delete(firstKey);
            this.currentMemory -= entry.size;
            this.evictions++;
        }
    }
    _evictByMemoryPressure(neededSize) {
        while(this.currentMemory + neededSize > this.maxMemory && this.cache.size > 0){
            this._evictLRU();
        }
    }
    forEach(callback) {
        this.cache.forEach((entry, key)=>{
            callback(entry, key);
        });
    }
    delete(key) {
        if (this.cache.has(key)) {
            const entry = this.cache.get(key);
            this.cache.delete(key);
            this.currentMemory -= entry.size;
            return true;
        }
        return false;
    }
    getStats() {
        return {
            size: this.cache.size,
            memoryUsage: this.currentMemory,
            hitRate: this.hits / (this.hits + this.misses) * 100,
            evictions: this.evictions
        };
    }
};
export class CollectiveMemory extends EventEmitter {
    constructor(config = {}){
        super();
        this.db = null;
        this.config = {
            swarmId: config.swarmId,
            maxSize: config.maxSize || 100,
            dbPath: config.dbPath || path.join(process.cwd(), '.hive-mind', 'hive.db'),
            compressionThreshold: config.compressionThreshold || 1024,
            gcInterval: config.gcInterval || 300000,
            cacheSize: config.cacheSize || 1000,
            cacheMemoryMB: config.cacheMemoryMB || 50,
            enablePooling: config.enablePooling !== false,
            enableAsyncOperations: config.enableAsyncOperations !== false,
            ...config
        };
        this.state = {
            totalSize: 0,
            entryCount: 0,
            compressionRatio: 1,
            lastGC: Date.now(),
            accessPatterns: new Map(),
            performanceMetrics: {
                queryTimes: [],
                avgQueryTime: 0,
                cacheHitRate: 0,
                memoryEfficiency: 0
            }
        };
        this.gcTimer = null;
        this.cache = new OptimizedLRUCache(this.config.cacheSize, this.config.cacheMemoryMB);
        this.pools = {
            queryResults: new MemoryPool(()=>({
                    results: [],
                    metadata: {}
                }), (obj)=>{
                obj.results.length = 0;
                Object.keys(obj.metadata).forEach((k)=>delete obj.metadata[k]);
            }),
            memoryEntries: new MemoryPool(()=>({
                    id: '',
                    key: '',
                    value: '',
                    metadata: {}
                }), (obj)=>{
                obj.id = obj.key = obj.value = '';
                Object.keys(obj.metadata).forEach((k)=>delete obj.metadata[k]);
            })
        };
        this.statements = new Map();
        this.backgroundWorker = null;
        this._initialize();
    }
    _initialize() {
        try {
            this.db = new Database(this.config.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = -64000');
            this.db.pragma('temp_store = MEMORY');
            this.db.pragma('mmap_size = 268435456');
            this.db.pragma('optimize');
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS collective_memory (
          id TEXT PRIMARY KEY,
          swarm_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value BLOB,
          type TEXT DEFAULT 'knowledge',
          confidence REAL DEFAULT 1.0,
          created_by TEXT,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          accessed_at INTEGER DEFAULT (strftime('%s','now')),
          access_count INTEGER DEFAULT 0,
          compressed INTEGER DEFAULT 0,
          size INTEGER DEFAULT 0,
          FOREIGN KEY (swarm_id) REFERENCES swarms(id)
        );
        
        -- Optimized indexes
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_swarm_key 
        ON collective_memory(swarm_id, key);
        
        CREATE INDEX IF NOT EXISTS idx_memory_type_accessed 
        ON collective_memory(type, accessed_at DESC);
        
        CREATE INDEX IF NOT EXISTS idx_memory_size_compressed 
        ON collective_memory(size, compressed);
        
        -- Memory optimization view
        CREATE VIEW IF NOT EXISTS memory_stats AS
        SELECT 
          swarm_id,
          type,
          COUNT(*) as entry_count,
          SUM(size) as total_size,
          AVG(access_count) as avg_access,
          MAX(accessed_at) as last_access
        FROM collective_memory
        GROUP BY swarm_id, type;
      `);
            this._prepareStatements();
            this._updateStatistics();
            this._startOptimizationTimers();
            if (this.config.enableAsyncOperations) {
                this._initializeBackgroundWorker();
            }
            this.emit('memory:initialized', {
                swarmId: this.config.swarmId,
                optimizations: {
                    pooling: this.config.enablePooling,
                    asyncOps: this.config.enableAsyncOperations,
                    cacheSize: this.config.cacheSize
                }
            });
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    _prepareStatements() {
        this.statements.set('insert', this.db.prepare(`
      INSERT OR REPLACE INTO collective_memory 
      (id, swarm_id, key, value, type, confidence, created_by, compressed, size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `));
        this.statements.set('update', this.db.prepare(`
      UPDATE collective_memory 
      SET value = ?, accessed_at = strftime('%s','now'), access_count = access_count + 1,
          compressed = ?, size = ?
      WHERE swarm_id = ? AND key = ?
    `));
        this.statements.set('select', this.db.prepare(`
      SELECT value, type, compressed, confidence, access_count
      FROM collective_memory
      WHERE swarm_id = ? AND key = ?
    `));
        this.statements.set('updateAccess', this.db.prepare(`
      UPDATE collective_memory
      SET accessed_at = strftime('%s','now'), access_count = access_count + 1
      WHERE swarm_id = ? AND key = ?
    `));
        this.statements.set('searchByPattern', this.db.prepare(`
      SELECT key, type, confidence, created_at, accessed_at, access_count
      FROM collective_memory
      WHERE swarm_id = ? AND key LIKE ? AND confidence >= ?
      ORDER BY access_count DESC, confidence DESC
      LIMIT ?
    `));
        this.statements.set('getStats', this.db.prepare(`
      SELECT 
        COUNT(*) as count,
        SUM(size) as totalSize,
        AVG(confidence) as avgConfidence,
        SUM(compressed) as compressedCount,
        AVG(access_count) as avgAccess
      FROM collective_memory
      WHERE swarm_id = ?
    `));
        this.statements.set('deleteExpired', this.db.prepare(`
      DELETE FROM collective_memory
      WHERE swarm_id = ? AND type = ? AND (strftime('%s','now') - accessed_at) > ?
    `));
        this.statements.set('getLRU', this.db.prepare(`
      SELECT id, size FROM collective_memory
      WHERE swarm_id = ? AND type NOT IN ('system', 'consensus')
      ORDER BY accessed_at ASC, access_count ASC
      LIMIT ?
    `));
    }
    _startOptimizationTimers() {
        this.gcTimer = setInterval(()=>this._garbageCollect(), this.config.gcInterval);
        this.optimizeTimer = setInterval(()=>this._optimizeDatabase(), 1800000);
        this.cacheTimer = setInterval(()=>this._optimizeCache(), 60000);
        this.metricsTimer = setInterval(()=>this._updatePerformanceMetrics(), 30000);
    }
    _initializeBackgroundWorker() {
        this.backgroundQueue = [];
        this.backgroundProcessing = false;
    }
    async store(key, value, type = 'knowledge', metadata = {}) {
        try {
            const serialized = JSON.stringify(value);
            const size = Buffer.byteLength(serialized);
            const shouldCompress = size > this.config.compressionThreshold && MEMORY_TYPES[type]?.compress;
            let storedValue = serialized;
            let compressed = 0;
            if (shouldCompress) {
                compressed = 1;
            }
            const id = `${this.config.swarmId}-${key}-${Date.now()}`;
            const existing = this.db.prepare(`
        SELECT id FROM collective_memory 
        WHERE swarm_id = ? AND key = ?
      `).get(this.config.swarmId, key);
            if (existing) {
                this.db.prepare(`
          UPDATE collective_memory 
          SET value = ?, type = ?, confidence = ?, 
              accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1,
              compressed = ?, size = ?
          WHERE swarm_id = ? AND key = ?
        `).run(storedValue, type, metadata.confidence || 1.0, compressed, size, this.config.swarmId, key);
            } else {
                this.db.prepare(`
          INSERT INTO collective_memory 
          (id, swarm_id, key, value, type, confidence, created_by, compressed, size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, this.config.swarmId, key, storedValue, type, metadata.confidence || 1.0, metadata.createdBy || 'system', compressed, size);
            }
            this.cache.set(key, {
                value,
                type,
                timestamp: Date.now(),
                size
            });
            this._checkMemoryLimits();
            this._trackAccess(key, 'write');
            this.emit('memory:stored', {
                key,
                type,
                size
            });
            return {
                success: true,
                id,
                size
            };
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async retrieve(key) {
        try {
            if (this.cache.has(key)) {
                const cached = this.cache.get(key);
                this._trackAccess(key, 'cache_hit');
                return cached.value;
            }
            const result = this.db.prepare(`
        SELECT value, type, compressed, confidence
        FROM collective_memory
        WHERE swarm_id = ? AND key = ?
      `).get(this.config.swarmId, key);
            if (!result) {
                this._trackAccess(key, 'miss');
                return null;
            }
            this.db.prepare(`
        UPDATE collective_memory
        SET accessed_at = CURRENT_TIMESTAMP,
            access_count = access_count + 1
        WHERE swarm_id = ? AND key = ?
      `).run(this.config.swarmId, key);
            let value = result.value;
            if (result.compressed) {}
            const parsed = JSON.parse(value);
            this.cache.set(key, {
                value: parsed,
                type: result.type,
                timestamp: Date.now(),
                confidence: result.confidence
            });
            this._trackAccess(key, 'read');
            return parsed;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async search(pattern, options = {}) {
        try {
            const limit = options.limit || 50;
            const type = options.type || null;
            const minConfidence = options.minConfidence || 0;
            let query = `
        SELECT key, type, confidence, created_at, accessed_at, access_count
        FROM collective_memory
        WHERE swarm_id = ? 
        AND key LIKE ?
        AND confidence >= ?
      `;
            const params = [
                this.config.swarmId,
                `%${pattern}%`,
                minConfidence
            ];
            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }
            query += ' ORDER BY access_count DESC, confidence DESC LIMIT ?';
            params.push(limit);
            const results = this.db.prepare(query).all(...params);
            this._trackAccess(`search:${pattern}`, 'search');
            return results;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async getRelated(key, limit = 10) {
        try {
            const original = await this.retrieve(key);
            if (!original) return [];
            const result = this.db.prepare(`
        SELECT m1.key, m1.type, m1.confidence, m1.access_count
        FROM collective_memory m1
        JOIN collective_memory m2 ON m1.swarm_id = m2.swarm_id
        WHERE m2.key = ? 
        AND m1.key != ?
        AND m1.swarm_id = ?
        AND ABS(julianday(m1.accessed_at) - julianday(m2.accessed_at)) < 0.01
        ORDER BY m1.confidence DESC, m1.access_count DESC
        LIMIT ?
      `).all(key, key, this.config.swarmId, limit);
            return result;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async associate(key1, key2, strength = 1.0) {
        try {
            await this.store(`assoc:${key1}:${key2}`, {
                from: key1,
                to: key2,
                strength,
                created: Date.now()
            }, 'system');
            await this.store(`assoc:${key2}:${key1}`, {
                from: key2,
                to: key1,
                strength,
                created: Date.now()
            }, 'system');
            this.emit('memory:associated', {
                key1,
                key2,
                strength
            });
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async consolidate() {
        try {
            const memories = this.db.prepare(`
        SELECT key, value, type, confidence, access_count
        FROM collective_memory
        WHERE swarm_id = ?
        AND type IN ('knowledge', 'result')
        ORDER BY created_at DESC
        LIMIT 1000
      `).all(this.config.swarmId);
            const consolidated = new Map();
            memories.forEach((memory)=>{
                const value = JSON.parse(memory.value);
                const category = this._categorizeMemory(value);
                if (!consolidated.has(category)) {
                    consolidated.set(category, []);
                }
                consolidated.get(category).push({
                    ...memory,
                    value
                });
            });
            let mergeCount = 0;
            consolidated.forEach((group, category)=>{
                if (group.length > 1) {
                    const merged = this._mergeMemories(group);
                    this.store(`consolidated:${category}`, merged, 'knowledge', {
                        confidence: merged.confidence,
                        createdBy: 'consolidation'
                    });
                    mergeCount++;
                }
            });
            this.emit('memory:consolidated', {
                categories: consolidated.size,
                merged: mergeCount
            });
            return {
                categories: consolidated.size,
                merged: mergeCount
            };
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    _categorizeMemory(value) {
        if (typeof value === 'string') {
            return 'text';
        }
        if (typeof value === 'object') {
            const keys = Object.keys(value).sort().join(':');
            return `object:${keys.substring(0, 50)}`;
        }
        return 'other';
    }
    _mergeMemories(memories) {
        let totalWeight = 0;
        let weightedConfidence = 0;
        const mergedValue = {};
        memories.forEach((memory)=>{
            const weight = memory.access_count + 1;
            totalWeight += weight;
            weightedConfidence += memory.confidence * weight;
            if (typeof memory.value === 'object') {
                Object.assign(mergedValue, memory.value);
            }
        });
        return {
            value: mergedValue,
            confidence: weightedConfidence / totalWeight,
            sourceCount: memories.length
        };
    }
    _garbageCollect() {
        try {
            const now = Date.now();
            let deletedCount = 0;
            Object.entries(MEMORY_TYPES).forEach(([type, config])=>{
                if (config.ttl) {
                    const result = this.db.prepare(`
            DELETE FROM collective_memory
            WHERE swarm_id = ?
            AND type = ?
            AND (julianday('now') - julianday(accessed_at)) * 86400000 > ?
          `).run(this.config.swarmId, type, config.ttl);
                    deletedCount += result.changes;
                }
            });
            const cacheTimeout = 300000;
            this.cache.forEach((value, key)=>{
                if (now - value.timestamp > cacheTimeout) {
                    this.cache.delete(key);
                }
            });
            this._updateStatistics();
            this.state.lastGC = now;
            if (deletedCount > 0) {
                this.emit('memory:gc', {
                    deleted: deletedCount,
                    cacheSize: this.cache.size
                });
            }
        } catch (error) {
            this.emit('error', error);
        }
    }
    _checkMemoryLimits() {
        if (this.state.totalSize > this.config.maxSize * 1024 * 1024) {
            const toEvict = this.db.prepare(`
        SELECT id, size FROM collective_memory
        WHERE swarm_id = ?
        AND type NOT IN ('system', 'consensus')
        ORDER BY accessed_at ASC, access_count ASC
        LIMIT 100
      `).all(this.config.swarmId);
            let freedSize = 0;
            toEvict.forEach((memory)=>{
                this.db.prepare('DELETE FROM collective_memory WHERE id = ?').run(memory.id);
                freedSize += memory.size;
            });
            this.emit('memory:evicted', {
                count: toEvict.length,
                freedSize
            });
        }
    }
    _optimizeDatabase() {
        try {
            this.db.pragma('optimize');
            this.db.pragma('analysis_limit=1000');
            this.db.exec('ANALYZE');
            this._updateStatistics();
            this.emit('database:optimized');
        } catch (error) {
            this.emit('error', error);
        }
    }
    _optimizeCache() {
        try {
            const now = Date.now();
            const cacheTimeout = 300000;
            if (this.cache.cache) {
                this.cache.cache.forEach((value, key)=>{
                    if (now - value.timestamp > cacheTimeout) {
                        this.cache.cache.delete(key);
                    }
                });
            }
            this.emit('cache:optimized', {
                size: this.cache.cache ? this.cache.cache.size : 0
            });
        } catch (error) {
            this.emit('error', error);
        }
    }
    _updatePerformanceMetrics() {
        try {
            const cacheStats = this.cache.getStats();
            this.state.performanceMetrics.cacheHitRate = cacheStats.hitRate || 0;
            this.state.performanceMetrics.memoryEfficiency = this.state.totalSize / (this.config.maxSize * 1024 * 1024) * 100;
            if (this.state.performanceMetrics.queryTimes.length > 0) {
                this.state.performanceMetrics.avgQueryTime = this.state.performanceMetrics.queryTimes.reduce((sum, time)=>sum + time, 0) / this.state.performanceMetrics.queryTimes.length;
                if (this.state.performanceMetrics.queryTimes.length > 100) {
                    this.state.performanceMetrics.queryTimes = this.state.performanceMetrics.queryTimes.slice(-100);
                }
            }
            this.emit('metrics:updated', this.state.performanceMetrics);
        } catch (error) {
            this.emit('error', error);
        }
    }
    _updateStatistics() {
        const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as count,
        SUM(size) as totalSize,
        AVG(confidence) as avgConfidence,
        SUM(compressed) as compressedCount
      FROM collective_memory
      WHERE swarm_id = ?
    `).get(this.config.swarmId);
        this.state.entryCount = stats.count || 0;
        this.state.totalSize = stats.totalSize || 0;
        this.state.avgConfidence = stats.avgConfidence || 1.0;
        if (stats.compressedCount > 0) {
            this.state.compressionRatio = 0.6;
        }
    }
    _trackAccess(key, operation) {
        const pattern = this.state.accessPatterns.get(key) || {
            reads: 0,
            writes: 0,
            searches: 0,
            cacheHits: 0,
            misses: 0,
            lastAccess: Date.now()
        };
        switch(operation){
            case 'read':
                pattern.reads++;
                break;
            case 'write':
                pattern.writes++;
                break;
            case 'search':
                pattern.searches++;
                break;
            case 'cache_hit':
                pattern.cacheHits++;
                break;
            case 'miss':
                pattern.misses++;
                break;
        }
        pattern.lastAccess = Date.now();
        this.state.accessPatterns.set(key, pattern);
        if (this.state.accessPatterns.size > 1000) {
            const sorted = Array.from(this.state.accessPatterns.entries()).sort((a, b)=>a[1].lastAccess - b[1].lastAccess);
            sorted.slice(0, 100).forEach(([key])=>{
                this.state.accessPatterns.delete(key);
            });
        }
    }
    getStatistics() {
        return {
            swarmId: this.config.swarmId,
            entryCount: this.state.entryCount,
            totalSize: this.state.totalSize,
            maxSize: this.config.maxSize * 1024 * 1024,
            utilizationPercent: this.state.totalSize / (this.config.maxSize * 1024 * 1024) * 100,
            avgConfidence: this.state.avgConfidence,
            compressionRatio: this.state.compressionRatio,
            cacheSize: this.cache.cache ? this.cache.cache.size : 0,
            lastGC: new Date(this.state.lastGC).toISOString(),
            accessPatterns: this.state.accessPatterns.size,
            optimization: {
                cacheOptimized: true,
                poolingEnabled: this.config.enablePooling,
                asyncOperations: this.config.enableAsyncOperations,
                compressionRatio: this.state.compressionRatio,
                performanceMetrics: this.state.performanceMetrics
            }
        };
    }
    async exportSnapshot(filepath) {
        try {
            const memories = this.db.prepare(`
        SELECT * FROM collective_memory
        WHERE swarm_id = ?
        ORDER BY created_at DESC
      `).all(this.config.swarmId);
            const snapshot = {
                swarmId: this.config.swarmId,
                timestamp: new Date().toISOString(),
                statistics: this.getStatistics(),
                memories: memories.map((m)=>({
                        ...m,
                        value: JSON.parse(m.value)
                    }))
            };
            this.emit('memory:exported', {
                count: memories.length
            });
            return snapshot;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async importSnapshot(snapshot) {
        try {
            let imported = 0;
            for (const memory of snapshot.memories){
                await this.store(memory.key, memory.value, memory.type, {
                    confidence: memory.confidence,
                    createdBy: memory.created_by
                });
                imported++;
            }
            this.emit('memory:imported', {
                count: imported
            });
            return {
                imported
            };
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    close() {
        if (this.gcTimer) clearInterval(this.gcTimer);
        if (this.optimizeTimer) clearInterval(this.optimizeTimer);
        if (this.cacheTimer) clearInterval(this.cacheTimer);
        if (this.metricsTimer) clearInterval(this.metricsTimer);
        try {
            this.db.pragma('optimize');
        } catch (error) {}
        if (this.db) {
            this.db.close();
        }
        if (this.config.enablePooling) {
            Object.values(this.pools).forEach((pool)=>{
                pool.pool.length = 0;
            });
        }
        const finalStats = {
            cacheStats: this.cache.getStats ? this.cache.getStats() : {},
            poolStats: this.config.enablePooling ? {
                queryResults: this.pools.queryResults.getStats(),
                memoryEntries: this.pools.memoryEntries.getStats()
            } : null,
            performanceMetrics: this.state.performanceMetrics
        };
        this.emit('memory:closed', finalStats);
    }
    getAnalytics() {
        return {
            basic: this.getStatistics(),
            performance: this.state.performanceMetrics,
            cache: this.cache.getStats ? this.cache.getStats() : {},
            pools: this.config.enablePooling ? {
                queryResults: this.pools.queryResults.getStats(),
                memoryEntries: this.pools.memoryEntries.getStats()
            } : null,
            database: {
                fragmentation: this.db.pragma('freelist_count'),
                pageSize: this.db.pragma('page_size'),
                cacheSize: this.db.pragma('cache_size')
            }
        };
    }
    async healthCheck() {
        const analytics = this.getAnalytics();
        const health = {
            status: 'healthy',
            issues: [],
            recommendations: []
        };
        if (analytics.cache.hitRate < 50) {
            health.issues.push('Low cache hit rate');
            health.recommendations.push('Consider increasing cache size');
        }
        if (analytics.basic.utilizationPercent > 90) {
            health.status = 'warning';
            health.issues.push('High memory utilization');
            health.recommendations.push('Consider increasing max memory or running garbage collection');
        }
        if (analytics.performance.avgQueryTime > 100) {
            health.issues.push('Slow query performance');
            health.recommendations.push('Consider database optimization or indexing');
        }
        return health;
    }
}
export class MemoryOptimizer {
    static async optimizeCollectiveMemory(memory) {
        const startTime = performance.now();
        await memory._optimizeDatabase();
        memory._optimizeCache();
        memory._garbageCollect();
        const duration = performance.now() - startTime;
        return {
            duration,
            analytics: memory.getAnalytics(),
            health: await memory.healthCheck()
        };
    }
    static calculateOptimalCacheSize(memoryStats, accessPatterns) {
        const avgEntrySize = memoryStats.totalSize / memoryStats.entryCount;
        const hotKeys = Array.from(accessPatterns.entries()).sort((a, b)=>b[1] - a[1]).slice(0, Math.min(1000, memoryStats.entryCount * 0.2));
        const optimalCacheEntries = hotKeys.length * 1.2;
        const optimalCacheMemoryMB = optimalCacheEntries * avgEntrySize / (1024 * 1024);
        return {
            entries: Math.ceil(optimalCacheEntries),
            memoryMB: Math.ceil(optimalCacheMemoryMB),
            efficiency: hotKeys.length / memoryStats.entryCount * 100
        };
    }
    static generateOptimizationReport(analytics) {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {},
            recommendations: [],
            metrics: analytics
        };
        report.summary.avgQueryTime = analytics.performance.avgQueryTime;
        report.summary.cacheHitRate = analytics.cache.hitRate || 0;
        report.summary.memoryEfficiency = analytics.cache.memoryUsage / (1024 * 1024);
        if ((analytics.cache.hitRate || 0) < 70) {
            report.recommendations.push({
                type: 'cache',
                priority: 'high',
                description: 'Increase cache size to improve hit rate',
                impact: 'Reduce database queries by up to 30%'
            });
        }
        if (analytics.performance.avgQueryTime > 50) {
            report.recommendations.push({
                type: 'database',
                priority: 'medium',
                description: 'Optimize database indexes and run ANALYZE',
                impact: 'Improve query performance by 20-40%'
            });
        }
        if (analytics.pools?.queryResults?.reuseRate < 50) {
            report.recommendations.push({
                type: 'pooling',
                priority: 'low',
                description: 'Increase object pool sizes for better reuse',
                impact: 'Reduce garbage collection pressure'
            });
        }
        return report;
    }
}

//# sourceMappingURL=memory.js.map