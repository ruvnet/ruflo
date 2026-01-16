-- ============================================================================
-- Migration 007: Create Hyperbolic Geometry Functions
-- RuVector PostgreSQL Bridge - Claude Flow V3
--
-- Creates SQL functions for hyperbolic embeddings including Poincare ball
-- and Lorentz model operations for hierarchical data representation.
-- Compatible with PostgreSQL 14+ and pgvector 0.5+
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Constants and Utilities
-- ----------------------------------------------------------------------------

-- Clamp value to valid Poincare ball radius (|x| < 1)
CREATE OR REPLACE FUNCTION claude_flow.clamp_to_poincare(
    x REAL,
    epsilon REAL DEFAULT 1e-5
) RETURNS REAL AS $$
BEGIN
    IF x >= 1.0 - epsilon THEN
        RETURN 1.0 - epsilon;
    ELSIF x <= -1.0 + epsilon THEN
        RETURN -1.0 + epsilon;
    ELSE
        RETURN x;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Clamp vector to valid Poincare ball
CREATE OR REPLACE FUNCTION claude_flow.clamp_vector_to_poincare(
    v REAL[],
    epsilon REAL DEFAULT 1e-5
) RETURNS REAL[] AS $$
DECLARE
    norm REAL;
    max_norm REAL;
    i INTEGER;
    result REAL[];
BEGIN
    norm := claude_flow.vector_magnitude(v);
    max_norm := 1.0 - epsilon;

    IF norm >= max_norm THEN
        result := ARRAY[]::REAL[];
        FOR i IN 1..array_length(v, 1) LOOP
            result := array_append(result, v[i] * max_norm / norm);
        END LOOP;
        RETURN result;
    ELSE
        RETURN v;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Hyperbolic arctanh (inverse hyperbolic tangent)
CREATE OR REPLACE FUNCTION claude_flow.arctanh(
    x REAL
) RETURNS REAL AS $$
BEGIN
    -- Clamp to avoid domain errors
    x := GREATEST(-0.9999999, LEAST(0.9999999, x));
    RETURN 0.5 * ln((1.0 + x) / (1.0 - x));
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Hyperbolic arcsinh (inverse hyperbolic sine)
CREATE OR REPLACE FUNCTION claude_flow.arcsinh(
    x REAL
) RETURNS REAL AS $$
BEGIN
    RETURN ln(x + sqrt(x * x + 1.0));
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Hyperbolic arccosh (inverse hyperbolic cosh)
CREATE OR REPLACE FUNCTION claude_flow.arccosh(
    x REAL
) RETURNS REAL AS $$
BEGIN
    IF x < 1.0 THEN
        x := 1.0;  -- Clamp to valid domain
    END IF;
    RETURN ln(x + sqrt(x * x - 1.0));
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Poincare Ball Model Functions
-- The Poincare ball is the unit ball B^n = {x : ||x|| < 1} with
-- the Riemannian metric g_x = (2 / (1 - ||x||^2))^2 * g_E
-- ----------------------------------------------------------------------------

-- Poincare distance between two points
-- d(x, y) = arcosh(1 + 2 * ||x - y||^2 / ((1 - ||x||^2)(1 - ||y||^2)))
CREATE OR REPLACE FUNCTION claude_flow.poincare_distance(
    v1 REAL[],
    v2 REAL[],
    curvature REAL DEFAULT -1.0
) RETURNS REAL AS $$
DECLARE
    c REAL;
    diff_sq REAL := 0;
    norm_v1_sq REAL := 0;
    norm_v2_sq REAL := 0;
    i INTEGER;
    numerator REAL;
    denominator REAL;
    arg REAL;
BEGIN
    c := abs(curvature);

    -- Compute squared norms and squared difference
    FOR i IN 1..array_length(v1, 1) LOOP
        diff_sq := diff_sq + (v1[i] - v2[i]) * (v1[i] - v2[i]);
        norm_v1_sq := norm_v1_sq + v1[i] * v1[i];
        norm_v2_sq := norm_v2_sq + v2[i] * v2[i];
    END LOOP;

    -- Poincare distance formula
    numerator := 2.0 * c * diff_sq;
    denominator := (1.0 - c * norm_v1_sq) * (1.0 - c * norm_v2_sq);

    IF denominator <= 0 THEN
        -- Points are on or outside the ball boundary
        RETURN 1e9;  -- Return large distance
    END IF;

    arg := 1.0 + numerator / denominator;
    RETURN (1.0 / sqrt(c)) * claude_flow.arccosh(arg);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Lorentz (Hyperboloid) Model Functions
-- The Lorentz model uses the upper sheet of the hyperboloid:
-- H^n = {x in R^(n+1) : <x,x>_L = -1, x_0 > 0}
-- where <x,y>_L = -x_0*y_0 + x_1*y_1 + ... + x_n*y_n
-- ----------------------------------------------------------------------------

-- Lorentz inner product (Minkowski inner product)
CREATE OR REPLACE FUNCTION claude_flow.lorentz_inner_product(
    v1 REAL[],
    v2 REAL[]
) RETURNS REAL AS $$
DECLARE
    result REAL;
    i INTEGER;
BEGIN
    IF array_length(v1, 1) != array_length(v2, 1) THEN
        RAISE EXCEPTION 'Vector dimensions must match';
    END IF;

    -- First component has negative sign (time-like)
    result := -v1[1] * v2[1];

    -- Remaining components are space-like
    FOR i IN 2..array_length(v1, 1) LOOP
        result := result + v1[i] * v2[i];
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- Lorentz distance
-- d(x, y) = arccosh(-<x, y>_L)
CREATE OR REPLACE FUNCTION claude_flow.lorentz_distance(
    v1 REAL[],
    v2 REAL[]
) RETURNS REAL AS $$
DECLARE
    inner REAL;
BEGIN
    inner := claude_flow.lorentz_inner_product(v1, v2);
    -- The inner product should be <= -1 for valid hyperboloid points
    RETURN claude_flow.arccosh(-inner);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Exponential Map (Tangent space -> Manifold)
-- exp_x(v) maps a tangent vector v at point x to a point on the manifold
-- ----------------------------------------------------------------------------

-- Exponential map in Poincare ball
CREATE OR REPLACE FUNCTION claude_flow.exp_map(
    base REAL[],          -- Base point on the manifold
    tangent REAL[],       -- Tangent vector at base
    curvature REAL DEFAULT -1.0
) RETURNS REAL[] AS $$
DECLARE
    c REAL;
    lambda_x REAL;
    tangent_norm REAL;
    sqrt_c REAL;
    tanh_arg REAL;
    coeff REAL;
    result REAL[];
    i INTEGER;
    base_norm_sq REAL := 0;
BEGIN
    c := abs(curvature);
    sqrt_c := sqrt(c);

    -- Compute ||base||^2
    FOR i IN 1..array_length(base, 1) LOOP
        base_norm_sq := base_norm_sq + base[i] * base[i];
    END LOOP;

    -- Conformal factor at base point
    lambda_x := 2.0 / (1.0 - c * base_norm_sq);

    -- Compute ||tangent||
    tangent_norm := claude_flow.vector_magnitude(tangent);

    IF tangent_norm < 1e-10 THEN
        RETURN base;  -- No movement
    END IF;

    -- tanh(sqrt(c) * lambda_x * ||v|| / 2)
    tanh_arg := sqrt_c * lambda_x * tangent_norm / 2.0;
    coeff := tanh(tanh_arg) / (sqrt_c * tangent_norm);

    -- exp_x(v) = x ⊕_c (tanh(...) * v / ||v||)
    -- Using Mobius addition
    DECLARE
        scaled_tangent REAL[] := ARRAY[]::REAL[];
    BEGIN
        FOR i IN 1..array_length(tangent, 1) LOOP
            scaled_tangent := array_append(scaled_tangent, coeff * tangent[i]);
        END LOOP;

        result := claude_flow.mobius_add(base, scaled_tangent, curvature);
    END;

    RETURN claude_flow.clamp_vector_to_poincare(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Logarithmic Map (Manifold -> Tangent space)
-- log_x(y) maps a point y on the manifold to the tangent space at x
-- ----------------------------------------------------------------------------

-- Logarithmic map in Poincare ball
CREATE OR REPLACE FUNCTION claude_flow.log_map(
    base REAL[],          -- Base point on the manifold
    point REAL[]          -- Target point on the manifold
) RETURNS REAL[] AS $$
DECLARE
    c REAL := 1.0;  -- curvature magnitude
    sqrt_c REAL := 1.0;
    lambda_x REAL;
    neg_base REAL[];
    mobius_result REAL[];
    mobius_norm REAL;
    arctanh_arg REAL;
    coeff REAL;
    result REAL[];
    i INTEGER;
    base_norm_sq REAL := 0;
BEGIN
    -- Compute ||base||^2
    FOR i IN 1..array_length(base, 1) LOOP
        base_norm_sq := base_norm_sq + base[i] * base[i];
    END LOOP;

    -- Conformal factor
    lambda_x := 2.0 / (1.0 - c * base_norm_sq);

    -- Compute -base ⊕_c point
    neg_base := ARRAY[]::REAL[];
    FOR i IN 1..array_length(base, 1) LOOP
        neg_base := array_append(neg_base, -base[i]);
    END LOOP;

    mobius_result := claude_flow.mobius_add(neg_base, point, -c);
    mobius_norm := claude_flow.vector_magnitude(mobius_result);

    IF mobius_norm < 1e-10 THEN
        -- Points are the same, return zero tangent
        result := ARRAY[]::REAL[];
        FOR i IN 1..array_length(base, 1) LOOP
            result := array_append(result, 0.0);
        END LOOP;
        RETURN result;
    END IF;

    -- arctanh(sqrt(c) * ||..||) * 2 / (sqrt(c) * lambda_x)
    arctanh_arg := sqrt_c * mobius_norm;
    coeff := (2.0 / (sqrt_c * lambda_x)) * claude_flow.arctanh(arctanh_arg) / mobius_norm;

    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(mobius_result, 1) LOOP
        result := array_append(result, coeff * mobius_result[i]);
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Mobius Addition (Gyrovector addition in hyperbolic space)
-- x ⊕_c y = ((1 + 2c<x,y> + c||y||^2)x + (1 - c||x||^2)y) /
--           (1 + 2c<x,y> + c^2||x||^2||y||^2)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.mobius_add(
    v1 REAL[],
    v2 REAL[],
    curvature REAL DEFAULT -1.0
) RETURNS REAL[] AS $$
DECLARE
    c REAL;
    dot_product REAL := 0;
    norm_v1_sq REAL := 0;
    norm_v2_sq REAL := 0;
    numerator_coeff1 REAL;
    numerator_coeff2 REAL;
    denominator REAL;
    result REAL[];
    i INTEGER;
BEGIN
    c := abs(curvature);

    -- Compute dot product and squared norms
    FOR i IN 1..array_length(v1, 1) LOOP
        dot_product := dot_product + v1[i] * v2[i];
        norm_v1_sq := norm_v1_sq + v1[i] * v1[i];
        norm_v2_sq := norm_v2_sq + v2[i] * v2[i];
    END LOOP;

    -- Compute coefficients
    numerator_coeff1 := 1.0 + 2.0 * c * dot_product + c * norm_v2_sq;
    numerator_coeff2 := 1.0 - c * norm_v1_sq;
    denominator := 1.0 + 2.0 * c * dot_product + c * c * norm_v1_sq * norm_v2_sq;

    IF abs(denominator) < 1e-10 THEN
        denominator := 1e-10;  -- Avoid division by zero
    END IF;

    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(v1, 1) LOOP
        result := array_append(result,
            (numerator_coeff1 * v1[i] + numerator_coeff2 * v2[i]) / denominator
        );
    END LOOP;

    RETURN claude_flow.clamp_vector_to_poincare(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Mobius Scalar Multiplication
-- r ⊗_c x = (1/sqrt(c)) * tanh(r * arctanh(sqrt(c) * ||x||)) * (x / ||x||)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.mobius_scalar_mul(
    r REAL,
    v REAL[],
    curvature REAL DEFAULT -1.0
) RETURNS REAL[] AS $$
DECLARE
    c REAL;
    sqrt_c REAL;
    v_norm REAL;
    arctanh_arg REAL;
    tanh_result REAL;
    coeff REAL;
    result REAL[];
    i INTEGER;
BEGIN
    c := abs(curvature);
    sqrt_c := sqrt(c);

    v_norm := claude_flow.vector_magnitude(v);

    IF v_norm < 1e-10 THEN
        -- Return zero vector
        result := ARRAY[]::REAL[];
        FOR i IN 1..array_length(v, 1) LOOP
            result := array_append(result, 0.0);
        END LOOP;
        RETURN result;
    END IF;

    arctanh_arg := sqrt_c * v_norm;
    tanh_result := tanh(r * claude_flow.arctanh(arctanh_arg));
    coeff := (1.0 / sqrt_c) * tanh_result / v_norm;

    result := ARRAY[]::REAL[];
    FOR i IN 1..array_length(v, 1) LOOP
        result := array_append(result, coeff * v[i]);
    END LOOP;

    RETURN claude_flow.clamp_vector_to_poincare(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Parallel Transport (Move tangent vector from one point to another)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.parallel_transport(
    v REAL[],             -- Tangent vector to transport
    from_point REAL[],    -- Source point
    to_point REAL[],      -- Destination point
    curvature REAL DEFAULT -1.0
) RETURNS REAL[] AS $$
DECLARE
    c REAL;
    lambda_from REAL;
    lambda_to REAL;
    gyration REAL[];
    transported REAL[];
    from_norm_sq REAL := 0;
    to_norm_sq REAL := 0;
    i INTEGER;
BEGIN
    c := abs(curvature);

    -- Compute squared norms
    FOR i IN 1..array_length(from_point, 1) LOOP
        from_norm_sq := from_norm_sq + from_point[i] * from_point[i];
    END LOOP;

    FOR i IN 1..array_length(to_point, 1) LOOP
        to_norm_sq := to_norm_sq + to_point[i] * to_point[i];
    END LOOP;

    -- Conformal factors
    lambda_from := 2.0 / (1.0 - c * from_norm_sq);
    lambda_to := 2.0 / (1.0 - c * to_norm_sq);

    -- Simplified parallel transport (scaling by ratio of conformal factors)
    transported := ARRAY[]::REAL[];
    FOR i IN 1..array_length(v, 1) LOOP
        transported := array_append(transported, v[i] * lambda_from / lambda_to);
    END LOOP;

    RETURN transported;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Hyperbolic Centroid (Frechet/Karcher mean)
-- Einstein midpoint for two points in Poincare ball
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.hyperbolic_centroid(
    points REAL[][],
    curvature REAL DEFAULT -1.0,
    max_iterations INTEGER DEFAULT 100,
    tolerance REAL DEFAULT 1e-6
) RETURNS REAL[] AS $$
DECLARE
    c REAL;
    n INTEGER;
    dim INTEGER;
    centroid REAL[];
    new_centroid REAL[];
    i INTEGER;
    j INTEGER;
    iter INTEGER;
    total_weight REAL;
    tangent_sum REAL[];
    tangent REAL[];
    diff REAL;
BEGIN
    c := abs(curvature);
    n := array_length(points, 1);
    dim := array_length(points[1], 1);

    -- Initialize centroid at origin
    centroid := ARRAY[]::REAL[];
    FOR j IN 1..dim LOOP
        centroid := array_append(centroid, 0.0);
    END LOOP;

    -- Iterative optimization (gradient descent in tangent space)
    FOR iter IN 1..max_iterations LOOP
        -- Compute sum of log maps (tangent vectors pointing to each point)
        tangent_sum := ARRAY[]::REAL[];
        FOR j IN 1..dim LOOP
            tangent_sum := array_append(tangent_sum, 0.0);
        END LOOP;

        FOR i IN 1..n LOOP
            tangent := claude_flow.log_map(centroid, points[i]);
            FOR j IN 1..dim LOOP
                tangent_sum[j] := tangent_sum[j] + tangent[j];
            END LOOP;
        END LOOP;

        -- Average tangent
        FOR j IN 1..dim LOOP
            tangent_sum[j] := tangent_sum[j] / n;
        END LOOP;

        -- Move centroid in direction of average tangent
        new_centroid := claude_flow.exp_map(centroid, tangent_sum, curvature);

        -- Check convergence
        diff := claude_flow.poincare_distance(centroid, new_centroid, curvature);
        centroid := new_centroid;

        IF diff < tolerance THEN
            EXIT;
        END IF;
    END LOOP;

    RETURN centroid;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Poincare to Lorentz Conversion
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.poincare_to_lorentz(
    poincare REAL[],
    curvature REAL DEFAULT -1.0
) RETURNS REAL[] AS $$
DECLARE
    c REAL;
    norm_sq REAL := 0;
    denominator REAL;
    lorentz REAL[];
    i INTEGER;
BEGIN
    c := abs(curvature);

    -- Compute ||x||^2
    FOR i IN 1..array_length(poincare, 1) LOOP
        norm_sq := norm_sq + poincare[i] * poincare[i];
    END LOOP;

    denominator := 1.0 - c * norm_sq;

    IF denominator <= 0 THEN
        RAISE EXCEPTION 'Point is on or outside the Poincare ball boundary';
    END IF;

    -- Lorentz coordinates: (x_0, x_1, ..., x_n)
    -- x_0 = (1 + c*||x||^2) / (1 - c*||x||^2)
    -- x_i = 2*sqrt(c)*x_i / (1 - c*||x||^2)
    lorentz := ARRAY[]::REAL[];
    lorentz := array_append(lorentz, (1.0 + c * norm_sq) / denominator);

    FOR i IN 1..array_length(poincare, 1) LOOP
        lorentz := array_append(lorentz, 2.0 * sqrt(c) * poincare[i] / denominator);
    END LOOP;

    RETURN lorentz;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Lorentz to Poincare Conversion
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claude_flow.lorentz_to_poincare(
    lorentz REAL[],
    curvature REAL DEFAULT -1.0
) RETURNS REAL[] AS $$
DECLARE
    c REAL;
    sqrt_c REAL;
    denominator REAL;
    poincare REAL[];
    i INTEGER;
BEGIN
    c := abs(curvature);
    sqrt_c := sqrt(c);

    -- x_0 is the first component
    denominator := lorentz[1] + 1.0;

    IF denominator <= 0 THEN
        RAISE EXCEPTION 'Invalid Lorentz point';
    END IF;

    -- Poincare coordinates: x_i = x_i / (sqrt(c) * (x_0 + 1))
    poincare := ARRAY[]::REAL[];
    FOR i IN 2..array_length(lorentz, 1) LOOP
        poincare := array_append(poincare, lorentz[i] / (sqrt_c * denominator));
    END LOOP;

    RETURN claude_flow.clamp_vector_to_poincare(poincare);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

-- ----------------------------------------------------------------------------
-- Hyperbolic Embedding Storage
-- ----------------------------------------------------------------------------

-- Store hyperbolic embedding
CREATE OR REPLACE FUNCTION claude_flow.store_hyperbolic_embedding(
    p_namespace TEXT,
    p_name TEXT,
    p_poincare_embedding REAL[],
    p_curvature REAL DEFAULT -1.0,
    p_depth INTEGER DEFAULT 0,
    p_parent_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_lorentz REAL[];
BEGIN
    -- Convert to Lorentz representation
    v_lorentz := claude_flow.poincare_to_lorentz(p_poincare_embedding, p_curvature);

    INSERT INTO claude_flow.hyperbolic_embeddings (
        namespace,
        name,
        poincare_embedding,
        lorentz_embedding,
        dimensions,
        curvature,
        depth,
        parent_id,
        metadata
    ) VALUES (
        p_namespace,
        p_name,
        p_poincare_embedding,
        v_lorentz,
        array_length(p_poincare_embedding, 1),
        p_curvature,
        p_depth,
        p_parent_id,
        p_metadata
    )
    ON CONFLICT (namespace, name) DO UPDATE
    SET poincare_embedding = EXCLUDED.poincare_embedding,
        lorentz_embedding = EXCLUDED.lorentz_embedding,
        dimensions = EXCLUDED.dimensions,
        curvature = EXCLUDED.curvature,
        depth = EXCLUDED.depth,
        parent_id = EXCLUDED.parent_id,
        metadata = EXCLUDED.metadata
    RETURNING id INTO v_id;

    -- Update parent's children count
    IF p_parent_id IS NOT NULL THEN
        UPDATE claude_flow.hyperbolic_embeddings
        SET children_count = children_count + 1
        WHERE id = p_parent_id;
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Find nearest neighbors in hyperbolic space
CREATE OR REPLACE FUNCTION claude_flow.hyperbolic_knn(
    p_query REAL[],
    p_k INTEGER DEFAULT 10,
    p_namespace TEXT DEFAULT NULL,
    p_curvature REAL DEFAULT -1.0
) RETURNS TABLE (
    id UUID,
    name TEXT,
    distance REAL,
    depth INTEGER,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        h.id,
        h.name,
        claude_flow.poincare_distance(p_query, h.poincare_embedding, p_curvature) AS distance,
        h.depth,
        h.metadata
    FROM claude_flow.hyperbolic_embeddings h
    WHERE (p_namespace IS NULL OR h.namespace = p_namespace)
    ORDER BY claude_flow.poincare_distance(p_query, h.poincare_embedding, p_curvature)
    LIMIT p_k;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get subtree rooted at a node
CREATE OR REPLACE FUNCTION claude_flow.get_hyperbolic_subtree(
    p_root_id UUID,
    p_max_depth INTEGER DEFAULT 10
) RETURNS TABLE (
    id UUID,
    name TEXT,
    depth INTEGER,
    level INTEGER,
    poincare_embedding REAL[],
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE subtree AS (
        SELECT
            h.id,
            h.name,
            h.depth,
            0 AS level,
            h.poincare_embedding,
            h.metadata
        FROM claude_flow.hyperbolic_embeddings h
        WHERE h.id = p_root_id

        UNION ALL

        SELECT
            c.id,
            c.name,
            c.depth,
            s.level + 1,
            c.poincare_embedding,
            c.metadata
        FROM claude_flow.hyperbolic_embeddings c
        JOIN subtree s ON c.parent_id = s.id
        WHERE s.level < p_max_depth
    )
    SELECT * FROM subtree;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- Record migration
-- ----------------------------------------------------------------------------
INSERT INTO claude_flow.migrations (name, checksum)
VALUES ('007_create_hyperbolic_functions', md5('007_create_hyperbolic_functions'))
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ============================================================================
-- Rollback Script
-- ============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS claude_flow.get_hyperbolic_subtree(UUID, INTEGER);
-- DROP FUNCTION IF EXISTS claude_flow.hyperbolic_knn(REAL[], INTEGER, TEXT, REAL);
-- DROP FUNCTION IF EXISTS claude_flow.store_hyperbolic_embedding(TEXT, TEXT, REAL[], REAL, INTEGER, UUID, JSONB);
-- DROP FUNCTION IF EXISTS claude_flow.lorentz_to_poincare(REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.poincare_to_lorentz(REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.hyperbolic_centroid(REAL[][], REAL, INTEGER, REAL);
-- DROP FUNCTION IF EXISTS claude_flow.parallel_transport(REAL[], REAL[], REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.mobius_scalar_mul(REAL, REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.mobius_add(REAL[], REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.log_map(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.exp_map(REAL[], REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.lorentz_distance(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.lorentz_inner_product(REAL[], REAL[]);
-- DROP FUNCTION IF EXISTS claude_flow.poincare_distance(REAL[], REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.arccosh(REAL);
-- DROP FUNCTION IF EXISTS claude_flow.arcsinh(REAL);
-- DROP FUNCTION IF EXISTS claude_flow.arctanh(REAL);
-- DROP FUNCTION IF EXISTS claude_flow.clamp_vector_to_poincare(REAL[], REAL);
-- DROP FUNCTION IF EXISTS claude_flow.clamp_to_poincare(REAL, REAL);
-- DELETE FROM claude_flow.migrations WHERE name = '007_create_hyperbolic_functions';
-- COMMIT;
