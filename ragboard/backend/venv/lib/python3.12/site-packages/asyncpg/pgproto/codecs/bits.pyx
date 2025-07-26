# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef bits_encode(CodecContext settings, WriteBuffer wbuf, obj):
    cdef:
        Py_buffer pybuf
        bint pybuf_used = False
        char *buf
        ssize_t len
        ssize_t bitlen

    if cpython.PyBytes_CheckExact(obj):
        buf = cpython.PyBytes_AS_STRING(obj)
        len = cpython.Py_SIZE(obj)
        bitlen = len * 8
    elif isinstance(obj, pgproto_types.BitString):
        cpython.PyBytes_AsStringAndSize(obj.bytes, &buf, &len)
        bitlen = obj.__len__()
    else:
        cpython.PyObject_GetBuffer(obj, &pybuf, cpython.PyBUF_SIMPLE)
        pybuf_used = True
        buf = <char*>pybuf.buf
        len = pybuf.len
        bitlen = len * 8

    try:
        if bitlen > _MAXINT32:
            raise ValueError('bit value too long')
        wbuf.write_int32(4 + <int32_t>len)
        wbuf.write_int32(<int32_t>bitlen)
        wbuf.write_cstr(buf, len)
    finally:
        if pybuf_used:
            cpython.PyBuffer_Release(&pybuf)


cdef bits_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        int32_t bitlen = hton.unpack_int32(frb_read(buf, 4))
        ssize_t buf_len = buf.len

    bytes_ = cpython.PyBytes_FromStringAndSize(frb_read_all(buf), buf_len)
    return pgproto_types.BitString.frombytes(bytes_, bitlen)
