// To handle 64-bit data; see https://docs.python.org/3/c-api/arg.html
#ifndef PY_SSIZE_T_CLEAN
#define PY_SSIZE_T_CLEAN
#endif

#include <Python.h>
#include <stdio.h>
#include <string.h>

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
#include <byteswap.h>
#endif

#include "hashlib.h"
#include "murmurhash3.h"

#if defined(_MSC_VER)
typedef signed __int8 int8_t;
typedef signed __int32 int32_t;
typedef signed __int64 int64_t;
typedef unsigned __int8 uint8_t;
typedef unsigned __int32 uint32_t;
typedef unsigned __int64 uint64_t;
// Other compilers
#else  // defined(_MSC_VER)
#include <stdint.h>
#endif  // defined(_MSC_VER)

#define MMH3_32_DIGESTSIZE 4
#define MMH3_128_DIGESTSIZE 16

#define MMH3_32_BLOCKSIZE 12
#define MMH3_128_BLOCKSIZE 32

#define MMH3_VALIDATE_SEED_RETURN_NULL(seed)                       \
    if (seed < 0 || seed > 0xFFFFFFFF) {                           \
        PyErr_SetString(PyExc_ValueError, "seed is out of range"); \
        return NULL;                                               \
    }

#define MMH3_VALIDATE_SEED_RETURN_INT(seed, buf)                   \
    if (seed < 0 || seed > 0xFFFFFFFF) {                           \
        PyBuffer_Release(&buf);                                    \
        PyErr_SetString(PyExc_ValueError, "seed is out of range"); \
        return -1;                                                 \
    }

// obj: PyObject*
// target_str: const char *
// len: Py_ssize_t
#define MMH3_HASH_VALIDATE_AND_SET_BYTES(obj, target_str, len)          \
    if (PyBytes_Check(obj)) {                                           \
        target_str_len = PyBytes_Size(obj);                             \
        target_str = PyBytes_AS_STRING(obj);                            \
    }                                                                   \
    else if (PyUnicode_Check(obj)) {                                    \
        target_str_len = PyUnicode_GET_LENGTH(obj);                     \
        target_str = PyUnicode_AsUTF8AndSize(obj, &target_str_len);     \
    }                                                                   \
    else {                                                              \
        PyErr_Format(PyExc_TypeError,                                   \
                     "argument 1 must be read-only bytes-like object, " \
                     "not '%s'",                                        \
                     Py_TYPE(obj)->tp_name);                            \
        return NULL;                                                    \
    }

// obj: PyObject*
// seed: unsigned long
#define MMH3_HASH_VALIDATE_AND_SET_SEED(obj, seed)                      \
    if (!PyLong_Check(obj)) {                                           \
        PyErr_Format(PyExc_TypeError,                                   \
                     "'%s' object cannot be interpreted as an integer", \
                     Py_TYPE(obj)->tp_name);                            \
        return NULL;                                                    \
    }                                                                   \
    seed = PyLong_AsUnsignedLong(obj);                                  \
    if (seed == (unsigned long)-1 && PyErr_Occurred()) {                \
        if (PyErr_ExceptionMatches(PyExc_OverflowError)) {              \
            PyErr_SetString(PyExc_ValueError, "seed is out of range");  \
            return NULL;                                                \
        }                                                               \
    }                                                                   \
    if (seed > 0xFFFFFFFF) {                                            \
        PyErr_SetString(PyExc_ValueError, "seed is out of range");      \
        return NULL;                                                    \
    }

// nargs: Py_ssize_t
// name: const char *
// pos: int
#define MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, name, pos) \
    if (nargs >= pos) {                                      \
        PyErr_Format(PyExc_TypeError,                        \
                     "argument for function given by name "  \
                     "('%s') and position (%d)",             \
                     name, pos);                             \
        return NULL;                                         \
    }

#define MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed)                  \
    if (nargs < 1) {                                                        \
        PyErr_SetString(PyExc_TypeError,                                    \
                        "function takes at least 1 argument (0 given)");    \
        return NULL;                                                        \
    }                                                                       \
    if (nargs > 2) {                                                        \
        PyErr_Format(PyExc_TypeError,                                       \
                     "function takes at most 2 arguments (%d given)",       \
                     (int)nargs);                                           \
        return NULL;                                                        \
    }                                                                       \
    if (nargs == 2) {                                                       \
        if (!PyLong_Check(args[1])) {                                       \
            PyErr_Format(PyExc_TypeError,                                   \
                         "'%s' object cannot be interpreted as an integer", \
                         Py_TYPE(args[1])->tp_name);                        \
            return NULL;                                                    \
        }                                                                   \
        const unsigned long seed_tmp = PyLong_AsUnsignedLong(args[1]);      \
        if (seed_tmp == (unsigned long)-1 && PyErr_Occurred()) {            \
            if (PyErr_ExceptionMatches(PyExc_OverflowError)) {              \
                PyErr_SetString(PyExc_ValueError, "seed is out of range");  \
                return NULL;                                                \
            }                                                               \
        }                                                                   \
        if (seed_tmp > 0xFFFFFFFF) {                                        \
            PyErr_SetString(PyExc_ValueError, "seed is out of range");      \
            return NULL;                                                    \
        }                                                                   \
        seed = (uint32_t)seed_tmp;                                          \
    }

//-----------------------------------------------------------------------------
// One shot functions

PyDoc_STRVAR(
    mmh3_hash_doc,
    "hash(key, seed=0, signed=True) -> int\n"
    "\n"
    "Return a hash as a 32-bit integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_32 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (bytes | str): The input data to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "    signed (Any): If True, return a signed integer. Otherwise, return\n"
    "        an unsigned integer.\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 32-bit integer.\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n"
    "    The type of the ``signed`` argument has been changed from\n"
    "    ``bool`` to ``Any``. Performance improvements have been made.\n");

static PyObject *
mmh3_hash(PyObject *self, PyObject *const *args, Py_ssize_t nargs,
          PyObject *kwnames)
{
    const char *target_str;
    Py_ssize_t target_str_len;
    unsigned long seed = 0;
    int32_t result[1];
    long long_result = 0;
    int is_signed = 1;

#ifndef _MSC_VER
#if __LONG_WIDTH__ == 64 || defined(__APPLE__)
    static uint64_t mask[] = {0x0ffffffff, 0xffffffffffffffff};
#endif
#endif

    if ((nargs < 1) && kwnames == NULL) {
        PyErr_SetString(PyExc_TypeError,
                        "function missing required argument 'key' (pos 1)");
        return NULL;
    }

    if (nargs > 3) {
        PyErr_Format(PyExc_TypeError,
                     "function takes at most 3 arguments (%d given)",
                     (int)nargs);
        return NULL;
    }

    if (nargs >= 1) {
        MMH3_HASH_VALIDATE_AND_SET_BYTES(args[0], target_str, target_str_len);
    }

    if (nargs >= 2) {
        MMH3_HASH_VALIDATE_AND_SET_SEED(args[1], seed);
    }

    if (nargs >= 3) {
        is_signed = PyObject_IsTrue(args[2]);
    }

    if (kwnames) {
        for (Py_ssize_t i = 0; i < PyTuple_Size(kwnames); i++) {
            const char *kwname = PyUnicode_AsUTF8(PyTuple_GetItem(kwnames, i));
            if (strcmp(kwname, "key") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "key", 1);
                MMH3_HASH_VALIDATE_AND_SET_BYTES(args[nargs + i], target_str,
                                                 target_str_len);
            }
            else if (strcmp(kwname, "seed") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "seed", 2);
                MMH3_HASH_VALIDATE_AND_SET_SEED(args[nargs + i], seed);
            }
            else if (strcmp(kwname, "signed") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "signed", 3);
                is_signed = PyObject_IsTrue(args[nargs + i]);
            }
            else {
                PyErr_Format(
                    PyExc_TypeError,
                    "'%s' is an invalid keyword argument for this function",
                    kwname);
                return NULL;
            }
        }
    }

    murmurhash3_x86_32(target_str, target_str_len, (uint32_t)seed, result);

#if defined(_MSC_VER)
    /* for Windows envs */
    long_result = result[0];
    if (is_signed == 1) {
        return PyLong_FromLong(long_result);
    }
    else {
        return PyLong_FromUnsignedLong(long_result);
    }
#else  // defined(_MSC_VER)
    /* for standard envs */
#if __LONG_WIDTH__ == 64 || defined(__APPLE__)
    long_result = result[0] & mask[is_signed];
    return PyLong_FromLong(long_result);
#else   // __LONG_WIDTH__ == 64 || defined(__APPLE__)
    long_result = result[0];
    if (is_signed == 1) {
        return PyLong_FromLong(long_result);
    }
    else {
        return PyLong_FromUnsignedLong(long_result);
    }
#endif  // __LONG_WIDTH__ == 64 || defined(__APPLE__)
#endif  // defined(_MSC_VER)
}

PyDoc_STRVAR(
    mmh3_hash_from_buffer_doc,
    "hash_from_buffer(key, seed=0, signed=True) -> int\n"
    "\n"
    "Return a hash for the buffer as a 32-bit integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_32 algorithm. Designed for large "
    "memory-views such as numpy arrays.\n"
    "\n"
    "Args:\n"
    "    key (Buffer | str): The bufer to hash. String inputs are also\n"
    "        supported and are automatically converted to `bytes` using\n"
    "        UTF-8 encoding before hashing.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "    signed (Any): If True, return a signed integer. Otherwise, return\n"
    "        an unsigned integer.\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 32-bit integer.\n"
    "\n"
    ".. deprecated:: 5.0.0\n"
    "    Use ``mmh3_32_sintdigest()`` or ``mmh3_32_uintdigest()`` instead.\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n"
    "    The type of the ``signed`` argument has been changed from\n"
    "    ``bool`` to ``Any``.\n");

static PyObject *
mmh3_hash_from_buffer(PyObject *self, PyObject *args, PyObject *keywds)
{
    Py_buffer target_buf;
    long long seed = 0;
    int32_t result[1];
    long long_result = 0;
    int is_signed = 1;

    static char *kwlist[] = {"key", "seed", "signed", NULL};

#ifndef _MSC_VER
#if __LONG_WIDTH__ == 64 || defined(__APPLE__)
    static uint64_t mask[] = {0x0ffffffff, 0xffffffffffffffff};
#endif
#endif

    if (!PyArg_ParseTupleAndKeywords(args, keywds, "s*|Lp", kwlist,
                                     &target_buf, &seed, &is_signed)) {
        return NULL;
    }

    MMH3_VALIDATE_SEED_RETURN_NULL(seed);

    murmurhash3_x86_32(target_buf.buf, target_buf.len, (uint32_t)seed, result);

    PyBuffer_Release(&target_buf);

#if defined(_MSC_VER)
    /* for Windows envs */
    long_result = result[0];
    if (is_signed == 1) {
        return PyLong_FromLong(long_result);
    }
    else {
        return PyLong_FromUnsignedLong(long_result);
    }
#else  // defined(_MSC_VER)
/* for standard envs */
#if __LONG_WIDTH__ == 64 || defined(__APPLE__)
    long_result = result[0] & mask[is_signed];
    return PyLong_FromLong(long_result);
#else   // __LONG_WIDTH__ == 64 || defined(__APPLE__)
    long_result = result[0];
    if (is_signed == 1) {
        return PyLong_FromLong(long_result);
    }
    else {
        return PyLong_FromUnsignedLong(long_result);
    }
#endif  // __LONG_WIDTH__ == 64 || defined(__APPLE__)
#endif  // defined(_MSC_VER)
}

PyDoc_STRVAR(
    mmh3_hash64_doc,
    "hash64(key, seed=0, x64arch=True, signed=True) -> tuple[int, int]\n"
    "\n"
    "Return a hash as a tuple of two 64-bit integers.\n"
    "\n"
    "Calculated by the MurmurHash3_x{64, 86}_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (bytes | str): The input data to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "    x64arch (Any): If True, use an algorithm optimized for 64-bit\n"
    "        architecture. Otherwise, use one optimized for 32-bit\n"
    "        architecture.\n"
    "    signed (Any): If True, return a signed integer. Otherwise, return\n"
    "        an unsigned integer.\n"
    "\n"
    "Returns:\n"
    "    tuple[int, int]: The hash value as a tuple of two 64-bit "
    "integers.\n"
    "\n"
    ".. versionchanged:: 5.1.0\n"
    "    Performance improvements.\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n"
    "    The type of the ``x64arch`` and ``signed`` arguments has been\n"
    "    changed from ``bool`` to ``Any``.\n");

static PyObject *
mmh3_hash64(PyObject *self, PyObject *const *args, Py_ssize_t nargs,
            PyObject *kwnames)
{
    const char *target_str;
    Py_ssize_t target_str_len;
    long long seed = 0;
    uint64_t result[2];
    int x64arch = 1;
    int is_signed = 1;

    static char *valflag[] = {"KK", "LL"};

    if ((nargs < 1) && kwnames == NULL) {
        PyErr_SetString(PyExc_TypeError,
                        "function missing required argument 'key' (pos 1)");
        return NULL;
    }

    if (nargs > 4) {
        PyErr_Format(PyExc_TypeError,
                     "function takes at most 4 arguments (%d given)",
                     (int)nargs);
        return NULL;
    }

    if (nargs >= 1) {
        MMH3_HASH_VALIDATE_AND_SET_BYTES(args[0], target_str, target_str_len);
    }

    if (nargs >= 2) {
        MMH3_HASH_VALIDATE_AND_SET_SEED(args[1], seed);
    }

    if (nargs >= 3) {
        x64arch = PyObject_IsTrue(args[2]);
    }

    if (nargs >= 4) {
        is_signed = PyObject_IsTrue(args[2]);
    }

    if (kwnames) {
        for (Py_ssize_t i = 0; i < PyTuple_Size(kwnames); i++) {
            const char *kwname = PyUnicode_AsUTF8(PyTuple_GetItem(kwnames, i));
            if (strcmp(kwname, "key") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "key", 1);
                MMH3_HASH_VALIDATE_AND_SET_BYTES(args[nargs + i], target_str,
                                                 target_str_len);
            }
            else if (strcmp(kwname, "seed") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "seed", 2);
                MMH3_HASH_VALIDATE_AND_SET_SEED(args[nargs + i], seed);
            }
            else if (strcmp(kwname, "x64arch") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "x64arch", 3);
                x64arch = PyObject_IsTrue(args[nargs + i]);
            }
            else if (strcmp(kwname, "signed") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "signed", 4);
                is_signed = PyObject_IsTrue(args[nargs + i]);
            }
            else {
                PyErr_Format(
                    PyExc_TypeError,
                    "'%s' is an invalid keyword argument for this function",
                    kwname);
                return NULL;
            }
        }
    }

    if (x64arch == 1) {
        murmurhash3_x64_128(target_str, target_str_len, (uint32_t)seed,
                            result);
    }
    else {
        murmurhash3_x86_128(target_str, target_str_len, (uint32_t)seed,
                            result);
    }

    PyObject *retval = Py_BuildValue(valflag[is_signed], result[0], result[1]);
    return retval;
}

PyDoc_STRVAR(
    mmh3_hash128_doc,
    "hash128(key, seed=0, x64arch=True, signed=False) -> int\n"
    "\n"
    "Return a hash as a 128-bit integer.\n\n"
    "Calculated by the MurmurHash3_x{64, 86}_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (bytes | str): The input data to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "    x64arch (Any): If True, use an algorithm optimized for 64-bit\n"
    "        architecture. Otherwise, use one optimized for 32-bit\n"
    "        architecture.\n"
    "    signed (Any): If True, return a signed integer. Otherwise, return\n"
    "        an unsigned integer.\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 128-bit integer.\n"
    "\n"
    ".. versionchanged:: 5.1.0\n"
    "    Performance improvements.\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n"
    "    The type of the ``x64arch`` and ``signed`` arguments has been\n"
    "    changed from ``bool`` to ``Any``.\n");

static PyObject *
mmh3_hash128(PyObject *self, PyObject *const *args, Py_ssize_t nargs,
             PyObject *kwnames)
{
    const char *target_str;
    Py_ssize_t target_str_len;
    long long seed = 0;
    uint64_t result[2];
    int x64arch = 1;
    int is_signed = 0;

    if ((nargs < 1) && kwnames == NULL) {
        PyErr_SetString(PyExc_TypeError,
                        "function missing required argument 'key' (pos 1)");
        return NULL;
    }

    if (nargs > 4) {
        PyErr_Format(PyExc_TypeError,
                     "function takes at most 4 arguments (%d given)",
                     (int)nargs);
        return NULL;
    }

    if (nargs >= 1) {
        MMH3_HASH_VALIDATE_AND_SET_BYTES(args[0], target_str, target_str_len);
    }

    if (nargs >= 2) {
        MMH3_HASH_VALIDATE_AND_SET_SEED(args[1], seed);
    }

    if (nargs >= 3) {
        x64arch = PyObject_IsTrue(args[2]);
    }

    if (nargs >= 4) {
        is_signed = PyObject_IsTrue(args[2]);
    }

    if (kwnames) {
        for (Py_ssize_t i = 0; i < PyTuple_Size(kwnames); i++) {
            const char *kwname = PyUnicode_AsUTF8(PyTuple_GetItem(kwnames, i));
            if (strcmp(kwname, "key") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "key", 1);
                MMH3_HASH_VALIDATE_AND_SET_BYTES(args[nargs + i], target_str,
                                                 target_str_len);
            }
            else if (strcmp(kwname, "seed") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "seed", 2);
                MMH3_HASH_VALIDATE_AND_SET_SEED(args[nargs + i], seed);
            }
            else if (strcmp(kwname, "x64arch") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "x64arch", 3);
                x64arch = PyObject_IsTrue(args[nargs + i]);
            }
            else if (strcmp(kwname, "signed") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "signed", 4);
                is_signed = PyObject_IsTrue(args[nargs + i]);
            }
            else {
                PyErr_Format(
                    PyExc_TypeError,
                    "'%s' is an invalid keyword argument for this function",
                    kwname);
                return NULL;
            }
        }
    }

    if (x64arch == 1) {
        murmurhash3_x64_128(target_str, target_str_len, seed, result);
    }
    else {
        murmurhash3_x86_128(target_str, target_str_len, seed, result);
    }

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray(
        (unsigned char *)result, MMH3_128_DIGESTSIZE, 1, is_signed);

    return retval;
}

PyDoc_STRVAR(
    mmh3_hash_bytes_doc,
    "hash_bytes(key, seed=0, x64arch=True) -> bytes\n"
    "\n"
    "Return a 16-byte hash of the ``bytes`` type.\n"
    "\n"
    "Args:\n"
    "    key (bytes | str): The input data to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "    x64arch (Any): If True, use an algorithm optimized for 64-bit\n"
    "        architecture. Otherwise, use one optimized for 32-bit\n"
    "        architecture.\n"
    "Returns:\n"
    "    bytes: The hash value as the ``bytes`` type with a length of 16\n"
    "    bytes (128 bits).\n")
    "\n"
    ".. versionchanged:: 5.1.0\n"
    "    Performance improvements.\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n"
    "    The type of the ``x64arch`` argument has been changed from\n"
    "    ``bool`` to ``Any``.\n";

static PyObject *
mmh3_hash_bytes(PyObject *self, PyObject *const *args, Py_ssize_t nargs,
                PyObject *kwnames)
{
    const char *target_str;
    Py_ssize_t target_str_len;
    long long seed = 0;
    uint64_t result[2];
    int x64arch = 1;

    if ((nargs < 1) && kwnames == NULL) {
        PyErr_SetString(PyExc_TypeError,
                        "function missing required argument 'key' (pos 1)");
        return NULL;
    }

    if (nargs > 3) {
        PyErr_Format(PyExc_TypeError,
                     "function takes at most 3 arguments (%d given)",
                     (int)nargs);
        return NULL;
    }

    if (nargs >= 1) {
        MMH3_HASH_VALIDATE_AND_SET_BYTES(args[0], target_str, target_str_len);
    }

    if (nargs >= 2) {
        MMH3_HASH_VALIDATE_AND_SET_SEED(args[1], seed);
    }

    if (nargs >= 3) {
        x64arch = PyObject_IsTrue(args[2]);
    }

    if (kwnames) {
        for (Py_ssize_t i = 0; i < PyTuple_Size(kwnames); i++) {
            const char *kwname = PyUnicode_AsUTF8(PyTuple_GetItem(kwnames, i));
            if (strcmp(kwname, "key") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "key", 1);
                MMH3_HASH_VALIDATE_AND_SET_BYTES(args[nargs + i], target_str,
                                                 target_str_len);
            }
            else if (strcmp(kwname, "seed") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "seed", 2);
                MMH3_HASH_VALIDATE_AND_SET_SEED(args[nargs + i], seed);
            }
            else if (strcmp(kwname, "x64arch") == 0) {
                MMH3_HASH_VALIDATE_ARG_DUPLICATION(nargs, "x64arch", 3);
                x64arch = PyObject_IsTrue(args[nargs + i]);
            }
            else {
                PyErr_Format(
                    PyExc_TypeError,
                    "'%s' is an invalid keyword argument for this function",
                    kwname);
                return NULL;
            }
        }
    }

    if (x64arch == 1) {
        murmurhash3_x64_128(target_str, target_str_len, seed, result);
    }
    else {
        murmurhash3_x86_128(target_str, target_str_len, seed, result);
    }

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    return PyBytes_FromStringAndSize((char *)result, MMH3_128_DIGESTSIZE);
}

//-----------------------------------------------------------------------------
// Functions that accept a buffer

PyDoc_STRVAR(
    mmh3_mmh3_32_digest_doc,
    "mmh3_32_digest(key, seed=0, /) -> bytes\n"
    "\n"
    "Return a 4-byte hash of the ``bytes`` type for the buffer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_32 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    bytes: The hash value as the ``bytes`` type with a length of\n"
    "    4 bytes (32 bits).\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_32_digest(PyObject *self, PyObject *const *args, Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    char result[MMH3_32_DIGESTSIZE];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_32(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    ((uint32_t *)result)[0] = bswap_32(((uint32_t *)result)[0]);
#endif

    return PyBytes_FromStringAndSize((char *)result, MMH3_32_DIGESTSIZE);
}

PyDoc_STRVAR(
    mmh3_mmh3_32_sintdigest_doc,
    "mmh3_32_sintdigest(key, seed=0, /) -> int\n"
    "\n"
    "Return a hash for the buffer as a 32-bit signed integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_32 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 32-bit signed integer.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_32_sintdigest(PyObject *self, PyObject *const *args,
                        Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    int32_t result[1];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_32(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

    return PyLong_FromLong(result[0]);
}

PyDoc_STRVAR(
    mmh3_mmh3_32_uintdigest_doc,
    "mmh3_32_uintdigest(key, seed=0, /) -> int\n"
    "\n"
    "Return a hash for the buffer as a 32-bit unsigned integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_32 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 32-bit unsigned integer.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_32_uintdigest(PyObject *self, PyObject *const *args,
                        Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint32_t result[1];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_32(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

    return PyLong_FromUnsignedLong(result[0]);
}

PyDoc_STRVAR(
    mmh3_mmh3_x64_128_digest_doc,
    "mmh3_x64_128_digest(key, seed=0, /) -> bytes\n"
    "\n"
    "Return a 16-byte hash of the ``bytes`` type for the buffer.\n"
    "\n"
    "Calculated by the MurmurHash3_x64_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    bytes: The hash value as the ``bytes`` type with a length of\n"
    "    16 bytes (128 bits).\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x64_128_digest(PyObject *self, PyObject *const *args,
                         Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x64_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    return PyBytes_FromStringAndSize((char *)result, MMH3_128_DIGESTSIZE);
}

PyDoc_STRVAR(
    mmh3_mmh3_x64_128_sintdigest_doc,
    "mmh3_x64_128_sintdigest(key, seed=0, /) -> int\n"
    "\n"
    "Return a hash for the buffer as a 128-bit signed integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x64_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 128-bit signed integer.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x64_128_sintdigest(PyObject *self, PyObject *const *args,
                             Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x64_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray((unsigned char *)result,
                                             MMH3_128_DIGESTSIZE, 1, 1);

    return retval;
}

PyDoc_STRVAR(
    mmh3_mmh3_x64_128_uintdigest_doc,
    "mmh3_x64_128_uintdigest(key, seed=0, /) -> int\n"
    "\n"
    "Return a hash for the buffer as a 128-bit unsigned integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x64_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 128-bit unsigned integer.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x64_128_uintdigest(PyObject *self, PyObject *const *args,
                             Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x64_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray((unsigned char *)result,
                                             MMH3_128_DIGESTSIZE, 1, 0);

    return retval;
}

PyDoc_STRVAR(
    mmh3_mmh3_x64_128_stupledigest_doc,
    "mmh3_x64_128_stupledigest(key, seed=0, /) -> tuple[int, int]\n"
    "\n"
    "Return a hash for the buffer as a tuple of two 64-bit signed integers.\n"
    "\n"
    "Calculated by the MurmurHash3_x64_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    tuple[int, int]: The hash value as a tuple of two 64-bit signed\n"
    "    integers.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x64_128_stupledigest(PyObject *self, PyObject *const *args,
                               Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x64_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

    PyObject *retval = Py_BuildValue("LL", result[0], result[1]);
    return retval;
}

PyDoc_STRVAR(
    mmh3_mmh3_x64_128_utupledigest_doc,
    "mmh3_x64_128_utupledigest(key, seed=0, /) -> tuple[int, int]\n"
    "\n"
    "Return a hash for the buffer as a tuple of two 64-bit unsigned "
    "integers.\n"
    "\n"
    "Calculated by the MurmurHash3_x64_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    tuple[int, int]: The hash value as a tuple of two 64-bit unsigned\n"
    "    integers.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x64_128_utupledigest(PyObject *self, PyObject *const *args,
                               Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x64_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

    PyObject *retval = Py_BuildValue("KK", result[0], result[1]);
    return retval;
}

PyDoc_STRVAR(
    mmh3_mmh3_x86_128_digest_doc,
    "mmh3_x86_128_digest(key, seed=0, /) -> bytes\n"
    "\n"
    "Return a 16-byte hash of the ``bytes`` type for the buffer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    bytes: The hash value as the ``bytes`` type with a length of\n"
    "    16 bytes (128 bits).\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x86_128_digest(PyObject *self, PyObject *const *args,
                         Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    return PyBytes_FromStringAndSize((char *)result, MMH3_128_DIGESTSIZE);
}

PyDoc_STRVAR(
    mmh3_mmh3_x86_128_sintdigest_doc,
    "mmh3_x86_128_sintdigest(key, seed=0, /) -> int\n"
    "\n"
    "Return a hash for the buffer as a 128-bit signed integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as an signed 128-bit integer.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x86_128_sintdigest(PyObject *self, PyObject *const *args,
                             Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray((unsigned char *)result,
                                             MMH3_128_DIGESTSIZE, 1, 1);

    return retval;
}

PyDoc_STRVAR(
    mmh3_mmh3_x86_128_uintdigest_doc,
    "mmh3_x86_128_uintdigest(key, seed=0, /) -> int\n"
    "\n"
    "Return a hash for the buffer as a 128-bit unsigned integer.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    int: The hash value as a 128-bit unsigned integer.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x86_128_uintdigest(PyObject *self, PyObject *const *args,
                             Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result[0] = bswap_64(result[0]);
    result[1] = bswap_64(result[1]);
#endif

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray((unsigned char *)result,
                                             MMH3_128_DIGESTSIZE, 1, 0);

    return retval;
}

PyDoc_STRVAR(
    mmh3_mmh3_x86_128_stupledigest_doc,
    "mmh3_x86_128_stupledigest(key, seed=0, /) -> tuple[int, int]\n"
    "\n"
    "Return a hash for the buffer as a tuple of two 64-bit signed integers.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    tuple[int, int]: The hash value as a tuple of two 64-bit signed\n"
    "    integers.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x86_128_stupledigest(PyObject *self, PyObject *const *args,
                               Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

    PyObject *retval = Py_BuildValue("LL", result[0], result[1]);
    return retval;
}

PyDoc_STRVAR(
    mmh3_mmh3_x86_128_utupledigest_doc,
    "mmh3_x86_128_utupledigest(key, seed=0, /) -> tuple[int, int]\n"
    "\n"
    "Return a hash for the buffer as a tuple of two 64-bit unsigned "
    "integers.\n"
    "\n"
    "Calculated by the MurmurHash3_x86_128 algorithm.\n"
    "\n"
    "Args:\n"
    "    key (Buffer): The input buffer to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    "Returns:\n"
    "    tuple[int, int]: The hash value as a tuple of two 64-bit unsigned\n"
    "    integers.\n"
    "\n"
    ".. versionadded:: 5.0.0\n");

static PyObject *
mmh3_mmh3_x86_128_utupledigest(PyObject *self, PyObject *const *args,
                               Py_ssize_t nargs)
{
    Py_buffer target_buf;
    uint32_t seed = 0;
    uint64_t result[2];

    MMH3_VALIDATE_ARGS_AND_SET_SEED(nargs, args, seed);

    GET_BUFFER_VIEW_OR_ERROUT(args[0], &target_buf);

    murmurhash3_x86_128(target_buf.buf, target_buf.len, seed, result);
    PyBuffer_Release(&target_buf);

    PyObject *retval = Py_BuildValue("KK", result[0], result[1]);
    return retval;
}

// Casting to PyCFunction is mandatory for
//   METH_VARARGS | METH_KEYWORDS functions.
// See
// https://docs.python.org/3/extending/extending.html#keyword-parameters-for-extension-functions
static PyMethodDef Mmh3Methods[] = {
    {"hash", (PyCFunction)mmh3_hash, METH_FASTCALL | METH_KEYWORDS,
     mmh3_hash_doc},
    {"hash_from_buffer", (PyCFunction)mmh3_hash_from_buffer,
     METH_VARARGS | METH_KEYWORDS, mmh3_hash_from_buffer_doc},
    {"hash64", (PyCFunction)mmh3_hash64, METH_FASTCALL | METH_KEYWORDS,
     mmh3_hash64_doc},
    {"hash128", (PyCFunction)mmh3_hash128, METH_FASTCALL | METH_KEYWORDS,
     mmh3_hash128_doc},
    {"hash_bytes", (PyCFunction)mmh3_hash_bytes, METH_FASTCALL | METH_KEYWORDS,
     mmh3_hash_bytes_doc},
    {"mmh3_32_digest", (PyCFunction)mmh3_mmh3_32_digest, METH_FASTCALL,
     mmh3_mmh3_32_digest_doc},
    {"mmh3_32_sintdigest", (PyCFunction)mmh3_mmh3_32_sintdigest, METH_FASTCALL,
     mmh3_mmh3_32_sintdigest_doc},
    {"mmh3_32_uintdigest", (PyCFunction)mmh3_mmh3_32_uintdigest, METH_FASTCALL,
     mmh3_mmh3_32_uintdigest_doc},
    {"mmh3_x64_128_digest", (PyCFunction)mmh3_mmh3_x64_128_digest,
     METH_FASTCALL, mmh3_mmh3_x64_128_digest_doc},
    {"mmh3_x64_128_sintdigest", (PyCFunction)mmh3_mmh3_x64_128_sintdigest,
     METH_FASTCALL, mmh3_mmh3_x64_128_sintdigest_doc},
    {"mmh3_x64_128_uintdigest", (PyCFunction)mmh3_mmh3_x64_128_uintdigest,
     METH_FASTCALL, mmh3_mmh3_x64_128_uintdigest_doc},
    {"mmh3_x64_128_stupledigest", (PyCFunction)mmh3_mmh3_x64_128_stupledigest,
     METH_FASTCALL, mmh3_mmh3_x64_128_stupledigest_doc},
    {"mmh3_x64_128_utupledigest", (PyCFunction)mmh3_mmh3_x64_128_utupledigest,
     METH_FASTCALL, mmh3_mmh3_x64_128_utupledigest_doc},
    {"mmh3_x86_128_digest", (PyCFunction)mmh3_mmh3_x86_128_digest,
     METH_FASTCALL, mmh3_mmh3_x86_128_digest_doc},
    {"mmh3_x86_128_sintdigest", (PyCFunction)mmh3_mmh3_x86_128_sintdigest,
     METH_FASTCALL, mmh3_mmh3_x86_128_sintdigest_doc},
    {"mmh3_x86_128_uintdigest", (PyCFunction)mmh3_mmh3_x86_128_uintdigest,
     METH_FASTCALL, mmh3_mmh3_x86_128_uintdigest_doc},
    {"mmh3_x86_128_stupledigest", (PyCFunction)mmh3_mmh3_x86_128_stupledigest,
     METH_FASTCALL, mmh3_mmh3_x86_128_stupledigest_doc},
    {"mmh3_x86_128_utupledigest", (PyCFunction)mmh3_mmh3_x86_128_utupledigest,
     METH_FASTCALL, mmh3_mmh3_x86_128_utupledigest_doc},
    {NULL, NULL, 0, NULL}};

//-----------------------------------------------------------------------------
// Hasher classes
//
// The design of hasher classes are loosely based on the Google Guava
// implementation (Java)

//-----------------------------------------------------------------------------
// Hasher for murmurhash3_x86_32
typedef struct {
    PyObject_HEAD uint32_t h;
    uint64_t buffer;
    uint8_t shift;
    Py_ssize_t length;
} MMH3Hasher32;

static PyTypeObject MMH3Hasher32Type;

static FORCE_INLINE void
update32_impl(MMH3Hasher32 *self, Py_buffer *buf)
{
    Py_ssize_t i = 0;
    uint32_t h1 = self->h;
    uint32_t k1 = 0;
    const uint32_t c1 = 0xe6546b64;
    const uint64_t mask = 0xffffffffUL;

    for (; i + 4 <= buf->len; i += 4) {
        k1 = getblock32(buf->buf, i / 4);
        self->buffer |= (k1 & mask) << self->shift;
        self->length += 4;

        h1 ^= mixK1(self->buffer);
        h1 = mixH1(h1, 0, 13, c1);
        self->buffer >>= 32;
    }

    for (; i < buf->len; i++) {
        k1 = ((uint8_t *)buf->buf)[i];
        self->buffer |= (k1 & mask) << self->shift;
        self->shift += 8;
        self->length += 1;

        if (self->shift >= 32) {
            h1 ^= mixK1(self->buffer);
            h1 = mixH1(h1, 0, 13, c1);
            self->buffer >>= 32;
            self->shift -= 32;
        }
    }

    PyBuffer_Release(buf);

    self->h = h1;

    return;
}

static void
MMH3Hasher32_dealloc(MMH3Hasher32 *self)
{
    Py_TYPE(self)->tp_free((PyObject *)self);
}

static PyObject *
MMH3Hasher32_new(PyTypeObject *type, PyObject *args, PyObject *kwds)
{
    MMH3Hasher32 *self;
    self = (MMH3Hasher32 *)type->tp_alloc(type, 0);
    if (self != NULL) {
        self->h = 0;
        self->buffer = 0;
        self->shift = 0;
        self->length = 0;
    }
    return (PyObject *)self;
}

/* It is impossible to add docstring for __init__ in Python C extension.
  Therefore, the contsructor docstring should be described in the class
  docstring. See also https://stackoverflow.com/q/11913492 */
static int
MMH3Hasher32_init(MMH3Hasher32 *self, PyObject *args, PyObject *kwds)
{
    Py_buffer target_buf = {0};
    long long seed = 0;
    static char *kwlist[] = {"data", "seed", NULL};

    if (!PyArg_ParseTupleAndKeywords(args, kwds, "|y*L", kwlist, &target_buf,
                                     &seed))
        return -1;

    MMH3_VALIDATE_SEED_RETURN_INT(seed, target_buf);

    self->h = (uint32_t)seed;

    if (target_buf.buf != NULL) {
        // target_buf will be released in update32_impl
        update32_impl(self, &target_buf);
    }

    return 0;
}

PyDoc_STRVAR(
    MMH3Hasher_update_doc,
    "update(data)\n"
    "\n"
    "Update this hash object's state with the provided bytes-like object.\n"
    "\n"
    "Args:\n"
    "    data (Buffer): The buffer to hash.\n");

static PyObject *
MMH3Hasher32_update(MMH3Hasher32 *self, PyObject *obj)
{
    Py_buffer buf;

    GET_BUFFER_VIEW_OR_ERROUT(obj, &buf);

    // buf will be released in update32_impl
    update32_impl(self, &buf);

    Py_RETURN_NONE;
}

static FORCE_INLINE uint32_t
digest32_impl(uint32_t h, uint64_t k1, Py_ssize_t length)
{
    h ^= mixK1(k1);
    h ^= length;
    h = fmix32(h);
    return h;
}

PyDoc_STRVAR(MMH3Hasher_digest_doc,
             "digest() -> bytes\n"
             "\n"
             "Return the digest value as a ``bytes`` object.\n"
             "\n"
             "Returns:\n"
             "    bytes: The digest value.\n");

static PyObject *
MMH3Hasher32_digest(MMH3Hasher32 *self, PyObject *Py_UNUSED(ignored))
{
    uint32_t h = digest32_impl(self->h, self->buffer, self->length);
    char out[MMH3_32_DIGESTSIZE];

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    ((uint32_t *)out)[0] = bswap_32(h);
#else
    ((uint32_t *)out)[0] = h;
#endif

    return PyBytes_FromStringAndSize(out, MMH3_32_DIGESTSIZE);
}

PyDoc_STRVAR(MMH3Hasher_sintdigest_doc,
             "sintdigest() -> int\n"
             "\n"
             "Return the digest value as a signed integer.\n"
             "\n"
             "Returns:\n"
             "    int: The digest value as a signed integer.\n");

static PyObject *
MMH3Hasher32_sintdigest(MMH3Hasher32 *self, PyObject *Py_UNUSED(ignored))
{
    uint32_t h = digest32_impl(self->h, self->buffer, self->length);

    // Note that simple casting ("(int32_t) h") is an undefined behavior
    int32_t result = *(int32_t *)&h;

    return PyLong_FromLong(result);
}

PyDoc_STRVAR(MMH3Hasher_uintdigest_doc,
             "uintdigest() -> int\n"
             "\n"
             "Return the digest value as an unsigned integer.\n"
             "\n"
             "Returns:\n"
             "    int: The digest value as an unsigned integer.\n");

static PyObject *
MMH3Hasher32_uintdigest(MMH3Hasher32 *self, PyObject *Py_UNUSED(ignored))
{
    uint32_t h = digest32_impl(self->h, self->buffer, self->length);
    return PyLong_FromUnsignedLong(h);
}

PyDoc_STRVAR(MMH3Hasher32_copy_doc,
             "copy() -> mmh3_32\n"
             "\n"
             "Return a copy of the hash object..\n"
             "\n"
             "Returns:\n"
             "    mmh3_32: A copy of this hash object.\n");

static PyObject *
MMH3Hasher32_copy(MMH3Hasher32 *self, PyObject *Py_UNUSED(ignored))
{
    MMH3Hasher32 *p;

    if ((p = PyObject_New(MMH3Hasher32, &MMH3Hasher32Type)) == NULL) {
        return NULL;
    }

    p->h = self->h;
    p->buffer = self->buffer;
    p->shift = self->shift;
    p->length = self->length;

    return (PyObject *)p;
}

static PyMethodDef MMH3Hasher32_methods[] = {
    {"update", (PyCFunction)MMH3Hasher32_update, METH_O,
     MMH3Hasher_update_doc},
    {
        "digest",
        (PyCFunction)MMH3Hasher32_digest,
        METH_NOARGS,
        MMH3Hasher_digest_doc,
    },
    {"sintdigest", (PyCFunction)MMH3Hasher32_sintdigest, METH_NOARGS,
     MMH3Hasher_sintdigest_doc},
    {"uintdigest", (PyCFunction)MMH3Hasher32_uintdigest, METH_NOARGS,
     MMH3Hasher_uintdigest_doc},
    {"copy", (PyCFunction)MMH3Hasher32_copy, METH_NOARGS,
     MMH3Hasher32_copy_doc},
    {NULL} /* Sentinel */
};

static PyObject *
MMH3Hasher32_get_digest_size(PyObject *self, void *closure)
{
    return PyLong_FromLong(MMH3_32_DIGESTSIZE);
}

static PyObject *
MMH3Hasher32_get_block_size(PyObject *self, void *closure)
{
    return PyLong_FromLong(MMH3_32_BLOCKSIZE);
}

static PyObject *
MMH3Hasher32_get_name(PyObject *self, void *closure)
{
    return PyUnicode_FromStringAndSize("mmh3_32", 7);
}

static PyGetSetDef MMH3Hasher32_getsetters[] = {
    {"digest_size", (getter)MMH3Hasher32_get_digest_size, NULL,
     "int: Number of bytes in this hashes output", NULL},
    {"block_size", (getter)MMH3Hasher32_get_block_size, NULL,
     "int: Number of bytes of the internal block of this algorithm", NULL},
    {"name", (getter)MMH3Hasher32_get_name, NULL,
     "str: The hash algorithm being used by this object", NULL},
    {NULL} /* Sentinel */
};

PyDoc_STRVAR(
    MMH3Hasher32Type_doc,
    "__init__(data=None, seed=0)\n"
    "\n"
    "Hasher for incrementally calculating the murmurhash3_x86_32 hash.\n"
    "\n"
    "Args:\n"
    "    data (Buffer | None): The initial data to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    Added the optional ``data`` parameter as the first argument.\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n");

static PyTypeObject MMH3Hasher32Type = {
    PyVarObject_HEAD_INIT(NULL, 0).tp_name = "mmh3.mmh3_32",
    .tp_doc = MMH3Hasher32Type_doc,
    .tp_basicsize = sizeof(MMH3Hasher32),
    .tp_itemsize = 0,
    .tp_flags = Py_TPFLAGS_DEFAULT,
    .tp_new = MMH3Hasher32_new,
    .tp_init = (initproc)MMH3Hasher32_init,
    .tp_dealloc = (destructor)MMH3Hasher32_dealloc,
    .tp_methods = MMH3Hasher32_methods,
    .tp_getset = MMH3Hasher32_getsetters,
};

//-----------------------------------------------------------------------------
// Hasher for murmurhash3_x64_128
typedef struct {
    PyObject_HEAD uint64_t h1;
    uint64_t h2;
    uint64_t buffer1;
    uint64_t buffer2;
    uint8_t shift;
    Py_ssize_t length;
} MMH3Hasher128x64;

static PyTypeObject MMH3Hasher128x64Type;

static FORCE_INLINE void
update_x64_128_impl(MMH3Hasher128x64 *self, Py_buffer *buf)
{
    Py_ssize_t i = 0;
    uint64_t h1 = self->h1;
    uint64_t h2 = self->h2;
    uint64_t k1 = 0;
    uint64_t k2 = 0;

    for (; i + 16 <= buf->len; i += 16) {
        k1 = getblock64(buf->buf, (i / 16) * 2);
        k2 = getblock64(buf->buf, (i / 16) * 2 + 1);

        if (self->shift == 0) {  // TODO: use bit ops
            self->buffer1 = k1;
            self->buffer2 = k2;
        }
        else if (self->shift < 64) {
            self->buffer1 |= k1 << self->shift;
            self->buffer2 = (k1 >> (64 - self->shift)) | (k2 << self->shift);
        }
        else if (self->shift == 64) {
            self->buffer2 = k1;
        }
        else {
            self->buffer2 |= k1 << (self->shift - 64);
        }

        h1 ^= mixK1_x64_128(self->buffer1);
        h1 = mixH_x64_128(h1, h2, 27, 0x52dce729UL);
        h2 ^= mixK2_x64_128(self->buffer2);
        h2 = mixH_x64_128(h2, h1, 31, 0x38495ab5UL);

        self->length += 16;
        if (self->shift == 0) {  // TODO: use bit ops
            self->buffer1 = 0;
            self->buffer2 = 0;
        }
        else if (self->shift < 64) {
            self->buffer1 = k2 >> (64 - self->shift);
            self->buffer2 = 0;
        }
        else if (self->shift == 64) {
            self->buffer1 = k2;
            self->buffer2 = 0;
        }
        else {
            self->buffer1 =
                k1 >> (128 - self->shift) | (k2 << (self->shift - 64));
            self->buffer2 = k2 >> (128 - self->shift);
        }
    }

    for (; i < buf->len; i++) {
        k1 = ((uint8_t *)buf->buf)[i];
        if (self->shift < 64) {  // TODO: use bit ops
            self->buffer1 |= k1 << self->shift;
        }
        else {
            self->buffer2 |= k1 << (self->shift - 64);
        }
        self->shift += 8;
        self->length += 1;

        if (self->shift >= 128) {
            h1 ^= mixK1_x64_128(self->buffer1);
            h1 = mixH_x64_128(h1, h2, 27, 0x52dce729UL);
            h2 ^= mixK2_x64_128(self->buffer2);
            h2 = mixH_x64_128(h2, h1, 31, 0x38495ab5UL);

            self->buffer1 = 0;
            self->buffer2 = 0;
            self->shift -= 128;
        }
    }

    PyBuffer_Release(buf);

    self->h1 = h1;
    self->h2 = h2;
}

static void
MMH3Hasher128x64_dealloc(MMH3Hasher128x64 *self)
{
    Py_TYPE(self)->tp_free((PyObject *)self);
}

static PyObject *
MMH3Hasher128x64_new(PyTypeObject *type, PyObject *args, PyObject *kwds)
{
    MMH3Hasher128x64 *self;
    self = (MMH3Hasher128x64 *)type->tp_alloc(type, 0);
    if (self != NULL) {
        self->h1 = 0;
        self->h2 = 0;
        self->buffer1 = 0;
        self->buffer2 = 0;
        self->shift = 0;
        self->length = 0;
    }
    return (PyObject *)self;
}

static int
MMH3Hasher128x64_init(MMH3Hasher128x64 *self, PyObject *args, PyObject *kwds)
{
    Py_buffer target_buf = {0};
    long long seed = 0;
    static char *kwlist[] = {"data", "seed", NULL};

    if (!PyArg_ParseTupleAndKeywords(args, kwds, "|y*L", kwlist, &target_buf,
                                     &seed))
        return -1;

    MMH3_VALIDATE_SEED_RETURN_INT(seed, target_buf);

    self->h1 = (uint64_t)seed;
    self->h2 = self->h1;

    if (target_buf.buf != NULL) {
        // target_buf will be released in update_x64_128_impl
        update_x64_128_impl(self, &target_buf);
    }

    return 0;
}

static PyObject *
MMH3Hasher128x64_update(MMH3Hasher128x64 *self, PyObject *obj)
{
    Py_buffer buf;

    GET_BUFFER_VIEW_OR_ERROUT(obj, &buf);

    // buf will be released in update_x64_128_impl
    update_x64_128_impl(self, &buf);

    Py_RETURN_NONE;
}

static PyObject *
MMH3Hasher128x64_digest(MMH3Hasher128x64 *self, PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x64_128_impl(self->h1, self->h2, self->buffer1, self->buffer2,
                        self->length, out);
    return PyBytes_FromStringAndSize(out, MMH3_128_DIGESTSIZE);
}

static PyObject *
MMH3Hasher128x64_sintdigest(MMH3Hasher128x64 *self,
                            PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x64_128_impl(self->h1, self->h2, self->buffer1, self->buffer2,
                        self->length, out);
    const int little_endian = 1;
    const int is_signed = 1;

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray(
        (unsigned char *)out, MMH3_128_DIGESTSIZE, little_endian, is_signed);

    return retval;
}

static PyObject *
MMH3Hasher128x64_uintdigest(MMH3Hasher128x64 *self,
                            PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x64_128_impl(self->h1, self->h2, self->buffer1, self->buffer2,
                        self->length, out);
    const int little_endian = 1;
    const int is_signed = 0;

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray(
        (unsigned char *)out, MMH3_128_DIGESTSIZE, little_endian, is_signed);

    return retval;
}

PyDoc_STRVAR(MMH3Hasher128_stupledigest_doc,
             "stupledigest() -> tuple[int, int]\n"
             "\n"
             "Return the digest value as a tuple of two signed integers.\n"
             "\n"
             "Returns:\n"
             "    tuple[int, int]: The digest value as a tuple of two signed\n"
             "    integers.\n");

static PyObject *
MMH3Hasher128x64_stupledigest(MMH3Hasher128x64 *self,
                              PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x64_128_impl(self->h1, self->h2, self->buffer1, self->buffer2,
                        self->length, out);

    const char *valflag = "LL";
    uint64_t result1 = ((uint64_t *)out)[0];
    uint64_t result2 = ((uint64_t *)out)[1];

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result1 = bswap_64(result1);
    result2 = bswap_64(result2);
#endif

    return Py_BuildValue(valflag, result1, result2);
}

PyDoc_STRVAR(
    MMH3Hasher128_utupledigest_doc,
    "utupledigest() -> tuple[int, int]\n"
    "\n"
    "Return the digest value as a tuple of two unsigned integers.\n"
    "\n"
    "Returns:\n"
    "    tuple[int, int]: The digest value as a tuple of two unsigned\n"
    "    integers.\n");

static PyObject *
MMH3Hasher128x64_utupledigest(MMH3Hasher128x64 *self,
                              PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x64_128_impl(self->h1, self->h2, self->buffer1, self->buffer2,
                        self->length, out);

    const char *valflag = "KK";
    uint64_t result1 = ((uint64_t *)out)[0];
    uint64_t result2 = ((uint64_t *)out)[1];

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result1 = bswap_64(result1);
    result2 = bswap_64(result2);
#endif

    return Py_BuildValue(valflag, result1, result2);
}

PyDoc_STRVAR(MMH3Hasher128x64_copy_doc,
             "copy() -> mmh3_128x64\n"
             "\n"
             "Return a copy of the hash object..\n"
             "\n"
             "Returns:\n"
             "    mmh3_128x64: A copy of this hash object.\n");

static PyObject *
MMH3Hasher128x64_copy(MMH3Hasher128x64 *self, PyObject *Py_UNUSED(ignored))
{
    MMH3Hasher128x64 *p;

    if ((p = PyObject_New(MMH3Hasher128x64, &MMH3Hasher128x64Type)) == NULL) {
        return NULL;
    }

    p->h1 = self->h1;
    p->h2 = self->h2;
    p->buffer1 = self->buffer1;
    p->buffer2 = self->buffer2;
    p->shift = self->shift;
    p->length = self->length;

    return (PyObject *)p;
}

static PyMethodDef MMH3Hasher128x64_methods[] = {
    {"update", (PyCFunction)MMH3Hasher128x64_update, METH_O,
     MMH3Hasher_update_doc},
    {"digest", (PyCFunction)MMH3Hasher128x64_digest, METH_NOARGS,
     MMH3Hasher_digest_doc},
    {"sintdigest", (PyCFunction)MMH3Hasher128x64_sintdigest, METH_NOARGS,
     MMH3Hasher_sintdigest_doc},
    {"uintdigest", (PyCFunction)MMH3Hasher128x64_uintdigest, METH_NOARGS,
     MMH3Hasher_uintdigest_doc},
    {"stupledigest", (PyCFunction)MMH3Hasher128x64_stupledigest, METH_NOARGS,
     MMH3Hasher128_stupledigest_doc},
    {"utupledigest", (PyCFunction)MMH3Hasher128x64_utupledigest, METH_NOARGS,
     MMH3Hasher128_utupledigest_doc},
    {"copy", (PyCFunction)MMH3Hasher128x64_copy, METH_NOARGS,
     MMH3Hasher128x64_copy_doc},
    {NULL} /* Sentinel */
};

static PyObject *
MMH3Hasher128x64_get_digest_size(PyObject *self, void *closure)
{
    return PyLong_FromLong(MMH3_128_DIGESTSIZE);
}

static PyObject *
MMH3Hasher128x64_get_block_size(PyObject *self, void *closure)
{
    return PyLong_FromLong(MMH3_128_BLOCKSIZE);
}

static PyObject *
MMH3Hasher128x64_get_name(PyObject *self, void *closure)
{
    return PyUnicode_FromStringAndSize("mmh3_x64_128", 12);
}

static PyGetSetDef MMH3Hasher128x64_getsetters[] = {
    {"digest_size", (getter)MMH3Hasher128x64_get_digest_size, NULL,
     "int: Number of bytes in this hashes output.", NULL},
    {"block_size", (getter)MMH3Hasher128x64_get_block_size, NULL,
     "int: Number of bytes of the internal block of this algorithm.", NULL},
    {"name", (getter)MMH3Hasher128x64_get_name, NULL,
     "str: The hash algorithm being used by this object.", NULL},
    {NULL} /* Sentinel */
};

PyDoc_STRVAR(
    MMH3Hasher128x64Type_doc,
    "__init__(data=None, seed=0)\n"
    "\n"
    "Hasher for incrementally calculating the murmurhash3_x64_128 hash.\n"
    "\n"
    "Args:\n"
    "    data (Buffer | None): The initial data to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range\n"
    "        [0, 0xFFFFFFFF].\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    Added the optional ``data`` parameter as the first argument.\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n");

static PyTypeObject MMH3Hasher128x64Type = {
    PyVarObject_HEAD_INIT(NULL, 0).tp_name = "mmh3.mmh3_x64_128",
    .tp_doc = MMH3Hasher128x64Type_doc,
    .tp_basicsize = sizeof(MMH3Hasher128x64),
    .tp_itemsize = 0,
    .tp_flags = Py_TPFLAGS_DEFAULT,
    .tp_new = MMH3Hasher128x64_new,
    .tp_init = (initproc)MMH3Hasher128x64_init,
    .tp_dealloc = (destructor)MMH3Hasher128x64_dealloc,
    .tp_methods = MMH3Hasher128x64_methods,
    .tp_getset = MMH3Hasher128x64_getsetters,
};

//-----------------------------------------------------------------------------
// Hasher for murmurhash3_x86_128
typedef struct {
    PyObject_HEAD uint32_t h1;
    uint32_t h2;
    uint32_t h3;
    uint32_t h4;
    uint32_t buffer1;
    uint32_t buffer2;
    uint32_t buffer3;
    uint32_t buffer4;
    uint8_t shift;
    Py_ssize_t length;
} MMH3Hasher128x86;

static PyTypeObject MMH3Hasher128x86Type;

static FORCE_INLINE void
update_x86_128_impl(MMH3Hasher128x86 *self, Py_buffer *buf)
{
    Py_ssize_t i = 0;
    uint32_t h1 = self->h1;
    uint32_t h2 = self->h2;
    uint32_t h3 = self->h3;
    uint32_t h4 = self->h4;
    uint32_t k1 = 0;

    for (; i < buf->len; i++) {
        k1 = ((uint8_t *)buf->buf)[i];
        if (self->shift < 32) {  // TODO: use bit ops
            self->buffer1 |= k1 << self->shift;
        }
        else if (self->shift < 64) {
            self->buffer2 |= k1 << (self->shift - 32);
        }
        else if (self->shift < 96) {
            self->buffer3 |= k1 << (self->shift - 64);
        }
        else {
            self->buffer4 |= k1 << (self->shift - 96);
        }
        self->shift += 8;
        self->length += 1;

        if (self->shift >= 128) {
            const uint32_t c1 = 0x239b961b;
            const uint32_t c2 = 0xab0e9789;
            const uint32_t c3 = 0x38b34ae5;
            const uint32_t c4 = 0xa1e38b93;

            h1 ^= mixK_x86_128(self->buffer1, 15, c1, c2);
            h1 = mixH1(h1, h2, 19, 0x561ccd1bUL);

            h2 ^= mixK_x86_128(self->buffer2, 16, c2, c3);
            h2 = mixH1(h2, h3, 17, 0x0bcaa747UL);

            h3 ^= mixK_x86_128(self->buffer3, 17, c3, c4);
            h3 = mixH1(h3, h4, 15, 0x96cd1c35UL);

            h4 ^= mixK_x86_128(self->buffer4, 18, c4, c1);
            h4 = mixH1(h4, h1, 13, 0x32ac3b17UL);

            self->buffer1 = 0;
            self->buffer2 = 0;
            self->buffer3 = 0;
            self->buffer4 = 0;
            self->shift -= 128;
        }
    }

    PyBuffer_Release(buf);

    self->h1 = h1;
    self->h2 = h2;
    self->h3 = h3;
    self->h4 = h4;
}

static void
MMH3Hasher128x86_dealloc(MMH3Hasher128x86 *self)
{
    Py_TYPE(self)->tp_free((PyObject *)self);
}

static PyObject *
MMH3Hasher128x86_new(PyTypeObject *type, PyObject *args, PyObject *kwds)
{
    MMH3Hasher128x86 *self;
    self = (MMH3Hasher128x86 *)type->tp_alloc(type, 0);
    if (self != NULL) {
        self->h1 = 0;
        self->h2 = 0;
        self->h3 = 0;
        self->h4 = 0;
        self->buffer1 = 0;
        self->buffer2 = 0;
        self->buffer3 = 0;
        self->buffer4 = 0;
        self->shift = 0;
        self->length = 0;
    }
    return (PyObject *)self;
}

static int
MMH3Hasher128x86_init(MMH3Hasher128x86 *self, PyObject *args, PyObject *kwds)
{
    Py_buffer target_buf = {0};
    long long seed = 0;
    static char *kwlist[] = {"data", "seed", NULL};

    if (!PyArg_ParseTupleAndKeywords(args, kwds, "|y*L", kwlist, &target_buf,
                                     &seed))
        return -1;

    MMH3_VALIDATE_SEED_RETURN_INT(seed, target_buf);
    self->h1 = (uint32_t)seed;
    self->h2 = self->h1;
    self->h3 = self->h1;
    self->h4 = self->h1;

    if (target_buf.buf != NULL) {
        // target_buf will be released in update_x86_128_impl
        update_x86_128_impl(self, &target_buf);
    }

    return 0;
}

static PyObject *
MMH3Hasher128x86_update(MMH3Hasher128x86 *self, PyObject *obj)
{
    Py_buffer buf;

    GET_BUFFER_VIEW_OR_ERROUT(obj, &buf);

    // buf will be released in update_x86_128_impl
    update_x86_128_impl(self, &buf);

    Py_RETURN_NONE;
}

static PyObject *
MMH3Hasher128x86_digest(MMH3Hasher128x86 *self, PyObject *Py_UNUSED(ignored))
{
    char out[MMH3_128_DIGESTSIZE];
    digest_x86_128_impl(self->h1, self->h2, self->h3, self->h4, self->buffer1,
                        self->buffer2, self->buffer3, self->buffer4,
                        self->length, out);
    return PyBytes_FromStringAndSize(out, MMH3_128_DIGESTSIZE);
}

static PyObject *
MMH3Hasher128x86_sintdigest(MMH3Hasher128x86 *self,
                            PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x86_128_impl(self->h1, self->h2, self->h3, self->h4, self->buffer1,
                        self->buffer2, self->buffer3, self->buffer4,
                        self->length, out);
    const int little_endian = 1;
    const int is_signed = 1;

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray(
        (unsigned char *)out, MMH3_128_DIGESTSIZE, little_endian, is_signed);

    return retval;
}

static PyObject *
MMH3Hasher128x86_uintdigest(MMH3Hasher128x86 *self,
                            PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x86_128_impl(self->h1, self->h2, self->h3, self->h4, self->buffer1,
                        self->buffer2, self->buffer3, self->buffer4,
                        self->length, out);
    const int little_endian = 1;
    const int is_signed = 0;

    /**
     * _PyLong_FromByteArray is not a part of the official Python/C API
     * and may be removed in the future (although it is practically stable).
     * cf.
     * https://mail.python.org/pipermail/python-list/2006-August/372365.html
     */
    PyObject *retval = _PyLong_FromByteArray(
        (unsigned char *)out, MMH3_128_DIGESTSIZE, little_endian, is_signed);

    return retval;
}

static PyObject *
MMH3Hasher128x86_stupledigest(MMH3Hasher128x86 *self,
                              PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x86_128_impl(self->h1, self->h2, self->h3, self->h4, self->buffer1,
                        self->buffer2, self->buffer3, self->buffer4,
                        self->length, out);

    const char *valflag = "LL";
    uint64_t result1 = ((uint64_t *)out)[0];
    uint64_t result2 = ((uint64_t *)out)[1];

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result1 = bswap_64(result1);
    result2 = bswap_64(result2);
#endif

    return Py_BuildValue(valflag, result1, result2);
}

static PyObject *
MMH3Hasher128x86_utupledigest(MMH3Hasher128x86 *self,
                              PyObject *Py_UNUSED(ignored))
{
    const char out[MMH3_128_DIGESTSIZE];
    digest_x86_128_impl(self->h1, self->h2, self->h3, self->h4, self->buffer1,
                        self->buffer2, self->buffer3, self->buffer4,
                        self->length, out);

    const char *valflag = "KK";
    uint64_t result1 = ((uint64_t *)out)[0];
    uint64_t result2 = ((uint64_t *)out)[1];

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ == __ORDER_BIG_ENDIAN__)
    result1 = bswap_64(result1);
    result2 = bswap_64(result2);
#endif

    return Py_BuildValue(valflag, result1, result2);
}

PyDoc_STRVAR(MMH3Hasher128x86_copy_doc,
             "copy() -> mmh3_128x86\n"
             "\n"
             "Return a copy of the hash object..\n"
             "\n"
             "Returns:\n"
             "    mmh3_128x86: A copy of this hash object.\n");

static PyObject *
MMH3Hasher128x86_copy(MMH3Hasher128x86 *self, PyObject *Py_UNUSED(ignored))
{
    MMH3Hasher128x86 *p;

    if ((p = PyObject_New(MMH3Hasher128x86, &MMH3Hasher128x86Type)) == NULL) {
        return NULL;
    }

    p->h1 = self->h1;
    p->h2 = self->h2;
    p->h3 = self->h3;
    p->h4 = self->h4;
    p->buffer1 = self->buffer1;
    p->buffer2 = self->buffer2;
    p->buffer3 = self->buffer3;
    p->buffer4 = self->buffer4;
    p->shift = self->shift;
    p->length = self->length;

    return (PyObject *)p;
}

static PyMethodDef MMH3Hasher128x86_methods[] = {
    {"update", (PyCFunction)MMH3Hasher128x86_update, METH_O,
     MMH3Hasher_update_doc},
    {"digest", (PyCFunction)MMH3Hasher128x86_digest, METH_NOARGS,
     MMH3Hasher_digest_doc},
    {"sintdigest", (PyCFunction)MMH3Hasher128x86_sintdigest, METH_NOARGS,
     MMH3Hasher_sintdigest_doc},
    {"uintdigest", (PyCFunction)MMH3Hasher128x86_uintdigest, METH_NOARGS,
     MMH3Hasher_uintdigest_doc},
    {"stupledigest", (PyCFunction)MMH3Hasher128x86_stupledigest, METH_NOARGS,
     MMH3Hasher128_stupledigest_doc},
    {"utupledigest", (PyCFunction)MMH3Hasher128x86_utupledigest, METH_NOARGS,
     MMH3Hasher128_utupledigest_doc},
    {"copy", (PyCFunction)MMH3Hasher128x86_copy, METH_NOARGS,
     MMH3Hasher128x86_copy_doc},
    {NULL} /* Sentinel */
};

static PyObject *
MMH3Hasher128x86_get_digest_size(PyObject *self, void *closure)
{
    return PyLong_FromLong(MMH3_128_DIGESTSIZE);
}

static PyObject *
MMH3Hasher128x86_get_block_size(PyObject *self, void *closure)
{
    return PyLong_FromLong(MMH3_128_BLOCKSIZE);
}

static PyObject *
MMH3Hasher128x86_get_name(PyObject *self, void *closure)
{
    return PyUnicode_FromStringAndSize("mmh3_x86_128", 12);
}

static PyGetSetDef MMH3Hasher128x86_getsetters[] = {
    {"digest_size", (getter)MMH3Hasher128x86_get_digest_size, NULL,
     "int: Number of bytes in this hashes output", NULL},
    {"block_size", (getter)MMH3Hasher128x86_get_block_size, NULL,
     "int: Number of bytes of the internal block of this algorithm", NULL},
    {"name", (getter)MMH3Hasher128x86_get_name, NULL,
     "str: Te hash algorithm being used by this object", NULL},
    {NULL} /* Sentinel */
};

PyDoc_STRVAR(
    MMH3Hasher128x86Type_doc,
    "__init__(data=None, seed=0)\n"
    "\n"
    "Hasher for incrementally calculating the murmurhash3_x86_128 hash.\n"
    "\n"
    "Args:\n"
    "    data (Buffer | None): The initial data to hash.\n"
    "    seed (int): The seed value. Must be an integer in the range "
    "[0, 0xFFFFFFFF].\n"
    "\n"
    ".. versionchanged:: 5.0.0\n"
    "    Added the optional ``data`` parameter as the first argument.\n"
    "    The ``seed`` argument is now strictly checked for valid range.\n");

static PyTypeObject MMH3Hasher128x86Type = {
    PyVarObject_HEAD_INIT(NULL, 0).tp_name = "mmh3.mmh3_x86_128",
    .tp_doc = MMH3Hasher128x86Type_doc,
    .tp_basicsize = sizeof(MMH3Hasher128x86),
    .tp_itemsize = 0,
    .tp_flags = Py_TPFLAGS_DEFAULT,
    .tp_new = MMH3Hasher128x86_new,
    .tp_init = (initproc)MMH3Hasher128x86_init,
    .tp_dealloc = (destructor)MMH3Hasher128x86_dealloc,
    .tp_methods = MMH3Hasher128x86_methods,
    .tp_getset = MMH3Hasher128x86_getsetters,
};

//-----------------------------------------------------------------------------
// Module
static struct PyModuleDef mmh3module = {
    PyModuleDef_HEAD_INIT,
    "mmh3",
    "A Python front-end to MurmurHash3.\n"
    "\n"
    "A Python front-end to MurmurHash3, "
    "a fast and robust non-cryptographic hash library "
    "created by Austin Appleby (http://code.google.com/p/smhasher/).\n"
    "\n"
    "Ported by Hajime Senuma <hajime.senuma@gmail.com>. "
    "If you find any bugs, please submit an issue via "
    "https://github.com/hajimes/mmh3.\n"
    "\n"
    "Typical usage example:\n"
    "\n"
    "  mmh3.hash(\"foobar\", 42)",
    -1,
    Mmh3Methods,
    NULL,
    NULL,
    NULL,
    NULL};

PyMODINIT_FUNC
PyInit_mmh3(void)
{
    if (PyType_Ready(&MMH3Hasher32Type) < 0)
        return NULL;

    if (PyType_Ready(&MMH3Hasher128x64Type) < 0)
        return NULL;

    if (PyType_Ready(&MMH3Hasher128x86Type) < 0)
        return NULL;

    PyObject *module = PyModule_Create(&mmh3module);

    if (module == NULL)
        return NULL;

    Py_INCREF(&MMH3Hasher32Type);
    if (PyModule_AddObject(module, "mmh3_32", (PyObject *)&MMH3Hasher32Type) <
        0) {
        Py_DECREF(&MMH3Hasher32Type);
        Py_DECREF(module);
        return NULL;
    }

    Py_INCREF(&MMH3Hasher128x64Type);
    if (PyModule_AddObject(module, "mmh3_x64_128",
                           (PyObject *)&MMH3Hasher128x64Type) < 0) {
        Py_DECREF(&MMH3Hasher128x64Type);
        Py_DECREF(module);
        return NULL;
    }

    Py_INCREF(&MMH3Hasher128x86Type);
    if (PyModule_AddObject(module, "mmh3_x86_128",
                           (PyObject *)&MMH3Hasher128x86Type) < 0) {
        Py_DECREF(&MMH3Hasher128x86Type);
        Py_DECREF(module);
        return NULL;
    }

    return module;
}