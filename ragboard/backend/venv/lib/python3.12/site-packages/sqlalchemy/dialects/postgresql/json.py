# dialects/postgresql/json.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


from .array import ARRAY
from .array import array as _pg_array
from .operators import ASTEXT
from .operators import CONTAINED_BY
from .operators import CONTAINS
from .operators import DELETE_PATH
from .operators import HAS_ALL
from .operators import HAS_ANY
from .operators import HAS_KEY
from .operators import JSONPATH_ASTEXT
from .operators import PATH_EXISTS
from .operators import PATH_MATCH
from ... import types as sqltypes
from ...sql import cast

__all__ = ("JSON", "JSONB")


class JSONPathType(sqltypes.JSON.JSONPathType):
    def _processor(self, dialect, super_proc):
        def process(value):
            if isinstance(value, str):
                # If it's already a string assume that it's in json path
                # format. This allows using cast with json paths literals
                return value
            elif value:
                # If it's already a string assume that it's in json path
                # format. This allows using cast with json paths literals
                value = "{%s}" % (", ".join(map(str, value)))
            else:
                value = "{}"
            if super_proc:
                value = super_proc(value)
            return value

        return process

    def bind_processor(self, dialect):
        return self._processor(dialect, self.string_bind_processor(dialect))

    def literal_processor(self, dialect):
        return self._processor(dialect, self.string_literal_processor(dialect))


class JSONPATH(JSONPathType):
    """JSON Path Type.

    This is usually required to cast literal values to json path when using
    json search like function, such as ``jsonb_path_query_array`` or
    ``jsonb_path_exists``::

        stmt = sa.select(
            sa.func.jsonb_path_query_array(
                table.c.jsonb_col, cast("$.address.id", JSONPATH)
            )
        )

    """

    __visit_name__ = "JSONPATH"


class JSON(sqltypes.JSON):
    """Represent the PostgreSQL JSON type.

    :class:`_postgresql.JSON` is used automatically whenever the base
    :class:`_types.JSON` datatype is used against a PostgreSQL backend,
    however base :class:`_types.JSON` datatype does not provide Python
    accessors for PostgreSQL-specific comparison methods such as
    :meth:`_postgresql.JSON.Comparator.astext`; additionally, to use
    PostgreSQL ``JSONB``, the :class:`_postgresql.JSONB` datatype should
    be used explicitly.

    .. seealso::

        :class:`_types.JSON` - main documentation for the generic
        cross-platform JSON datatype.

    The operators provided by the PostgreSQL version of :class:`_types.JSON`
    include:

    * Index operations (the ``->`` operator)::

        data_table.c.data['some key']

        data_table.c.data[5]


    * Index operations returning text (the ``->>`` operator)::

        data_table.c.data['some key'].astext == 'some value'

      Note that equivalent functionality is available via the
      :attr:`.JSON.Comparator.as_string` accessor.

    * Index operations with CAST
      (equivalent to ``CAST(col ->> ['some key'] AS <type>)``)::

        data_table.c.data['some key'].astext.cast(Integer) == 5

      Note that equivalent functionality is available via the
      :attr:`.JSON.Comparator.as_integer` and similar accessors.

    * Path index operations (the ``#>`` operator)::

        data_table.c.data[('key_1', 'key_2', 5, ..., 'key_n')]

    * Path index operations returning text (the ``#>>`` operator)::

        data_table.c.data[('key_1', 'key_2', 5, ..., 'key_n')].astext == 'some value'

    Index operations return an expression object whose type defaults to
    :class:`_types.JSON` by default,
    so that further JSON-oriented instructions
    may be called upon the result type.

    Custom serializers and deserializers are specified at the dialect level,
    that is using :func:`_sa.create_engine`.  The reason for this is that when
    using psycopg2, the DBAPI only allows serializers at the per-cursor
    or per-connection level.   E.g.::

        engine = create_engine("postgresql+psycopg2://scott:tiger@localhost/test",
                                json_serializer=my_serialize_fn,
                                json_deserializer=my_deserialize_fn
                        )

    When using the psycopg2 dialect, the json_deserializer is registered
    against the database using ``psycopg2.extras.register_default_json``.

    .. seealso::

        :class:`_types.JSON` - Core level JSON type

        :class:`_postgresql.JSONB`

    """  # noqa

    astext_type = sqltypes.Text()

    def __init__(self, none_as_null=False, astext_type=None):
        """Construct a :class:`_types.JSON` type.

        :param none_as_null: if True, persist the value ``None`` as a
         SQL NULL value, not the JSON encoding of ``null``.   Note that
         when this flag is False, the :func:`.null` construct can still
         be used to persist a NULL value::

             from sqlalchemy import null
             conn.execute(table.insert(), data=null())

         .. seealso::

              :attr:`_types.JSON.NULL`

        :param astext_type: the type to use for the
         :attr:`.JSON.Comparator.astext`
         accessor on indexed attributes.  Defaults to :class:`_types.Text`.

        """
        super().__init__(none_as_null=none_as_null)
        if astext_type is not None:
            self.astext_type = astext_type

    class Comparator(sqltypes.JSON.Comparator):
        """Define comparison operations for :class:`_types.JSON`."""

        @property
        def astext(self):
            """On an indexed expression, use the "astext" (e.g. "->>")
            conversion when rendered in SQL.

            E.g.::

                select(data_table.c.data['some key'].astext)

            .. seealso::

                :meth:`_expression.ColumnElement.cast`

            """
            if isinstance(self.expr.right.type, sqltypes.JSON.JSONPathType):
                return self.expr.left.operate(
                    JSONPATH_ASTEXT,
                    self.expr.right,
                    result_type=self.type.astext_type,
                )
            else:
                return self.expr.left.operate(
                    ASTEXT, self.expr.right, result_type=self.type.astext_type
                )

    comparator_factory = Comparator


class JSONB(JSON):
    """Represent the PostgreSQL JSONB type.

    The :class:`_postgresql.JSONB` type stores arbitrary JSONB format data,
    e.g.::

        data_table = Table('data_table', metadata,
            Column('id', Integer, primary_key=True),
            Column('data', JSONB)
        )

        with engine.connect() as conn:
            conn.execute(
                data_table.insert(),
                data = {"key1": "value1", "key2": "value2"}
            )

    The :class:`_postgresql.JSONB` type includes all operations provided by
    :class:`_types.JSON`, including the same behaviors for indexing
    operations.
    It also adds additional operators specific to JSONB, including
    :meth:`.JSONB.Comparator.has_key`, :meth:`.JSONB.Comparator.has_all`,
    :meth:`.JSONB.Comparator.has_any`, :meth:`.JSONB.Comparator.contains`,
    :meth:`.JSONB.Comparator.contained_by`,
    :meth:`.JSONB.Comparator.delete_path`,
    :meth:`.JSONB.Comparator.path_exists` and
    :meth:`.JSONB.Comparator.path_match`.

    Like the :class:`_types.JSON` type, the :class:`_postgresql.JSONB`
    type does not detect
    in-place changes when used with the ORM, unless the
    :mod:`sqlalchemy.ext.mutable` extension is used.

    Custom serializers and deserializers
    are shared with the :class:`_types.JSON` class,
    using the ``json_serializer``
    and ``json_deserializer`` keyword arguments.  These must be specified
    at the dialect level using :func:`_sa.create_engine`.  When using
    psycopg2, the serializers are associated with the jsonb type using
    ``psycopg2.extras.register_default_jsonb`` on a per-connection basis,
    in the same way that ``psycopg2.extras.register_default_json`` is used
    to register these handlers with the json type.

    .. seealso::

        :class:`_types.JSON`

    """

    __visit_name__ = "JSONB"

    class Comparator(JSON.Comparator):
        """Define comparison operations for :class:`_types.JSON`."""

        def has_key(self, other):
            """Boolean expression.  Test for presence of a key.  Note that the
            key may be a SQLA expression.
            """
            return self.operate(HAS_KEY, other, result_type=sqltypes.Boolean)

        def has_all(self, other):
            """Boolean expression.  Test for presence of all keys in jsonb"""
            return self.operate(HAS_ALL, other, result_type=sqltypes.Boolean)

        def has_any(self, other):
            """Boolean expression.  Test for presence of any key in jsonb"""
            return self.operate(HAS_ANY, other, result_type=sqltypes.Boolean)

        def contains(self, other, **kwargs):
            """Boolean expression.  Test if keys (or array) are a superset
            of/contained the keys of the argument jsonb expression.

            kwargs may be ignored by this operator but are required for API
            conformance.
            """
            return self.operate(CONTAINS, other, result_type=sqltypes.Boolean)

        def contained_by(self, other):
            """Boolean expression.  Test if keys are a proper subset of the
            keys of the argument jsonb expression.
            """
            return self.operate(
                CONTAINED_BY, other, result_type=sqltypes.Boolean
            )

        def delete_path(self, array):
            """JSONB expression. Deletes field or array element specified in
            the argument array.

            The input may be a list of strings that will be coerced to an
            ``ARRAY`` or an instance of :meth:`_postgres.array`.

            .. versionadded:: 2.0
            """
            if not isinstance(array, _pg_array):
                array = _pg_array(array)
            right_side = cast(array, ARRAY(sqltypes.TEXT))
            return self.operate(DELETE_PATH, right_side, result_type=JSONB)

        def path_exists(self, other):
            """Boolean expression. Test for presence of item given by the
            argument JSONPath expression.

            .. versionadded:: 2.0
            """
            return self.operate(
                PATH_EXISTS, other, result_type=sqltypes.Boolean
            )

        def path_match(self, other):
            """Boolean expression. Test if JSONPath predicate given by the
            argument JSONPath expression matches.

            Only the first item of the result is taken into account.

            .. versionadded:: 2.0
            """
            return self.operate(
                PATH_MATCH, other, result_type=sqltypes.Boolean
            )

    comparator_factory = Comparator
