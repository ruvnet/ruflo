# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from asyncpg import exceptions


cdef inline record_encode_frame(ConnectionSettings settings, WriteBuffer buf,
                                WriteBuffer elem_data, int32_t elem_count):
    buf.write_int32(4 + elem_data.len())
    # attribute count
    buf.write_int32(elem_count)
    # encoded attribute data
    buf.write_buffer(elem_data)


cdef anonymous_record_decode(ConnectionSettings settings, FRBuffer *buf):
    cdef:
        tuple result
        ssize_t elem_count
        ssize_t i
        int32_t elem_len
        uint32_t elem_typ
        Codec elem_codec
        FRBuffer elem_buf

    elem_count = <ssize_t><uint32_t>hton.unpack_int32(frb_read(buf, 4))
    result = cpython.PyTuple_New(elem_count)

    for i in range(elem_count):
        elem_typ = <uint32_t>hton.unpack_int32(frb_read(buf, 4))
        elem_len = hton.unpack_int32(frb_read(buf, 4))

        if elem_len == -1:
            elem = None
        else:
            elem_codec = settings.get_data_codec(elem_typ)
            if elem_codec is None or not elem_codec.has_decoder():
                raise exceptions.InternalClientError(
                    'no decoder for composite type element in '
                    'position {} of type OID {}'.format(i, elem_typ))
            elem = elem_codec.decode(settings,
                                     frb_slice_from(&elem_buf, buf, elem_len))

        cpython.Py_INCREF(elem)
        cpython.PyTuple_SET_ITEM(result, i, elem)

    return result


cdef anonymous_record_encode(ConnectionSettings settings, WriteBuffer buf, obj):
    raise exceptions.UnsupportedClientFeatureError(
        'input of anonymous composite types is not supported',
        hint=(
            'Consider declaring an explicit composite type and '
            'using it to cast the argument.'
        ),
        detail='PostgreSQL does not implement anonymous composite type input.'
    )


cdef init_record_codecs():
    register_core_codec(RECORDOID,
                        <encode_func>anonymous_record_encode,
                        <decode_func>anonymous_record_decode,
                        PG_FORMAT_BINARY)

init_record_codecs()
