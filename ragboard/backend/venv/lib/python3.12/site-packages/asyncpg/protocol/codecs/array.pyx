# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from collections.abc import (Iterable as IterableABC,
                             Mapping as MappingABC,
                             Sized as SizedABC)

from asyncpg import exceptions


DEF ARRAY_MAXDIM = 6  # defined in postgresql/src/includes/c.h

# "NULL"
cdef Py_UCS4 *APG_NULL = [0x004E, 0x0055, 0x004C, 0x004C, 0x0000]


ctypedef object (*encode_func_ex)(ConnectionSettings settings,
                                  WriteBuffer buf,
                                  object obj,
                                  const void *arg)


ctypedef object (*decode_func_ex)(ConnectionSettings settings,
                                  FRBuffer *buf,
                                  const void *arg)


cdef inline bint _is_trivial_container(object obj):
    return cpython.PyUnicode_Check(obj) or cpython.PyBytes_Check(obj) or \
            cpythonx.PyByteArray_Check(obj) or cpythonx.PyMemoryView_Check(obj)


cdef inline _is_array_iterable(object obj):
    return (
        isinstance(obj, IterableABC) and
        isinstance(obj, SizedABC) and
        not _is_trivial_container(obj) and
        not isinstance(obj, MappingABC)
    )


cdef inline _is_sub_array_iterable(object obj):
    # Sub-arrays have a specialized check, because we treat
    # nested tuples as records.
    return _is_array_iterable(obj) and not cpython.PyTuple_Check(obj)


cdef _get_array_shape(object obj, int32_t *dims, int32_t *ndims):
    cdef:
        ssize_t mylen = len(obj)
        ssize_t elemlen = -2
        object it

    if mylen > _MAXINT32:
        raise ValueError('too many elements in array value')

    if ndims[0] > ARRAY_MAXDIM:
        raise ValueError(
            'number of array dimensions ({}) exceed the maximum expected ({})'.
                format(ndims[0], ARRAY_MAXDIM))

    dims[ndims[0] - 1] = <int32_t>mylen

    for elem in obj:
        if _is_sub_array_iterable(elem):
            if elemlen == -2:
                elemlen = len(elem)
                if elemlen > _MAXINT32:
                    raise ValueError('too many elements in array value')
                ndims[0] += 1
                _get_array_shape(elem, dims, ndims)
            else:
                if len(elem) != elemlen:
                    raise ValueError('non-homogeneous array')
        else:
            if elemlen >= 0:
                raise ValueError('non-homogeneous array')
            else:
                elemlen = -1


cdef _write_array_data(ConnectionSettings settings, object obj, int32_t ndims,
                       int32_t dim, WriteBuffer elem_data,
                       encode_func_ex encoder, const void *encoder_arg):
    if dim < ndims - 1:
        for item in obj:
            _write_array_data(settings, item, ndims, dim + 1, elem_data,
                              encoder, encoder_arg)
    else:
        for item in obj:
            if item is None:
                elem_data.write_int32(-1)
            else:
                try:
                    encoder(settings, elem_data, item, encoder_arg)
                except TypeError as e:
                    raise ValueError(
                        'invalid array element: {}'.format(e.args[0])) from None


cdef inline array_encode(ConnectionSettings settings, WriteBuffer buf,
                         object obj, uint32_t elem_oid,
                         encode_func_ex encoder, const void *encoder_arg):
    cdef:
        WriteBuffer elem_data
        int32_t dims[ARRAY_MAXDIM]
        int32_t ndims = 1
        int32_t i

    if not _is_array_iterable(obj):
        raise TypeError(
            'a sized iterable container expected (got type {!r})'.format(
                type(obj).__name__))

    _get_array_shape(obj, dims, &ndims)

    elem_data = WriteBuffer.new()

    if ndims > 1:
        _write_array_data(settings, obj, ndims, 0, elem_data,
                          encoder, encoder_arg)
    else:
        for i, item in enumerate(obj):
            if item is None:
                elem_data.write_int32(-1)
            else:
                try:
                    encoder(settings, elem_data, item, encoder_arg)
                except TypeError as e:
                    raise ValueError(
                        'invalid array element at index {}: {}'.format(
                            i, e.args[0])) from None

    buf.write_int32(12 + 8 * ndims + elem_data.len())
    # Number of dimensions
    buf.write_int32(ndims)
    # flags
    buf.write_int32(0)
    # element type
    buf.write_int32(<int32_t>elem_oid)
    # upper / lower bounds
    for i in range(ndims):
        buf.write_int32(dims[i])
        buf.write_int32(1)
    # element data
    buf.write_buffer(elem_data)


cdef _write_textarray_data(ConnectionSettings settings, object obj,
                           int32_t ndims, int32_t dim, WriteBuffer array_data,
                           encode_func_ex encoder, const void *encoder_arg,
                           Py_UCS4 typdelim):
    cdef:
        ssize_t i = 0
        int8_t delim = <int8_t>typdelim
        WriteBuffer elem_data
        Py_buffer pybuf
        const char *elem_str
        char ch
        ssize_t elem_len
        ssize_t quoted_elem_len
        bint need_quoting

    array_data.write_byte(b'{')

    if dim < ndims - 1:
        for item in obj:
            if i > 0:
                array_data.write_byte(delim)
                array_data.write_byte(b' ')
            _write_textarray_data(settings, item, ndims, dim + 1, array_data,
                                  encoder, encoder_arg, typdelim)
            i += 1
    else:
        for item in obj:
            elem_data = WriteBuffer.new()

            if i > 0:
                array_data.write_byte(delim)
                array_data.write_byte(b' ')

            if item is None:
                array_data.write_bytes(b'NULL')
                i += 1
                continue
            else:
                try:
                    encoder(settings, elem_data, item, encoder_arg)
                except TypeError as e:
                    raise ValueError(
                        'invalid array element: {}'.format(
                            e.args[0])) from None

            # element string length (first four bytes are the encoded length.)
            elem_len = elem_data.len() - 4

            if elem_len == 0:
                # Empty string
                array_data.write_bytes(b'""')
            else:
                cpython.PyObject_GetBuffer(
                    elem_data, &pybuf, cpython.PyBUF_SIMPLE)

                elem_str = <const char*>(pybuf.buf) + 4

                try:
                    if not apg_strcasecmp_char(elem_str, b'NULL'):
                        array_data.write_byte(b'"')
                        array_data.write_cstr(elem_str, 4)
                        array_data.write_byte(b'"')
                    else:
                        quoted_elem_len = elem_len
                        need_quoting = False

                        for i in range(elem_len):
                            ch = elem_str[i]
                            if ch == b'"' or ch == b'\\':
                                # Quotes and backslashes need escaping.
                                quoted_elem_len += 1
                                need_quoting = True
                            elif (ch == b'{' or ch == b'}' or ch == delim or
                                    apg_ascii_isspace(<uint32_t>ch)):
                                need_quoting = True

                        if need_quoting:
                            array_data.write_byte(b'"')

                            if quoted_elem_len == elem_len:
                                array_data.write_cstr(elem_str, elem_len)
                            else:
                                # Escaping required.
                                for i in range(elem_len):
                                    ch = elem_str[i]
                                    if ch == b'"' or ch == b'\\':
                                        array_data.write_byte(b'\\')
                                    array_data.write_byte(ch)

                            array_data.write_byte(b'"')
                        else:
                            array_data.write_cstr(elem_str, elem_len)
                finally:
                    cpython.PyBuffer_Release(&pybuf)

            i += 1

    array_data.write_byte(b'}')


cdef inline textarray_encode(ConnectionSettings settings, WriteBuffer buf,
                             object obj, encode_func_ex encoder,
                             const void *encoder_arg, Py_UCS4 typdelim):
    cdef:
        WriteBuffer array_data
        int32_t dims[ARRAY_MAXDIM]
        int32_t ndims = 1
        int32_t i

    if not _is_array_iterable(obj):
        raise TypeError(
            'a sized iterable container expected (got type {!r})'.format(
                type(obj).__name__))

    _get_array_shape(obj, dims, &ndims)

    array_data = WriteBuffer.new()
    _write_textarray_data(settings, obj, ndims, 0, array_data,
                          encoder, encoder_arg, typdelim)
    buf.write_int32(array_data.len())
    buf.write_buffer(array_data)


cdef inline array_decode(ConnectionSettings settings, FRBuffer *buf,
                         decode_func_ex decoder, const void *decoder_arg):
    cdef:
        int32_t ndims = hton.unpack_int32(frb_read(buf, 4))
        int32_t flags = hton.unpack_int32(frb_read(buf, 4))
        uint32_t elem_oid = <uint32_t>hton.unpack_int32(frb_read(buf, 4))
        list result
        int i
        int32_t elem_len
        int32_t elem_count = 1
        FRBuffer elem_buf
        int32_t dims[ARRAY_MAXDIM]
        Codec elem_codec

    if ndims == 0:
        return []

    if ndims > ARRAY_MAXDIM:
        raise exceptions.ProtocolError(
            'number of array dimensions ({}) exceed the maximum expected ({})'.
            format(ndims, ARRAY_MAXDIM))
    elif ndims < 0:
        raise exceptions.ProtocolError(
            'unexpected array dimensions value: {}'.format(ndims))

    for i in range(ndims):
        dims[i] = hton.unpack_int32(frb_read(buf, 4))
        if dims[i] < 0:
            raise exceptions.ProtocolError(
                'unexpected array dimension size: {}'.format(dims[i]))
        # Ignore the lower bound information
        frb_read(buf, 4)

    if ndims == 1:
        # Fast path for flat arrays
        elem_count = dims[0]
        result = cpython.PyList_New(elem_count)

        for i in range(elem_count):
            elem_len = hton.unpack_int32(frb_read(buf, 4))
            if elem_len == -1:
                elem = None
            else:
                frb_slice_from(&elem_buf, buf, elem_len)
                elem = decoder(settings, &elem_buf, decoder_arg)

            cpython.Py_INCREF(elem)
            cpython.PyList_SET_ITEM(result, i, elem)

    else:
        result = _nested_array_decode(settings, buf,
                                      decoder, decoder_arg, ndims, dims,
                                      &elem_buf)

    return result


cdef _nested_array_decode(ConnectionSettings settings,
                          FRBuffer *buf,
                          decode_func_ex decoder,
                          const void *decoder_arg,
                          int32_t ndims, int32_t *dims,
                          FRBuffer *elem_buf):

    cdef:
        int32_t elem_len
        int64_t i, j
        int64_t array_len = 1
        object elem, stride
        # An array of pointers to lists for each current array level.
        void *strides[ARRAY_MAXDIM]
        # An array of current positions at each array level.
        int32_t indexes[ARRAY_MAXDIM]

    for i in range(ndims):
        array_len *= dims[i]
        indexes[i] = 0
        strides[i] = NULL

    if array_len == 0:
        # A multidimensional array with a zero-sized dimension?
        return []

    elif array_len < 0:
        # Array length overflow
        raise exceptions.ProtocolError('array length overflow')

    for i in range(array_len):
        # Decode the element.
        elem_len = hton.unpack_int32(frb_read(buf, 4))
        if elem_len == -1:
            elem = None
        else:
            elem = decoder(settings,
                           frb_slice_from(elem_buf, buf, elem_len),
                           decoder_arg)

        # Take an explicit reference for PyList_SET_ITEM in the below
        # loop expects this.
        cpython.Py_INCREF(elem)

        # Iterate over array dimentions and put the element in
        # the correctly nested sublist.
        for j in reversed(range(ndims)):
            if indexes[j] == 0:
                # Allocate the list for this array level.
                stride = cpython.PyList_New(dims[j])

                strides[j] = <void*><cpython.PyObject>stride
                # Take an explicit reference for PyList_SET_ITEM below
                # expects this.
                cpython.Py_INCREF(stride)

            stride = <object><cpython.PyObject*>strides[j]
            cpython.PyList_SET_ITEM(stride, indexes[j], elem)
            indexes[j] += 1

            if indexes[j] == dims[j] and j != 0:
                # This array level is full, continue the
                # ascent in the dimensions so that this level
                # sublist will be appened to the parent list.
                elem = stride
                # Reset the index, this will cause the
                # new list to be allocated on the next
                # iteration on this array axis.
                indexes[j] = 0
            else:
                break

    stride = <object><cpython.PyObject*>strides[0]
    # Since each element in strides has a refcount of 1,
    # returning strides[0] will increment it to 2, so
    # balance that.
    cpython.Py_DECREF(stride)
    return stride


cdef textarray_decode(ConnectionSettings settings, FRBuffer *buf,
                      decode_func_ex decoder, const void *decoder_arg,
                      Py_UCS4 typdelim):
    cdef:
        Py_UCS4 *array_text
        str s

    # Make a copy of array data since we will be mutating it for
    # the purposes of element decoding.
    s = pgproto.text_decode(settings, buf)
    array_text = cpythonx.PyUnicode_AsUCS4Copy(s)

    try:
        return _textarray_decode(
            settings, array_text, decoder, decoder_arg, typdelim)
    except ValueError as e:
        raise exceptions.ProtocolError(
            'malformed array literal {!r}: {}'.format(s, e.args[0]))
    finally:
        cpython.PyMem_Free(array_text)


cdef _textarray_decode(ConnectionSettings settings,
                       Py_UCS4 *array_text,
                       decode_func_ex decoder,
                       const void *decoder_arg,
                       Py_UCS4 typdelim):

    cdef:
        bytearray array_bytes
        list result
        list new_stride
        Py_UCS4 *ptr
        int32_t ndims = 0
        int32_t ubound = 0
        int32_t lbound = 0
        int32_t dims[ARRAY_MAXDIM]
        int32_t inferred_dims[ARRAY_MAXDIM]
        int32_t inferred_ndims = 0
        void *strides[ARRAY_MAXDIM]
        int32_t indexes[ARRAY_MAXDIM]
        int32_t nest_level = 0
        int32_t item_level = 0
        bint end_of_array = False

        bint end_of_item = False
        bint has_quoting = False
        bint strip_spaces = False
        bint in_quotes = False
        Py_UCS4 *item_start
        Py_UCS4 *item_ptr
        Py_UCS4 *item_end

        int i
        object item
        str item_text
        FRBuffer item_buf
        char *pg_item_str
        ssize_t pg_item_len

    ptr = array_text

    while True:
        while apg_ascii_isspace(ptr[0]):
            ptr += 1

        if ptr[0] != '[':
            # Finished parsing dimensions spec.
            break

        ptr += 1  # '['

        if ndims > ARRAY_MAXDIM:
            raise ValueError(
                'number of array dimensions ({}) exceed the '
                'maximum expected ({})'.format(ndims, ARRAY_MAXDIM))

        ptr = apg_parse_int32(ptr, &ubound)
        if ptr == NULL:
            raise ValueError('missing array dimension value')

        if ptr[0] == ':':
            ptr += 1
            lbound = ubound

            # [lower:upper] spec.  We disregard the lbound for decoding.
            ptr = apg_parse_int32(ptr, &ubound)
            if ptr == NULL:
                raise ValueError('missing array dimension value')
        else:
            lbound = 1

        if ptr[0] != ']':
            raise ValueError('missing \']\' after array dimensions')

        ptr += 1  # ']'

        dims[ndims] = ubound - lbound + 1
        ndims += 1

    if ndims != 0:
        # If dimensions were given, the '=' token is expected.
        if ptr[0] != '=':
            raise ValueError('missing \'=\' after array dimensions')

        ptr += 1  # '='

        # Skip any whitespace after the '=', whitespace
        # before was consumed in the above loop.
        while apg_ascii_isspace(ptr[0]):
            ptr += 1

        # Infer the dimensions from the brace structure in the
        # array literal body, and check that it matches the explicit
        # spec.  This also validates that the array literal is sane.
        _infer_array_dims(ptr, typdelim, inferred_dims, &inferred_ndims)

        if inferred_ndims != ndims:
            raise ValueError(
                'specified array dimensions do not match array content')

        for i in range(ndims):
            if inferred_dims[i] != dims[i]:
                raise ValueError(
                    'specified array dimensions do not match array content')
    else:
        # Infer the dimensions from the brace structure in the array literal
        # body.  This also validates that the array literal is sane.
        _infer_array_dims(ptr, typdelim, dims, &ndims)

    while not end_of_array:
        # We iterate over the literal character by character
        # and modify the string in-place removing the array-specific
        # quoting and determining the boundaries of each element.
        end_of_item = has_quoting = in_quotes = False
        strip_spaces = True

        # Pointers to array element start, end, and the current pointer
        # tracking the position where characters are written when
        # escaping is folded.
        item_start = item_end = item_ptr = ptr
        item_level = 0

        while not end_of_item:
            if ptr[0] == '"':
                in_quotes = not in_quotes
                if in_quotes:
                    strip_spaces = False
                else:
                    item_end = item_ptr
                has_quoting = True

            elif ptr[0] == '\\':
                # Quoted character, collapse the backslash.
                ptr += 1
                has_quoting = True
                item_ptr[0] = ptr[0]
                item_ptr += 1
                strip_spaces = False
                item_end = item_ptr

            elif in_quotes:
                # Consume the string until we see the closing quote.
                item_ptr[0] = ptr[0]
                item_ptr += 1

            elif ptr[0] == '{':
                # Nesting level increase.
                nest_level += 1

                indexes[nest_level - 1] = 0
                new_stride = cpython.PyList_New(dims[nest_level - 1])
                strides[nest_level - 1] = \
                    <void*>(<cpython.PyObject>new_stride)

                if nest_level > 1:
                    cpython.Py_INCREF(new_stride)
                    cpython.PyList_SET_ITEM(
                        <object><cpython.PyObject*>strides[nest_level - 2],
                        indexes[nest_level - 2],
                        new_stride)
                else:
                    result = new_stride

            elif ptr[0] == '}':
                if item_level == 0:
                    # Make sure we keep track of which nesting
                    # level the item belongs to, as the loop
                    # will continue to consume closing braces
                    # until the delimiter or the end of input.
                    item_level = nest_level

                nest_level -= 1

                if nest_level == 0:
                    end_of_array = end_of_item = True

            elif ptr[0] == typdelim:
                # Array element delimiter,
                end_of_item = True
                if item_level == 0:
                    item_level = nest_level

            elif apg_ascii_isspace(ptr[0]):
                if not strip_spaces:
                    item_ptr[0] = ptr[0]
                    item_ptr += 1
                # Ignore the leading literal whitespace.

            else:
                item_ptr[0] = ptr[0]
                item_ptr += 1
                strip_spaces = False
                item_end = item_ptr

            ptr += 1

        # end while not end_of_item

        if item_end == item_start:
            # Empty array
            continue

        item_end[0] = '\0'

        if not has_quoting and apg_strcasecmp(item_start, APG_NULL) == 0:
            # NULL element.
            item = None
        else:
            # XXX: find a way to avoid the redundant encode/decode
            # cycle here.
            item_text = cpythonx.PyUnicode_FromKindAndData(
                cpythonx.PyUnicode_4BYTE_KIND,
                <void *>item_start,
                item_end - item_start)

            # Prepare the element buffer and call the text decoder
            # for the element type.
            pgproto.as_pg_string_and_size(
                settings, item_text, &pg_item_str, &pg_item_len)
            frb_init(&item_buf, pg_item_str, pg_item_len)
            item = decoder(settings, &item_buf, decoder_arg)

        # Place the decoded element in the array.
        cpython.Py_INCREF(item)
        cpython.PyList_SET_ITEM(
            <object><cpython.PyObject*>strides[item_level - 1],
            indexes[item_level - 1],
            item)

        if nest_level > 0:
            indexes[nest_level - 1] += 1

    return result


cdef enum _ArrayParseState:
    APS_START = 1
    APS_STRIDE_STARTED = 2
    APS_STRIDE_DONE = 3
    APS_STRIDE_DELIMITED = 4
    APS_ELEM_STARTED = 5
    APS_ELEM_DELIMITED = 6


cdef _UnexpectedCharacter(const Py_UCS4 *array_text, const Py_UCS4 *ptr):
    return ValueError('unexpected character {!r} at position {}'.format(
        cpython.PyUnicode_FromOrdinal(<int>ptr[0]), ptr - array_text + 1))


cdef _infer_array_dims(const Py_UCS4 *array_text,
                       Py_UCS4 typdelim,
                       int32_t *dims,
                       int32_t *ndims):
    cdef:
        const Py_UCS4 *ptr = array_text
        int i
        int nest_level = 0
        bint end_of_array = False
        bint end_of_item = False
        bint in_quotes = False
        bint array_is_empty = True
        int stride_len[ARRAY_MAXDIM]
        int prev_stride_len[ARRAY_MAXDIM]
        _ArrayParseState parse_state = APS_START

    for i in range(ARRAY_MAXDIM):
        dims[i] = prev_stride_len[i] = 0
        stride_len[i] = 1

    while not end_of_array:
        end_of_item = False

        while not end_of_item:
            if ptr[0] == '\0':
                raise ValueError('unexpected end of string')

            elif ptr[0] == '"':
                if (parse_state not in (APS_STRIDE_STARTED,
                                        APS_ELEM_DELIMITED) and
                        not (parse_state == APS_ELEM_STARTED and in_quotes)):
                    raise _UnexpectedCharacter(array_text, ptr)

                in_quotes = not in_quotes
                if in_quotes:
                    parse_state = APS_ELEM_STARTED
                    array_is_empty = False

            elif ptr[0] == '\\':
                if parse_state not in (APS_STRIDE_STARTED,
                                       APS_ELEM_STARTED,
                                       APS_ELEM_DELIMITED):
                    raise _UnexpectedCharacter(array_text, ptr)

                parse_state = APS_ELEM_STARTED
                array_is_empty = False

                if ptr[1] != '\0':
                    ptr += 1
                else:
                    raise ValueError('unexpected end of string')

            elif in_quotes:
                # Ignore everything inside the quotes.
                pass

            elif ptr[0] == '{':
                if parse_state not in (APS_START,
                                       APS_STRIDE_STARTED,
                                       APS_STRIDE_DELIMITED):
                    raise _UnexpectedCharacter(array_text, ptr)

                parse_state = APS_STRIDE_STARTED
                if nest_level >= ARRAY_MAXDIM:
                    raise ValueError(
                        'number of array dimensions ({}) exceed the '
                        'maximum expected ({})'.format(
                            nest_level, ARRAY_MAXDIM))

                dims[nest_level] = 0
                nest_level += 1
                if ndims[0] < nest_level:
                    ndims[0] = nest_level

            elif ptr[0] == '}':
                if (parse_state not in (APS_ELEM_STARTED, APS_STRIDE_DONE) and
                        not (nest_level == 1 and
                             parse_state == APS_STRIDE_STARTED)):
                    raise _UnexpectedCharacter(array_text, ptr)

                parse_state = APS_STRIDE_DONE

                if nest_level == 0:
                    raise _UnexpectedCharacter(array_text, ptr)

                nest_level -= 1

                if (prev_stride_len[nest_level] != 0 and
                        stride_len[nest_level] != prev_stride_len[nest_level]):
                    raise ValueError(
                        'inconsistent sub-array dimensions'
                        ' at position {}'.format(
                            ptr - array_text + 1))

                prev_stride_len[nest_level] = stride_len[nest_level]
                stride_len[nest_level] = 1
                if nest_level == 0:
                    end_of_array = end_of_item = True
                else:
                    dims[nest_level - 1] += 1

            elif ptr[0] == typdelim:
                if parse_state not in (APS_ELEM_STARTED, APS_STRIDE_DONE):
                    raise _UnexpectedCharacter(array_text, ptr)

                if parse_state == APS_STRIDE_DONE:
                    parse_state = APS_STRIDE_DELIMITED
                else:
                    parse_state = APS_ELEM_DELIMITED
                end_of_item = True
                stride_len[nest_level - 1] += 1

            elif not apg_ascii_isspace(ptr[0]):
                if parse_state not in (APS_STRIDE_STARTED,
                                       APS_ELEM_STARTED,
                                       APS_ELEM_DELIMITED):
                    raise _UnexpectedCharacter(array_text, ptr)

                parse_state = APS_ELEM_STARTED
                array_is_empty = False

            if not end_of_item:
                ptr += 1

        if not array_is_empty:
            dims[ndims[0] - 1] += 1

        ptr += 1

    # only whitespace is allowed after the closing brace
    while ptr[0] != '\0':
        if not apg_ascii_isspace(ptr[0]):
            raise _UnexpectedCharacter(array_text, ptr)

        ptr += 1

    if array_is_empty:
        ndims[0] = 0


cdef uint4_encode_ex(ConnectionSettings settings, WriteBuffer buf, object obj,
                     const void *arg):
    return pgproto.uint4_encode(settings, buf, obj)


cdef uint4_decode_ex(ConnectionSettings settings, FRBuffer *buf,
                     const void *arg):
    return pgproto.uint4_decode(settings, buf)


cdef arrayoid_encode(ConnectionSettings settings, WriteBuffer buf, items):
    array_encode(settings, buf, items, OIDOID,
                 <encode_func_ex>&uint4_encode_ex, NULL)


cdef arrayoid_decode(ConnectionSettings settings, FRBuffer *buf):
    return array_decode(settings, buf, <decode_func_ex>&uint4_decode_ex, NULL)


cdef text_encode_ex(ConnectionSettings settings, WriteBuffer buf, object obj,
                    const void *arg):
    return pgproto.text_encode(settings, buf, obj)


cdef text_decode_ex(ConnectionSettings settings, FRBuffer *buf,
                    const void *arg):
    return pgproto.text_decode(settings, buf)


cdef arraytext_encode(ConnectionSettings settings, WriteBuffer buf, items):
    array_encode(settings, buf, items, TEXTOID,
                 <encode_func_ex>&text_encode_ex, NULL)


cdef arraytext_decode(ConnectionSettings settings, FRBuffer *buf):
    return array_decode(settings, buf, <decode_func_ex>&text_decode_ex, NULL)


cdef init_array_codecs():
    # oid[] and text[] are registered as core codecs
    # to make type introspection query work
    #
    register_core_codec(_OIDOID,
                        <encode_func>&arrayoid_encode,
                        <decode_func>&arrayoid_decode,
                        PG_FORMAT_BINARY)

    register_core_codec(_TEXTOID,
                        <encode_func>&arraytext_encode,
                        <decode_func>&arraytext_decode,
                        PG_FORMAT_BINARY)

init_array_codecs()
