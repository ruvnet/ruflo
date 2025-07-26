# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from collections.abc import Mapping as MappingABC

import asyncpg
from asyncpg import exceptions


cdef void* binary_codec_map[(MAXSUPPORTEDOID + 1) * 2]
cdef void* text_codec_map[(MAXSUPPORTEDOID + 1) * 2]
cdef dict EXTRA_CODECS = {}


@cython.final
cdef class Codec:

    def __cinit__(self, uint32_t oid):
        self.oid = oid
        self.type = CODEC_UNDEFINED

    cdef init(
        self,
        str name,
        str schema,
        str kind,
        CodecType type,
        ServerDataFormat format,
        ClientExchangeFormat xformat,
        encode_func c_encoder,
        decode_func c_decoder,
        Codec base_codec,
        object py_encoder,
        object py_decoder,
        Codec element_codec,
        tuple element_type_oids,
        object element_names,
        list element_codecs,
        Py_UCS4 element_delimiter,
    ):

        self.name = name
        self.schema = schema
        self.kind = kind
        self.type = type
        self.format = format
        self.xformat = xformat
        self.c_encoder = c_encoder
        self.c_decoder = c_decoder
        self.base_codec = base_codec
        self.py_encoder = py_encoder
        self.py_decoder = py_decoder
        self.element_codec = element_codec
        self.element_type_oids = element_type_oids
        self.element_codecs = element_codecs
        self.element_delimiter = element_delimiter
        self.element_names = element_names

        if base_codec is not None:
            if c_encoder != NULL or c_decoder != NULL:
                raise exceptions.InternalClientError(
                    'base_codec is mutually exclusive with c_encoder/c_decoder'
                )

        if element_names is not None:
            self.record_desc = record.ApgRecordDesc_New(
                element_names, tuple(element_names))
        else:
            self.record_desc = None

        if type == CODEC_C:
            self.encoder = <codec_encode_func>&self.encode_scalar
            self.decoder = <codec_decode_func>&self.decode_scalar
        elif type == CODEC_ARRAY:
            if format == PG_FORMAT_BINARY:
                self.encoder = <codec_encode_func>&self.encode_array
                self.decoder = <codec_decode_func>&self.decode_array
            else:
                self.encoder = <codec_encode_func>&self.encode_array_text
                self.decoder = <codec_decode_func>&self.decode_array_text
        elif type == CODEC_RANGE:
            if format != PG_FORMAT_BINARY:
                raise exceptions.UnsupportedClientFeatureError(
                    'cannot decode type "{}"."{}": text encoding of '
                    'range types is not supported'.format(schema, name))
            self.encoder = <codec_encode_func>&self.encode_range
            self.decoder = <codec_decode_func>&self.decode_range
        elif type == CODEC_MULTIRANGE:
            if format != PG_FORMAT_BINARY:
                raise exceptions.UnsupportedClientFeatureError(
                    'cannot decode type "{}"."{}": text encoding of '
                    'range types is not supported'.format(schema, name))
            self.encoder = <codec_encode_func>&self.encode_multirange
            self.decoder = <codec_decode_func>&self.decode_multirange
        elif type == CODEC_COMPOSITE:
            if format != PG_FORMAT_BINARY:
                raise exceptions.UnsupportedClientFeatureError(
                    'cannot decode type "{}"."{}": text encoding of '
                    'composite types is not supported'.format(schema, name))
            self.encoder = <codec_encode_func>&self.encode_composite
            self.decoder = <codec_decode_func>&self.decode_composite
        elif type == CODEC_PY:
            self.encoder = <codec_encode_func>&self.encode_in_python
            self.decoder = <codec_decode_func>&self.decode_in_python
        else:
            raise exceptions.InternalClientError(
                'unexpected codec type: {}'.format(type))

    cdef Codec copy(self):
        cdef Codec codec

        codec = Codec(self.oid)
        codec.init(self.name, self.schema, self.kind,
                   self.type, self.format, self.xformat,
                   self.c_encoder, self.c_decoder, self.base_codec,
                   self.py_encoder, self.py_decoder,
                   self.element_codec,
                   self.element_type_oids, self.element_names,
                   self.element_codecs, self.element_delimiter)

        return codec

    cdef encode_scalar(self, ConnectionSettings settings, WriteBuffer buf,
                       object obj):
        self.c_encoder(settings, buf, obj)

    cdef encode_array(self, ConnectionSettings settings, WriteBuffer buf,
                      object obj):
        array_encode(settings, buf, obj, self.element_codec.oid,
                     codec_encode_func_ex,
                     <void*>(<cpython.PyObject>self.element_codec))

    cdef encode_array_text(self, ConnectionSettings settings, WriteBuffer buf,
                           object obj):
        return textarray_encode(settings, buf, obj,
                                codec_encode_func_ex,
                                <void*>(<cpython.PyObject>self.element_codec),
                                self.element_delimiter)

    cdef encode_range(self, ConnectionSettings settings, WriteBuffer buf,
                      object obj):
        range_encode(settings, buf, obj, self.element_codec.oid,
                     codec_encode_func_ex,
                     <void*>(<cpython.PyObject>self.element_codec))

    cdef encode_multirange(self, ConnectionSettings settings, WriteBuffer buf,
                           object obj):
        multirange_encode(settings, buf, obj, self.element_codec.oid,
                          codec_encode_func_ex,
                          <void*>(<cpython.PyObject>self.element_codec))

    cdef encode_composite(self, ConnectionSettings settings, WriteBuffer buf,
                          object obj):
        cdef:
            WriteBuffer elem_data
            int i
            list elem_codecs = self.element_codecs
            ssize_t count
            ssize_t composite_size
            tuple rec

        if isinstance(obj, MappingABC):
            # Input is dict-like, form a tuple
            composite_size = len(self.element_type_oids)
            rec = cpython.PyTuple_New(composite_size)

            for i in range(composite_size):
                cpython.Py_INCREF(None)
                cpython.PyTuple_SET_ITEM(rec, i, None)

            for field in obj:
                try:
                    i = self.element_names[field]
                except KeyError:
                    raise ValueError(
                        '{!r} is not a valid element of composite '
                        'type {}'.format(field, self.name)) from None

                item = obj[field]
                cpython.Py_INCREF(item)
                cpython.PyTuple_SET_ITEM(rec, i, item)

            obj = rec

        count = len(obj)
        if count > _MAXINT32:
            raise ValueError('too many elements in composite type record')

        elem_data = WriteBuffer.new()
        i = 0
        for item in obj:
            elem_data.write_int32(<int32_t>self.element_type_oids[i])
            if item is None:
                elem_data.write_int32(-1)
            else:
                (<Codec>elem_codecs[i]).encode(settings, elem_data, item)
            i += 1

        record_encode_frame(settings, buf, elem_data, <int32_t>count)

    cdef encode_in_python(self, ConnectionSettings settings, WriteBuffer buf,
                          object obj):
        data = self.py_encoder(obj)
        if self.xformat == PG_XFORMAT_OBJECT:
            if self.format == PG_FORMAT_BINARY:
                pgproto.bytea_encode(settings, buf, data)
            elif self.format == PG_FORMAT_TEXT:
                pgproto.text_encode(settings, buf, data)
            else:
                raise exceptions.InternalClientError(
                    'unexpected data format: {}'.format(self.format))
        elif self.xformat == PG_XFORMAT_TUPLE:
            if self.base_codec is not None:
                self.base_codec.encode(settings, buf, data)
            else:
                self.c_encoder(settings, buf, data)
        else:
            raise exceptions.InternalClientError(
                'unexpected exchange format: {}'.format(self.xformat))

    cdef encode(self, ConnectionSettings settings, WriteBuffer buf,
                object obj):
        return self.encoder(self, settings, buf, obj)

    cdef decode_scalar(self, ConnectionSettings settings, FRBuffer *buf):
        return self.c_decoder(settings, buf)

    cdef decode_array(self, ConnectionSettings settings, FRBuffer *buf):
        return array_decode(settings, buf, codec_decode_func_ex,
                            <void*>(<cpython.PyObject>self.element_codec))

    cdef decode_array_text(self, ConnectionSettings settings,
                           FRBuffer *buf):
        return textarray_decode(settings, buf, codec_decode_func_ex,
                                <void*>(<cpython.PyObject>self.element_codec),
                                self.element_delimiter)

    cdef decode_range(self, ConnectionSettings settings, FRBuffer *buf):
        return range_decode(settings, buf, codec_decode_func_ex,
                            <void*>(<cpython.PyObject>self.element_codec))

    cdef decode_multirange(self, ConnectionSettings settings, FRBuffer *buf):
        return multirange_decode(settings, buf, codec_decode_func_ex,
                                 <void*>(<cpython.PyObject>self.element_codec))

    cdef decode_composite(self, ConnectionSettings settings,
                          FRBuffer *buf):
        cdef:
            object result
            ssize_t elem_count
            ssize_t i
            int32_t elem_len
            uint32_t elem_typ
            uint32_t received_elem_typ
            Codec elem_codec
            FRBuffer elem_buf

        elem_count = <ssize_t><uint32_t>hton.unpack_int32(frb_read(buf, 4))
        if elem_count != len(self.element_type_oids):
            raise exceptions.OutdatedSchemaCacheError(
                'unexpected number of attributes of composite type: '
                '{}, expected {}'
                    .format(
                        elem_count,
                        len(self.element_type_oids),
                    ),
                schema=self.schema,
                data_type=self.name,
            )
        result = record.ApgRecord_New(asyncpg.Record, self.record_desc, elem_count)
        for i in range(elem_count):
            elem_typ = self.element_type_oids[i]
            received_elem_typ = <uint32_t>hton.unpack_int32(frb_read(buf, 4))

            if received_elem_typ != elem_typ:
                raise exceptions.OutdatedSchemaCacheError(
                    'unexpected data type of composite type attribute {}: '
                    '{!r}, expected {!r}'
                        .format(
                            i,
                            BUILTIN_TYPE_OID_MAP.get(
                                received_elem_typ, received_elem_typ),
                            BUILTIN_TYPE_OID_MAP.get(
                                elem_typ, elem_typ)
                        ),
                    schema=self.schema,
                    data_type=self.name,
                    position=i,
                )

            elem_len = hton.unpack_int32(frb_read(buf, 4))
            if elem_len == -1:
                elem = None
            else:
                elem_codec = self.element_codecs[i]
                elem = elem_codec.decode(
                    settings, frb_slice_from(&elem_buf, buf, elem_len))

            cpython.Py_INCREF(elem)
            record.ApgRecord_SET_ITEM(result, i, elem)

        return result

    cdef decode_in_python(self, ConnectionSettings settings,
                          FRBuffer *buf):
        if self.xformat == PG_XFORMAT_OBJECT:
            if self.format == PG_FORMAT_BINARY:
                data = pgproto.bytea_decode(settings, buf)
            elif self.format == PG_FORMAT_TEXT:
                data = pgproto.text_decode(settings, buf)
            else:
                raise exceptions.InternalClientError(
                    'unexpected data format: {}'.format(self.format))
        elif self.xformat == PG_XFORMAT_TUPLE:
            if self.base_codec is not None:
                data = self.base_codec.decode(settings, buf)
            else:
                data = self.c_decoder(settings, buf)
        else:
            raise exceptions.InternalClientError(
                'unexpected exchange format: {}'.format(self.xformat))

        return self.py_decoder(data)

    cdef inline decode(self, ConnectionSettings settings, FRBuffer *buf):
        return self.decoder(self, settings, buf)

    cdef inline has_encoder(self):
        cdef Codec elem_codec

        if self.c_encoder is not NULL or self.py_encoder is not None:
            return True

        elif (
            self.type == CODEC_ARRAY
            or self.type == CODEC_RANGE
            or self.type == CODEC_MULTIRANGE
        ):
            return self.element_codec.has_encoder()

        elif self.type == CODEC_COMPOSITE:
            for elem_codec in self.element_codecs:
                if not elem_codec.has_encoder():
                    return False
            return True

        else:
            return False

    cdef has_decoder(self):
        cdef Codec elem_codec

        if self.c_decoder is not NULL or self.py_decoder is not None:
            return True

        elif (
            self.type == CODEC_ARRAY
            or self.type == CODEC_RANGE
            or self.type == CODEC_MULTIRANGE
        ):
            return self.element_codec.has_decoder()

        elif self.type == CODEC_COMPOSITE:
            for elem_codec in self.element_codecs:
                if not elem_codec.has_decoder():
                    return False
            return True

        else:
            return False

    cdef is_binary(self):
        return self.format == PG_FORMAT_BINARY

    def __repr__(self):
        return '<Codec oid={} elem_oid={} core={}>'.format(
            self.oid,
            'NA' if self.element_codec is None else self.element_codec.oid,
            has_core_codec(self.oid))

    @staticmethod
    cdef Codec new_array_codec(uint32_t oid,
                               str name,
                               str schema,
                               Codec element_codec,
                               Py_UCS4 element_delimiter):
        cdef Codec codec
        codec = Codec(oid)
        codec.init(name, schema, 'array', CODEC_ARRAY, element_codec.format,
                   PG_XFORMAT_OBJECT, NULL, NULL, None, None, None,
                   element_codec, None, None, None, element_delimiter)
        return codec

    @staticmethod
    cdef Codec new_range_codec(uint32_t oid,
                               str name,
                               str schema,
                               Codec element_codec):
        cdef Codec codec
        codec = Codec(oid)
        codec.init(name, schema, 'range', CODEC_RANGE, element_codec.format,
                   PG_XFORMAT_OBJECT, NULL, NULL, None, None, None,
                   element_codec, None, None, None, 0)
        return codec

    @staticmethod
    cdef Codec new_multirange_codec(uint32_t oid,
                                    str name,
                                    str schema,
                                    Codec element_codec):
        cdef Codec codec
        codec = Codec(oid)
        codec.init(name, schema, 'multirange', CODEC_MULTIRANGE,
                   element_codec.format, PG_XFORMAT_OBJECT, NULL, NULL, None,
                   None, None, element_codec, None, None, None, 0)
        return codec

    @staticmethod
    cdef Codec new_composite_codec(uint32_t oid,
                                   str name,
                                   str schema,
                                   ServerDataFormat format,
                                   list element_codecs,
                                   tuple element_type_oids,
                                   object element_names):
        cdef Codec codec
        codec = Codec(oid)
        codec.init(name, schema, 'composite', CODEC_COMPOSITE,
                   format, PG_XFORMAT_OBJECT, NULL, NULL, None, None, None,
                   None, element_type_oids, element_names, element_codecs, 0)
        return codec

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
                                ClientExchangeFormat xformat):
        cdef Codec codec
        codec = Codec(oid)
        codec.init(name, schema, kind, CODEC_PY, format, xformat,
                   c_encoder, c_decoder, base_codec, encoder, decoder,
                   None, None, None, None, 0)
        return codec


# Encode callback for arrays
cdef codec_encode_func_ex(ConnectionSettings settings, WriteBuffer buf,
                          object obj, const void *arg):
    return (<Codec>arg).encode(settings, buf, obj)


# Decode callback for arrays
cdef codec_decode_func_ex(ConnectionSettings settings, FRBuffer *buf,
                          const void *arg):
    return (<Codec>arg).decode(settings, buf)


cdef uint32_t pylong_as_oid(val) except? 0xFFFFFFFFl:
    cdef:
        int64_t oid = 0
        bint overflow = False

    try:
        oid = cpython.PyLong_AsLongLong(val)
    except OverflowError:
        overflow = True

    if overflow or (oid < 0 or oid > UINT32_MAX):
        raise OverflowError('OID value too large: {!r}'.format(val))

    return <uint32_t>val


cdef class DataCodecConfig:
    def __init__(self, cache_key):
        # Codec instance cache for derived types:
        # composites, arrays, ranges, domains and their combinations.
        self._derived_type_codecs = {}
        # Codec instances set up by the user for the connection.
        self._custom_type_codecs = {}

    def add_types(self, types):
        cdef:
            Codec elem_codec
            list comp_elem_codecs
            ServerDataFormat format
            ServerDataFormat elem_format
            bint has_text_elements
            Py_UCS4 elem_delim

        for ti in types:
            oid = ti['oid']

            if self.get_codec(oid, PG_FORMAT_ANY) is not None:
                continue

            name = ti['name']
            schema = ti['ns']
            array_element_oid = ti['elemtype']
            range_subtype_oid = ti['range_subtype']
            if ti['attrtypoids']:
                comp_type_attrs = tuple(ti['attrtypoids'])
            else:
                comp_type_attrs = None
            base_type = ti['basetype']

            if array_element_oid:
                # Array type (note, there is no separate 'kind' for arrays)

                # Canonicalize type name to "elemtype[]"
                if name.startswith('_'):
                    name = name[1:]
                name = '{}[]'.format(name)

                elem_codec = self.get_codec(array_element_oid, PG_FORMAT_ANY)
                if elem_codec is None:
                    elem_codec = self.declare_fallback_codec(
                        array_element_oid, ti['elemtype_name'], schema)

                elem_delim = <Py_UCS4>ti['elemdelim'][0]

                self._derived_type_codecs[oid, elem_codec.format] = \
                    Codec.new_array_codec(
                        oid, name, schema, elem_codec, elem_delim)

            elif ti['kind'] == b'c':
                # Composite type

                if not comp_type_attrs:
                    raise exceptions.InternalClientError(
                        f'type record missing field types for composite {oid}')

                comp_elem_codecs = []
                has_text_elements = False

                for typoid in comp_type_attrs:
                    elem_codec = self.get_codec(typoid, PG_FORMAT_ANY)
                    if elem_codec is None:
                        raise exceptions.InternalClientError(
                            f'no codec for composite attribute type {typoid}')
                    if elem_codec.format is PG_FORMAT_TEXT:
                        has_text_elements = True
                    comp_elem_codecs.append(elem_codec)

                element_names = collections.OrderedDict()
                for i, attrname in enumerate(ti['attrnames']):
                    element_names[attrname] = i

                # If at least one element is text-encoded, we must
                # encode the whole composite as text.
                if has_text_elements:
                    elem_format = PG_FORMAT_TEXT
                else:
                    elem_format = PG_FORMAT_BINARY

                self._derived_type_codecs[oid, elem_format] = \
                    Codec.new_composite_codec(
                        oid, name, schema, elem_format, comp_elem_codecs,
                        comp_type_attrs, element_names)

            elif ti['kind'] == b'd':
                # Domain type

                if not base_type:
                    raise exceptions.InternalClientError(
                        f'type record missing base type for domain {oid}')

                elem_codec = self.get_codec(base_type, PG_FORMAT_ANY)
                if elem_codec is None:
                    elem_codec = self.declare_fallback_codec(
                        base_type, ti['basetype_name'], schema)

                self._derived_type_codecs[oid, elem_codec.format] = elem_codec

            elif ti['kind'] == b'r':
                # Range type

                if not range_subtype_oid:
                    raise exceptions.InternalClientError(
                        f'type record missing base type for range {oid}')

                elem_codec = self.get_codec(range_subtype_oid, PG_FORMAT_ANY)
                if elem_codec is None:
                    elem_codec = self.declare_fallback_codec(
                        range_subtype_oid, ti['range_subtype_name'], schema)

                self._derived_type_codecs[oid, elem_codec.format] = \
                    Codec.new_range_codec(oid, name, schema, elem_codec)

            elif ti['kind'] == b'm':
                # Multirange type

                if not range_subtype_oid:
                    raise exceptions.InternalClientError(
                        f'type record missing base type for multirange {oid}')

                elem_codec = self.get_codec(range_subtype_oid, PG_FORMAT_ANY)
                if elem_codec is None:
                    elem_codec = self.declare_fallback_codec(
                        range_subtype_oid, ti['range_subtype_name'], schema)

                self._derived_type_codecs[oid, elem_codec.format] = \
                    Codec.new_multirange_codec(oid, name, schema, elem_codec)

            elif ti['kind'] == b'e':
                # Enum types are essentially text
                self._set_builtin_type_codec(oid, name, schema, 'scalar',
                                             TEXTOID, PG_FORMAT_ANY)
            else:
                self.declare_fallback_codec(oid, name, schema)

    def add_python_codec(self, typeoid, typename, typeschema, typekind,
                         typeinfos, encoder, decoder, format, xformat):
        cdef:
            Codec core_codec = None
            encode_func c_encoder = NULL
            decode_func c_decoder = NULL
            Codec base_codec = None
            uint32_t oid = pylong_as_oid(typeoid)
            bint codec_set = False

        # Clear all previous overrides (this also clears type cache).
        self.remove_python_codec(typeoid, typename, typeschema)

        if typeinfos:
            self.add_types(typeinfos)

        if format == PG_FORMAT_ANY:
            formats = (PG_FORMAT_TEXT, PG_FORMAT_BINARY)
        else:
            formats = (format,)

        for fmt in formats:
            if xformat == PG_XFORMAT_TUPLE:
                if typekind == "scalar":
                    core_codec = get_core_codec(oid, fmt, xformat)
                    if core_codec is None:
                        continue
                    c_encoder = core_codec.c_encoder
                    c_decoder = core_codec.c_decoder
                elif typekind == "composite":
                    base_codec = self.get_codec(oid, fmt)
                    if base_codec is None:
                        continue

            self._custom_type_codecs[typeoid, fmt] = \
                Codec.new_python_codec(oid, typename, typeschema, typekind,
                                       encoder, decoder, c_encoder, c_decoder,
                                       base_codec, fmt, xformat)
            codec_set = True

        if not codec_set:
            raise exceptions.InterfaceError(
                "{} type does not support the 'tuple' exchange format".format(
                    typename))

    def remove_python_codec(self, typeoid, typename, typeschema):
        for fmt in (PG_FORMAT_BINARY, PG_FORMAT_TEXT):
            self._custom_type_codecs.pop((typeoid, fmt), None)
        self.clear_type_cache()

    def _set_builtin_type_codec(self, typeoid, typename, typeschema, typekind,
                                alias_to, format=PG_FORMAT_ANY):
        cdef:
            Codec codec
            Codec target_codec
            uint32_t oid = pylong_as_oid(typeoid)
            uint32_t alias_oid = 0
            bint codec_set = False

        if format == PG_FORMAT_ANY:
            formats = (PG_FORMAT_BINARY, PG_FORMAT_TEXT)
        else:
            formats = (format,)

        if isinstance(alias_to, int):
            alias_oid = pylong_as_oid(alias_to)
        else:
            alias_oid = BUILTIN_TYPE_NAME_MAP.get(alias_to, 0)

        for format in formats:
            if alias_oid != 0:
                target_codec = self.get_codec(alias_oid, format)
            else:
                target_codec = get_extra_codec(alias_to, format)

            if target_codec is None:
                continue

            codec = target_codec.copy()
            codec.oid = typeoid
            codec.name = typename
            codec.schema = typeschema
            codec.kind = typekind

            self._custom_type_codecs[typeoid, format] = codec
            codec_set = True

        if not codec_set:
            if format == PG_FORMAT_BINARY:
                codec_str = 'binary'
            elif format == PG_FORMAT_TEXT:
                codec_str = 'text'
            else:
                codec_str = 'text or binary'

            raise exceptions.InterfaceError(
                f'cannot alias {typename} to {alias_to}: '
                f'there is no {codec_str} codec for {alias_to}')

    def set_builtin_type_codec(self, typeoid, typename, typeschema, typekind,
                               alias_to, format=PG_FORMAT_ANY):
        self._set_builtin_type_codec(typeoid, typename, typeschema, typekind,
                                     alias_to, format)
        self.clear_type_cache()

    def clear_type_cache(self):
        self._derived_type_codecs.clear()

    def declare_fallback_codec(self, uint32_t oid, str name, str schema):
        cdef Codec codec

        if oid <= MAXBUILTINOID:
            # This is a BKI type, for which asyncpg has no
            # defined codec.  This should only happen for newly
            # added builtin types, for which this version of
            # asyncpg is lacking support.
            #
            raise exceptions.UnsupportedClientFeatureError(
                f'unhandled standard data type {name!r} (OID {oid})')
        else:
            # This is a non-BKI type, and as such, has no
            # stable OID, so no possibility of a builtin codec.
            # In this case, fallback to text format.  Applications
            # can avoid this by specifying a codec for this type
            # using Connection.set_type_codec().
            #
            self._set_builtin_type_codec(oid, name, schema, 'scalar',
                                         TEXTOID, PG_FORMAT_TEXT)

            codec = self.get_codec(oid, PG_FORMAT_TEXT)

        return codec

    cdef inline Codec get_codec(self, uint32_t oid, ServerDataFormat format,
                                bint ignore_custom_codec=False):
        cdef Codec codec

        if format == PG_FORMAT_ANY:
            codec = self.get_codec(
                oid, PG_FORMAT_BINARY, ignore_custom_codec)
            if codec is None:
                codec = self.get_codec(
                    oid, PG_FORMAT_TEXT, ignore_custom_codec)
            return codec
        else:
            if not ignore_custom_codec:
                codec = self.get_custom_codec(oid, PG_FORMAT_ANY)
                if codec is not None:
                    if codec.format != format:
                        # The codec for this OID has been overridden by
                        # set_{builtin}_type_codec with a different format.
                        # We must respect that and not return a core codec.
                        return None
                    else:
                        return codec

            codec = get_core_codec(oid, format)
            if codec is not None:
                return codec
            else:
                try:
                    return self._derived_type_codecs[oid, format]
                except KeyError:
                    return None

    cdef inline Codec get_custom_codec(
        self,
        uint32_t oid,
        ServerDataFormat format
    ):
        cdef Codec codec

        if format == PG_FORMAT_ANY:
            codec = self.get_custom_codec(oid, PG_FORMAT_BINARY)
            if codec is None:
                codec = self.get_custom_codec(oid, PG_FORMAT_TEXT)
        else:
            codec = self._custom_type_codecs.get((oid, format))

        return codec


cdef inline Codec get_core_codec(
        uint32_t oid, ServerDataFormat format,
        ClientExchangeFormat xformat=PG_XFORMAT_OBJECT):
    cdef:
        void *ptr = NULL

    if oid > MAXSUPPORTEDOID:
        return None
    if format == PG_FORMAT_BINARY:
        ptr = binary_codec_map[oid * xformat]
    elif format == PG_FORMAT_TEXT:
        ptr = text_codec_map[oid * xformat]

    if ptr is NULL:
        return None
    else:
        return <Codec>ptr


cdef inline Codec get_any_core_codec(
        uint32_t oid, ServerDataFormat format,
        ClientExchangeFormat xformat=PG_XFORMAT_OBJECT):
    """A version of get_core_codec that accepts PG_FORMAT_ANY."""
    cdef:
        Codec codec

    if format == PG_FORMAT_ANY:
        codec = get_core_codec(oid, PG_FORMAT_BINARY, xformat)
        if codec is None:
            codec = get_core_codec(oid, PG_FORMAT_TEXT, xformat)
    else:
        codec = get_core_codec(oid, format, xformat)

    return codec


cdef inline int has_core_codec(uint32_t oid):
    return binary_codec_map[oid] != NULL or text_codec_map[oid] != NULL


cdef register_core_codec(uint32_t oid,
                         encode_func encode,
                         decode_func decode,
                         ServerDataFormat format,
                         ClientExchangeFormat xformat=PG_XFORMAT_OBJECT):

    if oid > MAXSUPPORTEDOID:
        raise exceptions.InternalClientError(
            'cannot register core codec for OID {}: it is greater '
            'than MAXSUPPORTEDOID ({})'.format(oid, MAXSUPPORTEDOID))

    cdef:
        Codec codec
        str name
        str kind

    name = BUILTIN_TYPE_OID_MAP[oid]
    kind = 'array' if oid in ARRAY_TYPES else 'scalar'

    codec = Codec(oid)
    codec.init(name, 'pg_catalog', kind, CODEC_C, format, xformat,
               encode, decode, None, None, None, None, None, None, None, 0)
    cpython.Py_INCREF(codec)  # immortalize

    if format == PG_FORMAT_BINARY:
        binary_codec_map[oid * xformat] = <void*>codec
    elif format == PG_FORMAT_TEXT:
        text_codec_map[oid * xformat] = <void*>codec
    else:
        raise exceptions.InternalClientError(
            'invalid data format: {}'.format(format))


cdef register_extra_codec(str name,
                          encode_func encode,
                          decode_func decode,
                          ServerDataFormat format):
    cdef:
        Codec codec
        str kind

    kind = 'scalar'

    codec = Codec(INVALIDOID)
    codec.init(name, None, kind, CODEC_C, format, PG_XFORMAT_OBJECT,
               encode, decode, None, None, None, None, None, None, None, 0)
    EXTRA_CODECS[name, format] = codec


cdef inline Codec get_extra_codec(str name, ServerDataFormat format):
    return EXTRA_CODECS.get((name, format))
