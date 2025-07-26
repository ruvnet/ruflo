# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


cdef extern from "Python.h":
    int PyByteArray_Check(object)

    int PyMemoryView_Check(object)
    Py_buffer *PyMemoryView_GET_BUFFER(object)
    object PyMemoryView_GetContiguous(object, int buffertype, char order)

    Py_UCS4* PyUnicode_AsUCS4Copy(object) except NULL
    object PyUnicode_FromKindAndData(
        int kind, const void *buffer, Py_ssize_t size)

    int PyUnicode_4BYTE_KIND
