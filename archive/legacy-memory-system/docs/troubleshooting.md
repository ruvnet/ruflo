# Troubleshooting Guide

This guide helps diagnose and resolve common issues with the SPARC Memory Bank system.

## Quick Diagnostics

### Health Check Script

```typescript
// System health check utility
class HealthChecker {
  constructor(private memory: MemoryManager) {}
  
  async runHealthCheck(): Promise<HealthReport> {
    console.log('Running SPARC Memory Bank health check...\n');
    
    const report: HealthReport = {
      timestamp: new Date(),
      overall: 'healthy',
      checks: []
    };
    
    const checks = [
      this.checkConnection,
      this.checkStorage,
      this.checkCache,
      this.checkIndexes,
      this.checkPermissions,
      this.checkPerformance,
      this.checkSecurity
    ];
    
    for (const check of checks) {
      try {
        const result = await check.call(this);
        report.checks.push(result);
        
        if (result.status === 'error') {
          report.overall = 'unhealthy';
        } else if (result.status === 'warning' && report.overall === 'healthy') {
          report.overall = 'degraded';
        }
      } catch (error) {
        report.checks.push({
          name: check.name,
          status: 'error',
          message: `Health check failed: ${error.message}`,
          details: { error: error.stack }
        });
        report.overall = 'unhealthy';
      }
    }
    
    this.printHealthReport(report);
    return report;
  }
  
  private async checkConnection(): Promise<HealthCheckResult> {
    try {
      await this.memory.getStatistics();
      return {
        name: 'Connection',
        status: 'ok',
        message: 'Successfully connected to memory backend'
      };
    } catch (error) {
      return {
        name: 'Connection',
        status: 'error',
        message: 'Failed to connect to memory backend',
        details: { error: error.message }
      };
    }
  }
  
  private async checkStorage(): Promise<HealthCheckResult> {
    try {
      const stats = await this.memory.getStatistics();
      const storageUsage = stats.storageSize / (1024 * 1024 * 1024); // GB
      
      if (storageUsage > 100) { // > 100GB
        return {
          name: 'Storage',
          status: 'warning',
          message: `High storage usage: ${storageUsage.toFixed(2)} GB`,
          details: { storageSize: stats.storageSize }
        };
      }
      
      return {
        name: 'Storage',
        status: 'ok',
        message: `Storage usage: ${storageUsage.toFixed(2)} GB`,
        details: { storageSize: stats.storageSize }
      };
    } catch (error) {
      return {
        name: 'Storage',
        status: 'error',
        message: 'Failed to check storage status',
        details: { error: error.message }
      };
    }
  }
  
  private async checkCache(): Promise<HealthCheckResult> {
    try {
      const stats = await this.memory.getStatistics();
      const hitRate = stats.cacheStats.hitRate;
      
      if (hitRate < 0.5) {
        return {
          name: 'Cache',
          status: 'warning',
          message: `Low cache hit rate: ${(hitRate * 100).toFixed(1)}%`,
          details: stats.cacheStats
        };
      }
      
      return {
        name: 'Cache',
        status: 'ok',
        message: `Cache hit rate: ${(hitRate * 100).toFixed(1)}%`,
        details: stats.cacheStats
      };
    } catch (error) {
      return {
        name: 'Cache',
        status: 'error',
        message: 'Failed to check cache status',
        details: { error: error.message }
      };
    }
  }
  
  private async checkIndexes(): Promise<HealthCheckResult> {
    try {
      // Test basic query performance
      const startTime = performance.now();
      await this.memory.query({ limit: 1 });
      const queryTime = performance.now() - startTime;
      
      if (queryTime > 1000) { // > 1 second
        return {
          name: 'Indexes',
          status: 'warning',
          message: `Slow query performance: ${queryTime.toFixed(0)}ms`,
          details: { queryTime }
        };
      }
      
      return {
        name: 'Indexes',
        status: 'ok',
        message: `Query performance: ${queryTime.toFixed(0)}ms`,
        details: { queryTime }
      };
    } catch (error) {
      return {
        name: 'Indexes',
        status: 'error',
        message: 'Failed to test index performance',
        details: { error: error.message }
      };
    }
  }
  
  private async checkPermissions(): Promise<HealthCheckResult> {
    try {
      // Test basic operations
      const testItem = await this.memory.store({
        category: 'health-check',
        content: 'Test item for health check',
        tags: ['test', 'health-check']
      });
      
      const retrieved = await this.memory.retrieve(testItem.id);
      if (!retrieved) {
        throw new Error('Failed to retrieve test item');
      }
      
      await this.memory.delete(testItem.id);
      
      return {
        name: 'Permissions',
        status: 'ok',
        message: 'All basic operations working correctly'
      };
    } catch (error) {
      return {
        name: 'Permissions',
        status: 'error',
        message: 'Permission or operation error',
        details: { error: error.message }
      };
    }
  }
  
  private async checkPerformance(): Promise<HealthCheckResult> {
    try {
      const stats = await this.memory.getStatistics();
      const avgQueryTime = stats.performance.averageQueryTime;
      
      if (avgQueryTime > 100) { // > 100ms
        return {
          name: 'Performance',
          status: 'warning',
          message: `High average query time: ${avgQueryTime.toFixed(0)}ms`,
          details: stats.performance
        };
      }
      
      return {
        name: 'Performance',
        status: 'ok',
        message: `Average query time: ${avgQueryTime.toFixed(0)}ms`,
        details: stats.performance
      };
    } catch (error) {
      return {
        name: 'Performance',
        status: 'error',
        message: 'Failed to check performance metrics',
        details: { error: error.message }
      };
    }
  }
  
  private async checkSecurity(): Promise<HealthCheckResult> {
    try {
      // Check if encryption is enabled for production
      const isProduction = process.env.NODE_ENV === 'production';
      const config = await this.memory.getConfig();
      
      if (isProduction && !config.security?.encryption?.enabled) {
        return {
          name: 'Security',
          status: 'warning',
          message: 'Encryption not enabled in production environment',
          details: { encryption: false }
        };
      }
      
      return {
        name: 'Security',
        status: 'ok',
        message: 'Security configuration appears correct',
        details: { 
          encryption: config.security?.encryption?.enabled || false,
          authentication: config.security?.authentication?.enabled || false
        }
      };
    } catch (error) {
      return {
        name: 'Security',
        status: 'error',
        message: 'Failed to check security configuration',
        details: { error: error.message }
      };
    }
  }
  
  private printHealthReport(report: HealthReport): void {
    console.log(`=== HEALTH CHECK REPORT ===`);
    console.log(`Timestamp: ${report.timestamp.toISOString()}`);
    console.log(`Overall Status: ${report.overall.toUpperCase()}\n`);
    
    report.checks.forEach(check => {
      const statusIcon = this.getStatusIcon(check.status);
      console.log(`${statusIcon} ${check.name}: ${check.message}`);
      
      if (check.details && check.status !== 'ok') {
        console.log(`  Details: ${JSON.stringify(check.details, null, 2)}`);
      }
    });
    
    console.log('\n' + '='.repeat(30));
  }
  
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'ok': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      default: return '❓';
    }
  }
}

interface HealthReport {
  timestamp: Date;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult[];
}

interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: Record<string, any>;
}
```

## Common Issues and Solutions

### Installation and Setup Issues

#### Issue: Module Import Errors

```bash
Error: Cannot find module '@sparc/memory-bank'
```

**Solution:**
```bash
# For npm projects
npm install @sparc/memory-bank

# For Deno projects
# Ensure correct import URL
import { MemoryManager } from 'https://deno.land/x/sparc_memory@latest/mod.ts';

# Check deno.json imports configuration
{
  "imports": {
    "@sparc/memory": "https://deno.land/x/sparc_memory@latest/mod.ts"
  }
}
```

#### Issue: Database Initialization Fails

```bash
Error: SQLITE_CANTOPEN: unable to open database file
```

**Solution:**
```typescript
// Ensure directory exists
import { ensureDir } from 'https://deno.land/std@0.220.0/fs/mod.ts';
import { dirname } from 'https://deno.land/std@0.220.0/path/mod.ts';

const dbPath = './data/memory.db';
await ensureDir(dirname(dbPath));

// Check file permissions
const memory = new MemoryManager({
  backend: 'sqlite',
  storage: {
    path: dbPath,
    options: {
      // Ensure proper permissions
      busyTimeout: 30000,
      maxConnections: 1 // Start with single connection
    }
  }
});
```

#### Issue: Permission Denied on File System

```bash
Error: EACCES: permission denied, open '/var/lib/memory/memory.db'
```

**Solution:**
```bash
# Fix file permissions
sudo chown -R $USER:$USER /var/lib/memory
sudo chmod -R 755 /var/lib/memory

# Or use user directory
mkdir -p ~/.cache/memory
# Update config to use user directory
```

### Runtime Errors

#### Issue: Memory Out of Bounds

```bash
JavaScript heap out of memory
```

**Solution:**
```typescript
// Reduce cache size
const memory = new MemoryManager({
  backend: 'sqlite',
  storage: { path: './memory.db' },
  cache: {
    enabled: true,
    maxSize: 128 * 1024 * 1024, // Reduce to 128MB
    strategy: 'lru'
  }
});

// Use pagination for large queries
const largeCategoryItems = await memory.query({
  category: 'large-category',
  limit: 100, // Paginate results
  offset: 0
});

// Process in batches
for (let offset = 0; offset < 10000; offset += 100) {
  const batch = await memory.query({
    category: 'processing',
    limit: 100,
    offset
  });
  
  // Process batch
  await processBatch(batch);
}
```

#### Issue: Database Locked

```bash
Error: SQLITE_BUSY: database is locked
```

**Solution:**
```typescript
// Increase busy timeout
const memory = new MemoryManager({
  backend: 'sqlite',
  storage: {
    path: './memory.db',
    options: {
      busyTimeout: 60000,    // 60 seconds
      journalMode: 'WAL',    // Better concurrency
      maxConnections: 10,    // Connection pooling
      retryAttempts: 5       // Retry on busy
    }
  }
});

// Use WAL mode for better concurrency
// WAL mode allows multiple readers with one writer
```

#### Issue: Slow Query Performance

```bash
Query taking over 10 seconds to complete
```

**Solution:**
```typescript
// Add indexes for frequently queried fields
const optimizedConfig = {
  backend: 'sqlite',
  storage: {
    path: './memory.db',
    options: {
      pragmaOptimize: true,
      optimizeInterval: 3600000 // Optimize every hour
    }
  },
  indexing: {
    enabled: true,
    customIndexes: [
      'category',           // Index category field
      'namespace',          // Index namespace field
      'created',            // Index created timestamp
      'metadata.status'     // Index JSON fields
    ]
  }
};

// Use more specific queries
const specific = await memory.query({
  category: 'task',           // Use indexed field
  namespace: 'project-a',     // Use indexed field
  limit: 50,                  // Limit results
  sortBy: 'created',          // Use indexed sort field
  dateRange: {                // Use date range instead of full scan
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    field: 'created'
  }
});
```

### Cache Issues

#### Issue: Low Cache Hit Rate

```typescript
// Check cache statistics
const stats = await memory.getStatistics();
console.log(`Cache hit rate: ${(stats.cacheStats.hitRate * 100).toFixed(1)}%`);

if (stats.cacheStats.hitRate < 0.7) {
  // Solutions:
  
  // 1. Increase cache size
  await memory.updateConfig({
    cache: {
      maxSize: 512 * 1024 * 1024 // Increase to 512MB
    }
  });
  
  // 2. Change cache strategy
  await memory.updateConfig({
    cache: {
      strategy: 'adaptive' // Adapts to access patterns
    }
  });
  
  // 3. Implement cache warming
  const hotCategories = ['task', 'implementation', 'research'];
  for (const category of hotCategories) {
    await memory.query({ category, limit: 100 });
  }
}
```

#### Issue: Cache Memory Leaks

```typescript
// Monitor cache memory usage
const monitorCache = setInterval(async () => {
  const stats = await memory.getStatistics();
  const memoryUsage = process.memoryUsage();
  
  console.log({
    cacheSize: stats.cacheStats.memoryUsage,
    heapUsed: memoryUsage.heapUsed,
    heapTotal: memoryUsage.heapTotal
  });
  
  // Detect memory growth
  if (memoryUsage.heapUsed > 1024 * 1024 * 1024) { // > 1GB
    console.warn('High memory usage detected');
    
    // Force cache cleanup
    await memory.clearCache();
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
}, 30000); // Check every 30 seconds

// Clear monitoring when done
// clearInterval(monitorCache);
```

### Vector Search Issues

#### Issue: Embedding Service Timeouts

```bash
Error: Request timeout calling embedding service
```

**Solution:**
```typescript
// Configure robust embedding service
const robustConfig = {
  indexing: {
    enabled: true,
    vectorSearch: {
      enabled: true,
      embeddingService: {
        provider: 'openai',
        openai: {
          apiKey: process.env.OPENAI_API_KEY,
          timeout: 30000,          // 30 second timeout
          retries: 3,              // Retry failed requests
          retryDelay: 1000,        // 1 second between retries
          requestsPerMinute: 500,  // Rate limiting
          batchSize: 50            // Process in smaller batches
        }
      },
      // Fallback to local embeddings if API fails
      fallbackService: {
        provider: 'local',
        local: {
          endpoint: 'http://localhost:8080/embeddings',
          timeout: 10000
        }
      }
    }
  }
};

// Implement retry logic for embedding generation
async function generateEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await memory.generateEmbedding(text);
    } catch (error) {
      lastError = error as Error;
      console.warn(`Embedding attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}
```

#### Issue: Vector Search Returns No Results

```typescript
// Debug vector search issues
async function debugVectorSearch(query: string): Promise<void> {
  console.log(`Debugging vector search for: "${query}"`);
  
  // Check if embeddings exist
  const stats = await memory.getStatistics();
  console.log(`Total items with embeddings: ${stats.embeddingStats.totalEmbeddings}`);
  
  if (stats.embeddingStats.totalEmbeddings === 0) {
    console.log('No embeddings found. Generating embeddings for existing items...');
    
    // Generate embeddings for existing items
    const items = await memory.query({ limit: 100 });
    for (const item of items) {
      if (!item.embedding) {
        try {
          await memory.generateEmbedding(item.content);
          await memory.update(item.id, { embedding: item.embedding });
        } catch (error) {
          console.warn(`Failed to generate embedding for item ${item.id}:`, error);
        }
      }
    }
  }
  
  // Test with different thresholds
  const thresholds = [0.9, 0.8, 0.7, 0.6, 0.5];
  
  for (const threshold of thresholds) {
    const results = await memory.vectorSearch({
      text: query,
      threshold,
      limit: 5
    });
    
    console.log(`Threshold ${threshold}: ${results.length} results`);
    if (results.length > 0) {
      console.log(`Best match: ${results[0].similarity.toFixed(3)} - ${results[0].item.content.substring(0, 100)}...`);
    }
  }
}

// Check embedding dimensions
async function validateEmbeddings(): Promise<void> {
  const sampleItem = await memory.query({ limit: 1 });
  
  if (sampleItem.length > 0 && sampleItem[0].embedding) {
    const dimensions = sampleItem[0].embedding.length;
    console.log(`Embedding dimensions: ${dimensions}`);
    
    // Ensure all embeddings have consistent dimensions
    const inconsistentItems = await memory.query({
      // Custom query to find items with different embedding sizes
      customWhere: `LENGTH(embedding) != ${dimensions * 8}` // 8 bytes per float64
    });
    
    if (inconsistentItems.length > 0) {
      console.warn(`Found ${inconsistentItems.length} items with inconsistent embedding dimensions`);
    }
  }
}
```

### Replication and Sync Issues

#### Issue: Conflict Resolution Failures

```typescript
// Handle CRDT conflicts manually
class ConflictResolver {
  async resolveConflict(
    localItem: MemoryItem, 
    remoteItem: MemoryItem
  ): Promise<MemoryItem> {
    console.log(`Resolving conflict for item ${localItem.id}`);
    
    // Compare vector clocks
    const localClock = localItem.vectorClock;
    const remoteClock = remoteItem.vectorClock;
    
    // Determine which item is more recent
    const localIsNewer = this.isVectorClockNewer(localClock, remoteClock);
    const remoteIsNewer = this.isVectorClockNewer(remoteClock, localClock);
    
    if (localIsNewer && !remoteIsNewer) {
      return localItem; // Local wins
    } else if (remoteIsNewer && !localIsNewer) {
      return remoteItem; // Remote wins
    } else {
      // Concurrent update - merge
      return this.mergeItems(localItem, remoteItem);
    }
  }
  
  private isVectorClockNewer(clock1: VectorClock, clock2: VectorClock): boolean {
    let hasGreater = false;
    
    // Check all agents in both clocks
    const allAgents = new Set([...Object.keys(clock1), ...Object.keys(clock2)]);
    
    for (const agent of allAgents) {
      const time1 = clock1[agent] || 0;
      const time2 = clock2[agent] || 0;
      
      if (time1 < time2) {
        return false; // clock1 is not newer
      } else if (time1 > time2) {
        hasGreater = true;
      }
    }
    
    return hasGreater;
  }
  
  private mergeItems(item1: MemoryItem, item2: MemoryItem): MemoryItem {
    // Use Last Writer Wins for content (based on updated timestamp)
    const newerItem = item1.updated > item2.updated ? item1 : item2;
    const olderItem = item1.updated > item2.updated ? item2 : item1;
    
    // Merge tags (union)
    const mergedTags = Array.from(new Set([...item1.tags, ...item2.tags]));
    
    // Merge metadata (newer item's metadata takes precedence)
    const mergedMetadata = {
      ...olderItem.metadata,
      ...newerItem.metadata
    };
    
    // Merge vector clocks
    const mergedClock: VectorClock = {};
    const allAgents = new Set([
      ...Object.keys(item1.vectorClock),
      ...Object.keys(item2.vectorClock)
    ]);
    
    for (const agent of allAgents) {
      mergedClock[agent] = Math.max(
        item1.vectorClock[agent] || 0,
        item2.vectorClock[agent] || 0
      );
    }
    
    return {
      ...newerItem,
      tags: mergedTags,
      metadata: mergedMetadata,
      vectorClock: mergedClock,
      version: Math.max(item1.version, item2.version) + 1
    };
  }
}
```

### Network and Connectivity Issues

#### Issue: Connection Timeouts

```typescript
// Implement connection resilience
class ResilientMemoryManager extends MemoryManager {
  private maxRetries = 3;
  private baseDelay = 1000; // 1 second
  
  async store(data: Partial<MemoryItem>): Promise<MemoryItem> {
    return this.withRetry(() => super.store(data));
  }
  
  async query(query: MemoryQuery): Promise<MemoryItem[]> {
    return this.withRetry(() => super.query(query));
  }
  
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (this.isRetryableError(error)) {
          const delay = this.baseDelay * Math.pow(2, attempt - 1);
          console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error; // Don't retry non-retryable errors
        }
      }
    }
    
    throw lastError!;
  }
  
  private isRetryableError(error: any): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'SQLITE_BUSY',
      'SQLITE_LOCKED'
    ];
    
    return retryableErrors.some(code => 
      error.code === code || error.message.includes(code)
    );
  }
}
```

## Diagnostic Tools

### Log Analysis

```typescript
// Log analyzer for debugging
class LogAnalyzer {
  async analyzeMemoryLogs(logPath: string): Promise<LogAnalysis> {
    const logContent = await Deno.readTextFile(logPath);
    const lines = logContent.split('\n').filter(line => line.trim());
    
    const analysis: LogAnalysis = {
      totalLines: lines.length,
      errors: [],
      warnings: [],
      performance: {
        slowQueries: [],
        highMemoryUsage: [],
        cacheIssues: []
      },
      patterns: new Map()
    };
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        this.analyzeLine(entry, analysis);
      } catch {
        // Skip non-JSON lines
      }
    }
    
    return analysis;
  }
  
  private analyzeLine(entry: any, analysis: LogAnalysis): void {
    // Track error patterns
    if (entry.level === 'error') {
      analysis.errors.push({
        timestamp: entry.timestamp,
        message: entry.message,
        details: entry.details
      });
    }
    
    // Track warning patterns
    if (entry.level === 'warn') {
      analysis.warnings.push({
        timestamp: entry.timestamp,
        message: entry.message,
        details: entry.details
      });
    }
    
    // Analyze performance issues
    if (entry.operation && entry.duration) {
      if (entry.duration > 1000) { // > 1 second
        analysis.performance.slowQueries.push({
          operation: entry.operation,
          duration: entry.duration,
          timestamp: entry.timestamp
        });
      }
    }
    
    // Track patterns
    const pattern = this.extractPattern(entry);
    if (pattern) {
      const count = analysis.patterns.get(pattern) || 0;
      analysis.patterns.set(pattern, count + 1);
    }
  }
  
  private extractPattern(entry: any): string | null {
    if (entry.error) {
      return `ERROR: ${entry.error.type || 'Unknown'}`;
    }
    if (entry.operation) {
      return `OPERATION: ${entry.operation}`;
    }
    return null;
  }
}

interface LogAnalysis {
  totalLines: number;
  errors: LogEntry[];
  warnings: LogEntry[];
  performance: {
    slowQueries: PerformanceIssue[];
    highMemoryUsage: PerformanceIssue[];
    cacheIssues: PerformanceIssue[];
  };
  patterns: Map<string, number>;
}

interface LogEntry {
  timestamp: string;
  message: string;
  details?: any;
}

interface PerformanceIssue {
  operation: string;
  duration?: number;
  timestamp: string;
}
```

### Performance Profiler

```typescript
// Performance profiling utility
class PerformanceProfiler {
  private profiles: Map<string, ProfileData> = new Map();
  
  async profileOperation<T>(
    name: string, 
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = await operation();
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      
      this.recordProfile(name, {
        duration: endTime - startTime,
        memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
        success: true
      });
      
      return result;
    } catch (error) {
      const endTime = performance.now();
      
      this.recordProfile(name, {
        duration: endTime - startTime,
        memoryDelta: 0,
        success: false,
        error: error.message
      });
      
      throw error;
    }
  }
  
  private recordProfile(name: string, data: ProfileMeasurement): void {
    let profile = this.profiles.get(name);
    
    if (!profile) {
      profile = {
        name,
        count: 0,
        totalDuration: 0,
        totalMemoryDelta: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errors: 0
      };
      this.profiles.set(name, profile);
    }
    
    profile.count++;
    profile.totalDuration += data.duration;
    profile.totalMemoryDelta += data.memoryDelta;
    profile.minDuration = Math.min(profile.minDuration, data.duration);
    profile.maxDuration = Math.max(profile.maxDuration, data.duration);
    
    if (!data.success) {
      profile.errors++;
    }
  }
  
  getProfileReport(): ProfileReport {
    const profiles = Array.from(this.profiles.values()).map(profile => ({
      ...profile,
      avgDuration: profile.totalDuration / profile.count,
      avgMemoryDelta: profile.totalMemoryDelta / profile.count,
      errorRate: profile.errors / profile.count
    }));
    
    return {
      profiles: profiles.sort((a, b) => b.avgDuration - a.avgDuration),
      summary: {
        totalOperations: profiles.reduce((sum, p) => sum + p.count, 0),
        totalErrors: profiles.reduce((sum, p) => sum + p.errors, 0),
        avgDuration: profiles.reduce((sum, p) => sum + p.avgDuration, 0) / profiles.length
      }
    };
  }
  
  printProfileReport(): void {
    const report = this.getProfileReport();
    
    console.log('\n=== PERFORMANCE PROFILE REPORT ===\n');
    console.log(`Total operations: ${report.summary.totalOperations}`);
    console.log(`Total errors: ${report.summary.totalErrors}`);
    console.log(`Average duration: ${report.summary.avgDuration.toFixed(2)}ms\n`);
    
    console.log('Top operations by average duration:');
    report.profiles.slice(0, 10).forEach((profile, index) => {
      console.log(`${index + 1}. ${profile.name}`);
      console.log(`   Avg: ${profile.avgDuration.toFixed(2)}ms, Count: ${profile.count}, Errors: ${profile.errorRate.toFixed(2)}%`);
    });
  }
}

interface ProfileMeasurement {
  duration: number;
  memoryDelta: number;
  success: boolean;
  error?: string;
}

interface ProfileData {
  name: string;
  count: number;
  totalDuration: number;
  totalMemoryDelta: number;
  minDuration: number;
  maxDuration: number;
  errors: number;
}

interface ProfileReport {
  profiles: (ProfileData & {
    avgDuration: number;
    avgMemoryDelta: number;
    errorRate: number;
  })[];
  summary: {
    totalOperations: number;
    totalErrors: number;
    avgDuration: number;
  };
}
```

## Getting Help

### Debug Mode

```typescript
// Enable comprehensive debugging
const debugConfig = {
  backend: 'sqlite',
  storage: {
    path: './debug.db',
    options: {
      logQueries: true,
      explainQueryPlan: true,
      queryTimeout: 30000
    }
  },
  system: {
    logging: {
      level: 'debug',
      enableQueryProfiling: true,
      enableSlowQueryLog: true,
      slowQueryThreshold: 10, // Log queries > 10ms
      enableMemoryProfiling: true,
      enableTracing: true
    }
  }
};

const debugMemory = new MemoryManager(debugConfig);

// Enable verbose error reporting
debugMemory.on('error', (error) => {
  console.error('Memory Manager Error:', {
    message: error.message,
    stack: error.stack,
    code: error.code,
    details: error.details
  });
});

debugMemory.on('warning', (warning) => {
  console.warn('Memory Manager Warning:', warning);
});
```

### Support Information

When reporting issues, please include:

1. **Environment Information:**
   ```bash
   deno --version
   # or
   node --version
   npm --version
   ```

2. **Configuration:**
   ```typescript
   const config = await memory.getConfig();
   console.log(JSON.stringify(config, null, 2));
   ```

3. **System Statistics:**
   ```typescript
   const stats = await memory.getStatistics();
   console.log(JSON.stringify(stats, null, 2));
   ```

4. **Health Check Results:**
   ```typescript
   const healthChecker = new HealthChecker(memory);
   const report = await healthChecker.runHealthCheck();
   ```

5. **Recent Log Entries:**
   ```typescript
   // Include recent error logs and stack traces
   ```

### Community Resources

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: Complete API documentation
- **Examples**: Working code examples
- **Discord/Slack**: Community chat for quick help
- **Stack Overflow**: Tag your questions with `sparc-memory-bank`

This troubleshooting guide should help you diagnose and resolve most common issues with the SPARC Memory Bank system. For issues not covered here, please refer to the community resources or file a detailed bug report.