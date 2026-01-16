-- ============================================================================
-- Migration 004: Create Helper Functions
-- RuVector PostgreSQL Bridge - Claude Flow V3
--
-- Creates helper functions for vector operations, distance calculations,
-- batch inserts, and upserts.
-- Compatible with PostgreSQL 14+ and pgvector 0.5+
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Distance Calculation Functions
-- ----------------------------------------------------------------------------

-- Cosine distance (returns distance, not similarity)
CREATE OR REPLACE FUNCTION claude_flow.cosine_distance(
    v1 vector,
    v2 vector
) RETURNS REAL AS $$
BEGIN
    RETURN 1.0 - (v1 <=> v2);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Cosine similarity (1 - distance)
CREATE OR REPLACE FUNCTION claude_flow.cosine_similarity(
    v1 vector,
    v2 vector
) RETURNS REAL AS $$
BEGIN
    RETURN 1.0 - (v1 <=> v2);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Euclidean distance (L2)
CREATE OR REPLACE FUNCTION claude_flow.euclidean_distance(
    v1 vector,
    v2 vector
) RETURNS REAL AS $$
BEGIN
    RETURN v1 <-> v2;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Inner product (dot product)
CREATE OR REPLACE FUNCTION claude_flow.inner_product(
    v1 vector,
    v2 vector
) RETURNS REAL AS $$
BEGIN
    RETURN v1 <#> v2;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Manhattan distance (L1)
CREATE OR REPLACE FUNCTION claude_flow.manhattan_distance(
    v1 REAL[],
    v2 REAL[]
) RETURNS REAL AS $$
DECLARE
    i INTEGER;
    dist REAL := 0;
BEGIN
    IF array_length(v1, 1) != array_length(v2, 1) THEN
        RAISE EXCEPTION 'Vector dimensions must match';
    END IF;

    FOR i IN 1..array_length(v1, 1) LOOP
        dist := dist + abs(v1[i] - v2[i]);
    END LOOP;

    RETURN dist;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Chebyshev distance (L-infinity)
CREATE OR REPLACE FUNCTION claude_flow.chebyshev_distance(
    v1 REAL[],
    v2 REAL[]
) RETURNS REAL AS $$
DECLARE
    i INTEGER;
    max_diff REAL := 0;
    diff REAL;
BEGIN
    IF array_length(v1, 1) != array_length(v2, 1) THEN
        RAISE EXCEPTION 'Vector dimensions must match';
    END IF;

    FOR i IN 1..array_length(v1, 1) LOOP
        diff := abs(v1[i] - v2[i]);
        IF diff > max_diff THEN
            max_diff := diff;
        END IF;
    END LOOP;

    RETURN max_diff;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Minkowski distance (generalized)
CREATE OR REPLACE FUNCTION claude_flow.minkowski_distance(
    v1 REAL[],
    v2 REAL[],
    p REAL DEFAULT 2.0
) RETURNS REAL AS $$
DECLARE
    i INTEGER;
    sum_val REAL := 0;
BEGIN
    IF array_length(v1, 1) != array_length(v2, 1) THEN
        RAISE EXCEPTION 'Vector dimensions must match';
    END IF;

    IF p <= 0 THEN
        RAISE EXCEPTION 'p must be positive';
    END IF;

    FOR i IN 1..array_length(v1, 1) LOOP
        sum_val := sum_val + power(abs(v1[i] - v2[i]), p);
    END LOOP;

    RETURN power(sum_val, 1.0 / p);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Vector Normalization Functions
-- ----------------------------------------------------------------------------

-- L2 normalize a vector
CREATE OR REPLACE FUNCTION claude_flow.l2_normalize(
    v REAL[]
) RETURNS REAL[] AS $$
DECLARE
    norm REAL := 0;
    i INTEGER;
    result REAL[];
BEGIN
    FOR i IN 1..array_length(v, 1) LOOP
        norm := norm + v[i] * v[i];
    END LOOP;

    norm := sqrt(norm);

    IF norm = 0 THEN
        RETURN v;
    END IF;

    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(v, 1) LOOP
        result := array_append(result, v[i] / norm);
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Get vector magnitude (L2 norm)
CREATE OR REPLACE FUNCTION claude_flow.vector_magnitude(
    v REAL[]
) RETURNS REAL AS $$
DECLARE
    sum_sq REAL := 0;
    i INTEGER;
BEGIN
    FOR i IN 1..array_length(v, 1) LOOP
        sum_sq := sum_sq + v[i] * v[i];
    END LOOP;

    RETURN sqrt(sum_sq);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Vector Arithmetic Functions
-- ----------------------------------------------------------------------------

-- Add two vectors
CREATE OR REPLACE FUNCTION claude_flow.vector_add(
    v1 REAL[],
    v2 REAL[]
) RETURNS REAL[] AS $$
DECLARE
    i INTEGER;
    result REAL[];
BEGIN
    IF array_length(v1, 1) != array_length(v2, 1) THEN
        RAISE EXCEPTION 'Vector dimensions must match';
    END IF;

    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(v1, 1) LOOP
        result := array_append(result, v1[i] + v2[i]);
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Subtract two vectors
CREATE OR REPLACE FUNCTION claude_flow.vector_subtract(
    v1 REAL[],
    v2 REAL[]
) RETURNS REAL[] AS $$
DECLARE
    i INTEGER;
    result REAL[];
BEGIN
    IF array_length(v1, 1) != array_length(v2, 1) THEN
        RAISE EXCEPTION 'Vector dimensions must match';
    END IF;

    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(v1, 1) LOOP
        result := array_append(result, v1[i] - v2[i]);
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Scale a vector
CREATE OR REPLACE FUNCTION claude_flow.vector_scale(
    v REAL[],
    scalar REAL
) RETURNS REAL[] AS $$
DECLARE
    i INTEGER;
    result REAL[];
BEGIN
    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(v, 1) LOOP
        result := array_append(result, v[i] * scalar);
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Dot product of two vectors (as arrays)
CREATE OR REPLACE FUNCTION claude_flow.dot_product(
    v1 REAL[],
    v2 REAL[]
) RETURNS REAL AS $$
DECLARE
    i INTEGER;
    result REAL := 0;
BEGIN
    IF array_length(v1, 1) != array_length(v2, 1) THEN
        RAISE EXCEPTION 'Vector dimensions must match';
    END IF;

    FOR i IN 1..array_length(v1, 1) LOOP
        result := result + v1[i] * v2[i];
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Batch Insert Function
-- ----------------------------------------------------------------------------

-- Batch insert vectors with automatic deduplication
CREATE OR REPLACE FUNCTION claude_flow.batch_insert_vectors(
    p_vectors JSONB  -- Array of {embedding, metadata, namespace, collection, content, source}
) RETURNS TABLE (
    id UUID,
    inserted BOOLEAN,
    error TEXT
) AS $$
DECLARE
    v_record JSONB;
    v_embedding vector;
    v_id UUID;
    v_hash TEXT;
BEGIN
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_vectors)
    LOOP
        BEGIN
            -- Generate hash for deduplication
            v_hash := md5(v_record->>'embedding');

            -- Try to insert
            INSERT INTO claude_flow.vectors (
                embedding,
                metadata,
                namespace,
                collection,
                content,
                source,
                hash
            ) VALUES (
                (v_record->>'embedding')::vector,
                COALESCE(v_record->'metadata', '{}'::jsonb),
                COALESCE(v_record->>'namespace', 'default'),
                COALESCE(v_record->>'collection', 'default'),
                v_record->>'content',
                v_record->>'source',
                v_hash
            )
            ON CONFLICT (namespace, collection, hash) DO NOTHING
            RETURNING vectors.id INTO v_id;

            IF v_id IS NOT NULL THEN
                id := v_id;
                inserted := TRUE;
                error := NULL;
            ELSE
                -- Get existing ID
                SELECT vectors.id INTO v_id
                FROM claude_flow.vectors
                WHERE vectors.namespace = COALESCE(v_record->>'namespace', 'default')
                  AND vectors.collection = COALESCE(v_record->>'collection', 'default')
                  AND vectors.hash = v_hash;

                id := v_id;
                inserted := FALSE;
                error := 'Duplicate entry';
            END IF;

            RETURN NEXT;

        EXCEPTION WHEN OTHERS THEN
            id := NULL;
            inserted := FALSE;
            error := SQLERRM;
            RETURN NEXT;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Upsert Function
-- ----------------------------------------------------------------------------

-- Upsert a single vector
CREATE OR REPLACE FUNCTION claude_flow.upsert_vector(
    p_embedding vector,
    p_metadata JSONB DEFAULT '{}',
    p_namespace TEXT DEFAULT 'default',
    p_collection TEXT DEFAULT 'default',
    p_content TEXT DEFAULT NULL,
    p_source TEXT DEFAULT NULL,
    p_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_hash TEXT;
BEGIN
    -- Generate hash
    v_hash := md5(p_embedding::text);

    IF p_id IS NOT NULL THEN
        -- Update by ID
        UPDATE claude_flow.vectors
        SET embedding = p_embedding,
            metadata = p_metadata,
            content = p_content,
            source = p_source,
            hash = v_hash,
            version = version + 1
        WHERE id = p_id
        RETURNING id INTO v_id;

        IF v_id IS NULL THEN
            -- ID not found, insert new
            INSERT INTO claude_flow.vectors (id, embedding, metadata, namespace, collection, content, source, hash)
            VALUES (p_id, p_embedding, p_metadata, p_namespace, p_collection, p_content, p_source, v_hash)
            RETURNING id INTO v_id;
        END IF;
    ELSE
        -- Upsert by hash
        INSERT INTO claude_flow.vectors (embedding, metadata, namespace, collection, content, source, hash)
        VALUES (p_embedding, p_metadata, p_namespace, p_collection, p_content, p_source, v_hash)
        ON CONFLICT (namespace, collection, hash) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata,
            content = EXCLUDED.content,
            source = EXCLUDED.source,
            version = claude_flow.vectors.version + 1
        RETURNING id INTO v_id;
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Upsert embedding by namespace and name
CREATE OR REPLACE FUNCTION claude_flow.upsert_embedding(
    p_namespace TEXT,
    p_name TEXT,
    p_embedding vector,
    p_metadata JSONB DEFAULT '{}',
    p_model TEXT DEFAULT NULL,
    p_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_importance REAL DEFAULT 0.5
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO claude_flow.embeddings (namespace, name, embedding, dimensions, metadata, model, tags, importance)
    VALUES (p_namespace, p_name, p_embedding, array_length((p_embedding::real[]), 1), p_metadata, p_model, p_tags, p_importance)
    ON CONFLICT (namespace, name) DO UPDATE
    SET embedding = EXCLUDED.embedding,
        dimensions = EXCLUDED.dimensions,
        metadata = EXCLUDED.metadata,
        model = EXCLUDED.model,
        tags = EXCLUDED.tags,
        importance = EXCLUDED.importance
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Search Functions
-- ----------------------------------------------------------------------------

-- K-nearest neighbors search with filters
CREATE OR REPLACE FUNCTION claude_flow.knn_search(
    p_query vector,
    p_k INTEGER DEFAULT 10,
    p_namespace TEXT DEFAULT NULL,
    p_collection TEXT DEFAULT NULL,
    p_metric TEXT DEFAULT 'cosine',
    p_threshold REAL DEFAULT NULL,
    p_metadata_filter JSONB DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    embedding vector,
    metadata JSONB,
    content TEXT,
    distance REAL,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id,
        v.embedding,
        v.metadata,
        v.content,
        CASE p_metric
            WHEN 'cosine' THEN v.embedding <=> p_query
            WHEN 'euclidean' THEN v.embedding <-> p_query
            WHEN 'dot' THEN v.embedding <#> p_query
            ELSE v.embedding <=> p_query
        END AS distance,
        CASE p_metric
            WHEN 'cosine' THEN 1.0 - (v.embedding <=> p_query)
            WHEN 'euclidean' THEN 1.0 / (1.0 + (v.embedding <-> p_query))
            WHEN 'dot' THEN -(v.embedding <#> p_query)
            ELSE 1.0 - (v.embedding <=> p_query)
        END AS similarity
    FROM claude_flow.vectors v
    WHERE (p_namespace IS NULL OR v.namespace = p_namespace)
      AND (p_collection IS NULL OR v.collection = p_collection)
      AND (p_metadata_filter IS NULL OR v.metadata @> p_metadata_filter)
      AND (v.expires_at IS NULL OR v.expires_at > NOW())
      AND (p_threshold IS NULL OR
           CASE p_metric
               WHEN 'cosine' THEN (v.embedding <=> p_query) <= p_threshold
               WHEN 'euclidean' THEN (v.embedding <-> p_query) <= p_threshold
               WHEN 'dot' THEN -(v.embedding <#> p_query) >= p_threshold
               ELSE TRUE
           END)
    ORDER BY
        CASE p_metric
            WHEN 'cosine' THEN v.embedding <=> p_query
            WHEN 'euclidean' THEN v.embedding <-> p_query
            WHEN 'dot' THEN v.embedding <#> p_query
            ELSE v.embedding <=> p_query
        END
    LIMIT p_k;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Cleanup Functions
-- ----------------------------------------------------------------------------

-- Delete expired vectors
CREATE OR REPLACE FUNCTION claude_flow.cleanup_expired_vectors()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM claude_flow.vectors
    WHERE expires_at IS NOT NULL AND expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old cache entries
CREATE OR REPLACE FUNCTION claude_flow.cleanup_caches(
    p_max_age_hours INTEGER DEFAULT 24
) RETURNS TABLE (
    attention_deleted INTEGER,
    gnn_deleted INTEGER
) AS $$
DECLARE
    v_attention_deleted INTEGER;
    v_gnn_deleted INTEGER;
BEGIN
    -- Cleanup attention cache
    DELETE FROM claude_flow.attention_cache
    WHERE (expires_at IS NOT NULL AND expires_at < NOW())
       OR (last_accessed_at < NOW() - (p_max_age_hours || ' hours')::INTERVAL);
    GET DIAGNOSTICS v_attention_deleted = ROW_COUNT;

    -- Cleanup GNN cache
    DELETE FROM claude_flow.gnn_cache
    WHERE (expires_at IS NOT NULL AND expires_at < NOW())
       OR (last_accessed_at < NOW() - (p_max_age_hours || ' hours')::INTERVAL);
    GET DIAGNOSTICS v_gnn_deleted = ROW_COUNT;

    attention_deleted := v_attention_deleted;
    gnn_deleted := v_gnn_deleted;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Statistics Functions
-- ----------------------------------------------------------------------------

-- Get collection statistics
CREATE OR REPLACE FUNCTION claude_flow.get_collection_stats(
    p_collection_name TEXT DEFAULT NULL
) RETURNS TABLE (
    collection_name TEXT,
    namespace TEXT,
    vector_count BIGINT,
    avg_embedding_size REAL,
    total_size_mb REAL,
    oldest_entry TIMESTAMPTZ,
    newest_entry TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.name AS collection_name,
        c.namespace,
        COUNT(v.id) AS vector_count,
        AVG(array_length((v.embedding::real[]), 1))::REAL AS avg_embedding_size,
        (pg_total_relation_size('claude_flow.vectors') / 1024.0 / 1024.0)::REAL AS total_size_mb,
        MIN(v.created_at) AS oldest_entry,
        MAX(v.created_at) AS newest_entry
    FROM claude_flow.collections c
    LEFT JOIN claude_flow.vectors v ON v.collection = c.name AND v.namespace = c.namespace
    WHERE p_collection_name IS NULL OR c.name = p_collection_name
    GROUP BY c.name, c.namespace;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Record migration
-- ----------------------------------------------------------------------------
INSERT INTO claude_flow.migrations (name, checksum)
VALUES ('004_create_functions', md5('004_create_functions'))
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Rollback Script
-- ============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS claude_flow.get_collection_stats(TEXT);
-- DROP FUNCTION IF EXISTS claude_flow.cleanup_caches(INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.cleanup_expired_vectors();
-- DROP FUNCTION IF EXISTS claude_flow.knn_search(vector, INTEGER, TEXT, TEXT, TEXT, REAL, JSONB);
-- DROP FUNCTION IF EXISTS claude_flow.upsert_embedding(TEXT, TEXT, vector, JSONB, TEXT, TEXT[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.upsert_vector(vector, JSONB, TEXT, TEXT, TEXT, TEXT, UUID);
-- DROP FUNCTION IF EXISTS claude_flow.batch_insert_vectors(JSONB);
-- DROP FUNCTION IF EXISTS claude_flow.dot_product(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.vector_scale(REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.vector_subtract(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.vector_add(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.vector_magnitude(REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.l2_normalize(REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.minkowski_distance(REAL[], REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.chebyshev_distance(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.manhattan_distance(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.inner_product(vector, vector);
-- DROP FUNCTION IF EXISTS claude_flow.euclidean_distance(vector, vector);
-- DROP FUNCTION IF EXISTS claude_flow.cosine_similarity(vector, vector);
-- DROP FUNCTION IF EXISTS claude_flow.cosine_distance(vector, vector);
-- DELETE FROM claude_flow.migrations WHERE name = '004_create_functions';
-- COMMIT;
