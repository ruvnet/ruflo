# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef inline uint32_t _apg_tolower(uint32_t c):
    if c >= <uint32_t><Py_UCS4>'A' and c <= <uint32_t><Py_UCS4>'Z':
        return c + <uint32_t><Py_UCS4>'a' - <uint32_t><Py_UCS4>'A'
    else:
        return c


cdef int apg_strcasecmp(const Py_UCS4 *s1, const Py_UCS4 *s2):
    cdef:
        uint32_t c1
        uint32_t c2
        int i = 0

    while True:
        c1 = s1[i]
        c2 = s2[i]

        if c1 != c2:
            c1 = _apg_tolower(c1)
            c2 = _apg_tolower(c2)
            if c1 != c2:
                return <int32_t>c1 - <int32_t>c2

        if c1 == 0 or c2 == 0:
            break

        i += 1

    return 0


cdef int apg_strcasecmp_char(const char *s1, const char *s2):
    cdef:
        uint8_t c1
        uint8_t c2
        int i = 0

    while True:
        c1 = <uint8_t>s1[i]
        c2 = <uint8_t>s2[i]

        if c1 != c2:
            c1 = <uint8_t>_apg_tolower(c1)
            c2 = <uint8_t>_apg_tolower(c2)
            if c1 != c2:
                return <int8_t>c1 - <int8_t>c2

        if c1 == 0 or c2 == 0:
            break

        i += 1

    return 0


cdef inline bint apg_ascii_isspace(Py_UCS4 ch):
    return (
        ch == ' ' or
        ch == '\n' or
        ch == '\r' or
        ch == '\t' or
        ch == '\v' or
        ch == '\f'
    )


cdef Py_UCS4 *apg_parse_int32(Py_UCS4 *buf, int32_t *num):
    cdef:
        Py_UCS4 *p
        int32_t n = 0
        int32_t neg = 0

    if buf[0] == '-':
        neg = 1
        buf += 1
    elif buf[0] == '+':
        buf += 1

    p = buf
    while <int>p[0] >= <int><Py_UCS4>'0' and <int>p[0] <= <int><Py_UCS4>'9':
        n = 10 * n - (<int>p[0] - <int32_t><Py_UCS4>'0')
        p += 1

    if p == buf:
        return NULL

    if not neg:
        n = -n

    num[0] = n

    return p
