//! Arena Allocator
//!
//! Zero-copy arena allocation for batch operations.
//! All allocations are freed together when the arena is dropped.

use bumpalo::Bump;
use std::cell::RefCell;

/// Thread-local arena allocator
pub struct Arena {
    bump: RefCell<Bump>,
}

impl Arena {
    /// Create a new arena with default capacity
    #[inline]
    pub fn new() -> Self {
        Self {
            bump: RefCell::new(Bump::new()),
        }
    }

    /// Create a new arena with pre-allocated capacity
    #[inline]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            bump: RefCell::new(Bump::with_capacity(capacity)),
        }
    }

    /// Allocate a value in the arena
    #[inline(always)]
    pub fn alloc<T>(&self, value: T) -> &T {
        self.bump.borrow().alloc(value)
    }

    /// Allocate a string slice in the arena (zero-copy for owned strings)
    #[inline(always)]
    pub fn alloc_str(&self, s: &str) -> &str {
        self.bump.borrow().alloc_str(s)
    }

    /// Allocate a slice in the arena
    #[inline(always)]
    pub fn alloc_slice<T: Copy>(&self, slice: &[T]) -> &[T] {
        self.bump.borrow().alloc_slice_copy(slice)
    }

    /// Allocate a vector's contents in the arena
    #[inline(always)]
    pub fn alloc_vec<T: Copy>(&self, vec: &[T]) -> &[T] {
        self.alloc_slice(vec)
    }

    /// Reset the arena for reuse (very fast - O(1))
    #[inline(always)]
    pub fn reset(&self) {
        self.bump.borrow_mut().reset();
    }

    /// Get allocated bytes
    #[inline]
    pub fn allocated_bytes(&self) -> usize {
        self.bump.borrow().allocated_bytes()
    }
}

impl Default for Arena {
    fn default() -> Self {
        Self::new()
    }
}

/// Arena-allocated string for zero-copy parsing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ArenaStr<'a> {
    inner: &'a str,
}

impl<'a> ArenaStr<'a> {
    /// Create a new arena string
    #[inline(always)]
    pub fn new(arena: &'a Arena, s: &str) -> Self {
        Self {
            inner: arena.alloc_str(s),
        }
    }

    /// Get the string slice
    #[inline(always)]
    pub fn as_str(&self) -> &'a str {
        self.inner
    }
}

impl<'a> AsRef<str> for ArenaStr<'a> {
    #[inline(always)]
    fn as_ref(&self) -> &str {
        self.inner
    }
}

impl<'a> std::ops::Deref for ArenaStr<'a> {
    type Target = str;

    #[inline(always)]
    fn deref(&self) -> &Self::Target {
        self.inner
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_arena_alloc() {
        let arena = Arena::new();
        let s1 = arena.alloc_str("hello");
        let s2 = arena.alloc_str("world");
        assert_eq!(s1, "hello");
        assert_eq!(s2, "world");
    }

    #[test]
    fn test_arena_slice() {
        let arena = Arena::new();
        let nums = [1, 2, 3, 4, 5];
        let allocated = arena.alloc_slice(&nums);
        assert_eq!(allocated, &[1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_arena_reset() {
        let arena = Arena::new();
        arena.alloc_str("hello");
        arena.alloc_str("world");
        let before = arena.allocated_bytes();
        arena.reset();
        let after = arena.allocated_bytes();
        assert!(after < before);
    }
}
