# dialects/mysql/dml.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

from typing import Any
from typing import List
from typing import Mapping
from typing import Optional
from typing import Tuple
from typing import Union

from ... import exc
from ... import util
from ...sql._typing import _DMLTableArgument
from ...sql.base import _exclusive_against
from ...sql.base import _generative
from ...sql.base import ColumnCollection
from ...sql.base import ReadOnlyColumnCollection
from ...sql.dml import Insert as StandardInsert
from ...sql.elements import ClauseElement
from ...sql.elements import KeyedColumnElement
from ...sql.expression import alias
from ...sql.selectable import NamedFromClause
from ...util.typing import Self


__all__ = ("Insert", "insert")


def insert(table: _DMLTableArgument) -> Insert:
    """Construct a MySQL/MariaDB-specific variant :class:`_mysql.Insert`
    construct.

    .. container:: inherited_member

        The :func:`sqlalchemy.dialects.mysql.insert` function creates
        a :class:`sqlalchemy.dialects.mysql.Insert`.  This class is based
        on the dialect-agnostic :class:`_sql.Insert` construct which may
        be constructed using the :func:`_sql.insert` function in
        SQLAlchemy Core.

    The :class:`_mysql.Insert` construct includes additional methods
    :meth:`_mysql.Insert.on_duplicate_key_update`.

    """
    return Insert(table)


class Insert(StandardInsert):
    """MySQL-specific implementation of INSERT.

    Adds methods for MySQL-specific syntaxes such as ON DUPLICATE KEY UPDATE.

    The :class:`~.mysql.Insert` object is created using the
    :func:`sqlalchemy.dialects.mysql.insert` function.

    .. versionadded:: 1.2

    """

    stringify_dialect = "mysql"
    inherit_cache = False

    @property
    def inserted(
        self,
    ) -> ReadOnlyColumnCollection[str, KeyedColumnElement[Any]]:
        """Provide the "inserted" namespace for an ON DUPLICATE KEY UPDATE
        statement

        MySQL's ON DUPLICATE KEY UPDATE clause allows reference to the row
        that would be inserted, via a special function called ``VALUES()``.
        This attribute provides all columns in this row to be referenceable
        such that they will render within a ``VALUES()`` function inside the
        ON DUPLICATE KEY UPDATE clause.    The attribute is named ``.inserted``
        so as not to conflict with the existing
        :meth:`_expression.Insert.values` method.

        .. tip::  The :attr:`_mysql.Insert.inserted` attribute is an instance
            of :class:`_expression.ColumnCollection`, which provides an
            interface the same as that of the :attr:`_schema.Table.c`
            collection described at :ref:`metadata_tables_and_columns`.
            With this collection, ordinary names are accessible like attributes
            (e.g. ``stmt.inserted.some_column``), but special names and
            dictionary method names should be accessed using indexed access,
            such as ``stmt.inserted["column name"]`` or
            ``stmt.inserted["values"]``.  See the docstring for
            :class:`_expression.ColumnCollection` for further examples.

        .. seealso::

            :ref:`mysql_insert_on_duplicate_key_update` - example of how
            to use :attr:`_expression.Insert.inserted`

        """
        return self.inserted_alias.columns

    @util.memoized_property
    def inserted_alias(self) -> NamedFromClause:
        return alias(self.table, name="inserted")

    @_generative
    @_exclusive_against(
        "_post_values_clause",
        msgs={
            "_post_values_clause": "This Insert construct already "
            "has an ON DUPLICATE KEY clause present"
        },
    )
    def on_duplicate_key_update(self, *args: _UpdateArg, **kw: Any) -> Self:
        r"""
        Specifies the ON DUPLICATE KEY UPDATE clause.

        :param \**kw:  Column keys linked to UPDATE values.  The
         values may be any SQL expression or supported literal Python
         values.

        .. warning:: This dictionary does **not** take into account
           Python-specified default UPDATE values or generation functions,
           e.g. those specified using :paramref:`_schema.Column.onupdate`.
           These values will not be exercised for an ON DUPLICATE KEY UPDATE
           style of UPDATE, unless values are manually specified here.

        :param \*args: As an alternative to passing key/value parameters,
         a dictionary or list of 2-tuples can be passed as a single positional
         argument.

         Passing a single dictionary is equivalent to the keyword argument
         form::

            insert().on_duplicate_key_update({"name": "some name"})

         Passing a list of 2-tuples indicates that the parameter assignments
         in the UPDATE clause should be ordered as sent, in a manner similar
         to that described for the :class:`_expression.Update`
         construct overall
         in :ref:`tutorial_parameter_ordered_updates`::

            insert().on_duplicate_key_update(
                [("name", "some name"), ("value", "some value")])

         .. versionchanged:: 1.3 parameters can be specified as a dictionary
            or list of 2-tuples; the latter form provides for parameter
            ordering.


        .. versionadded:: 1.2

        .. seealso::

            :ref:`mysql_insert_on_duplicate_key_update`

        """
        if args and kw:
            raise exc.ArgumentError(
                "Can't pass kwargs and positional arguments simultaneously"
            )

        if args:
            if len(args) > 1:
                raise exc.ArgumentError(
                    "Only a single dictionary or list of tuples "
                    "is accepted positionally."
                )
            values = args[0]
        else:
            values = kw

        self._post_values_clause = OnDuplicateClause(
            self.inserted_alias, values
        )
        return self


class OnDuplicateClause(ClauseElement):
    __visit_name__ = "on_duplicate_key_update"

    _parameter_ordering: Optional[List[str]] = None

    stringify_dialect = "mysql"

    def __init__(
        self, inserted_alias: NamedFromClause, update: _UpdateArg
    ) -> None:
        self.inserted_alias = inserted_alias

        # auto-detect that parameters should be ordered.   This is copied from
        # Update._proces_colparams(), however we don't look for a special flag
        # in this case since we are not disambiguating from other use cases as
        # we are in Update.values().
        if isinstance(update, list) and (
            update and isinstance(update[0], tuple)
        ):
            self._parameter_ordering = [key for key, value in update]
            update = dict(update)

        if isinstance(update, dict):
            if not update:
                raise ValueError(
                    "update parameter dictionary must not be empty"
                )
        elif isinstance(update, ColumnCollection):
            update = dict(update)
        else:
            raise ValueError(
                "update parameter must be a non-empty dictionary "
                "or a ColumnCollection such as the `.c.` collection "
                "of a Table object"
            )
        self.update = update


_UpdateArg = Union[
    Mapping[Any, Any], List[Tuple[str, Any]], ColumnCollection[Any, Any]
]
