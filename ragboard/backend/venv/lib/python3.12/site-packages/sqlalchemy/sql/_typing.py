# sql/_typing.py
# Copyright (C) 2022-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

import operator
from typing import Any
from typing import Callable
from typing import Dict
from typing import Generic
from typing import Iterable
from typing import Mapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import roles
from .. import exc
from .. import util
from ..inspection import Inspectable
from ..util.typing import Literal
from ..util.typing import Protocol
from ..util.typing import TypeAlias

if TYPE_CHECKING:
    from datetime import date
    from datetime import datetime
    from datetime import time
    from datetime import timedelta
    from decimal import Decimal
    from uuid import UUID

    from .base import Executable
    from .compiler import Compiled
    from .compiler import DDLCompiler
    from .compiler import SQLCompiler
    from .dml import UpdateBase
    from .dml import ValuesBase
    from .elements import ClauseElement
    from .elements import ColumnElement
    from .elements import KeyedColumnElement
    from .elements import quoted_name
    from .elements import SQLCoreOperations
    from .elements import TextClause
    from .lambdas import LambdaElement
    from .roles import FromClauseRole
    from .schema import Column
    from .selectable import Alias
    from .selectable import CTE
    from .selectable import FromClause
    from .selectable import Join
    from .selectable import NamedFromClause
    from .selectable import ReturnsRows
    from .selectable import Select
    from .selectable import Selectable
    from .selectable import SelectBase
    from .selectable import Subquery
    from .selectable import TableClause
    from .sqltypes import TableValueType
    from .sqltypes import TupleType
    from .type_api import TypeEngine
    from ..util.typing import TypeGuard

_T = TypeVar("_T", bound=Any)
_T_co = TypeVar("_T_co", bound=Any, covariant=True)


_CE = TypeVar("_CE", bound="ColumnElement[Any]")

_CLE = TypeVar("_CLE", bound="ClauseElement")


class _HasClauseElement(Protocol, Generic[_T_co]):
    """indicates a class that has a __clause_element__() method"""

    def __clause_element__(self) -> roles.ExpressionElementRole[_T_co]:
        ...


class _CoreAdapterProto(Protocol):
    """protocol for the ClauseAdapter/ColumnAdapter.traverse() method."""

    def __call__(self, obj: _CE) -> _CE:
        ...


# match column types that are not ORM entities
_NOT_ENTITY = TypeVar(
    "_NOT_ENTITY",
    int,
    str,
    "datetime",
    "date",
    "time",
    "timedelta",
    "UUID",
    float,
    "Decimal",
)

_MAYBE_ENTITY = TypeVar(
    "_MAYBE_ENTITY",
    roles.ColumnsClauseRole,
    Literal["*", 1],
    Type[Any],
    Inspectable[_HasClauseElement[Any]],
    _HasClauseElement[Any],
)


# convention:
# XYZArgument - something that the end user is passing to a public API method
# XYZElement - the internal representation that we use for the thing.
# the coercions system is responsible for converting from XYZArgument to
# XYZElement.

_TextCoercedExpressionArgument = Union[
    str,
    "TextClause",
    "ColumnElement[_T]",
    _HasClauseElement[_T],
    roles.ExpressionElementRole[_T],
]

_ColumnsClauseArgument = Union[
    roles.TypedColumnsClauseRole[_T],
    roles.ColumnsClauseRole,
    "SQLCoreOperations[_T]",
    Literal["*", 1],
    Type[_T],
    Inspectable[_HasClauseElement[_T]],
    _HasClauseElement[_T],
]
"""open-ended SELECT columns clause argument.

Includes column expressions, tables, ORM mapped entities, a few literal values.

This type is used for lists of columns  / entities to be returned in result
sets; select(...), insert().returning(...), etc.


"""

_TypedColumnClauseArgument = Union[
    roles.TypedColumnsClauseRole[_T],
    "SQLCoreOperations[_T]",
    Type[_T],
]

_TP = TypeVar("_TP", bound=Tuple[Any, ...])

_T0 = TypeVar("_T0", bound=Any)
_T1 = TypeVar("_T1", bound=Any)
_T2 = TypeVar("_T2", bound=Any)
_T3 = TypeVar("_T3", bound=Any)
_T4 = TypeVar("_T4", bound=Any)
_T5 = TypeVar("_T5", bound=Any)
_T6 = TypeVar("_T6", bound=Any)
_T7 = TypeVar("_T7", bound=Any)
_T8 = TypeVar("_T8", bound=Any)
_T9 = TypeVar("_T9", bound=Any)


_ColumnExpressionArgument = Union[
    "ColumnElement[_T]",
    _HasClauseElement[_T],
    "SQLCoreOperations[_T]",
    roles.ExpressionElementRole[_T],
    Callable[[], "ColumnElement[_T]"],
    "LambdaElement",
]
"See docs in public alias ColumnExpressionArgument."

ColumnExpressionArgument: TypeAlias = _ColumnExpressionArgument[_T]
"""Narrower "column expression" argument.

This type is used for all the other "column" kinds of expressions that
typically represent a single SQL column expression, not a set of columns the
way a table or ORM entity does.

This includes ColumnElement, or ORM-mapped attributes that will have a
``__clause_element__()`` method, it also has the ExpressionElementRole
overall which brings in the TextClause object also.

.. versionadded:: 2.0.13

"""

_ColumnExpressionOrLiteralArgument = Union[Any, _ColumnExpressionArgument[_T]]

_ColumnExpressionOrStrLabelArgument = Union[str, _ColumnExpressionArgument[_T]]

_ByArgument = Union[
    Iterable[_ColumnExpressionOrStrLabelArgument[Any]],
    _ColumnExpressionOrStrLabelArgument[Any],
]
"""Used for keyword-based ``order_by`` and ``partition_by`` parameters."""


_InfoType = Dict[Any, Any]
"""the .info dictionary accepted and used throughout Core /ORM"""

_FromClauseArgument = Union[
    roles.FromClauseRole,
    Type[Any],
    Inspectable[_HasClauseElement[Any]],
    _HasClauseElement[Any],
]
"""A FROM clause, like we would send to select().select_from().

Also accommodates ORM entities and related constructs.

"""

_JoinTargetArgument = Union[_FromClauseArgument, roles.JoinTargetRole]
"""target for join() builds on _FromClauseArgument to include additional
join target roles such as those which come from the ORM.

"""

_OnClauseArgument = Union[_ColumnExpressionArgument[Any], roles.OnClauseRole]
"""target for an ON clause, includes additional roles such as those which
come from the ORM.

"""

_SelectStatementForCompoundArgument = Union[
    "SelectBase", roles.CompoundElementRole
]
"""SELECT statement acceptable by ``union()`` and other SQL set operations"""

_DMLColumnArgument = Union[
    str,
    _HasClauseElement[Any],
    roles.DMLColumnRole,
    "SQLCoreOperations[Any]",
]
"""A DML column expression.  This is a "key" inside of insert().values(),
update().values(), and related.

These are usually strings or SQL table columns.

There's also edge cases like JSON expression assignment, which we would want
the DMLColumnRole to be able to accommodate.

"""

_DMLKey = TypeVar("_DMLKey", bound=_DMLColumnArgument)
_DMLColumnKeyMapping = Mapping[_DMLKey, Any]


_DDLColumnArgument = Union[str, "Column[Any]", roles.DDLConstraintColumnRole]
"""DDL column.

used for :class:`.PrimaryKeyConstraint`, :class:`.UniqueConstraint`, etc.

"""

_DMLTableArgument = Union[
    "TableClause",
    "Join",
    "Alias",
    "CTE",
    Type[Any],
    Inspectable[_HasClauseElement[Any]],
    _HasClauseElement[Any],
]

_PropagateAttrsType = util.immutabledict[str, Any]

_TypeEngineArgument = Union[Type["TypeEngine[_T]"], "TypeEngine[_T]"]

_EquivalentColumnMap = Dict["ColumnElement[Any]", Set["ColumnElement[Any]"]]

_LimitOffsetType = Union[int, _ColumnExpressionArgument[int], None]

_AutoIncrementType = Union[bool, Literal["auto", "ignore_fk"]]

if TYPE_CHECKING:

    def is_sql_compiler(c: Compiled) -> TypeGuard[SQLCompiler]:
        ...

    def is_ddl_compiler(c: Compiled) -> TypeGuard[DDLCompiler]:
        ...

    def is_named_from_clause(t: FromClauseRole) -> TypeGuard[NamedFromClause]:
        ...

    def is_column_element(c: ClauseElement) -> TypeGuard[ColumnElement[Any]]:
        ...

    def is_keyed_column_element(
        c: ClauseElement,
    ) -> TypeGuard[KeyedColumnElement[Any]]:
        ...

    def is_text_clause(c: ClauseElement) -> TypeGuard[TextClause]:
        ...

    def is_from_clause(c: ClauseElement) -> TypeGuard[FromClause]:
        ...

    def is_tuple_type(t: TypeEngine[Any]) -> TypeGuard[TupleType]:
        ...

    def is_table_value_type(t: TypeEngine[Any]) -> TypeGuard[TableValueType]:
        ...

    def is_selectable(t: Any) -> TypeGuard[Selectable]:
        ...

    def is_select_base(
        t: Union[Executable, ReturnsRows]
    ) -> TypeGuard[SelectBase]:
        ...

    def is_select_statement(
        t: Union[Executable, ReturnsRows]
    ) -> TypeGuard[Select[Any]]:
        ...

    def is_table(t: FromClause) -> TypeGuard[TableClause]:
        ...

    def is_subquery(t: FromClause) -> TypeGuard[Subquery]:
        ...

    def is_dml(c: ClauseElement) -> TypeGuard[UpdateBase]:
        ...

else:
    is_sql_compiler = operator.attrgetter("is_sql")
    is_ddl_compiler = operator.attrgetter("is_ddl")
    is_named_from_clause = operator.attrgetter("named_with_column")
    is_column_element = operator.attrgetter("_is_column_element")
    is_keyed_column_element = operator.attrgetter("_is_keyed_column_element")
    is_text_clause = operator.attrgetter("_is_text_clause")
    is_from_clause = operator.attrgetter("_is_from_clause")
    is_tuple_type = operator.attrgetter("_is_tuple_type")
    is_table_value_type = operator.attrgetter("_is_table_value")
    is_selectable = operator.attrgetter("is_selectable")
    is_select_base = operator.attrgetter("_is_select_base")
    is_select_statement = operator.attrgetter("_is_select_statement")
    is_table = operator.attrgetter("_is_table")
    is_subquery = operator.attrgetter("_is_subquery")
    is_dml = operator.attrgetter("is_dml")


def has_schema_attr(t: FromClauseRole) -> TypeGuard[TableClause]:
    return hasattr(t, "schema")


def is_quoted_name(s: str) -> TypeGuard[quoted_name]:
    return hasattr(s, "quote")


def is_has_clause_element(s: object) -> TypeGuard[_HasClauseElement[Any]]:
    return hasattr(s, "__clause_element__")


def is_insert_update(c: ClauseElement) -> TypeGuard[ValuesBase]:
    return c.is_dml and (c.is_insert or c.is_update)  # type: ignore


def _no_kw() -> exc.ArgumentError:
    return exc.ArgumentError(
        "Additional keyword arguments are not accepted by this "
        "function/method.  The presence of **kw is for pep-484 typing purposes"
    )


def _unexpected_kw(methname: str, kw: Dict[str, Any]) -> NoReturn:
    k = list(kw)[0]
    raise TypeError(f"{methname} got an unexpected keyword argument '{k}'")


@overload
def Nullable(
    val: "SQLCoreOperations[_T]",
) -> "SQLCoreOperations[Optional[_T]]":
    ...


@overload
def Nullable(
    val: roles.ExpressionElementRole[_T],
) -> roles.ExpressionElementRole[Optional[_T]]:
    ...


@overload
def Nullable(val: Type[_T]) -> Type[Optional[_T]]:
    ...


def Nullable(
    val: _TypedColumnClauseArgument[_T],
) -> _TypedColumnClauseArgument[Optional[_T]]:
    """Types a column or ORM class as nullable.

    This can be used in select and other contexts to express that the value of
    a column can be null, for example due to an outer join::

        stmt1 = select(A, Nullable(B)).outerjoin(A.bs)
        stmt2 = select(A.data, Nullable(B.data)).outerjoin(A.bs)

    At runtime this method returns the input unchanged.

    .. versionadded:: 2.0.20
    """
    return val


@overload
def NotNullable(
    val: "SQLCoreOperations[Optional[_T]]",
) -> "SQLCoreOperations[_T]":
    ...


@overload
def NotNullable(
    val: roles.ExpressionElementRole[Optional[_T]],
) -> roles.ExpressionElementRole[_T]:
    ...


@overload
def NotNullable(val: Type[Optional[_T]]) -> Type[_T]:
    ...


@overload
def NotNullable(val: Optional[Type[_T]]) -> Type[_T]:
    ...


def NotNullable(
    val: Union[_TypedColumnClauseArgument[Optional[_T]], Optional[Type[_T]]],
) -> _TypedColumnClauseArgument[_T]:
    """Types a column or ORM class as not nullable.

    This can be used in select and other contexts to express that the value of
    a column cannot be null, for example due to a where condition on a
    nullable column::

        stmt = select(NotNullable(A.value)).where(A.value.is_not(None))

    At runtime this method returns the input unchanged.

    .. versionadded:: 2.0.20
    """
    return val  # type: ignore
