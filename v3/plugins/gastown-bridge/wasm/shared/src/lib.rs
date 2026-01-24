//! Shared Optimized Utilities for Gas Town WASM Modules
//!
//! Ultra-fast utilities for maximum WASM performance:
//! - `FxHashMap`/`FxHashSet` - 2x faster than std for small keys
//! - `Arena` - Zero-copy arena allocator
//! - `MemoryPool` - Reusable allocation pool
//! - `InternedString` - Zero-copy string interning
//! - SIMD utilities for parallel processing

#![allow(dead_code)]

pub mod hash;
pub mod arena;
pub mod pool;
pub mod simd;
pub mod intern;

pub use hash::{FxHashMap, FxHashSet, FxBuildHasher};
pub use arena::Arena;
pub use pool::MemoryPool;
pub use intern::StringInterner;

/// Performance timing utilities for benchmarking
#[cfg(target_arch = "wasm32")]
pub mod timing {
    use js_sys::Date;

    /// Get high-precision timestamp in milliseconds
    #[inline(always)]
    pub fn now_ms() -> f64 {
        Date::now()
    }

    /// Measure execution time of a closure
    #[inline(always)]
    pub fn measure<F, R>(f: F) -> (R, f64)
    where
        F: FnOnce() -> R,
    {
        let start = now_ms();
        let result = f();
        let elapsed = now_ms() - start;
        (result, elapsed)
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub mod timing {
    use std::time::Instant;

    #[inline(always)]
    pub fn now_ms() -> f64 {
        0.0
    }

    #[inline(always)]
    pub fn measure<F, R>(f: F) -> (R, f64)
    where
        F: FnOnce() -> R,
    {
        let start = Instant::now();
        let result = f();
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        (result, elapsed)
    }
}

/// Pre-sized capacity hints for common operations
pub mod capacity {
    /// Typical formula size (steps + legs + vars)
    pub const FORMULA_ITEMS: usize = 32;

    /// Typical graph size (nodes)
    pub const GRAPH_NODES: usize = 128;

    /// Typical graph edges per node
    pub const EDGES_PER_NODE: usize = 4;

    /// String buffer size
    pub const STRING_BUFFER: usize = 1024;

    /// Batch processing size
    pub const BATCH_SIZE: usize = 100;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fxhashmap_basic() {
        let mut map: FxHashMap<&str, i32> = FxHashMap::default();
        map.insert("foo", 1);
        map.insert("bar", 2);
        assert_eq!(map.get("foo"), Some(&1));
        assert_eq!(map.get("bar"), Some(&2));
    }

    #[test]
    fn test_arena_allocation() {
        let arena = Arena::new();
        let s1 = arena.alloc_str("hello");
        let s2 = arena.alloc_str("world");
        assert_eq!(s1, "hello");
        assert_eq!(s2, "world");
    }
}
