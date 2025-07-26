# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


ctypedef object (*encode_func)(ConnectionSettings settings,
                               WriteBuffer buf,
                               object obj)

ctypedef object (*decode_func)(ConnectionSettings settings,
                               FRBuffer *buf)

ctypedef object (*codec_encode_func)(Codec codec,
                                     ConnectionSettings settings,
                                     WriteBuffer buf,
                                     object obj)

ctypedef object (*codec_decode_func)(Codec codec,
                                     ConnectionSettings settings,
                                     FRBuffer *buf)


cdef enum CodecType:
    CODEC_UNDEFINED  = 0
    CODEC_C          = 1
    CODEC_PY         = 2
    CODEC_ARRAY      = 3
    CODEC_COMPOSITE  = 4
    CODEC_RANGE      = 5
    CODEC_MULTIRANGE = 6


cdef enum ServerDataFormat:
    PG_FORMAT_ANY = -1
    PG_FORMAT_TEXT = 0
    PG_FORMAT_BINARY = 1


cdef enum ClientExchangeFormat:
    PG_XFORMAT_OBJECT = 1
    PG_XFORMAT_TUPLE = 2


cdef class Codec:
    cdef:
        uint32_t        oid

        str             name
        str             schema
        str             kind

        CodecType       type
        ServerDataFormat format
        ClientExchangeFormat xformat

        encode_func     c_encoder
        decode_func     c_decoder
        Codec           base_codec

        object          py_encoder
        object          py_decoder

        # arrays
        Codec           element_codec
        Py_UCS4         element_delimiter

        # composite types
        tuple           element_type_oids
        object          element_names
        object          record_desc
        list            element_codecs

        # Pointers to actual encoder/decoder functions for this codec
        codec_encode_func encoder
        codec_decode_func decoder

    cdef init(self, str name, str schema, str kind,
              CodecType type, ServerDataFormat format,
              ClientExchangeFormat xformat,
              encode_func c_encoder, decode_func c_decoder,
              Codec base_codec,
              object py_encoder, object py_decoder,
              Codec element_codec, tuple element_type_oids,
              object element_names, list element_codecs,
              Py_UCS4 element_delimiter)

    cdef encode_scalar(self, ConnectionSettings settings, WriteBuffer buf,
                       object obj)

    cdef encode_array(self, ConnectionSettings settings, WriteBuffer buf,
                      object obj)

    cdef encode_array_text(self, ConnectionSettings settings, WriteBuffer buf,
                           object obj)

    cdef encode_range(self, ConnectionSettings settings, WriteBuffer buf,
                      object obj)

    cdef encode_multirange(self, ConnectionSettings settings, WriteBuffer buf,
                           object obj)

    cdef encode_composite(self, ConnectionSettings settings, WriteBuffer buf,
                          object obj)

    cdef encode_in_python(self, ConnectionSettings settings, WriteBuffer buf,
                          object obj)

    cdef decode_scalar(self, ConnectionSettings settings, FRBuffer *buf)

    cdef decode_array(self, ConnectionSettings settings, FRBuffer *buf)

    cdef decode_array_text(self, ConnectionSettings settings, FRBuffer *buf)

    cdef decode_range(self, ConnectionSettings settings, FRBuffer *buf)

    cdef decode_multirange(self, ConnectionSettings settings, FRBuffer *buf)

    cdef decode_composite(self, ConnectionSettings settings, FRBuffer *buf)

    cdef decode_in_python(self, ConnectionSettings settings, FRBuffer *buf)

    cdef inline encode(self,
                       ConnectionSettings settings,
                       WriteBuffer buf,
                       object obj)

    cdef inline decode(self, ConnectionSettings settings, FRBuffer *buf)

    cdef has_encoder(self)
    cdef has_decoder(self)
    cdef is_binary(self)

    cdef inline Codec copy(self)

    @staticmethod
    cdef Codec new_array_codec(uint32_t oid,
                               str name,
                               str schema,
                               Codec element_codec,
                               Py_UCS4 element_delimiter)

    @staticmethod
    cdef Codec new_range_codec(uint32_t oid,
                               str name,
                               str schema,
                               Codec element_codec)

    @staticmethod
    cdef Codec new_multirange_codec(uint32_t oid,
                                    str name,
                                    str schema,
                                    Codec element_codec)

    @staticmethod
    cdef Codec new_composite_codec(uint32_t oid,
                                   str name,
                                   str schema,
                                   ServerDataFormat format,
                                   list element_codecs,
                                   tuple element_type_oids,
                                   object element_names)

    @staticmethod
    cdef Codec new_python_codec(uint32_t oid,
                                str name,
                                str schema,
                                str kind,
                                object encoder,
                                object decoder,
                                encode_func c_encoder,
                                decode_func c_decoder,
                                Codec base_codec,
                                ServerDataFormat format,
                                ClientExchangeFormat xformat)


cdef class DataCodecConfig:
    cdef:
        dict _derived_type_codecs
        dict _custom_type_codecs

    cdef inline Codec get_codec(self, uint32_t oid, ServerDataFormat format,
                                bint ignore_custom_codec=*)
    cdef inline Codec get_custom_codec(self, uint32_t oid,
                                       ServerDataFormat format)
