# sql/_elements_constructors.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import typing
from typing import Any
from typing import Callable
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple as typing_Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import coercions
from . import roles
from .base import _NoArg
from .coercions import _document_text_coercion
from .elements import BindParameter
from .elements import BooleanClauseList
from .elements import Case
from .elements import Cast
from .elements import CollationClause
from .elements import CollectionAggregate
from .elements import ColumnClause
from .elements import ColumnElement
from .elements import Extract
from .elements import False_
from .elements import FunctionFilter
from .elements import Label
from .elements import Null
from .elements import Over
from .elements import TextClause
from .elements import True_
from .elements import TryCast
from .elements import Tuple
from .elements import TypeCoerce
from .elements import UnaryExpression
from .elements import WithinGroup
from .functions import FunctionElement
from ..util.typing import Literal

if typing.TYPE_CHECKING:
    from ._typing import _ByArgument
    from ._typing import _ColumnExpressionArgument
    from ._typing import _ColumnExpressionOrLiteralArgument
    from ._typing import _ColumnExpressionOrStrLabelArgument
    from ._typing import _TypeEngineArgument
    from .elements import BinaryExpression
    from .selectable import FromClause
    from .type_api import TypeEngine

_T = TypeVar("_T")


def all_(expr: _ColumnExpressionArgument[_T]) -> CollectionAggregate[bool]:
    """Produce an ALL expression.

    For dialects such as that of PostgreSQL, this operator applies
    to usage of the :class:`_types.ARRAY` datatype, for that of
    MySQL, it may apply to a subquery.  e.g.::

        # renders on PostgreSQL:
        # '5 = ALL (somearray)'
        expr = 5 == all_(mytable.c.somearray)

        # renders on MySQL:
        # '5 = ALL (SELECT value FROM table)'
        expr = 5 == all_(select(table.c.value))

    Comparison to NULL may work using ``None``::

        None == all_(mytable.c.somearray)

    The any_() / all_() operators also feature a special "operand flipping"
    behavior such that if any_() / all_() are used on the left side of a
    comparison using a standalone operator such as ``==``, ``!=``, etc.
    (not including operator methods such as
    :meth:`_sql.ColumnOperators.is_`) the rendered expression is flipped::

        # would render '5 = ALL (column)`
        all_(mytable.c.column) == 5

    Or with ``None``, which note will not perform
    the usual step of rendering "IS" as is normally the case for NULL::

        # would render 'NULL = ALL(somearray)'
        all_(mytable.c.somearray) == None

    .. versionchanged:: 1.4.26  repaired the use of any_() / all_()
       comparing to NULL on the right side to be flipped to the left.

    The column-level :meth:`_sql.ColumnElement.all_` method (not to be
    confused with :class:`_types.ARRAY` level
    :meth:`_types.ARRAY.Comparator.all`) is shorthand for
    ``all_(col)``::

        5 == mytable.c.somearray.all_()

    .. seealso::

        :meth:`_sql.ColumnOperators.all_`

        :func:`_expression.any_`

    """
    return CollectionAggregate._create_all(expr)


def and_(  # type: ignore[empty-body]
    initial_clause: Union[Literal[True], _ColumnExpressionArgument[bool]],
    *clauses: _ColumnExpressionArgument[bool],
) -> ColumnElement[bool]:
    r"""Produce a conjunction of expressions joined by ``AND``.

    E.g.::

        from sqlalchemy import and_

        stmt = select(users_table).where(
                        and_(
                            users_table.c.name == 'wendy',
                            users_table.c.enrolled == True
                        )
                    )

    The :func:`.and_` conjunction is also available using the
    Python ``&`` operator (though note that compound expressions
    need to be parenthesized in order to function with Python
    operator precedence behavior)::

        stmt = select(users_table).where(
                        (users_table.c.name == 'wendy') &
                        (users_table.c.enrolled == True)
                    )

    The :func:`.and_` operation is also implicit in some cases;
    the :meth:`_expression.Select.where`
    method for example can be invoked multiple
    times against a statement, which will have the effect of each
    clause being combined using :func:`.and_`::

        stmt = select(users_table).\
                where(users_table.c.name == 'wendy').\
                where(users_table.c.enrolled == True)

    The :func:`.and_` construct must be given at least one positional
    argument in order to be valid; a :func:`.and_` construct with no
    arguments is ambiguous.   To produce an "empty" or dynamically
    generated :func:`.and_`  expression, from a given list of expressions,
    a "default" element of :func:`_sql.true` (or just ``True``) should be
    specified::

        from sqlalchemy import true
        criteria = and_(true(), *expressions)

    The above expression will compile to SQL as the expression ``true``
    or ``1 = 1``, depending on backend, if no other expressions are
    present.  If expressions are present, then the :func:`_sql.true` value is
    ignored as it does not affect the outcome of an AND expression that
    has other elements.

    .. deprecated:: 1.4  The :func:`.and_` element now requires that at
       least one argument is passed; creating the :func:`.and_` construct
       with no arguments is deprecated, and will emit a deprecation warning
       while continuing to produce a blank SQL string.

    .. seealso::

        :func:`.or_`

    """
    ...


if not TYPE_CHECKING:
    # handle deprecated case which allows zero-arguments
    def and_(*clauses):  # noqa: F811
        r"""Produce a conjunction of expressions joined by ``AND``.

        E.g.::

            from sqlalchemy import and_

            stmt = select(users_table).where(
                            and_(
                                users_table.c.name == 'wendy',
                                users_table.c.enrolled == True
                            )
                        )

        The :func:`.and_` conjunction is also available using the
        Python ``&`` operator (though note that compound expressions
        need to be parenthesized in order to function with Python
        operator precedence behavior)::

            stmt = select(users_table).where(
                            (users_table.c.name == 'wendy') &
                            (users_table.c.enrolled == True)
                        )

        The :func:`.and_` operation is also implicit in some cases;
        the :meth:`_expression.Select.where`
        method for example can be invoked multiple
        times against a statement, which will have the effect of each
        clause being combined using :func:`.and_`::

            stmt = select(users_table).\
                    where(users_table.c.name == 'wendy').\
                    where(users_table.c.enrolled == True)

        The :func:`.and_` construct must be given at least one positional
        argument in order to be valid; a :func:`.and_` construct with no
        arguments is ambiguous.   To produce an "empty" or dynamically
        generated :func:`.and_`  expression, from a given list of expressions,
        a "default" element of :func:`_sql.true` (or just ``True``) should be
        specified::

            from sqlalchemy import true
            criteria = and_(true(), *expressions)

        The above expression will compile to SQL as the expression ``true``
        or ``1 = 1``, depending on backend, if no other expressions are
        present.  If expressions are present, then the :func:`_sql.true` value
        is ignored as it does not affect the outcome of an AND expression that
        has other elements.

        .. deprecated:: 1.4  The :func:`.and_` element now requires that at
          least one argument is passed; creating the :func:`.and_` construct
          with no arguments is deprecated, and will emit a deprecation warning
          while continuing to produce a blank SQL string.

        .. seealso::

            :func:`.or_`

        """
        return BooleanClauseList.and_(*clauses)


def any_(expr: _ColumnExpressionArgument[_T]) -> CollectionAggregate[bool]:
    """Produce an ANY expression.

    For dialects such as that of PostgreSQL, this operator applies
    to usage of the :class:`_types.ARRAY` datatype, for that of
    MySQL, it may apply to a subquery.  e.g.::

        # renders on PostgreSQL:
        # '5 = ANY (somearray)'
        expr = 5 == any_(mytable.c.somearray)

        # renders on MySQL:
        # '5 = ANY (SELECT value FROM table)'
        expr = 5 == any_(select(table.c.value))

    Comparison to NULL may work using ``None`` or :func:`_sql.null`::

        None == any_(mytable.c.somearray)

    The any_() / all_() operators also feature a special "operand flipping"
    behavior such that if any_() / all_() are used on the left side of a
    comparison using a standalone operator such as ``==``, ``!=``, etc.
    (not including operator methods such as
    :meth:`_sql.ColumnOperators.is_`) the rendered expression is flipped::

        # would render '5 = ANY (column)`
        any_(mytable.c.column) == 5

    Or with ``None``, which note will not perform
    the usual step of rendering "IS" as is normally the case for NULL::

        # would render 'NULL = ANY(somearray)'
        any_(mytable.c.somearray) == None

    .. versionchanged:: 1.4.26  repaired the use of any_() / all_()
       comparing to NULL on the right side to be flipped to the left.

    The column-level :meth:`_sql.ColumnElement.any_` method (not to be
    confused with :class:`_types.ARRAY` level
    :meth:`_types.ARRAY.Comparator.any`) is shorthand for
    ``any_(col)``::

        5 = mytable.c.somearray.any_()

    .. seealso::

        :meth:`_sql.ColumnOperators.any_`

        :func:`_expression.all_`

    """
    return CollectionAggregate._create_any(expr)


def asc(
    column: _ColumnExpressionOrStrLabelArgument[_T],
) -> UnaryExpression[_T]:
    """Produce an ascending ``ORDER BY`` clause element.

    e.g.::

        from sqlalchemy import asc
        stmt = select(users_table).order_by(asc(users_table.c.name))

    will produce SQL as::

        SELECT id, name FROM user ORDER BY name ASC

    The :func:`.asc` function is a standalone version of the
    :meth:`_expression.ColumnElement.asc`
    method available on all SQL expressions,
    e.g.::


        stmt = select(users_table).order_by(users_table.c.name.asc())

    :param column: A :class:`_expression.ColumnElement` (e.g.
     scalar SQL expression)
     with which to apply the :func:`.asc` operation.

    .. seealso::

        :func:`.desc`

        :func:`.nulls_first`

        :func:`.nulls_last`

        :meth:`_expression.Select.order_by`

    """
    return UnaryExpression._create_asc(column)


def collate(
    expression: _ColumnExpressionArgument[str], collation: str
) -> BinaryExpression[str]:
    """Return the clause ``expression COLLATE collation``.

    e.g.::

        collate(mycolumn, 'utf8_bin')

    produces::

        mycolumn COLLATE utf8_bin

    The collation expression is also quoted if it is a case sensitive
    identifier, e.g. contains uppercase characters.

    .. versionchanged:: 1.2 quoting is automatically applied to COLLATE
       expressions if they are case sensitive.

    """
    return CollationClause._create_collation_expression(expression, collation)


def between(
    expr: _ColumnExpressionOrLiteralArgument[_T],
    lower_bound: Any,
    upper_bound: Any,
    symmetric: bool = False,
) -> BinaryExpression[bool]:
    """Produce a ``BETWEEN`` predicate clause.

    E.g.::

        from sqlalchemy import between
        stmt = select(users_table).where(between(users_table.c.id, 5, 7))

    Would produce SQL resembling::

        SELECT id, name FROM user WHERE id BETWEEN :id_1 AND :id_2

    The :func:`.between` function is a standalone version of the
    :meth:`_expression.ColumnElement.between` method available on all
    SQL expressions, as in::

        stmt = select(users_table).where(users_table.c.id.between(5, 7))

    All arguments passed to :func:`.between`, including the left side
    column expression, are coerced from Python scalar values if a
    the value is not a :class:`_expression.ColumnElement` subclass.
    For example,
    three fixed values can be compared as in::

        print(between(5, 3, 7))

    Which would produce::

        :param_1 BETWEEN :param_2 AND :param_3

    :param expr: a column expression, typically a
     :class:`_expression.ColumnElement`
     instance or alternatively a Python scalar expression to be coerced
     into a column expression, serving as the left side of the ``BETWEEN``
     expression.

    :param lower_bound: a column or Python scalar expression serving as the
     lower bound of the right side of the ``BETWEEN`` expression.

    :param upper_bound: a column or Python scalar expression serving as the
     upper bound of the right side of the ``BETWEEN`` expression.

    :param symmetric: if True, will render " BETWEEN SYMMETRIC ". Note
     that not all databases support this syntax.

    .. seealso::

        :meth:`_expression.ColumnElement.between`

    """
    col_expr = coercions.expect(roles.ExpressionElementRole, expr)
    return col_expr.between(lower_bound, upper_bound, symmetric=symmetric)


def outparam(
    key: str, type_: Optional[TypeEngine[_T]] = None
) -> BindParameter[_T]:
    """Create an 'OUT' parameter for usage in functions (stored procedures),
    for databases which support them.

    The ``outparam`` can be used like a regular function parameter.
    The "output" value will be available from the
    :class:`~sqlalchemy.engine.CursorResult` object via its ``out_parameters``
    attribute, which returns a dictionary containing the values.

    """
    return BindParameter(key, None, type_=type_, unique=False, isoutparam=True)


@overload
def not_(clause: BinaryExpression[_T]) -> BinaryExpression[_T]:
    ...


@overload
def not_(clause: _ColumnExpressionArgument[_T]) -> ColumnElement[_T]:
    ...


def not_(clause: _ColumnExpressionArgument[_T]) -> ColumnElement[_T]:
    """Return a negation of the given clause, i.e. ``NOT(clause)``.

    The ``~`` operator is also overloaded on all
    :class:`_expression.ColumnElement` subclasses to produce the
    same result.

    """

    return coercions.expect(roles.ExpressionElementRole, clause).__invert__()


def bindparam(
    key: Optional[str],
    value: Any = _NoArg.NO_ARG,
    type_: Optional[_TypeEngineArgument[_T]] = None,
    unique: bool = False,
    required: Union[bool, Literal[_NoArg.NO_ARG]] = _NoArg.NO_ARG,
    quote: Optional[bool] = None,
    callable_: Optional[Callable[[], Any]] = None,
    expanding: bool = False,
    isoutparam: bool = False,
    literal_execute: bool = False,
) -> BindParameter[_T]:
    r"""Produce a "bound expression".

    The return value is an instance of :class:`.BindParameter`; this
    is a :class:`_expression.ColumnElement`
    subclass which represents a so-called
    "placeholder" value in a SQL expression, the value of which is
    supplied at the point at which the statement in executed against a
    database connection.

    In SQLAlchemy, the :func:`.bindparam` construct has
    the ability to carry along the actual value that will be ultimately
    used at expression time.  In this way, it serves not just as
    a "placeholder" for eventual population, but also as a means of
    representing so-called "unsafe" values which should not be rendered
    directly in a SQL statement, but rather should be passed along
    to the :term:`DBAPI` as values which need to be correctly escaped
    and potentially handled for type-safety.

    When using :func:`.bindparam` explicitly, the use case is typically
    one of traditional deferment of parameters; the :func:`.bindparam`
    construct accepts a name which can then be referred to at execution
    time::

        from sqlalchemy import bindparam

        stmt = select(users_table).\
                    where(users_table.c.name == bindparam('username'))

    The above statement, when rendered, will produce SQL similar to::

        SELECT id, name FROM user WHERE name = :username

    In order to populate the value of ``:username`` above, the value
    would typically be applied at execution time to a method
    like :meth:`_engine.Connection.execute`::

        result = connection.execute(stmt, username='wendy')

    Explicit use of :func:`.bindparam` is also common when producing
    UPDATE or DELETE statements that are to be invoked multiple times,
    where the WHERE criterion of the statement is to change on each
    invocation, such as::

        stmt = (users_table.update().
                where(user_table.c.name == bindparam('username')).
                values(fullname=bindparam('fullname'))
                )

        connection.execute(
            stmt, [{"username": "wendy", "fullname": "Wendy Smith"},
                   {"username": "jack", "fullname": "Jack Jones"},
                   ]
        )

    SQLAlchemy's Core expression system makes wide use of
    :func:`.bindparam` in an implicit sense.   It is typical that Python
    literal values passed to virtually all SQL expression functions are
    coerced into fixed :func:`.bindparam` constructs.  For example, given
    a comparison operation such as::

        expr = users_table.c.name == 'Wendy'

    The above expression will produce a :class:`.BinaryExpression`
    construct, where the left side is the :class:`_schema.Column` object
    representing the ``name`` column, and the right side is a
    :class:`.BindParameter` representing the literal value::

        print(repr(expr.right))
        BindParameter('%(4327771088 name)s', 'Wendy', type_=String())

    The expression above will render SQL such as::

        user.name = :name_1

    Where the ``:name_1`` parameter name is an anonymous name.  The
    actual string ``Wendy`` is not in the rendered string, but is carried
    along where it is later used within statement execution.  If we
    invoke a statement like the following::

        stmt = select(users_table).where(users_table.c.name == 'Wendy')
        result = connection.execute(stmt)

    We would see SQL logging output as::

        SELECT "user".id, "user".name
        FROM "user"
        WHERE "user".name = %(name_1)s
        {'name_1': 'Wendy'}

    Above, we see that ``Wendy`` is passed as a parameter to the database,
    while the placeholder ``:name_1`` is rendered in the appropriate form
    for the target database, in this case the PostgreSQL database.

    Similarly, :func:`.bindparam` is invoked automatically when working
    with :term:`CRUD` statements as far as the "VALUES" portion is
    concerned.   The :func:`_expression.insert` construct produces an
    ``INSERT`` expression which will, at statement execution time, generate
    bound placeholders based on the arguments passed, as in::

        stmt = users_table.insert()
        result = connection.execute(stmt, name='Wendy')

    The above will produce SQL output as::

        INSERT INTO "user" (name) VALUES (%(name)s)
        {'name': 'Wendy'}

    The :class:`_expression.Insert` construct, at
    compilation/execution time, rendered a single :func:`.bindparam`
    mirroring the column name ``name`` as a result of the single ``name``
    parameter we passed to the :meth:`_engine.Connection.execute` method.

    :param key:
      the key (e.g. the name) for this bind param.
      Will be used in the generated
      SQL statement for dialects that use named parameters.  This
      value may be modified when part of a compilation operation,
      if other :class:`BindParameter` objects exist with the same
      key, or if its length is too long and truncation is
      required.

      If omitted, an "anonymous" name is generated for the bound parameter;
      when given a value to bind, the end result is equivalent to calling upon
      the :func:`.literal` function with a value to bind, particularly
      if the :paramref:`.bindparam.unique` parameter is also provided.

    :param value:
      Initial value for this bind param.  Will be used at statement
      execution time as the value for this parameter passed to the
      DBAPI, if no other value is indicated to the statement execution
      method for this particular parameter name.  Defaults to ``None``.

    :param callable\_:
      A callable function that takes the place of "value".  The function
      will be called at statement execution time to determine the
      ultimate value.   Used for scenarios where the actual bind
      value cannot be determined at the point at which the clause
      construct is created, but embedded bind values are still desirable.

    :param type\_:
      A :class:`.TypeEngine` class or instance representing an optional
      datatype for this :func:`.bindparam`.  If not passed, a type
      may be determined automatically for the bind, based on the given
      value; for example, trivial Python types such as ``str``,
      ``int``, ``bool``
      may result in the :class:`.String`, :class:`.Integer` or
      :class:`.Boolean` types being automatically selected.

      The type of a :func:`.bindparam` is significant especially in that
      the type will apply pre-processing to the value before it is
      passed to the database.  For example, a :func:`.bindparam` which
      refers to a datetime value, and is specified as holding the
      :class:`.DateTime` type, may apply conversion needed to the
      value (such as stringification on SQLite) before passing the value
      to the database.

    :param unique:
      if True, the key name of this :class:`.BindParameter` will be
      modified if another :class:`.BindParameter` of the same name
      already has been located within the containing
      expression.  This flag is used generally by the internals
      when producing so-called "anonymous" bound expressions, it
      isn't generally applicable to explicitly-named :func:`.bindparam`
      constructs.

    :param required:
      If ``True``, a value is required at execution time.  If not passed,
      it defaults to ``True`` if neither :paramref:`.bindparam.value`
      or :paramref:`.bindparam.callable` were passed.  If either of these
      parameters are present, then :paramref:`.bindparam.required`
      defaults to ``False``.

    :param quote:
      True if this parameter name requires quoting and is not
      currently known as a SQLAlchemy reserved word; this currently
      only applies to the Oracle backend, where bound names must
      sometimes be quoted.

    :param isoutparam:
      if True, the parameter should be treated like a stored procedure
      "OUT" parameter.  This applies to backends such as Oracle which
      support OUT parameters.

    :param expanding:
      if True, this parameter will be treated as an "expanding" parameter
      at execution time; the parameter value is expected to be a sequence,
      rather than a scalar value, and the string SQL statement will
      be transformed on a per-execution basis to accommodate the sequence
      with a variable number of parameter slots passed to the DBAPI.
      This is to allow statement caching to be used in conjunction with
      an IN clause.

      .. seealso::

        :meth:`.ColumnOperators.in_`

        :ref:`baked_in` - with baked queries

      .. note:: The "expanding" feature does not support "executemany"-
         style parameter sets.

      .. versionadded:: 1.2

      .. versionchanged:: 1.3 the "expanding" bound parameter feature now
         supports empty lists.

    :param literal_execute:
      if True, the bound parameter will be rendered in the compile phase
      with a special "POSTCOMPILE" token, and the SQLAlchemy compiler will
      render the final value of the parameter into the SQL statement at
      statement execution time, omitting the value from the parameter
      dictionary / list passed to DBAPI ``cursor.execute()``.  This
      produces a similar effect as that of using the ``literal_binds``,
      compilation flag,  however takes place as the statement is sent to
      the DBAPI ``cursor.execute()`` method, rather than when the statement
      is compiled.   The primary use of this
      capability is for rendering LIMIT / OFFSET clauses for database
      drivers that can't accommodate for bound parameters in these
      contexts, while allowing SQL constructs to be cacheable at the
      compilation level.

      .. versionadded:: 1.4 Added "post compile" bound parameters

        .. seealso::

            :ref:`change_4808`.

    .. seealso::

        :ref:`tutorial_sending_parameters` - in the
        :ref:`unified_tutorial`


    """
    return BindParameter(
        key,
        value,
        type_,
        unique,
        required,
        quote,
        callable_,
        expanding,
        isoutparam,
        literal_execute,
    )


def case(
    *whens: Union[
        typing_Tuple[_ColumnExpressionArgument[bool], Any], Mapping[Any, Any]
    ],
    value: Optional[Any] = None,
    else_: Optional[Any] = None,
) -> Case[Any]:
    r"""Produce a ``CASE`` expression.

    The ``CASE`` construct in SQL is a conditional object that
    acts somewhat analogously to an "if/then" construct in other
    languages.  It returns an instance of :class:`.Case`.

    :func:`.case` in its usual form is passed a series of "when"
    constructs, that is, a list of conditions and results as tuples::

        from sqlalchemy import case

        stmt = select(users_table).\
                    where(
                        case(
                            (users_table.c.name == 'wendy', 'W'),
                            (users_table.c.name == 'jack', 'J'),
                            else_='E'
                        )
                    )

    The above statement will produce SQL resembling::

        SELECT id, name FROM user
        WHERE CASE
            WHEN (name = :name_1) THEN :param_1
            WHEN (name = :name_2) THEN :param_2
            ELSE :param_3
        END

    When simple equality expressions of several values against a single
    parent column are needed, :func:`.case` also has a "shorthand" format
    used via the
    :paramref:`.case.value` parameter, which is passed a column
    expression to be compared.  In this form, the :paramref:`.case.whens`
    parameter is passed as a dictionary containing expressions to be
    compared against keyed to result expressions.  The statement below is
    equivalent to the preceding statement::

        stmt = select(users_table).\
                    where(
                        case(
                            {"wendy": "W", "jack": "J"},
                            value=users_table.c.name,
                            else_='E'
                        )
                    )

    The values which are accepted as result values in
    :paramref:`.case.whens` as well as with :paramref:`.case.else_` are
    coerced from Python literals into :func:`.bindparam` constructs.
    SQL expressions, e.g. :class:`_expression.ColumnElement` constructs,
    are accepted
    as well.  To coerce a literal string expression into a constant
    expression rendered inline, use the :func:`_expression.literal_column`
    construct,
    as in::

        from sqlalchemy import case, literal_column

        case(
            (
                orderline.c.qty > 100,
                literal_column("'greaterthan100'")
            ),
            (
                orderline.c.qty > 10,
                literal_column("'greaterthan10'")
            ),
            else_=literal_column("'lessthan10'")
        )

    The above will render the given constants without using bound
    parameters for the result values (but still for the comparison
    values), as in::

        CASE
            WHEN (orderline.qty > :qty_1) THEN 'greaterthan100'
            WHEN (orderline.qty > :qty_2) THEN 'greaterthan10'
            ELSE 'lessthan10'
        END

    :param \*whens: The criteria to be compared against,
     :paramref:`.case.whens` accepts two different forms, based on
     whether or not :paramref:`.case.value` is used.

     .. versionchanged:: 1.4 the :func:`_sql.case`
        function now accepts the series of WHEN conditions positionally

     In the first form, it accepts multiple 2-tuples passed as positional
     arguments; each 2-tuple consists of ``(<sql expression>, <value>)``,
     where the SQL expression is a boolean expression and "value" is a
     resulting value, e.g.::

        case(
            (users_table.c.name == 'wendy', 'W'),
            (users_table.c.name == 'jack', 'J')
        )

     In the second form, it accepts a Python dictionary of comparison
     values mapped to a resulting value; this form requires
     :paramref:`.case.value` to be present, and values will be compared
     using the ``==`` operator, e.g.::

        case(
            {"wendy": "W", "jack": "J"},
            value=users_table.c.name
        )

    :param value: An optional SQL expression which will be used as a
      fixed "comparison point" for candidate values within a dictionary
      passed to :paramref:`.case.whens`.

    :param else\_: An optional SQL expression which will be the evaluated
      result of the ``CASE`` construct if all expressions within
      :paramref:`.case.whens` evaluate to false.  When omitted, most
      databases will produce a result of NULL if none of the "when"
      expressions evaluate to true.


    """
    return Case(*whens, value=value, else_=else_)


def cast(
    expression: _ColumnExpressionOrLiteralArgument[Any],
    type_: _TypeEngineArgument[_T],
) -> Cast[_T]:
    r"""Produce a ``CAST`` expression.

    :func:`.cast` returns an instance of :class:`.Cast`.

    E.g.::

        from sqlalchemy import cast, Numeric

        stmt = select(cast(product_table.c.unit_price, Numeric(10, 4)))

    The above statement will produce SQL resembling::

        SELECT CAST(unit_price AS NUMERIC(10, 4)) FROM product

    The :func:`.cast` function performs two distinct functions when
    used.  The first is that it renders the ``CAST`` expression within
    the resulting SQL string.  The second is that it associates the given
    type (e.g. :class:`.TypeEngine` class or instance) with the column
    expression on the Python side, which means the expression will take
    on the expression operator behavior associated with that type,
    as well as the bound-value handling and result-row-handling behavior
    of the type.

    An alternative to :func:`.cast` is the :func:`.type_coerce` function.
    This function performs the second task of associating an expression
    with a specific type, but does not render the ``CAST`` expression
    in SQL.

    :param expression: A SQL expression, such as a
     :class:`_expression.ColumnElement`
     expression or a Python string which will be coerced into a bound
     literal value.

    :param type\_: A :class:`.TypeEngine` class or instance indicating
     the type to which the ``CAST`` should apply.

    .. seealso::

        :ref:`tutorial_casts`

        :func:`.try_cast` - an alternative to CAST that results in
        NULLs when the cast fails, instead of raising an error.
        Only supported by some dialects.

        :func:`.type_coerce` - an alternative to CAST that coerces the type
        on the Python side only, which is often sufficient to generate the
        correct SQL and data coercion.


    """
    return Cast(expression, type_)


def try_cast(
    expression: _ColumnExpressionOrLiteralArgument[Any],
    type_: _TypeEngineArgument[_T],
) -> TryCast[_T]:
    """Produce a ``TRY_CAST`` expression for backends which support it;
    this is a ``CAST`` which returns NULL for un-castable conversions.

    In SQLAlchemy, this construct is supported **only** by the SQL Server
    dialect, and will raise a :class:`.CompileError` if used on other
    included backends.  However, third party backends may also support
    this construct.

    .. tip:: As :func:`_sql.try_cast` originates from the SQL Server dialect,
       it's importable both from ``sqlalchemy.`` as well as from
       ``sqlalchemy.dialects.mssql``.

    :func:`_sql.try_cast` returns an instance of :class:`.TryCast` and
    generally behaves similarly to the :class:`.Cast` construct;
    at the SQL level, the difference between ``CAST`` and ``TRY_CAST``
    is that ``TRY_CAST`` returns NULL for an un-castable expression,
    such as attempting to cast a string ``"hi"`` to an integer value.

    E.g.::

        from sqlalchemy import select, try_cast, Numeric

        stmt = select(
            try_cast(product_table.c.unit_price, Numeric(10, 4))
        )

    The above would render on Microsoft SQL Server as::

        SELECT TRY_CAST (product_table.unit_price AS NUMERIC(10, 4))
        FROM product_table

    .. versionadded:: 2.0.14  :func:`.try_cast` has been
       generalized from the SQL Server dialect into a general use
       construct that may be supported by additional dialects.

    """
    return TryCast(expression, type_)


def column(
    text: str,
    type_: Optional[_TypeEngineArgument[_T]] = None,
    is_literal: bool = False,
    _selectable: Optional[FromClause] = None,
) -> ColumnClause[_T]:
    """Produce a :class:`.ColumnClause` object.

    The :class:`.ColumnClause` is a lightweight analogue to the
    :class:`_schema.Column` class.  The :func:`_expression.column`
    function can
    be invoked with just a name alone, as in::

        from sqlalchemy import column

        id, name = column("id"), column("name")
        stmt = select(id, name).select_from("user")

    The above statement would produce SQL like::

        SELECT id, name FROM user

    Once constructed, :func:`_expression.column`
    may be used like any other SQL
    expression element such as within :func:`_expression.select`
    constructs::

        from sqlalchemy.sql import column

        id, name = column("id"), column("name")
        stmt = select(id, name).select_from("user")

    The text handled by :func:`_expression.column`
    is assumed to be handled
    like the name of a database column; if the string contains mixed case,
    special characters, or matches a known reserved word on the target
    backend, the column expression will render using the quoting
    behavior determined by the backend.  To produce a textual SQL
    expression that is rendered exactly without any quoting,
    use :func:`_expression.literal_column` instead,
    or pass ``True`` as the
    value of :paramref:`_expression.column.is_literal`.   Additionally,
    full SQL
    statements are best handled using the :func:`_expression.text`
    construct.

    :func:`_expression.column` can be used in a table-like
    fashion by combining it with the :func:`.table` function
    (which is the lightweight analogue to :class:`_schema.Table`
    ) to produce
    a working table construct with minimal boilerplate::

        from sqlalchemy import table, column, select

        user = table("user",
                column("id"),
                column("name"),
                column("description"),
        )

        stmt = select(user.c.description).where(user.c.name == 'wendy')

    A :func:`_expression.column` / :func:`.table`
    construct like that illustrated
    above can be created in an
    ad-hoc fashion and is not associated with any
    :class:`_schema.MetaData`, DDL, or events, unlike its
    :class:`_schema.Table` counterpart.

    :param text: the text of the element.

    :param type: :class:`_types.TypeEngine` object which can associate
      this :class:`.ColumnClause` with a type.

    :param is_literal: if True, the :class:`.ColumnClause` is assumed to
      be an exact expression that will be delivered to the output with no
      quoting rules applied regardless of case sensitive settings. the
      :func:`_expression.literal_column()` function essentially invokes
      :func:`_expression.column` while passing ``is_literal=True``.

    .. seealso::

        :class:`_schema.Column`

        :func:`_expression.literal_column`

        :func:`.table`

        :func:`_expression.text`

        :ref:`tutorial_select_arbitrary_text`

    """
    return ColumnClause(text, type_, is_literal, _selectable)


def desc(
    column: _ColumnExpressionOrStrLabelArgument[_T],
) -> UnaryExpression[_T]:
    """Produce a descending ``ORDER BY`` clause element.

    e.g.::

        from sqlalchemy import desc

        stmt = select(users_table).order_by(desc(users_table.c.name))

    will produce SQL as::

        SELECT id, name FROM user ORDER BY name DESC

    The :func:`.desc` function is a standalone version of the
    :meth:`_expression.ColumnElement.desc`
    method available on all SQL expressions,
    e.g.::


        stmt = select(users_table).order_by(users_table.c.name.desc())

    :param column: A :class:`_expression.ColumnElement` (e.g.
     scalar SQL expression)
     with which to apply the :func:`.desc` operation.

    .. seealso::

        :func:`.asc`

        :func:`.nulls_first`

        :func:`.nulls_last`

        :meth:`_expression.Select.order_by`

    """
    return UnaryExpression._create_desc(column)


def distinct(expr: _ColumnExpressionArgument[_T]) -> UnaryExpression[_T]:
    """Produce an column-expression-level unary ``DISTINCT`` clause.

    This applies the ``DISTINCT`` keyword to an individual column
    expression, and is typically contained within an aggregate function,
    as in::

        from sqlalchemy import distinct, func
        stmt = select(func.count(distinct(users_table.c.name)))

    The above would produce an expression resembling::

        SELECT COUNT(DISTINCT name) FROM user

    The :func:`.distinct` function is also available as a column-level
    method, e.g. :meth:`_expression.ColumnElement.distinct`, as in::

        stmt = select(func.count(users_table.c.name.distinct()))

    The :func:`.distinct` operator is different from the
    :meth:`_expression.Select.distinct` method of
    :class:`_expression.Select`,
    which produces a ``SELECT`` statement
    with ``DISTINCT`` applied to the result set as a whole,
    e.g. a ``SELECT DISTINCT`` expression.  See that method for further
    information.

    .. seealso::

        :meth:`_expression.ColumnElement.distinct`

        :meth:`_expression.Select.distinct`

        :data:`.func`

    """
    return UnaryExpression._create_distinct(expr)


def bitwise_not(expr: _ColumnExpressionArgument[_T]) -> UnaryExpression[_T]:
    """Produce a unary bitwise NOT clause, typically via the ``~`` operator.

    Not to be confused with boolean negation :func:`_sql.not_`.

    .. versionadded:: 2.0.2

    .. seealso::

        :ref:`operators_bitwise`


    """

    return UnaryExpression._create_bitwise_not(expr)


def extract(field: str, expr: _ColumnExpressionArgument[Any]) -> Extract:
    """Return a :class:`.Extract` construct.

    This is typically available as :func:`.extract`
    as well as ``func.extract`` from the
    :data:`.func` namespace.

    :param field: The field to extract.

    :param expr: A column or Python scalar expression serving as the
      right side of the ``EXTRACT`` expression.

    E.g.::

        from sqlalchemy import extract
        from sqlalchemy import table, column

        logged_table = table("user",
                column("id"),
                column("date_created"),
        )

        stmt = select(logged_table.c.id).where(
            extract("YEAR", logged_table.c.date_created) == 2021
        )

    In the above example, the statement is used to select ids from the
    database where the ``YEAR`` component matches a specific value.

    Similarly, one can also select an extracted component::

        stmt = select(
            extract("YEAR", logged_table.c.date_created)
        ).where(logged_table.c.id == 1)

    The implementation of ``EXTRACT`` may vary across database backends.
    Users are reminded to consult their database documentation.
    """
    return Extract(field, expr)


def false() -> False_:
    """Return a :class:`.False_` construct.

    E.g.:

    .. sourcecode:: pycon+sql

        >>> from sqlalchemy import false
        >>> print(select(t.c.x).where(false()))
        {printsql}SELECT x FROM t WHERE false

    A backend which does not support true/false constants will render as
    an expression against 1 or 0:

    .. sourcecode:: pycon+sql

        >>> print(select(t.c.x).where(false()))
        {printsql}SELECT x FROM t WHERE 0 = 1

    The :func:`.true` and :func:`.false` constants also feature
    "short circuit" operation within an :func:`.and_` or :func:`.or_`
    conjunction:

    .. sourcecode:: pycon+sql

        >>> print(select(t.c.x).where(or_(t.c.x > 5, true())))
        {printsql}SELECT x FROM t WHERE true{stop}

        >>> print(select(t.c.x).where(and_(t.c.x > 5, false())))
        {printsql}SELECT x FROM t WHERE false{stop}

    .. seealso::

        :func:`.true`

    """

    return False_._instance()


def funcfilter(
    func: FunctionElement[_T], *criterion: _ColumnExpressionArgument[bool]
) -> FunctionFilter[_T]:
    """Produce a :class:`.FunctionFilter` object against a function.

    Used against aggregate and window functions,
    for database backends that support the "FILTER" clause.

    E.g.::

        from sqlalchemy import funcfilter
        funcfilter(func.count(1), MyClass.name == 'some name')

    Would produce "COUNT(1) FILTER (WHERE myclass.name = 'some name')".

    This function is also available from the :data:`~.expression.func`
    construct itself via the :meth:`.FunctionElement.filter` method.

    .. seealso::

        :ref:`tutorial_functions_within_group` - in the
        :ref:`unified_tutorial`

        :meth:`.FunctionElement.filter`

    """
    return FunctionFilter(func, *criterion)


def label(
    name: str,
    element: _ColumnExpressionArgument[_T],
    type_: Optional[_TypeEngineArgument[_T]] = None,
) -> Label[_T]:
    """Return a :class:`Label` object for the
    given :class:`_expression.ColumnElement`.

    A label changes the name of an element in the columns clause of a
    ``SELECT`` statement, typically via the ``AS`` SQL keyword.

    This functionality is more conveniently available via the
    :meth:`_expression.ColumnElement.label` method on
    :class:`_expression.ColumnElement`.

    :param name: label name

    :param obj: a :class:`_expression.ColumnElement`.

    """
    return Label(name, element, type_)


def null() -> Null:
    """Return a constant :class:`.Null` construct."""

    return Null._instance()


def nulls_first(column: _ColumnExpressionArgument[_T]) -> UnaryExpression[_T]:
    """Produce the ``NULLS FIRST`` modifier for an ``ORDER BY`` expression.

    :func:`.nulls_first` is intended to modify the expression produced
    by :func:`.asc` or :func:`.desc`, and indicates how NULL values
    should be handled when they are encountered during ordering::


        from sqlalchemy import desc, nulls_first

        stmt = select(users_table).order_by(
            nulls_first(desc(users_table.c.name)))

    The SQL expression from the above would resemble::

        SELECT id, name FROM user ORDER BY name DESC NULLS FIRST

    Like :func:`.asc` and :func:`.desc`, :func:`.nulls_first` is typically
    invoked from the column expression itself using
    :meth:`_expression.ColumnElement.nulls_first`,
    rather than as its standalone
    function version, as in::

        stmt = select(users_table).order_by(
            users_table.c.name.desc().nulls_first())

    .. versionchanged:: 1.4 :func:`.nulls_first` is renamed from
        :func:`.nullsfirst` in previous releases.
        The previous name remains available for backwards compatibility.

    .. seealso::

        :func:`.asc`

        :func:`.desc`

        :func:`.nulls_last`

        :meth:`_expression.Select.order_by`

    """
    return UnaryExpression._create_nulls_first(column)


def nulls_last(column: _ColumnExpressionArgument[_T]) -> UnaryExpression[_T]:
    """Produce the ``NULLS LAST`` modifier for an ``ORDER BY`` expression.

    :func:`.nulls_last` is intended to modify the expression produced
    by :func:`.asc` or :func:`.desc`, and indicates how NULL values
    should be handled when they are encountered during ordering::


        from sqlalchemy import desc, nulls_last

        stmt = select(users_table).order_by(
            nulls_last(desc(users_table.c.name)))

    The SQL expression from the above would resemble::

        SELECT id, name FROM user ORDER BY name DESC NULLS LAST

    Like :func:`.asc` and :func:`.desc`, :func:`.nulls_last` is typically
    invoked from the column expression itself using
    :meth:`_expression.ColumnElement.nulls_last`,
    rather than as its standalone
    function version, as in::

        stmt = select(users_table).order_by(
            users_table.c.name.desc().nulls_last())

    .. versionchanged:: 1.4 :func:`.nulls_last` is renamed from
        :func:`.nullslast` in previous releases.
        The previous name remains available for backwards compatibility.

    .. seealso::

        :func:`.asc`

        :func:`.desc`

        :func:`.nulls_first`

        :meth:`_expression.Select.order_by`

    """
    return UnaryExpression._create_nulls_last(column)


def or_(  # type: ignore[empty-body]
    initial_clause: Union[Literal[False], _ColumnExpressionArgument[bool]],
    *clauses: _ColumnExpressionArgument[bool],
) -> ColumnElement[bool]:
    """Produce a conjunction of expressions joined by ``OR``.

    E.g.::

        from sqlalchemy import or_

        stmt = select(users_table).where(
                        or_(
                            users_table.c.name == 'wendy',
                            users_table.c.name == 'jack'
                        )
                    )

    The :func:`.or_` conjunction is also available using the
    Python ``|`` operator (though note that compound expressions
    need to be parenthesized in order to function with Python
    operator precedence behavior)::

        stmt = select(users_table).where(
                        (users_table.c.name == 'wendy') |
                        (users_table.c.name == 'jack')
                    )

    The :func:`.or_` construct must be given at least one positional
    argument in order to be valid; a :func:`.or_` construct with no
    arguments is ambiguous.   To produce an "empty" or dynamically
    generated :func:`.or_`  expression, from a given list of expressions,
    a "default" element of :func:`_sql.false` (or just ``False``) should be
    specified::

        from sqlalchemy import false
        or_criteria = or_(false(), *expressions)

    The above expression will compile to SQL as the expression ``false``
    or ``0 = 1``, depending on backend, if no other expressions are
    present.  If expressions are present, then the :func:`_sql.false` value is
    ignored as it does not affect the outcome of an OR expression which
    has other elements.

    .. deprecated:: 1.4  The :func:`.or_` element now requires that at
       least one argument is passed; creating the :func:`.or_` construct
       with no arguments is deprecated, and will emit a deprecation warning
       while continuing to produce a blank SQL string.

    .. seealso::

        :func:`.and_`

    """
    ...


if not TYPE_CHECKING:
    # handle deprecated case which allows zero-arguments
    def or_(*clauses):  # noqa: F811
        """Produce a conjunction of expressions joined by ``OR``.

        E.g.::

            from sqlalchemy import or_

            stmt = select(users_table).where(
                            or_(
                                users_table.c.name == 'wendy',
                                users_table.c.name == 'jack'
                            )
                        )

        The :func:`.or_` conjunction is also available using the
        Python ``|`` operator (though note that compound expressions
        need to be parenthesized in order to function with Python
        operator precedence behavior)::

            stmt = select(users_table).where(
                            (users_table.c.name == 'wendy') |
                            (users_table.c.name == 'jack')
                        )

        The :func:`.or_` construct must be given at least one positional
        argument in order to be valid; a :func:`.or_` construct with no
        arguments is ambiguous.   To produce an "empty" or dynamically
        generated :func:`.or_`  expression, from a given list of expressions,
        a "default" element of :func:`_sql.false` (or just ``False``) should be
        specified::

            from sqlalchemy import false
            or_criteria = or_(false(), *expressions)

        The above expression will compile to SQL as the expression ``false``
        or ``0 = 1``, depending on backend, if no other expressions are
        present.  If expressions are present, then the :func:`_sql.false` value
        is ignored as it does not affect the outcome of an OR expression which
        has other elements.

        .. deprecated:: 1.4  The :func:`.or_` element now requires that at
           least one argument is passed; creating the :func:`.or_` construct
           with no arguments is deprecated, and will emit a deprecation warning
           while continuing to produce a blank SQL string.

        .. seealso::

            :func:`.and_`

        """
        return BooleanClauseList.or_(*clauses)


def over(
    element: FunctionElement[_T],
    partition_by: Optional[_ByArgument] = None,
    order_by: Optional[_ByArgument] = None,
    range_: Optional[typing_Tuple[Optional[int], Optional[int]]] = None,
    rows: Optional[typing_Tuple[Optional[int], Optional[int]]] = None,
) -> Over[_T]:
    r"""Produce an :class:`.Over` object against a function.

    Used against aggregate or so-called "window" functions,
    for database backends that support window functions.

    :func:`_expression.over` is usually called using
    the :meth:`.FunctionElement.over` method, e.g.::

        func.row_number().over(order_by=mytable.c.some_column)

    Would produce::

        ROW_NUMBER() OVER(ORDER BY some_column)

    Ranges are also possible using the :paramref:`.expression.over.range_`
    and :paramref:`.expression.over.rows` parameters.  These
    mutually-exclusive parameters each accept a 2-tuple, which contains
    a combination of integers and None::

        func.row_number().over(
            order_by=my_table.c.some_column, range_=(None, 0))

    The above would produce::

        ROW_NUMBER() OVER(ORDER BY some_column
        RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)

    A value of ``None`` indicates "unbounded", a
    value of zero indicates "current row", and negative / positive
    integers indicate "preceding" and "following":

    * RANGE BETWEEN 5 PRECEDING AND 10 FOLLOWING::

        func.row_number().over(order_by='x', range_=(-5, 10))

    * ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW::

        func.row_number().over(order_by='x', rows=(None, 0))

    * RANGE BETWEEN 2 PRECEDING AND UNBOUNDED FOLLOWING::

        func.row_number().over(order_by='x', range_=(-2, None))

    * RANGE BETWEEN 1 FOLLOWING AND 3 FOLLOWING::

        func.row_number().over(order_by='x', range_=(1, 3))

    :param element: a :class:`.FunctionElement`, :class:`.WithinGroup`,
     or other compatible construct.
    :param partition_by: a column element or string, or a list
     of such, that will be used as the PARTITION BY clause
     of the OVER construct.
    :param order_by: a column element or string, or a list
     of such, that will be used as the ORDER BY clause
     of the OVER construct.
    :param range\_: optional range clause for the window.  This is a
     tuple value which can contain integer values or ``None``,
     and will render a RANGE BETWEEN PRECEDING / FOLLOWING clause.

    :param rows: optional rows clause for the window.  This is a tuple
     value which can contain integer values or None, and will render
     a ROWS BETWEEN PRECEDING / FOLLOWING clause.

    This function is also available from the :data:`~.expression.func`
    construct itself via the :meth:`.FunctionElement.over` method.

    .. seealso::

        :ref:`tutorial_window_functions` - in the :ref:`unified_tutorial`

        :data:`.expression.func`

        :func:`_expression.within_group`

    """
    return Over(element, partition_by, order_by, range_, rows)


@_document_text_coercion("text", ":func:`.text`", ":paramref:`.text.text`")
def text(text: str) -> TextClause:
    r"""Construct a new :class:`_expression.TextClause` clause,
    representing
    a textual SQL string directly.

    E.g.::

        from sqlalchemy import text

        t = text("SELECT * FROM users")
        result = connection.execute(t)

    The advantages :func:`_expression.text`
    provides over a plain string are
    backend-neutral support for bind parameters, per-statement
    execution options, as well as
    bind parameter and result-column typing behavior, allowing
    SQLAlchemy type constructs to play a role when executing
    a statement that is specified literally.  The construct can also
    be provided with a ``.c`` collection of column elements, allowing
    it to be embedded in other SQL expression constructs as a subquery.

    Bind parameters are specified by name, using the format ``:name``.
    E.g.::

        t = text("SELECT * FROM users WHERE id=:user_id")
        result = connection.execute(t, user_id=12)

    For SQL statements where a colon is required verbatim, as within
    an inline string, use a backslash to escape::

        t = text(r"SELECT * FROM users WHERE name='\:username'")

    The :class:`_expression.TextClause`
    construct includes methods which can
    provide information about the bound parameters as well as the column
    values which would be returned from the textual statement, assuming
    it's an executable SELECT type of statement.  The
    :meth:`_expression.TextClause.bindparams`
    method is used to provide bound
    parameter detail, and :meth:`_expression.TextClause.columns`
    method allows
    specification of return columns including names and types::

        t = text("SELECT * FROM users WHERE id=:user_id").\
                bindparams(user_id=7).\
                columns(id=Integer, name=String)

        for id, name in connection.execute(t):
            print(id, name)

    The :func:`_expression.text` construct is used in cases when
    a literal string SQL fragment is specified as part of a larger query,
    such as for the WHERE clause of a SELECT statement::

        s = select(users.c.id, users.c.name).where(text("id=:user_id"))
        result = connection.execute(s, user_id=12)

    :func:`_expression.text` is also used for the construction
    of a full, standalone statement using plain text.
    As such, SQLAlchemy refers
    to it as an :class:`.Executable` object and may be used
    like any other statement passed to an ``.execute()`` method.

    :param text:
      the text of the SQL statement to be created.  Use ``:<param>``
      to specify bind parameters; they will be compiled to their
      engine-specific format.

    .. seealso::

        :ref:`tutorial_select_arbitrary_text`

    """
    return TextClause(text)


def true() -> True_:
    """Return a constant :class:`.True_` construct.

    E.g.:

    .. sourcecode:: pycon+sql

        >>> from sqlalchemy import true
        >>> print(select(t.c.x).where(true()))
        {printsql}SELECT x FROM t WHERE true

    A backend which does not support true/false constants will render as
    an expression against 1 or 0:

    .. sourcecode:: pycon+sql

        >>> print(select(t.c.x).where(true()))
        {printsql}SELECT x FROM t WHERE 1 = 1

    The :func:`.true` and :func:`.false` constants also feature
    "short circuit" operation within an :func:`.and_` or :func:`.or_`
    conjunction:

    .. sourcecode:: pycon+sql

        >>> print(select(t.c.x).where(or_(t.c.x > 5, true())))
        {printsql}SELECT x FROM t WHERE true{stop}

        >>> print(select(t.c.x).where(and_(t.c.x > 5, false())))
        {printsql}SELECT x FROM t WHERE false{stop}

    .. seealso::

        :func:`.false`

    """

    return True_._instance()


def tuple_(
    *clauses: _ColumnExpressionArgument[Any],
    types: Optional[Sequence[_TypeEngineArgument[Any]]] = None,
) -> Tuple:
    """Return a :class:`.Tuple`.

    Main usage is to produce a composite IN construct using
    :meth:`.ColumnOperators.in_` ::

        from sqlalchemy import tuple_

        tuple_(table.c.col1, table.c.col2).in_(
            [(1, 2), (5, 12), (10, 19)]
        )

    .. versionchanged:: 1.3.6 Added support for SQLite IN tuples.

    .. warning::

        The composite IN construct is not supported by all backends, and is
        currently known to work on PostgreSQL, MySQL, and SQLite.
        Unsupported backends will raise a subclass of
        :class:`~sqlalchemy.exc.DBAPIError` when such an expression is
        invoked.

    """
    return Tuple(*clauses, types=types)


def type_coerce(
    expression: _ColumnExpressionOrLiteralArgument[Any],
    type_: _TypeEngineArgument[_T],
) -> TypeCoerce[_T]:
    r"""Associate a SQL expression with a particular type, without rendering
    ``CAST``.

    E.g.::

        from sqlalchemy import type_coerce

        stmt = select(type_coerce(log_table.date_string, StringDateTime()))

    The above construct will produce a :class:`.TypeCoerce` object, which
    does not modify the rendering in any way on the SQL side, with the
    possible exception of a generated label if used in a columns clause
    context:

    .. sourcecode:: sql

        SELECT date_string AS date_string FROM log

    When result rows are fetched, the ``StringDateTime`` type processor
    will be applied to result rows on behalf of the ``date_string`` column.

    .. note:: the :func:`.type_coerce` construct does not render any
       SQL syntax of its own, including that it does not imply
       parenthesization.   Please use :meth:`.TypeCoerce.self_group`
       if explicit parenthesization is required.

    In order to provide a named label for the expression, use
    :meth:`_expression.ColumnElement.label`::

        stmt = select(
            type_coerce(log_table.date_string, StringDateTime()).label('date')
        )


    A type that features bound-value handling will also have that behavior
    take effect when literal values or :func:`.bindparam` constructs are
    passed to :func:`.type_coerce` as targets.
    For example, if a type implements the
    :meth:`.TypeEngine.bind_expression`
    method or :meth:`.TypeEngine.bind_processor` method or equivalent,
    these functions will take effect at statement compilation/execution
    time when a literal value is passed, as in::

        # bound-value handling of MyStringType will be applied to the
        # literal value "some string"
        stmt = select(type_coerce("some string", MyStringType))

    When using :func:`.type_coerce` with composed expressions, note that
    **parenthesis are not applied**.   If :func:`.type_coerce` is being
    used in an operator context where the parenthesis normally present from
    CAST are necessary, use the :meth:`.TypeCoerce.self_group` method:

    .. sourcecode:: pycon+sql

        >>> some_integer = column("someint", Integer)
        >>> some_string = column("somestr", String)
        >>> expr = type_coerce(some_integer + 5, String) + some_string
        >>> print(expr)
        {printsql}someint + :someint_1 || somestr{stop}
        >>> expr = type_coerce(some_integer + 5, String).self_group() + some_string
        >>> print(expr)
        {printsql}(someint + :someint_1) || somestr{stop}

    :param expression: A SQL expression, such as a
     :class:`_expression.ColumnElement`
     expression or a Python string which will be coerced into a bound
     literal value.

    :param type\_: A :class:`.TypeEngine` class or instance indicating
     the type to which the expression is coerced.

    .. seealso::

        :ref:`tutorial_casts`

        :func:`.cast`

    """  # noqa
    return TypeCoerce(expression, type_)


def within_group(
    element: FunctionElement[_T], *order_by: _ColumnExpressionArgument[Any]
) -> WithinGroup[_T]:
    r"""Produce a :class:`.WithinGroup` object against a function.

    Used against so-called "ordered set aggregate" and "hypothetical
    set aggregate" functions, including :class:`.percentile_cont`,
    :class:`.rank`, :class:`.dense_rank`, etc.

    :func:`_expression.within_group` is usually called using
    the :meth:`.FunctionElement.within_group` method, e.g.::

        from sqlalchemy import within_group
        stmt = select(
            department.c.id,
            func.percentile_cont(0.5).within_group(
                department.c.salary.desc()
            )
        )

    The above statement would produce SQL similar to
    ``SELECT department.id, percentile_cont(0.5)
    WITHIN GROUP (ORDER BY department.salary DESC)``.

    :param element: a :class:`.FunctionElement` construct, typically
     generated by :data:`~.expression.func`.
    :param \*order_by: one or more column elements that will be used
     as the ORDER BY clause of the WITHIN GROUP construct.

    .. seealso::

        :ref:`tutorial_functions_within_group` - in the
        :ref:`unified_tutorial`

        :data:`.expression.func`

        :func:`_expression.over`

    """
    return WithinGroup(element, *order_by)
