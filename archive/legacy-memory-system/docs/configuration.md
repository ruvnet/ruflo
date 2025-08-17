# Configuration Reference

This document provides a complete reference for configuring the SPARC Memory Bank system.

## Main Configuration

### MemoryConfig Interface

```typescript
interface MemoryConfig {
  // Required: Backend configuration
  backend: 'sqlite' | 'markdown' | MemoryBackend;
  storage: StorageConfig;
  
  // Optional: Feature configurations
  cache?: CacheConfig;
  indexing?: IndexingConfig;
  namespaces?: NamespaceConfig;
  replication?: ReplicationConfig;
  security?: SecurityConfig;
  monitoring?: MonitoringConfig;
  
  // Optional: System settings
  system?: SystemConfig;
}
```

## Backend Configuration

### SQLite Backend

```typescript
interface SQLiteStorageConfig {
  path: string;                         // Database file path
  options?: {
    // SQLite PRAGMA settings
    journalMode?: 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'WAL' | 'OFF';
    synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
    cacheSize?: number;                 // Number of pages (default: 2000)
    tempStore?: 'DEFAULT' | 'FILE' | 'MEMORY';
    mmapSize?: number;                  // Memory-mapped I/O size in bytes
    pageSize?: number;                  // Database page size (512-65536)
    autoVacuum?: 'NONE' | 'FULL' | 'INCREMENTAL';
    foreignKeys?: boolean;              // Enable foreign key constraints
    secureDelete?: boolean;             // Secure deletion of data
    
    // Connection management
    maxConnections?: number;            // Max concurrent connections (default: 10)
    idleTimeout?: number;               // Idle connection timeout in ms
    busyTimeout?: number;               // Busy timeout in ms (default: 30000)
    retryAttempts?: number;             // Connection retry attempts
    
    // Performance tuning
    enableWalCheckpoint?: boolean;      // Automatic WAL checkpointing
    walCheckpointInterval?: number;     // Checkpoint interval in ms
    walCheckpointPages?: number;        // Pages before checkpoint
    pragmaOptimize?: boolean;           // Run PRAGMA optimize
    optimizeInterval?: number;          // Optimize interval in ms
    
    // Full-text search
    ftsTokenizer?: 'simple' | 'porter' | 'unicode61' | 'ascii';
    ftsRankFunction?: 'bm25' | 'okapi';
    ftsRemoveDiacritics?: boolean;
    
    // Extensions
    loadExtensions?: string[];          // SQLite extension paths
    enableVectorSearch?: boolean;       // Load vector search extension
    
    // Backup and recovery
    backupInterval?: number;            // Automatic backup interval
    backupRetention?: number;           // Number of backups to keep
    pointInTimeRecovery?: boolean;      // Enable WAL-based recovery
    
    // Debugging
    logQueries?: boolean;               // Log SQL queries
    queryTimeout?: number;              // Query timeout in ms
    explainQueryPlan?: boolean;         // Log query plans
  };
}

// Example SQLite configuration
const sqliteConfig: MemoryConfig = {
  backend: 'sqlite',
  storage: {
    path: './data/memory.db',
    options: {
      journalMode: 'WAL',
      synchronous: 'NORMAL',
      cacheSize: 10000,
      mmapSize: 268435456, // 256MB
      maxConnections: 20,
      enableWalCheckpoint: true,
      walCheckpointInterval: 300000, // 5 minutes
      pragmaOptimize: true,
      ftsTokenizer: 'unicode61',
      loadExtensions: ['./extensions/vector.so'],
      enableVectorSearch: true
    }
  }
};
```

### Markdown Backend

```typescript
interface MarkdownStorageConfig {
  path: string;                         // Root directory path
  options?: {
    // Directory structure
    useNamespaceDirectories?: boolean;  // Create namespace subdirectories
    useCategoryDirectories?: boolean;   // Create category subdirectories
    useTimeBasedDirectories?: boolean;  // Create YYYY/MM subdirectories
    maxDirectoryDepth?: number;         // Maximum directory nesting
    
    // File naming
    fileNaming?: 'id' | 'timestamp' | 'slug' | 'custom';
    customNamingFunction?: (item: MemoryItem) => string;
    slugify?: boolean;                  // Create URL-friendly filenames
    maxFilenameLength?: number;         // Maximum filename length
    fileExtension?: string;             // File extension (default: '.md')
    
    // Content formatting
    frontmatterFormat?: 'yaml' | 'toml' | 'json';
    contentFormat?: 'markdown' | 'text' | 'html';
    includeTableOfContents?: boolean;   // Generate TOC
    includeMetadata?: boolean;          // Include metadata in content
    wordWrap?: number;                  // Word wrap column
    
    // Markdown options
    markdownOptions?: {
      gfm?: boolean;                    // GitHub Flavored Markdown
      breaks?: boolean;                 // Convert line breaks to <br>
      linkify?: boolean;                // Auto-link URLs
      typographer?: boolean;            // Smart quotes and dashes
      highlight?: (code: string, lang: string) => string; // Code highlighting
    };
    
    // Git integration
    gitEnabled?: boolean;               // Enable git operations
    gitAutoCommit?: boolean;            // Auto-commit changes
    gitCommitMessage?: string;          // Commit message template
    gitBranch?: string;                 // Target branch
    gitRemote?: string;                 // Remote repository
    gitAuthor?: {
      name: string;
      email: string;
    };
    gitIgnorePatterns?: string[];       // Additional .gitignore patterns
    
    // Performance
    cacheDirectory?: string;            // Cache directory for parsed files
    cacheParsedFiles?: boolean;         // Cache parsed frontmatter
    watchForChanges?: boolean;          // Watch for external file changes
    rebuildIndexInterval?: number;      // Index rebuild interval
    
    // Maintenance
    enableGarbageCollection?: boolean;  // Remove orphaned files
    garbageCollectionInterval?: number; // GC interval in ms
    validateChecksums?: boolean;        // Validate file integrity
    
    // Import/Export
    exportFormats?: string[];           // Supported export formats
    importFormats?: string[];           // Supported import formats
    
    // Templates
    itemTemplate?: string;              // Template for new items
    categoryTemplates?: Record<string, string>; // Category-specific templates
  };
}

// Example Markdown configuration
const markdownConfig: MemoryConfig = {
  backend: 'markdown',
  storage: {
    path: './memory-docs',
    options: {
      useNamespaceDirectories: true,
      useCategoryDirectories: true,
      useTimeBasedDirectories: true,
      fileNaming: 'slug',
      slugify: true,
      maxFilenameLength: 100,
      frontmatterFormat: 'yaml',
      contentFormat: 'markdown',
      gitEnabled: true,
      gitAutoCommit: true,
      gitCommitMessage: 'Memory update: {category}/{id}',
      gitBranch: 'main',
      cacheDirectory: './.cache',
      watchForChanges: true,
      enableGarbageCollection: true
    }
  }
};
```

## Cache Configuration

```typescript
interface CacheConfig {
  enabled: boolean;                     // Enable caching
  maxSize: number;                      // Maximum cache size in bytes
  strategy: 'lru' | 'lfu' | 'fifo' | 'ttl' | 'adaptive';
  
  // TTL settings
  ttl?: number;                         // Default TTL in milliseconds
  maxTtl?: number;                      // Maximum TTL
  checkInterval?: number;               // TTL check interval
  
  // Strategy-specific settings
  lru?: {
    maxAge?: number;                    // Maximum age for LRU items
  };
  lfu?: {
    windowSize?: number;                // Frequency calculation window
    decayFactor?: number;               // Frequency decay factor
  };
  adaptive?: {
    learningRate?: number;              // Adaptation learning rate
    performanceThreshold?: number;      // Performance threshold for strategy switching
  };
  
  // Performance settings
  preallocation?: number;               // Pre-allocate cache slots
  compressionEnabled?: boolean;         // Compress cached items
  compressionThreshold?: number;        // Compression size threshold
  
  // Monitoring
  enableMetrics?: boolean;              // Enable cache metrics
  metricsInterval?: number;             // Metrics collection interval
  logEvictions?: boolean;               // Log cache evictions
}

// Example cache configurations
const performanceCache: CacheConfig = {
  enabled: true,
  maxSize: 500 * 1024 * 1024, // 500MB
  strategy: 'adaptive',
  ttl: 3600000, // 1 hour
  adaptive: {
    learningRate: 0.1,
    performanceThreshold: 100 // ms
  },
  compressionEnabled: true,
  compressionThreshold: 1024, // 1KB
  enableMetrics: true
};

const memoryConstrainedCache: CacheConfig = {
  enabled: true,
  maxSize: 50 * 1024 * 1024, // 50MB
  strategy: 'lfu',
  lfu: {
    windowSize: 1000,
    decayFactor: 0.95
  },
  compressionEnabled: true,
  enableMetrics: false
};
```

## Indexing Configuration

```typescript
interface IndexingConfig {
  enabled: boolean;                     // Enable advanced indexing
  
  // Search capabilities
  vectorSearch?: VectorSearchConfig;
  fullTextSearch?: FullTextSearchConfig;
  
  // Index management
  rebuildInterval?: number;             // Automatic rebuild interval
  incrementalUpdates?: boolean;         // Use incremental index updates
  backgroundRebuild?: boolean;          // Rebuild indexes in background
  
  // Performance
  indexDirectory?: string;              // Directory for index files
  memoryLimit?: number;                 // Memory limit for indexing
  compressionEnabled?: boolean;         // Compress index files
  
  // Custom indexes
  customIndexes?: CustomIndexConfig[];
}

interface VectorSearchConfig {
  enabled: boolean;
  dimensions: number;                   // Embedding dimensions
  algorithm: 'hnsw' | 'ivf' | 'brute-force';
  
  // HNSW parameters
  hnsw?: {
    m: number;                          // Number of connections
    efConstruction: number;             // Construction parameter
    efSearch: number;                   // Search parameter
    maxM: number;                       // Maximum connections
    maxM0: number;                      // Maximum connections for layer 0
  };
  
  // IVF parameters
  ivf?: {
    nlist: number;                      // Number of clusters
    nprobe: number;                     // Number of clusters to search
  };
  
  // Embedding service
  embeddingService?: EmbeddingServiceConfig;
  
  // Similarity settings
  defaultThreshold: number;             // Default similarity threshold
  similarityMetric: 'cosine' | 'euclidean' | 'dot-product';
  
  // Performance
  batchSize: number;                    // Embedding batch size
  concurrency: number;                  // Concurrent embedding requests
  cacheEmbeddings: boolean;             // Cache generated embeddings
}

interface FullTextSearchConfig {
  enabled: boolean;
  language: string;                     // Language for stemming
  
  // Tokenization
  tokenizer: 'standard' | 'keyword' | 'pattern' | 'custom';
  stopWords: string[];                  // Stop words to ignore
  stemming: boolean;                    // Enable stemming
  
  // Indexing
  fields: string[];                     // Fields to index
  boost: Record<string, number>;        // Field boost factors
  
  // Search options
  fuzzySearch: boolean;                 // Enable fuzzy matching
  fuzzyDistance: number;                // Maximum edit distance
  phraseSlop: number;                   // Phrase search sloppiness
  
  // Performance
  maxClauseCount: number;               // Maximum query clauses
  analyzeWildcard: boolean;             // Analyze wildcard queries
}

interface EmbeddingServiceConfig {
  provider: 'openai' | 'huggingface' | 'local' | 'custom';
  
  // OpenAI configuration
  openai?: {
    apiKey: string;
    model: string;                      // e.g., 'text-embedding-ada-002'
    maxTokens: number;
    requestsPerMinute: number;
  };
  
  // Hugging Face configuration
  huggingface?: {
    apiKey?: string;
    model: string;
    endpoint?: string;
  };
  
  // Local service configuration
  local?: {
    endpoint: string;
    timeout: number;
    retries: number;
  };
  
  // Custom service
  custom?: {
    generateEmbedding: (text: string) => Promise<number[]>;
  };
}

// Example indexing configuration
const advancedIndexing: IndexingConfig = {
  enabled: true,
  vectorSearch: {
    enabled: true,
    dimensions: 1536,
    algorithm: 'hnsw',
    hnsw: {
      m: 16,
      efConstruction: 200,
      efSearch: 100,
      maxM: 16,
      maxM0: 32
    },
    embeddingService: {
      provider: 'openai',
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
        model: 'text-embedding-ada-002',
        maxTokens: 8000,
        requestsPerMinute: 1000
      }
    },
    defaultThreshold: 0.7,
    similarityMetric: 'cosine',
    batchSize: 100,
    concurrency: 5,
    cacheEmbeddings: true
  },
  fullTextSearch: {
    enabled: true,
    language: 'english',
    tokenizer: 'standard',
    stopWords: ['the', 'a', 'an', 'and', 'or', 'but'],
    stemming: true,
    fields: ['content', 'tags'],
    boost: {
      content: 1.0,
      tags: 2.0
    },
    fuzzySearch: true,
    fuzzyDistance: 2
  },
  rebuildInterval: 3600000, // 1 hour
  incrementalUpdates: true,
  backgroundRebuild: true
};
```

## Namespace Configuration

```typescript
interface NamespaceConfig {
  enabled: boolean;                     // Enable namespace isolation
  defaultNamespace: string;             // Default namespace name
  
  // Access control
  permissions?: NamespacePermissions;
  enforcePermissions?: boolean;         // Enforce permission checks
  
  // Quotas and limits
  quotas?: NamespaceQuotas;
  enforceQuotas?: boolean;              // Enforce quota limits
  
  // Isolation settings
  strictIsolation?: boolean;            // Prevent cross-namespace access
  allowGlobalSearch?: boolean;          // Allow search across namespaces
  inheritPermissions?: boolean;         // Inherit parent namespace permissions
}

interface NamespacePermissions {
  [namespace: string]: {
    read: string[];                     // Agent IDs with read access
    write: string[];                    // Agent IDs with write access
    admin: string[];                    // Agent IDs with admin access
    public?: boolean;                   // Allow public read access
    inherit?: string;                   // Inherit from parent namespace
  };
}

interface NamespaceQuotas {
  [namespace: string]: {
    maxItems?: number;                  // Maximum number of items
    maxStorage?: number;                // Maximum storage in bytes
    maxEmbeddings?: number;             // Maximum vector embeddings
    dailyWrites?: number;               // Daily write limit
    dailyReads?: number;                // Daily read limit
  };
}

// Example namespace configuration
const namespaceConfig: NamespaceConfig = {
  enabled: true,
  defaultNamespace: 'default',
  permissions: {
    'public': {
      read: ['*'],
      write: ['admin'],
      admin: ['admin'],
      public: true
    },
    'project-alpha': {
      read: ['alice', 'bob', 'charlie'],
      write: ['alice', 'bob'],
      admin: ['alice']
    },
    'sensitive': {
      read: ['admin', 'security-team'],
      write: ['admin'],
      admin: ['admin']
    }
  },
  quotas: {
    'project-alpha': {
      maxItems: 10000,
      maxStorage: 100 * 1024 * 1024, // 100MB
      dailyWrites: 1000
    },
    'development': {
      maxItems: 1000,
      maxStorage: 10 * 1024 * 1024,  // 10MB
      dailyWrites: 100
    }
  },
  enforcePermissions: true,
  enforceQuotas: true,
  strictIsolation: false,
  allowGlobalSearch: true
};
```

## Security Configuration

```typescript
interface SecurityConfig {
  // Encryption at rest
  encryption?: {
    enabled: boolean;
    algorithm: 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305';
    keyDerivation: 'pbkdf2' | 'scrypt' | 'argon2';
    keyDerivationOptions?: {
      iterations?: number;              // PBKDF2 iterations
      memory?: number;                  // Scrypt/Argon2 memory cost
      parallelism?: number;             // Argon2 parallelism
      saltLength?: number;              // Salt length in bytes
    };
    rotateKeys?: boolean;               // Enable key rotation
    keyRotationInterval?: number;       // Key rotation interval
  };
  
  // Data integrity
  checksums?: {
    enabled: boolean;
    algorithm: 'sha256' | 'sha512' | 'blake3';
    verifyOnRead: boolean;              // Verify checksums on read
    repairCorruption: boolean;          // Attempt to repair corruption
  };
  
  // Access control
  authentication?: {
    enabled: boolean;
    method: 'token' | 'certificate' | 'custom';
    tokenConfig?: {
      algorithm: 'HS256' | 'RS256' | 'ES256';
      secretOrKey: string | Buffer;
      expiresIn: string;
    };
    certificateConfig?: {
      ca: string;                       // CA certificate path
      cert: string;                     // Client certificate path
      key: string;                      // Client key path
    };
  };
  
  // Audit logging
  auditLog?: {
    enabled: boolean;
    level: 'minimal' | 'standard' | 'verbose';
    destination: 'file' | 'database' | 'syslog' | 'custom';
    logFile?: string;
    rotateSize?: number;                // Log rotation size
    retentionDays?: number;             // Log retention period
    includeData?: boolean;              // Include operation data
  };
  
  // Rate limiting
  rateLimiting?: {
    enabled: boolean;
    globalLimit?: number;               // Global operations per second
    perAgentLimit?: number;             // Per-agent operations per second
    burstAllowance?: number;            // Burst allowance
    windowSize?: number;                // Rate limiting window
  };
}

// Example security configuration
const highSecurityConfig: SecurityConfig = {
  encryption: {
    enabled: true,
    algorithm: 'aes-256-gcm',
    keyDerivation: 'argon2',
    keyDerivationOptions: {
      memory: 65536,      // 64MB
      iterations: 3,
      parallelism: 1,
      saltLength: 32
    },
    rotateKeys: true,
    keyRotationInterval: 30 * 24 * 60 * 60 * 1000 // 30 days
  },
  checksums: {
    enabled: true,
    algorithm: 'blake3',
    verifyOnRead: true,
    repairCorruption: false
  },
  authentication: {
    enabled: true,
    method: 'certificate',
    certificateConfig: {
      ca: './certs/ca.pem',
      cert: './certs/client.pem',
      key: './certs/client.key'
    }
  },
  auditLog: {
    enabled: true,
    level: 'verbose',
    destination: 'file',
    logFile: './logs/audit.log',
    rotateSize: 100 * 1024 * 1024, // 100MB
    retentionDays: 90,
    includeData: false
  },
  rateLimiting: {
    enabled: true,
    globalLimit: 1000,
    perAgentLimit: 100,
    burstAllowance: 50,
    windowSize: 60000 // 1 minute
  }
};
```

## Environment Variables

Many configuration options can be set via environment variables:

```bash
# Backend configuration
MEMORY_BACKEND=sqlite
MEMORY_STORAGE_PATH=./data/memory.db

# Cache configuration
MEMORY_CACHE_ENABLED=true
MEMORY_CACHE_SIZE=100MB
MEMORY_CACHE_STRATEGY=lru

# Security configuration
MEMORY_ENCRYPTION_ENABLED=true
MEMORY_ENCRYPTION_KEY=your-encryption-key

# OpenAI configuration
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=text-embedding-ada-002

# Git configuration
GIT_AUTHOR_NAME="SPARC Memory Agent"
GIT_AUTHOR_EMAIL="memory@sparc.ai"

# Performance tuning
MEMORY_MAX_CONNECTIONS=20
MEMORY_QUERY_TIMEOUT=30000
MEMORY_CACHE_TTL=3600000
```

## Configuration Validation

The system includes comprehensive configuration validation:

```typescript
import { validateConfig } from '@sparc/memory-bank';

try {
  const config = {
    backend: 'sqlite',
    storage: {
      path: './memory.db',
      options: {
        maxConnections: -1  // Invalid value
      }
    }
  };
  
  const validatedConfig = validateConfig(config);
} catch (error) {
  console.error('Configuration validation failed:', error.message);
  // Error: maxConnections must be a positive integer
}
```

## Configuration Profiles

Pre-defined configuration profiles for common use cases:

```typescript
import { 
  createDevelopmentConfig,
  createProductionConfig,
  createHighPerformanceConfig,
  createHighSecurityConfig 
} from '@sparc/memory-bank/profiles';

// Development profile
const devConfig = createDevelopmentConfig({
  storagePath: './dev-memory.db'
});

// Production profile
const prodConfig = createProductionConfig({
  storagePath: '/var/lib/memory/prod.db',
  encryptionKey: process.env.ENCRYPTION_KEY
});

// High-performance profile
const perfConfig = createHighPerformanceConfig({
  storagePath: './perf-memory.db',
  cacheSize: '1GB',
  maxConnections: 50
});

// High-security profile
const secureConfig = createHighSecurityConfig({
  storagePath: './secure-memory.db',
  encryptionKey: process.env.ENCRYPTION_KEY,
  auditLogPath: './audit.log'
});
```