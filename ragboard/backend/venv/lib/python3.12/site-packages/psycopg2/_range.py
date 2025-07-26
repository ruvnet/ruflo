"""Implementation of the Range type and adaptation

"""

# psycopg/_range.py - Implementation of the Range type and adaptation
#
# Copyright (C) 2012-2019 Daniele Varrazzo  <daniele.varrazzo@gmail.com>
# Copyright (C) 2020-2021 The Psycopg Team
#
# psycopg2 is free software: you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# In addition, as a special exception, the copyright holders give
# permission to link this program with the OpenSSL library (or with
# modified versions of OpenSSL that use the same license as OpenSSL),
# and distribute linked combinations including the two.
#
# You must obey the GNU Lesser General Public License in all respects for
# all of the code used other than OpenSSL.
#
# psycopg2 is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
# FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public
# License for more details.

import re

from psycopg2._psycopg import ProgrammingError, InterfaceError
from psycopg2.extensions import ISQLQuote, adapt, register_adapter
from psycopg2.extensions import new_type, new_array_type, register_type


class Range:
    """Python representation for a PostgreSQL |range|_ type.

    :param lower: lower bound for the range. `!None` means unbound
    :param upper: upper bound for the range. `!None` means unbound
    :param bounds: one of the literal strings ``()``, ``[)``, ``(]``, ``[]``,
        representing whether the lower or upper bounds are included
    :param empty: if `!True`, the range is empty

    """
    __slots__ = ('_lower', '_upper', '_bounds')

    def __init__(self, lower=None, upper=None, bounds='[)', empty=False):
        if not empty:
            if bounds not in ('[)', '(]', '()', '[]'):
                raise ValueError(f"bound flags not valid: {bounds!r}")

            self._lower = lower
            self._upper = upper
            self._bounds = bounds
        else:
            self._lower = self._upper = self._bounds = None

    def __repr__(self):
        if self._bounds is None:
            return f"{self.__class__.__name__}(empty=True)"
        else:
            return "{}({!r}, {!r}, {!r})".format(self.__class__.__name__,
                self._lower, self._upper, self._bounds)

    def __str__(self):
        if self._bounds is None:
            return 'empty'

        items = [
            self._bounds[0],
            str(self._lower),
            ', ',
            str(self._upper),
            self._bounds[1]
        ]
        return ''.join(items)

    @property
    def lower(self):
        """The lower bound of the range. `!None` if empty or unbound."""
        return self._lower

    @property
    def upper(self):
        """The upper bound of the range. `!None` if empty or unbound."""
        return self._upper

    @property
    def isempty(self):
        """`!True` if the range is empty."""
        return self._bounds is None

    @property
    def lower_inf(self):
        """`!True` if the range doesn't have a lower bound."""
        if self._bounds is None:
            return False
        return self._lower is None

    @property
    def upper_inf(self):
        """`!True` if the range doesn't have an upper bound."""
        if self._bounds is None:
            return False
        return self._upper is None

    @property
    def lower_inc(self):
        """`!True` if the lower bound is included in the range."""
        if self._bounds is None or self._lower is None:
            return False
        return self._bounds[0] == '['

    @property
    def upper_inc(self):
        """`!True` if the upper bound is included in the range."""
        if self._bounds is None or self._upper is None:
            return False
        return self._bounds[1] == ']'

    def __contains__(self, x):
        if self._bounds is None:
            return False

        if self._lower is not None:
            if self._bounds[0] == '[':
                if x < self._lower:
                    return False
            else:
                if x <= self._lower:
                    return False

        if self._upper is not None:
            if self._bounds[1] == ']':
                if x > self._upper:
                    return False
            else:
                if x >= self._upper:
                    return False

        return True

    def __bool__(self):
        return self._bounds is not None

    def __eq__(self, other):
        if not isinstance(other, Range):
            return False
        return (self._lower == other._lower
            and self._upper == other._upper
            and self._bounds == other._bounds)

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return hash((self._lower, self._upper, self._bounds))

    # as the postgres docs describe for the server-side stuff,
    # ordering is rather arbitrary, but will remain stable
    # and consistent.

    def __lt__(self, other):
        if not isinstance(other, Range):
            return NotImplemented
        for attr in ('_lower', '_upper', '_bounds'):
            self_value = getattr(self, attr)
            other_value = getattr(other, attr)
            if self_value == other_value:
                pass
            elif self_value is None:
                return True
            elif other_value is None:
                return False
            else:
                return self_value < other_value
        return False

    def __le__(self, other):
        if self == other:
            return True
        else:
            return self.__lt__(other)

    def __gt__(self, other):
        if isinstance(other, Range):
            return other.__lt__(self)
        else:
            return NotImplemented

    def __ge__(self, other):
        if self == other:
            return True
        else:
            return self.__gt__(other)

    def __getstate__(self):
        return {slot: getattr(self, slot)
            for slot in self.__slots__ if hasattr(self, slot)}

    def __setstate__(self, state):
        for slot, value in state.items():
            setattr(self, slot, value)


def register_range(pgrange, pyrange, conn_or_curs, globally=False):
    """Create and register an adapter and the typecasters to convert between
    a PostgreSQL |range|_ type and a PostgreSQL `Range` subclass.

    :param pgrange: the name of the PostgreSQL |range| type. Can be
        schema-qualified
    :param pyrange: a `Range` strict subclass, or just a name to give to a new
        class
    :param conn_or_curs: a connection or cursor used to find the oid of the
        range and its subtype; the typecaster is registered in a scope limited
        to this object, unless *globally* is set to `!True`
    :param globally: if `!False` (default) register the typecaster only on
        *conn_or_curs*, otherwise register it globally
    :return: `RangeCaster` instance responsible for the conversion

    If a string is passed to *pyrange*, a new `Range` subclass is created
    with such name and will be available as the `~RangeCaster.range` attribute
    of the returned `RangeCaster` object.

    The function queries the database on *conn_or_curs* to inspect the
    *pgrange* type and raises `~psycopg2.ProgrammingError` if the type is not
    found.  If querying the database is not advisable, use directly the
    `RangeCaster` class and register the adapter and typecasters using the
    provided functions.

    """
    caster = RangeCaster._from_db(pgrange, pyrange, conn_or_curs)
    caster._register(not globally and conn_or_curs or None)
    return caster


class RangeAdapter:
    """`ISQLQuote` adapter for `Range` subclasses.

    This is an abstract class: concrete classes must set a `name` class
    attribute or override `getquoted()`.
    """
    name = None

    def __init__(self, adapted):
        self.adapted = adapted

    def __conform__(self, proto):
        if self._proto is ISQLQuote:
            return self

    def prepare(self, conn):
        self._conn = conn

    def getquoted(self):
        if self.name is None:
            raise NotImplementedError(
                'RangeAdapter must be subclassed overriding its name '
                'or the getquoted() method')

        r = self.adapted
        if r.isempty:
            return b"'empty'::" + self.name.encode('utf8')

        if r.lower is not None:
            a = adapt(r.lower)
            if hasattr(a, 'prepare'):
                a.prepare(self._conn)
            lower = a.getquoted()
        else:
            lower = b'NULL'

        if r.upper is not None:
            a = adapt(r.upper)
            if hasattr(a, 'prepare'):
                a.prepare(self._conn)
            upper = a.getquoted()
        else:
            upper = b'NULL'

        return self.name.encode('utf8') + b'(' + lower + b', ' + upper \
            + b", '" + r._bounds.encode('utf8') + b"')"


class RangeCaster:
    """Helper class to convert between `Range` and PostgreSQL range types.

    Objects of this class are usually created by `register_range()`. Manual
    creation could be useful if querying the database is not advisable: in
    this case the oids must be provided.
    """
    def __init__(self, pgrange, pyrange, oid, subtype_oid, array_oid=None):
        self.subtype_oid = subtype_oid
        self._create_ranges(pgrange, pyrange)

        name = self.adapter.name or self.adapter.__class__.__name__

        self.typecaster = new_type((oid,), name, self.parse)

        if array_oid is not None:
            self.array_typecaster = new_array_type(
                (array_oid,), name + "ARRAY", self.typecaster)
        else:
            self.array_typecaster = None

    def _create_ranges(self, pgrange, pyrange):
        """Create Range and RangeAdapter classes if needed."""
        # if got a string create a new RangeAdapter concrete type (with a name)
        # else take it as an adapter. Passing an adapter should be considered
        # an implementation detail and is not documented. It is currently used
        # for the numeric ranges.
        self.adapter = None
        if isinstance(pgrange, str):
            self.adapter = type(pgrange, (RangeAdapter,), {})
            self.adapter.name = pgrange
        else:
            try:
                if issubclass(pgrange, RangeAdapter) \
                        and pgrange is not RangeAdapter:
                    self.adapter = pgrange
            except TypeError:
                pass

        if self.adapter is None:
            raise TypeError(
                'pgrange must be a string or a RangeAdapter strict subclass')

        self.range = None
        try:
            if isinstance(pyrange, str):
                self.range = type(pyrange, (Range,), {})
            if issubclass(pyrange, Range) and pyrange is not Range:
                self.range = pyrange
        except TypeError:
            pass

        if self.range is None:
            raise TypeError(
                'pyrange must be a type or a Range strict subclass')

    @classmethod
    def _from_db(self, name, pyrange, conn_or_curs):
        """Return a `RangeCaster` instance for the type *pgrange*.

        Raise `ProgrammingError` if the type is not found.
        """
        from psycopg2.extensions import STATUS_IN_TRANSACTION
        from psycopg2.extras import _solve_conn_curs
        conn, curs = _solve_conn_curs(conn_or_curs)

        if conn.info.server_version < 90200:
            raise ProgrammingError("range types not available in version %s"
                % conn.info.server_version)

        # Store the transaction status of the connection to revert it after use
        conn_status = conn.status

        # Use the correct schema
        if '.' in name:
            schema, tname = name.split('.', 1)
        else:
            tname = name
            schema = 'public'

        # get the type oid and attributes
        curs.execute("""\
select rngtypid, rngsubtype, typarray
from pg_range r
join pg_type t on t.oid = rngtypid
join pg_namespace ns on ns.oid = typnamespace
where typname = %s and ns.nspname = %s;
""", (tname, schema))
        rec = curs.fetchone()

        if not rec:
            # The above algorithm doesn't work for customized seach_path
            # (#1487) The implementation below works better, but, to guarantee
            # backwards compatibility, use it only if the original one failed.
            try:
                savepoint = False
                # Because we executed statements earlier, we are either INTRANS
                # or we are IDLE only if the transaction is autocommit, in
                # which case we don't need the savepoint anyway.
                if conn.status == STATUS_IN_TRANSACTION:
                    curs.execute("SAVEPOINT register_type")
                    savepoint = True

                curs.execute("""\
SELECT rngtypid, rngsubtype, typarray, typname, nspname
from pg_range r
join pg_type t on t.oid = rngtypid
join pg_namespace ns on ns.oid = typnamespace
WHERE t.oid = %s::regtype
""", (name, ))
            except ProgrammingError:
                pass
            else:
                rec = curs.fetchone()
                if rec:
                    tname, schema = rec[3:]
            finally:
                if savepoint:
                    curs.execute("ROLLBACK TO SAVEPOINT register_type")

        # revert the status of the connection as before the command
        if conn_status != STATUS_IN_TRANSACTION and not conn.autocommit:
            conn.rollback()

        if not rec:
            raise ProgrammingError(
                f"PostgreSQL range '{name}' not found")

        type, subtype, array = rec[:3]

        return RangeCaster(name, pyrange,
            oid=type, subtype_oid=subtype, array_oid=array)

    _re_range = re.compile(r"""
        ( \(|\[ )                   # lower bound flag
        (?:                         # lower bound:
          " ( (?: [^"] | "")* ) "   #   - a quoted string
          | ( [^",]+ )              #   - or an unquoted string
        )?                          #   - or empty (not catched)
        ,
        (?:                         # upper bound:
          " ( (?: [^"] | "")* ) "   #   - a quoted string
          | ( [^"\)\]]+ )           #   - or an unquoted string
        )?                          #   - or empty (not catched)
        ( \)|\] )                   # upper bound flag
        """, re.VERBOSE)

    _re_undouble = re.compile(r'(["\\])\1')

    def parse(self, s, cur=None):
        if s is None:
            return None

        if s == 'empty':
            return self.range(empty=True)

        m = self._re_range.match(s)
        if m is None:
            raise InterfaceError(f"failed to parse range: '{s}'")

        lower = m.group(3)
        if lower is None:
            lower = m.group(2)
            if lower is not None:
                lower = self._re_undouble.sub(r"\1", lower)

        upper = m.group(5)
        if upper is None:
            upper = m.group(4)
            if upper is not None:
                upper = self._re_undouble.sub(r"\1", upper)

        if cur is not None:
            lower = cur.cast(self.subtype_oid, lower)
            upper = cur.cast(self.subtype_oid, upper)

        bounds = m.group(1) + m.group(6)

        return self.range(lower, upper, bounds)

    def _register(self, scope=None):
        register_type(self.typecaster, scope)
        if self.array_typecaster is not None:
            register_type(self.array_typecaster, scope)

        register_adapter(self.range, self.adapter)


class NumericRange(Range):
    """A `Range` suitable to pass Python numeric types to a PostgreSQL range.

    PostgreSQL types :sql:`int4range`, :sql:`int8range`, :sql:`numrange` are
    casted into `!NumericRange` instances.
    """
    pass


class DateRange(Range):
    """Represents :sql:`daterange` values."""
    pass


class DateTimeRange(Range):
    """Represents :sql:`tsrange` values."""
    pass


class DateTimeTZRange(Range):
    """Represents :sql:`tstzrange` values."""
    pass


# Special adaptation for NumericRange. Allows to pass number range regardless
# of whether they are ints, floats and what size of ints are, which are
# pointless in Python world. On the way back, no numeric range is casted to
# NumericRange, but only to their subclasses

class NumberRangeAdapter(RangeAdapter):
    """Adapt a range if the subtype doesn't need quotes."""
    def getquoted(self):
        r = self.adapted
        if r.isempty:
            return b"'empty'"

        if not r.lower_inf:
            # not exactly: we are relying that none of these object is really
            # quoted (they are numbers). Also, I'm lazy and not preparing the
            # adapter because I assume encoding doesn't matter for these
            # objects.
            lower = adapt(r.lower).getquoted().decode('ascii')
        else:
            lower = ''

        if not r.upper_inf:
            upper = adapt(r.upper).getquoted().decode('ascii')
        else:
            upper = ''

        return (f"'{r._bounds[0]}{lower},{upper}{r._bounds[1]}'").encode('ascii')


# TODO: probably won't work with infs, nans and other tricky cases.
register_adapter(NumericRange, NumberRangeAdapter)

# Register globally typecasters and adapters for builtin range types.

# note: the adapter is registered more than once, but this is harmless.
int4range_caster = RangeCaster(NumberRangeAdapter, NumericRange,
    oid=3904, subtype_oid=23, array_oid=3905)
int4range_caster._register()

int8range_caster = RangeCaster(NumberRangeAdapter, NumericRange,
    oid=3926, subtype_oid=20, array_oid=3927)
int8range_caster._register()

numrange_caster = RangeCaster(NumberRangeAdapter, NumericRange,
    oid=3906, subtype_oid=1700, array_oid=3907)
numrange_caster._register()

daterange_caster = RangeCaster('daterange', DateRange,
    oid=3912, subtype_oid=1082, array_oid=3913)
daterange_caster._register()

tsrange_caster = RangeCaster('tsrange', DateTimeRange,
    oid=3908, subtype_oid=1114, array_oid=3909)
tsrange_caster._register()

tstzrange_caster = RangeCaster('tstzrange', DateTimeTZRange,
    oid=3910, subtype_oid=1184, array_oid=3911)
tstzrange_caster._register()
