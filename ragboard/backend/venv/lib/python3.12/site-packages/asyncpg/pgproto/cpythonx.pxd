# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


from cpython cimport Py_buffer

cdef extern from "Python.h":
    int PyUnicode_1BYTE_KIND

    int PyByteArray_CheckExact(object)
    int PyByteArray_Resize(object, ssize_t) except -1
    object PyByteArray_FromStringAndSize(const char *, ssize_t)
    char* PyByteArray_AsString(object)

    object PyUnicode_FromString(const char *u)
    const char* PyUnicode_AsUTF8AndSize(
        object unicode, ssize_t *size) except NULL

    object PyUnicode_FromKindAndData(
        int kind, const void *buffer, Py_ssize_t size)
