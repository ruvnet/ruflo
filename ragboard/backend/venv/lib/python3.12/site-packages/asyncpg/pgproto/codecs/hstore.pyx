# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef hstore_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        char *str
        ssize_t size
        ssize_t count
        object items
        WriteBuffer item_buf = WriteBuffer.new()

    count = len(obj)
    if count > _MAXINT32:
        raise ValueError('hstore value is too large')
    item_buf.write_int32(<int32_t>count)

    if hasattr(obj, 'items'):
        items = obj.items()
    else:
        items = obj

    for k, v in items:
        if k is None:
            raise ValueError('null value not allowed in hstore key')
        as_pg_string_and_size(settings, k, &str, &size)
        item_buf.write_int32(<int32_t>size)
        item_buf.write_cstr(str, size)
        if v is None:
            item_buf.write_int32(<int32_t>-1)
        else:
            as_pg_string_and_size(settings, v, &str, &size)
            item_buf.write_int32(<int32_t>size)
            item_buf.write_cstr(str, size)

    buf.write_int32(item_buf.len())
    buf.write_buffer(item_buf)


cdef hstore_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        dict result
        uint32_t elem_count
        int32_t elem_len
        uint32_t i
        str k
        str v

    result = {}

    elem_count = <uint32_t>hton.unpack_int32(frb_read(buf, 4))
    if elem_count == 0:
        return result

    for i in range(elem_count):
        elem_len = hton.unpack_int32(frb_read(buf, 4))
        if elem_len < 0:
            raise ValueError('null value not allowed in hstore key')

        k = decode_pg_string(settings, frb_read(buf, elem_len), elem_len)

        elem_len = hton.unpack_int32(frb_read(buf, 4))
        if elem_len < 0:
            v = None
        else:
            v = decode_pg_string(settings, frb_read(buf, elem_len), elem_len)

        result[k] = v

    return result
