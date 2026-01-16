-- ============================================================================
-- Migration 001: Create Extensions and Schema
-- RuVector PostgreSQL Bridge - Claude Flow V3
--
-- Enables required PostgreSQL extensions and creates the claude_flow schema.
-- Compatible with PostgreSQL 14+ and pgvector 0.5+
-- ============================================================================

-- Transaction wrapper for atomicity
BEGIN;

-- ----------------------------------------------------------------------------
-- Extension: pgvector
-- Provides vector similarity search capabilities
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify pgvector version (0.5.0+ required for HNSW)
DO $$
DECLARE
    v_version text;
BEGIN
    SELECT extversion INTO v_version FROM pg_extension WHERE extname = 'vector';
    IF v_version IS NULL THEN
        RAISE EXCEPTION 'pgvector extension not installed';
    END IF;

    -- Parse version and check >= 0.5.0
    IF string_to_array(v_version, '.')::int[] < ARRAY[0, 5, 0] THEN
        RAISE WARNING 'pgvector version % detected. Version 0.5.0+ recommended for HNSW support.', v_version;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Extension: pg_trgm (for fuzzy text search on metadata)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- Extension: btree_gin (for composite GIN indexes)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ----------------------------------------------------------------------------
-- Extension: uuid-ossp (for UUID generation)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- RuVector Extension (if available)
-- Provides advanced neural search capabilities
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Try to create RuVector extension if available
    BEGIN
        CREATE EXTENSION IF NOT EXISTS ruvector;
        RAISE NOTICE 'RuVector extension enabled successfully';
    EXCEPTION
        WHEN undefined_file THEN
            RAISE NOTICE 'RuVector extension not available - using pgvector only';
        WHEN OTHERS THEN
            RAISE NOTICE 'RuVector extension not available: %', SQLERRM;
    END;
END $$;

-- ----------------------------------------------------------------------------
-- Schema: claude_flow
-- Namespace for all Claude Flow tables and functions
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS claude_flow;

-- Set search path to include claude_flow schema
COMMENT ON SCHEMA claude_flow IS 'Claude Flow V3 - RuVector PostgreSQL Bridge schema';

-- Grant usage on schema
DO $$
BEGIN
    -- Grant to PUBLIC for general access (modify as needed for security)
    GRANT USAGE ON SCHEMA claude_flow TO PUBLIC;
    GRANT CREATE ON SCHEMA claude_flow TO PUBLIC;
END $$;

-- ----------------------------------------------------------------------------
-- Configuration table for RuVector settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default configuration
INSERT INTO claude_flow.config (key, value) VALUES
    ('version', '"1.0.0"'),
    ('default_dimensions', '1536'),
    ('default_metric', '"cosine"'),
    ('hnsw_m', '16'),
    ('hnsw_ef_construction', '64'),
    ('ivfflat_lists', '100')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Migration tracking table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claude_flow.migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum TEXT,
    execution_time_ms INTEGER,
    rolled_back_at TIMESTAMPTZ
);

-- Record this migration
INSERT INTO claude_flow.migrations (name, checksum)
VALUES ('001_create_extension', md5('001_create_extension'))
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Rollback Script (run separately if needed)
-- ============================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS claude_flow.migrations;
-- DROP TABLE IF EXISTS claude_flow.config;
-- DROP SCHEMA IF EXISTS claude_flow CASCADE;
-- DROP EXTENSION IF EXISTS ruvector;
-- DROP EXTENSION IF EXISTS "uuid-ossp";
-- DROP EXTENSION IF EXISTS btree_gin;
-- DROP EXTENSION IF EXISTS pg_trgm;
-- DROP EXTENSION IF EXISTS vector;
-- COMMIT;
