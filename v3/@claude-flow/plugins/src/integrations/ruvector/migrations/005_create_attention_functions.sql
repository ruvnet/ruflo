-- ============================================================================
-- Migration 005: Create Attention Mechanism Functions
-- RuVector PostgreSQL Bridge - Claude Flow V3
--
-- Creates SQL functions for attention mechanisms including multi-head attention,
-- flash attention, and sparse attention patterns.
-- Compatible with PostgreSQL 14+ and pgvector 0.5+
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Softmax Function (used by attention mechanisms)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.softmax(
    scores REAL[]
) RETURNS REAL[] AS $$
DECLARE
    max_score REAL;
    sum_exp REAL := 0;
    i INTEGER;
    result REAL[];
BEGIN
    -- Find max for numerical stability
    max_score := scores[1];
    FOR i IN 2..array_length(scores, 1) LOOP
        IF scores[i] > max_score THEN
            max_score := scores[i];
        END IF;
    END LOOP;

    -- Compute sum of exponentials
    FOR i IN 1..array_length(scores, 1) LOOP
        sum_exp := sum_exp + exp(scores[i] - max_score);
    END LOOP;

    -- Compute softmax
    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(scores, 1) LOOP
        result := array_append(result, exp(scores[i] - max_score) / sum_exp);
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Scaled Dot-Product Attention
-- attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) * V
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.scaled_dot_product_attention(
    query REAL[],      -- Query vector [d_k]
    keys REAL[][],     -- Key matrix [seq_len, d_k]
    values REAL[][],   -- Value matrix [seq_len, d_v]
    scale REAL DEFAULT NULL  -- Optional scaling factor (default: 1/sqrt(d_k))
) RETURNS REAL[] AS $$
DECLARE
    d_k INTEGER;
    seq_len INTEGER;
    scores REAL[];
    attention_weights REAL[];
    output REAL[];
    i INTEGER;
    j INTEGER;
    score REAL;
    v_scale REAL;
BEGIN
    -- Get dimensions
    d_k := array_length(query, 1);
    seq_len := array_length(keys, 1);

    -- Calculate scaling factor
    v_scale := COALESCE(scale, 1.0 / sqrt(d_k::REAL));

    -- Compute attention scores: Q * K^T
    scores := ARRAY[]::REAL[];
    FOR i IN 1..seq_len LOOP
        score := 0;
        FOR j IN 1..d_k LOOP
            score := score + query[j] * keys[i][j];
        END LOOP;
        scores := array_append(scores, score * v_scale);
    END LOOP;

    -- Apply softmax
    attention_weights := claude_flow.softmax(scores);

    -- Compute weighted sum of values
    output := ARRAY[]::REAL[];
    FOR j IN 1..array_length(values[1], 1) LOOP
        score := 0;
        FOR i IN 1..seq_len LOOP
            score := score + attention_weights[i] * values[i][j];
        END LOOP;
        output := array_append(output, score);
    END LOOP;

    RETURN output;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Multi-Head Attention
-- MultiHead(Q, K, V) = Concat(head_1, ..., head_h) * W_O
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.multi_head_attention(
    query REAL[],        -- Query vector [d_model]
    keys REAL[][],       -- Key matrix [seq_len, d_model]
    values REAL[][],     -- Value matrix [seq_len, d_model]
    num_heads INTEGER DEFAULT 8
) RETURNS TABLE (
    output REAL[],
    attention_weights REAL[][]
) AS $$
DECLARE
    d_model INTEGER;
    d_k INTEGER;
    seq_len INTEGER;
    head_outputs REAL[][];
    head_weights REAL[][];
    h INTEGER;
    i INTEGER;
    j INTEGER;
    start_idx INTEGER;
    head_query REAL[];
    head_keys REAL[][];
    head_values REAL[][];
    head_output REAL[];
    concat_output REAL[];
BEGIN
    -- Get dimensions
    d_model := array_length(query, 1);
    seq_len := array_length(keys, 1);

    -- Validate dimensions
    IF d_model % num_heads != 0 THEN
        RAISE EXCEPTION 'd_model (%) must be divisible by num_heads (%)', d_model, num_heads;
    END IF;

    d_k := d_model / num_heads;

    -- Initialize outputs
    head_outputs := ARRAY[]::REAL[][];
    head_weights := ARRAY[]::REAL[][];

    -- Process each head
    FOR h IN 1..num_heads LOOP
        start_idx := (h - 1) * d_k + 1;

        -- Extract head-specific query
        head_query := ARRAY[]::REAL[];
        FOR i IN start_idx..(start_idx + d_k - 1) LOOP
            head_query := array_append(head_query, query[i]);
        END LOOP;

        -- Extract head-specific keys and values
        head_keys := ARRAY[]::REAL[][];
        head_values := ARRAY[]::REAL[][];
        FOR i IN 1..seq_len LOOP
            DECLARE
                k_row REAL[] := ARRAY[]::REAL[];
                v_row REAL[] := ARRAY[]::REAL[];
            BEGIN
                FOR j IN start_idx..(start_idx + d_k - 1) LOOP
                    k_row := array_append(k_row, keys[i][j]);
                    v_row := array_append(v_row, values[i][j]);
                END LOOP;
                head_keys := array_cat(head_keys, ARRAY[k_row]);
                head_values := array_cat(head_values, ARRAY[v_row]);
            END;
        END LOOP;

        -- Compute attention for this head
        head_output := claude_flow.scaled_dot_product_attention(head_query, head_keys, head_values);
        head_outputs := array_cat(head_outputs, ARRAY[head_output]);
    END LOOP;

    -- Concatenate head outputs
    concat_output := ARRAY[]::REAL[];
    FOR h IN 1..num_heads LOOP
        FOR i IN 1..d_k LOOP
            concat_output := array_append(concat_output, head_outputs[h][i]);
        END LOOP;
    END LOOP;

    output := concat_output;
    attention_weights := head_weights;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Flash Attention (Memory-Efficient Approximation)
-- Processes attention in blocks to reduce memory usage
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.flash_attention(
    query REAL[],        -- Query vector
    keys REAL[][],       -- Key matrix
    values REAL[][],     -- Value matrix
    block_size INTEGER DEFAULT 64  -- Block size for chunked processing
) RETURNS TABLE (
    output REAL[],
    max_attention REAL,
    computation_blocks INTEGER
) AS $$
DECLARE
    d_k INTEGER;
    seq_len INTEGER;
    num_blocks INTEGER;
    block_start INTEGER;
    block_end INTEGER;
    block_scores REAL[];
    block_max REAL;
    global_max REAL := -1e9;
    running_sum REAL[];
    running_max REAL := -1e9;
    i INTEGER;
    j INTEGER;
    b INTEGER;
    score REAL;
    scale REAL;
    block_keys REAL[][];
    block_values REAL[][];
    block_output REAL[];
    final_output REAL[];
BEGIN
    -- Get dimensions
    d_k := array_length(query, 1);
    seq_len := array_length(keys, 1);
    scale := 1.0 / sqrt(d_k::REAL);

    -- Calculate number of blocks
    num_blocks := ceil(seq_len::REAL / block_size)::INTEGER;

    -- Initialize running sum
    running_sum := ARRAY[]::REAL[];
    FOR i IN 1..array_length(values[1], 1) LOOP
        running_sum := array_append(running_sum, 0.0);
    END LOOP;

    -- Process blocks
    FOR b IN 1..num_blocks LOOP
        block_start := (b - 1) * block_size + 1;
        block_end := LEAST(b * block_size, seq_len);

        -- Compute block scores
        block_scores := ARRAY[]::REAL[];
        FOR i IN block_start..block_end LOOP
            score := 0;
            FOR j IN 1..d_k LOOP
                score := score + query[j] * keys[i][j];
            END LOOP;
            block_scores := array_append(block_scores, score * scale);
        END LOOP;

        -- Find block max for numerical stability
        block_max := block_scores[1];
        FOR i IN 2..array_length(block_scores, 1) LOOP
            IF block_scores[i] > block_max THEN
                block_max := block_scores[i];
            END IF;
        END LOOP;

        IF block_max > global_max THEN
            global_max := block_max;
        END IF;

        -- Apply softmax and accumulate
        DECLARE
            exp_scores REAL[] := ARRAY[]::REAL[];
            exp_sum REAL := 0;
        BEGIN
            FOR i IN 1..array_length(block_scores, 1) LOOP
                score := exp(block_scores[i] - block_max);
                exp_scores := array_append(exp_scores, score);
                exp_sum := exp_sum + score;
            END LOOP;

            -- Weighted sum of values in this block
            FOR j IN 1..array_length(values[1], 1) LOOP
                score := 0;
                FOR i IN 1..array_length(exp_scores, 1) LOOP
                    score := score + (exp_scores[i] / exp_sum) * values[block_start + i - 1][j];
                END LOOP;
                running_sum[j] := running_sum[j] + score / num_blocks;
            END LOOP;
        END;
    END LOOP;

    output := running_sum;
    max_attention := global_max;
    computation_blocks := num_blocks;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Sparse Attention (with configurable patterns)
-- Supports: local, strided, fixed, and custom patterns
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.sparse_attention(
    query REAL[],        -- Query vector
    keys REAL[][],       -- Key matrix
    values REAL[][],     -- Value matrix
    pattern TEXT DEFAULT 'local',  -- Attention pattern: local, strided, fixed
    window_size INTEGER DEFAULT 64,  -- For local attention
    stride INTEGER DEFAULT 32  -- For strided attention
) RETURNS TABLE (
    output REAL[],
    active_positions INTEGER[],
    sparsity_ratio REAL
) AS $$
DECLARE
    d_k INTEGER;
    seq_len INTEGER;
    scale REAL;
    active_indices INTEGER[];
    scores REAL[];
    attention_weights REAL[];
    final_output REAL[];
    i INTEGER;
    j INTEGER;
    score REAL;
    total_active INTEGER;
BEGIN
    -- Get dimensions
    d_k := array_length(query, 1);
    seq_len := array_length(keys, 1);
    scale := 1.0 / sqrt(d_k::REAL);

    -- Determine active positions based on pattern
    active_indices := ARRAY[]::INTEGER[];

    CASE pattern
        WHEN 'local' THEN
            -- Local attention: attend to nearby positions
            FOR i IN 1..seq_len LOOP
                IF i <= window_size THEN
                    active_indices := array_append(active_indices, i);
                END IF;
            END LOOP;

        WHEN 'strided' THEN
            -- Strided attention: attend to every Nth position
            FOR i IN 1..seq_len LOOP
                IF (i - 1) % stride = 0 THEN
                    active_indices := array_append(active_indices, i);
                END IF;
            END LOOP;

        WHEN 'fixed' THEN
            -- Fixed attention: attend to first window_size and strided positions
            FOR i IN 1..seq_len LOOP
                IF i <= window_size OR (i - 1) % stride = 0 THEN
                    active_indices := array_append(active_indices, i);
                END IF;
            END LOOP;

        ELSE
            -- Default: attend to all (dense)
            FOR i IN 1..seq_len LOOP
                active_indices := array_append(active_indices, i);
            END LOOP;
    END CASE;

    total_active := array_length(active_indices, 1);

    -- Compute attention scores for active positions only
    scores := ARRAY[]::REAL[];
    FOR i IN 1..total_active LOOP
        score := 0;
        FOR j IN 1..d_k LOOP
            score := score + query[j] * keys[active_indices[i]][j];
        END LOOP;
        scores := array_append(scores, score * scale);
    END LOOP;

    -- Apply softmax
    attention_weights := claude_flow.softmax(scores);

    -- Compute weighted sum
    final_output := ARRAY[]::REAL[];
    FOR j IN 1..array_length(values[1], 1) LOOP
        score := 0;
        FOR i IN 1..total_active LOOP
            score := score + attention_weights[i] * values[active_indices[i]][j];
        END LOOP;
        final_output := array_append(final_output, score);
    END LOOP;

    output := final_output;
    active_positions := active_indices;
    sparsity_ratio := 1.0 - (total_active::REAL / seq_len::REAL);
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Linear Attention (O(n) complexity approximation)
-- Uses kernel approximation for efficient attention
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.linear_attention(
    query REAL[],        -- Query vector
    keys REAL[][],       -- Key matrix
    values REAL[][],     -- Value matrix
    feature_map TEXT DEFAULT 'elu'  -- Feature map: elu, relu, softmax
) RETURNS REAL[] AS $$
DECLARE
    d_k INTEGER;
    seq_len INTEGER;
    phi_q REAL[];
    phi_k REAL[][];
    kv_sum REAL[];
    k_sum REAL;
    output REAL[];
    i INTEGER;
    j INTEGER;
    val REAL;
BEGIN
    -- Get dimensions
    d_k := array_length(query, 1);
    seq_len := array_length(keys, 1);

    -- Apply feature map to query
    phi_q := ARRAY[]::REAL[];
    FOR i IN 1..d_k LOOP
        CASE feature_map
            WHEN 'elu' THEN
                IF query[i] >= 0 THEN
                    phi_q := array_append(phi_q, query[i] + 1.0);
                ELSE
                    phi_q := array_append(phi_q, exp(query[i]));
                END IF;
            WHEN 'relu' THEN
                phi_q := array_append(phi_q, GREATEST(0, query[i]));
            ELSE
                phi_q := array_append(phi_q, exp(query[i]));
        END CASE;
    END LOOP;

    -- Apply feature map to keys and compute cumulative sums
    kv_sum := ARRAY[]::REAL[];
    FOR j IN 1..array_length(values[1], 1) LOOP
        kv_sum := array_append(kv_sum, 0.0);
    END LOOP;
    k_sum := 0;

    FOR i IN 1..seq_len LOOP
        DECLARE
            phi_ki REAL[];
            ki_dot REAL := 0;
        BEGIN
            -- Apply feature map to key
            phi_ki := ARRAY[]::REAL[];
            FOR j IN 1..d_k LOOP
                CASE feature_map
                    WHEN 'elu' THEN
                        IF keys[i][j] >= 0 THEN
                            val := keys[i][j] + 1.0;
                        ELSE
                            val := exp(keys[i][j]);
                        END IF;
                    WHEN 'relu' THEN
                        val := GREATEST(0, keys[i][j]);
                    ELSE
                        val := exp(keys[i][j]);
                END CASE;
                phi_ki := array_append(phi_ki, val);
                ki_dot := ki_dot + phi_q[j] * val;
            END LOOP;

            -- Accumulate
            k_sum := k_sum + ki_dot;
            FOR j IN 1..array_length(values[1], 1) LOOP
                kv_sum[j] := kv_sum[j] + ki_dot * values[i][j];
            END LOOP;
        END;
    END LOOP;

    -- Normalize
    IF k_sum > 0 THEN
        output := ARRAY[]::REAL[];
        FOR j IN 1..array_length(kv_sum, 1) LOOP
            output := array_append(output, kv_sum[j] / k_sum);
        END LOOP;
    ELSE
        output := kv_sum;
    END IF;

    RETURN output;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Cross Attention (for encoder-decoder architectures)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.cross_attention(
    decoder_query REAL[],    -- Query from decoder
    encoder_keys REAL[][],   -- Keys from encoder
    encoder_values REAL[][], -- Values from encoder
    num_heads INTEGER DEFAULT 8
) RETURNS REAL[] AS $$
DECLARE
    result RECORD;
BEGIN
    SELECT * INTO result FROM claude_flow.multi_head_attention(
        decoder_query,
        encoder_keys,
        encoder_values,
        num_heads
    );

    RETURN result.output;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Attention Cache Management
-- ----------------------------------------------------------------------------

-- Store attention result in cache
CREATE OR REPLACE FUNCTION claude_flow.cache_attention_result(
    p_query_hash TEXT,
    p_keys_hash TEXT,
    p_values_hash TEXT,
    p_num_heads INTEGER,
    p_attention_type TEXT,
    p_attention_weights REAL[],
    p_attention_output REAL[],
    p_output_dimensions INTEGER[],
    p_computation_time_ms REAL DEFAULT NULL,
    p_ttl_hours INTEGER DEFAULT 24
) RETURNS UUID AS $$
DECLARE
    v_cache_key TEXT;
    v_id UUID;
BEGIN
    v_cache_key := md5(p_query_hash || p_keys_hash || p_values_hash || p_num_heads::TEXT || p_attention_type);

    INSERT INTO claude_flow.attention_cache (
        cache_key,
        query_hash,
        keys_hash,
        values_hash,
        num_heads,
        attention_type,
        attention_weights,
        attention_output,
        output_dimensions,
        computation_time_ms,
        expires_at
    ) VALUES (
        v_cache_key,
        p_query_hash,
        p_keys_hash,
        p_values_hash,
        p_num_heads,
        p_attention_type,
        p_attention_weights,
        p_attention_output,
        p_output_dimensions,
        p_computation_time_ms,
        NOW() + (p_ttl_hours || ' hours')::INTERVAL
    )
    ON CONFLICT (cache_key) DO UPDATE
    SET attention_weights = EXCLUDED.attention_weights,
        attention_output = EXCLUDED.attention_output,
        hit_count = claude_flow.attention_cache.hit_count + 1,
        last_accessed_at = NOW(),
        expires_at = EXCLUDED.expires_at
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Retrieve cached attention result
CREATE OR REPLACE FUNCTION claude_flow.get_cached_attention(
    p_query_hash TEXT,
    p_keys_hash TEXT,
    p_values_hash TEXT,
    p_num_heads INTEGER,
    p_attention_type TEXT
) RETURNS TABLE (
    attention_weights REAL[],
    attention_output REAL[],
    output_dimensions INTEGER[],
    cache_hit BOOLEAN
) AS $$
DECLARE
    v_cache_key TEXT;
    v_record RECORD;
BEGIN
    v_cache_key := md5(p_query_hash || p_keys_hash || p_values_hash || p_num_heads::TEXT || p_attention_type);

    SELECT ac.attention_weights, ac.attention_output, ac.output_dimensions
    INTO v_record
    FROM claude_flow.attention_cache ac
    WHERE ac.cache_key = v_cache_key
      AND (ac.expires_at IS NULL OR ac.expires_at > NOW());

    IF FOUND THEN
        -- Update access stats
        UPDATE claude_flow.attention_cache
        SET hit_count = hit_count + 1,
            last_accessed_at = NOW()
        WHERE cache_key = v_cache_key;

        attention_weights := v_record.attention_weights;
        attention_output := v_record.attention_output;
        output_dimensions := v_record.output_dimensions;
        cache_hit := TRUE;
    ELSE
        attention_weights := NULL;
        attention_output := NULL;
        output_dimensions := NULL;
        cache_hit := FALSE;
    END IF;

    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Record migration
-- ----------------------------------------------------------------------------
INSERT INTO claude_flow.migrations (name, checksum)
VALUES ('005_create_attention_functions', md5('005_create_attention_functions'))
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Rollback Script
-- ============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS claude_flow.get_cached_attention(TEXT, TEXT, TEXT, INTEGER, TEXT);
-- DROP FUNCTION IF EXISTS claude_flow.cache_attention_result(TEXT, TEXT, TEXT, INTEGER, TEXT, REAL[], REAL[], INTEGER[], REAL, INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.cross_attention(REAL[], REAL[][], REAL[][], INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.linear_attention(REAL[], REAL[][], REAL[][], TEXT);
-- DROP FUNCTION IF EXISTS claude_flow.sparse_attention(REAL[], REAL[][], REAL[][], TEXT, INTEGER, INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.flash_attention(REAL[], REAL[][], REAL[][], INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.multi_head_attention(REAL[], REAL[][], REAL[][], INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.scaled_dot_product_attention(REAL[], REAL[][], REAL[][], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.softmax(REAL[]);
-- DELETE FROM claude_flow.migrations WHERE name = '005_create_attention_functions';
-- COMMIT;
