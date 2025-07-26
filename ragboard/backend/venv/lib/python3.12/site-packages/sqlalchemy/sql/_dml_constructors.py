# sql/_dml_constructors.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

from typing import TYPE_CHECKING

from .dml import Delete
from .dml import Insert
from .dml import Update

if TYPE_CHECKING:
    from ._typing import _DMLTableArgument


def insert(table: _DMLTableArgument) -> Insert:
    """Construct an :class:`_expression.Insert` object.

    E.g.::

        from sqlalchemy import insert

        stmt = (
            insert(user_table).
            values(name='username', fullname='Full Username')
        )

    Similar functionality is available via the
    :meth:`_expression.TableClause.insert` method on
    :class:`_schema.Table`.

    .. seealso::

        :ref:`tutorial_core_insert` - in the :ref:`unified_tutorial`


    :param table: :class:`_expression.TableClause`
     which is the subject of the
     insert.

    :param values: collection of values to be inserted; see
     :meth:`_expression.Insert.values`
     for a description of allowed formats here.
     Can be omitted entirely; a :class:`_expression.Insert` construct
     will also dynamically render the VALUES clause at execution time
     based on the parameters passed to :meth:`_engine.Connection.execute`.

    :param inline: if True, no attempt will be made to retrieve the
     SQL-generated default values to be provided within the statement;
     in particular,
     this allows SQL expressions to be rendered 'inline' within the
     statement without the need to pre-execute them beforehand; for
     backends that support "returning", this turns off the "implicit
     returning" feature for the statement.

    If both :paramref:`_expression.insert.values` and compile-time bind
    parameters are present, the compile-time bind parameters override the
    information specified within :paramref:`_expression.insert.values` on a
    per-key basis.

    The keys within :paramref:`_expression.Insert.values` can be either
    :class:`~sqlalchemy.schema.Column` objects or their string
    identifiers. Each key may reference one of:

    * a literal data value (i.e. string, number, etc.);
    * a Column object;
    * a SELECT statement.

    If a ``SELECT`` statement is specified which references this
    ``INSERT`` statement's table, the statement will be correlated
    against the ``INSERT`` statement.

    .. seealso::

        :ref:`tutorial_core_insert` - in the :ref:`unified_tutorial`

    """
    return Insert(table)


def update(table: _DMLTableArgument) -> Update:
    r"""Construct an :class:`_expression.Update` object.

    E.g.::

        from sqlalchemy import update

        stmt = (
            update(user_table).
            where(user_table.c.id == 5).
            values(name='user #5')
        )

    Similar functionality is available via the
    :meth:`_expression.TableClause.update` method on
    :class:`_schema.Table`.

    :param table: A :class:`_schema.Table`
     object representing the database
     table to be updated.


    .. seealso::

        :ref:`tutorial_core_update_delete` - in the :ref:`unified_tutorial`


    """
    return Update(table)


def delete(table: _DMLTableArgument) -> Delete:
    r"""Construct :class:`_expression.Delete` object.

    E.g.::

        from sqlalchemy import delete

        stmt = (
            delete(user_table).
            where(user_table.c.id == 5)
        )

    Similar functionality is available via the
    :meth:`_expression.TableClause.delete` method on
    :class:`_schema.Table`.

    :param table: The table to delete rows from.

    .. seealso::

        :ref:`tutorial_core_update_delete` - in the :ref:`unified_tutorial`


    """
    return Delete(table)
