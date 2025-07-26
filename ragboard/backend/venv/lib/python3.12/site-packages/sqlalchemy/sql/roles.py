# sql/roles.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

from typing import Any
from typing import Generic
from typing import Optional
from typing import TYPE_CHECKING
from typing import TypeVar

from .. import util
from ..util.typing import Literal

if TYPE_CHECKING:
    from ._typing import _PropagateAttrsType
    from .elements import Label
    from .selectable import _SelectIterable
    from .selectable import FromClause
    from .selectable import Subquery

_T = TypeVar("_T", bound=Any)
_T_co = TypeVar("_T_co", bound=Any, covariant=True)


class SQLRole:
    """Define a "role" within a SQL statement structure.

    Classes within SQL Core participate within SQLRole hierarchies in order
    to more accurately indicate where they may be used within SQL statements
    of all types.

    .. versionadded:: 1.4

    """

    __slots__ = ()
    allows_lambda = False
    uses_inspection = False


class UsesInspection:
    __slots__ = ()
    _post_inspect: Literal[None] = None
    uses_inspection = True


class AllowsLambdaRole:
    __slots__ = ()
    allows_lambda = True


class HasCacheKeyRole(SQLRole):
    __slots__ = ()
    _role_name = "Cacheable Core or ORM object"


class ExecutableOptionRole(SQLRole):
    __slots__ = ()
    _role_name = "ExecutionOption Core or ORM object"


class LiteralValueRole(SQLRole):
    __slots__ = ()
    _role_name = "Literal Python value"


class ColumnArgumentRole(SQLRole):
    __slots__ = ()
    _role_name = "Column expression"


class ColumnArgumentOrKeyRole(ColumnArgumentRole):
    __slots__ = ()
    _role_name = "Column expression or string key"


class StrAsPlainColumnRole(ColumnArgumentRole):
    __slots__ = ()
    _role_name = "Column expression or string key"


class ColumnListRole(SQLRole):
    """Elements suitable for forming comma separated lists of expressions."""

    __slots__ = ()


class StringRole(SQLRole):
    """mixin indicating a role that results in strings"""

    __slots__ = ()


class TruncatedLabelRole(StringRole, SQLRole):
    __slots__ = ()
    _role_name = "String SQL identifier"


class ColumnsClauseRole(AllowsLambdaRole, UsesInspection, ColumnListRole):
    __slots__ = ()
    _role_name = (
        "Column expression, FROM clause, or other columns clause element"
    )

    @property
    def _select_iterable(self) -> _SelectIterable:
        raise NotImplementedError()


class TypedColumnsClauseRole(Generic[_T_co], SQLRole):
    """element-typed form of ColumnsClauseRole"""

    __slots__ = ()


class LimitOffsetRole(SQLRole):
    __slots__ = ()
    _role_name = "LIMIT / OFFSET expression"


class ByOfRole(ColumnListRole):
    __slots__ = ()
    _role_name = "GROUP BY / OF / etc. expression"


class GroupByRole(AllowsLambdaRole, UsesInspection, ByOfRole):
    __slots__ = ()
    # note there's a special case right now where you can pass a whole
    # ORM entity to group_by() and it splits out.   we may not want to keep
    # this around

    _role_name = "GROUP BY expression"


class OrderByRole(AllowsLambdaRole, ByOfRole):
    __slots__ = ()
    _role_name = "ORDER BY expression"


class StructuralRole(SQLRole):
    __slots__ = ()


class StatementOptionRole(StructuralRole):
    __slots__ = ()
    _role_name = "statement sub-expression element"


class OnClauseRole(AllowsLambdaRole, StructuralRole):
    __slots__ = ()
    _role_name = (
        "ON clause, typically a SQL expression or "
        "ORM relationship attribute"
    )


class WhereHavingRole(OnClauseRole):
    __slots__ = ()
    _role_name = "SQL expression for WHERE/HAVING role"


class ExpressionElementRole(TypedColumnsClauseRole[_T_co]):
    # note when using generics for ExpressionElementRole,
    # the generic type needs to be in
    # sqlalchemy.sql.coercions._impl_lookup mapping also.
    # these are set up for basic types like int, bool, str, float
    # right now

    __slots__ = ()
    _role_name = "SQL expression element"

    def label(self, name: Optional[str]) -> Label[_T]:
        raise NotImplementedError()


class ConstExprRole(ExpressionElementRole[_T]):
    __slots__ = ()
    _role_name = "Constant True/False/None expression"


class LabeledColumnExprRole(ExpressionElementRole[_T]):
    __slots__ = ()


class BinaryElementRole(ExpressionElementRole[_T]):
    __slots__ = ()
    _role_name = "SQL expression element or literal value"


class InElementRole(SQLRole):
    __slots__ = ()
    _role_name = (
        "IN expression list, SELECT construct, or bound parameter object"
    )


class JoinTargetRole(AllowsLambdaRole, UsesInspection, StructuralRole):
    __slots__ = ()
    _role_name = (
        "Join target, typically a FROM expression, or ORM "
        "relationship attribute"
    )


class FromClauseRole(ColumnsClauseRole, JoinTargetRole):
    __slots__ = ()
    _role_name = "FROM expression, such as a Table or alias() object"

    _is_subquery = False

    named_with_column: bool


class StrictFromClauseRole(FromClauseRole):
    __slots__ = ()
    # does not allow text() or select() objects


class AnonymizedFromClauseRole(StrictFromClauseRole):
    __slots__ = ()

    if TYPE_CHECKING:

        def _anonymous_fromclause(
            self, *, name: Optional[str] = None, flat: bool = False
        ) -> FromClause:
            ...


class ReturnsRowsRole(SQLRole):
    __slots__ = ()
    _role_name = (
        "Row returning expression such as a SELECT, a FROM clause, or an "
        "INSERT/UPDATE/DELETE with RETURNING"
    )


class StatementRole(SQLRole):
    __slots__ = ()
    _role_name = "Executable SQL or text() construct"

    if TYPE_CHECKING:

        @util.memoized_property
        def _propagate_attrs(self) -> _PropagateAttrsType:
            ...

    else:
        _propagate_attrs = util.EMPTY_DICT


class SelectStatementRole(StatementRole, ReturnsRowsRole):
    __slots__ = ()
    _role_name = "SELECT construct or equivalent text() construct"

    def subquery(self) -> Subquery:
        raise NotImplementedError(
            "All SelectStatementRole objects should implement a "
            ".subquery() method."
        )


class HasCTERole(ReturnsRowsRole):
    __slots__ = ()


class IsCTERole(SQLRole):
    __slots__ = ()
    _role_name = "CTE object"


class CompoundElementRole(AllowsLambdaRole, SQLRole):
    """SELECT statements inside a CompoundSelect, e.g. UNION, EXTRACT, etc."""

    __slots__ = ()
    _role_name = (
        "SELECT construct for inclusion in a UNION or other set construct"
    )


# TODO: are we using this?
class DMLRole(StatementRole):
    __slots__ = ()


class DMLTableRole(FromClauseRole):
    __slots__ = ()
    _role_name = "subject table for an INSERT, UPDATE or DELETE"


class DMLColumnRole(SQLRole):
    __slots__ = ()
    _role_name = "SET/VALUES column expression or string key"


class DMLSelectRole(SQLRole):
    """A SELECT statement embedded in DML, typically INSERT from SELECT"""

    __slots__ = ()
    _role_name = "SELECT statement or equivalent textual object"


class DDLRole(StatementRole):
    __slots__ = ()


class DDLExpressionRole(StructuralRole):
    __slots__ = ()
    _role_name = "SQL expression element for DDL constraint"


class DDLConstraintColumnRole(SQLRole):
    __slots__ = ()
    _role_name = "String column name or column expression for DDL constraint"


class DDLReferredColumnRole(DDLConstraintColumnRole):
    __slots__ = ()
    _role_name = (
        "String column name or Column object for DDL foreign key constraint"
    )
