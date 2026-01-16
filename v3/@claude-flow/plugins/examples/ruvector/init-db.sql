-- RuVector PostgreSQL Bridge - Database Initialization
--
-- This script is automatically executed when the PostgreSQL container starts.
-- It sets up the pgvector extension and creates necessary schemas and functions.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create a schema for RuVector-specific objects
CREATE SCHEMA IF NOT EXISTS ruvector;

-- Set search path to include ruvector schema
ALTER DATABASE vectors SET search_path TO public, ruvector;

-- Create a function to normalize vectors
CREATE OR REPLACE FUNCTION ruvector.normalize_vector(v vector)
RETURNS vector AS $$
DECLARE
    magnitude float;
BEGIN
    SELECT sqrt(sum(x * x)) INTO magnitude
    FROM unnest(v::float[]) AS x;

    IF magnitude = 0 THEN
        RETURN v;
    END IF;

    RETURN (SELECT array_agg(x / magnitude)::vector
            FROM unnest(v::float[]) AS x);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a function for cosine similarity (returns similarity, not distance)
CREATE OR REPLACE FUNCTION ruvector.cosine_similarity(a vector, b vector)
RETURNS float AS $$
BEGIN
    RETURN 1 - (a <=> b);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a function for batch vector insertion with normalization
CREATE OR REPLACE FUNCTION ruvector.insert_normalized(
    table_name text,
    id_col text,
    vec_col text,
    ids text[],
    vectors vector[]
) RETURNS int AS $$
DECLARE
    inserted int := 0;
    i int;
BEGIN
    FOR i IN 1..array_length(ids, 1) LOOP
        EXECUTE format(
            'INSERT INTO %I (%I, %I) VALUES ($1, ruvector.normalize_vector($2))',
            table_name, id_col, vec_col
        ) USING ids[i], vectors[i];
        inserted := inserted + 1;
    END LOOP;
    RETURN inserted;
END;
$$ LANGUAGE plpgsql;

-- Create a function to analyze vector distribution
CREATE OR REPLACE FUNCTION ruvector.analyze_vectors(
    table_name text,
    vec_col text
) RETURNS TABLE (
    total_count bigint,
    avg_magnitude float,
    min_magnitude float,
    max_magnitude float,
    dimension int
) AS $$
BEGIN
    RETURN QUERY EXECUTE format(
        'SELECT
            COUNT(*)::bigint,
            AVG(sqrt((SELECT SUM(x*x) FROM unnest(%I::float[]) AS x)))::float,
            MIN(sqrt((SELECT SUM(x*x) FROM unnest(%I::float[]) AS x)))::float,
            MAX(sqrt((SELECT SUM(x*x) FROM unnest(%I::float[]) AS x)))::float,
            vector_dims(%I)
         FROM %I
         LIMIT 1',
        vec_col, vec_col, vec_col, vec_col, table_name
    );
END;
$$ LANGUAGE plpgsql;

-- Create a sample table for testing
CREATE TABLE IF NOT EXISTS ruvector.sample_vectors (
    id text PRIMARY KEY,
    embedding vector(128),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp DEFAULT now()
);

-- Create HNSW index on sample table
CREATE INDEX IF NOT EXISTS sample_vectors_embedding_idx
ON ruvector.sample_vectors
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Create GIN index for metadata queries
CREATE INDEX IF NOT EXISTS sample_vectors_metadata_idx
ON ruvector.sample_vectors
USING gin (metadata jsonb_path_ops);

-- Grant permissions
GRANT ALL ON SCHEMA ruvector TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA ruvector TO postgres;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA ruvector TO postgres;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'RuVector database initialization complete';
    RAISE NOTICE 'pgvector version: %', (SELECT extversion FROM pg_extension WHERE extname = 'vector');
END $$;
