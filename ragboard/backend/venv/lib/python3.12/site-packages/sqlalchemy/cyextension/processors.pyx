# cyextension/processors.pyx
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
import datetime
from datetime import datetime as datetime_cls
from datetime import time as time_cls
from datetime import date as date_cls
import re

from cpython.object cimport PyObject_Str
from cpython.unicode cimport PyUnicode_AsASCIIString, PyUnicode_Check, PyUnicode_Decode
from libc.stdio cimport sscanf


def int_to_boolean(value):
    if value is None:
        return None
    return True if value else False

def to_str(value):
    return PyObject_Str(value) if value is not None else None

def to_float(value):
    return float(value) if value is not None else None

cdef inline bytes to_bytes(object value, str type_name):
    try:
        return PyUnicode_AsASCIIString(value)
    except Exception as e:
        raise ValueError(
            f"Couldn't parse {type_name} string '{value!r}' "
            "- value is not a string."
        ) from e

def str_to_datetime(value):
    if value is not None:
        value = datetime_cls.fromisoformat(value)
    return value

def str_to_time(value):
    if value is not None:
        value = time_cls.fromisoformat(value)
    return value


def str_to_date(value):
    if value is not None:
        value = date_cls.fromisoformat(value)
    return value



cdef class DecimalResultProcessor:
    cdef object type_
    cdef str format_

    def __cinit__(self, type_, format_):
        self.type_ = type_
        self.format_ = format_

    def process(self, object value):
        if value is None:
            return None
        else:
            return self.type_(self.format_ % value)
