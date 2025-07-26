# dialects/postgresql/dml.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

from typing import Any
from typing import Optional

from . import ext
from .._typing import _OnConflictConstraintT
from .._typing import _OnConflictIndexElementsT
from .._typing import _OnConflictIndexWhereT
from .._typing import _OnConflictSetT
from .._typing import _OnConflictWhereT
from ... import util
from ...sql import coercions
from ...sql import roles
from ...sql import schema
from ...sql._typing import _DMLTableArgument
from ...sql.base import _exclusive_against
from ...sql.base import _generative
from ...sql.base import ColumnCollection
from ...sql.base import ReadOnlyColumnCollection
from ...sql.dml import Insert as StandardInsert
from ...sql.elements import ClauseElement
from ...sql.elements import KeyedColumnElement
from ...sql.expression import alias
from ...util.typing import Self


__all__ = ("Insert", "insert")


def insert(table: _DMLTableArgument) -> Insert:
    """Construct a PostgreSQL-specific variant :class:`_postgresql.Insert`
    construct.

    .. container:: inherited_member

        The :func:`sqlalchemy.dialects.postgresql.insert` function creates
        a :class:`sqlalchemy.dialects.postgresql.Insert`.  This class is based
        on the dialect-agnostic :class:`_sql.Insert` construct which may
        be constructed using the :func:`_sql.insert` function in
        SQLAlchemy Core.

    The :class:`_postgresql.Insert` construct includes additional methods
    :meth:`_postgresql.Insert.on_conflict_do_update`,
    :meth:`_postgresql.Insert.on_conflict_do_nothing`.

    """
    return Insert(table)


class Insert(StandardInsert):
    """PostgreSQL-specific implementation of INSERT.

    Adds methods for PG-specific syntaxes such as ON CONFLICT.

    The :class:`_postgresql.Insert` object is created using the
    :func:`sqlalchemy.dialects.postgresql.insert` function.

    """

    stringify_dialect = "postgresql"
    inherit_cache = False

    @util.memoized_property
    def excluded(
        self,
    ) -> ReadOnlyColumnCollection[str, KeyedColumnElement[Any]]:
        """Provide the ``excluded`` namespace for an ON CONFLICT statement

        PG's ON CONFLICT clause allows reference to the row that would
        be inserted, known as ``excluded``.  This attribute provides
        all columns in this row to be referenceable.

        .. tip::  The :attr:`_postgresql.Insert.excluded` attribute is an
            instance of :class:`_expression.ColumnCollection`, which provides
            an interface the same as that of the :attr:`_schema.Table.c`
            collection described at :ref:`metadata_tables_and_columns`.
            With this collection, ordinary names are accessible like attributes
            (e.g. ``stmt.excluded.some_column``), but special names and
            dictionary method names should be accessed using indexed access,
            such as ``stmt.excluded["column name"]`` or
            ``stmt.excluded["values"]``.   See the docstring for
            :class:`_expression.ColumnCollection` for further examples.

        .. seealso::

            :ref:`postgresql_insert_on_conflict` - example of how
            to use :attr:`_expression.Insert.excluded`

        """
        return alias(self.table, name="excluded").columns

    _on_conflict_exclusive = _exclusive_against(
        "_post_values_clause",
        msgs={
            "_post_values_clause": "This Insert construct already has "
            "an ON CONFLICT clause established"
        },
    )

    @_generative
    @_on_conflict_exclusive
    def on_conflict_do_update(
        self,
        constraint: _OnConflictConstraintT = None,
        index_elements: _OnConflictIndexElementsT = None,
        index_where: _OnConflictIndexWhereT = None,
        set_: _OnConflictSetT = None,
        where: _OnConflictWhereT = None,
    ) -> Self:
        r"""
        Specifies a DO UPDATE SET action for ON CONFLICT clause.

        Either the ``constraint`` or ``index_elements`` argument is
        required, but only one of these can be specified.

        :param constraint:
         The name of a unique or exclusion constraint on the table,
         or the constraint object itself if it has a .name attribute.

        :param index_elements:
         A sequence consisting of string column names, :class:`_schema.Column`
         objects, or other column expression objects that will be used
         to infer a target index.

        :param index_where:
         Additional WHERE criterion that can be used to infer a
         conditional target index.

        :param set\_:
         A dictionary or other mapping object
         where the keys are either names of columns in the target table,
         or :class:`_schema.Column` objects or other ORM-mapped columns
         matching that of the target table, and expressions or literals
         as values, specifying the ``SET`` actions to take.

         .. versionadded:: 1.4 The
            :paramref:`_postgresql.Insert.on_conflict_do_update.set_`
            parameter supports :class:`_schema.Column` objects from the target
            :class:`_schema.Table` as keys.

         .. warning:: This dictionary does **not** take into account
            Python-specified default UPDATE values or generation functions,
            e.g. those specified using :paramref:`_schema.Column.onupdate`.
            These values will not be exercised for an ON CONFLICT style of
            UPDATE, unless they are manually specified in the
            :paramref:`.Insert.on_conflict_do_update.set_` dictionary.

        :param where:
         Optional argument. If present, can be a literal SQL
         string or an acceptable expression for a ``WHERE`` clause
         that restricts the rows affected by ``DO UPDATE SET``. Rows
         not meeting the ``WHERE`` condition will not be updated
         (effectively a ``DO NOTHING`` for those rows).


        .. seealso::

            :ref:`postgresql_insert_on_conflict`

        """
        self._post_values_clause = OnConflictDoUpdate(
            constraint, index_elements, index_where, set_, where
        )
        return self

    @_generative
    @_on_conflict_exclusive
    def on_conflict_do_nothing(
        self,
        constraint: _OnConflictConstraintT = None,
        index_elements: _OnConflictIndexElementsT = None,
        index_where: _OnConflictIndexWhereT = None,
    ) -> Self:
        """
        Specifies a DO NOTHING action for ON CONFLICT clause.

        The ``constraint`` and ``index_elements`` arguments
        are optional, but only one of these can be specified.

        :param constraint:
         The name of a unique or exclusion constraint on the table,
         or the constraint object itself if it has a .name attribute.

        :param index_elements:
         A sequence consisting of string column names, :class:`_schema.Column`
         objects, or other column expression objects that will be used
         to infer a target index.

        :param index_where:
         Additional WHERE criterion that can be used to infer a
         conditional target index.

        .. seealso::

            :ref:`postgresql_insert_on_conflict`

        """
        self._post_values_clause = OnConflictDoNothing(
            constraint, index_elements, index_where
        )
        return self


class OnConflictClause(ClauseElement):
    stringify_dialect = "postgresql"

    constraint_target: Optional[str]
    inferred_target_elements: _OnConflictIndexElementsT
    inferred_target_whereclause: _OnConflictIndexWhereT

    def __init__(
        self,
        constraint: _OnConflictConstraintT = None,
        index_elements: _OnConflictIndexElementsT = None,
        index_where: _OnConflictIndexWhereT = None,
    ):
        if constraint is not None:
            if not isinstance(constraint, str) and isinstance(
                constraint,
                (schema.Constraint, ext.ExcludeConstraint),
            ):
                constraint = getattr(constraint, "name") or constraint

        if constraint is not None:
            if index_elements is not None:
                raise ValueError(
                    "'constraint' and 'index_elements' are mutually exclusive"
                )

            if isinstance(constraint, str):
                self.constraint_target = constraint
                self.inferred_target_elements = None
                self.inferred_target_whereclause = None
            elif isinstance(constraint, schema.Index):
                index_elements = constraint.expressions
                index_where = constraint.dialect_options["postgresql"].get(
                    "where"
                )
            elif isinstance(constraint, ext.ExcludeConstraint):
                index_elements = constraint.columns
                index_where = constraint.where
            else:
                index_elements = constraint.columns
                index_where = constraint.dialect_options["postgresql"].get(
                    "where"
                )

        if index_elements is not None:
            self.constraint_target = None
            self.inferred_target_elements = index_elements
            self.inferred_target_whereclause = index_where
        elif constraint is None:
            self.constraint_target = (
                self.inferred_target_elements
            ) = self.inferred_target_whereclause = None


class OnConflictDoNothing(OnConflictClause):
    __visit_name__ = "on_conflict_do_nothing"


class OnConflictDoUpdate(OnConflictClause):
    __visit_name__ = "on_conflict_do_update"

    def __init__(
        self,
        constraint: _OnConflictConstraintT = None,
        index_elements: _OnConflictIndexElementsT = None,
        index_where: _OnConflictIndexWhereT = None,
        set_: _OnConflictSetT = None,
        where: _OnConflictWhereT = None,
    ):
        super().__init__(
            constraint=constraint,
            index_elements=index_elements,
            index_where=index_where,
        )

        if (
            self.inferred_target_elements is None
            and self.constraint_target is None
        ):
            raise ValueError(
                "Either constraint or index_elements, "
                "but not both, must be specified unless DO NOTHING"
            )

        if isinstance(set_, dict):
            if not set_:
                raise ValueError("set parameter dictionary must not be empty")
        elif isinstance(set_, ColumnCollection):
            set_ = dict(set_)
        else:
            raise ValueError(
                "set parameter must be a non-empty dictionary "
                "or a ColumnCollection such as the `.c.` collection "
                "of a Table object"
            )
        self.update_values_to_set = [
            (coercions.expect(roles.DMLColumnRole, key), value)
            for key, value in set_.items()
        ]
        self.update_whereclause = where
