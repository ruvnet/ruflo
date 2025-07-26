# dialects/postgresql/ext.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors
from __future__ import annotations

from typing import Any
from typing import TYPE_CHECKING
from typing import TypeVar

from . import types
from .array import ARRAY
from ...sql import coercions
from ...sql import elements
from ...sql import expression
from ...sql import functions
from ...sql import roles
from ...sql import schema
from ...sql.schema import ColumnCollectionConstraint
from ...sql.sqltypes import TEXT
from ...sql.visitors import InternalTraversal

_T = TypeVar("_T", bound=Any)

if TYPE_CHECKING:
    from ...sql.visitors import _TraverseInternalsType


class aggregate_order_by(expression.ColumnElement):
    """Represent a PostgreSQL aggregate order by expression.

    E.g.::

        from sqlalchemy.dialects.postgresql import aggregate_order_by
        expr = func.array_agg(aggregate_order_by(table.c.a, table.c.b.desc()))
        stmt = select(expr)

    would represent the expression::

        SELECT array_agg(a ORDER BY b DESC) FROM table;

    Similarly::

        expr = func.string_agg(
            table.c.a,
            aggregate_order_by(literal_column("','"), table.c.a)
        )
        stmt = select(expr)

    Would represent::

        SELECT string_agg(a, ',' ORDER BY a) FROM table;

    .. versionchanged:: 1.2.13 - the ORDER BY argument may be multiple terms

    .. seealso::

        :class:`_functions.array_agg`

    """

    __visit_name__ = "aggregate_order_by"

    stringify_dialect = "postgresql"
    _traverse_internals: _TraverseInternalsType = [
        ("target", InternalTraversal.dp_clauseelement),
        ("type", InternalTraversal.dp_type),
        ("order_by", InternalTraversal.dp_clauseelement),
    ]

    def __init__(self, target, *order_by):
        self.target = coercions.expect(roles.ExpressionElementRole, target)
        self.type = self.target.type

        _lob = len(order_by)
        if _lob == 0:
            raise TypeError("at least one ORDER BY element is required")
        elif _lob == 1:
            self.order_by = coercions.expect(
                roles.ExpressionElementRole, order_by[0]
            )
        else:
            self.order_by = elements.ClauseList(
                *order_by, _literal_as_text_role=roles.ExpressionElementRole
            )

    def self_group(self, against=None):
        return self

    def get_children(self, **kwargs):
        return self.target, self.order_by

    def _copy_internals(self, clone=elements._clone, **kw):
        self.target = clone(self.target, **kw)
        self.order_by = clone(self.order_by, **kw)

    @property
    def _from_objects(self):
        return self.target._from_objects + self.order_by._from_objects


class ExcludeConstraint(ColumnCollectionConstraint):
    """A table-level EXCLUDE constraint.

    Defines an EXCLUDE constraint as described in the `PostgreSQL
    documentation`__.

    __ https://www.postgresql.org/docs/current/static/sql-createtable.html#SQL-CREATETABLE-EXCLUDE

    """  # noqa

    __visit_name__ = "exclude_constraint"

    where = None
    inherit_cache = False

    create_drop_stringify_dialect = "postgresql"

    @elements._document_text_coercion(
        "where",
        ":class:`.ExcludeConstraint`",
        ":paramref:`.ExcludeConstraint.where`",
    )
    def __init__(self, *elements, **kw):
        r"""
        Create an :class:`.ExcludeConstraint` object.

        E.g.::

            const = ExcludeConstraint(
                (Column('period'), '&&'),
                (Column('group'), '='),
                where=(Column('group') != 'some group'),
                ops={'group': 'my_operator_class'}
            )

        The constraint is normally embedded into the :class:`_schema.Table`
        construct
        directly, or added later using :meth:`.append_constraint`::

            some_table = Table(
                'some_table', metadata,
                Column('id', Integer, primary_key=True),
                Column('period', TSRANGE()),
                Column('group', String)
            )

            some_table.append_constraint(
                ExcludeConstraint(
                    (some_table.c.period, '&&'),
                    (some_table.c.group, '='),
                    where=some_table.c.group != 'some group',
                    name='some_table_excl_const',
                    ops={'group': 'my_operator_class'}
                )
            )

        The exclude constraint defined in this example requires the
        ``btree_gist`` extension, that can be created using the
        command ``CREATE EXTENSION btree_gist;``.

        :param \*elements:

          A sequence of two tuples of the form ``(column, operator)`` where
          "column" is either a :class:`_schema.Column` object, or a SQL
          expression element (e.g. ``func.int8range(table.from, table.to)``)
          or the name of a column as string, and "operator" is a string
          containing the operator to use (e.g. `"&&"` or `"="`).

          In order to specify a column name when a :class:`_schema.Column`
          object is not available, while ensuring
          that any necessary quoting rules take effect, an ad-hoc
          :class:`_schema.Column` or :func:`_expression.column`
          object should be used.
          The ``column`` may also be a string SQL expression when
          passed as :func:`_expression.literal_column` or
          :func:`_expression.text`

        :param name:
          Optional, the in-database name of this constraint.

        :param deferrable:
          Optional bool.  If set, emit DEFERRABLE or NOT DEFERRABLE when
          issuing DDL for this constraint.

        :param initially:
          Optional string.  If set, emit INITIALLY <value> when issuing DDL
          for this constraint.

        :param using:
          Optional string.  If set, emit USING <index_method> when issuing DDL
          for this constraint. Defaults to 'gist'.

        :param where:
          Optional SQL expression construct or literal SQL string.
          If set, emit WHERE <predicate> when issuing DDL
          for this constraint.

        :param ops:
          Optional dictionary.  Used to define operator classes for the
          elements; works the same way as that of the
          :ref:`postgresql_ops <postgresql_operator_classes>`
          parameter specified to the :class:`_schema.Index` construct.

          .. versionadded:: 1.3.21

          .. seealso::

            :ref:`postgresql_operator_classes` - general description of how
            PostgreSQL operator classes are specified.

        """
        columns = []
        render_exprs = []
        self.operators = {}

        expressions, operators = zip(*elements)

        for (expr, column, strname, add_element), operator in zip(
            coercions.expect_col_expression_collection(
                roles.DDLConstraintColumnRole, expressions
            ),
            operators,
        ):
            if add_element is not None:
                columns.append(add_element)

            name = column.name if column is not None else strname

            if name is not None:
                # backwards compat
                self.operators[name] = operator

            render_exprs.append((expr, name, operator))

        self._render_exprs = render_exprs

        ColumnCollectionConstraint.__init__(
            self,
            *columns,
            name=kw.get("name"),
            deferrable=kw.get("deferrable"),
            initially=kw.get("initially"),
        )
        self.using = kw.get("using", "gist")
        where = kw.get("where")
        if where is not None:
            self.where = coercions.expect(roles.StatementOptionRole, where)

        self.ops = kw.get("ops", {})

    def _set_parent(self, table, **kw):
        super()._set_parent(table)

        self._render_exprs = [
            (
                expr if not isinstance(expr, str) else table.c[expr],
                name,
                operator,
            )
            for expr, name, operator in (self._render_exprs)
        ]

    def _copy(self, target_table=None, **kw):
        elements = [
            (
                schema._copy_expression(expr, self.parent, target_table),
                operator,
            )
            for expr, _, operator in self._render_exprs
        ]
        c = self.__class__(
            *elements,
            name=self.name,
            deferrable=self.deferrable,
            initially=self.initially,
            where=self.where,
            using=self.using,
        )
        c.dispatch._update(self.dispatch)
        return c


def array_agg(*arg, **kw):
    """PostgreSQL-specific form of :class:`_functions.array_agg`, ensures
    return type is :class:`_postgresql.ARRAY` and not
    the plain :class:`_types.ARRAY`, unless an explicit ``type_``
    is passed.

    """
    kw["_default_array_type"] = ARRAY
    return functions.func.array_agg(*arg, **kw)


class _regconfig_fn(functions.GenericFunction[_T]):
    inherit_cache = True

    def __init__(self, *args, **kwargs):
        args = list(args)
        if len(args) > 1:
            initial_arg = coercions.expect(
                roles.ExpressionElementRole,
                args.pop(0),
                name=getattr(self, "name", None),
                apply_propagate_attrs=self,
                type_=types.REGCONFIG,
            )
            initial_arg = [initial_arg]
        else:
            initial_arg = []

        addtl_args = [
            coercions.expect(
                roles.ExpressionElementRole,
                c,
                name=getattr(self, "name", None),
                apply_propagate_attrs=self,
            )
            for c in args
        ]
        super().__init__(*(initial_arg + addtl_args), **kwargs)


class to_tsvector(_regconfig_fn):
    """The PostgreSQL ``to_tsvector`` SQL function.

    This function applies automatic casting of the REGCONFIG argument
    to use the :class:`_postgresql.REGCONFIG` datatype automatically,
    and applies a return type of :class:`_postgresql.TSVECTOR`.

    Assuming the PostgreSQL dialect has been imported, either by invoking
    ``from sqlalchemy.dialects import postgresql``, or by creating a PostgreSQL
    engine using ``create_engine("postgresql...")``,
    :class:`_postgresql.to_tsvector` will be used automatically when invoking
    ``sqlalchemy.func.to_tsvector()``, ensuring the correct argument and return
    type handlers are used at compile and execution time.

    .. versionadded:: 2.0.0rc1

    """

    inherit_cache = True
    type = types.TSVECTOR


class to_tsquery(_regconfig_fn):
    """The PostgreSQL ``to_tsquery`` SQL function.

    This function applies automatic casting of the REGCONFIG argument
    to use the :class:`_postgresql.REGCONFIG` datatype automatically,
    and applies a return type of :class:`_postgresql.TSQUERY`.

    Assuming the PostgreSQL dialect has been imported, either by invoking
    ``from sqlalchemy.dialects import postgresql``, or by creating a PostgreSQL
    engine using ``create_engine("postgresql...")``,
    :class:`_postgresql.to_tsquery` will be used automatically when invoking
    ``sqlalchemy.func.to_tsquery()``, ensuring the correct argument and return
    type handlers are used at compile and execution time.

    .. versionadded:: 2.0.0rc1

    """

    inherit_cache = True
    type = types.TSQUERY


class plainto_tsquery(_regconfig_fn):
    """The PostgreSQL ``plainto_tsquery`` SQL function.

    This function applies automatic casting of the REGCONFIG argument
    to use the :class:`_postgresql.REGCONFIG` datatype automatically,
    and applies a return type of :class:`_postgresql.TSQUERY`.

    Assuming the PostgreSQL dialect has been imported, either by invoking
    ``from sqlalchemy.dialects import postgresql``, or by creating a PostgreSQL
    engine using ``create_engine("postgresql...")``,
    :class:`_postgresql.plainto_tsquery` will be used automatically when
    invoking ``sqlalchemy.func.plainto_tsquery()``, ensuring the correct
    argument and return type handlers are used at compile and execution time.

    .. versionadded:: 2.0.0rc1

    """

    inherit_cache = True
    type = types.TSQUERY


class phraseto_tsquery(_regconfig_fn):
    """The PostgreSQL ``phraseto_tsquery`` SQL function.

    This function applies automatic casting of the REGCONFIG argument
    to use the :class:`_postgresql.REGCONFIG` datatype automatically,
    and applies a return type of :class:`_postgresql.TSQUERY`.

    Assuming the PostgreSQL dialect has been imported, either by invoking
    ``from sqlalchemy.dialects import postgresql``, or by creating a PostgreSQL
    engine using ``create_engine("postgresql...")``,
    :class:`_postgresql.phraseto_tsquery` will be used automatically when
    invoking ``sqlalchemy.func.phraseto_tsquery()``, ensuring the correct
    argument and return type handlers are used at compile and execution time.

    .. versionadded:: 2.0.0rc1

    """

    inherit_cache = True
    type = types.TSQUERY


class websearch_to_tsquery(_regconfig_fn):
    """The PostgreSQL ``websearch_to_tsquery`` SQL function.

    This function applies automatic casting of the REGCONFIG argument
    to use the :class:`_postgresql.REGCONFIG` datatype automatically,
    and applies a return type of :class:`_postgresql.TSQUERY`.

    Assuming the PostgreSQL dialect has been imported, either by invoking
    ``from sqlalchemy.dialects import postgresql``, or by creating a PostgreSQL
    engine using ``create_engine("postgresql...")``,
    :class:`_postgresql.websearch_to_tsquery` will be used automatically when
    invoking ``sqlalchemy.func.websearch_to_tsquery()``, ensuring the correct
    argument and return type handlers are used at compile and execution time.

    .. versionadded:: 2.0.0rc1

    """

    inherit_cache = True
    type = types.TSQUERY


class ts_headline(_regconfig_fn):
    """The PostgreSQL ``ts_headline`` SQL function.

    This function applies automatic casting of the REGCONFIG argument
    to use the :class:`_postgresql.REGCONFIG` datatype automatically,
    and applies a return type of :class:`_types.TEXT`.

    Assuming the PostgreSQL dialect has been imported, either by invoking
    ``from sqlalchemy.dialects import postgresql``, or by creating a PostgreSQL
    engine using ``create_engine("postgresql...")``,
    :class:`_postgresql.ts_headline` will be used automatically when invoking
    ``sqlalchemy.func.ts_headline()``, ensuring the correct argument and return
    type handlers are used at compile and execution time.

    .. versionadded:: 2.0.0rc1

    """

    inherit_cache = True
    type = TEXT

    def __init__(self, *args, **kwargs):
        args = list(args)

        # parse types according to
        # https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-HEADLINE
        if len(args) < 2:
            # invalid args; don't do anything
            has_regconfig = False
        elif (
            isinstance(args[1], elements.ColumnElement)
            and args[1].type._type_affinity is types.TSQUERY
        ):
            # tsquery is second argument, no regconfig argument
            has_regconfig = False
        else:
            has_regconfig = True

        if has_regconfig:
            initial_arg = coercions.expect(
                roles.ExpressionElementRole,
                args.pop(0),
                apply_propagate_attrs=self,
                name=getattr(self, "name", None),
                type_=types.REGCONFIG,
            )
            initial_arg = [initial_arg]
        else:
            initial_arg = []

        addtl_args = [
            coercions.expect(
                roles.ExpressionElementRole,
                c,
                name=getattr(self, "name", None),
                apply_propagate_attrs=self,
            )
            for c in args
        ]
        super().__init__(*(initial_arg + addtl_args), **kwargs)
