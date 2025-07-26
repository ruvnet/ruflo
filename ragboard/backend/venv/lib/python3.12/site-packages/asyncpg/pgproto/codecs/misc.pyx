# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef void_encode(CodecContext settings, WriteBuffer buf, obj):
    # Void is zero bytes
    buf.write_int32(0)


cdef void_decode(CodecContext settings, FRBuffer *buf):
    # Do nothing; void will be passed as NULL so this function
    # will never be called.
    pass
