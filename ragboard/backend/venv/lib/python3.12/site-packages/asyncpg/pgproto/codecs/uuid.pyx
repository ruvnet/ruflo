# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef uuid_encode(CodecContext settings, WriteBuffer wbuf, obj):
    cdef:
        char buf[16]

    if type(obj) is pg_UUID:
        wbuf.write_int32(<int32_t>16)
        wbuf.write_cstr((<UUID>obj)._data, 16)
    elif cpython.PyUnicode_Check(obj):
        pg_uuid_bytes_from_str(obj, buf)
        wbuf.write_int32(<int32_t>16)
        wbuf.write_cstr(buf, 16)
    else:
        bytea_encode(settings, wbuf, obj.bytes)


cdef uuid_decode(CodecContext settings, FRBuffer *buf):
    if buf.len != 16:
        raise TypeError(
            f'cannot decode UUID, expected 16 bytes, got {buf.len}')
    return pg_uuid_from_buf(frb_read_all(buf))
