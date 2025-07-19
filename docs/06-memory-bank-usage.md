# Memory Bank Usage and Query Guide

Gemini-Flow's memory management system provides intelligent, persistent storage for agent knowledge, task history, and system state. This guide covers comprehensive memory operations, query patterns, and advanced usage scenarios.

## Memory Architecture Overview

The memory bank consists of several interconnected layers:

### Memory Layers
- **Agent Sessions**: Individual agent working memory
- **Shared Knowledge**: Cross-agent persistent knowledge base
- **Project Memory**: Project-specific data and artifacts
- **System Memory**: System state and configuration history

### Storage Backends
- **SQLite**: Structured data, queries, and indexes
- **Markdown**: Human-readable documentation and content
- **Hybrid**: Combined approach for optimal performance

## Basic Memory Operations

### Storing Information

**Simple Memory Storage:**
```bash
# Store a discovery
claude-flow memory store \
  --agent-id <agent-id> \
  --type "discovery" \
  --content "Found optimal caching strategy that improves API response time by 40%" \
  --tags "performance,caching,optimization,api"

# Store structured data
claude-flow memory store \
  --agent-id <agent-id> \
  --type "technical-solution" \
  --title "Redis Caching Implementation" \
  --content "technical-solution.json" \
  --metadata "performance-impact:+40%,complexity:medium"
```

**Structured Memory Entry:**
```json
{
  "type": "technical-discovery",
  "title": "Efficient Database Query Optimization",
  "content": "Implementing query result caching with Redis reduced database load by 65% and improved average response time from 450ms to 160ms.",
  "metadata": {
    "performance_improvement": "65%",
    "response_time_before": "450ms",
    "response_time_after": "160ms",
    "technology": "redis",
    "database": "postgresql",
    "implementation_effort": "medium"
  },
  "tags": ["performance", "database", "caching", "optimization"],
  "validation": {
    "tested": true,
    "benchmark_data": "query-performance-results.json",
    "peer_reviewed": false
  },
  "impact_score": 8.5,
  "confidence": 0.9
}
```

### Querying Memory

**Basic Queries:**
```bash
# Query by agent
claude-flow memory query \
  --agent-id <agent-id> \
  --type "discovery" \
  --limit 10 \
  --sort-by "timestamp:desc"

# Query by tags
claude-flow memory query \
  --tags "performance,optimization" \
  --time-range "last-7d" \
  --format "detailed"

# Search across all memory
claude-flow memory search "caching strategy" \
  --fuzzy true \
  --min-relevance 0.7 \
  --include-metadata
```

**Advanced Query Patterns:**
```bash
# Complex query with multiple filters
claude-flow memory query \
  --agent-type "implementer" \
  --created-after "2024-12-01" \
  --content-contains "database optimization" \
  --tags "performance" \
  --impact-score ">7.0" \
  --confidence ">0.8" \
  --format "summary"

# Aggregate queries
claude-flow memory aggregate \
  --metric "discoveries-per-day" \
  --time-range "30d" \
  --group-by "agent-type,tags" \
  --output-format "chart"

# Relationship queries
claude-flow memory related <memory-id> \
  --depth 3 \
  --relationship-types "builds-upon,contradicts,validates" \
  --min-confidence 0.6
```

## Knowledge Management

### Categorization and Organization

**Category Management:**
```bash
# Create knowledge categories
claude-flow memory category create "machine-learning" \
  --description "ML algorithms, models, and best practices" \
  --schema ml-schema.json \
  --validation-rules ml-validation.json

# List categories with statistics
claude-flow memory category list \
  --include-stats true \
  --sort-by "entry-count:desc"

# Update category schema
claude-flow memory category update "machine-learning" \
  --schema updated-ml-schema.json \
  --migrate-existing true
```

**Knowledge Schema Example:**
```json
{
  "category": "machine-learning",
  "schema": {
    "required_fields": ["algorithm", "problem_type", "performance_metrics"],
    "optional_fields": ["dataset_size", "training_time", "accuracy"],
    "validation": {
      "algorithm": {
        "type": "enum",
        "values": ["linear-regression", "random-forest", "neural-network", "svm"]
      },
      "problem_type": {
        "type": "enum", 
        "values": ["classification", "regression", "clustering", "reinforcement"]
      },
      "performance_metrics": {
        "type": "object",
        "properties": {
          "accuracy": {"type": "number", "min": 0, "max": 1},
          "precision": {"type": "number", "min": 0, "max": 1},
          "recall": {"type": "number", "min": 0, "max": 1}
        }
      }
    }
  }
}
```

### Knowledge Entry Types

**Technical Discovery Entries:**
```json
{
  "type": "technical-discovery",
  "title": "Microservices Communication Pattern",
  "summary": "Event-driven architecture with message queues provides better decoupling than direct HTTP calls",
  "content": {
    "problem": "Tight coupling between microservices causing cascading failures",
    "solution": "Implement event-driven architecture using RabbitMQ",
    "benefits": [
      "Reduced coupling between services",
      "Better fault tolerance",
      "Improved scalability",
      "Easier testing and debugging"
    ],
    "implementation": {
      "technology": "RabbitMQ",
      "pattern": "publish-subscribe",
      "message_format": "JSON",
      "retry_strategy": "exponential-backoff"
    },
    "metrics": {
      "coupling_reduction": "75%",
      "fault_tolerance_improvement": "90%",
      "latency_impact": "+5ms average"
    }
  },
  "validation": {
    "tested_in": "development",
    "peer_reviewed": true,
    "production_ready": false
  }
}
```

**Problem-Solution Entries:**
```json
{
  "type": "problem-solution",
  "problem": {
    "title": "Memory Leaks in Long-Running Node.js Process",
    "description": "Production Node.js service experiencing gradual memory increase leading to OOM crashes",
    "symptoms": [
      "Gradual memory increase over 6-8 hours",
      "OOM crashes during peak traffic",
      "Garbage collection pauses increasing over time"
    ],
    "impact": "High - service downtime affecting 10k+ users"
  },
  "root_cause": {
    "analysis": "Event listeners not being properly removed on WebSocket disconnections",
    "evidence": [
      "Memory profiling showed increasing listener count",
      "Heap dumps revealed retained WebSocket objects",
      "Correlation with connection churn patterns"
    ]
  },
  "solution": {
    "approach": "Implement proper cleanup in WebSocket disconnect handlers",
    "implementation": [
      "Add removeAllListeners() calls in disconnect handlers",
      "Implement connection tracking with WeakMap",
      "Add memory monitoring and alerting"
    ],
    "validation": [
      "Memory usage remained stable over 72h test",
      "No OOM crashes in staging environment",
      "GC pause times reduced by 60%"
    ]
  },
  "prevention": {
    "measures": [
      "Add automated memory leak detection in CI",
      "Implement connection lifecycle testing",
      "Regular memory profiling in production"
    ],
    "monitoring": [
      "Memory usage alerts at 80% threshold",
      "GC pause time monitoring",
      "Connection count tracking"
    ]
  }
}
```

**Best Practices Entries:**
```json
{
  "type": "best-practice",
  "domain": "api-design",
  "title": "RESTful API Versioning Strategy",
  "principle": "Use URL path versioning for major breaking changes, query parameters for minor variants",
  "rationale": "Provides clear contract versioning while maintaining backward compatibility",
  "implementation": {
    "url_structure": "/api/v{major}/resource",
    "header_usage": "API-Version: {major}.{minor}",
    "deprecation_policy": "Support N-1 versions, 6 month deprecation notice"
  },
  "examples": {
    "good": [
      "/api/v1/users - Version 1 users endpoint",
      "/api/v2/users - Version 2 with breaking changes",
      "API-Version: 2.1 - Minor version in header"
    ],
    "avoid": [
      "/api/users?version=1 - Version in query param",
      "/api/v1.2/users - Minor version in URL",
      "No versioning strategy"
    ]
  },
  "trade_offs": {
    "pros": ["Clear versioning", "Backward compatibility", "Client migration control"],
    "cons": ["URL proliferation", "Maintenance overhead", "Documentation complexity"]
  }
}
```

## Advanced Memory Features

### Memory Relationships and Linking

**Creating Memory Links:**
```bash
# Link related memories
claude-flow memory link <memory-id-1> <memory-id-2> \
  --relationship "builds-upon" \
  --confidence 0.9 \
  --description "Performance optimization builds upon caching strategy"

# Create contradiction link
claude-flow memory link <memory-id-1> <memory-id-2> \
  --relationship "contradicts" \
  --confidence 0.8 \
  --resolution-required true

# Validation link
claude-flow memory link <memory-id-1> <memory-id-2> \
  --relationship "validates" \
  --confidence 0.95 \
  --evidence "production-metrics.json"
```

**Exploring Memory Networks:**
```bash
# Find related memories
claude-flow memory related <memory-id> \
  --depth 3 \
  --min-confidence 0.5 \
  --relationship-types "all"

# Visualize memory graph
claude-flow memory graph \
  --agent-id <agent-id> \
  --output "memory-graph.svg" \
  --layout "hierarchical" \
  --include-metadata

# Analyze memory clusters
claude-flow memory cluster-analysis \
  --algorithm "community-detection" \
  --min-cluster-size 5 \
  --output "memory-clusters.json"
```

### Memory Validation and Scoring

**Knowledge Validation:**
```bash
# Validate memory entry
claude-flow memory validate <memory-id> \
  --validator "peer-review" \
  --criteria "accuracy,relevance,completeness,clarity" \
  --reviewers "senior-dev-1,architect-2"

# Automated validation
claude-flow memory validate <memory-id> \
  --validator "automated" \
  --checks "link-verification,data-consistency,format-compliance"

# Cross-validation
claude-flow memory cross-validate \
  --memories "memory-1,memory-2,memory-3" \
  --method "consensus-scoring"
```

**Scoring and Ranking:**
```bash
# Score memory entry
claude-flow memory score <memory-id> \
  --metric "usefulness" \
  --score 8.5 \
  --reviewer <agent-id> \
  --justification "Significant performance improvement with clear implementation"

# Bulk scoring
claude-flow memory bulk-score \
  --category "performance-optimizations" \
  --metric "impact" \
  --algorithm "ml-based"

# Get top-ranked memories
claude-flow memory rank \
  --category "architecture-patterns" \
  --metric "composite-score" \
  --limit 20 \
  --time-range "6m"
```

## Memory Synchronization and Consistency

### Conflict Resolution

**Detecting Conflicts:**
```bash
# Check for conflicts
claude-flow memory conflicts --check-all

# Specific conflict detection
claude-flow memory conflicts \
  --memory-id <memory-id> \
  --check-type "content,metadata,relationships"

# Automated conflict detection
claude-flow memory conflicts monitor \
  --real-time true \
  --alert-on "high-confidence-conflicts"
```

**Resolving Conflicts:**
```bash
# Manual conflict resolution
claude-flow memory resolve-conflict <conflict-id> \
  --strategy "merge" \
  --resolution-data resolution.json \
  --reviewer <agent-id>

# Automated resolution
claude-flow memory resolve-conflict <conflict-id> \
  --strategy "last-write-wins" \
  --confidence-threshold 0.8

# CRDT-based resolution
claude-flow memory resolve-conflict <conflict-id> \
  --strategy "crdt" \
  --merge-algorithm "semantic-merge"
```

**Conflict Resolution Strategies:**
```json
{
  "conflict_id": "conf-001",
  "type": "content-conflict",
  "memories": ["mem-123", "mem-456"],
  "resolution": {
    "strategy": "semantic-merge",
    "merged_content": {
      "title": "Database Optimization Techniques",
      "content": "Merged content from both memories",
      "confidence": 0.85,
      "sources": ["mem-123", "mem-456"]
    },
    "metadata": {
      "resolution_method": "automated-semantic-merge",
      "resolution_time": "2024-12-15T10:30:00Z",
      "reviewer": "system"
    }
  }
}
```

### Memory Synchronization

**Sync Configuration:**
```bash
# Configure sync settings
claude-flow config set memory.syncInterval 3000
claude-flow config set memory.conflictResolution crdt

# Manual sync trigger
claude-flow memory sync \
  --scope "agent-sessions" \
  --force true

# Cross-agent synchronization
claude-flow memory sync-agents \
  --agents "agent-1,agent-2,agent-3" \
  --merge-strategy "consensus"
```

**Distributed Memory Management:**
```bash
# Set up distributed memory
claude-flow memory distributed configure \
  --nodes "node-1,node-2,node-3" \
  --replication-factor 2 \
  --consistency "eventual"

# Monitor sync status
claude-flow memory sync-status \
  --show-lag true \
  --show-conflicts true \
  --format "dashboard"
```

## Memory Analytics and Insights

### Usage Analytics

**Memory Usage Patterns:**
```bash
# Analyze memory usage
claude-flow memory analytics usage \
  --time-range "30d" \
  --group-by "agent-type,category,time-of-day" \
  --output "usage-report.json"

# Growth analysis
claude-flow memory analytics growth \
  --metrics "entry-count,storage-size,query-frequency" \
  --trend-analysis true \
  --forecast "30d"

# Access patterns
claude-flow memory analytics access-patterns \
  --analyze "hot-data,cold-data,query-patterns" \
  --recommendations true
```

**Knowledge Discovery:**
```bash
# Discover knowledge gaps
claude-flow memory analytics gaps \
  --domain "web-development" \
  --compare-with "industry-standards.json" \
  --output "knowledge-gaps.json"

# Trend analysis
claude-flow memory analytics trends \
  --categories "all" \
  --time-window "weekly" \
  --trending-topics 10

# Impact analysis
claude-flow memory analytics impact \
  --memories "high-scored" \
  --trace-usage true \
  --roi-calculation true
```

### Learning Analytics

**Agent Learning Progression:**
```bash
# Analyze learning progression
claude-flow memory learning-analysis <agent-id> \
  --metrics "knowledge-acquisition-rate,topic-coverage,depth-improvement" \
  --time-range "90d" \
  --output "learning-report.pdf"

# Cross-agent learning comparison
claude-flow memory learning-compare \
  --agents "team-members" \
  --metrics "learning-velocity,knowledge-sharing" \
  --benchmark "team-average"

# Learning effectiveness
claude-flow memory learning-effectiveness \
  --interventions "training,mentoring,documentation" \
  --outcome-metrics "performance,quality,speed"
```

## Memory Backup and Recovery

### Backup Operations

**Creating Backups:**
```bash
# Full memory backup
claude-flow memory backup \
  --scope "all" \
  --output "memory-backup-$(date +%Y%m%d).tar.gz" \
  --compress true \
  --encrypt true \
  --password-file ".backup-key"

# Incremental backup
claude-flow memory backup \
  --incremental true \
  --since "2024-12-01" \
  --output "incremental-backup-$(date +%Y%m%d).tar.gz"

# Selective backup
claude-flow memory backup \
  --agents "critical-agents" \
  --categories "production-knowledge" \
  --high-value-only true
```

**Automated Backup Configuration:**
```json
{
  "backup": {
    "schedule": "0 2 * * *",
    "retention": {
      "daily": 7,
      "weekly": 4,
      "monthly": 12
    },
    "storage": {
      "local": "./backups",
      "remote": "s3://memory-backups",
      "encryption": true
    },
    "verification": {
      "checksum": true,
      "restore_test": "weekly"
    }
  }
}
```

### Recovery Operations

**Restore from Backup:**
```bash
# Full restore
claude-flow memory restore \
  --backup "memory-backup-20241201.tar.gz" \
  --strategy "replace" \
  --confirm true

# Selective restore
claude-flow memory restore \
  --backup "memory-backup-20241201.tar.gz" \
  --filter "agent-id:critical-agent,category:production" \
  --strategy "merge"

# Point-in-time recovery
claude-flow memory restore \
  --backup "memory-backup-20241201.tar.gz" \
  --point-in-time "2024-12-01T15:30:00Z" \
  --validate true
```

**Recovery Validation:**
```bash
# Validate restored data
claude-flow memory validate-restore \
  --backup-file "memory-backup-20241201.tar.gz" \
  --check-integrity true \
  --check-consistency true

# Recovery testing
claude-flow memory test-recovery \
  --backup "test-backup.tar.gz" \
  --sandbox true \
  --validation-script "recovery-test.sh"
```

## Memory Optimization

### Performance Optimization

**Cache Optimization:**
```bash
# Analyze cache performance
claude-flow memory cache-analysis \
  --metrics "hit-rate,miss-rate,eviction-rate" \
  --time-range "24h" \
  --recommendations true

# Optimize cache configuration
claude-flow memory optimize-cache \
  --target-hit-rate 0.9 \
  --memory-limit "500MB" \
  --eviction-policy "lru-with-frequency"

# Warm cache
claude-flow memory warm-cache \
  --preload "frequently-accessed" \
  --priority "high-value-memories"
```

**Storage Optimization:**
```bash
# Analyze storage usage
claude-flow memory storage-analysis \
  --breakdown "by-agent,by-category,by-age" \
  --identify-duplicates true \
  --compression-analysis true

# Optimize storage
claude-flow memory optimize-storage \
  --compress-old-entries "90d" \
  --deduplicate true \
  --archive-inactive "180d"

# Cleanup operations
claude-flow memory cleanup \
  --remove-orphaned true \
  --compact-indices true \
  --verify-integrity true
```

### Query Optimization

**Index Management:**
```bash
# Analyze query performance
claude-flow memory query-analysis \
  --slow-queries true \
  --index-usage true \
  --optimization-suggestions true

# Create custom indexes
claude-flow memory create-index \
  --fields "tags,timestamp,agent-type" \
  --type "composite" \
  --name "performance-queries"

# Rebuild indexes
claude-flow memory rebuild-indexes \
  --parallel true \
  --verify true
```

This comprehensive memory bank guide provides all the tools needed to effectively manage knowledge, facilitate learning, and maintain system intelligence in Gemini-Flow. Use these patterns to build robust, intelligent memory systems that enhance agent capabilities and preserve organizational knowledge.