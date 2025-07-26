# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef:

    struct FRBuffer:
        const char* buf
        ssize_t len

    inline ssize_t frb_get_len(FRBuffer *frb):
        return frb.len

    inline void frb_set_len(FRBuffer *frb, ssize_t new_len):
        frb.len = new_len

    inline void frb_init(FRBuffer *frb, const char *buf, ssize_t len):
        frb.buf = buf
        frb.len = len

    inline const char* frb_read(FRBuffer *frb, ssize_t n) except NULL:
        cdef const char *result

        frb_check(frb, n)

        result = frb.buf
        frb.buf += n
        frb.len -= n

        return result

    inline const char* frb_read_all(FRBuffer *frb):
        cdef const char *result
        result = frb.buf
        frb.buf += frb.len
        frb.len = 0
        return result

    inline FRBuffer *frb_slice_from(FRBuffer *frb,
                                    FRBuffer* source, ssize_t len):
        frb.buf = frb_read(source, len)
        frb.len = len
        return frb

    object frb_check(FRBuffer *frb, ssize_t n)
