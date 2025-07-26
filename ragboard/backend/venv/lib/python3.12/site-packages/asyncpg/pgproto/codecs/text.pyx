# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef inline as_pg_string_and_size(
        CodecContext settings, obj, char **cstr, ssize_t *size):

    if not cpython.PyUnicode_Check(obj):
        raise TypeError('expected str, got {}'.format(type(obj).__name__))

    if settings.is_encoding_utf8():
        cstr[0] = <char*>cpythonx.PyUnicode_AsUTF8AndSize(obj, size)
    else:
        encoded = settings.get_text_codec().encode(obj)[0]
        cpython.PyBytes_AsStringAndSize(encoded, cstr, size)

    if size[0] > 0x7fffffff:
        raise ValueError('string too long')


cdef text_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        char *str
        ssize_t size

    as_pg_string_and_size(settings, obj, &str, &size)

    buf.write_int32(<int32_t>size)
    buf.write_cstr(str, size)


cdef inline decode_pg_string(CodecContext settings, const char* data,
                             ssize_t len):

    if settings.is_encoding_utf8():
        # decode UTF-8 in strict mode
        return cpython.PyUnicode_DecodeUTF8(data, len, NULL)
    else:
        bytes = cpython.PyBytes_FromStringAndSize(data, len)
        return settings.get_text_codec().decode(bytes)[0]


cdef text_decode(CodecContext settings, FRBuffer *buf):
    cdef ssize_t buf_len = buf.len
    return decode_pg_string(settings, frb_read_all(buf), buf_len)
