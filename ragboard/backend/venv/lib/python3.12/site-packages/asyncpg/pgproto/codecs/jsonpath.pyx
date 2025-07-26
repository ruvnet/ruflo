# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef jsonpath_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        char *str
        ssize_t size

    as_pg_string_and_size(settings, obj, &str, &size)

    if size > 0x7fffffff - 1:
        raise ValueError('string too long')

    buf.write_int32(<int32_t>size + 1)
    buf.write_byte(1)  # jsonpath format version
    buf.write_cstr(str, size)


cdef jsonpath_decode(CodecContext settings, FRBuffer *buf):
    cdef uint8_t format = <uint8_t>(frb_read(buf, 1)[0])

    if format != 1:
        raise ValueError('unexpected jsonpath format: {}'.format(format))

    return text_decode(settings, buf)
