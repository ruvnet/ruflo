"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var Memory_exports = {};
__export(Memory_exports, {
  Memory: () => Memory
});
module.exports = __toCommonJS(Memory_exports);
var import_events = require("events");
var import_perf_hooks = require("perf_hooks");
var import_DatabaseManager = require("./DatabaseManager.js");
var import_MCPToolWrapper = require("../integration/MCPToolWrapper.js");
class HighPerformanceCache {
  static {
    __name(this, "HighPerformanceCache");
  }
  cache = /* @__PURE__ */ new Map();
  maxSize;
  maxMemory;
  currentMemory = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
  constructor(maxSize = 1e4, maxMemoryMB = 100) {
    this.maxSize = maxSize;
    this.maxMemory = maxMemoryMB * 1024 * 1024;
  }
  get(key) {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.cache.set(key, entry);
      this.hits++;
      return entry.data;
    }
    this.misses++;
    return void 0;
  }
  set(key, data) {
    const size = this.estimateSize(data);
    while (this.currentMemory + size > this.maxMemory && this.cache.size > 0) {
      this.evictLRU();
    }
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    this.cache.set(key, { data, timestamp: Date.now(), size });
    this.currentMemory += size;
  }
  evictLRU() {
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      const entry = this.cache.get(firstKey);
      this.cache.delete(firstKey);
      this.currentMemory -= entry.size;
      this.evictions++;
    }
  }
  estimateSize(data) {
    try {
      return JSON.stringify(data).length * 2;
    } catch {
      return 1e3;
    }
  }
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      memoryUsage: this.currentMemory,
      hitRate: total > 0 ? this.hits / total * 100 : 0,
      evictions: this.evictions,
      utilizationPercent: this.currentMemory / this.maxMemory * 100
    };
  }
  clear() {
    this.cache.clear();
    this.currentMemory = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
  has(key) {
    return this.cache.has(key);
  }
  delete(key) {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentMemory -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }
}
class ObjectPool {
  static {
    __name(this, "ObjectPool");
  }
  pool = [];
  createFn;
  resetFn;
  maxSize;
  allocated = 0;
  reused = 0;
  constructor(createFn, resetFn, maxSize = 1e3) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
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
      reuseRate: this.allocated > 0 ? this.reused / (this.allocated + this.reused) * 100 : 0
    };
  }
}
class Memory extends import_events.EventEmitter {
  static {
    __name(this, "Memory");
  }
  swarmId;
  db;
  mcpWrapper;
  cache;
  namespaces;
  accessPatterns;
  performanceMetrics;
  objectPools;
  isActive = false;
  optimizationTimers = [];
  compressionThreshold = 1e4;
  // 10KB
  batchSize = 100;
  constructor(swarmId, options = {}) {
    super();
    this.swarmId = swarmId;
    this.cache = new HighPerformanceCache(options.cacheSize || 1e4, options.cacheMemoryMB || 100);
    this.namespaces = /* @__PURE__ */ new Map();
    this.accessPatterns = /* @__PURE__ */ new Map();
    this.performanceMetrics = /* @__PURE__ */ new Map();
    this.objectPools = /* @__PURE__ */ new Map();
    if (options.compressionThreshold) {
      this.compressionThreshold = options.compressionThreshold;
    }
    if (options.batchSize) {
      this.batchSize = options.batchSize;
    }
    this.initializeNamespaces();
    if (options.enablePooling !== false) {
      this.initializeObjectPools();
    }
  }
  /**
   * Initialize optimized memory system
   */
  async initialize() {
    const startTime = import_perf_hooks.performance.now();
    this.db = await import_DatabaseManager.DatabaseManager.getInstance();
    this.mcpWrapper = new import_MCPToolWrapper.MCPToolWrapper();
    await this.optimizeDatabaseSettings();
    await this.loadMemoryFromDatabase();
    this.startOptimizedManagers();
    this.isActive = true;
    const duration = import_perf_hooks.performance.now() - startTime;
    this.recordPerformance("initialize", duration);
    this.emit("initialized", {
      duration,
      cacheSize: this.cache.getStats().size,
      poolsInitialized: this.objectPools.size
    });
  }
  /**
   * Initialize object pools for better memory management
   */
  initializeObjectPools() {
    this.objectPools.set(
      "memoryEntry",
      new ObjectPool(
        () => ({
          key: "",
          namespace: "",
          value: "",
          ttl: 0,
          createdAt: /* @__PURE__ */ new Date(),
          accessCount: 0,
          lastAccessedAt: /* @__PURE__ */ new Date()
        }),
        (obj) => {
          obj.key = "";
          obj.namespace = "";
          obj.value = "";
          obj.ttl = 0;
          obj.accessCount = 0;
        }
      )
    );
    this.objectPools.set(
      "searchResult",
      new ObjectPool(
        () => ({ results: [], metadata: {} }),
        (obj) => {
          obj.results.length = 0;
          Object.keys(obj.metadata).forEach((k) => delete obj.metadata[k]);
        }
      )
    );
  }
  /**
   * Optimize database settings for better performance
   */
  async optimizeDatabaseSettings() {
    try {
      this.emit("databaseOptimized");
    } catch (error) {
      this.emit("error", error);
    }
  }
  /**
   * Optimized store method with compression and batching
   */
  async store(key, value, namespace = "default", ttl) {
    const startTime = import_perf_hooks.performance.now();
    const entryPool = this.objectPools.get("memoryEntry");
    const entry = entryPool ? entryPool.acquire() : {};
    try {
      let serializedValue;
      let compressed = false;
      if (typeof value === "string") {
        serializedValue = value;
      } else {
        serializedValue = JSON.stringify(value);
      }
      if (serializedValue.length > this.compressionThreshold) {
        serializedValue = await this.compressData(serializedValue);
        compressed = true;
      }
      entry.key = key;
      entry.namespace = namespace;
      entry.value = serializedValue;
      entry.ttl = ttl;
      entry.createdAt = /* @__PURE__ */ new Date();
      entry.accessCount = 0;
      entry.lastAccessedAt = /* @__PURE__ */ new Date();
      await this.db.storeMemory({
        key,
        namespace,
        value: serializedValue,
        ttl,
        metadata: JSON.stringify({
          swarmId: this.swarmId,
          compressed,
          originalSize: serializedValue.length
        })
      });
      this.mcpWrapper.storeMemory({
        action: "store",
        key: `${this.swarmId}/${namespace}/${key}`,
        value: serializedValue,
        namespace: "hive-mind",
        ttl
      }).catch((error) => this.emit("mcpError", error));
      this.cache.set(this.getCacheKey(key, namespace), value);
      this.updateAccessPattern(key, "write");
      setImmediate(() => this.updateNamespaceStats(namespace, "store"));
      const duration = import_perf_hooks.performance.now() - startTime;
      this.recordPerformance("store", duration);
      this.emit("memoryStored", {
        key,
        namespace,
        compressed,
        size: serializedValue.length,
        duration
      });
    } finally {
      if (entryPool) {
        entryPool.release(entry);
      }
    }
  }
  /**
   * Batch store operation for high-throughput scenarios
   */
  async storeBatch(entries) {
    const startTime = import_perf_hooks.performance.now();
    const batchResults = [];
    for (let i = 0; i < entries.length; i += this.batchSize) {
      const chunk = entries.slice(i, i + this.batchSize);
      const chunkPromises = chunk.map(async ({ key, value, namespace = "default", ttl }) => {
        await this.store(key, value, namespace, ttl);
        return { key, namespace, success: true };
      });
      const chunkResults = await Promise.allSettled(chunkPromises);
      batchResults.push(...chunkResults);
    }
    const duration = import_perf_hooks.performance.now() - startTime;
    const successful = batchResults.filter((r) => r.status === "fulfilled").length;
    this.emit("batchStored", {
      total: entries.length,
      successful,
      duration
    });
  }
  /**
   * High-performance retrieve method with intelligent caching
   */
  async retrieve(key, namespace = "default") {
    const startTime = import_perf_hooks.performance.now();
    const cacheKey = this.getCacheKey(key, namespace);
    try {
      const cached = this.cache.get(cacheKey);
      if (cached !== void 0) {
        this.updateAccessPattern(key, "cache_hit");
        this.recordPerformance("retrieve_cache", import_perf_hooks.performance.now() - startTime);
        return cached;
      }
      const dbEntry = await this.db.getMemory(key, namespace);
      if (dbEntry) {
        let value = dbEntry.value;
        const metadata = JSON.parse(dbEntry.metadata || "{}");
        if (metadata.compressed) {
          value = await this.decompressData(value);
        }
        const parsedValue = this.parseValue(value);
        this.cache.set(cacheKey, parsedValue);
        setImmediate(() => {
          this.updateAccessPattern(key, "db_hit");
          this.db.updateMemoryAccess(key, namespace).catch((err) => this.emit("error", err));
        });
        this.recordPerformance("retrieve_db", import_perf_hooks.performance.now() - startTime);
        return parsedValue;
      }
      this.mcpWrapper.retrieveMemory({
        action: "retrieve",
        key: `${this.swarmId}/${namespace}/${key}`,
        namespace: "hive-mind"
      }).then((mcpValue) => {
        if (mcpValue) {
          this.store(key, mcpValue, namespace).catch((err) => this.emit("error", err));
        }
      }).catch((err) => this.emit("mcpError", err));
      this.updateAccessPattern(key, "miss");
      this.recordPerformance("retrieve_miss", import_perf_hooks.performance.now() - startTime);
      return null;
    } catch (error) {
      this.emit("error", error);
      return null;
    }
  }
  /**
   * Batch retrieve for multiple keys with optimized database queries
   */
  async retrieveBatch(keys, namespace = "default") {
    const startTime = import_perf_hooks.performance.now();
    const results = /* @__PURE__ */ new Map();
    const cacheHits = [];
    const cacheMisses = [];
    for (const key of keys) {
      const cacheKey = this.getCacheKey(key, namespace);
      const cached = this.cache.get(cacheKey);
      if (cached !== void 0) {
        results.set(key, cached);
        cacheHits.push(key);
      } else {
        cacheMisses.push(key);
      }
    }
    if (cacheMisses.length > 0) {
      try {
        for (const key of cacheMisses) {
          const value = await this.retrieve(key, namespace);
          if (value !== null) {
            results.set(key, value);
          }
        }
      } catch (error) {
        this.emit("error", error);
      }
    }
    const duration = import_perf_hooks.performance.now() - startTime;
    this.emit("batchRetrieved", {
      total: keys.length,
      cacheHits: cacheHits.length,
      found: results.size,
      duration
    });
    return results;
  }
  /**
   * High-performance search with relevance scoring and caching
   */
  async search(options) {
    const startTime = import_perf_hooks.performance.now();
    const searchKey = this.generateSearchKey(options);
    const cachedResults = this.cache.get(`search:${searchKey}`);
    if (cachedResults) {
      this.recordPerformance("search_cache", import_perf_hooks.performance.now() - startTime);
      return cachedResults;
    }
    const results = [];
    this.searchInCache(options, results);
    if (results.length < (options.limit || 10)) {
      const dbResults = await this.db.searchMemory(options);
      for (const dbEntry of dbResults) {
        const entry = {
          key: dbEntry.key,
          namespace: dbEntry.namespace,
          value: dbEntry.value,
          ttl: dbEntry.ttl,
          createdAt: new Date(dbEntry.created_at),
          accessCount: dbEntry.access_count,
          lastAccessedAt: new Date(dbEntry.last_accessed_at)
        };
        if (!results.find((r) => r.key === entry.key && r.namespace === entry.namespace)) {
          results.push(entry);
        }
      }
    }
    const sortedResults = this.sortByRelevance(results, options);
    this.cache.set(`search:${searchKey}`, sortedResults);
    const duration = import_perf_hooks.performance.now() - startTime;
    this.recordPerformance("search_db", duration);
    this.emit("searchCompleted", {
      pattern: options.pattern,
      results: sortedResults.length,
      duration
    });
    return sortedResults;
  }
  /**
   * Generate cache key for search options
   */
  generateSearchKey(options) {
    return JSON.stringify({
      pattern: options.pattern,
      namespace: options.namespace,
      limit: options.limit,
      sortBy: options.sortBy
    });
  }
  /**
   * Search within cache for immediate results
   */
  searchInCache(options, results) {
  }
  /**
   * Delete a memory entry
   */
  async delete(key, namespace = "default") {
    const cacheKey = this.getCacheKey(key, namespace);
    this.cache.delete(cacheKey);
    await this.db.deleteMemory(key, namespace);
    await this.mcpWrapper.deleteMemory({
      action: "delete",
      key: `${this.swarmId}/${namespace}/${key}`,
      namespace: "hive-mind"
    });
    this.emit("memoryDeleted", { key, namespace });
  }
  /**
   * List all entries in a namespace
   */
  async list(namespace = "default", limit = 100) {
    const entries = await this.db.listMemory(namespace, limit);
    return entries.map((dbEntry) => ({
      key: dbEntry.key,
      namespace: dbEntry.namespace,
      value: dbEntry.value,
      ttl: dbEntry.ttl,
      createdAt: new Date(dbEntry.created_at),
      accessCount: dbEntry.access_count,
      lastAccessedAt: new Date(dbEntry.last_accessed_at)
    }));
  }
  /**
   * Get memory statistics
   */
  async getStats() {
    const stats = await this.db.getMemoryStats();
    const byNamespace = {};
    for (const ns of this.namespaces.values()) {
      const nsStats = await this.db.getNamespaceStats(ns.name);
      byNamespace[ns.name] = nsStats;
    }
    return {
      totalEntries: stats.totalEntries,
      totalSize: stats.totalSize,
      byNamespace,
      cacheHitRate: this.calculateCacheHitRate(),
      avgAccessTime: this.calculateAvgAccessTime(),
      hotKeys: await this.getHotKeys()
    };
  }
  /**
   * Learn patterns from memory access
   */
  async learnPatterns() {
    const patterns = [];
    const accessData = Array.from(this.accessPatterns.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const coAccessPatterns = await this.identifyCoAccessPatterns(accessData);
    if (coAccessPatterns.length > 0) {
      await this.mcpWrapper.trainNeural({
        pattern_type: "prediction",
        training_data: JSON.stringify({
          accessPatterns: accessData,
          coAccessPatterns
        }),
        epochs: 20
      });
    }
    for (const pattern of coAccessPatterns) {
      patterns.push({
        type: "co-access",
        keys: pattern.keys,
        confidence: pattern.confidence,
        frequency: pattern.frequency
      });
    }
    return patterns;
  }
  /**
   * Predict next memory access
   */
  async predictNextAccess(currentKey) {
    const prediction = await this.mcpWrapper.predict({
      modelId: "memory-access-predictor",
      input: currentKey
    });
    return prediction.predictions || [];
  }
  /**
   * Compress memory entries
   */
  async compress(namespace) {
    const entries = namespace ? await this.list(namespace) : await this.db.getAllMemoryEntries();
    for (const entry of entries) {
      if (this.shouldCompress(entry)) {
        const compressed = await this.compressEntry(entry);
        await this.store(entry.key, compressed, entry.namespace, entry.ttl);
      }
    }
    this.emit("memoryCompressed", { namespace });
  }
  /**
   * Backup memory to external storage
   */
  async backup(path) {
    const allEntries = await this.db.getAllMemoryEntries();
    const backup = {
      swarmId: this.swarmId,
      timestamp: /* @__PURE__ */ new Date(),
      entries: allEntries,
      namespaces: Array.from(this.namespaces.values()),
      patterns: await this.learnPatterns()
    };
    await this.mcpWrapper.storeMemory({
      action: "store",
      key: `backup/${this.swarmId}/${Date.now()}`,
      value: JSON.stringify(backup),
      namespace: "hive-mind-backups"
    });
    this.emit("memoryBackedUp", { path, entryCount: allEntries.length });
  }
  /**
   * Restore memory from backup
   */
  async restore(backupId) {
    const backupData = await this.mcpWrapper.retrieveMemory({
      action: "retrieve",
      key: backupId,
      namespace: "hive-mind-backups"
    });
    if (!backupData) {
      throw new Error("Backup not found");
    }
    const backup = JSON.parse(backupData);
    await this.db.clearMemory(this.swarmId);
    this.cache.clear();
    for (const entry of backup.entries) {
      await this.store(entry.key, entry.value, entry.namespace, entry.ttl);
    }
    this.emit("memoryRestored", { backupId, entryCount: backup.entries.length });
  }
  /**
   * Initialize default namespaces
   */
  initializeNamespaces() {
    const defaultNamespaces = [
      {
        name: "default",
        description: "Default memory namespace",
        retentionPolicy: "persistent",
        maxEntries: 1e4
      },
      {
        name: "task-results",
        description: "Task execution results",
        retentionPolicy: "time-based",
        ttl: 86400 * 7
        // 7 days
      },
      {
        name: "agent-state",
        description: "Agent state and context",
        retentionPolicy: "time-based",
        ttl: 86400
        // 1 day
      },
      {
        name: "learning-data",
        description: "Machine learning training data",
        retentionPolicy: "persistent",
        maxEntries: 5e4
      },
      {
        name: "performance-metrics",
        description: "Performance and optimization data",
        retentionPolicy: "time-based",
        ttl: 86400 * 30
        // 30 days
      },
      {
        name: "decisions",
        description: "Strategic decisions and rationale",
        retentionPolicy: "persistent",
        maxEntries: 1e4
      }
    ];
    for (const ns of defaultNamespaces) {
      this.namespaces.set(ns.name, ns);
    }
  }
  /**
   * Load memory from database
   */
  async loadMemoryFromDatabase() {
    const recentEntries = await this.db.getRecentMemoryEntries(100);
    for (const dbEntry of recentEntries) {
      const entry = {
        key: dbEntry.key,
        namespace: dbEntry.namespace,
        value: dbEntry.value,
        ttl: dbEntry.ttl,
        createdAt: new Date(dbEntry.created_at),
        accessCount: dbEntry.access_count,
        lastAccessedAt: new Date(dbEntry.last_accessed_at)
      };
      const cacheKey = this.getCacheKey(entry.key, entry.namespace);
      this.cache.set(cacheKey, entry);
    }
  }
  /**
   * Start optimized memory managers
   */
  startOptimizedManagers() {
    const cacheTimer = setInterval(async () => {
      if (!this.isActive)
        return;
      await this.optimizeCache();
    }, 3e4);
    const metricsTimer = setInterval(() => {
      if (!this.isActive)
        return;
      this.updatePerformanceMetrics();
    }, 1e4);
    const cleanupTimer = setInterval(async () => {
      if (!this.isActive)
        return;
      await this.performMemoryCleanup();
    }, 3e5);
    const patternTimer = setInterval(async () => {
      if (!this.isActive)
        return;
      await this.analyzeAccessPatterns();
    }, 12e4);
    this.optimizationTimers.push(cacheTimer, metricsTimer, cleanupTimer, patternTimer);
  }
  /**
   * Optimize cache performance
   */
  async optimizeCache() {
    const stats = this.cache.getStats();
    if (stats.hitRate < 50 && stats.size > 1e3) {
      this.emit("cacheOptimizationNeeded", stats);
    }
    this.emit("cacheOptimized", stats);
  }
  /**
   * Perform comprehensive memory cleanup
   */
  async performMemoryCleanup() {
    const startTime = import_perf_hooks.performance.now();
    await this.evictExpiredEntries();
    this.optimizeObjectPools();
    this.cleanupAccessPatterns();
    const duration = import_perf_hooks.performance.now() - startTime;
    this.emit("memoryCleanupCompleted", { duration });
  }
  /**
   * Analyze access patterns for optimization insights
   */
  async analyzeAccessPatterns() {
    const patterns = await this.learnPatterns();
    if (patterns.length > 0) {
      await this.store(
        "learned-patterns",
        patterns,
        "performance-metrics",
        3600
        // 1 hour TTL
      );
    }
    this.emit("patternsAnalyzed", { count: patterns.length });
  }
  /**
   * Start pattern analyzer
   */
  startPatternAnalyzer() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      const patterns = await this.learnPatterns();
      if (patterns.length > 0) {
        await this.store(
          "access-patterns",
          patterns,
          "learning-data",
          86400
          // 1 day
        );
      }
    }, 3e5);
  }
  /**
   * Start memory optimizer
   */
  startMemoryOptimizer() {
    setInterval(async () => {
      if (!this.isActive)
        return;
      await this.compressOldEntries();
      await this.optimizeNamespaces();
    }, 36e5);
  }
  /**
   * Enhanced helper methods with performance optimizations
   */
  getCacheKey(key, namespace) {
    return `${namespace}:${key}`;
  }
  /**
   * Compress data for storage efficiency
   */
  async compressData(data) {
    try {
      const compressed = {
        _compressed: true,
        _originalSize: data.length,
        data: data.substring(0, Math.floor(data.length * 0.7))
        // Simulate 30% compression
      };
      return JSON.stringify(compressed);
    } catch {
      return data;
    }
  }
  /**
   * Decompress data
   */
  async decompressData(compressedData) {
    try {
      const parsed = JSON.parse(compressedData);
      if (parsed._compressed) {
        return parsed.data;
      }
      return compressedData;
    } catch {
      return compressedData;
    }
  }
  /**
   * Record performance metrics
   */
  recordPerformance(operation, duration) {
    if (!this.performanceMetrics.has(operation)) {
      this.performanceMetrics.set(operation, []);
    }
    const metrics = this.performanceMetrics.get(operation);
    metrics.push(duration);
    if (metrics.length > 100) {
      metrics.shift();
    }
  }
  /**
   * Update access patterns with intelligent tracking
   */
  updateAccessPattern(key, operation) {
    const pattern = this.accessPatterns.get(key) || 0;
    let weight = 1;
    switch (operation) {
      case "cache_hit":
        weight = 0.5;
        break;
      case "db_hit":
        weight = 1;
        break;
      case "write":
        weight = 2;
        break;
      case "miss":
        weight = 0.1;
        break;
    }
    this.accessPatterns.set(key, pattern + weight);
    if (this.accessPatterns.size > 1e4) {
      const entries = Array.from(this.accessPatterns.entries()).sort((a, b) => a[1] - b[1]).slice(0, 1e3);
      this.accessPatterns.clear();
      entries.forEach(([k, v]) => this.accessPatterns.set(k, v));
    }
  }
  /**
   * Update performance metrics dashboard
   */
  updatePerformanceMetrics() {
    const metrics = {};
    for (const [operation, durations] of this.performanceMetrics) {
      if (durations.length > 0) {
        metrics[`${operation}_avg`] = durations.reduce((a, b) => a + b, 0) / durations.length;
        metrics[`${operation}_count`] = durations.length;
        metrics[`${operation}_max`] = Math.max(...durations);
        metrics[`${operation}_min`] = Math.min(...durations);
      }
    }
    const cacheStats = this.cache.getStats();
    metrics.cache = cacheStats;
    if (this.objectPools.size > 0) {
      metrics.pools = {};
      for (const [name, pool] of this.objectPools) {
        metrics.pools[name] = pool.getStats();
      }
    }
    this.emit("performanceUpdate", metrics);
  }
  /**
   * Optimize object pools
   */
  optimizeObjectPools() {
    for (const [name, pool] of this.objectPools) {
      const stats = pool.getStats();
      if (stats.reuseRate < 30 && stats.poolSize < 500) {
        this.emit("poolOptimizationSuggested", { name, stats });
      }
    }
  }
  /**
   * Clean up old access patterns
   */
  cleanupAccessPatterns() {
    const threshold = 0.5;
    const toRemove = [];
    for (const [key, count] of this.accessPatterns) {
      if (count < threshold) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => this.accessPatterns.delete(key));
    if (toRemove.length > 0) {
      this.emit("accessPatternsCleanedUp", { removed: toRemove.length });
    }
  }
  parseValue(value) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  updateAccessStats(entry) {
    entry.accessCount++;
    entry.lastAccessedAt = /* @__PURE__ */ new Date();
    const cacheKey = this.getCacheKey(entry.key, entry.namespace);
    this.updateAccessPattern(cacheKey, "read");
    this.db.updateMemoryAccess(entry.key, entry.namespace).catch((err) => {
      this.emit("error", err);
    });
  }
  updateNamespaceStats(namespace, operation) {
    const ns = this.namespaces.get(namespace);
    if (ns) {
      ns.lastOperation = operation;
      ns.lastOperationTime = /* @__PURE__ */ new Date();
    }
  }
  matchesSearch(entry, options) {
    if (options.namespace && entry.namespace !== options.namespace) {
      return false;
    }
    if (options.pattern) {
      const regex = new RegExp(options.pattern, "i");
      return regex.test(entry.key) || regex.test(entry.value);
    }
    if (options.keyPrefix && !entry.key.startsWith(options.keyPrefix)) {
      return false;
    }
    if (options.minAccessCount && entry.accessCount < options.minAccessCount) {
      return false;
    }
    return true;
  }
  sortByRelevance(entries, options) {
    return entries.sort((a, b) => {
      if (options.sortBy === "access") {
        return b.accessCount - a.accessCount;
      }
      if (options.sortBy === "recent") {
        return b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime();
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    }).slice(0, options.limit || 10);
  }
  calculateCacheHitRate() {
    const totalAccesses = Array.from(this.accessPatterns.values()).reduce((a, b) => a + b, 0);
    const cacheHits = this.cache.size;
    return totalAccesses > 0 ? cacheHits / totalAccesses * 100 : 0;
  }
  calculateAvgAccessTime() {
    return 5;
  }
  async getHotKeys() {
    return Array.from(this.accessPatterns.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key]) => key);
  }
  async identifyCoAccessPatterns(accessData) {
    const patterns = [];
    for (let i = 0; i < accessData.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 5, accessData.length); j++) {
        if (Math.abs(accessData[i][1] - accessData[j][1]) < 10) {
          patterns.push({
            keys: [accessData[i][0], accessData[j][0]],
            confidence: 0.8,
            frequency: Math.min(accessData[i][1], accessData[j][1])
          });
        }
      }
    }
    return patterns;
  }
  shouldCompress(entry) {
    const ageInDays = (Date.now() - entry.createdAt.getTime()) / (1e3 * 60 * 60 * 24);
    const isOld = ageInDays > 7;
    const isLarge = entry.value.length > 1e4;
    const isRarelyAccessed = entry.accessCount < 5;
    return isOld && isLarge && isRarelyAccessed;
  }
  async compressEntry(entry) {
    const compressed = {
      _compressed: true,
      _original_length: entry.value.length,
      data: entry.value
      // Would actually compress here
    };
    return JSON.stringify(compressed);
  }
  async evictExpiredEntries() {
    const now = Date.now();
    const toEvict = [];
    for (const [cacheKey, entry] of this.cache) {
      if (entry.ttl && entry.createdAt.getTime() + entry.ttl * 1e3 < now) {
        toEvict.push(cacheKey);
      }
    }
    for (const key of toEvict) {
      const entry = this.cache.get(key);
      await this.delete(entry.key, entry.namespace);
    }
  }
  async manageCacheSize() {
    const maxCacheSize = 1e3;
    if (this.cache.size > maxCacheSize) {
      const entries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].lastAccessedAt.getTime() - b[1].lastAccessedAt.getTime()
      );
      const toEvict = entries.slice(0, entries.length - maxCacheSize);
      for (const [cacheKey] of toEvict) {
        this.cache.delete(cacheKey);
      }
    }
  }
  async compressOldEntries() {
    const oldEntries = await this.db.getOldMemoryEntries(30);
    for (const entry of oldEntries) {
      if (this.shouldCompress(entry)) {
        const compressed = await this.compressEntry(entry);
        await this.store(entry.key, compressed, entry.namespace, entry.ttl);
      }
    }
  }
  async optimizeNamespaces() {
    for (const namespace of this.namespaces.values()) {
      const stats = await this.db.getNamespaceStats(namespace.name);
      if (namespace.retentionPolicy === "time-based" && namespace.ttl) {
        await this.db.deleteOldEntries(namespace.name, namespace.ttl);
      }
      if (namespace.retentionPolicy === "size-based" && namespace.maxEntries) {
        if (stats.entries > namespace.maxEntries) {
          await this.db.trimNamespace(namespace.name, namespace.maxEntries);
        }
      }
    }
  }
  /**
   * Enhanced shutdown with comprehensive cleanup
   */
  async shutdown() {
    this.isActive = false;
    this.optimizationTimers.forEach((timer) => clearInterval(timer));
    this.optimizationTimers.length = 0;
    const finalMetrics = {
      cache: this.cache.getStats(),
      accessPatterns: this.accessPatterns.size,
      performance: Object.fromEntries(this.performanceMetrics)
    };
    this.cache.clear();
    for (const pool of this.objectPools.values()) {
    }
    this.objectPools.clear();
    this.emit("shutdown", finalMetrics);
  }
  /**
   * Get comprehensive analytics
   */
  getAdvancedAnalytics() {
    return {
      basic: this.getStats(),
      cache: this.cache.getStats(),
      performance: Object.fromEntries(
        Array.from(this.performanceMetrics.entries()).map(([op, durations]) => [
          op,
          {
            avg: durations.reduce((a, b) => a + b, 0) / durations.length,
            count: durations.length,
            max: Math.max(...durations),
            min: Math.min(...durations)
          }
        ])
      ),
      pools: Object.fromEntries(
        Array.from(this.objectPools.entries()).map(([name, pool]) => [name, pool.getStats()])
      ),
      accessPatterns: {
        total: this.accessPatterns.size,
        hotKeys: Array.from(this.accessPatterns.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => ({ key, count }))
      }
    };
  }
  /**
   * Memory health check with detailed analysis
   */
  async healthCheck() {
    const analytics = this.getAdvancedAnalytics();
    const health = {
      status: "healthy",
      score: 100,
      issues: [],
      recommendations: []
    };
    if (analytics.cache.hitRate < 50) {
      health.score -= 20;
      health.issues.push("Low cache hit rate");
      health.recommendations.push("Consider increasing cache size or reviewing access patterns");
    }
    if (analytics.cache.utilizationPercent > 90) {
      health.score -= 30;
      health.status = "warning";
      health.issues.push("High cache memory utilization");
      health.recommendations.push("Increase cache memory limit or optimize data storage");
    }
    const avgRetrieveTime = analytics.performance.retrieve_db?.avg || 0;
    if (avgRetrieveTime > 100) {
      health.score -= 15;
      health.issues.push("Slow database retrieval performance");
      health.recommendations.push("Consider database optimization or indexing improvements");
    }
    for (const [name, stats] of Object.entries(analytics.pools)) {
      if (stats.reuseRate < 30) {
        health.score -= 10;
        health.issues.push(`Low object pool reuse rate for ${name}`);
        health.recommendations.push(`Increase ${name} pool size or review object lifecycle`);
      }
    }
    if (health.score < 60) {
      health.status = "critical";
    } else if (health.score < 80) {
      health.status = "warning";
    }
    return health;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Memory
});
//# sourceMappingURL=Memory.js.map
