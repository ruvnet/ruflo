# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef bytea_encode(CodecContext settings, WriteBuffer wbuf, obj):
    cdef:
        Py_buffer pybuf
        bint pybuf_used = False
        char *buf
        ssize_t len

    if cpython.PyBytes_CheckExact(obj):
        buf = cpython.PyBytes_AS_STRING(obj)
        len = cpython.Py_SIZE(obj)
    else:
        cpython.PyObject_GetBuffer(obj, &pybuf, cpython.PyBUF_SIMPLE)
        pybuf_used = True
        buf = <char*>pybuf.buf
        len = pybuf.len

    try:
        wbuf.write_int32(<int32_t>len)
        wbuf.write_cstr(buf, len)
    finally:
        if pybuf_used:
            cpython.PyBuffer_Release(&pybuf)


cdef bytea_decode(CodecContext settings, FRBuffer *buf):
    cdef ssize_t buf_len = buf.len
    return cpython.PyBytes_FromStringAndSize(frb_read_all(buf), buf_len)
