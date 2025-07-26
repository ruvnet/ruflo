/***
 * This file is under MIT <year> Hajime Senuma, just like other files.
 * See LICENSE for details.
 *
 * It was originally written by Austin Appleby in C++ under the public domain,
 * but ported to PEP 7 C for Python 3.6 and later by the mmh3 project.
 *
 * Any issues should be reported to https://github.com/hajimes/mmh3/issues.
 *
 * The following is the original public domain notice by Austin Appleby.
 */

//-----------------------------------------------------------------------------
// MurmurHash3 was written by Austin Appleby, and is placed in the public
// domain. The author hereby disclaims copyright to this source code.

#ifndef _MURMURHASH3_H_
#define _MURMURHASH3_H_

// To handle 64-bit data; see https://docs.python.org/3/c-api/arg.html
#ifndef PY_SSIZE_T_CLEAN
#define PY_SSIZE_T_CLEAN
#endif
#include <Python.h>

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
#include <byteswap.h>
#endif

//-----------------------------------------------------------------------------
// Platform-specific functions and macros

// Microsoft Visual Studio

#if defined(_MSC_VER) && (_MSC_VER < 1600)

typedef signed __int8 int8_t;
typedef signed __int32 int32_t;
typedef signed __int64 int64_t;
typedef unsigned __int8 uint8_t;
typedef unsigned __int32 uint32_t;
typedef unsigned __int64 uint64_t;

// Other compilers

#else  // defined(_MSC_VER)

#include <stdint.h>

#endif  // !defined(_MSC_VER)

//-----------------------------------------------------------------------------
// Platform-specific functions and macros

// Microsoft Visual Studio

#if defined(_MSC_VER)

#define FORCE_INLINE __forceinline

#include <stdlib.h>

#define ROTL32(x, y) _rotl(x, y)
#define ROTL64(x, y) _rotl64(x, y)

#define BIG_CONSTANT(x) (x)

// Other compilers

#else  // defined(_MSC_VER)

#if ((__GNUC__ > 4) || (__GNUC__ == 4 && GNUC_MINOR >= 4))
/* gcc version >= 4.4 4.1 = RHEL 5, 4.4 = RHEL 6. Don't inline for RHEL 5 gcc
 * which is 4.1*/
#define FORCE_INLINE inline __attribute__((always_inline))
#else
#define FORCE_INLINE
#endif

static FORCE_INLINE uint32_t
rotl32(uint32_t x, int8_t r)
{
    return (x << r) | (x >> (32 - r));
}

static FORCE_INLINE uint64_t
rotl64(uint64_t x, int8_t r)
{
    return (x << r) | (x >> (64 - r));
}

#define ROTL32(x, y) rotl32(x, y)
#define ROTL64(x, y) rotl64(x, y)

#define BIG_CONSTANT(x) (x##LLU)

#endif  // !defined(_MSC_VER)

//-----------------------------------------------------------------------------
// Block read - if your platform needs to do endian-swapping or can only
// handle aligned reads, do the conversion here

static FORCE_INLINE uint32_t
getblock32(const uint32_t *p, Py_ssize_t i)
{
#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    return bswap_32(p[i]);
#else
    return p[i];
#endif
}

static FORCE_INLINE uint64_t
getblock64(const uint64_t *p, Py_ssize_t i)
{
#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    return bswap_64(p[i]);
#else
    return p[i];
#endif
}

//-----------------------------------------------------------------------------
// Building blocks for multiply and rotate (MUR) operations.
// Names are taken from Google Guava's implementation

static FORCE_INLINE uint32_t
mixK1(uint32_t k1)
{
    const uint32_t c1 = 0xcc9e2d51;
    const uint32_t c2 = 0x1b873593;

    k1 *= c1;
    k1 = ROTL32(k1, 15);
    k1 *= c2;

    return k1;
}
static FORCE_INLINE uint32_t
mixH1(uint32_t h1, const uint32_t h2, const uint8_t shift, const uint32_t c1)
{
    h1 = ROTL32(h1, shift);
    h1 += h2;
    h1 = h1 * 5 + c1;

    return h1;
}
static FORCE_INLINE uint64_t
mixK_x64_128(uint64_t k1, const uint8_t shift, const uint64_t c1,
             const uint64_t c2)
{
    k1 *= c1;
    k1 = ROTL64(k1, shift);
    k1 *= c2;

    return k1;
}
static FORCE_INLINE uint64_t
mixK1_x64_128(uint64_t k1)
{
    const uint64_t c1 = BIG_CONSTANT(0x87c37b91114253d5);
    const uint64_t c2 = BIG_CONSTANT(0x4cf5ad432745937f);

    k1 *= c1;
    k1 = ROTL64(k1, 31);
    k1 *= c2;

    return k1;
}
static FORCE_INLINE uint64_t
mixK2_x64_128(uint64_t k2)
{
    const uint64_t c1 = BIG_CONSTANT(0x87c37b91114253d5);
    const uint64_t c2 = BIG_CONSTANT(0x4cf5ad432745937f);

    k2 *= c2;
    k2 = ROTL64(k2, 33);
    k2 *= c1;

    return k2;
}
static FORCE_INLINE uint64_t
mixH_x64_128(uint64_t h1, uint64_t h2, const uint8_t shift, const uint32_t c)
{
    h1 = ROTL64(h1, shift);
    h1 += h2;
    h1 = h1 * 5 + c;

    return h1;
}
static FORCE_INLINE uint64_t
mixK_x86_128(uint32_t k, const uint8_t shift, const uint32_t c1,
             const uint32_t c2)
{
    k *= c1;
    k = ROTL32(k, shift);
    k *= c2;

    return k;
}

//-----------------------------------------------------------------------------
// Finalization mix - force all bits of a hash block to avalanche

static FORCE_INLINE uint32_t
fmix32(uint32_t h)
{
    h ^= h >> 16;
    h *= 0x85ebca6b;
    h ^= h >> 13;
    h *= 0xc2b2ae35;
    h ^= h >> 16;

    return h;
}

//----------

static FORCE_INLINE uint64_t
fmix64(uint64_t k)
{
    k ^= k >> 33;
    k *= BIG_CONSTANT(0xff51afd7ed558ccd);
    k ^= k >> 33;
    k *= BIG_CONSTANT(0xc4ceb9fe1a85ec53);
    k ^= k >> 33;

    return k;
}

//-----------------------------------------------------------------------------
// Finalization function

static FORCE_INLINE void
digest_x64_128_impl(uint64_t h1, uint64_t h2, const uint64_t k1,
                    const uint64_t k2, const Py_ssize_t len, const char *out)
{
    h1 ^= mixK1_x64_128(k1);
    h2 ^= mixK2_x64_128(k2);
    h1 ^= len;
    h2 ^= len;

    h1 += h2;
    h2 += h1;

    h1 = fmix64(h1);
    h2 = fmix64(h2);

    h1 += h2;
    h2 += h1;

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    ((uint64_t *)out)[0] = bswap_64(h1);
    ((uint64_t *)out)[1] = bswap_64(h2);
#else
    ((uint64_t *)out)[0] = h1;
    ((uint64_t *)out)[1] = h2;
#endif
}

static FORCE_INLINE void
digest_x86_128_impl(uint32_t h1, uint32_t h2, uint32_t h3, uint32_t h4,
                    const uint32_t k1, const uint32_t k2, const uint32_t k3,
                    const uint32_t k4, const Py_ssize_t len, const char *out)
{
    const uint32_t c1 = 0x239b961b;
    const uint32_t c2 = 0xab0e9789;
    const uint32_t c3 = 0x38b34ae5;
    const uint32_t c4 = 0xa1e38b93;

    h1 ^= mixK_x86_128(k1, 15, c1, c2);
    h2 ^= mixK_x86_128(k2, 16, c2, c3);
    h3 ^= mixK_x86_128(k3, 17, c3, c4);
    h4 ^= mixK_x86_128(k4, 18, c4, c1);
    h1 ^= len;
    h2 ^= len;
    h3 ^= len;
    h4 ^= len;

    h1 += h2;
    h1 += h3;
    h1 += h4;
    h2 += h1;
    h3 += h1;
    h4 += h1;

    h1 = fmix32(h1);
    h2 = fmix32(h2);
    h3 = fmix32(h3);
    h4 = fmix32(h4);

    h1 += h2;
    h1 += h3;
    h1 += h4;
    h2 += h1;
    h3 += h1;
    h4 += h1;

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    ((uint32_t *)out)[0] = bswap_32(h1);
    ((uint32_t *)out)[1] = bswap_32(h2);
    ((uint32_t *)out)[2] = bswap_32(h3);
    ((uint32_t *)out)[3] = bswap_32(h4);
#else
    ((uint32_t *)out)[0] = h1;
    ((uint32_t *)out)[1] = h2;
    ((uint32_t *)out)[2] = h3;
    ((uint32_t *)out)[3] = h4;
#endif
}

//-----------------------------------------------------------------------------

void
murmurhash3_x86_32(const void *key, Py_ssize_t len, uint32_t seed, void *out);

void
murmurhash3_x86_128(const void *key, Py_ssize_t len, uint32_t seed, void *out);

void
murmurhash3_x64_128(const void *key, Py_ssize_t len, uint32_t seed, void *out);

//-----------------------------------------------------------------------------

#endif  // _MURMURHASH3_H_
