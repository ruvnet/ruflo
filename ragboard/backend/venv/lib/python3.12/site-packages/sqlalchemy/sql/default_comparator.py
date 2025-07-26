# sql/default_comparator.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Default implementation of SQL comparison operations.
"""

from __future__ import annotations

import typing
from typing import Any
from typing import Callable
from typing import Dict
from typing import NoReturn
from typing import Optional
from typing import Tuple
from typing import Type
from typing import Union

from . import coercions
from . import operators
from . import roles
from . import type_api
from .elements import and_
from .elements import BinaryExpression
from .elements import ClauseElement
from .elements import CollationClause
from .elements import CollectionAggregate
from .elements import ExpressionClauseList
from .elements import False_
from .elements import Null
from .elements import OperatorExpression
from .elements import or_
from .elements import True_
from .elements import UnaryExpression
from .operators import OperatorType
from .. import exc
from .. import util

_T = typing.TypeVar("_T", bound=Any)

if typing.TYPE_CHECKING:
    from .elements import ColumnElement
    from .operators import custom_op
    from .type_api import TypeEngine


def _boolean_compare(
    expr: ColumnElement[Any],
    op: OperatorType,
    obj: Any,
    *,
    negate_op: Optional[OperatorType] = None,
    reverse: bool = False,
    _python_is_types: Tuple[Type[Any], ...] = (type(None), bool),
    result_type: Optional[TypeEngine[bool]] = None,
    **kwargs: Any,
) -> OperatorExpression[bool]:
    if result_type is None:
        result_type = type_api.BOOLEANTYPE

    if isinstance(obj, _python_is_types + (Null, True_, False_)):
        # allow x ==/!= True/False to be treated as a literal.
        # this comes out to "== / != true/false" or "1/0" if those
        # constants aren't supported and works on all platforms
        if op in (operators.eq, operators.ne) and isinstance(
            obj, (bool, True_, False_)
        ):
            return OperatorExpression._construct_for_op(
                expr,
                coercions.expect(roles.ConstExprRole, obj),
                op,
                type_=result_type,
                negate=negate_op,
                modifiers=kwargs,
            )
        elif op in (
            operators.is_distinct_from,
            operators.is_not_distinct_from,
        ):
            return OperatorExpression._construct_for_op(
                expr,
                coercions.expect(roles.ConstExprRole, obj),
                op,
                type_=result_type,
                negate=negate_op,
                modifiers=kwargs,
            )
        elif expr._is_collection_aggregate:
            obj = coercions.expect(
                roles.ConstExprRole, element=obj, operator=op, expr=expr
            )
        else:
            # all other None uses IS, IS NOT
            if op in (operators.eq, operators.is_):
                return OperatorExpression._construct_for_op(
                    expr,
                    coercions.expect(roles.ConstExprRole, obj),
                    operators.is_,
                    negate=operators.is_not,
                    type_=result_type,
                )
            elif op in (operators.ne, operators.is_not):
                return OperatorExpression._construct_for_op(
                    expr,
                    coercions.expect(roles.ConstExprRole, obj),
                    operators.is_not,
                    negate=operators.is_,
                    type_=result_type,
                )
            else:
                raise exc.ArgumentError(
                    "Only '=', '!=', 'is_()', 'is_not()', "
                    "'is_distinct_from()', 'is_not_distinct_from()' "
                    "operators can be used with None/True/False"
                )
    else:
        obj = coercions.expect(
            roles.BinaryElementRole, element=obj, operator=op, expr=expr
        )

    if reverse:
        return OperatorExpression._construct_for_op(
            obj,
            expr,
            op,
            type_=result_type,
            negate=negate_op,
            modifiers=kwargs,
        )
    else:
        return OperatorExpression._construct_for_op(
            expr,
            obj,
            op,
            type_=result_type,
            negate=negate_op,
            modifiers=kwargs,
        )


def _custom_op_operate(
    expr: ColumnElement[Any],
    op: custom_op[Any],
    obj: Any,
    reverse: bool = False,
    result_type: Optional[TypeEngine[Any]] = None,
    **kw: Any,
) -> ColumnElement[Any]:
    if result_type is None:
        if op.return_type:
            result_type = op.return_type
        elif op.is_comparison:
            result_type = type_api.BOOLEANTYPE

    return _binary_operate(
        expr, op, obj, reverse=reverse, result_type=result_type, **kw
    )


def _binary_operate(
    expr: ColumnElement[Any],
    op: OperatorType,
    obj: roles.BinaryElementRole[Any],
    *,
    reverse: bool = False,
    result_type: Optional[TypeEngine[_T]] = None,
    **kw: Any,
) -> OperatorExpression[_T]:
    coerced_obj = coercions.expect(
        roles.BinaryElementRole, obj, expr=expr, operator=op
    )

    if reverse:
        left, right = coerced_obj, expr
    else:
        left, right = expr, coerced_obj

    if result_type is None:
        op, result_type = left.comparator._adapt_expression(
            op, right.comparator
        )

    return OperatorExpression._construct_for_op(
        left, right, op, type_=result_type, modifiers=kw
    )


def _conjunction_operate(
    expr: ColumnElement[Any], op: OperatorType, other: Any, **kw: Any
) -> ColumnElement[Any]:
    if op is operators.and_:
        return and_(expr, other)
    elif op is operators.or_:
        return or_(expr, other)
    else:
        raise NotImplementedError()


def _scalar(
    expr: ColumnElement[Any],
    op: OperatorType,
    fn: Callable[[ColumnElement[Any]], ColumnElement[Any]],
    **kw: Any,
) -> ColumnElement[Any]:
    return fn(expr)


def _in_impl(
    expr: ColumnElement[Any],
    op: OperatorType,
    seq_or_selectable: ClauseElement,
    negate_op: OperatorType,
    **kw: Any,
) -> ColumnElement[Any]:
    seq_or_selectable = coercions.expect(
        roles.InElementRole, seq_or_selectable, expr=expr, operator=op
    )
    if "in_ops" in seq_or_selectable._annotations:
        op, negate_op = seq_or_selectable._annotations["in_ops"]

    return _boolean_compare(
        expr, op, seq_or_selectable, negate_op=negate_op, **kw
    )


def _getitem_impl(
    expr: ColumnElement[Any], op: OperatorType, other: Any, **kw: Any
) -> ColumnElement[Any]:
    if (
        isinstance(expr.type, type_api.INDEXABLE)
        or isinstance(expr.type, type_api.TypeDecorator)
        and isinstance(expr.type.impl_instance, type_api.INDEXABLE)
    ):
        other = coercions.expect(
            roles.BinaryElementRole, other, expr=expr, operator=op
        )
        return _binary_operate(expr, op, other, **kw)
    else:
        _unsupported_impl(expr, op, other, **kw)


def _unsupported_impl(
    expr: ColumnElement[Any], op: OperatorType, *arg: Any, **kw: Any
) -> NoReturn:
    raise NotImplementedError(
        "Operator '%s' is not supported on " "this expression" % op.__name__
    )


def _inv_impl(
    expr: ColumnElement[Any], op: OperatorType, **kw: Any
) -> ColumnElement[Any]:
    """See :meth:`.ColumnOperators.__inv__`."""

    # undocumented element currently used by the ORM for
    # relationship.contains()
    if hasattr(expr, "negation_clause"):
        return expr.negation_clause
    else:
        return expr._negate()


def _neg_impl(
    expr: ColumnElement[Any], op: OperatorType, **kw: Any
) -> ColumnElement[Any]:
    """See :meth:`.ColumnOperators.__neg__`."""
    return UnaryExpression(expr, operator=operators.neg, type_=expr.type)


def _bitwise_not_impl(
    expr: ColumnElement[Any], op: OperatorType, **kw: Any
) -> ColumnElement[Any]:
    """See :meth:`.ColumnOperators.bitwise_not`."""

    return UnaryExpression(
        expr, operator=operators.bitwise_not_op, type_=expr.type
    )


def _match_impl(
    expr: ColumnElement[Any], op: OperatorType, other: Any, **kw: Any
) -> ColumnElement[Any]:
    """See :meth:`.ColumnOperators.match`."""

    return _boolean_compare(
        expr,
        operators.match_op,
        coercions.expect(
            roles.BinaryElementRole,
            other,
            expr=expr,
            operator=operators.match_op,
        ),
        result_type=type_api.MATCHTYPE,
        negate_op=operators.not_match_op
        if op is operators.match_op
        else operators.match_op,
        **kw,
    )


def _distinct_impl(
    expr: ColumnElement[Any], op: OperatorType, **kw: Any
) -> ColumnElement[Any]:
    """See :meth:`.ColumnOperators.distinct`."""
    return UnaryExpression(
        expr, operator=operators.distinct_op, type_=expr.type
    )


def _between_impl(
    expr: ColumnElement[Any],
    op: OperatorType,
    cleft: Any,
    cright: Any,
    **kw: Any,
) -> ColumnElement[Any]:
    """See :meth:`.ColumnOperators.between`."""
    return BinaryExpression(
        expr,
        ExpressionClauseList._construct_for_list(
            operators.and_,
            type_api.NULLTYPE,
            coercions.expect(
                roles.BinaryElementRole,
                cleft,
                expr=expr,
                operator=operators.and_,
            ),
            coercions.expect(
                roles.BinaryElementRole,
                cright,
                expr=expr,
                operator=operators.and_,
            ),
            group=False,
        ),
        op,
        negate=operators.not_between_op
        if op is operators.between_op
        else operators.between_op,
        modifiers=kw,
    )


def _collate_impl(
    expr: ColumnElement[str], op: OperatorType, collation: str, **kw: Any
) -> ColumnElement[str]:
    return CollationClause._create_collation_expression(expr, collation)


def _regexp_match_impl(
    expr: ColumnElement[str],
    op: OperatorType,
    pattern: Any,
    flags: Optional[str],
    **kw: Any,
) -> ColumnElement[Any]:
    return BinaryExpression(
        expr,
        coercions.expect(
            roles.BinaryElementRole,
            pattern,
            expr=expr,
            operator=operators.comma_op,
        ),
        op,
        negate=operators.not_regexp_match_op,
        modifiers={"flags": flags},
    )


def _regexp_replace_impl(
    expr: ColumnElement[Any],
    op: OperatorType,
    pattern: Any,
    replacement: Any,
    flags: Optional[str],
    **kw: Any,
) -> ColumnElement[Any]:
    return BinaryExpression(
        expr,
        ExpressionClauseList._construct_for_list(
            operators.comma_op,
            type_api.NULLTYPE,
            coercions.expect(
                roles.BinaryElementRole,
                pattern,
                expr=expr,
                operator=operators.comma_op,
            ),
            coercions.expect(
                roles.BinaryElementRole,
                replacement,
                expr=expr,
                operator=operators.comma_op,
            ),
            group=False,
        ),
        op,
        modifiers={"flags": flags},
    )


# a mapping of operators with the method they use, along with
# additional keyword arguments to be passed
operator_lookup: Dict[
    str,
    Tuple[
        Callable[..., ColumnElement[Any]],
        util.immutabledict[
            str, Union[OperatorType, Callable[..., ColumnElement[Any]]]
        ],
    ],
] = {
    "and_": (_conjunction_operate, util.EMPTY_DICT),
    "or_": (_conjunction_operate, util.EMPTY_DICT),
    "inv": (_inv_impl, util.EMPTY_DICT),
    "add": (_binary_operate, util.EMPTY_DICT),
    "mul": (_binary_operate, util.EMPTY_DICT),
    "sub": (_binary_operate, util.EMPTY_DICT),
    "div": (_binary_operate, util.EMPTY_DICT),
    "mod": (_binary_operate, util.EMPTY_DICT),
    "bitwise_xor_op": (_binary_operate, util.EMPTY_DICT),
    "bitwise_or_op": (_binary_operate, util.EMPTY_DICT),
    "bitwise_and_op": (_binary_operate, util.EMPTY_DICT),
    "bitwise_not_op": (_bitwise_not_impl, util.EMPTY_DICT),
    "bitwise_lshift_op": (_binary_operate, util.EMPTY_DICT),
    "bitwise_rshift_op": (_binary_operate, util.EMPTY_DICT),
    "truediv": (_binary_operate, util.EMPTY_DICT),
    "floordiv": (_binary_operate, util.EMPTY_DICT),
    "custom_op": (_custom_op_operate, util.EMPTY_DICT),
    "json_path_getitem_op": (_binary_operate, util.EMPTY_DICT),
    "json_getitem_op": (_binary_operate, util.EMPTY_DICT),
    "concat_op": (_binary_operate, util.EMPTY_DICT),
    "any_op": (
        _scalar,
        util.immutabledict({"fn": CollectionAggregate._create_any}),
    ),
    "all_op": (
        _scalar,
        util.immutabledict({"fn": CollectionAggregate._create_all}),
    ),
    "lt": (_boolean_compare, util.immutabledict({"negate_op": operators.ge})),
    "le": (_boolean_compare, util.immutabledict({"negate_op": operators.gt})),
    "ne": (_boolean_compare, util.immutabledict({"negate_op": operators.eq})),
    "gt": (_boolean_compare, util.immutabledict({"negate_op": operators.le})),
    "ge": (_boolean_compare, util.immutabledict({"negate_op": operators.lt})),
    "eq": (_boolean_compare, util.immutabledict({"negate_op": operators.ne})),
    "is_distinct_from": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.is_not_distinct_from}),
    ),
    "is_not_distinct_from": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.is_distinct_from}),
    ),
    "like_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_like_op}),
    ),
    "ilike_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_ilike_op}),
    ),
    "not_like_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.like_op}),
    ),
    "not_ilike_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.ilike_op}),
    ),
    "contains_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_contains_op}),
    ),
    "icontains_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_icontains_op}),
    ),
    "startswith_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_startswith_op}),
    ),
    "istartswith_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_istartswith_op}),
    ),
    "endswith_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_endswith_op}),
    ),
    "iendswith_op": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.not_iendswith_op}),
    ),
    "desc_op": (
        _scalar,
        util.immutabledict({"fn": UnaryExpression._create_desc}),
    ),
    "asc_op": (
        _scalar,
        util.immutabledict({"fn": UnaryExpression._create_asc}),
    ),
    "nulls_first_op": (
        _scalar,
        util.immutabledict({"fn": UnaryExpression._create_nulls_first}),
    ),
    "nulls_last_op": (
        _scalar,
        util.immutabledict({"fn": UnaryExpression._create_nulls_last}),
    ),
    "in_op": (
        _in_impl,
        util.immutabledict({"negate_op": operators.not_in_op}),
    ),
    "not_in_op": (
        _in_impl,
        util.immutabledict({"negate_op": operators.in_op}),
    ),
    "is_": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.is_}),
    ),
    "is_not": (
        _boolean_compare,
        util.immutabledict({"negate_op": operators.is_not}),
    ),
    "collate": (_collate_impl, util.EMPTY_DICT),
    "match_op": (_match_impl, util.EMPTY_DICT),
    "not_match_op": (_match_impl, util.EMPTY_DICT),
    "distinct_op": (_distinct_impl, util.EMPTY_DICT),
    "between_op": (_between_impl, util.EMPTY_DICT),
    "not_between_op": (_between_impl, util.EMPTY_DICT),
    "neg": (_neg_impl, util.EMPTY_DICT),
    "getitem": (_getitem_impl, util.EMPTY_DICT),
    "lshift": (_unsupported_impl, util.EMPTY_DICT),
    "rshift": (_unsupported_impl, util.EMPTY_DICT),
    "contains": (_unsupported_impl, util.EMPTY_DICT),
    "regexp_match_op": (_regexp_match_impl, util.EMPTY_DICT),
    "not_regexp_match_op": (_regexp_match_impl, util.EMPTY_DICT),
    "regexp_replace_op": (_regexp_replace_impl, util.EMPTY_DICT),
}
