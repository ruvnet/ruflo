# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef inline _encode_points(WriteBuffer wbuf, object points):
    cdef object point

    for point in points:
        wbuf.write_double(point[0])
        wbuf.write_double(point[1])


cdef inline _decode_points(FRBuffer *buf):
    cdef:
        int32_t npts = hton.unpack_int32(frb_read(buf, 4))
        pts = cpython.PyTuple_New(npts)
        int32_t i
        object point
        double x
        double y

    for i in range(npts):
        x = hton.unpack_double(frb_read(buf, 8))
        y = hton.unpack_double(frb_read(buf, 8))
        point = pgproto_types.Point(x, y)
        cpython.Py_INCREF(point)
        cpython.PyTuple_SET_ITEM(pts, i, point)

    return pts


cdef box_encode(CodecContext settings, WriteBuffer wbuf, obj):
    wbuf.write_int32(32)
    _encode_points(wbuf, (obj[0], obj[1]))


cdef box_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        double high_x = hton.unpack_double(frb_read(buf, 8))
        double high_y = hton.unpack_double(frb_read(buf, 8))
        double low_x = hton.unpack_double(frb_read(buf, 8))
        double low_y = hton.unpack_double(frb_read(buf, 8))

    return pgproto_types.Box(
        pgproto_types.Point(high_x, high_y),
        pgproto_types.Point(low_x, low_y))


cdef line_encode(CodecContext settings, WriteBuffer wbuf, obj):
    wbuf.write_int32(24)
    wbuf.write_double(obj[0])
    wbuf.write_double(obj[1])
    wbuf.write_double(obj[2])


cdef line_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        double A = hton.unpack_double(frb_read(buf, 8))
        double B = hton.unpack_double(frb_read(buf, 8))
        double C = hton.unpack_double(frb_read(buf, 8))

    return pgproto_types.Line(A, B, C)


cdef lseg_encode(CodecContext settings, WriteBuffer wbuf, obj):
    wbuf.write_int32(32)
    _encode_points(wbuf, (obj[0], obj[1]))


cdef lseg_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        double p1_x = hton.unpack_double(frb_read(buf, 8))
        double p1_y = hton.unpack_double(frb_read(buf, 8))
        double p2_x = hton.unpack_double(frb_read(buf, 8))
        double p2_y = hton.unpack_double(frb_read(buf, 8))

    return pgproto_types.LineSegment((p1_x, p1_y), (p2_x, p2_y))


cdef point_encode(CodecContext settings, WriteBuffer wbuf, obj):
    wbuf.write_int32(16)
    wbuf.write_double(obj[0])
    wbuf.write_double(obj[1])


cdef point_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        double x = hton.unpack_double(frb_read(buf, 8))
        double y = hton.unpack_double(frb_read(buf, 8))

    return pgproto_types.Point(x, y)


cdef path_encode(CodecContext settings, WriteBuffer wbuf, obj):
    cdef:
        int8_t is_closed = 0
        ssize_t npts
        ssize_t encoded_len
        int32_t i

    if cpython.PyTuple_Check(obj):
        is_closed = 1
    elif cpython.PyList_Check(obj):
        is_closed = 0
    elif isinstance(obj, pgproto_types.Path):
        is_closed = obj.is_closed

    npts = len(obj)
    encoded_len = 1 + 4 + 16 * npts
    if encoded_len > _MAXINT32:
        raise ValueError('path value too long')

    wbuf.write_int32(<int32_t>encoded_len)
    wbuf.write_byte(is_closed)
    wbuf.write_int32(<int32_t>npts)

    _encode_points(wbuf, obj)


cdef path_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        int8_t is_closed = <int8_t>(frb_read(buf, 1)[0])

    return pgproto_types.Path(*_decode_points(buf), is_closed=is_closed == 1)


cdef poly_encode(CodecContext settings, WriteBuffer wbuf, obj):
    cdef:
        bint is_closed
        ssize_t npts
        ssize_t encoded_len
        int32_t i

    npts = len(obj)
    encoded_len = 4 + 16 * npts
    if encoded_len > _MAXINT32:
        raise ValueError('polygon value too long')

    wbuf.write_int32(<int32_t>encoded_len)
    wbuf.write_int32(<int32_t>npts)
    _encode_points(wbuf, obj)


cdef poly_decode(CodecContext settings, FRBuffer *buf):
    return pgproto_types.Polygon(*_decode_points(buf))


cdef circle_encode(CodecContext settings, WriteBuffer wbuf, obj):
    wbuf.write_int32(24)
    wbuf.write_double(obj[0][0])
    wbuf.write_double(obj[0][1])
    wbuf.write_double(obj[1])


cdef circle_decode(CodecContext settings, FRBuffer *buf):
    cdef:
        double center_x = hton.unpack_double(frb_read(buf, 8))
        double center_y = hton.unpack_double(frb_read(buf, 8))
        double radius = hton.unpack_double(frb_read(buf, 8))

    return pgproto_types.Circle((center_x, center_y), radius)
