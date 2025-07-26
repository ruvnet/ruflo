# cyextension/util.pyx
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from collections.abc import Mapping

from sqlalchemy import exc

cdef tuple _Empty_Tuple = ()

cdef inline bint _mapping_or_tuple(object value):
    return isinstance(value, dict) or isinstance(value, tuple) or isinstance(value, Mapping)

cdef inline bint _check_item(object params) except 0:
    cdef object item
    cdef bint ret = 1
    if params:
        item = params[0]
        if not _mapping_or_tuple(item):
            ret = 0
            raise exc.ArgumentError(
                "List argument must consist only of tuples or dictionaries"
            )
    return ret

def _distill_params_20(object params):
    if params is None:
        return _Empty_Tuple
    elif isinstance(params, list) or isinstance(params, tuple):
        _check_item(params)
        return params
    elif isinstance(params, dict) or isinstance(params, Mapping):
        return [params]
    else:
        raise exc.ArgumentError("mapping or list expected for parameters")


def _distill_raw_params(object params):
    if params is None:
        return _Empty_Tuple
    elif isinstance(params, list):
        _check_item(params)
        return params
    elif _mapping_or_tuple(params):
        return [params]
    else:
        raise exc.ArgumentError("mapping or sequence expected for parameters")

cdef class prefix_anon_map(dict):
    def __missing__(self, str key):
        cdef str derived
        cdef int anonymous_counter
        cdef dict self_dict = self

        derived = key.split(" ", 1)[1]

        anonymous_counter = self_dict.get(derived, 1)
        self_dict[derived] = anonymous_counter + 1
        value = f"{derived}_{anonymous_counter}"
        self_dict[key] = value
        return value


cdef class cache_anon_map(dict):
    cdef int _index

    def __init__(self):
        self._index = 0

    def get_anon(self, obj):
        cdef long long idself
        cdef str id_
        cdef dict self_dict = self

        idself = id(obj)
        if idself in self_dict:
            return self_dict[idself], True
        else:
            id_ = self.__missing__(idself)
            return id_, False

    def __missing__(self, key):
        cdef str val
        cdef dict self_dict = self

        self_dict[key] = val = str(self._index)
        self._index += 1
        return val

