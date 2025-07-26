# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import collections

from asyncpg.pgproto.types import (
    BitString, Point, Path, Polygon,
    Box, Line, LineSegment, Circle,
)


__all__ = (
    'Type', 'Attribute', 'Range', 'BitString', 'Point', 'Path', 'Polygon',
    'Box', 'Line', 'LineSegment', 'Circle', 'ServerVersion',
)


Type = collections.namedtuple('Type', ['oid', 'name', 'kind', 'schema'])
Type.__doc__ = 'Database data type.'
Type.oid.__doc__ = 'OID of the type.'
Type.name.__doc__ = 'Type name.  For example "int2".'
Type.kind.__doc__ = \
    'Type kind.  Can be "scalar", "array", "composite" or "range".'
Type.schema.__doc__ = 'Name of the database schema that defines the type.'


Attribute = collections.namedtuple('Attribute', ['name', 'type'])
Attribute.__doc__ = 'Database relation attribute.'
Attribute.name.__doc__ = 'Attribute name.'
Attribute.type.__doc__ = 'Attribute data type :class:`asyncpg.types.Type`.'


ServerVersion = collections.namedtuple(
    'ServerVersion', ['major', 'minor', 'micro', 'releaselevel', 'serial'])
ServerVersion.__doc__ = 'PostgreSQL server version tuple.'


class Range:
    """Immutable representation of PostgreSQL `range` type."""

    __slots__ = '_lower', '_upper', '_lower_inc', '_upper_inc', '_empty'

    def __init__(self, lower=None, upper=None, *,
                 lower_inc=True, upper_inc=False,
                 empty=False):
        self._empty = empty
        if empty:
            self._lower = self._upper = None
            self._lower_inc = self._upper_inc = False
        else:
            self._lower = lower
            self._upper = upper
            self._lower_inc = lower is not None and lower_inc
            self._upper_inc = upper is not None and upper_inc

    @property
    def lower(self):
        return self._lower

    @property
    def lower_inc(self):
        return self._lower_inc

    @property
    def lower_inf(self):
        return self._lower is None and not self._empty

    @property
    def upper(self):
        return self._upper

    @property
    def upper_inc(self):
        return self._upper_inc

    @property
    def upper_inf(self):
        return self._upper is None and not self._empty

    @property
    def isempty(self):
        return self._empty

    def _issubset_lower(self, other):
        if other._lower is None:
            return True
        if self._lower is None:
            return False

        return self._lower > other._lower or (
            self._lower == other._lower
            and (other._lower_inc or not self._lower_inc)
        )

    def _issubset_upper(self, other):
        if other._upper is None:
            return True
        if self._upper is None:
            return False

        return self._upper < other._upper or (
            self._upper == other._upper
            and (other._upper_inc or not self._upper_inc)
        )

    def issubset(self, other):
        if self._empty:
            return True
        if other._empty:
            return False

        return self._issubset_lower(other) and self._issubset_upper(other)

    def issuperset(self, other):
        return other.issubset(self)

    def __bool__(self):
        return not self._empty

    def __eq__(self, other):
        if not isinstance(other, Range):
            return NotImplemented

        return (
            self._lower,
            self._upper,
            self._lower_inc,
            self._upper_inc,
            self._empty
        ) == (
            other._lower,
            other._upper,
            other._lower_inc,
            other._upper_inc,
            other._empty
        )

    def __hash__(self):
        return hash((
            self._lower,
            self._upper,
            self._lower_inc,
            self._upper_inc,
            self._empty
        ))

    def __repr__(self):
        if self._empty:
            desc = 'empty'
        else:
            if self._lower is None or not self._lower_inc:
                lb = '('
            else:
                lb = '['

            if self._lower is not None:
                lb += repr(self._lower)

            if self._upper is not None:
                ub = repr(self._upper)
            else:
                ub = ''

            if self._upper is None or not self._upper_inc:
                ub += ')'
            else:
                ub += ']'

            desc = '{}, {}'.format(lb, ub)

        return '<Range {}>'.format(desc)

    __str__ = __repr__
