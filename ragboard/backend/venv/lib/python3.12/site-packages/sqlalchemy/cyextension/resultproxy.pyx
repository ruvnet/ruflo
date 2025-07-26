# cyextension/resultproxy.pyx
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
import operator

cdef class BaseRow:
    cdef readonly object _parent
    cdef readonly dict _key_to_index
    cdef readonly tuple _data

    def __init__(self, object parent, object processors, dict key_to_index, object data):
        """Row objects are constructed by CursorResult objects."""

        self._parent = parent

        self._key_to_index = key_to_index

        if processors:
            self._data = _apply_processors(processors, data)
        else:
            self._data = tuple(data)

    def __reduce__(self):
        return (
            rowproxy_reconstructor,
            (self.__class__, self.__getstate__()),
        )

    def __getstate__(self):
        return {"_parent": self._parent, "_data": self._data}

    def __setstate__(self, dict state):
        parent = state["_parent"]
        self._parent = parent
        self._data = state["_data"]
        self._key_to_index = parent._key_to_index

    def _values_impl(self):
        return list(self)

    def __iter__(self):
        return iter(self._data)

    def __len__(self):
        return len(self._data)

    def __hash__(self):
        return hash(self._data)

    def __getitem__(self, index):
        return self._data[index]

    def _get_by_key_impl_mapping(self, key):
        return self._get_by_key_impl(key, 0)

    cdef _get_by_key_impl(self, object key, int attr_err):
        index = self._key_to_index.get(key)
        if index is not None:
            return self._data[<int>index]
        self._parent._key_not_found(key, attr_err != 0)

    def __getattr__(self, name):
        return self._get_by_key_impl(name, 1)

    def _to_tuple_instance(self):
        return self._data


cdef tuple _apply_processors(proc, data):
    res = []
    for i in range(len(proc)):
        p = proc[i]
        if p is None:
            res.append(data[i])
        else:
            res.append(p(data[i]))
    return tuple(res)


def rowproxy_reconstructor(cls, state):
    obj = cls.__new__(cls)
    obj.__setstate__(state)
    return obj


cdef int is_contiguous(tuple indexes):
    cdef int i
    for i in range(1, len(indexes)):
        if indexes[i-1] != indexes[i] -1:
            return 0
    return 1


def tuplegetter(*indexes):
    if len(indexes) == 1 or is_contiguous(indexes) != 0:
        # slice form is faster but returns a list if input is list
        return operator.itemgetter(slice(indexes[0], indexes[-1] + 1))
    else:
        return operator.itemgetter(*indexes)
