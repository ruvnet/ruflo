# sql/_selectable_constructors.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

from typing import Any
from typing import Optional
from typing import overload
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import coercions
from . import roles
from ._typing import _ColumnsClauseArgument
from ._typing import _no_kw
from .elements import ColumnClause
from .selectable import Alias
from .selectable import CompoundSelect
from .selectable import Exists
from .selectable import FromClause
from .selectable import Join
from .selectable import Lateral
from .selectable import LateralFromClause
from .selectable import NamedFromClause
from .selectable import Select
from .selectable import TableClause
from .selectable import TableSample
from .selectable import Values

if TYPE_CHECKING:
    from ._typing import _FromClauseArgument
    from ._typing import _OnClauseArgument
    from ._typing import _SelectStatementForCompoundArgument
    from ._typing import _T0
    from ._typing import _T1
    from ._typing import _T2
    from ._typing import _T3
    from ._typing import _T4
    from ._typing import _T5
    from ._typing import _T6
    from ._typing import _T7
    from ._typing import _T8
    from ._typing import _T9
    from ._typing import _TypedColumnClauseArgument as _TCCA
    from .functions import Function
    from .selectable import CTE
    from .selectable import HasCTE
    from .selectable import ScalarSelect
    from .selectable import SelectBase


_T = TypeVar("_T", bound=Any)


def alias(
    selectable: FromClause, name: Optional[str] = None, flat: bool = False
) -> NamedFromClause:
    """Return a named alias of the given :class:`.FromClause`.

    For :class:`.Table` and :class:`.Join` objects, the return type is the
    :class:`_expression.Alias` object. Other kinds of :class:`.NamedFromClause`
    objects may be returned for other kinds of :class:`.FromClause` objects.

    The named alias represents any :class:`_expression.FromClause` with an
    alternate name assigned within SQL, typically using the ``AS`` clause when
    generated, e.g. ``SELECT * FROM table AS aliasname``.

    Equivalent functionality is available via the
    :meth:`_expression.FromClause.alias`
    method available on all :class:`_expression.FromClause` objects.

    :param selectable: any :class:`_expression.FromClause` subclass,
        such as a table, select statement, etc.

    :param name: string name to be assigned as the alias.
        If ``None``, a name will be deterministically generated at compile
        time. Deterministic means the name is guaranteed to be unique against
        other constructs used in the same statement, and will also be the same
        name for each successive compilation of the same statement object.

    :param flat: Will be passed through to if the given selectable
     is an instance of :class:`_expression.Join` - see
     :meth:`_expression.Join.alias` for details.

    """
    return Alias._factory(selectable, name=name, flat=flat)


def cte(
    selectable: HasCTE, name: Optional[str] = None, recursive: bool = False
) -> CTE:
    r"""Return a new :class:`_expression.CTE`,
    or Common Table Expression instance.

    Please see :meth:`_expression.HasCTE.cte` for detail on CTE usage.

    """
    return coercions.expect(roles.HasCTERole, selectable).cte(
        name=name, recursive=recursive
    )


def except_(
    *selects: _SelectStatementForCompoundArgument,
) -> CompoundSelect:
    r"""Return an ``EXCEPT`` of multiple selectables.

    The returned object is an instance of
    :class:`_expression.CompoundSelect`.

    :param \*selects:
      a list of :class:`_expression.Select` instances.

    """
    return CompoundSelect._create_except(*selects)


def except_all(
    *selects: _SelectStatementForCompoundArgument,
) -> CompoundSelect:
    r"""Return an ``EXCEPT ALL`` of multiple selectables.

    The returned object is an instance of
    :class:`_expression.CompoundSelect`.

    :param \*selects:
      a list of :class:`_expression.Select` instances.

    """
    return CompoundSelect._create_except_all(*selects)


def exists(
    __argument: Optional[
        Union[_ColumnsClauseArgument[Any], SelectBase, ScalarSelect[Any]]
    ] = None,
) -> Exists:
    """Construct a new :class:`_expression.Exists` construct.

    The :func:`_sql.exists` can be invoked by itself to produce an
    :class:`_sql.Exists` construct, which will accept simple WHERE
    criteria::

        exists_criteria = exists().where(table1.c.col1 == table2.c.col2)

    However, for greater flexibility in constructing the SELECT, an
    existing :class:`_sql.Select` construct may be converted to an
    :class:`_sql.Exists`, most conveniently by making use of the
    :meth:`_sql.SelectBase.exists` method::

        exists_criteria = (
            select(table2.c.col2).
            where(table1.c.col1 == table2.c.col2).
            exists()
        )

    The EXISTS criteria is then used inside of an enclosing SELECT::

        stmt = select(table1.c.col1).where(exists_criteria)

    The above statement will then be of the form::

        SELECT col1 FROM table1 WHERE EXISTS
        (SELECT table2.col2 FROM table2 WHERE table2.col2 = table1.col1)

    .. seealso::

        :ref:`tutorial_exists` - in the :term:`2.0 style` tutorial.

        :meth:`_sql.SelectBase.exists` - method to transform a ``SELECT`` to an
        ``EXISTS`` clause.

    """  # noqa: E501

    return Exists(__argument)


def intersect(
    *selects: _SelectStatementForCompoundArgument,
) -> CompoundSelect:
    r"""Return an ``INTERSECT`` of multiple selectables.

    The returned object is an instance of
    :class:`_expression.CompoundSelect`.

    :param \*selects:
      a list of :class:`_expression.Select` instances.

    """
    return CompoundSelect._create_intersect(*selects)


def intersect_all(
    *selects: _SelectStatementForCompoundArgument,
) -> CompoundSelect:
    r"""Return an ``INTERSECT ALL`` of multiple selectables.

    The returned object is an instance of
    :class:`_expression.CompoundSelect`.

    :param \*selects:
      a list of :class:`_expression.Select` instances.


    """
    return CompoundSelect._create_intersect_all(*selects)


def join(
    left: _FromClauseArgument,
    right: _FromClauseArgument,
    onclause: Optional[_OnClauseArgument] = None,
    isouter: bool = False,
    full: bool = False,
) -> Join:
    """Produce a :class:`_expression.Join` object, given two
    :class:`_expression.FromClause`
    expressions.

    E.g.::

        j = join(user_table, address_table,
                 user_table.c.id == address_table.c.user_id)
        stmt = select(user_table).select_from(j)

    would emit SQL along the lines of::

        SELECT user.id, user.name FROM user
        JOIN address ON user.id = address.user_id

    Similar functionality is available given any
    :class:`_expression.FromClause` object (e.g. such as a
    :class:`_schema.Table`) using
    the :meth:`_expression.FromClause.join` method.

    :param left: The left side of the join.

    :param right: the right side of the join; this is any
     :class:`_expression.FromClause` object such as a
     :class:`_schema.Table` object, and
     may also be a selectable-compatible object such as an ORM-mapped
     class.

    :param onclause: a SQL expression representing the ON clause of the
     join.  If left at ``None``, :meth:`_expression.FromClause.join`
     will attempt to
     join the two tables based on a foreign key relationship.

    :param isouter: if True, render a LEFT OUTER JOIN, instead of JOIN.

    :param full: if True, render a FULL OUTER JOIN, instead of JOIN.

    .. seealso::

        :meth:`_expression.FromClause.join` - method form,
        based on a given left side.

        :class:`_expression.Join` - the type of object produced.

    """

    return Join(left, right, onclause, isouter, full)


def lateral(
    selectable: Union[SelectBase, _FromClauseArgument],
    name: Optional[str] = None,
) -> LateralFromClause:
    """Return a :class:`_expression.Lateral` object.

    :class:`_expression.Lateral` is an :class:`_expression.Alias`
    subclass that represents
    a subquery with the LATERAL keyword applied to it.

    The special behavior of a LATERAL subquery is that it appears in the
    FROM clause of an enclosing SELECT, but may correlate to other
    FROM clauses of that SELECT.   It is a special case of subquery
    only supported by a small number of backends, currently more recent
    PostgreSQL versions.

    .. seealso::

        :ref:`tutorial_lateral_correlation` -  overview of usage.

    """
    return Lateral._factory(selectable, name=name)


def outerjoin(
    left: _FromClauseArgument,
    right: _FromClauseArgument,
    onclause: Optional[_OnClauseArgument] = None,
    full: bool = False,
) -> Join:
    """Return an ``OUTER JOIN`` clause element.

    The returned object is an instance of :class:`_expression.Join`.

    Similar functionality is also available via the
    :meth:`_expression.FromClause.outerjoin` method on any
    :class:`_expression.FromClause`.

    :param left: The left side of the join.

    :param right: The right side of the join.

    :param onclause:  Optional criterion for the ``ON`` clause, is
      derived from foreign key relationships established between
      left and right otherwise.

    To chain joins together, use the :meth:`_expression.FromClause.join`
    or
    :meth:`_expression.FromClause.outerjoin` methods on the resulting
    :class:`_expression.Join` object.

    """
    return Join(left, right, onclause, isouter=True, full=full)


# START OVERLOADED FUNCTIONS select Select 1-10

# code within this block is **programmatically,
# statically generated** by tools/generate_tuple_map_overloads.py


@overload
def select(__ent0: _TCCA[_T0]) -> Select[Tuple[_T0]]:
    ...


@overload
def select(__ent0: _TCCA[_T0], __ent1: _TCCA[_T1]) -> Select[Tuple[_T0, _T1]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0], __ent1: _TCCA[_T1], __ent2: _TCCA[_T2]
) -> Select[Tuple[_T0, _T1, _T2]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0],
    __ent1: _TCCA[_T1],
    __ent2: _TCCA[_T2],
    __ent3: _TCCA[_T3],
) -> Select[Tuple[_T0, _T1, _T2, _T3]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0],
    __ent1: _TCCA[_T1],
    __ent2: _TCCA[_T2],
    __ent3: _TCCA[_T3],
    __ent4: _TCCA[_T4],
) -> Select[Tuple[_T0, _T1, _T2, _T3, _T4]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0],
    __ent1: _TCCA[_T1],
    __ent2: _TCCA[_T2],
    __ent3: _TCCA[_T3],
    __ent4: _TCCA[_T4],
    __ent5: _TCCA[_T5],
) -> Select[Tuple[_T0, _T1, _T2, _T3, _T4, _T5]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0],
    __ent1: _TCCA[_T1],
    __ent2: _TCCA[_T2],
    __ent3: _TCCA[_T3],
    __ent4: _TCCA[_T4],
    __ent5: _TCCA[_T5],
    __ent6: _TCCA[_T6],
) -> Select[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0],
    __ent1: _TCCA[_T1],
    __ent2: _TCCA[_T2],
    __ent3: _TCCA[_T3],
    __ent4: _TCCA[_T4],
    __ent5: _TCCA[_T5],
    __ent6: _TCCA[_T6],
    __ent7: _TCCA[_T7],
) -> Select[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0],
    __ent1: _TCCA[_T1],
    __ent2: _TCCA[_T2],
    __ent3: _TCCA[_T3],
    __ent4: _TCCA[_T4],
    __ent5: _TCCA[_T5],
    __ent6: _TCCA[_T6],
    __ent7: _TCCA[_T7],
    __ent8: _TCCA[_T8],
) -> Select[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7, _T8]]:
    ...


@overload
def select(
    __ent0: _TCCA[_T0],
    __ent1: _TCCA[_T1],
    __ent2: _TCCA[_T2],
    __ent3: _TCCA[_T3],
    __ent4: _TCCA[_T4],
    __ent5: _TCCA[_T5],
    __ent6: _TCCA[_T6],
    __ent7: _TCCA[_T7],
    __ent8: _TCCA[_T8],
    __ent9: _TCCA[_T9],
) -> Select[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7, _T8, _T9]]:
    ...


# END OVERLOADED FUNCTIONS select


@overload
def select(*entities: _ColumnsClauseArgument[Any], **__kw: Any) -> Select[Any]:
    ...


def select(*entities: _ColumnsClauseArgument[Any], **__kw: Any) -> Select[Any]:
    r"""Construct a new :class:`_expression.Select`.


    .. versionadded:: 1.4 - The :func:`_sql.select` function now accepts
       column arguments positionally.   The top-level :func:`_sql.select`
       function will automatically use the 1.x or 2.x style API based on
       the incoming arguments; using :func:`_sql.select` from the
       ``sqlalchemy.future`` module will enforce that only the 2.x style
       constructor is used.

    Similar functionality is also available via the
    :meth:`_expression.FromClause.select` method on any
    :class:`_expression.FromClause`.

    .. seealso::

        :ref:`tutorial_selecting_data` - in the :ref:`unified_tutorial`

    :param \*entities:
      Entities to SELECT from.  For Core usage, this is typically a series
      of :class:`_expression.ColumnElement` and / or
      :class:`_expression.FromClause`
      objects which will form the columns clause of the resulting
      statement.   For those objects that are instances of
      :class:`_expression.FromClause` (typically :class:`_schema.Table`
      or :class:`_expression.Alias`
      objects), the :attr:`_expression.FromClause.c`
      collection is extracted
      to form a collection of :class:`_expression.ColumnElement` objects.

      This parameter will also accept :class:`_expression.TextClause`
      constructs as
      given, as well as ORM-mapped classes.

    """
    # the keyword args are a necessary element in order for the typing
    # to work out w/ the varargs vs. having named "keyword" arguments that
    # aren't always present.
    if __kw:
        raise _no_kw()
    return Select(*entities)


def table(name: str, *columns: ColumnClause[Any], **kw: Any) -> TableClause:
    """Produce a new :class:`_expression.TableClause`.

    The object returned is an instance of
    :class:`_expression.TableClause`, which
    represents the "syntactical" portion of the schema-level
    :class:`_schema.Table` object.
    It may be used to construct lightweight table constructs.

    :param name: Name of the table.

    :param columns: A collection of :func:`_expression.column` constructs.

    :param schema: The schema name for this table.

        .. versionadded:: 1.3.18 :func:`_expression.table` can now
           accept a ``schema`` argument.
    """

    return TableClause(name, *columns, **kw)


def tablesample(
    selectable: _FromClauseArgument,
    sampling: Union[float, Function[Any]],
    name: Optional[str] = None,
    seed: Optional[roles.ExpressionElementRole[Any]] = None,
) -> TableSample:
    """Return a :class:`_expression.TableSample` object.

    :class:`_expression.TableSample` is an :class:`_expression.Alias`
    subclass that represents
    a table with the TABLESAMPLE clause applied to it.
    :func:`_expression.tablesample`
    is also available from the :class:`_expression.FromClause`
    class via the
    :meth:`_expression.FromClause.tablesample` method.

    The TABLESAMPLE clause allows selecting a randomly selected approximate
    percentage of rows from a table. It supports multiple sampling methods,
    most commonly BERNOULLI and SYSTEM.

    e.g.::

        from sqlalchemy import func

        selectable = people.tablesample(
                    func.bernoulli(1),
                    name='alias',
                    seed=func.random())
        stmt = select(selectable.c.people_id)

    Assuming ``people`` with a column ``people_id``, the above
    statement would render as::

        SELECT alias.people_id FROM
        people AS alias TABLESAMPLE bernoulli(:bernoulli_1)
        REPEATABLE (random())

    :param sampling: a ``float`` percentage between 0 and 100 or
        :class:`_functions.Function`.

    :param name: optional alias name

    :param seed: any real-valued SQL expression.  When specified, the
     REPEATABLE sub-clause is also rendered.

    """
    return TableSample._factory(selectable, sampling, name=name, seed=seed)


def union(
    *selects: _SelectStatementForCompoundArgument,
) -> CompoundSelect:
    r"""Return a ``UNION`` of multiple selectables.

    The returned object is an instance of
    :class:`_expression.CompoundSelect`.

    A similar :func:`union()` method is available on all
    :class:`_expression.FromClause` subclasses.

    :param \*selects:
      a list of :class:`_expression.Select` instances.

    :param \**kwargs:
      available keyword arguments are the same as those of
      :func:`select`.

    """
    return CompoundSelect._create_union(*selects)


def union_all(
    *selects: _SelectStatementForCompoundArgument,
) -> CompoundSelect:
    r"""Return a ``UNION ALL`` of multiple selectables.

    The returned object is an instance of
    :class:`_expression.CompoundSelect`.

    A similar :func:`union_all()` method is available on all
    :class:`_expression.FromClause` subclasses.

    :param \*selects:
      a list of :class:`_expression.Select` instances.

    """
    return CompoundSelect._create_union_all(*selects)


def values(
    *columns: ColumnClause[Any],
    name: Optional[str] = None,
    literal_binds: bool = False,
) -> Values:
    r"""Construct a :class:`_expression.Values` construct.

    The column expressions and the actual data for
    :class:`_expression.Values` are given in two separate steps.  The
    constructor receives the column expressions typically as
    :func:`_expression.column` constructs,
    and the data is then passed via the
    :meth:`_expression.Values.data` method as a list,
    which can be called multiple
    times to add more data, e.g.::

        from sqlalchemy import column
        from sqlalchemy import values

        value_expr = values(
            column('id', Integer),
            column('name', String),
            name="my_values"
        ).data(
            [(1, 'name1'), (2, 'name2'), (3, 'name3')]
        )

    :param \*columns: column expressions, typically composed using
     :func:`_expression.column` objects.

    :param name: the name for this VALUES construct.  If omitted, the
     VALUES construct will be unnamed in a SQL expression.   Different
     backends may have different requirements here.

    :param literal_binds: Defaults to False.  Whether or not to render
     the data values inline in the SQL output, rather than using bound
     parameters.

    """
    return Values(*columns, literal_binds=literal_binds, name=name)
