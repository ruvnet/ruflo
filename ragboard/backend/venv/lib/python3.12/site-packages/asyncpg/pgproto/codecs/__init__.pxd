# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef class CodecContext:

    cpdef get_text_codec(self)
    cdef is_encoding_utf8(self)
    cpdef get_json_decoder(self)
    cdef is_decoding_json(self)
    cpdef get_json_encoder(self)
    cdef is_encoding_json(self)


ctypedef object (*encode_func)(CodecContext settings,
                               WriteBuffer buf,
                               object obj)

ctypedef object (*decode_func)(CodecContext settings,
                               FRBuffer *buf)


# Datetime
cdef date_encode(CodecContext settings, WriteBuffer buf, obj)
cdef date_decode(CodecContext settings, FRBuffer * buf)
cdef date_encode_tuple(CodecContext settings, WriteBuffer buf, obj)
cdef date_decode_tuple(CodecContext settings, FRBuffer * buf)
cdef timestamp_encode(CodecContext settings, WriteBuffer buf, obj)
cdef timestamp_decode(CodecContext settings, FRBuffer * buf)
cdef timestamp_encode_tuple(CodecContext settings, WriteBuffer buf, obj)
cdef timestamp_decode_tuple(CodecContext settings, FRBuffer * buf)
cdef timestamptz_encode(CodecContext settings, WriteBuffer buf, obj)
cdef timestamptz_decode(CodecContext settings, FRBuffer * buf)
cdef time_encode(CodecContext settings, WriteBuffer buf, obj)
cdef time_decode(CodecContext settings, FRBuffer * buf)
cdef time_encode_tuple(CodecContext settings, WriteBuffer buf, obj)
cdef time_decode_tuple(CodecContext settings, FRBuffer * buf)
cdef timetz_encode(CodecContext settings, WriteBuffer buf, obj)
cdef timetz_decode(CodecContext settings, FRBuffer * buf)
cdef timetz_encode_tuple(CodecContext settings, WriteBuffer buf, obj)
cdef timetz_decode_tuple(CodecContext settings, FRBuffer * buf)
cdef interval_encode(CodecContext settings, WriteBuffer buf, obj)
cdef interval_decode(CodecContext settings, FRBuffer * buf)
cdef interval_encode_tuple(CodecContext settings, WriteBuffer buf, tuple obj)
cdef interval_decode_tuple(CodecContext settings, FRBuffer * buf)


# Bits
cdef bits_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef bits_decode(CodecContext settings, FRBuffer * buf)


# Bools
cdef bool_encode(CodecContext settings, WriteBuffer buf, obj)
cdef bool_decode(CodecContext settings, FRBuffer * buf)


# Geometry
cdef box_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef box_decode(CodecContext settings, FRBuffer * buf)
cdef line_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef line_decode(CodecContext settings, FRBuffer * buf)
cdef lseg_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef lseg_decode(CodecContext settings, FRBuffer * buf)
cdef point_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef point_decode(CodecContext settings, FRBuffer * buf)
cdef path_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef path_decode(CodecContext settings, FRBuffer * buf)
cdef poly_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef poly_decode(CodecContext settings, FRBuffer * buf)
cdef circle_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef circle_decode(CodecContext settings, FRBuffer * buf)


# Hstore
cdef hstore_encode(CodecContext settings, WriteBuffer buf, obj)
cdef hstore_decode(CodecContext settings, FRBuffer * buf)


# Ints
cdef int2_encode(CodecContext settings, WriteBuffer buf, obj)
cdef int2_decode(CodecContext settings, FRBuffer * buf)
cdef int4_encode(CodecContext settings, WriteBuffer buf, obj)
cdef int4_decode(CodecContext settings, FRBuffer * buf)
cdef uint4_encode(CodecContext settings, WriteBuffer buf, obj)
cdef uint4_decode(CodecContext settings, FRBuffer * buf)
cdef int8_encode(CodecContext settings, WriteBuffer buf, obj)
cdef int8_decode(CodecContext settings, FRBuffer * buf)
cdef uint8_encode(CodecContext settings, WriteBuffer buf, obj)
cdef uint8_decode(CodecContext settings, FRBuffer * buf)


# Floats
cdef float4_encode(CodecContext settings, WriteBuffer buf, obj)
cdef float4_decode(CodecContext settings, FRBuffer * buf)
cdef float8_encode(CodecContext settings, WriteBuffer buf, obj)
cdef float8_decode(CodecContext settings, FRBuffer * buf)


# JSON
cdef jsonb_encode(CodecContext settings, WriteBuffer buf, obj)
cdef jsonb_decode(CodecContext settings, FRBuffer * buf)


# JSON path
cdef jsonpath_encode(CodecContext settings, WriteBuffer buf, obj)
cdef jsonpath_decode(CodecContext settings, FRBuffer * buf)


# Text
cdef as_pg_string_and_size(
        CodecContext settings, obj, char **cstr, ssize_t *size)
cdef text_encode(CodecContext settings, WriteBuffer buf, obj)
cdef text_decode(CodecContext settings, FRBuffer * buf)

# Bytea
cdef bytea_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef bytea_decode(CodecContext settings, FRBuffer * buf)


# UUID
cdef uuid_encode(CodecContext settings, WriteBuffer wbuf, obj)
cdef uuid_decode(CodecContext settings, FRBuffer * buf)


# Numeric
cdef numeric_encode_text(CodecContext settings, WriteBuffer buf, obj)
cdef numeric_decode_text(CodecContext settings, FRBuffer * buf)
cdef numeric_encode_binary(CodecContext settings, WriteBuffer buf, obj)
cdef numeric_decode_binary(CodecContext settings, FRBuffer * buf)
cdef numeric_decode_binary_ex(CodecContext settings, FRBuffer * buf,
                              bint trail_fract_zero)


# Void
cdef void_encode(CodecContext settings, WriteBuffer buf, obj)
cdef void_decode(CodecContext settings, FRBuffer * buf)


# tid
cdef tid_encode(CodecContext settings, WriteBuffer buf, obj)
cdef tid_decode(CodecContext settings, FRBuffer * buf)


# Network
cdef cidr_encode(CodecContext settings, WriteBuffer buf, obj)
cdef cidr_decode(CodecContext settings, FRBuffer * buf)
cdef inet_encode(CodecContext settings, WriteBuffer buf, obj)
cdef inet_decode(CodecContext settings, FRBuffer * buf)


# pg_snapshot
cdef pg_snapshot_encode(CodecContext settings, WriteBuffer buf, obj)
cdef pg_snapshot_decode(CodecContext settings, FRBuffer * buf)
