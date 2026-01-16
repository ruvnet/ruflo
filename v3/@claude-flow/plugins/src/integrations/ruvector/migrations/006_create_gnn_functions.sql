-- ============================================================================
-- Migration 006: Create Graph Neural Network Functions
-- RuVector PostgreSQL Bridge - Claude Flow V3
--
-- Creates SQL functions for GNN operations including GCN, GAT, and GraphSAGE
-- layer implementations.
-- Compatible with PostgreSQL 14+ and pgvector 0.5+
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Helper: ReLU Activation
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.relu(
    x REAL[]
) RETURNS REAL[] AS $$
DECLARE
    result REAL[];
    i INTEGER;
BEGIN
    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(x, 1) LOOP
        result := array_append(result, GREATEST(0, x[i]));
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Helper: LeakyReLU Activation
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.leaky_relu(
    x REAL[],
    negative_slope REAL DEFAULT 0.2
) RETURNS REAL[] AS $$
DECLARE
    result REAL[];
    i INTEGER;
BEGIN
    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(x, 1) LOOP
        IF x[i] >= 0 THEN
            result := array_append(result, x[i]);
        ELSE
            result := array_append(result, negative_slope * x[i]);
        END IF;
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Helper: Matrix-Vector Multiplication
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.matmul(
    matrix REAL[][],
    vec REAL[]
) RETURNS REAL[] AS $$
DECLARE
    result REAL[];
    rows INTEGER;
    cols INTEGER;
    i INTEGER;
    j INTEGER;
    sum_val REAL;
BEGIN
    rows := array_length(matrix, 1);
    cols := array_length(matrix[1], 1);

    IF cols != array_length(vec, 1) THEN
        RAISE EXCEPTION 'Dimension mismatch: matrix cols (%) != vector length (%)', cols, array_length(vec, 1);
    END IF;

    result := ARRAY[]::REAL[];
    FOR i IN 1..rows LOOP
        sum_val := 0;
        FOR j IN 1..cols LOOP
            sum_val := sum_val + matrix[i][j] * vec[j];
        END LOOP;
        result := array_append(result, sum_val);
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- GCN Layer (Graph Convolutional Network)
-- H' = σ(D^(-1/2) * A * D^(-1/2) * H * W)
-- Simplified: H' = σ(Σ_j (1/sqrt(d_i * d_j)) * h_j * W)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.gcn_layer(
    nodes REAL[][],       -- Node feature matrix [num_nodes, in_features]
    edges INTEGER[][],    -- Edge list [[src, dst], ...] (0-indexed)
    weights REAL[][]      -- Weight matrix [in_features, out_features]
) RETURNS TABLE (
    output_features REAL[][],
    node_degrees INTEGER[]
) AS $$
DECLARE
    num_nodes INTEGER;
    in_features INTEGER;
    out_features INTEGER;
    degrees INTEGER[];
    aggregated REAL[][];
    transformed REAL[][];
    i INTEGER;
    j INTEGER;
    src INTEGER;
    dst INTEGER;
    neighbor_sum REAL[];
    d_i REAL;
    d_j REAL;
    norm_factor REAL;
BEGIN
    -- Get dimensions
    num_nodes := array_length(nodes, 1);
    in_features := array_length(nodes[1], 1);
    out_features := array_length(weights[1], 1);

    -- Calculate node degrees
    degrees := ARRAY[]::INTEGER[];
    FOR i IN 1..num_nodes LOOP
        degrees := array_append(degrees, 1);  -- Self-loop
    END LOOP;

    FOR i IN 1..array_length(edges, 1) LOOP
        src := edges[i][1] + 1;  -- Convert 0-indexed to 1-indexed
        dst := edges[i][2] + 1;
        IF src >= 1 AND src <= num_nodes THEN
            degrees[src] := degrees[src] + 1;
        END IF;
        IF dst >= 1 AND dst <= num_nodes AND src != dst THEN
            degrees[dst] := degrees[dst] + 1;
        END IF;
    END LOOP;

    -- Aggregate neighbor features with symmetric normalization
    aggregated := ARRAY[]::REAL[][];
    FOR i IN 1..num_nodes LOOP
        -- Initialize with self-feature (self-loop)
        neighbor_sum := ARRAY[]::REAL[];
        d_i := sqrt(degrees[i]::REAL);

        FOR j IN 1..in_features LOOP
            neighbor_sum := array_append(neighbor_sum, nodes[i][j] / d_i);  -- Self contribution
        END LOOP;

        aggregated := array_cat(aggregated, ARRAY[neighbor_sum]);
    END LOOP;

    -- Add neighbor contributions
    FOR i IN 1..array_length(edges, 1) LOOP
        src := edges[i][1] + 1;
        dst := edges[i][2] + 1;

        IF src >= 1 AND src <= num_nodes AND dst >= 1 AND dst <= num_nodes THEN
            d_i := sqrt(degrees[dst]::REAL);
            d_j := sqrt(degrees[src]::REAL);
            norm_factor := 1.0 / (d_i * d_j);

            FOR j IN 1..in_features LOOP
                aggregated[dst][j] := aggregated[dst][j] + norm_factor * nodes[src][j];
            END LOOP;
        END IF;
    END LOOP;

    -- Apply weights and activation
    transformed := ARRAY[]::REAL[][];
    FOR i IN 1..num_nodes LOOP
        DECLARE
            node_output REAL[];
        BEGIN
            node_output := claude_flow.matmul(weights, aggregated[i]);
            node_output := claude_flow.relu(node_output);
            transformed := array_cat(transformed, ARRAY[node_output]);
        END;
    END LOOP;

    output_features := transformed;
    node_degrees := degrees;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- GAT Layer (Graph Attention Network)
-- Attention coefficients: α_ij = softmax_j(LeakyReLU(a^T [W*h_i || W*h_j]))
-- H' = σ(Σ_j α_ij * W * h_j)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.gat_layer(
    nodes REAL[][],         -- Node feature matrix [num_nodes, in_features]
    edges INTEGER[][],      -- Edge list [[src, dst], ...] (0-indexed)
    num_heads INTEGER DEFAULT 4,
    attention_dim INTEGER DEFAULT 8
) RETURNS TABLE (
    output_features REAL[][],
    attention_coefficients REAL[][]
) AS $$
DECLARE
    num_nodes INTEGER;
    in_features INTEGER;
    out_features INTEGER;
    head_outputs REAL[][][];
    all_attention REAL[][];
    h INTEGER;
    i INTEGER;
    j INTEGER;
    src INTEGER;
    dst INTEGER;
    edge_idx INTEGER;
    attention_scores REAL[];
    attention_weights REAL[];
    neighbor_indices INTEGER[];
    weighted_sum REAL[];
    final_output REAL[][];
BEGIN
    -- Get dimensions
    num_nodes := array_length(nodes, 1);
    in_features := array_length(nodes[1], 1);
    out_features := attention_dim * num_heads;

    -- Initialize outputs
    head_outputs := ARRAY[]::REAL[][][];
    all_attention := ARRAY[]::REAL[][];

    -- Build adjacency list
    DECLARE
        adj_list INTEGER[][];
    BEGIN
        adj_list := ARRAY[]::INTEGER[][];
        FOR i IN 1..num_nodes LOOP
            adj_list := array_cat(adj_list, ARRAY[ARRAY[i]::INTEGER[]]);  -- Self-loop
        END LOOP;

        FOR edge_idx IN 1..array_length(edges, 1) LOOP
            src := edges[edge_idx][1] + 1;
            dst := edges[edge_idx][2] + 1;
            IF dst >= 1 AND dst <= num_nodes AND src >= 1 AND src <= num_nodes THEN
                adj_list[dst] := array_append(adj_list[dst], src);
            END IF;
        END LOOP;

        -- Process each attention head
        FOR h IN 1..num_heads LOOP
            DECLARE
                head_result REAL[][];
            BEGIN
                head_result := ARRAY[]::REAL[][];

                FOR i IN 1..num_nodes LOOP
                    neighbor_indices := adj_list[i];

                    -- Compute attention scores
                    attention_scores := ARRAY[]::REAL[];
                    FOR j IN 1..array_length(neighbor_indices, 1) LOOP
                        DECLARE
                            neighbor_idx INTEGER := neighbor_indices[j];
                            score REAL := 0;
                            k INTEGER;
                        BEGIN
                            -- Simple dot-product attention
                            FOR k IN 1..LEAST(in_features, attention_dim) LOOP
                                score := score + nodes[i][k] * nodes[neighbor_idx][k];
                            END LOOP;
                            score := score / sqrt(attention_dim::REAL);
                            attention_scores := array_append(attention_scores, score);
                        END;
                    END LOOP;

                    -- Apply LeakyReLU and softmax
                    attention_scores := claude_flow.leaky_relu(attention_scores, 0.2);
                    attention_weights := claude_flow.softmax(attention_scores);

                    -- Store attention for debugging
                    all_attention := array_cat(all_attention, ARRAY[attention_weights]);

                    -- Compute weighted sum of neighbor features
                    weighted_sum := ARRAY[]::REAL[];
                    FOR j IN 1..LEAST(in_features, attention_dim) LOOP
                        DECLARE
                            sum_val REAL := 0;
                            k INTEGER;
                        BEGIN
                            FOR k IN 1..array_length(neighbor_indices, 1) LOOP
                                sum_val := sum_val + attention_weights[k] * nodes[neighbor_indices[k]][j];
                            END LOOP;
                            weighted_sum := array_append(weighted_sum, sum_val);
                        END;
                    END LOOP;

                    -- Apply activation
                    weighted_sum := claude_flow.relu(weighted_sum);
                    head_result := array_cat(head_result, ARRAY[weighted_sum]);
                END LOOP;

                head_outputs := array_cat(head_outputs, ARRAY[head_result]);
            END;
        END LOOP;

        -- Concatenate head outputs
        final_output := ARRAY[]::REAL[][];
        FOR i IN 1..num_nodes LOOP
            DECLARE
                concat_features REAL[] := ARRAY[]::REAL[];
            BEGIN
                FOR h IN 1..num_heads LOOP
                    FOR j IN 1..array_length(head_outputs[h][i], 1) LOOP
                        concat_features := array_append(concat_features, head_outputs[h][i][j]);
                    END LOOP;
                END LOOP;
                final_output := array_cat(final_output, ARRAY[concat_features]);
            END;
        END LOOP;

        output_features := final_output;
        attention_coefficients := all_attention;
        RETURN NEXT;
    END;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- GraphSAGE Layer
-- h_v = σ(W * CONCAT(h_v, AGG({h_u : u ∈ N(v)})))
-- Aggregation: mean, max, or LSTM
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.graph_sage(
    nodes REAL[][],           -- Node feature matrix [num_nodes, in_features]
    edges INTEGER[][],        -- Edge list [[src, dst], ...] (0-indexed)
    aggregation TEXT DEFAULT 'mean'  -- Aggregation: mean, max, pool
) RETURNS TABLE (
    output_features REAL[][],
    sampled_neighbors INTEGER[][]
) AS $$
DECLARE
    num_nodes INTEGER;
    in_features INTEGER;
    adj_list INTEGER[][];
    aggregated REAL[][];
    final_output REAL[][];
    i INTEGER;
    j INTEGER;
    src INTEGER;
    dst INTEGER;
    edge_idx INTEGER;
    neighbors INTEGER[];
    neighbor_features REAL[][];
    agg_result REAL[];
BEGIN
    -- Get dimensions
    num_nodes := array_length(nodes, 1);
    in_features := array_length(nodes[1], 1);

    -- Build adjacency list
    adj_list := ARRAY[]::INTEGER[][];
    FOR i IN 1..num_nodes LOOP
        adj_list := array_cat(adj_list, ARRAY[ARRAY[]::INTEGER[]]);
    END LOOP;

    FOR edge_idx IN 1..array_length(edges, 1) LOOP
        src := edges[edge_idx][1] + 1;
        dst := edges[edge_idx][2] + 1;
        IF dst >= 1 AND dst <= num_nodes AND src >= 1 AND src <= num_nodes THEN
            adj_list[dst] := array_append(adj_list[dst], src);
        END IF;
    END LOOP;

    -- Aggregate neighbor features
    aggregated := ARRAY[]::REAL[][];

    FOR i IN 1..num_nodes LOOP
        neighbors := adj_list[i];

        IF array_length(neighbors, 1) IS NULL OR array_length(neighbors, 1) = 0 THEN
            -- No neighbors, use self
            aggregated := array_cat(aggregated, ARRAY[nodes[i]]);
        ELSE
            -- Collect neighbor features
            neighbor_features := ARRAY[]::REAL[][];
            FOR j IN 1..array_length(neighbors, 1) LOOP
                neighbor_features := array_cat(neighbor_features, ARRAY[nodes[neighbors[j]]]);
            END LOOP;

            -- Aggregate based on method
            agg_result := ARRAY[]::REAL[];

            CASE aggregation
                WHEN 'mean' THEN
                    FOR j IN 1..in_features LOOP
                        DECLARE
                            mean_val REAL := 0;
                            k INTEGER;
                        BEGIN
                            FOR k IN 1..array_length(neighbor_features, 1) LOOP
                                mean_val := mean_val + neighbor_features[k][j];
                            END LOOP;
                            agg_result := array_append(agg_result, mean_val / array_length(neighbor_features, 1));
                        END;
                    END LOOP;

                WHEN 'max' THEN
                    FOR j IN 1..in_features LOOP
                        DECLARE
                            max_val REAL := neighbor_features[1][j];
                            k INTEGER;
                        BEGIN
                            FOR k IN 2..array_length(neighbor_features, 1) LOOP
                                IF neighbor_features[k][j] > max_val THEN
                                    max_val := neighbor_features[k][j];
                                END IF;
                            END LOOP;
                            agg_result := array_append(agg_result, max_val);
                        END;
                    END LOOP;

                WHEN 'pool' THEN
                    -- Max-pooling after element-wise transformation
                    FOR j IN 1..in_features LOOP
                        DECLARE
                            max_val REAL := GREATEST(0, neighbor_features[1][j]);  -- ReLU
                            k INTEGER;
                        BEGIN
                            FOR k IN 2..array_length(neighbor_features, 1) LOOP
                                IF GREATEST(0, neighbor_features[k][j]) > max_val THEN
                                    max_val := GREATEST(0, neighbor_features[k][j]);
                                END IF;
                            END LOOP;
                            agg_result := array_append(agg_result, max_val);
                        END;
                    END LOOP;

                ELSE
                    -- Default to mean
                    FOR j IN 1..in_features LOOP
                        DECLARE
                            mean_val REAL := 0;
                            k INTEGER;
                        BEGIN
                            FOR k IN 1..array_length(neighbor_features, 1) LOOP
                                mean_val := mean_val + neighbor_features[k][j];
                            END LOOP;
                            agg_result := array_append(agg_result, mean_val / array_length(neighbor_features, 1));
                        END;
                    END LOOP;
            END CASE;

            aggregated := array_cat(aggregated, ARRAY[agg_result]);
        END IF;
    END LOOP;

    -- Concatenate self features with aggregated neighbor features and apply activation
    final_output := ARRAY[]::REAL[][];
    FOR i IN 1..num_nodes LOOP
        DECLARE
            concat_features REAL[];
        BEGIN
            -- Concatenate: [self || aggregated]
            concat_features := nodes[i] || aggregated[i];
            -- Apply ReLU activation
            concat_features := claude_flow.relu(concat_features);
            -- Normalize
            concat_features := claude_flow.l2_normalize(concat_features);
            final_output := array_cat(final_output, ARRAY[concat_features]);
        END;
    END LOOP;

    output_features := final_output;
    sampled_neighbors := adj_list;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Message Passing Neural Network (MPNN) - Generic Framework
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.mpnn_layer(
    nodes REAL[][],           -- Node features
    edges INTEGER[][],        -- Edge list
    edge_features REAL[][] DEFAULT NULL,  -- Optional edge features
    message_fn TEXT DEFAULT 'concat',     -- concat, add, mul
    aggregate_fn TEXT DEFAULT 'sum'       -- sum, mean, max
) RETURNS REAL[][] AS $$
DECLARE
    num_nodes INTEGER;
    in_features INTEGER;
    edge_dim INTEGER;
    messages REAL[][];
    aggregated REAL[][];
    i INTEGER;
    j INTEGER;
    src INTEGER;
    dst INTEGER;
    edge_idx INTEGER;
BEGIN
    num_nodes := array_length(nodes, 1);
    in_features := array_length(nodes[1], 1);

    IF edge_features IS NOT NULL THEN
        edge_dim := array_length(edge_features[1], 1);
    ELSE
        edge_dim := 0;
    END IF;

    -- Initialize aggregated features
    aggregated := ARRAY[]::REAL[][];
    FOR i IN 1..num_nodes LOOP
        DECLARE
            zero_features REAL[] := ARRAY[]::REAL[];
        BEGIN
            FOR j IN 1..in_features LOOP
                zero_features := array_append(zero_features, 0.0);
            END LOOP;
            aggregated := array_cat(aggregated, ARRAY[zero_features]);
        END;
    END LOOP;

    -- Compute and aggregate messages
    DECLARE
        neighbor_counts INTEGER[] := ARRAY[]::INTEGER[];
    BEGIN
        FOR i IN 1..num_nodes LOOP
            neighbor_counts := array_append(neighbor_counts, 0);
        END LOOP;

        FOR edge_idx IN 1..array_length(edges, 1) LOOP
            src := edges[edge_idx][1] + 1;
            dst := edges[edge_idx][2] + 1;

            IF src >= 1 AND src <= num_nodes AND dst >= 1 AND dst <= num_nodes THEN
                neighbor_counts[dst] := neighbor_counts[dst] + 1;

                -- Compute message
                DECLARE
                    message REAL[] := nodes[src];
                BEGIN
                    -- Apply message function
                    CASE message_fn
                        WHEN 'concat' THEN
                            IF edge_features IS NOT NULL THEN
                                message := message || edge_features[edge_idx];
                            END IF;
                        WHEN 'mul' THEN
                            IF edge_features IS NOT NULL THEN
                                FOR j IN 1..LEAST(in_features, edge_dim) LOOP
                                    message[j] := message[j] * edge_features[edge_idx][j];
                                END LOOP;
                            END IF;
                        ELSE
                            NULL;  -- Default: just use source features
                    END CASE;

                    -- Aggregate
                    FOR j IN 1..LEAST(array_length(message, 1), in_features) LOOP
                        CASE aggregate_fn
                            WHEN 'sum' THEN
                                aggregated[dst][j] := aggregated[dst][j] + message[j];
                            WHEN 'max' THEN
                                IF message[j] > aggregated[dst][j] THEN
                                    aggregated[dst][j] := message[j];
                                END IF;
                            ELSE  -- mean (accumulated, divide later)
                                aggregated[dst][j] := aggregated[dst][j] + message[j];
                        END CASE;
                    END LOOP;
                END;
            END IF;
        END LOOP;

        -- Finalize mean aggregation
        IF aggregate_fn = 'mean' THEN
            FOR i IN 1..num_nodes LOOP
                IF neighbor_counts[i] > 0 THEN
                    FOR j IN 1..in_features LOOP
                        aggregated[i][j] := aggregated[i][j] / neighbor_counts[i];
                    END LOOP;
                END IF;
            END LOOP;
        END IF;
    END;

    -- Update: combine self with aggregated
    FOR i IN 1..num_nodes LOOP
        FOR j IN 1..in_features LOOP
            aggregated[i][j] := aggregated[i][j] + nodes[i][j];
        END LOOP;
        aggregated[i] := claude_flow.relu(aggregated[i]);
    END LOOP;

    RETURN aggregated;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- GNN Cache Management
-- ----------------------------------------------------------------------------

-- Cache GNN layer output
CREATE OR REPLACE FUNCTION claude_flow.cache_gnn_result(
    p_graph_hash TEXT,
    p_layer_type TEXT,
    p_layer_index INTEGER,
    p_num_nodes INTEGER,
    p_num_edges INTEGER,
    p_node_features_dim INTEGER,
    p_node_embeddings REAL[],
    p_output_dim INTEGER,
    p_aggregation TEXT DEFAULT 'mean',
    p_num_heads INTEGER DEFAULT 1,
    p_ttl_hours INTEGER DEFAULT 24
) RETURNS UUID AS $$
DECLARE
    v_cache_key TEXT;
    v_id UUID;
BEGIN
    v_cache_key := md5(p_graph_hash || p_layer_type || p_layer_index::TEXT);

    INSERT INTO claude_flow.gnn_cache (
        cache_key,
        graph_hash,
        layer_type,
        layer_index,
        num_nodes,
        num_edges,
        node_features_dim,
        node_embeddings,
        output_dim,
        aggregation,
        num_heads,
        expires_at
    ) VALUES (
        v_cache_key,
        p_graph_hash,
        p_layer_type,
        p_layer_index,
        p_num_nodes,
        p_num_edges,
        p_node_features_dim,
        p_node_embeddings,
        p_output_dim,
        p_aggregation,
        p_num_heads,
        NOW() + (p_ttl_hours || ' hours')::INTERVAL
    )
    ON CONFLICT (cache_key) DO UPDATE
    SET node_embeddings = EXCLUDED.node_embeddings,
        hit_count = claude_flow.gnn_cache.hit_count + 1,
        last_accessed_at = NOW(),
        expires_at = EXCLUDED.expires_at
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Retrieve cached GNN result
CREATE OR REPLACE FUNCTION claude_flow.get_cached_gnn(
    p_graph_hash TEXT,
    p_layer_type TEXT,
    p_layer_index INTEGER
) RETURNS TABLE (
    node_embeddings REAL[],
    output_dim INTEGER,
    cache_hit BOOLEAN
) AS $$
DECLARE
    v_cache_key TEXT;
    v_record RECORD;
BEGIN
    v_cache_key := md5(p_graph_hash || p_layer_type || p_layer_index::TEXT);

    SELECT gc.node_embeddings, gc.output_dim
    INTO v_record
    FROM claude_flow.gnn_cache gc
    WHERE gc.cache_key = v_cache_key
      AND (gc.expires_at IS NULL OR gc.expires_at > NOW());

    IF FOUND THEN
        UPDATE claude_flow.gnn_cache
        SET hit_count = hit_count + 1,
            last_accessed_at = NOW()
        WHERE cache_key = v_cache_key;

        node_embeddings := v_record.node_embeddings;
        output_dim := v_record.output_dim;
        cache_hit := TRUE;
    ELSE
        node_embeddings := NULL;
        output_dim := NULL;
        cache_hit := FALSE;
    END IF;

    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Record migration
-- ----------------------------------------------------------------------------
INSERT INTO claude_flow.migrations (name, checksum)
VALUES ('006_create_gnn_functions', md5('006_create_gnn_functions'))
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Rollback Script
-- ============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS claude_flow.get_cached_gnn(TEXT, TEXT, INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.cache_gnn_result(TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, REAL[], INTEGER, TEXT, INTEGER, INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.mpnn_layer(REAL[][], INTEGER[][], REAL[][], TEXT, TEXT);
-- DROP FUNCTION IF EXISTS claude_flow.graph_sage(REAL[][], INTEGER[][], TEXT);
-- DROP FUNCTION IF EXISTS claude_flow.gat_layer(REAL[][], INTEGER[][], INTEGER, INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.gcn_layer(REAL[][], INTEGER[][], REAL[][]);
-- DROP FUNCTION IF EXISTS claude_flow.matmul(REAL[][], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.leaky_relu(REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.relu(REAL[]);
-- DELETE FROM claude_flow.migrations WHERE name = '006_create_gnn_functions';
-- COMMIT;
