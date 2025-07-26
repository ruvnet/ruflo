"""SQL composition utility module
"""

# psycopg/sql.py - SQL composition utility module
#
# Copyright (C) 2016-2019 Daniele Varrazzo  <daniele.varrazzo@gmail.com>
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

import string

from psycopg2 import extensions as ext


_formatter = string.Formatter()


class Composable:
    """
    Abstract base class for objects that can be used to compose an SQL string.

    `!Composable` objects can be passed directly to `~cursor.execute()`,
    `~cursor.executemany()`, `~cursor.copy_expert()` in place of the query
    string.

    `!Composable` objects can be joined using the ``+`` operator: the result
    will be a `Composed` instance containing the objects joined. The operator
    ``*`` is also supported with an integer argument: the result is a
    `!Composed` instance containing the left argument repeated as many times as
    requested.
    """
    def __init__(self, wrapped):
        self._wrapped = wrapped

    def __repr__(self):
        return f"{self.__class__.__name__}({self._wrapped!r})"

    def as_string(self, context):
        """
        Return the string value of the object.

        :param context: the context to evaluate the string into.
        :type context: `connection` or `cursor`

        The method is automatically invoked by `~cursor.execute()`,
        `~cursor.executemany()`, `~cursor.copy_expert()` if a `!Composable` is
        passed instead of the query string.
        """
        raise NotImplementedError

    def __add__(self, other):
        if isinstance(other, Composed):
            return Composed([self]) + other
        if isinstance(other, Composable):
            return Composed([self]) + Composed([other])
        else:
            return NotImplemented

    def __mul__(self, n):
        return Composed([self] * n)

    def __eq__(self, other):
        return type(self) is type(other) and self._wrapped == other._wrapped

    def __ne__(self, other):
        return not self.__eq__(other)


class Composed(Composable):
    """
    A `Composable` object made of a sequence of `!Composable`.

    The object is usually created using `!Composable` operators and methods.
    However it is possible to create a `!Composed` directly specifying a
    sequence of `!Composable` as arguments.

    Example::

        >>> comp = sql.Composed(
        ...     [sql.SQL("insert into "), sql.Identifier("table")])
        >>> print(comp.as_string(conn))
        insert into "table"

    `!Composed` objects are iterable (so they can be used in `SQL.join` for
    instance).
    """
    def __init__(self, seq):
        wrapped = []
        for i in seq:
            if not isinstance(i, Composable):
                raise TypeError(
                    f"Composed elements must be Composable, got {i!r} instead")
            wrapped.append(i)

        super().__init__(wrapped)

    @property
    def seq(self):
        """The list of the content of the `!Composed`."""
        return list(self._wrapped)

    def as_string(self, context):
        rv = []
        for i in self._wrapped:
            rv.append(i.as_string(context))
        return ''.join(rv)

    def __iter__(self):
        return iter(self._wrapped)

    def __add__(self, other):
        if isinstance(other, Composed):
            return Composed(self._wrapped + other._wrapped)
        if isinstance(other, Composable):
            return Composed(self._wrapped + [other])
        else:
            return NotImplemented

    def join(self, joiner):
        """
        Return a new `!Composed` interposing the *joiner* with the `!Composed` items.

        The *joiner* must be a `SQL` or a string which will be interpreted as
        an `SQL`.

        Example::

            >>> fields = sql.Identifier('foo') + sql.Identifier('bar')  # a Composed
            >>> print(fields.join(', ').as_string(conn))
            "foo", "bar"

        """
        if isinstance(joiner, str):
            joiner = SQL(joiner)
        elif not isinstance(joiner, SQL):
            raise TypeError(
                "Composed.join() argument must be a string or an SQL")

        return joiner.join(self)


class SQL(Composable):
    """
    A `Composable` representing a snippet of SQL statement.

    `!SQL` exposes `join()` and `format()` methods useful to create a template
    where to merge variable parts of a query (for instance field or table
    names).

    The *string* doesn't undergo any form of escaping, so it is not suitable to
    represent variable identifiers or values: you should only use it to pass
    constant strings representing templates or snippets of SQL statements; use
    other objects such as `Identifier` or `Literal` to represent variable
    parts.

    Example::

        >>> query = sql.SQL("select {0} from {1}").format(
        ...    sql.SQL(', ').join([sql.Identifier('foo'), sql.Identifier('bar')]),
        ...    sql.Identifier('table'))
        >>> print(query.as_string(conn))
        select "foo", "bar" from "table"
    """
    def __init__(self, string):
        if not isinstance(string, str):
            raise TypeError("SQL values must be strings")
        super().__init__(string)

    @property
    def string(self):
        """The string wrapped by the `!SQL` object."""
        return self._wrapped

    def as_string(self, context):
        return self._wrapped

    def format(self, *args, **kwargs):
        """
        Merge `Composable` objects into a template.

        :param `Composable` args: parameters to replace to numbered
            (``{0}``, ``{1}``) or auto-numbered (``{}``) placeholders
        :param `Composable` kwargs: parameters to replace to named (``{name}``)
            placeholders
        :return: the union of the `!SQL` string with placeholders replaced
        :rtype: `Composed`

        The method is similar to the Python `str.format()` method: the string
        template supports auto-numbered (``{}``), numbered (``{0}``,
        ``{1}``...), and named placeholders (``{name}``), with positional
        arguments replacing the numbered placeholders and keywords replacing
        the named ones. However placeholder modifiers (``{0!r}``, ``{0:<10}``)
        are not supported. Only `!Composable` objects can be passed to the
        template.

        Example::

            >>> print(sql.SQL("select * from {} where {} = %s")
            ...     .format(sql.Identifier('people'), sql.Identifier('id'))
            ...     .as_string(conn))
            select * from "people" where "id" = %s

            >>> print(sql.SQL("select * from {tbl} where {pkey} = %s")
            ...     .format(tbl=sql.Identifier('people'), pkey=sql.Identifier('id'))
            ...     .as_string(conn))
            select * from "people" where "id" = %s

        """
        rv = []
        autonum = 0
        for pre, name, spec, conv in _formatter.parse(self._wrapped):
            if spec:
                raise ValueError("no format specification supported by SQL")
            if conv:
                raise ValueError("no format conversion supported by SQL")
            if pre:
                rv.append(SQL(pre))

            if name is None:
                continue

            if name.isdigit():
                if autonum:
                    raise ValueError(
                        "cannot switch from automatic field numbering to manual")
                rv.append(args[int(name)])
                autonum = None

            elif not name:
                if autonum is None:
                    raise ValueError(
                        "cannot switch from manual field numbering to automatic")
                rv.append(args[autonum])
                autonum += 1

            else:
                rv.append(kwargs[name])

        return Composed(rv)

    def join(self, seq):
        """
        Join a sequence of `Composable`.

        :param seq: the elements to join.
        :type seq: iterable of `!Composable`

        Use the `!SQL` object's *string* to separate the elements in *seq*.
        Note that `Composed` objects are iterable too, so they can be used as
        argument for this method.

        Example::

            >>> snip = sql.SQL(', ').join(
            ...     sql.Identifier(n) for n in ['foo', 'bar', 'baz'])
            >>> print(snip.as_string(conn))
            "foo", "bar", "baz"
        """
        rv = []
        it = iter(seq)
        try:
            rv.append(next(it))
        except StopIteration:
            pass
        else:
            for i in it:
                rv.append(self)
                rv.append(i)

        return Composed(rv)


class Identifier(Composable):
    """
    A `Composable` representing an SQL identifier or a dot-separated sequence.

    Identifiers usually represent names of database objects, such as tables or
    fields. PostgreSQL identifiers follow `different rules`__ than SQL string
    literals for escaping (e.g. they use double quotes instead of single).

    .. __: https://www.postgresql.org/docs/current/static/sql-syntax-lexical.html# \
        SQL-SYNTAX-IDENTIFIERS

    Example::

        >>> t1 = sql.Identifier("foo")
        >>> t2 = sql.Identifier("ba'r")
        >>> t3 = sql.Identifier('ba"z')
        >>> print(sql.SQL(', ').join([t1, t2, t3]).as_string(conn))
        "foo", "ba'r", "ba""z"

    Multiple strings can be passed to the object to represent a qualified name,
    i.e. a dot-separated sequence of identifiers.

    Example::

        >>> query = sql.SQL("select {} from {}").format(
        ...     sql.Identifier("table", "field"),
        ...     sql.Identifier("schema", "table"))
        >>> print(query.as_string(conn))
        select "table"."field" from "schema"."table"

    """
    def __init__(self, *strings):
        if not strings:
            raise TypeError("Identifier cannot be empty")

        for s in strings:
            if not isinstance(s, str):
                raise TypeError("SQL identifier parts must be strings")

        super().__init__(strings)

    @property
    def strings(self):
        """A tuple with the strings wrapped by the `Identifier`."""
        return self._wrapped

    @property
    def string(self):
        """The string wrapped by the `Identifier`.
        """
        if len(self._wrapped) == 1:
            return self._wrapped[0]
        else:
            raise AttributeError(
                "the Identifier wraps more than one than one string")

    def __repr__(self):
        return f"{self.__class__.__name__}({', '.join(map(repr, self._wrapped))})"

    def as_string(self, context):
        return '.'.join(ext.quote_ident(s, context) for s in self._wrapped)


class Literal(Composable):
    """
    A `Composable` representing an SQL value to include in a query.

    Usually you will want to include placeholders in the query and pass values
    as `~cursor.execute()` arguments. If however you really really need to
    include a literal value in the query you can use this object.

    The string returned by `!as_string()` follows the normal :ref:`adaptation
    rules <python-types-adaptation>` for Python objects.

    Example::

        >>> s1 = sql.Literal("foo")
        >>> s2 = sql.Literal("ba'r")
        >>> s3 = sql.Literal(42)
        >>> print(sql.SQL(', ').join([s1, s2, s3]).as_string(conn))
        'foo', 'ba''r', 42

    """
    @property
    def wrapped(self):
        """The object wrapped by the `!Literal`."""
        return self._wrapped

    def as_string(self, context):
        # is it a connection or cursor?
        if isinstance(context, ext.connection):
            conn = context
        elif isinstance(context, ext.cursor):
            conn = context.connection
        else:
            raise TypeError("context must be a connection or a cursor")

        a = ext.adapt(self._wrapped)
        if hasattr(a, 'prepare'):
            a.prepare(conn)

        rv = a.getquoted()
        if isinstance(rv, bytes):
            rv = rv.decode(ext.encodings[conn.encoding])

        return rv


class Placeholder(Composable):
    """A `Composable` representing a placeholder for query parameters.

    If the name is specified, generate a named placeholder (e.g. ``%(name)s``),
    otherwise generate a positional placeholder (e.g. ``%s``).

    The object is useful to generate SQL queries with a variable number of
    arguments.

    Examples::

        >>> names = ['foo', 'bar', 'baz']

        >>> q1 = sql.SQL("insert into table ({}) values ({})").format(
        ...     sql.SQL(', ').join(map(sql.Identifier, names)),
        ...     sql.SQL(', ').join(sql.Placeholder() * len(names)))
        >>> print(q1.as_string(conn))
        insert into table ("foo", "bar", "baz") values (%s, %s, %s)

        >>> q2 = sql.SQL("insert into table ({}) values ({})").format(
        ...     sql.SQL(', ').join(map(sql.Identifier, names)),
        ...     sql.SQL(', ').join(map(sql.Placeholder, names)))
        >>> print(q2.as_string(conn))
        insert into table ("foo", "bar", "baz") values (%(foo)s, %(bar)s, %(baz)s)

    """

    def __init__(self, name=None):
        if isinstance(name, str):
            if ')' in name:
                raise ValueError(f"invalid name: {name!r}")

        elif name is not None:
            raise TypeError(f"expected string or None as name, got {name!r}")

        super().__init__(name)

    @property
    def name(self):
        """The name of the `!Placeholder`."""
        return self._wrapped

    def __repr__(self):
        if self._wrapped is None:
            return f"{self.__class__.__name__}()"
        else:
            return f"{self.__class__.__name__}({self._wrapped!r})"

    def as_string(self, context):
        if self._wrapped is not None:
            return f"%({self._wrapped})s"
        else:
            return "%s"


# Literals
NULL = SQL("NULL")
DEFAULT = SQL("DEFAULT")
