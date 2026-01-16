-- ============================================================================
-- Migration 003: Create Indices
-- RuVector PostgreSQL Bridge - Claude Flow V3
--
-- Creates HNSW, IVFFlat, GIN, and B-tree indices for optimal query performance.
-- Compatible with PostgreSQL 14+ and pgvector 0.5+
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- HNSW Indices (Hierarchical Navigable Small World)
-- Best for: High recall, moderate dataset sizes, real-time applications
-- Parameters: m = edges per node, ef_construction = index build quality
-- ----------------------------------------------------------------------------

-- Vectors table - HNSW index for cosine similarity (default)
CREATE INDEX IF NOT EXISTS idx_vectors_embedding_hnsw_cosine
    ON claude_flow.vectors
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Vectors table - HNSW index for L2 distance (euclidean)
CREATE INDEX IF NOT EXISTS idx_vectors_embedding_hnsw_l2
    ON claude_flow.vectors
    USING hnsw (embedding vector_l2_ops)
    WITH (m = 16, ef_construction = 64);

-- Vectors table - HNSW index for inner product (dot)
CREATE INDEX IF NOT EXISTS idx_vectors_embedding_hnsw_ip
    ON claude_flow.vectors
    USING hnsw (embedding vector_ip_ops)
    WITH (m = 16, ef_construction = 64);

-- Embeddings table - HNSW index
CREATE INDEX IF NOT EXISTS idx_embeddings_embedding_hnsw_cosine
    ON claude_flow.embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ----------------------------------------------------------------------------
-- IVFFlat Indices (Inverted File with Flat vectors)
-- Best for: Large datasets with bulk loading, lower memory usage
-- Parameters: lists = number of inverted lists (sqrt(n) to n/100)
-- ----------------------------------------------------------------------------

-- Create IVFFlat indices (commented by default - enable based on use case)
-- Note: IVFFlat requires training data, so we use a lower lists count initially

-- Vectors table - IVFFlat index for cosine similarity
-- CREATE INDEX IF NOT EXISTS idx_vectors_embedding_ivfflat_cosine
--     ON claude_flow.vectors
--     USING ivfflat (embedding vector_cosine_ops)
--     WITH (lists = 100);

-- Vectors table - IVFFlat index for L2 distance
-- CREATE INDEX IF NOT EXISTS idx_vectors_embedding_ivfflat_l2
--     ON claude_flow.vectors
--     USING ivfflat (embedding vector_l2_ops)
--     WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- Metadata GIN Indices
-- Best for: JSONB containment and key/value queries
-- ----------------------------------------------------------------------------

-- Vectors metadata index
CREATE INDEX IF NOT EXISTS idx_vectors_metadata_gin
    ON claude_flow.vectors
    USING gin (metadata jsonb_path_ops);

-- Embeddings metadata index
CREATE INDEX IF NOT EXISTS idx_embeddings_metadata_gin
    ON claude_flow.embeddings
    USING gin (metadata jsonb_path_ops);

-- Attention cache metadata index
CREATE INDEX IF NOT EXISTS idx_attention_cache_metadata_gin
    ON claude_flow.attention_cache
    USING gin (metadata jsonb_path_ops);

-- GNN cache metadata index
CREATE INDEX IF NOT EXISTS idx_gnn_cache_metadata_gin
    ON claude_flow.gnn_cache
    USING gin (metadata jsonb_path_ops);

-- Hyperbolic embeddings metadata index
CREATE INDEX IF NOT EXISTS idx_hyperbolic_metadata_gin
    ON claude_flow.hyperbolic_embeddings
    USING gin (metadata jsonb_path_ops);

-- Collections metadata index
CREATE INDEX IF NOT EXISTS idx_collections_metadata_gin
    ON claude_flow.collections
    USING gin (metadata jsonb_path_ops);

-- ----------------------------------------------------------------------------
-- Namespace and Collection B-tree Indices
-- Best for: Equality and range queries on text columns
-- ----------------------------------------------------------------------------

-- Vectors namespace and collection index
CREATE INDEX IF NOT EXISTS idx_vectors_namespace_collection
    ON claude_flow.vectors (namespace, collection);

-- Vectors namespace only
CREATE INDEX IF NOT EXISTS idx_vectors_namespace
    ON claude_flow.vectors (namespace);

-- Embeddings namespace index
CREATE INDEX IF NOT EXISTS idx_embeddings_namespace
    ON claude_flow.embeddings (namespace);

-- Embeddings tags index (using GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_embeddings_tags_gin
    ON claude_flow.embeddings
    USING gin (tags);

-- Hyperbolic namespace index
CREATE INDEX IF NOT EXISTS idx_hyperbolic_namespace
    ON claude_flow.hyperbolic_embeddings (namespace);

-- Collections namespace index
CREATE INDEX IF NOT EXISTS idx_collections_namespace
    ON claude_flow.collections (namespace);

-- ----------------------------------------------------------------------------
-- Timestamp B-tree Indices
-- Best for: Time-based queries and TTL cleanup
-- ----------------------------------------------------------------------------

-- Vectors timestamp indices
CREATE INDEX IF NOT EXISTS idx_vectors_created_at
    ON claude_flow.vectors (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vectors_updated_at
    ON claude_flow.vectors (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_vectors_expires_at
    ON claude_flow.vectors (expires_at)
    WHERE expires_at IS NOT NULL;

-- Embeddings timestamp indices
CREATE INDEX IF NOT EXISTS idx_embeddings_created_at
    ON claude_flow.embeddings (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_embeddings_last_accessed
    ON claude_flow.embeddings (last_accessed_at DESC)
    WHERE last_accessed_at IS NOT NULL;

-- Attention cache timestamp indices
CREATE INDEX IF NOT EXISTS idx_attention_cache_created_at
    ON claude_flow.attention_cache (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attention_cache_last_accessed
    ON claude_flow.attention_cache (last_accessed_at DESC);

-- GNN cache timestamp indices
CREATE INDEX IF NOT EXISTS idx_gnn_cache_created_at
    ON claude_flow.gnn_cache (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gnn_cache_last_accessed
    ON claude_flow.gnn_cache (last_accessed_at DESC);

-- Hyperbolic embeddings timestamp indices
CREATE INDEX IF NOT EXISTS idx_hyperbolic_created_at
    ON claude_flow.hyperbolic_embeddings (created_at DESC);

-- Collections timestamp indices
CREATE INDEX IF NOT EXISTS idx_collections_created_at
    ON claude_flow.collections (created_at DESC);

-- ----------------------------------------------------------------------------
-- Hash/Deduplication Indices
-- Best for: Quick lookups by content hash
-- ----------------------------------------------------------------------------

-- Vectors hash index for deduplication
CREATE INDEX IF NOT EXISTS idx_vectors_hash
    ON claude_flow.vectors (hash)
    WHERE hash IS NOT NULL;

-- Vectors source index
CREATE INDEX IF NOT EXISTS idx_vectors_source
    ON claude_flow.vectors (source)
    WHERE source IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Hierarchy Indices (for hyperbolic embeddings)
-- Best for: Tree traversal queries
-- ----------------------------------------------------------------------------

-- Parent lookup index
CREATE INDEX IF NOT EXISTS idx_hyperbolic_parent
    ON claude_flow.hyperbolic_embeddings (parent_id)
    WHERE parent_id IS NOT NULL;

-- Depth index for level-based queries
CREATE INDEX IF NOT EXISTS idx_hyperbolic_depth
    ON claude_flow.hyperbolic_embeddings (depth);

-- ----------------------------------------------------------------------------
-- Access Pattern Indices
-- Best for: LRU/LFU cache eviction queries
-- ----------------------------------------------------------------------------

-- Embeddings access count index
CREATE INDEX IF NOT EXISTS idx_embeddings_access_count
    ON claude_flow.embeddings (access_count DESC);

-- Attention cache hit count index
CREATE INDEX IF NOT EXISTS idx_attention_cache_hit_count
    ON claude_flow.attention_cache (hit_count DESC);

-- GNN cache hit count index
CREATE INDEX IF NOT EXISTS idx_gnn_cache_hit_count
    ON claude_flow.gnn_cache (hit_count DESC);

-- ----------------------------------------------------------------------------
-- Partial Indices for Common Queries
-- Best for: Frequently filtered subsets
-- ----------------------------------------------------------------------------

-- Active (non-expired) vectors
CREATE INDEX IF NOT EXISTS idx_vectors_active
    ON claude_flow.vectors (namespace, created_at DESC)
    WHERE expires_at IS NULL OR expires_at > NOW();

-- High-importance embeddings
CREATE INDEX IF NOT EXISTS idx_embeddings_high_importance
    ON claude_flow.embeddings (importance DESC)
    WHERE importance >= 0.7;

-- ----------------------------------------------------------------------------
-- Composite Indices for Common Query Patterns
-- ----------------------------------------------------------------------------

-- Vectors: namespace + collection + created_at (for filtered time queries)
CREATE INDEX IF NOT EXISTS idx_vectors_ns_coll_created
    ON claude_flow.vectors (namespace, collection, created_at DESC);

-- Embeddings: namespace + importance + access_count (for prioritization)
CREATE INDEX IF NOT EXISTS idx_embeddings_ns_importance
    ON claude_flow.embeddings (namespace, importance DESC, access_count DESC);

-- ----------------------------------------------------------------------------
-- Index Statistics and Maintenance
-- ----------------------------------------------------------------------------

-- Analyze tables after index creation
ANALYZE claude_flow.vectors;
ANALYZE claude_flow.embeddings;
ANALYZE claude_flow.attention_cache;
ANALYZE claude_flow.gnn_cache;
ANALYZE claude_flow.hyperbolic_embeddings;
ANALYZE claude_flow.collections;

-- ----------------------------------------------------------------------------
-- Record migration
-- ----------------------------------------------------------------------------
INSERT INTO claude_flow.migrations (name, checksum)
VALUES ('003_create_indices', md5('003_create_indices'))
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Rollback Script
-- ============================================================================
-- BEGIN;
-- -- Drop composite indices
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_ns_importance;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_ns_coll_created;
--
-- -- Drop partial indices
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_high_importance;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_active;
--
-- -- Drop access pattern indices
-- DROP INDEX IF EXISTS claude_flow.idx_gnn_cache_hit_count;
-- DROP INDEX IF EXISTS claude_flow.idx_attention_cache_hit_count;
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_access_count;
--
-- -- Drop hierarchy indices
-- DROP INDEX IF EXISTS claude_flow.idx_hyperbolic_depth;
-- DROP INDEX IF EXISTS claude_flow.idx_hyperbolic_parent;
--
-- -- Drop hash indices
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_source;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_hash;
--
-- -- Drop timestamp indices
-- DROP INDEX IF EXISTS claude_flow.idx_collections_created_at;
-- DROP INDEX IF EXISTS claude_flow.idx_hyperbolic_created_at;
-- DROP INDEX IF EXISTS claude_flow.idx_gnn_cache_last_accessed;
-- DROP INDEX IF EXISTS claude_flow.idx_gnn_cache_created_at;
-- DROP INDEX IF EXISTS claude_flow.idx_attention_cache_last_accessed;
-- DROP INDEX IF EXISTS claude_flow.idx_attention_cache_created_at;
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_last_accessed;
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_created_at;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_expires_at;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_updated_at;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_created_at;
--
-- -- Drop namespace indices
-- DROP INDEX IF EXISTS claude_flow.idx_collections_namespace;
-- DROP INDEX IF EXISTS claude_flow.idx_hyperbolic_namespace;
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_tags_gin;
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_namespace;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_namespace;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_namespace_collection;
--
-- -- Drop GIN indices
-- DROP INDEX IF EXISTS claude_flow.idx_collections_metadata_gin;
-- DROP INDEX IF EXISTS claude_flow.idx_hyperbolic_metadata_gin;
-- DROP INDEX IF EXISTS claude_flow.idx_gnn_cache_metadata_gin;
-- DROP INDEX IF EXISTS claude_flow.idx_attention_cache_metadata_gin;
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_metadata_gin;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_metadata_gin;
--
-- -- Drop HNSW indices
-- DROP INDEX IF EXISTS claude_flow.idx_embeddings_embedding_hnsw_cosine;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_embedding_hnsw_ip;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_embedding_hnsw_l2;
-- DROP INDEX IF EXISTS claude_flow.idx_vectors_embedding_hnsw_cosine;
--
-- DELETE FROM claude_flow.migrations WHERE name = '003_create_indices';
-- COMMIT;
