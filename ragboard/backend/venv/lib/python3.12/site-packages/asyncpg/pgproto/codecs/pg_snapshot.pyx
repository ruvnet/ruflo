# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef pg_snapshot_encode(CodecContext settings, WriteBuffer buf, obj):
    cdef:
        ssize_t nxip
        uint64_t xmin
        uint64_t xmax
        int i
        WriteBuffer xip_buf = WriteBuffer.new()

    if not (cpython.PyTuple_Check(obj) or cpython.PyList_Check(obj)):
        raise TypeError(
            'list or tuple expected (got type {})'.format(type(obj)))

    if len(obj) != 3:
        raise ValueError(
            'invalid number of elements in txid_snapshot tuple, expecting 4')

    nxip = len(obj[2])
    if nxip > _MAXINT32:
        raise ValueError('txid_snapshot value is too long')

    xmin = obj[0]
    xmax = obj[1]

    for i in range(nxip):
        xip_buf.write_int64(
            <int64_t>cpython.PyLong_AsUnsignedLongLong(obj[2][i]))

    buf.write_int32(20 + xip_buf.len())

    buf.write_int32(<int32_t>nxip)
    buf.write_int64(<int64_t>xmin)
    buf.write_int64(<int64_t>xmax)
    buf.write_buffer(xip_buf)


cdef pg_snapshot_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        int32_t nxip
        uint64_t xmin
        uint64_t xmax
        tuple xip_tup
        int32_t i
        object xip

    nxip = hton.unpack_int32(frb_read(buf, 4))
    xmin = <uint64_t>hton.unpack_int64(frb_read(buf, 8))
    xmax = <uint64_t>hton.unpack_int64(frb_read(buf, 8))

    xip_tup = cpython.PyTuple_New(nxip)
    for i in range(nxip):
        xip = cpython.PyLong_FromUnsignedLongLong(
            <uint64_t>hton.unpack_int64(frb_read(buf, 8)))
        cpython.Py_INCREF(xip)
        cpython.PyTuple_SET_ITEM(xip_tup, i, xip)

    return (xmin, xmax, xip_tup)
