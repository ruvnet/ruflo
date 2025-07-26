# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef jsonb_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        char *str
        ssize_t size

    if settings.is_encoding_json():
        obj = settings.get_json_encoder().encode(obj)

    as_pg_string_and_size(settings, obj, &str, &size)

    if size > 0x7fffffff - 1:
        raise ValueError('string too long')

    buf.write_int32(<int32_t>size + 1)
    buf.write_byte(1)  # JSONB format version
    buf.write_cstr(str, size)


cdef jsonb_decode(CodecContext settings, FRBuffer *buf):
    cdef uint8_t format = <uint8_t>(frb_read(buf, 1)[0])

    if format != 1:
        raise ValueError('unexpected JSONB format: {}'.format(format))

    rv = text_decode(settings, buf)

    if settings.is_decoding_json():
        rv = settings.get_json_decoder().decode(rv)

    return rv


cdef json_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        char *str
        ssize_t size

    if settings.is_encoding_json():
        obj = settings.get_json_encoder().encode(obj)

    text_encode(settings, buf, obj)


cdef json_decode(CodecContext settings, FRBuffer *buf):
    rv = text_decode(settings, buf)

    if settings.is_decoding_json():
        rv = settings.get_json_decoder().decode(rv)

    return rv
