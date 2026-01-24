//! SIMD Utilities
//!
//! Portable SIMD operations for parallel processing.
//! Falls back to scalar operations on unsupported platforms.

#[cfg(feature = "simd")]
use wide::*;

/// SIMD-friendly sum of f32 array
#[inline(always)]
pub fn sum_f32(values: &[f32]) -> f32 {
    #[cfg(feature = "simd")]
    {
        simd_sum_f32(values)
    }
    #[cfg(not(feature = "simd"))]
    {
        values.iter().sum()
    }
}

#[cfg(feature = "simd")]
fn simd_sum_f32(values: &[f32]) -> f32 {
    const LANES: usize = 4;

    if values.len() < LANES {
        return values.iter().sum();
    }

    let chunks = values.chunks_exact(LANES);
    let remainder = chunks.remainder();

    let mut acc = f32x4::ZERO;
    for chunk in chunks {
        let v = f32x4::from([chunk[0], chunk[1], chunk[2], chunk[3]]);
        acc += v;
    }

    // Horizontal sum
    let arr = acc.to_array();
    let simd_sum: f32 = arr.iter().sum();
    let remainder_sum: f32 = remainder.iter().sum();

    simd_sum + remainder_sum
}

/// SIMD-friendly max of f32 array
#[inline(always)]
pub fn max_f32(values: &[f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }

    #[cfg(feature = "simd")]
    {
        Some(simd_max_f32(values))
    }
    #[cfg(not(feature = "simd"))]
    {
        values.iter().copied().reduce(f32::max)
    }
}

#[cfg(feature = "simd")]
fn simd_max_f32(values: &[f32]) -> f32 {
    const LANES: usize = 4;

    if values.len() < LANES {
        return values.iter().copied().reduce(f32::max).unwrap_or(f32::NEG_INFINITY);
    }

    let chunks = values.chunks_exact(LANES);
    let remainder = chunks.remainder();

    let mut acc = f32x4::splat(f32::NEG_INFINITY);
    for chunk in chunks {
        let v = f32x4::from([chunk[0], chunk[1], chunk[2], chunk[3]]);
        acc = acc.max(v);
    }

    // Horizontal max
    let arr = acc.to_array();
    let simd_max = arr.iter().copied().reduce(f32::max).unwrap_or(f32::NEG_INFINITY);
    let remainder_max = remainder.iter().copied().reduce(f32::max).unwrap_or(f32::NEG_INFINITY);

    simd_max.max(remainder_max)
}

/// SIMD-friendly min of f32 array
#[inline(always)]
pub fn min_f32(values: &[f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }

    #[cfg(feature = "simd")]
    {
        Some(simd_min_f32(values))
    }
    #[cfg(not(feature = "simd"))]
    {
        values.iter().copied().reduce(f32::min)
    }
}

#[cfg(feature = "simd")]
fn simd_min_f32(values: &[f32]) -> f32 {
    const LANES: usize = 4;

    if values.len() < LANES {
        return values.iter().copied().reduce(f32::min).unwrap_or(f32::INFINITY);
    }

    let chunks = values.chunks_exact(LANES);
    let remainder = chunks.remainder();

    let mut acc = f32x4::splat(f32::INFINITY);
    for chunk in chunks {
        let v = f32x4::from([chunk[0], chunk[1], chunk[2], chunk[3]]);
        acc = acc.min(v);
    }

    // Horizontal min
    let arr = acc.to_array();
    let simd_min = arr.iter().copied().reduce(f32::min).unwrap_or(f32::INFINITY);
    let remainder_min = remainder.iter().copied().reduce(f32::min).unwrap_or(f32::INFINITY);

    simd_min.min(remainder_min)
}

/// Parallel accumulation for u32 values (for graph operations)
#[inline(always)]
pub fn sum_u32(values: &[u32]) -> u32 {
    // For u32, use simple iteration - SIMD overhead not worth it for typical sizes
    values.iter().sum()
}

/// Find index of maximum value
#[inline(always)]
pub fn argmax_f32(values: &[f32]) -> Option<usize> {
    if values.is_empty() {
        return None;
    }

    let mut max_idx = 0;
    let mut max_val = values[0];

    for (i, &v) in values.iter().enumerate().skip(1) {
        if v > max_val {
            max_val = v;
            max_idx = i;
        }
    }

    Some(max_idx)
}

/// Find index of minimum value
#[inline(always)]
pub fn argmin_f32(values: &[f32]) -> Option<usize> {
    if values.is_empty() {
        return None;
    }

    let mut min_idx = 0;
    let mut min_val = values[0];

    for (i, &v) in values.iter().enumerate().skip(1) {
        if v < min_val {
            min_val = v;
            min_idx = i;
        }
    }

    Some(min_idx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sum_f32() {
        let values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let sum = sum_f32(&values);
        assert!((sum - 36.0).abs() < 0.001);
    }

    #[test]
    fn test_max_f32() {
        let values = [1.0, 5.0, 3.0, 8.0, 2.0, 7.0, 4.0, 6.0];
        let max = max_f32(&values);
        assert_eq!(max, Some(8.0));
    }

    #[test]
    fn test_min_f32() {
        let values = [5.0, 1.0, 3.0, 8.0, 2.0, 7.0, 4.0, 6.0];
        let min = min_f32(&values);
        assert_eq!(min, Some(1.0));
    }

    #[test]
    fn test_argmax() {
        let values = [1.0, 5.0, 3.0, 8.0, 2.0];
        assert_eq!(argmax_f32(&values), Some(3));
    }

    #[test]
    fn test_argmin() {
        let values = [5.0, 1.0, 3.0, 8.0, 2.0];
        assert_eq!(argmin_f32(&values), Some(1));
    }
}
