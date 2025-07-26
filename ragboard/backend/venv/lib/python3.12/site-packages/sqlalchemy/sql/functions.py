# sql/functions.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php


"""SQL function API, factories, and built-in functions.

"""

from __future__ import annotations

import datetime
import decimal
from typing import Any
from typing import cast
from typing import Dict
from typing import List
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import annotation
from . import coercions
from . import operators
from . import roles
from . import schema
from . import sqltypes
from . import type_api
from . import util as sqlutil
from ._typing import is_table_value_type
from .base import _entity_namespace
from .base import ColumnCollection
from .base import Executable
from .base import Generative
from .base import HasMemoized
from .elements import _type_from_args
from .elements import BinaryExpression
from .elements import BindParameter
from .elements import Cast
from .elements import ClauseList
from .elements import ColumnElement
from .elements import Extract
from .elements import FunctionFilter
from .elements import Grouping
from .elements import literal_column
from .elements import NamedColumn
from .elements import Over
from .elements import WithinGroup
from .selectable import FromClause
from .selectable import Select
from .selectable import TableValuedAlias
from .sqltypes import TableValueType
from .type_api import TypeEngine
from .visitors import InternalTraversal
from .. import util


if TYPE_CHECKING:
    from ._typing import _ByArgument
    from ._typing import _ColumnExpressionArgument
    from ._typing import _ColumnExpressionOrLiteralArgument
    from ._typing import _TypeEngineArgument
    from .base import _EntityNamespace
    from .elements import ClauseElement
    from .elements import KeyedColumnElement
    from .elements import TableValuedColumn
    from .operators import OperatorType
    from ..engine.base import Connection
    from ..engine.cursor import CursorResult
    from ..engine.interfaces import _CoreMultiExecuteParams
    from ..engine.interfaces import CoreExecuteOptionsParameter
    from ..util.typing import Self

_T = TypeVar("_T", bound=Any)
_S = TypeVar("_S", bound=Any)

_registry: util.defaultdict[
    str, Dict[str, Type[Function[Any]]]
] = util.defaultdict(dict)


def register_function(
    identifier: str, fn: Type[Function[Any]], package: str = "_default"
) -> None:
    """Associate a callable with a particular func. name.

    This is normally called by GenericFunction, but is also
    available by itself so that a non-Function construct
    can be associated with the :data:`.func` accessor (i.e.
    CAST, EXTRACT).

    """
    reg = _registry[package]

    identifier = str(identifier).lower()

    # Check if a function with the same identifier is registered.
    if identifier in reg:
        util.warn(
            "The GenericFunction '{}' is already registered and "
            "is going to be overridden.".format(identifier)
        )
    reg[identifier] = fn


class FunctionElement(Executable, ColumnElement[_T], FromClause, Generative):
    """Base for SQL function-oriented constructs.

    This is a `generic type <https://peps.python.org/pep-0484/#generics>`_,
    meaning that type checkers and IDEs can be instructed on the types to
    expect in a :class:`_engine.Result` for this function. See
    :class:`.GenericFunction` for an example of how this is done.

    .. seealso::

        :ref:`tutorial_functions` - in the :ref:`unified_tutorial`

        :class:`.Function` - named SQL function.

        :data:`.func` - namespace which produces registered or ad-hoc
        :class:`.Function` instances.

        :class:`.GenericFunction` - allows creation of registered function
        types.

    """

    _traverse_internals = [
        ("clause_expr", InternalTraversal.dp_clauseelement),
        ("_with_ordinality", InternalTraversal.dp_boolean),
        ("_table_value_type", InternalTraversal.dp_has_cache_key),
    ]

    packagenames: Tuple[str, ...] = ()

    _has_args = False
    _with_ordinality = False
    _table_value_type: Optional[TableValueType] = None

    # some attributes that are defined between both ColumnElement and
    # FromClause are set to Any here to avoid typing errors
    primary_key: Any
    _is_clone_of: Any

    clause_expr: Grouping[Any]

    def __init__(self, *clauses: _ColumnExpressionOrLiteralArgument[Any]):
        r"""Construct a :class:`.FunctionElement`.

        :param \*clauses: list of column expressions that form the arguments
         of the SQL function call.

        :param \**kwargs:  additional kwargs are typically consumed by
         subclasses.

        .. seealso::

            :data:`.func`

            :class:`.Function`

        """
        args: Sequence[_ColumnExpressionArgument[Any]] = [
            coercions.expect(
                roles.ExpressionElementRole,
                c,
                name=getattr(self, "name", None),
                apply_propagate_attrs=self,
            )
            for c in clauses
        ]
        self._has_args = self._has_args or bool(args)
        self.clause_expr = Grouping(
            ClauseList(operator=operators.comma_op, group_contents=True, *args)
        )

    _non_anon_label = None

    @property
    def _proxy_key(self) -> Any:
        return super()._proxy_key or getattr(self, "name", None)

    def _execute_on_connection(
        self,
        connection: Connection,
        distilled_params: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> CursorResult[Any]:
        return connection._execute_function(
            self, distilled_params, execution_options
        )

    def scalar_table_valued(
        self, name: str, type_: Optional[_TypeEngineArgument[_T]] = None
    ) -> ScalarFunctionColumn[_T]:
        """Return a column expression that's against this
        :class:`_functions.FunctionElement` as a scalar
        table-valued expression.

        The returned expression is similar to that returned by a single column
        accessed off of a :meth:`_functions.FunctionElement.table_valued`
        construct, except no FROM clause is generated; the function is rendered
        in the similar way as a scalar subquery.

        E.g.:

        .. sourcecode:: pycon+sql

            >>> from sqlalchemy import func, select
            >>> fn = func.jsonb_each("{'k', 'v'}").scalar_table_valued("key")
            >>> print(select(fn))
            {printsql}SELECT (jsonb_each(:jsonb_each_1)).key

        .. versionadded:: 1.4.0b2

        .. seealso::

            :meth:`_functions.FunctionElement.table_valued`

            :meth:`_functions.FunctionElement.alias`

            :meth:`_functions.FunctionElement.column_valued`

        """  # noqa: E501

        return ScalarFunctionColumn(self, name, type_)

    def table_valued(
        self, *expr: _ColumnExpressionArgument[Any], **kw: Any
    ) -> TableValuedAlias:
        r"""Return a :class:`_sql.TableValuedAlias` representation of this
        :class:`_functions.FunctionElement` with table-valued expressions added.

        e.g.:

        .. sourcecode:: pycon+sql

            >>> fn = (
            ...     func.generate_series(1, 5).
            ...     table_valued("value", "start", "stop", "step")
            ... )

            >>> print(select(fn))
            {printsql}SELECT anon_1.value, anon_1.start, anon_1.stop, anon_1.step
            FROM generate_series(:generate_series_1, :generate_series_2) AS anon_1{stop}

            >>> print(select(fn.c.value, fn.c.stop).where(fn.c.value > 2))
            {printsql}SELECT anon_1.value, anon_1.stop
            FROM generate_series(:generate_series_1, :generate_series_2) AS anon_1
            WHERE anon_1.value > :value_1{stop}

        A WITH ORDINALITY expression may be generated by passing the keyword
        argument "with_ordinality":

        .. sourcecode:: pycon+sql

            >>> fn = func.generate_series(4, 1, -1).table_valued("gen", with_ordinality="ordinality")
            >>> print(select(fn))
            {printsql}SELECT anon_1.gen, anon_1.ordinality
            FROM generate_series(:generate_series_1, :generate_series_2, :generate_series_3) WITH ORDINALITY AS anon_1

        :param \*expr: A series of string column names that will be added to the
         ``.c`` collection of the resulting :class:`_sql.TableValuedAlias`
         construct as columns.  :func:`_sql.column` objects with or without
         datatypes may also be used.

        :param name: optional name to assign to the alias name that's generated.
         If omitted, a unique anonymizing name is used.

        :param with_ordinality: string name that when present results in the
         ``WITH ORDINALITY`` clause being added to the alias, and the given
         string name will be added as a column to the .c collection
         of the resulting :class:`_sql.TableValuedAlias`.

        :param joins_implicitly: when True, the table valued function may be
         used in the FROM clause without any explicit JOIN to other tables
         in the SQL query, and no "cartesian product" warning will be generated.
         May be useful for SQL functions such as ``func.json_each()``.

         .. versionadded:: 1.4.33

        .. versionadded:: 1.4.0b2


        .. seealso::

            :ref:`tutorial_functions_table_valued` - in the :ref:`unified_tutorial`

            :ref:`postgresql_table_valued` - in the :ref:`postgresql_toplevel` documentation

            :meth:`_functions.FunctionElement.scalar_table_valued` - variant of
            :meth:`_functions.FunctionElement.table_valued` which delivers the
            complete table valued expression as a scalar column expression

            :meth:`_functions.FunctionElement.column_valued`

            :meth:`_sql.TableValuedAlias.render_derived` - renders the alias
            using a derived column clause, e.g. ``AS name(col1, col2, ...)``

        """  # noqa: 501

        new_func = self._generate()

        with_ordinality = kw.pop("with_ordinality", None)
        joins_implicitly = kw.pop("joins_implicitly", None)
        name = kw.pop("name", None)

        if with_ordinality:
            expr += (with_ordinality,)
            new_func._with_ordinality = True

        new_func.type = new_func._table_value_type = TableValueType(*expr)

        return new_func.alias(name=name, joins_implicitly=joins_implicitly)

    def column_valued(
        self, name: Optional[str] = None, joins_implicitly: bool = False
    ) -> TableValuedColumn[_T]:
        """Return this :class:`_functions.FunctionElement` as a column expression that
        selects from itself as a FROM clause.

        E.g.:

        .. sourcecode:: pycon+sql

            >>> from sqlalchemy import select, func
            >>> gs = func.generate_series(1, 5, -1).column_valued()
            >>> print(select(gs))
            {printsql}SELECT anon_1
            FROM generate_series(:generate_series_1, :generate_series_2, :generate_series_3) AS anon_1

        This is shorthand for::

            gs = func.generate_series(1, 5, -1).alias().column

        :param name: optional name to assign to the alias name that's generated.
         If omitted, a unique anonymizing name is used.

        :param joins_implicitly: when True, the "table" portion of the column
         valued function may be a member of the FROM clause without any
         explicit JOIN to other tables in the SQL query, and no "cartesian
         product" warning will be generated. May be useful for SQL functions
         such as ``func.json_array_elements()``.

         .. versionadded:: 1.4.46

        .. seealso::

            :ref:`tutorial_functions_column_valued` - in the :ref:`unified_tutorial`

            :ref:`postgresql_column_valued` - in the :ref:`postgresql_toplevel` documentation

            :meth:`_functions.FunctionElement.table_valued`

        """  # noqa: 501

        return self.alias(name=name, joins_implicitly=joins_implicitly).column

    @util.ro_non_memoized_property
    def columns(self) -> ColumnCollection[str, KeyedColumnElement[Any]]:  # type: ignore[override]  # noqa: E501
        r"""The set of columns exported by this :class:`.FunctionElement`.

        This is a placeholder collection that allows the function to be
        placed in the FROM clause of a statement:

        .. sourcecode:: pycon+sql

            >>> from sqlalchemy import column, select, func
            >>> stmt = select(column('x'), column('y')).select_from(func.myfunction())
            >>> print(stmt)
            {printsql}SELECT x, y FROM myfunction()

        The above form is a legacy feature that is now superseded by the
        fully capable :meth:`_functions.FunctionElement.table_valued`
        method; see that method for details.

        .. seealso::

            :meth:`_functions.FunctionElement.table_valued` - generates table-valued
            SQL function expressions.

        """  # noqa: E501
        return self.c

    @util.ro_memoized_property
    def c(self) -> ColumnCollection[str, KeyedColumnElement[Any]]:  # type: ignore[override]  # noqa: E501
        """synonym for :attr:`.FunctionElement.columns`."""

        return ColumnCollection(
            columns=[(col.key, col) for col in self._all_selected_columns]
        )

    @property
    def _all_selected_columns(self) -> Sequence[KeyedColumnElement[Any]]:
        if is_table_value_type(self.type):
            # TODO: this might not be fully accurate
            cols = cast(
                "Sequence[KeyedColumnElement[Any]]", self.type._elements
            )
        else:
            cols = [self.label(None)]

        return cols

    @property
    def exported_columns(  # type: ignore[override]
        self,
    ) -> ColumnCollection[str, KeyedColumnElement[Any]]:
        return self.columns

    @HasMemoized.memoized_attribute
    def clauses(self) -> ClauseList:
        """Return the underlying :class:`.ClauseList` which contains
        the arguments for this :class:`.FunctionElement`.

        """
        return cast(ClauseList, self.clause_expr.element)

    def over(
        self,
        *,
        partition_by: Optional[_ByArgument] = None,
        order_by: Optional[_ByArgument] = None,
        rows: Optional[Tuple[Optional[int], Optional[int]]] = None,
        range_: Optional[Tuple[Optional[int], Optional[int]]] = None,
    ) -> Over[_T]:
        """Produce an OVER clause against this function.

        Used against aggregate or so-called "window" functions,
        for database backends that support window functions.

        The expression::

            func.row_number().over(order_by='x')

        is shorthand for::

            from sqlalchemy import over
            over(func.row_number(), order_by='x')

        See :func:`_expression.over` for a full description.

        .. seealso::

            :func:`_expression.over`

            :ref:`tutorial_window_functions` - in the :ref:`unified_tutorial`

        """
        return Over(
            self,
            partition_by=partition_by,
            order_by=order_by,
            rows=rows,
            range_=range_,
        )

    def within_group(
        self, *order_by: _ColumnExpressionArgument[Any]
    ) -> WithinGroup[_T]:
        """Produce a WITHIN GROUP (ORDER BY expr) clause against this function.

        Used against so-called "ordered set aggregate" and "hypothetical
        set aggregate" functions, including :class:`.percentile_cont`,
        :class:`.rank`, :class:`.dense_rank`, etc.

        See :func:`_expression.within_group` for a full description.

        .. seealso::

            :ref:`tutorial_functions_within_group` -
            in the :ref:`unified_tutorial`


        """
        return WithinGroup(self, *order_by)

    @overload
    def filter(self) -> Self:
        ...

    @overload
    def filter(
        self,
        __criterion0: _ColumnExpressionArgument[bool],
        *criterion: _ColumnExpressionArgument[bool],
    ) -> FunctionFilter[_T]:
        ...

    def filter(
        self, *criterion: _ColumnExpressionArgument[bool]
    ) -> Union[Self, FunctionFilter[_T]]:
        """Produce a FILTER clause against this function.

        Used against aggregate and window functions,
        for database backends that support the "FILTER" clause.

        The expression::

            func.count(1).filter(True)

        is shorthand for::

            from sqlalchemy import funcfilter
            funcfilter(func.count(1), True)

        .. seealso::

            :ref:`tutorial_functions_within_group` -
            in the :ref:`unified_tutorial`

            :class:`.FunctionFilter`

            :func:`.funcfilter`


        """
        if not criterion:
            return self
        return FunctionFilter(self, *criterion)

    def as_comparison(
        self, left_index: int, right_index: int
    ) -> FunctionAsBinary:
        """Interpret this expression as a boolean comparison between two
        values.

        This method is used for an ORM use case described at
        :ref:`relationship_custom_operator_sql_function`.

        A hypothetical SQL function "is_equal()" which compares to values
        for equality would be written in the Core expression language as::

            expr = func.is_equal("a", "b")

        If "is_equal()" above is comparing "a" and "b" for equality, the
        :meth:`.FunctionElement.as_comparison` method would be invoked as::

            expr = func.is_equal("a", "b").as_comparison(1, 2)

        Where above, the integer value "1" refers to the first argument of the
        "is_equal()" function and the integer value "2" refers to the second.

        This would create a :class:`.BinaryExpression` that is equivalent to::

            BinaryExpression("a", "b", operator=op.eq)

        However, at the SQL level it would still render as
        "is_equal('a', 'b')".

        The ORM, when it loads a related object or collection, needs to be able
        to manipulate the "left" and "right" sides of the ON clause of a JOIN
        expression. The purpose of this method is to provide a SQL function
        construct that can also supply this information to the ORM, when used
        with the :paramref:`_orm.relationship.primaryjoin` parameter. The
        return value is a containment object called :class:`.FunctionAsBinary`.

        An ORM example is as follows::

            class Venue(Base):
                __tablename__ = 'venue'
                id = Column(Integer, primary_key=True)
                name = Column(String)

                descendants = relationship(
                    "Venue",
                    primaryjoin=func.instr(
                        remote(foreign(name)), name + "/"
                    ).as_comparison(1, 2) == 1,
                    viewonly=True,
                    order_by=name
                )

        Above, the "Venue" class can load descendant "Venue" objects by
        determining if the name of the parent Venue is contained within the
        start of the hypothetical descendant value's name, e.g. "parent1" would
        match up to "parent1/child1", but not to "parent2/child1".

        Possible use cases include the "materialized path" example given above,
        as well as making use of special SQL functions such as geometric
        functions to create join conditions.

        :param left_index: the integer 1-based index of the function argument
         that serves as the "left" side of the expression.
        :param right_index: the integer 1-based index of the function argument
         that serves as the "right" side of the expression.

        .. versionadded:: 1.3

        .. seealso::

            :ref:`relationship_custom_operator_sql_function` -
            example use within the ORM

        """
        return FunctionAsBinary(self, left_index, right_index)

    @property
    def _from_objects(self) -> Any:
        return self.clauses._from_objects

    def within_group_type(
        self, within_group: WithinGroup[_S]
    ) -> Optional[TypeEngine[_S]]:
        """For types that define their return type as based on the criteria
        within a WITHIN GROUP (ORDER BY) expression, called by the
        :class:`.WithinGroup` construct.

        Returns None by default, in which case the function's normal ``.type``
        is used.

        """

        return None

    def alias(
        self, name: Optional[str] = None, joins_implicitly: bool = False
    ) -> TableValuedAlias:
        r"""Produce a :class:`_expression.Alias` construct against this
        :class:`.FunctionElement`.

        .. tip::

            The :meth:`_functions.FunctionElement.alias` method is part of the
            mechanism by which "table valued" SQL functions are created.
            However, most use cases are covered by higher level methods on
            :class:`_functions.FunctionElement` including
            :meth:`_functions.FunctionElement.table_valued`, and
            :meth:`_functions.FunctionElement.column_valued`.

        This construct wraps the function in a named alias which
        is suitable for the FROM clause, in the style accepted for example
        by PostgreSQL.  A column expression is also provided using the
        special ``.column`` attribute, which may
        be used to refer to the output of the function as a scalar value
        in the columns or where clause, for a backend such as PostgreSQL.

        For a full table-valued expression, use the
        :meth:`_functions.FunctionElement.table_valued` method first to
        establish named columns.

        e.g.:

        .. sourcecode:: pycon+sql

            >>> from sqlalchemy import func, select, column
            >>> data_view = func.unnest([1, 2, 3]).alias("data_view")
            >>> print(select(data_view.column))
            {printsql}SELECT data_view
            FROM unnest(:unnest_1) AS data_view

        The :meth:`_functions.FunctionElement.column_valued` method provides
        a shortcut for the above pattern:

        .. sourcecode:: pycon+sql

            >>> data_view = func.unnest([1, 2, 3]).column_valued("data_view")
            >>> print(select(data_view))
            {printsql}SELECT data_view
            FROM unnest(:unnest_1) AS data_view

        .. versionadded:: 1.4.0b2  Added the ``.column`` accessor

        :param name: alias name, will be rendered as ``AS <name>`` in the
         FROM clause

        :param joins_implicitly: when True, the table valued function may be
         used in the FROM clause without any explicit JOIN to other tables
         in the SQL query, and no "cartesian product" warning will be
         generated.  May be useful for SQL functions such as
         ``func.json_each()``.

         .. versionadded:: 1.4.33

        .. seealso::

            :ref:`tutorial_functions_table_valued` -
            in the :ref:`unified_tutorial`

            :meth:`_functions.FunctionElement.table_valued`

            :meth:`_functions.FunctionElement.scalar_table_valued`

            :meth:`_functions.FunctionElement.column_valued`


        """

        return TableValuedAlias._construct(
            self,
            name=name,
            table_value_type=self.type,
            joins_implicitly=joins_implicitly,
        )

    def select(self) -> Select[Tuple[_T]]:
        """Produce a :func:`_expression.select` construct
        against this :class:`.FunctionElement`.

        This is shorthand for::

            s = select(function_element)

        """
        s: Select[Any] = Select(self)
        if self._execution_options:
            s = s.execution_options(**self._execution_options)
        return s

    def _bind_param(
        self,
        operator: OperatorType,
        obj: Any,
        type_: Optional[TypeEngine[_T]] = None,
        expanding: bool = False,
        **kw: Any,
    ) -> BindParameter[_T]:
        return BindParameter(
            None,
            obj,
            _compared_to_operator=operator,
            _compared_to_type=self.type,
            unique=True,
            type_=type_,
            expanding=expanding,
            **kw,
        )

    def self_group(self, against: Optional[OperatorType] = None) -> ClauseElement:  # type: ignore[override]  # noqa E501
        # for the moment, we are parenthesizing all array-returning
        # expressions against getitem.  This may need to be made
        # more portable if in the future we support other DBs
        # besides postgresql.
        if against is operators.getitem and isinstance(
            self.type, sqltypes.ARRAY
        ):
            return Grouping(self)
        else:
            return super().self_group(against=against)

    @property
    def entity_namespace(self) -> _EntityNamespace:
        """overrides FromClause.entity_namespace as functions are generally
        column expressions and not FromClauses.

        """
        # ideally functions would not be fromclauses but we failed to make
        # this adjustment in 1.4
        return _entity_namespace(self.clause_expr)


class FunctionAsBinary(BinaryExpression[Any]):
    _traverse_internals = [
        ("sql_function", InternalTraversal.dp_clauseelement),
        ("left_index", InternalTraversal.dp_plain_obj),
        ("right_index", InternalTraversal.dp_plain_obj),
        ("modifiers", InternalTraversal.dp_plain_dict),
    ]

    sql_function: FunctionElement[Any]
    left_index: int
    right_index: int

    def _gen_cache_key(self, anon_map: Any, bindparams: Any) -> Any:
        return ColumnElement._gen_cache_key(self, anon_map, bindparams)

    def __init__(
        self, fn: FunctionElement[Any], left_index: int, right_index: int
    ):
        self.sql_function = fn
        self.left_index = left_index
        self.right_index = right_index

        self.operator = operators.function_as_comparison_op
        self.type = sqltypes.BOOLEANTYPE
        self.negate = None
        self._is_implicitly_boolean = True
        self.modifiers = {}

    @property
    def left_expr(self) -> ColumnElement[Any]:
        return self.sql_function.clauses.clauses[self.left_index - 1]

    @left_expr.setter
    def left_expr(self, value: ColumnElement[Any]) -> None:
        self.sql_function.clauses.clauses[self.left_index - 1] = value

    @property
    def right_expr(self) -> ColumnElement[Any]:
        return self.sql_function.clauses.clauses[self.right_index - 1]

    @right_expr.setter
    def right_expr(self, value: ColumnElement[Any]) -> None:
        self.sql_function.clauses.clauses[self.right_index - 1] = value

    if not TYPE_CHECKING:
        # mypy can't accommodate @property to replace an instance
        # variable

        left = left_expr
        right = right_expr


class ScalarFunctionColumn(NamedColumn[_T]):
    __visit_name__ = "scalar_function_column"

    _traverse_internals = [
        ("name", InternalTraversal.dp_anon_name),
        ("type", InternalTraversal.dp_type),
        ("fn", InternalTraversal.dp_clauseelement),
    ]

    is_literal = False
    table = None

    def __init__(
        self,
        fn: FunctionElement[_T],
        name: str,
        type_: Optional[_TypeEngineArgument[_T]] = None,
    ):
        self.fn = fn
        self.name = name

        # if type is None, we get NULLTYPE, which is our _T.  But I don't
        # know how to get the overloads to express that correctly
        self.type = type_api.to_instance(type_)  # type: ignore


class _FunctionGenerator:
    """Generate SQL function expressions.

    :data:`.func` is a special object instance which generates SQL
    functions based on name-based attributes, e.g.:

    .. sourcecode:: pycon+sql

        >>> print(func.count(1))
        {printsql}count(:param_1)

    The returned object is an instance of :class:`.Function`, and  is a
    column-oriented SQL element like any other, and is used in that way:

    .. sourcecode:: pycon+sql

        >>> print(select(func.count(table.c.id)))
        {printsql}SELECT count(sometable.id) FROM sometable

    Any name can be given to :data:`.func`. If the function name is unknown to
    SQLAlchemy, it will be rendered exactly as is. For common SQL functions
    which SQLAlchemy is aware of, the name may be interpreted as a *generic
    function* which will be compiled appropriately to the target database:

    .. sourcecode:: pycon+sql

        >>> print(func.current_timestamp())
        {printsql}CURRENT_TIMESTAMP

    To call functions which are present in dot-separated packages,
    specify them in the same manner:

    .. sourcecode:: pycon+sql

        >>> print(func.stats.yield_curve(5, 10))
        {printsql}stats.yield_curve(:yield_curve_1, :yield_curve_2)

    SQLAlchemy can be made aware of the return type of functions to enable
    type-specific lexical and result-based behavior. For example, to ensure
    that a string-based function returns a Unicode value and is similarly
    treated as a string in expressions, specify
    :class:`~sqlalchemy.types.Unicode` as the type:

    .. sourcecode:: pycon+sql

        >>> print(func.my_string(u'hi', type_=Unicode) + ' ' +
        ...       func.my_string(u'there', type_=Unicode))
        {printsql}my_string(:my_string_1) || :my_string_2 || my_string(:my_string_3)

    The object returned by a :data:`.func` call is usually an instance of
    :class:`.Function`.
    This object meets the "column" interface, including comparison and labeling
    functions.  The object can also be passed the :meth:`~.Connectable.execute`
    method of a :class:`_engine.Connection` or :class:`_engine.Engine`,
    where it will be
    wrapped inside of a SELECT statement first::

        print(connection.execute(func.current_timestamp()).scalar())

    In a few exception cases, the :data:`.func` accessor
    will redirect a name to a built-in expression such as :func:`.cast`
    or :func:`.extract`, as these names have well-known meaning
    but are not exactly the same as "functions" from a SQLAlchemy
    perspective.

    Functions which are interpreted as "generic" functions know how to
    calculate their return type automatically. For a listing of known generic
    functions, see :ref:`generic_functions`.

    .. note::

        The :data:`.func` construct has only limited support for calling
        standalone "stored procedures", especially those with special
        parameterization concerns.

        See the section :ref:`stored_procedures` for details on how to use
        the DBAPI-level ``callproc()`` method for fully traditional stored
        procedures.

    .. seealso::

        :ref:`tutorial_functions` - in the :ref:`unified_tutorial`

        :class:`.Function`

    """  # noqa

    def __init__(self, **opts: Any):
        self.__names: List[str] = []
        self.opts = opts

    def __getattr__(self, name: str) -> _FunctionGenerator:
        # passthru __ attributes; fixes pydoc
        if name.startswith("__"):
            try:
                return self.__dict__[name]  # type: ignore
            except KeyError:
                raise AttributeError(name)

        elif name.endswith("_"):
            name = name[0:-1]
        f = _FunctionGenerator(**self.opts)
        f.__names = list(self.__names) + [name]
        return f

    @overload
    def __call__(
        self, *c: Any, type_: _TypeEngineArgument[_T], **kwargs: Any
    ) -> Function[_T]:
        ...

    @overload
    def __call__(self, *c: Any, **kwargs: Any) -> Function[Any]:
        ...

    def __call__(self, *c: Any, **kwargs: Any) -> Function[Any]:
        o = self.opts.copy()
        o.update(kwargs)

        tokens = len(self.__names)

        if tokens == 2:
            package, fname = self.__names
        elif tokens == 1:
            package, fname = "_default", self.__names[0]
        else:
            package = None

        if package is not None:
            func = _registry[package].get(fname.lower())
            if func is not None:
                return func(*c, **o)

        return Function(
            self.__names[-1], packagenames=tuple(self.__names[0:-1]), *c, **o
        )

    if TYPE_CHECKING:
        # START GENERATED FUNCTION ACCESSORS

        # code within this block is **programmatically,
        # statically generated** by tools/generate_sql_functions.py

        @property
        def aggregate_strings(self) -> Type[aggregate_strings]:
            ...

        @property
        def ansifunction(self) -> Type[AnsiFunction[Any]]:
            ...

        @property
        def array_agg(self) -> Type[array_agg[Any]]:
            ...

        @property
        def cast(self) -> Type[Cast[Any]]:
            ...

        @property
        def char_length(self) -> Type[char_length]:
            ...

        # set ColumnElement[_T] as a separate overload, to appease mypy
        # which seems to not want to accept _T from _ColumnExpressionArgument.
        # this is even if all non-generic types are removed from it, so
        # reasons remain unclear for why this does not work

        @overload
        def coalesce(
            self,
            col: ColumnElement[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> coalesce[_T]:
            ...

        @overload
        def coalesce(
            self,
            col: _ColumnExpressionArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> coalesce[_T]:
            ...

        @overload
        def coalesce(
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> coalesce[_T]:
            ...

        def coalesce(
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> coalesce[_T]:
            ...

        @property
        def concat(self) -> Type[concat]:
            ...

        @property
        def count(self) -> Type[count]:
            ...

        @property
        def cube(self) -> Type[cube[Any]]:
            ...

        @property
        def cume_dist(self) -> Type[cume_dist]:
            ...

        @property
        def current_date(self) -> Type[current_date]:
            ...

        @property
        def current_time(self) -> Type[current_time]:
            ...

        @property
        def current_timestamp(self) -> Type[current_timestamp]:
            ...

        @property
        def current_user(self) -> Type[current_user]:
            ...

        @property
        def dense_rank(self) -> Type[dense_rank]:
            ...

        @property
        def extract(self) -> Type[Extract]:
            ...

        @property
        def grouping_sets(self) -> Type[grouping_sets[Any]]:
            ...

        @property
        def localtime(self) -> Type[localtime]:
            ...

        @property
        def localtimestamp(self) -> Type[localtimestamp]:
            ...

        # set ColumnElement[_T] as a separate overload, to appease mypy
        # which seems to not want to accept _T from _ColumnExpressionArgument.
        # this is even if all non-generic types are removed from it, so
        # reasons remain unclear for why this does not work

        @overload
        def max(  # noqa: A001
            self,
            col: ColumnElement[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> max[_T]:
            ...

        @overload
        def max(  # noqa: A001
            self,
            col: _ColumnExpressionArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> max[_T]:
            ...

        @overload
        def max(  # noqa: A001
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> max[_T]:
            ...

        def max(  # noqa: A001
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> max[_T]:
            ...

        # set ColumnElement[_T] as a separate overload, to appease mypy
        # which seems to not want to accept _T from _ColumnExpressionArgument.
        # this is even if all non-generic types are removed from it, so
        # reasons remain unclear for why this does not work

        @overload
        def min(  # noqa: A001
            self,
            col: ColumnElement[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> min[_T]:
            ...

        @overload
        def min(  # noqa: A001
            self,
            col: _ColumnExpressionArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> min[_T]:
            ...

        @overload
        def min(  # noqa: A001
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> min[_T]:
            ...

        def min(  # noqa: A001
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> min[_T]:
            ...

        @property
        def mode(self) -> Type[mode[Any]]:
            ...

        @property
        def next_value(self) -> Type[next_value]:
            ...

        @property
        def now(self) -> Type[now]:
            ...

        @property
        def orderedsetagg(self) -> Type[OrderedSetAgg[Any]]:
            ...

        @property
        def percent_rank(self) -> Type[percent_rank]:
            ...

        @property
        def percentile_cont(self) -> Type[percentile_cont[Any]]:
            ...

        @property
        def percentile_disc(self) -> Type[percentile_disc[Any]]:
            ...

        @property
        def random(self) -> Type[random]:
            ...

        @property
        def rank(self) -> Type[rank]:
            ...

        @property
        def rollup(self) -> Type[rollup[Any]]:
            ...

        @property
        def session_user(self) -> Type[session_user]:
            ...

        # set ColumnElement[_T] as a separate overload, to appease mypy
        # which seems to not want to accept _T from _ColumnExpressionArgument.
        # this is even if all non-generic types are removed from it, so
        # reasons remain unclear for why this does not work

        @overload
        def sum(  # noqa: A001
            self,
            col: ColumnElement[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> sum[_T]:
            ...

        @overload
        def sum(  # noqa: A001
            self,
            col: _ColumnExpressionArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> sum[_T]:
            ...

        @overload
        def sum(  # noqa: A001
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> sum[_T]:
            ...

        def sum(  # noqa: A001
            self,
            col: _ColumnExpressionOrLiteralArgument[_T],
            *args: _ColumnExpressionOrLiteralArgument[Any],
            **kwargs: Any,
        ) -> sum[_T]:
            ...

        @property
        def sysdate(self) -> Type[sysdate]:
            ...

        @property
        def user(self) -> Type[user]:
            ...

        # END GENERATED FUNCTION ACCESSORS


func = _FunctionGenerator()
func.__doc__ = _FunctionGenerator.__doc__

modifier = _FunctionGenerator(group=False)


class Function(FunctionElement[_T]):
    r"""Describe a named SQL function.

    The :class:`.Function` object is typically generated from the
    :data:`.func` generation object.


    :param \*clauses: list of column expressions that form the arguments
     of the SQL function call.

    :param type\_: optional :class:`.TypeEngine` datatype object that will be
     used as the return value of the column expression generated by this
     function call.

    :param packagenames: a string which indicates package prefix names
     to be prepended to the function name when the SQL is generated.
     The :data:`.func` generator creates these when it is called using
     dotted format, e.g.::

        func.mypackage.some_function(col1, col2)

    .. seealso::

        :ref:`tutorial_functions` - in the :ref:`unified_tutorial`

        :data:`.func` - namespace which produces registered or ad-hoc
        :class:`.Function` instances.

        :class:`.GenericFunction` - allows creation of registered function
        types.

    """

    __visit_name__ = "function"

    _traverse_internals = FunctionElement._traverse_internals + [
        ("packagenames", InternalTraversal.dp_plain_obj),
        ("name", InternalTraversal.dp_string),
        ("type", InternalTraversal.dp_type),
    ]

    name: str

    identifier: str

    type: TypeEngine[_T]
    """A :class:`_types.TypeEngine` object which refers to the SQL return
    type represented by this SQL function.

    This datatype may be configured when generating a
    :class:`_functions.Function` object by passing the
    :paramref:`_functions.Function.type_` parameter, e.g.::

        >>> select(func.lower("some VALUE", type_=String))

    The small number of built-in classes of :class:`_functions.Function` come
    with a built-in datatype that's appropriate to the class of function and
    its arguments. For functions that aren't known, the type defaults to the
    "null type".

    """

    @overload
    def __init__(
        self,
        name: str,
        *clauses: _ColumnExpressionOrLiteralArgument[_T],
        type_: None = ...,
        packagenames: Optional[Tuple[str, ...]] = ...,
    ):
        ...

    @overload
    def __init__(
        self,
        name: str,
        *clauses: _ColumnExpressionOrLiteralArgument[Any],
        type_: _TypeEngineArgument[_T] = ...,
        packagenames: Optional[Tuple[str, ...]] = ...,
    ):
        ...

    def __init__(
        self,
        name: str,
        *clauses: _ColumnExpressionOrLiteralArgument[Any],
        type_: Optional[_TypeEngineArgument[_T]] = None,
        packagenames: Optional[Tuple[str, ...]] = None,
    ):
        """Construct a :class:`.Function`.

        The :data:`.func` construct is normally used to construct
        new :class:`.Function` instances.

        """
        self.packagenames = packagenames or ()
        self.name = name

        # if type is None, we get NULLTYPE, which is our _T.  But I don't
        # know how to get the overloads to express that correctly
        self.type = type_api.to_instance(type_)  # type: ignore

        FunctionElement.__init__(self, *clauses)

    def _bind_param(
        self,
        operator: OperatorType,
        obj: Any,
        type_: Optional[TypeEngine[_T]] = None,
        expanding: bool = False,
        **kw: Any,
    ) -> BindParameter[_T]:
        return BindParameter(
            self.name,
            obj,
            _compared_to_operator=operator,
            _compared_to_type=self.type,
            type_=type_,
            unique=True,
            expanding=expanding,
            **kw,
        )


class GenericFunction(Function[_T]):
    """Define a 'generic' function.

    A generic function is a pre-established :class:`.Function`
    class that is instantiated automatically when called
    by name from the :data:`.func` attribute.    Note that
    calling any name from :data:`.func` has the effect that
    a new :class:`.Function` instance is created automatically,
    given that name.  The primary use case for defining
    a :class:`.GenericFunction` class is so that a function
    of a particular name may be given a fixed return type.
    It can also include custom argument parsing schemes as well
    as additional methods.

    Subclasses of :class:`.GenericFunction` are automatically
    registered under the name of the class.  For
    example, a user-defined function ``as_utc()`` would
    be available immediately::

        from sqlalchemy.sql.functions import GenericFunction
        from sqlalchemy.types import DateTime

        class as_utc(GenericFunction):
            type = DateTime()
            inherit_cache = True

        print(select(func.as_utc()))

    User-defined generic functions can be organized into
    packages by specifying the "package" attribute when defining
    :class:`.GenericFunction`.   Third party libraries
    containing many functions may want to use this in order
    to avoid name conflicts with other systems.   For example,
    if our ``as_utc()`` function were part of a package
    "time"::

        class as_utc(GenericFunction):
            type = DateTime()
            package = "time"
            inherit_cache = True

    The above function would be available from :data:`.func`
    using the package name ``time``::

        print(select(func.time.as_utc()))

    A final option is to allow the function to be accessed
    from one name in :data:`.func` but to render as a different name.
    The ``identifier`` attribute will override the name used to
    access the function as loaded from :data:`.func`, but will retain
    the usage of ``name`` as the rendered name::

        class GeoBuffer(GenericFunction):
            type = Geometry()
            package = "geo"
            name = "ST_Buffer"
            identifier = "buffer"
            inherit_cache = True

    The above function will render as follows:

    .. sourcecode:: pycon+sql

        >>> print(func.geo.buffer())
        {printsql}ST_Buffer()

    The name will be rendered as is, however without quoting unless the name
    contains special characters that require quoting.  To force quoting
    on or off for the name, use the :class:`.sqlalchemy.sql.quoted_name`
    construct::

        from sqlalchemy.sql import quoted_name

        class GeoBuffer(GenericFunction):
            type = Geometry()
            package = "geo"
            name = quoted_name("ST_Buffer", True)
            identifier = "buffer"
            inherit_cache = True

    The above function will render as:

    .. sourcecode:: pycon+sql

        >>> print(func.geo.buffer())
        {printsql}"ST_Buffer"()

    Type parameters for this class as a
    `generic type <https://peps.python.org/pep-0484/#generics>`_ can be passed
    and should match the type seen in a :class:`_engine.Result`. For example::

        class as_utc(GenericFunction[datetime.datetime]):
            type = DateTime()
            inherit_cache = True

    The above indicates that the following expression returns a ``datetime``
    object::

        connection.scalar(select(func.as_utc()))

    .. versionadded:: 1.3.13  The :class:`.quoted_name` construct is now
       recognized for quoting when used with the "name" attribute of the
       object, so that quoting can be forced on or off for the function
       name.


    """

    coerce_arguments = True
    inherit_cache = True

    _register: bool

    name = "GenericFunction"

    def __init_subclass__(cls) -> None:
        if annotation.Annotated not in cls.__mro__:
            cls._register_generic_function(cls.__name__, cls.__dict__)
        super().__init_subclass__()

    @classmethod
    def _register_generic_function(
        cls, clsname: str, clsdict: Mapping[str, Any]
    ) -> None:
        cls.name = name = clsdict.get("name", clsname)
        cls.identifier = identifier = clsdict.get("identifier", name)
        package = clsdict.get("package", "_default")
        # legacy
        if "__return_type__" in clsdict:
            cls.type = clsdict["__return_type__"]

        # Check _register attribute status
        cls._register = getattr(cls, "_register", True)

        # Register the function if required
        if cls._register:
            register_function(identifier, cls, package)
        else:
            # Set _register to True to register child classes by default
            cls._register = True

    def __init__(
        self, *args: _ColumnExpressionOrLiteralArgument[Any], **kwargs: Any
    ):
        parsed_args = kwargs.pop("_parsed_args", None)
        if parsed_args is None:
            parsed_args = [
                coercions.expect(
                    roles.ExpressionElementRole,
                    c,
                    name=self.name,
                    apply_propagate_attrs=self,
                )
                for c in args
            ]
        self._has_args = self._has_args or bool(parsed_args)
        self.packagenames = ()

        self.clause_expr = Grouping(
            ClauseList(
                operator=operators.comma_op, group_contents=True, *parsed_args
            )
        )

        self.type = type_api.to_instance(  # type: ignore
            kwargs.pop("type_", None) or getattr(self, "type", None)
        )


register_function("cast", Cast)  # type: ignore
register_function("extract", Extract)  # type: ignore


class next_value(GenericFunction[int]):
    """Represent the 'next value', given a :class:`.Sequence`
    as its single argument.

    Compiles into the appropriate function on each backend,
    or will raise NotImplementedError if used on a backend
    that does not provide support for sequences.

    """

    type = sqltypes.Integer()
    name = "next_value"

    _traverse_internals = [
        ("sequence", InternalTraversal.dp_named_ddl_element)
    ]

    def __init__(self, seq: schema.Sequence, **kw: Any):
        assert isinstance(
            seq, schema.Sequence
        ), "next_value() accepts a Sequence object as input."
        self.sequence = seq
        self.type = sqltypes.to_instance(  # type: ignore
            seq.data_type or getattr(self, "type", None)
        )

    def compare(self, other: Any, **kw: Any) -> bool:
        return (
            isinstance(other, next_value)
            and self.sequence.name == other.sequence.name
        )

    @property
    def _from_objects(self) -> Any:
        return []


class AnsiFunction(GenericFunction[_T]):
    """Define a function in "ansi" format, which doesn't render parenthesis."""

    inherit_cache = True

    def __init__(self, *args: _ColumnExpressionArgument[Any], **kwargs: Any):
        GenericFunction.__init__(self, *args, **kwargs)


class ReturnTypeFromArgs(GenericFunction[_T]):
    """Define a function whose return type is the same as its arguments."""

    inherit_cache = True

    # set ColumnElement[_T] as a separate overload, to appease mypy which seems
    # to not want to accept _T from _ColumnExpressionArgument.  this is even if
    # all non-generic types are removed from it, so reasons remain unclear for
    # why this does not work

    @overload
    def __init__(
        self,
        col: ColumnElement[_T],
        *args: _ColumnExpressionOrLiteralArgument[Any],
        **kwargs: Any,
    ):
        ...

    @overload
    def __init__(
        self,
        col: _ColumnExpressionArgument[_T],
        *args: _ColumnExpressionOrLiteralArgument[Any],
        **kwargs: Any,
    ):
        ...

    @overload
    def __init__(
        self,
        col: _ColumnExpressionOrLiteralArgument[_T],
        *args: _ColumnExpressionOrLiteralArgument[Any],
        **kwargs: Any,
    ):
        ...

    def __init__(
        self, *args: _ColumnExpressionOrLiteralArgument[Any], **kwargs: Any
    ):
        fn_args: Sequence[ColumnElement[Any]] = [
            coercions.expect(
                roles.ExpressionElementRole,
                c,
                name=self.name,
                apply_propagate_attrs=self,
            )
            for c in args
        ]
        kwargs.setdefault("type_", _type_from_args(fn_args))
        kwargs["_parsed_args"] = fn_args
        super().__init__(*fn_args, **kwargs)


class coalesce(ReturnTypeFromArgs[_T]):
    _has_args = True
    inherit_cache = True


class max(ReturnTypeFromArgs[_T]):  # noqa:  A001
    """The SQL MAX() aggregate function."""

    inherit_cache = True


class min(ReturnTypeFromArgs[_T]):  # noqa: A001
    """The SQL MIN() aggregate function."""

    inherit_cache = True


class sum(ReturnTypeFromArgs[_T]):  # noqa: A001
    """The SQL SUM() aggregate function."""

    inherit_cache = True


class now(GenericFunction[datetime.datetime]):
    """The SQL now() datetime function.

    SQLAlchemy dialects will usually render this particular function
    in a backend-specific way, such as rendering it as ``CURRENT_TIMESTAMP``.

    """

    type = sqltypes.DateTime()
    inherit_cache = True


class concat(GenericFunction[str]):
    """The SQL CONCAT() function, which concatenates strings.

    E.g.:

    .. sourcecode:: pycon+sql

        >>> print(select(func.concat('a', 'b')))
        {printsql}SELECT concat(:concat_2, :concat_3) AS concat_1

    String concatenation in SQLAlchemy is more commonly available using the
    Python ``+`` operator with string datatypes, which will render a
    backend-specific concatenation operator, such as :

    .. sourcecode:: pycon+sql

        >>> print(select(literal("a") + "b"))
        {printsql}SELECT :param_1 || :param_2 AS anon_1


    """

    type = sqltypes.String()
    inherit_cache = True


class char_length(GenericFunction[int]):
    """The CHAR_LENGTH() SQL function."""

    type = sqltypes.Integer()
    inherit_cache = True

    def __init__(self, arg: _ColumnExpressionArgument[str], **kw: Any):
        # slight hack to limit to just one positional argument
        # not sure why this one function has this special treatment
        super().__init__(arg, **kw)


class random(GenericFunction[float]):
    """The RANDOM() SQL function."""

    _has_args = True
    inherit_cache = True


class count(GenericFunction[int]):
    r"""The ANSI COUNT aggregate function.  With no arguments,
    emits COUNT \*.

    E.g.::

        from sqlalchemy import func
        from sqlalchemy import select
        from sqlalchemy import table, column

        my_table = table('some_table', column('id'))

        stmt = select(func.count()).select_from(my_table)

    Executing ``stmt`` would emit::

        SELECT count(*) AS count_1
        FROM some_table


    """
    type = sqltypes.Integer()
    inherit_cache = True

    def __init__(
        self,
        expression: Optional[_ColumnExpressionArgument[Any]] = None,
        **kwargs: Any,
    ):
        if expression is None:
            expression = literal_column("*")
        super().__init__(expression, **kwargs)


class current_date(AnsiFunction[datetime.date]):
    """The CURRENT_DATE() SQL function."""

    type = sqltypes.Date()
    inherit_cache = True


class current_time(AnsiFunction[datetime.time]):
    """The CURRENT_TIME() SQL function."""

    type = sqltypes.Time()
    inherit_cache = True


class current_timestamp(AnsiFunction[datetime.datetime]):
    """The CURRENT_TIMESTAMP() SQL function."""

    type = sqltypes.DateTime()
    inherit_cache = True


class current_user(AnsiFunction[str]):
    """The CURRENT_USER() SQL function."""

    type = sqltypes.String()
    inherit_cache = True


class localtime(AnsiFunction[datetime.datetime]):
    """The localtime() SQL function."""

    type = sqltypes.DateTime()
    inherit_cache = True


class localtimestamp(AnsiFunction[datetime.datetime]):
    """The localtimestamp() SQL function."""

    type = sqltypes.DateTime()
    inherit_cache = True


class session_user(AnsiFunction[str]):
    """The SESSION_USER() SQL function."""

    type = sqltypes.String()
    inherit_cache = True


class sysdate(AnsiFunction[datetime.datetime]):
    """The SYSDATE() SQL function."""

    type = sqltypes.DateTime()
    inherit_cache = True


class user(AnsiFunction[str]):
    """The USER() SQL function."""

    type = sqltypes.String()
    inherit_cache = True


class array_agg(GenericFunction[_T]):
    """Support for the ARRAY_AGG function.

    The ``func.array_agg(expr)`` construct returns an expression of
    type :class:`_types.ARRAY`.

    e.g.::

        stmt = select(func.array_agg(table.c.values)[2:5])

    .. seealso::

        :func:`_postgresql.array_agg` - PostgreSQL-specific version that
        returns :class:`_postgresql.ARRAY`, which has PG-specific operators
        added.

    """

    inherit_cache = True

    def __init__(self, *args: _ColumnExpressionArgument[Any], **kwargs: Any):
        fn_args: Sequence[ColumnElement[Any]] = [
            coercions.expect(
                roles.ExpressionElementRole, c, apply_propagate_attrs=self
            )
            for c in args
        ]

        default_array_type = kwargs.pop("_default_array_type", sqltypes.ARRAY)
        if "type_" not in kwargs:
            type_from_args = _type_from_args(fn_args)
            if isinstance(type_from_args, sqltypes.ARRAY):
                kwargs["type_"] = type_from_args
            else:
                kwargs["type_"] = default_array_type(
                    type_from_args, dimensions=1
                )
        kwargs["_parsed_args"] = fn_args
        super().__init__(*fn_args, **kwargs)


class OrderedSetAgg(GenericFunction[_T]):
    """Define a function where the return type is based on the sort
    expression type as defined by the expression passed to the
    :meth:`.FunctionElement.within_group` method."""

    array_for_multi_clause = False
    inherit_cache = True

    def within_group_type(
        self, within_group: WithinGroup[Any]
    ) -> TypeEngine[Any]:
        func_clauses = cast(ClauseList, self.clause_expr.element)
        order_by: Sequence[ColumnElement[Any]] = sqlutil.unwrap_order_by(
            within_group.order_by
        )
        if self.array_for_multi_clause and len(func_clauses.clauses) > 1:
            return sqltypes.ARRAY(order_by[0].type)
        else:
            return order_by[0].type


class mode(OrderedSetAgg[_T]):
    """Implement the ``mode`` ordered-set aggregate function.

    This function must be used with the :meth:`.FunctionElement.within_group`
    modifier to supply a sort expression to operate upon.

    The return type of this function is the same as the sort expression.

    """

    inherit_cache = True


class percentile_cont(OrderedSetAgg[_T]):
    """Implement the ``percentile_cont`` ordered-set aggregate function.

    This function must be used with the :meth:`.FunctionElement.within_group`
    modifier to supply a sort expression to operate upon.

    The return type of this function is the same as the sort expression,
    or if the arguments are an array, an :class:`_types.ARRAY` of the sort
    expression's type.

    """

    array_for_multi_clause = True
    inherit_cache = True


class percentile_disc(OrderedSetAgg[_T]):
    """Implement the ``percentile_disc`` ordered-set aggregate function.

    This function must be used with the :meth:`.FunctionElement.within_group`
    modifier to supply a sort expression to operate upon.

    The return type of this function is the same as the sort expression,
    or if the arguments are an array, an :class:`_types.ARRAY` of the sort
    expression's type.

    """

    array_for_multi_clause = True
    inherit_cache = True


class rank(GenericFunction[int]):
    """Implement the ``rank`` hypothetical-set aggregate function.

    This function must be used with the :meth:`.FunctionElement.within_group`
    modifier to supply a sort expression to operate upon.

    The return type of this function is :class:`.Integer`.

    """

    type = sqltypes.Integer()
    inherit_cache = True


class dense_rank(GenericFunction[int]):
    """Implement the ``dense_rank`` hypothetical-set aggregate function.

    This function must be used with the :meth:`.FunctionElement.within_group`
    modifier to supply a sort expression to operate upon.

    The return type of this function is :class:`.Integer`.

    """

    type = sqltypes.Integer()
    inherit_cache = True


class percent_rank(GenericFunction[decimal.Decimal]):
    """Implement the ``percent_rank`` hypothetical-set aggregate function.

    This function must be used with the :meth:`.FunctionElement.within_group`
    modifier to supply a sort expression to operate upon.

    The return type of this function is :class:`.Numeric`.

    """

    type: sqltypes.Numeric[decimal.Decimal] = sqltypes.Numeric()
    inherit_cache = True


class cume_dist(GenericFunction[decimal.Decimal]):
    """Implement the ``cume_dist`` hypothetical-set aggregate function.

    This function must be used with the :meth:`.FunctionElement.within_group`
    modifier to supply a sort expression to operate upon.

    The return type of this function is :class:`.Numeric`.

    """

    type: sqltypes.Numeric[decimal.Decimal] = sqltypes.Numeric()
    inherit_cache = True


class cube(GenericFunction[_T]):
    r"""Implement the ``CUBE`` grouping operation.

    This function is used as part of the GROUP BY of a statement,
    e.g. :meth:`_expression.Select.group_by`::

        stmt = select(
            func.sum(table.c.value), table.c.col_1, table.c.col_2
        ).group_by(func.cube(table.c.col_1, table.c.col_2))

    .. versionadded:: 1.2

    """
    _has_args = True
    inherit_cache = True


class rollup(GenericFunction[_T]):
    r"""Implement the ``ROLLUP`` grouping operation.

    This function is used as part of the GROUP BY of a statement,
    e.g. :meth:`_expression.Select.group_by`::

        stmt = select(
            func.sum(table.c.value), table.c.col_1, table.c.col_2
        ).group_by(func.rollup(table.c.col_1, table.c.col_2))

    .. versionadded:: 1.2

    """
    _has_args = True
    inherit_cache = True


class grouping_sets(GenericFunction[_T]):
    r"""Implement the ``GROUPING SETS`` grouping operation.

    This function is used as part of the GROUP BY of a statement,
    e.g. :meth:`_expression.Select.group_by`::

        stmt = select(
            func.sum(table.c.value), table.c.col_1, table.c.col_2
        ).group_by(func.grouping_sets(table.c.col_1, table.c.col_2))

    In order to group by multiple sets, use the :func:`.tuple_` construct::

        from sqlalchemy import tuple_

        stmt = select(
            func.sum(table.c.value),
            table.c.col_1, table.c.col_2,
            table.c.col_3
        ).group_by(
            func.grouping_sets(
                tuple_(table.c.col_1, table.c.col_2),
                tuple_(table.c.value, table.c.col_3),
            )
        )


    .. versionadded:: 1.2

    """
    _has_args = True
    inherit_cache = True


class aggregate_strings(GenericFunction[str]):
    """Implement a generic string aggregation function.

    This function will concatenate non-null values into a string and
    separate the values by a delimiter.

    This function is compiled on a per-backend basis, into functions
    such as ``group_concat()``, ``string_agg()``, or ``LISTAGG()``.

    e.g. Example usage with delimiter '.'::

        stmt = select(func.aggregate_strings(table.c.str_col, "."))

    The return type of this function is :class:`.String`.

    .. versionadded: 2.0.21

    """

    type = sqltypes.String()
    _has_args = True
    inherit_cache = True

    def __init__(self, clause: _ColumnExpressionArgument[Any], separator: str):
        super().__init__(clause, separator)
