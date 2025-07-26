# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from asyncpg import types as apg_types

from collections.abc import Sequence as SequenceABC

# defined in postgresql/src/include/utils/rangetypes.h
DEF RANGE_EMPTY  = 0x01  # range is empty
DEF RANGE_LB_INC = 0x02  # lower bound is inclusive
DEF RANGE_UB_INC = 0x04  # upper bound is inclusive
DEF RANGE_LB_INF = 0x08  # lower bound is -infinity
DEF RANGE_UB_INF = 0x10  # upper bound is +infinity


cdef enum _RangeArgumentType:
    _RANGE_ARGUMENT_INVALID = 0
    _RANGE_ARGUMENT_TUPLE = 1
    _RANGE_ARGUMENT_RANGE = 2


cdef inline bint _range_has_lbound(uint8_t flags):
    return not (flags & (RANGE_EMPTY | RANGE_LB_INF))


cdef inline bint _range_has_ubound(uint8_t flags):
    return not (flags & (RANGE_EMPTY | RANGE_UB_INF))


cdef inline _RangeArgumentType _range_type(object obj):
    if cpython.PyTuple_Check(obj) or cpython.PyList_Check(obj):
        return _RANGE_ARGUMENT_TUPLE
    elif isinstance(obj, apg_types.Range):
        return _RANGE_ARGUMENT_RANGE
    else:
        return _RANGE_ARGUMENT_INVALID


cdef range_encode(ConnectionSettings settings, WriteBuffer buf,
                  object obj, uint32_t elem_oid,
                  encode_func_ex encoder, const void *encoder_arg):
    cdef:
        ssize_t obj_len
        uint8_t flags = 0
        object lower = None
        object upper = None
        WriteBuffer bounds_data = WriteBuffer.new()
        _RangeArgumentType arg_type = _range_type(obj)

    if arg_type == _RANGE_ARGUMENT_INVALID:
        raise TypeError(
            'list, tuple or Range object expected (got type {})'.format(
                type(obj)))

    elif arg_type == _RANGE_ARGUMENT_TUPLE:
        obj_len = len(obj)
        if obj_len == 2:
            lower = obj[0]
            upper = obj[1]

            if lower is None:
                flags |= RANGE_LB_INF

            if upper is None:
                flags |= RANGE_UB_INF

            flags |= RANGE_LB_INC | RANGE_UB_INC

        elif obj_len == 1:
            lower = obj[0]
            flags |= RANGE_LB_INC | RANGE_UB_INF

        elif obj_len == 0:
            flags |= RANGE_EMPTY

        else:
            raise ValueError(
                'expected 0, 1 or 2 elements in range (got {})'.format(
                    obj_len))

    else:
        if obj.isempty:
            flags |= RANGE_EMPTY
        else:
            lower = obj.lower
            upper = obj.upper

            if obj.lower_inc:
                flags |= RANGE_LB_INC
            elif lower is None:
                flags |= RANGE_LB_INF

            if obj.upper_inc:
                flags |= RANGE_UB_INC
            elif upper is None:
                flags |= RANGE_UB_INF

    if _range_has_lbound(flags):
        encoder(settings, bounds_data, lower, encoder_arg)

    if _range_has_ubound(flags):
        encoder(settings, bounds_data, upper, encoder_arg)

    buf.write_int32(1 + bounds_data.len())
    buf.write_byte(<int8_t>flags)
    buf.write_buffer(bounds_data)


cdef range_decode(ConnectionSettings settings, FRBuffer *buf,
                  decode_func_ex decoder, const void *decoder_arg):
    cdef:
        uint8_t flags = <uint8_t>frb_read(buf, 1)[0]
        int32_t bound_len
        object lower = None
        object upper = None
        FRBuffer bound_buf

    if _range_has_lbound(flags):
        bound_len = hton.unpack_int32(frb_read(buf, 4))
        if bound_len == -1:
            lower = None
        else:
            frb_slice_from(&bound_buf, buf, bound_len)
            lower = decoder(settings, &bound_buf, decoder_arg)

    if _range_has_ubound(flags):
        bound_len = hton.unpack_int32(frb_read(buf, 4))
        if bound_len == -1:
            upper = None
        else:
            frb_slice_from(&bound_buf, buf, bound_len)
            upper = decoder(settings, &bound_buf, decoder_arg)

    return apg_types.Range(lower=lower, upper=upper,
                           lower_inc=(flags & RANGE_LB_INC) != 0,
                           upper_inc=(flags & RANGE_UB_INC) != 0,
                           empty=(flags & RANGE_EMPTY) != 0)


cdef multirange_encode(ConnectionSettings settings, WriteBuffer buf,
                       object obj, uint32_t elem_oid,
                       encode_func_ex encoder, const void *encoder_arg):
    cdef:
        WriteBuffer elem_data
        ssize_t elem_data_len
        ssize_t elem_count

    if not isinstance(obj, SequenceABC):
        raise TypeError(
            'expected a sequence (got type {!r})'.format(type(obj).__name__)
        )

    elem_data = WriteBuffer.new()

    for elem in obj:
        range_encode(settings, elem_data, elem, elem_oid, encoder, encoder_arg)

    elem_count = len(obj)
    if elem_count > INT32_MAX:
        raise OverflowError(f'too many elements in multirange value')

    elem_data_len = elem_data.len()
    if elem_data_len > INT32_MAX - 4:
        raise OverflowError(
            f'size of encoded multirange datum exceeds the maximum allowed'
            f' {INT32_MAX - 4} bytes')

    # Datum length
    buf.write_int32(4 + <int32_t>elem_data_len)
    # Number of elements in multirange
    buf.write_int32(<int32_t>elem_count)
    buf.write_buffer(elem_data)


cdef multirange_decode(ConnectionSettings settings, FRBuffer *buf,
                       decode_func_ex decoder, const void *decoder_arg):
    cdef:
        int32_t nelems = hton.unpack_int32(frb_read(buf, 4))
        FRBuffer elem_buf
        int32_t elem_len
        int i
        list result

    if nelems == 0:
        return []

    if nelems < 0:
        raise exceptions.ProtocolError(
            'unexpected multirange size value: {}'.format(nelems))

    result = cpython.PyList_New(nelems)
    for i in range(nelems):
        elem_len = hton.unpack_int32(frb_read(buf, 4))
        if elem_len == -1:
            raise exceptions.ProtocolError(
                'unexpected NULL element in multirange value')
        else:
            frb_slice_from(&elem_buf, buf, elem_len)
        elem = range_decode(settings, &elem_buf, decoder, decoder_arg)
        cpython.Py_INCREF(elem)
        cpython.PyList_SET_ITEM(result, i, elem)

    return result
