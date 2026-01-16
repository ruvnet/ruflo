-- ============================================================================
-- Migration 002: Create Vector Tables
-- RuVector PostgreSQL Bridge - Claude Flow V3
--
-- Creates core vector storage tables for embeddings, attention, and GNN cache.
-- Compatible with PostgreSQL 14+ and pgvector 0.5+
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Table: vectors
-- Primary vector storage table with metadata support
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.vectors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    embedding vector(1536),  -- Default dimension, will be cast dynamically
    metadata JSONB NOT NULL DEFAULT '{}',
    content TEXT,  -- Optional text content associated with vector
    namespace TEXT NOT NULL DEFAULT 'default',
    collection TEXT NOT NULL DEFAULT 'default',
    source TEXT,  -- Source identifier (file path, URL, etc.)
    hash TEXT,  -- Content hash for deduplication
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,  -- Optional TTL

    -- Constraints
    CONSTRAINT vectors_hash_unique UNIQUE (namespace, collection, hash)
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION claude_flow.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vectors_updated_at
    BEFORE UPDATE ON claude_flow.vectors
    FOR EACH ROW
    EXECUTE FUNCTION claude_flow.update_updated_at();

-- ----------------------------------------------------------------------------
-- Table: embeddings
-- Namespace-aware embeddings storage with dimension flexibility
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    embedding vector(1536),
    dimensions INTEGER NOT NULL DEFAULT 1536,
    model TEXT,  -- Model used to generate embedding (e.g., 'text-embedding-3-large')
    metadata JSONB NOT NULL DEFAULT '{}',
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    importance REAL DEFAULT 0.5,  -- Importance score for prioritization
    access_count INTEGER DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT embeddings_namespace_name_unique UNIQUE (namespace, name)
);

CREATE TRIGGER embeddings_updated_at
    BEFORE UPDATE ON claude_flow.embeddings
    FOR EACH ROW
    EXECUTE FUNCTION claude_flow.update_updated_at();

-- ----------------------------------------------------------------------------
-- Table: attention_cache
-- Caches attention computation results for performance
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.attention_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_key TEXT NOT NULL UNIQUE,  -- Hash of input parameters
    query_hash TEXT NOT NULL,
    keys_hash TEXT NOT NULL,
    values_hash TEXT NOT NULL,
    num_heads INTEGER NOT NULL,
    attention_type TEXT NOT NULL CHECK (attention_type IN ('standard', 'multi_head', 'flash', 'sparse', 'linear')),

    -- Cached results (stored as float arrays for flexibility)
    attention_weights REAL[],
    attention_output REAL[],
    output_dimensions INTEGER[],  -- Shape of the output

    -- Performance metrics
    computation_time_ms REAL,
    memory_usage_bytes BIGINT,

    -- Metadata
    metadata JSONB DEFAULT '{}',
    hit_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,  -- TTL for cache eviction

    -- Constraints
    CONSTRAINT attention_cache_valid_heads CHECK (num_heads > 0)
);

-- Index for cache lookups
CREATE INDEX IF NOT EXISTS idx_attention_cache_key ON claude_flow.attention_cache (cache_key);
CREATE INDEX IF NOT EXISTS idx_attention_cache_type ON claude_flow.attention_cache (attention_type);
CREATE INDEX IF NOT EXISTS idx_attention_cache_expires ON claude_flow.attention_cache (expires_at) WHERE expires_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Table: gnn_cache
-- Caches Graph Neural Network computation results
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.gnn_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cache_key TEXT NOT NULL UNIQUE,
    graph_hash TEXT NOT NULL,  -- Hash of graph structure
    layer_type TEXT NOT NULL CHECK (layer_type IN ('gcn', 'gat', 'graphsage', 'gin', 'mpnn')),
    layer_index INTEGER NOT NULL DEFAULT 0,

    -- Graph structure (adjacency representation)
    num_nodes INTEGER NOT NULL,
    num_edges INTEGER NOT NULL,
    node_features_dim INTEGER NOT NULL,
    edge_features_dim INTEGER DEFAULT 0,

    -- Cached results
    node_embeddings REAL[],  -- Output node embeddings
    edge_embeddings REAL[],  -- Output edge embeddings (if applicable)
    output_dim INTEGER NOT NULL,

    -- GNN-specific parameters
    aggregation TEXT DEFAULT 'mean',  -- mean, sum, max, attention
    num_heads INTEGER DEFAULT 1,  -- For GAT
    dropout_rate REAL DEFAULT 0.0,

    -- Performance metrics
    computation_time_ms REAL,
    memory_usage_bytes BIGINT,

    -- Metadata
    metadata JSONB DEFAULT '{}',
    hit_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT gnn_cache_valid_dimensions CHECK (num_nodes > 0 AND node_features_dim > 0)
);

-- Indexes for GNN cache
CREATE INDEX IF NOT EXISTS idx_gnn_cache_key ON claude_flow.gnn_cache (cache_key);
CREATE INDEX IF NOT EXISTS idx_gnn_cache_type ON claude_flow.gnn_cache (layer_type);
CREATE INDEX IF NOT EXISTS idx_gnn_cache_graph ON claude_flow.gnn_cache (graph_hash);
CREATE INDEX IF NOT EXISTS idx_gnn_cache_expires ON claude_flow.gnn_cache (expires_at) WHERE expires_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Table: hyperbolic_embeddings
-- Stores hyperbolic (Poincare/Lorentz) embeddings for hierarchical data
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.hyperbolic_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    namespace TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,

    -- Hyperbolic coordinates
    poincare_embedding REAL[] NOT NULL,  -- Poincare ball coordinates
    lorentz_embedding REAL[],  -- Lorentz model coordinates (optional)
    dimensions INTEGER NOT NULL,
    curvature REAL NOT NULL DEFAULT -1.0,  -- Negative curvature

    -- Hierarchy information
    depth INTEGER DEFAULT 0,
    parent_id UUID REFERENCES claude_flow.hyperbolic_embeddings(id),
    children_count INTEGER DEFAULT 0,

    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT hyperbolic_valid_curvature CHECK (curvature < 0),
    CONSTRAINT hyperbolic_namespace_name_unique UNIQUE (namespace, name)
);

CREATE TRIGGER hyperbolic_embeddings_updated_at
    BEFORE UPDATE ON claude_flow.hyperbolic_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION claude_flow.update_updated_at();

-- ----------------------------------------------------------------------------
-- Table: collections
-- Manages vector collections with configuration
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    namespace TEXT NOT NULL DEFAULT 'default',
    dimensions INTEGER NOT NULL DEFAULT 1536,
    metric TEXT NOT NULL DEFAULT 'cosine' CHECK (metric IN ('cosine', 'euclidean', 'dot', 'hamming', 'manhattan')),

    -- Index configuration
    index_type TEXT DEFAULT 'hnsw' CHECK (index_type IN ('hnsw', 'ivfflat', 'flat')),
    hnsw_m INTEGER DEFAULT 16,
    hnsw_ef_construction INTEGER DEFAULT 64,
    ivfflat_lists INTEGER DEFAULT 100,

    -- Collection stats
    vector_count INTEGER DEFAULT 0,
    total_size_bytes BIGINT DEFAULT 0,

    -- Metadata
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT collections_valid_dimensions CHECK (dimensions > 0 AND dimensions <= 16384),
    CONSTRAINT collections_valid_hnsw CHECK (hnsw_m >= 2 AND hnsw_m <= 100)
);

CREATE TRIGGER collections_updated_at
    BEFORE UPDATE ON claude_flow.collections
    FOR EACH ROW
    EXECUTE FUNCTION claude_flow.update_updated_at();

-- Insert default collection
INSERT INTO claude_flow.collections (name, namespace, dimensions, metric)
VALUES ('default', 'default', 1536, 'cosine')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Record migration
-- ----------------------------------------------------------------------------
INSERT INTO claude_flow.migrations (name, checksum)
VALUES ('002_create_vector_tables', md5('002_create_vector_tables'))
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Rollback Script
-- ============================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS claude_flow.collections CASCADE;
-- DROP TABLE IF EXISTS claude_flow.hyperbolic_embeddings CASCADE;
-- DROP TABLE IF EXISTS claude_flow.gnn_cache CASCADE;
-- DROP TABLE IF EXISTS claude_flow.attention_cache CASCADE;
-- DROP TABLE IF EXISTS claude_flow.embeddings CASCADE;
-- DROP TABLE IF EXISTS claude_flow.vectors CASCADE;
-- DROP FUNCTION IF EXISTS claude_flow.update_updated_at();
-- DELETE FROM claude_flow.migrations WHERE name = '002_create_vector_tables';
-- COMMIT;
