# cyextension/immutabledict.pyx
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from cpython.dict cimport PyDict_New, PyDict_Update, PyDict_Size


def _readonly_fn(obj):
    raise TypeError(
        "%s object is immutable and/or readonly" % obj.__class__.__name__)


def _immutable_fn(obj):
    raise TypeError(
        "%s object is immutable" % obj.__class__.__name__)


class ReadOnlyContainer:

    __slots__ = ()

    def _readonly(self, *a,**kw):
        _readonly_fn(self)

    __delitem__ = __setitem__ = __setattr__ = _readonly


class ImmutableDictBase(dict):
    def _immutable(self, *a,**kw):
        _immutable_fn(self)

    @classmethod
    def __class_getitem__(cls, key):
        return cls

    __delitem__ = __setitem__ = __setattr__ = _immutable
    clear = pop = popitem = setdefault = update = _immutable


cdef class immutabledict(dict):
    def __repr__(self):
        return f"immutabledict({dict.__repr__(self)})"

    @classmethod
    def __class_getitem__(cls, key):
        return cls

    def union(self, *args, **kw):
        cdef dict to_merge = None
        cdef immutabledict result
        cdef Py_ssize_t args_len = len(args)
        if args_len > 1:
            raise TypeError(
                f'union expected at most 1 argument, got {args_len}'
            )
        if args_len == 1:
            attribute = args[0]
            if isinstance(attribute, dict):
                to_merge = <dict> attribute
        if to_merge is None:
            to_merge = dict(*args, **kw)

        if PyDict_Size(to_merge) == 0:
            return self

        # new + update is faster than immutabledict(self)
        result = immutabledict()
        PyDict_Update(result, self)
        PyDict_Update(result, to_merge)
        return result

    def merge_with(self, *other):
        cdef immutabledict result = None
        cdef object d
        cdef bint update = False
        if not other:
            return self
        for d in other:
            if d:
                if update == False:
                    update = True
                    # new + update is faster than immutabledict(self)
                    result = immutabledict()
                    PyDict_Update(result, self)
                PyDict_Update(
                    result, <dict>(d if isinstance(d, dict) else dict(d))
                )

        return self if update == False else result

    def copy(self):
        return self

    def __reduce__(self):
        return immutabledict, (dict(self), )

    def __delitem__(self, k):
        _immutable_fn(self)

    def __setitem__(self, k, v):
        _immutable_fn(self)

    def __setattr__(self, k, v):
        _immutable_fn(self)

    def clear(self, *args, **kw):
        _immutable_fn(self)

    def pop(self, *args, **kw):
        _immutable_fn(self)

    def popitem(self, *args, **kw):
        _immutable_fn(self)

    def setdefault(self, *args, **kw):
        _immutable_fn(self)

    def update(self, *args, **kw):
        _immutable_fn(self)

    # PEP 584
    def __ior__(self, other):
        _immutable_fn(self)

    def __or__(self, other):
        return immutabledict(dict.__or__(self, other))

    def __ror__(self, other):
        # NOTE: this is used only in cython 3.x;
        # version 0.x will call __or__ with args inversed
        return immutabledict(dict.__ror__(self, other))
