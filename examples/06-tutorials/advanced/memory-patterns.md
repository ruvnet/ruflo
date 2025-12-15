# Advanced Memory Patterns in Claude-Flow v2

This tutorial covers advanced memory management patterns for production Claude-Flow deployments.

## Table of Contents
1. [Hybrid Memory Backends](#hybrid-memory-backends)
2. [Memory Schemas and Validation](#memory-schemas-and-validation)
3. [Distributed Memory Patterns](#distributed-memory-patterns)
4. [Performance Optimization](#performance-optimization)
5. [Error Recovery](#error-recovery)
6. [Real-World Examples](#real-world-examples)

## Hybrid Memory Backends

Claude-Flow v2 supports hybrid memory configurations that combine multiple storage backends for optimal performance and reliability.

### Basic Hybrid Configuration

```json
{
  "memory": {
    "backend": "hybrid",
    "primary": {
      "type": "redis",
      "connection": "redis://localhost:6379"
    },
    "secondary": {
      "type": "json",
      "location": "./memory/backup.json"
    },
    "sync": {
      "enabled": true,
      "interval": 30000,
      "strategy": "write-through"
    }
  }
}
```

### Advanced Tiering Strategy

```javascript
// memory-config.js
module.exports = {
  memory: {
    backend: "hybrid",
    tiers: [
      {
        name: "hot",
        backend: "redis",
        ttl: 3600, // 1 hour
        maxSize: "100MB",
        patterns: ["session:*", "cache:*"]
      },
      {
        name: "warm", 
        backend: "mongodb",
        ttl: 86400, // 24 hours
        maxSize: "1GB",
        patterns: ["user:*", "project:*"]
      },
      {
        name: "cold",
        backend: "s3",
        ttl: null, // No expiration
        maxSize: "unlimited",
        patterns: ["archive:*", "backup:*"]
      }
    ],
    migration: {
      rules: [
        {
          from: "hot",
          to: "warm",
          condition: "accessCount < 5 AND age > 3600"
        },
        {
          from: "warm",
          to: "cold",
          condition: "lastAccess > 86400"
        }
      ]
    }
  }
};
```

### Implementing Custom Memory Backend

```javascript
// custom-memory-backend.js
class CustomMemoryBackend {
  constructor(options) {
    this.options = options;
    this.cache = new Map();
  }

  async get(key) {
    // Custom retrieval logic
    const value = this.cache.get(key);
    if (value && this.isExpired(value)) {
      this.cache.delete(key);
      return null;
    }
    return value?.data;
  }

  async set(key, value, ttl) {
    // Custom storage logic
    this.cache.set(key, {
      data: value,
      expires: ttl ? Date.now() + ttl * 1000 : null,
      metadata: {
        created: Date.now(),
        accessCount: 0
      }
    });
  }

  isExpired(entry) {
    return entry.expires && Date.now() > entry.expires;
  }
}

// Register the custom backend
claudeFlow.registerMemoryBackend('custom', CustomMemoryBackend);
```

## Memory Schemas and Validation

### Defining Memory Schemas

```json
{
  "memory": {
    "schemas": {
      "validation": true,
      "strict": true,
      "definitions": {
        "user": {
          "type": "object",
          "required": ["id", "email", "createdAt"],
          "properties": {
            "id": { "type": "string", "format": "uuid" },
            "email": { "type": "string", "format": "email" },
            "profile": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "avatar": { "type": "string", "format": "uri" }
              }
            },
            "createdAt": { "type": "string", "format": "date-time" }
          }
        },
        "task": {
          "type": "object",
          "required": ["id", "title", "status"],
          "properties": {
            "id": { "type": "string" },
            "title": { "type": "string", "minLength": 1, "maxLength": 200 },
            "status": { "enum": ["pending", "in_progress", "completed"] },
            "assignedTo": { "$ref": "#/definitions/user/properties/id" }
          }
        }
      }
    }
  }
}
```

### Runtime Validation

```javascript
// memory-validation.js
const memoryValidator = {
  beforeSave: async (key, value, schema) => {
    // Validate against schema
    const validation = await validateSchema(value, schema);
    if (!validation.valid) {
      throw new ValidationError(validation.errors);
    }
    
    // Transform data if needed
    return transformData(value, schema);
  },

  afterLoad: async (key, value, schema) => {
    // Migrate old data formats
    if (needsMigration(value, schema)) {
      return await migrateData(value, schema);
    }
    return value;
  }
};

// Use in workflow
const workflow = {
  memory: {
    validators: [memoryValidator],
    hooks: {
      beforeSave: ['validate', 'encrypt'],
      afterLoad: ['decrypt', 'transform']
    }
  }
};
```

## Distributed Memory Patterns

### Cross-Agent Memory Sharing

```javascript
// distributed-memory.js
class DistributedMemory {
  constructor(config) {
    this.namespace = config.namespace;
    this.broadcast = config.broadcast;
    this.consistency = config.consistency || 'eventual';
  }

  async set(key, value, options = {}) {
    const fullKey = `${this.namespace}:${key}`;
    
    // Store locally first
    await this.localStore.set(fullKey, value);
    
    // Broadcast to other agents
    if (options.broadcast !== false) {
      await this.broadcast.publish('memory:update', {
        key: fullKey,
        value,
        timestamp: Date.now(),
        source: this.agentId
      });
    }
    
    // Wait for consensus if required
    if (this.consistency === 'strong') {
      await this.waitForConsensus(fullKey, value);
    }
  }

  async waitForConsensus(key, value) {
    const confirmations = await this.collectConfirmations(key, value);
    if (confirmations.length < this.quorumSize) {
      throw new ConsensusError('Failed to achieve quorum');
    }
  }
}
```

### Memory Synchronization Patterns

```javascript
// Pattern 1: Leader-Follower
const leaderFollowerSync = {
  role: 'follower',
  leader: 'agent-1',
  syncInterval: 5000,
  conflictResolution: 'leader-wins',
  
  async sync() {
    if (this.role === 'leader') {
      await this.broadcastState();
    } else {
      await this.syncFromLeader();
    }
  }
};

// Pattern 2: Peer-to-Peer with CRDTs
const p2pCrdtSync = {
  type: 'crdt',
  dataStructures: {
    'counters': 'g-counter',
    'sets': 'or-set',
    'maps': 'lww-map'
  },
  
  merge(local, remote) {
    return this.crdt.merge(local, remote);
  }
};

// Pattern 3: Event Sourcing
const eventSourcingSync = {
  eventLog: [],
  snapshot: null,
  
  async applyEvent(event) {
    this.eventLog.push(event);
    this.state = this.reducer(this.state, event);
    
    // Broadcast event to peers
    await this.broadcast('memory:event', event);
  },
  
  async rebuild() {
    this.state = this.snapshot || {};
    for (const event of this.eventLog) {
      this.state = this.reducer(this.state, event);
    }
  }
};
```

## Performance Optimization

### Memory Access Patterns

```javascript
// Batch Operations
const batchMemory = {
  async getMultiple(keys) {
    // Use pipeline for Redis
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    return await pipeline.exec();
  },
  
  async setMultiple(entries) {
    const pipeline = this.redis.pipeline();
    entries.forEach(([key, value, ttl]) => {
      pipeline.setex(key, ttl || 3600, JSON.stringify(value));
    });
    return await pipeline.exec();
  }
};

// Lazy Loading with Proxies
const lazyMemory = new Proxy({}, {
  get: async (target, key) => {
    if (!target[key]) {
      target[key] = await loadFromMemory(key);
    }
    return target[key];
  }
});

// Memory Pooling
class MemoryPool {
  constructor(size = 100) {
    this.pool = new Array(size);
    this.available = new Set(Array.from({length: size}, (_, i) => i));
  }
  
  acquire() {
    if (this.available.size === 0) {
      throw new Error('Memory pool exhausted');
    }
    const index = this.available.values().next().value;
    this.available.delete(index);
    return this.pool[index];
  }
  
  release(index) {
    this.pool[index] = null; // Clear reference
    this.available.add(index);
  }
}
```

### Caching Strategies

```javascript
// Multi-level Cache
class MultiLevelCache {
  constructor() {
    this.l1 = new Map(); // In-process memory
    this.l2 = redis;     // Redis
    this.l3 = mongodb;   // MongoDB
  }
  
  async get(key) {
    // Check L1
    if (this.l1.has(key)) {
      return this.l1.get(key);
    }
    
    // Check L2
    const l2Value = await this.l2.get(key);
    if (l2Value) {
      this.l1.set(key, l2Value); // Promote to L1
      return l2Value;
    }
    
    // Check L3
    const l3Value = await this.l3.findOne({_id: key});
    if (l3Value) {
      // Promote to L2 and L1
      await this.l2.setex(key, 3600, l3Value);
      this.l1.set(key, l3Value);
      return l3Value;
    }
    
    return null;
  }
}

// Write-behind Cache
class WriteBehindCache {
  constructor(batchSize = 100, flushInterval = 5000) {
    this.writeBuffer = [];
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.startFlushing();
  }
  
  async set(key, value) {
    // Update cache immediately
    await this.cache.set(key, value);
    
    // Queue for persistent storage
    this.writeBuffer.push({key, value, timestamp: Date.now()});
    
    if (this.writeBuffer.length >= this.batchSize) {
      await this.flush();
    }
  }
  
  async flush() {
    if (this.writeBuffer.length === 0) return;
    
    const batch = this.writeBuffer.splice(0, this.batchSize);
    await this.persistentStore.bulkWrite(batch);
  }
}
```

## Error Recovery

### Resilient Memory Operations

```javascript
// Automatic Retry with Exponential Backoff
class ResilientMemory {
  async get(key, options = {}) {
    const maxRetries = options.maxRetries || 3;
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.primaryBackend.get(key);
      } catch (error) {
        lastError = error;
        
        // Try fallback on certain errors
        if (this.shouldUseFallback(error)) {
          return await this.fallbackBackend.get(key);
        }
        
        // Wait before retry
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
  
  shouldUseFallback(error) {
    return error.code === 'ECONNREFUSED' || 
           error.code === 'ETIMEDOUT' ||
           error.message.includes('Connection lost');
  }
}

// Circuit Breaker Pattern
class CircuitBreakerMemory {
  constructor(threshold = 5, timeout = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = 0;
  }
  
  async get(key) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await this.backend.get(key);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }
  
  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }
}
```

## Real-World Examples

### Example 1: E-commerce Session Management

```javascript
// ecommerce-memory-config.js
const ecommerceMemory = {
  memory: {
    backend: "hybrid",
    namespaces: {
      sessions: {
        backend: "redis",
        ttl: 1800, // 30 minutes
        refresh: true
      },
      carts: {
        backend: "redis",
        ttl: 86400, // 24 hours
        persist: true
      },
      products: {
        backend: "hybrid",
        primary: "redis",
        secondary: "mongodb",
        cache: {
          ttl: 300, // 5 minutes
          tags: true
        }
      },
      orders: {
        backend: "mongodb",
        indexes: ["userId", "status", "createdAt"]
      }
    }
  }
};

// Usage in workflow
async function addToCart(userId, productId, quantity) {
  const cartKey = `cart:${userId}`;
  const cart = await memory.get(cartKey) || { items: [] };
  
  cart.items.push({ productId, quantity, addedAt: Date.now() });
  
  await memory.set(cartKey, cart, {
    ttl: 86400,
    tags: [`user:${userId}`, 'cart']
  });
  
  // Sync to persistent storage
  await memory.persist(cartKey);
}
```

### Example 2: Real-time Analytics

```javascript
// analytics-memory-config.js
const analyticsMemory = {
  memory: {
    backend: "hybrid",
    streams: {
      events: {
        type: "redis-stream",
        maxLength: 100000,
        trimStrategy: "MAXLEN"
      },
      aggregations: {
        type: "time-series",
        retention: 86400,
        downsampling: [
          { interval: 60, aggregation: "avg" },
          { interval: 3600, aggregation: "sum" }
        ]
      }
    },
    processing: {
      windows: {
        realtime: { size: 60, slide: 10 },
        hourly: { size: 3600, slide: 3600 },
        daily: { size: 86400, slide: 86400 }
      }
    }
  }
};

// Stream processor
class AnalyticsProcessor {
  async processEvent(event) {
    // Add to stream
    await this.stream.add('events', event);
    
    // Update real-time counters
    await this.updateCounter(`metric:${event.type}:1m`, 1, 60);
    
    // Update aggregations
    await this.updateAggregation(event);
    
    // Check thresholds
    await this.checkAlerts(event);
  }
}
```

### Example 3: Machine Learning Pipeline

```javascript
// ml-memory-config.js
const mlMemory = {
  memory: {
    backend: "hybrid",
    datasets: {
      training: {
        backend: "s3",
        format: "parquet",
        partitioning: "date"
      },
      features: {
        backend: "redis",
        serialization: "msgpack",
        compression: true
      },
      models: {
        backend: "hybrid",
        primary: "redis",
        secondary: "s3",
        versioning: true
      }
    },
    compute: {
      cache: {
        predictions: { ttl: 3600 },
        embeddings: { ttl: 86400 },
        preprocessed: { ttl: 604800 }
      }
    }
  }
};

// Model serving
class ModelServer {
  async predict(input) {
    const cacheKey = `prediction:${hashInput(input)}`;
    
    // Check cache
    const cached = await this.memory.get(cacheKey);
    if (cached) return cached;
    
    // Load model
    const model = await this.loadModel();
    
    // Get features
    const features = await this.extractFeatures(input);
    
    // Make prediction
    const prediction = await model.predict(features);
    
    // Cache result
    await this.memory.set(cacheKey, prediction, { ttl: 3600 });
    
    return prediction;
  }
}
```

## Best Practices

1. **Always plan for failure**: Use fallback backends and implement retry logic
2. **Monitor memory usage**: Set up alerts for memory pressure
3. **Use appropriate TTLs**: Balance between performance and data freshness
4. **Implement proper serialization**: Use efficient formats like MessagePack or Protocol Buffers
5. **Test memory patterns**: Include memory backend failures in your test scenarios
6. **Document memory schemas**: Keep schemas versioned and documented
7. **Use namespacing**: Organize keys with clear namespaces
8. **Implement cleanup routines**: Regular garbage collection for expired data

## Troubleshooting

Common issues and solutions:

### High Memory Usage
- Enable compression
- Reduce TTLs
- Implement eviction policies
- Use streaming for large datasets

### Slow Performance
- Add caching layers
- Use batch operations
- Implement connection pooling
- Enable pipelining

### Data Inconsistency
- Implement proper locking
- Use transactions where available
- Choose appropriate consistency model
- Add data validation

### Connection Issues
- Implement circuit breakers
- Use connection pooling
- Add health checks
- Configure proper timeouts

## Summary

Advanced memory patterns in Claude-Flow v2 enable:
- High-performance distributed systems
- Reliable data persistence
- Flexible caching strategies
- Resilient error handling
- Scalable architectures

Choose patterns based on your specific requirements for consistency, performance, and reliability.