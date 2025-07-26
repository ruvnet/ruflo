# dialects/mysql/expression.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: ignore-errors


from ... import exc
from ... import util
from ...sql import coercions
from ...sql import elements
from ...sql import operators
from ...sql import roles
from ...sql.base import _generative
from ...sql.base import Generative
from ...util.typing import Self


class match(Generative, elements.BinaryExpression):
    """Produce a ``MATCH (X, Y) AGAINST ('TEXT')`` clause.

    E.g.::

        from sqlalchemy import desc
        from sqlalchemy.dialects.mysql import match

        match_expr = match(
            users_table.c.firstname,
            users_table.c.lastname,
            against="Firstname Lastname",
        )

        stmt = (
            select(users_table)
            .where(match_expr.in_boolean_mode())
            .order_by(desc(match_expr))
        )

    Would produce SQL resembling::

        SELECT id, firstname, lastname
        FROM user
        WHERE MATCH(firstname, lastname) AGAINST (:param_1 IN BOOLEAN MODE)
        ORDER BY MATCH(firstname, lastname) AGAINST (:param_2) DESC

    The :func:`_mysql.match` function is a standalone version of the
    :meth:`_sql.ColumnElement.match` method available on all
    SQL expressions, as when :meth:`_expression.ColumnElement.match` is
    used, but allows to pass multiple columns

    :param cols: column expressions to match against

    :param against: expression to be compared towards

    :param in_boolean_mode: boolean, set "boolean mode" to true

    :param in_natural_language_mode: boolean , set "natural language" to true

    :param with_query_expansion: boolean, set "query expansion" to true

    .. versionadded:: 1.4.19

    .. seealso::

        :meth:`_expression.ColumnElement.match`

    """

    __visit_name__ = "mysql_match"

    inherit_cache = True

    def __init__(self, *cols, **kw):
        if not cols:
            raise exc.ArgumentError("columns are required")

        against = kw.pop("against", None)

        if against is None:
            raise exc.ArgumentError("against is required")
        against = coercions.expect(
            roles.ExpressionElementRole,
            against,
        )

        left = elements.BooleanClauseList._construct_raw(
            operators.comma_op,
            clauses=cols,
        )
        left.group = False

        flags = util.immutabledict(
            {
                "mysql_boolean_mode": kw.pop("in_boolean_mode", False),
                "mysql_natural_language": kw.pop(
                    "in_natural_language_mode", False
                ),
                "mysql_query_expansion": kw.pop("with_query_expansion", False),
            }
        )

        if kw:
            raise exc.ArgumentError("unknown arguments: %s" % (", ".join(kw)))

        super().__init__(left, against, operators.match_op, modifiers=flags)

    @_generative
    def in_boolean_mode(self) -> Self:
        """Apply the "IN BOOLEAN MODE" modifier to the MATCH expression.

        :return: a new :class:`_mysql.match` instance with modifications
         applied.
        """

        self.modifiers = self.modifiers.union({"mysql_boolean_mode": True})
        return self

    @_generative
    def in_natural_language_mode(self) -> Self:
        """Apply the "IN NATURAL LANGUAGE MODE" modifier to the MATCH
        expression.

        :return: a new :class:`_mysql.match` instance with modifications
         applied.
        """

        self.modifiers = self.modifiers.union({"mysql_natural_language": True})
        return self

    @_generative
    def with_query_expansion(self) -> Self:
        """Apply the "WITH QUERY EXPANSION" modifier to the MATCH expression.

        :return: a new :class:`_mysql.match` instance with modifications
         applied.
        """

        self.modifiers = self.modifiers.union({"mysql_query_expansion": True})
        return self
