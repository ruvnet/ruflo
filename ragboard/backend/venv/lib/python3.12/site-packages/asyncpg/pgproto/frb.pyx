# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef object frb_check(FRBuffer *frb, ssize_t n):
    if n > frb.len:
        raise AssertionError(
            f'insufficient data in buffer: requested {n} '
            f'remaining {frb.len}')
