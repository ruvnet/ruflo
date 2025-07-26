# cyextension/collections.pyx
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
cimport cython
from cpython.long cimport PyLong_FromLongLong
from cpython.set cimport PySet_Add

from collections.abc import Collection
from itertools import filterfalse

cdef bint add_not_present(set seen, object item, hashfunc):
    hash_value = hashfunc(item)
    if hash_value not in seen:
        PySet_Add(seen, hash_value)
        return True
    else:
        return False

cdef list cunique_list(seq, hashfunc=None):
    cdef set seen = set()
    if not hashfunc:
        return [x for x in seq if x not in seen and not PySet_Add(seen, x)]
    else:
        return [x for x in seq if add_not_present(seen, x, hashfunc)]

def unique_list(seq, hashfunc=None):
    return cunique_list(seq, hashfunc)

cdef class OrderedSet(set):

    cdef list _list

    @classmethod
    def __class_getitem__(cls, key):
        return cls

    def __init__(self, d=None):
        set.__init__(self)
        if d is not None:
            self._list = cunique_list(d)
            set.update(self, self._list)
        else:
            self._list = []

    cpdef OrderedSet copy(self):
        cdef OrderedSet cp = OrderedSet.__new__(OrderedSet)
        cp._list = list(self._list)
        set.update(cp, cp._list)
        return cp

    @cython.final
    cdef OrderedSet _from_list(self, list new_list):
        cdef OrderedSet new = OrderedSet.__new__(OrderedSet)
        new._list = new_list
        set.update(new, new_list)
        return new

    def add(self, element):
        if element not in self:
            self._list.append(element)
            PySet_Add(self, element)

    def remove(self, element):
        # set.remove will raise if element is not in self
        set.remove(self, element)
        self._list.remove(element)

    def pop(self):
        try:
            value = self._list.pop()
        except IndexError:
            raise KeyError("pop from an empty set") from None
        set.remove(self, value)
        return value

    def insert(self, Py_ssize_t pos, element):
        if element not in self:
            self._list.insert(pos, element)
            PySet_Add(self, element)

    def discard(self, element):
        if element in self:
            set.remove(self, element)
            self._list.remove(element)

    def clear(self):
        set.clear(self)
        self._list = []

    def __getitem__(self, key):
        return self._list[key]

    def __iter__(self):
        return iter(self._list)

    def __add__(self, other):
        return self.union(other)

    def __repr__(self):
        return "%s(%r)" % (self.__class__.__name__, self._list)

    __str__ = __repr__

    def update(self, *iterables):
        for iterable in iterables:
            for e in iterable:
                if e not in self:
                    self._list.append(e)
                    set.add(self, e)

    def __ior__(self, iterable):
        self.update(iterable)
        return self

    def union(self, *other):
        result = self.copy()
        result.update(*other)
        return result

    def __or__(self, other):
        return self.union(other)

    def intersection(self, *other):
        cdef set other_set = set.intersection(self, *other)
        return self._from_list([a for a in self._list if a in other_set])

    def __and__(self, other):
        return self.intersection(other)

    def symmetric_difference(self, other):
        cdef set other_set
        if isinstance(other, set):
            other_set = <set> other
            collection = other_set
        elif isinstance(other, Collection):
            collection = other
            other_set = set(other)
        else:
            collection = list(other)
            other_set = set(collection)
        result = self._from_list([a for a in self._list if a not in other_set])
        result.update(a for a in collection if a not in self)
        return result

    def __xor__(self, other):
        return self.symmetric_difference(other)

    def difference(self, *other):
        cdef set other_set = set.difference(self, *other)
        return self._from_list([a for a in self._list if a in other_set])

    def __sub__(self, other):
        return self.difference(other)

    def intersection_update(self, *other):
        set.intersection_update(self, *other)
        self._list = [a for a in self._list if a in self]

    def __iand__(self, other):
        self.intersection_update(other)
        return self

    cpdef symmetric_difference_update(self, other):
        collection = other if isinstance(other, Collection) else list(other)
        set.symmetric_difference_update(self, collection)
        self._list = [a for a in self._list if a in self]
        self._list += [a for a in collection if a in self]

    def __ixor__(self, other):
        self.symmetric_difference_update(other)
        return self

    def difference_update(self, *other):
        set.difference_update(self, *other)
        self._list = [a for a in self._list if a in self]

    def __isub__(self, other):
        self.difference_update(other)
        return self

cdef object cy_id(object item):
    return PyLong_FromLongLong(<long long> (<void *>item))

# NOTE: cython 0.x will call __add__, __sub__, etc with the parameter swapped
# instead of the __rmeth__, so they need to check that also self is of the
# correct type. This is fixed in cython 3.x. See:
# https://docs.cython.org/en/latest/src/userguide/special_methods.html#arithmetic-methods
cdef class IdentitySet:
    """A set that considers only object id() for uniqueness.

    This strategy has edge cases for builtin types- it's possible to have
    two 'foo' strings in one of these sets, for example.  Use sparingly.

    """

    cdef dict _members

    def __init__(self, iterable=None):
        self._members = {}
        if iterable:
            self.update(iterable)

    def add(self, value):
        self._members[cy_id(value)] = value

    def __contains__(self, value):
        return cy_id(value) in self._members

    cpdef remove(self, value):
        del self._members[cy_id(value)]

    def discard(self, value):
        try:
            self.remove(value)
        except KeyError:
            pass

    def pop(self):
        cdef tuple pair
        try:
            pair = self._members.popitem()
            return pair[1]
        except KeyError:
            raise KeyError("pop from an empty set")

    def clear(self):
        self._members.clear()

    def __eq__(self, other):
        cdef IdentitySet other_
        if isinstance(other, IdentitySet):
            other_ = other
            return self._members == other_._members
        else:
            return False

    def __ne__(self, other):
        cdef IdentitySet other_
        if isinstance(other, IdentitySet):
            other_ = other
            return self._members != other_._members
        else:
            return True

    cpdef issubset(self, iterable):
        cdef IdentitySet other
        if isinstance(iterable, self.__class__):
            other = iterable
        else:
            other = self.__class__(iterable)

        if len(self) > len(other):
            return False
        for m in filterfalse(other._members.__contains__, self._members):
            return False
        return True

    def __le__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        return self.issubset(other)

    def __lt__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        return len(self) < len(other) and self.issubset(other)

    cpdef issuperset(self, iterable):
        cdef IdentitySet other
        if isinstance(iterable, self.__class__):
            other = iterable
        else:
            other = self.__class__(iterable)

        if len(self) < len(other):
            return False
        for m in filterfalse(self._members.__contains__, other._members):
            return False
        return True

    def __ge__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        return self.issuperset(other)

    def __gt__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        return len(self) > len(other) and self.issuperset(other)

    cpdef IdentitySet union(self, iterable):
        cdef IdentitySet result = self.__class__()
        result._members.update(self._members)
        result.update(iterable)
        return result

    def __or__(self, other):
        if not isinstance(other, IdentitySet) or not isinstance(self, IdentitySet):
            return NotImplemented
        return self.union(other)

    cpdef update(self, iterable):
        for obj in iterable:
            self._members[cy_id(obj)] = obj

    def __ior__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        self.update(other)
        return self

    cpdef IdentitySet difference(self, iterable):
        cdef IdentitySet result = self.__new__(self.__class__)
        if isinstance(iterable, self.__class__):
            other = (<IdentitySet>iterable)._members
        else:
            other = {cy_id(obj) for obj in iterable}
        result._members = {k:v for k, v in self._members.items() if k not in other}
        return result

    def __sub__(self, other):
        if not isinstance(other, IdentitySet) or not isinstance(self, IdentitySet):
            return NotImplemented
        return self.difference(other)

    cpdef difference_update(self, iterable):
        cdef IdentitySet other = self.difference(iterable)
        self._members = other._members

    def __isub__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        self.difference_update(other)
        return self

    cpdef IdentitySet intersection(self, iterable):
        cdef IdentitySet result = self.__new__(self.__class__)
        if isinstance(iterable, self.__class__):
            other = (<IdentitySet>iterable)._members
        else:
            other = {cy_id(obj) for obj in iterable}
        result._members = {k: v for k, v in self._members.items() if k in other}
        return result

    def __and__(self, other):
        if not isinstance(other, IdentitySet) or not isinstance(self, IdentitySet):
            return NotImplemented
        return self.intersection(other)

    cpdef intersection_update(self, iterable):
        cdef IdentitySet other = self.intersection(iterable)
        self._members = other._members

    def __iand__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        self.intersection_update(other)
        return self

    cpdef IdentitySet symmetric_difference(self, iterable):
        cdef IdentitySet result = self.__new__(self.__class__)
        cdef dict other
        if isinstance(iterable, self.__class__):
            other = (<IdentitySet>iterable)._members
        else:
            other = {cy_id(obj): obj for obj in iterable}
        result._members = {k: v for k, v in self._members.items() if k not in other}
        result._members.update(
            [(k, v) for k, v in other.items() if k not in self._members]
        )
        return result

    def __xor__(self, other):
        if not isinstance(other, IdentitySet) or not isinstance(self, IdentitySet):
            return NotImplemented
        return self.symmetric_difference(other)

    cpdef symmetric_difference_update(self, iterable):
        cdef IdentitySet other = self.symmetric_difference(iterable)
        self._members = other._members

    def __ixor__(self, other):
        if not isinstance(other, IdentitySet):
            return NotImplemented
        self.symmetric_difference(other)
        return self

    cpdef IdentitySet copy(self):
        cdef IdentitySet cp = self.__new__(self.__class__)
        cp._members = self._members.copy()
        return cp

    def __copy__(self):
        return self.copy()

    def __len__(self):
        return len(self._members)

    def __iter__(self):
        return iter(self._members.values())

    def __hash__(self):
        raise TypeError("set objects are unhashable")

    def __repr__(self):
        return "%s(%r)" % (type(self).__name__, list(self._members.values()))
