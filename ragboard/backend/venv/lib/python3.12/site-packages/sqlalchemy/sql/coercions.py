# sql/coercions.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

from __future__ import annotations

import collections.abc as collections_abc
import numbers
import re
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import Iterable
from typing import Iterator
from typing import List
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import operators
from . import roles
from . import visitors
from ._typing import is_from_clause
from .base import ExecutableOption
from .base import Options
from .cache_key import HasCacheKey
from .visitors import Visitable
from .. import exc
from .. import inspection
from .. import util
from ..util.typing import Literal

if typing.TYPE_CHECKING:
    # elements lambdas schema selectable are set by __init__
    from . import elements
    from . import lambdas
    from . import schema
    from . import selectable
    from ._typing import _ColumnExpressionArgument
    from ._typing import _ColumnsClauseArgument
    from ._typing import _DDLColumnArgument
    from ._typing import _DMLTableArgument
    from ._typing import _FromClauseArgument
    from .dml import _DMLTableElement
    from .elements import BindParameter
    from .elements import ClauseElement
    from .elements import ColumnClause
    from .elements import ColumnElement
    from .elements import DQLDMLClauseElement
    from .elements import NamedColumn
    from .elements import SQLCoreOperations
    from .schema import Column
    from .selectable import _ColumnsClauseElement
    from .selectable import _JoinTargetProtocol
    from .selectable import FromClause
    from .selectable import HasCTE
    from .selectable import SelectBase
    from .selectable import Subquery
    from .visitors import _TraverseCallableType

_SR = TypeVar("_SR", bound=roles.SQLRole)
_F = TypeVar("_F", bound=Callable[..., Any])
_StringOnlyR = TypeVar("_StringOnlyR", bound=roles.StringRole)
_T = TypeVar("_T", bound=Any)


def _is_literal(element):
    """Return whether or not the element is a "literal" in the context
    of a SQL expression construct.

    """

    return not isinstance(
        element,
        (Visitable, schema.SchemaEventTarget),
    ) and not hasattr(element, "__clause_element__")


def _deep_is_literal(element):
    """Return whether or not the element is a "literal" in the context
    of a SQL expression construct.

    does a deeper more esoteric check than _is_literal.   is used
    for lambda elements that have to distinguish values that would
    be bound vs. not without any context.

    """

    if isinstance(element, collections_abc.Sequence) and not isinstance(
        element, str
    ):
        for elem in element:
            if not _deep_is_literal(elem):
                return False
        else:
            return True

    return (
        not isinstance(
            element,
            (
                Visitable,
                schema.SchemaEventTarget,
                HasCacheKey,
                Options,
                util.langhelpers.symbol,
            ),
        )
        and not hasattr(element, "__clause_element__")
        and (
            not isinstance(element, type)
            or not issubclass(element, HasCacheKey)
        )
    )


def _document_text_coercion(
    paramname: str, meth_rst: str, param_rst: str
) -> Callable[[_F], _F]:
    return util.add_parameter_text(
        paramname,
        (
            ".. warning:: "
            "The %s argument to %s can be passed as a Python string argument, "
            "which will be treated "
            "as **trusted SQL text** and rendered as given.  **DO NOT PASS "
            "UNTRUSTED INPUT TO THIS PARAMETER**."
        )
        % (param_rst, meth_rst),
    )


def _expression_collection_was_a_list(
    attrname: str,
    fnname: str,
    args: Union[Sequence[_T], Sequence[Sequence[_T]]],
) -> Sequence[_T]:
    if args and isinstance(args[0], (list, set, dict)) and len(args) == 1:
        if isinstance(args[0], list):
            raise exc.ArgumentError(
                f'The "{attrname}" argument to {fnname}(), when '
                "referring to a sequence "
                "of items, is now passed as a series of positional "
                "elements, rather than as a list. "
            )
        return cast("Sequence[_T]", args[0])

    return cast("Sequence[_T]", args)


@overload
def expect(
    role: Type[roles.TruncatedLabelRole],
    element: Any,
    **kw: Any,
) -> str:
    ...


@overload
def expect(
    role: Type[roles.DMLColumnRole],
    element: Any,
    *,
    as_key: Literal[True] = ...,
    **kw: Any,
) -> str:
    ...


@overload
def expect(
    role: Type[roles.LiteralValueRole],
    element: Any,
    **kw: Any,
) -> BindParameter[Any]:
    ...


@overload
def expect(
    role: Type[roles.DDLReferredColumnRole],
    element: Any,
    **kw: Any,
) -> Column[Any]:
    ...


@overload
def expect(
    role: Type[roles.DDLConstraintColumnRole],
    element: Any,
    **kw: Any,
) -> Union[Column[Any], str]:
    ...


@overload
def expect(
    role: Type[roles.StatementOptionRole],
    element: Any,
    **kw: Any,
) -> DQLDMLClauseElement:
    ...


@overload
def expect(
    role: Type[roles.LabeledColumnExprRole[Any]],
    element: _ColumnExpressionArgument[_T],
    **kw: Any,
) -> NamedColumn[_T]:
    ...


@overload
def expect(
    role: Union[
        Type[roles.ExpressionElementRole[Any]],
        Type[roles.LimitOffsetRole],
        Type[roles.WhereHavingRole],
    ],
    element: _ColumnExpressionArgument[_T],
    **kw: Any,
) -> ColumnElement[_T]:
    ...


@overload
def expect(
    role: Union[
        Type[roles.ExpressionElementRole[Any]],
        Type[roles.LimitOffsetRole],
        Type[roles.WhereHavingRole],
        Type[roles.OnClauseRole],
        Type[roles.ColumnArgumentRole],
    ],
    element: Any,
    **kw: Any,
) -> ColumnElement[Any]:
    ...


@overload
def expect(
    role: Type[roles.DMLTableRole],
    element: _DMLTableArgument,
    **kw: Any,
) -> _DMLTableElement:
    ...


@overload
def expect(
    role: Type[roles.HasCTERole],
    element: HasCTE,
    **kw: Any,
) -> HasCTE:
    ...


@overload
def expect(
    role: Type[roles.SelectStatementRole],
    element: SelectBase,
    **kw: Any,
) -> SelectBase:
    ...


@overload
def expect(
    role: Type[roles.FromClauseRole],
    element: _FromClauseArgument,
    **kw: Any,
) -> FromClause:
    ...


@overload
def expect(
    role: Type[roles.FromClauseRole],
    element: SelectBase,
    *,
    explicit_subquery: Literal[True] = ...,
    **kw: Any,
) -> Subquery:
    ...


@overload
def expect(
    role: Type[roles.ColumnsClauseRole],
    element: _ColumnsClauseArgument[Any],
    **kw: Any,
) -> _ColumnsClauseElement:
    ...


@overload
def expect(
    role: Type[roles.JoinTargetRole],
    element: _JoinTargetProtocol,
    **kw: Any,
) -> _JoinTargetProtocol:
    ...


# catchall for not-yet-implemented overloads
@overload
def expect(
    role: Type[_SR],
    element: Any,
    **kw: Any,
) -> Any:
    ...


def expect(
    role: Type[_SR],
    element: Any,
    *,
    apply_propagate_attrs: Optional[ClauseElement] = None,
    argname: Optional[str] = None,
    post_inspect: bool = False,
    disable_inspection: bool = False,
    **kw: Any,
) -> Any:
    if (
        role.allows_lambda
        # note callable() will not invoke a __getattr__() method, whereas
        # hasattr(obj, "__call__") will. by keeping the callable() check here
        # we prevent most needless calls to hasattr()  and therefore
        # __getattr__(), which is present on ColumnElement.
        and callable(element)
        and hasattr(element, "__code__")
    ):
        return lambdas.LambdaElement(
            element,
            role,
            lambdas.LambdaOptions(**kw),
            apply_propagate_attrs=apply_propagate_attrs,
        )

    # major case is that we are given a ClauseElement already, skip more
    # elaborate logic up front if possible
    impl = _impl_lookup[role]

    original_element = element

    if not isinstance(
        element,
        (
            elements.CompilerElement,
            schema.SchemaItem,
            schema.FetchedValue,
            lambdas.PyWrapper,
        ),
    ):
        resolved = None

        if impl._resolve_literal_only:
            resolved = impl._literal_coercion(element, **kw)
        else:
            original_element = element

            is_clause_element = False

            # this is a special performance optimization for ORM
            # joins used by JoinTargetImpl that we don't go through the
            # work of creating __clause_element__() when we only need the
            # original QueryableAttribute, as the former will do clause
            # adaption and all that which is just thrown away here.
            if (
                impl._skip_clauseelement_for_target_match
                and isinstance(element, role)
                and hasattr(element, "__clause_element__")
            ):
                is_clause_element = True
            else:
                while hasattr(element, "__clause_element__"):
                    is_clause_element = True

                    if not getattr(element, "is_clause_element", False):
                        element = element.__clause_element__()
                    else:
                        break

            if not is_clause_element:
                if impl._use_inspection and not disable_inspection:
                    insp = inspection.inspect(element, raiseerr=False)
                    if insp is not None:
                        if post_inspect:
                            insp._post_inspect
                        try:
                            resolved = insp.__clause_element__()
                        except AttributeError:
                            impl._raise_for_expected(original_element, argname)

                if resolved is None:
                    resolved = impl._literal_coercion(
                        element, argname=argname, **kw
                    )
            else:
                resolved = element
    elif isinstance(element, lambdas.PyWrapper):
        resolved = element._sa__py_wrapper_literal(**kw)
    else:
        resolved = element

    if apply_propagate_attrs is not None:
        if typing.TYPE_CHECKING:
            assert isinstance(resolved, (SQLCoreOperations, ClauseElement))

        if not apply_propagate_attrs._propagate_attrs and getattr(
            resolved, "_propagate_attrs", None
        ):
            apply_propagate_attrs._propagate_attrs = resolved._propagate_attrs

    if impl._role_class in resolved.__class__.__mro__:
        if impl._post_coercion:
            resolved = impl._post_coercion(
                resolved,
                argname=argname,
                original_element=original_element,
                **kw,
            )
        return resolved
    else:
        return impl._implicit_coercions(
            original_element, resolved, argname=argname, **kw
        )


def expect_as_key(
    role: Type[roles.DMLColumnRole], element: Any, **kw: Any
) -> str:
    kw.pop("as_key", None)
    return expect(role, element, as_key=True, **kw)


def expect_col_expression_collection(
    role: Type[roles.DDLConstraintColumnRole],
    expressions: Iterable[_DDLColumnArgument],
) -> Iterator[
    Tuple[
        Union[str, Column[Any]],
        Optional[ColumnClause[Any]],
        Optional[str],
        Optional[Union[Column[Any], str]],
    ]
]:
    for expr in expressions:
        strname = None
        column = None

        resolved: Union[Column[Any], str] = expect(role, expr)
        if isinstance(resolved, str):
            assert isinstance(expr, str)
            strname = resolved = expr
        else:
            cols: List[Column[Any]] = []
            col_append: _TraverseCallableType[Column[Any]] = cols.append
            visitors.traverse(resolved, {}, {"column": col_append})
            if cols:
                column = cols[0]
        add_element = column if column is not None else strname

        yield resolved, column, strname, add_element


class RoleImpl:
    __slots__ = ("_role_class", "name", "_use_inspection")

    def _literal_coercion(self, element, **kw):
        raise NotImplementedError()

    _post_coercion: Any = None
    _resolve_literal_only = False
    _skip_clauseelement_for_target_match = False

    def __init__(self, role_class):
        self._role_class = role_class
        self.name = role_class._role_name
        self._use_inspection = issubclass(role_class, roles.UsesInspection)

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        self._raise_for_expected(element, argname, resolved)

    def _raise_for_expected(
        self,
        element: Any,
        argname: Optional[str] = None,
        resolved: Optional[Any] = None,
        advice: Optional[str] = None,
        code: Optional[str] = None,
        err: Optional[Exception] = None,
        **kw: Any,
    ) -> NoReturn:
        if resolved is not None and resolved is not element:
            got = "%r object resolved from %r object" % (resolved, element)
        else:
            got = repr(element)

        if argname:
            msg = "%s expected for argument %r; got %s." % (
                self.name,
                argname,
                got,
            )
        else:
            msg = "%s expected, got %s." % (self.name, got)

        if advice:
            msg += " " + advice

        raise exc.ArgumentError(msg, code=code) from err


class _Deannotate:
    __slots__ = ()

    def _post_coercion(self, resolved, **kw):
        from .util import _deep_deannotate

        return _deep_deannotate(resolved)


class _StringOnly:
    __slots__ = ()

    _resolve_literal_only = True


class _ReturnsStringKey(RoleImpl):
    __slots__ = ()

    def _implicit_coercions(self, element, resolved, argname=None, **kw):
        if isinstance(element, str):
            return element
        else:
            self._raise_for_expected(element, argname, resolved)

    def _literal_coercion(self, element, **kw):
        return element


class _ColumnCoercions(RoleImpl):
    __slots__ = ()

    def _warn_for_scalar_subquery_coercion(self):
        util.warn(
            "implicitly coercing SELECT object to scalar subquery; "
            "please use the .scalar_subquery() method to produce a scalar "
            "subquery.",
        )

    def _implicit_coercions(self, element, resolved, argname=None, **kw):
        original_element = element
        if not getattr(resolved, "is_clause_element", False):
            self._raise_for_expected(original_element, argname, resolved)
        elif resolved._is_select_base:
            self._warn_for_scalar_subquery_coercion()
            return resolved.scalar_subquery()
        elif resolved._is_from_clause and isinstance(
            resolved, selectable.Subquery
        ):
            self._warn_for_scalar_subquery_coercion()
            return resolved.element.scalar_subquery()
        elif self._role_class.allows_lambda and resolved._is_lambda_element:
            return resolved
        else:
            self._raise_for_expected(original_element, argname, resolved)


def _no_text_coercion(
    element: Any,
    argname: Optional[str] = None,
    exc_cls: Type[exc.SQLAlchemyError] = exc.ArgumentError,
    extra: Optional[str] = None,
    err: Optional[Exception] = None,
) -> NoReturn:
    raise exc_cls(
        "%(extra)sTextual SQL expression %(expr)r %(argname)sshould be "
        "explicitly declared as text(%(expr)r)"
        % {
            "expr": util.ellipses_string(element),
            "argname": "for argument %s" % (argname,) if argname else "",
            "extra": "%s " % extra if extra else "",
        }
    ) from err


class _NoTextCoercion(RoleImpl):
    __slots__ = ()

    def _literal_coercion(self, element, argname=None, **kw):
        if isinstance(element, str) and issubclass(
            elements.TextClause, self._role_class
        ):
            _no_text_coercion(element, argname)
        else:
            self._raise_for_expected(element, argname)


class _CoerceLiterals(RoleImpl):
    __slots__ = ()
    _coerce_consts = False
    _coerce_star = False
    _coerce_numerics = False

    def _text_coercion(self, element, argname=None):
        return _no_text_coercion(element, argname)

    def _literal_coercion(self, element, argname=None, **kw):
        if isinstance(element, str):
            if self._coerce_star and element == "*":
                return elements.ColumnClause("*", is_literal=True)
            else:
                return self._text_coercion(element, argname, **kw)

        if self._coerce_consts:
            if element is None:
                return elements.Null()
            elif element is False:
                return elements.False_()
            elif element is True:
                return elements.True_()

        if self._coerce_numerics and isinstance(element, (numbers.Number)):
            return elements.ColumnClause(str(element), is_literal=True)

        self._raise_for_expected(element, argname)


class LiteralValueImpl(RoleImpl):
    _resolve_literal_only = True

    def _implicit_coercions(
        self,
        element,
        resolved,
        argname,
        type_=None,
        literal_execute=False,
        **kw,
    ):
        if not _is_literal(resolved):
            self._raise_for_expected(
                element, resolved=resolved, argname=argname, **kw
            )

        return elements.BindParameter(
            None,
            element,
            type_=type_,
            unique=True,
            literal_execute=literal_execute,
        )

    def _literal_coercion(self, element, argname=None, type_=None, **kw):
        return element


class _SelectIsNotFrom(RoleImpl):
    __slots__ = ()

    def _raise_for_expected(
        self,
        element: Any,
        argname: Optional[str] = None,
        resolved: Optional[Any] = None,
        advice: Optional[str] = None,
        code: Optional[str] = None,
        err: Optional[Exception] = None,
        **kw: Any,
    ) -> NoReturn:
        if (
            not advice
            and isinstance(element, roles.SelectStatementRole)
            or isinstance(resolved, roles.SelectStatementRole)
        ):
            advice = (
                "To create a "
                "FROM clause from a %s object, use the .subquery() method."
                % (resolved.__class__ if resolved is not None else element,)
            )
            code = "89ve"
        else:
            code = None

        super()._raise_for_expected(
            element,
            argname=argname,
            resolved=resolved,
            advice=advice,
            code=code,
            err=err,
            **kw,
        )
        # never reached
        assert False


class HasCacheKeyImpl(RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if isinstance(element, HasCacheKey):
            return element
        else:
            self._raise_for_expected(element, argname, resolved)

    def _literal_coercion(self, element, **kw):
        return element


class ExecutableOptionImpl(RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if isinstance(element, ExecutableOption):
            return element
        else:
            self._raise_for_expected(element, argname, resolved)

    def _literal_coercion(self, element, **kw):
        return element


class ExpressionElementImpl(_ColumnCoercions, RoleImpl):
    __slots__ = ()

    def _literal_coercion(
        self, element, name=None, type_=None, argname=None, is_crud=False, **kw
    ):
        if (
            element is None
            and not is_crud
            and (type_ is None or not type_.should_evaluate_none)
        ):
            # TODO: there's no test coverage now for the
            # "should_evaluate_none" part of this, as outside of "crud" this
            # codepath is not normally used except in some special cases
            return elements.Null()
        else:
            try:
                return elements.BindParameter(
                    name, element, type_, unique=True, _is_crud=is_crud
                )
            except exc.ArgumentError as err:
                self._raise_for_expected(element, err=err)

    def _raise_for_expected(self, element, argname=None, resolved=None, **kw):
        # select uses implicit coercion with warning instead of raising
        if isinstance(element, selectable.Values):
            advice = (
                "To create a column expression from a VALUES clause, "
                "use the .scalar_values() method."
            )
        elif isinstance(element, roles.AnonymizedFromClauseRole):
            advice = (
                "To create a column expression from a FROM clause row "
                "as a whole, use the .table_valued() method."
            )
        else:
            advice = None

        return super()._raise_for_expected(
            element, argname=argname, resolved=resolved, advice=advice, **kw
        )


class BinaryElementImpl(ExpressionElementImpl, RoleImpl):
    __slots__ = ()

    def _literal_coercion(
        self, element, expr, operator, bindparam_type=None, argname=None, **kw
    ):
        try:
            return expr._bind_param(operator, element, type_=bindparam_type)
        except exc.ArgumentError as err:
            self._raise_for_expected(element, err=err)

    def _post_coercion(self, resolved, expr, bindparam_type=None, **kw):
        if resolved.type._isnull and not expr.type._isnull:
            resolved = resolved._with_binary_element_type(
                bindparam_type if bindparam_type is not None else expr.type
            )
        return resolved


class InElementImpl(RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if resolved._is_from_clause:
            if (
                isinstance(resolved, selectable.Alias)
                and resolved.element._is_select_base
            ):
                self._warn_for_implicit_coercion(resolved)
                return self._post_coercion(resolved.element, **kw)
            else:
                self._warn_for_implicit_coercion(resolved)
                return self._post_coercion(resolved.select(), **kw)
        else:
            self._raise_for_expected(element, argname, resolved)

    def _warn_for_implicit_coercion(self, elem):
        util.warn(
            "Coercing %s object into a select() for use in IN(); "
            "please pass a select() construct explicitly"
            % (elem.__class__.__name__)
        )

    def _literal_coercion(self, element, expr, operator, **kw):
        if util.is_non_string_iterable(element):
            non_literal_expressions: Dict[
                Optional[operators.ColumnOperators],
                operators.ColumnOperators,
            ] = {}
            element = list(element)
            for o in element:
                if not _is_literal(o):
                    if not isinstance(o, operators.ColumnOperators):
                        self._raise_for_expected(element, **kw)

                    else:
                        non_literal_expressions[o] = o
                elif o is None:
                    non_literal_expressions[o] = elements.Null()

            if non_literal_expressions:
                return elements.ClauseList(
                    *[
                        non_literal_expressions[o]
                        if o in non_literal_expressions
                        else expr._bind_param(operator, o)
                        for o in element
                    ]
                )
            else:
                return expr._bind_param(operator, element, expanding=True)

        else:
            self._raise_for_expected(element, **kw)

    def _post_coercion(self, element, expr, operator, **kw):
        if element._is_select_base:
            # for IN, we are doing scalar_subquery() coercion without
            # a warning
            return element.scalar_subquery()
        elif isinstance(element, elements.ClauseList):
            assert not len(element.clauses) == 0
            return element.self_group(against=operator)

        elif isinstance(element, elements.BindParameter):
            element = element._clone(maintain_key=True)
            element.expanding = True
            element.expand_op = operator

            return element
        elif isinstance(element, selectable.Values):
            return element.scalar_values()
        else:
            return element


class OnClauseImpl(_ColumnCoercions, RoleImpl):
    __slots__ = ()

    _coerce_consts = True

    def _literal_coercion(
        self, element, name=None, type_=None, argname=None, is_crud=False, **kw
    ):
        self._raise_for_expected(element)

    def _post_coercion(self, resolved, original_element=None, **kw):
        # this is a hack right now as we want to use coercion on an
        # ORM InstrumentedAttribute, but we want to return the object
        # itself if it is one, not its clause element.
        # ORM context _join and _legacy_join() would need to be improved
        # to look for annotations in a clause element form.
        if isinstance(original_element, roles.JoinTargetRole):
            return original_element
        return resolved


class WhereHavingImpl(_CoerceLiterals, _ColumnCoercions, RoleImpl):
    __slots__ = ()

    _coerce_consts = True

    def _text_coercion(self, element, argname=None):
        return _no_text_coercion(element, argname)


class StatementOptionImpl(_CoerceLiterals, RoleImpl):
    __slots__ = ()

    _coerce_consts = True

    def _text_coercion(self, element, argname=None):
        return elements.TextClause(element)


class ColumnArgumentImpl(_NoTextCoercion, RoleImpl):
    __slots__ = ()


class ColumnArgumentOrKeyImpl(_ReturnsStringKey, RoleImpl):
    __slots__ = ()


class StrAsPlainColumnImpl(_CoerceLiterals, RoleImpl):
    __slots__ = ()

    def _text_coercion(self, element, argname=None):
        return elements.ColumnClause(element)


class ByOfImpl(_CoerceLiterals, _ColumnCoercions, RoleImpl, roles.ByOfRole):
    __slots__ = ()

    _coerce_consts = True

    def _text_coercion(self, element, argname=None):
        return elements._textual_label_reference(element)


class OrderByImpl(ByOfImpl, RoleImpl):
    __slots__ = ()

    def _post_coercion(self, resolved, **kw):
        if (
            isinstance(resolved, self._role_class)
            and resolved._order_by_label_element is not None
        ):
            return elements._label_reference(resolved)
        else:
            return resolved


class GroupByImpl(ByOfImpl, RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if is_from_clause(resolved):
            return elements.ClauseList(*resolved.c)
        else:
            return resolved


class DMLColumnImpl(_ReturnsStringKey, RoleImpl):
    __slots__ = ()

    def _post_coercion(self, element, as_key=False, **kw):
        if as_key:
            return element.key
        else:
            return element


class ConstExprImpl(RoleImpl):
    __slots__ = ()

    def _literal_coercion(self, element, argname=None, **kw):
        if element is None:
            return elements.Null()
        elif element is False:
            return elements.False_()
        elif element is True:
            return elements.True_()
        else:
            self._raise_for_expected(element, argname)


class TruncatedLabelImpl(_StringOnly, RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if isinstance(element, str):
            return resolved
        else:
            self._raise_for_expected(element, argname, resolved)

    def _literal_coercion(self, element, argname=None, **kw):
        """coerce the given value to :class:`._truncated_label`.

        Existing :class:`._truncated_label` and
        :class:`._anonymous_label` objects are passed
        unchanged.
        """

        if isinstance(element, elements._truncated_label):
            return element
        else:
            return elements._truncated_label(element)


class DDLExpressionImpl(_Deannotate, _CoerceLiterals, RoleImpl):
    __slots__ = ()

    _coerce_consts = True

    def _text_coercion(self, element, argname=None):
        # see #5754 for why we can't easily deprecate this coercion.
        # essentially expressions like postgresql_where would have to be
        # text() as they come back from reflection and we don't want to
        # have text() elements wired into the inspection dictionaries.
        return elements.TextClause(element)


class DDLConstraintColumnImpl(_Deannotate, _ReturnsStringKey, RoleImpl):
    __slots__ = ()


class DDLReferredColumnImpl(DDLConstraintColumnImpl):
    __slots__ = ()


class LimitOffsetImpl(RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if resolved is None:
            return None
        else:
            self._raise_for_expected(element, argname, resolved)

    def _literal_coercion(self, element, name, type_, **kw):
        if element is None:
            return None
        else:
            value = util.asint(element)
            return selectable._OffsetLimitParam(
                name, value, type_=type_, unique=True
            )


class LabeledColumnExprImpl(ExpressionElementImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if isinstance(resolved, roles.ExpressionElementRole):
            return resolved.label(None)
        else:
            new = super()._implicit_coercions(
                element, resolved, argname=argname, **kw
            )
            if isinstance(new, roles.ExpressionElementRole):
                return new.label(None)
            else:
                self._raise_for_expected(element, argname, resolved)


class ColumnsClauseImpl(_SelectIsNotFrom, _CoerceLiterals, RoleImpl):
    __slots__ = ()

    _coerce_consts = True
    _coerce_numerics = True
    _coerce_star = True

    _guess_straight_column = re.compile(r"^\w\S*$", re.I)

    def _raise_for_expected(
        self, element, argname=None, resolved=None, advice=None, **kw
    ):
        if not advice and isinstance(element, list):
            advice = (
                f"Did you mean to say select("
                f"{', '.join(repr(e) for e in element)})?"
            )

        return super()._raise_for_expected(
            element, argname=argname, resolved=resolved, advice=advice, **kw
        )

    def _text_coercion(self, element, argname=None):
        element = str(element)

        guess_is_literal = not self._guess_straight_column.match(element)
        raise exc.ArgumentError(
            "Textual column expression %(column)r %(argname)sshould be "
            "explicitly declared with text(%(column)r), "
            "or use %(literal_column)s(%(column)r) "
            "for more specificity"
            % {
                "column": util.ellipses_string(element),
                "argname": "for argument %s" % (argname,) if argname else "",
                "literal_column": "literal_column"
                if guess_is_literal
                else "column",
            }
        )


class ReturnsRowsImpl(RoleImpl):
    __slots__ = ()


class StatementImpl(_CoerceLiterals, RoleImpl):
    __slots__ = ()

    def _post_coercion(self, resolved, original_element, argname=None, **kw):
        if resolved is not original_element and not isinstance(
            original_element, str
        ):
            # use same method as Connection uses; this will later raise
            # ObjectNotExecutableError
            try:
                original_element._execute_on_connection
            except AttributeError:
                util.warn_deprecated(
                    "Object %r should not be used directly in a SQL statement "
                    "context, such as passing to methods such as "
                    "session.execute().  This usage will be disallowed in a "
                    "future release.  "
                    "Please use Core select() / update() / delete() etc. "
                    "with Session.execute() and other statement execution "
                    "methods." % original_element,
                    "1.4",
                )

        return resolved

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if resolved._is_lambda_element:
            return resolved
        else:
            return super()._implicit_coercions(
                element, resolved, argname=argname, **kw
            )


class SelectStatementImpl(_NoTextCoercion, RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if resolved._is_text_clause:
            return resolved.columns()
        else:
            self._raise_for_expected(element, argname, resolved)


class HasCTEImpl(ReturnsRowsImpl):
    __slots__ = ()


class IsCTEImpl(RoleImpl):
    __slots__ = ()


class JoinTargetImpl(RoleImpl):
    __slots__ = ()

    _skip_clauseelement_for_target_match = True

    def _literal_coercion(self, element, argname=None, **kw):
        self._raise_for_expected(element, argname)

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        legacy: bool = False,
        **kw: Any,
    ) -> Any:
        if isinstance(element, roles.JoinTargetRole):
            # note that this codepath no longer occurs as of
            # #6550, unless JoinTargetImpl._skip_clauseelement_for_target_match
            # were set to False.
            return element
        elif legacy and resolved._is_select_base:
            util.warn_deprecated(
                "Implicit coercion of SELECT and textual SELECT "
                "constructs into FROM clauses is deprecated; please call "
                ".subquery() on any Core select or ORM Query object in "
                "order to produce a subquery object.",
                version="1.4",
            )
            # TODO: doing _implicit_subquery here causes tests to fail,
            # how was this working before?  probably that ORM
            # join logic treated it as a select and subquery would happen
            # in _ORMJoin->Join
            return resolved
        else:
            self._raise_for_expected(element, argname, resolved)


class FromClauseImpl(_SelectIsNotFrom, _NoTextCoercion, RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        explicit_subquery: bool = False,
        allow_select: bool = True,
        **kw: Any,
    ) -> Any:
        if resolved._is_select_base:
            if explicit_subquery:
                return resolved.subquery()
            elif allow_select:
                util.warn_deprecated(
                    "Implicit coercion of SELECT and textual SELECT "
                    "constructs into FROM clauses is deprecated; please call "
                    ".subquery() on any Core select or ORM Query object in "
                    "order to produce a subquery object.",
                    version="1.4",
                )
                return resolved._implicit_subquery
        elif resolved._is_text_clause:
            return resolved
        else:
            self._raise_for_expected(element, argname, resolved)

    def _post_coercion(self, element, deannotate=False, **kw):
        if deannotate:
            return element._deannotate()
        else:
            return element


class StrictFromClauseImpl(FromClauseImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        explicit_subquery: bool = False,
        allow_select: bool = False,
        **kw: Any,
    ) -> Any:
        if resolved._is_select_base and allow_select:
            util.warn_deprecated(
                "Implicit coercion of SELECT and textual SELECT constructs "
                "into FROM clauses is deprecated; please call .subquery() "
                "on any Core select or ORM Query object in order to produce a "
                "subquery object.",
                version="1.4",
            )
            return resolved._implicit_subquery
        else:
            self._raise_for_expected(element, argname, resolved)


class AnonymizedFromClauseImpl(StrictFromClauseImpl):
    __slots__ = ()

    def _post_coercion(self, element, flat=False, name=None, **kw):
        assert name is None

        return element._anonymous_fromclause(flat=flat)


class DMLTableImpl(_SelectIsNotFrom, _NoTextCoercion, RoleImpl):
    __slots__ = ()

    def _post_coercion(self, element, **kw):
        if "dml_table" in element._annotations:
            return element._annotations["dml_table"]
        else:
            return element


class DMLSelectImpl(_NoTextCoercion, RoleImpl):
    __slots__ = ()

    def _implicit_coercions(
        self,
        element: Any,
        resolved: Any,
        argname: Optional[str] = None,
        **kw: Any,
    ) -> Any:
        if resolved._is_from_clause:
            if (
                isinstance(resolved, selectable.Alias)
                and resolved.element._is_select_base
            ):
                return resolved.element
            else:
                return resolved.select()
        else:
            self._raise_for_expected(element, argname, resolved)


class CompoundElementImpl(_NoTextCoercion, RoleImpl):
    __slots__ = ()

    def _raise_for_expected(self, element, argname=None, resolved=None, **kw):
        if isinstance(element, roles.FromClauseRole):
            if element._is_subquery:
                advice = (
                    "Use the plain select() object without "
                    "calling .subquery() or .alias()."
                )
            else:
                advice = (
                    "To SELECT from any FROM clause, use the .select() method."
                )
        else:
            advice = None
        return super()._raise_for_expected(
            element, argname=argname, resolved=resolved, advice=advice, **kw
        )


_impl_lookup = {}


for name in dir(roles):
    cls = getattr(roles, name)
    if name.endswith("Role"):
        name = name.replace("Role", "Impl")
        if name in globals():
            impl = globals()[name](cls)
            _impl_lookup[cls] = impl

if not TYPE_CHECKING:
    ee_impl = _impl_lookup[roles.ExpressionElementRole]

    for py_type in (int, bool, str, float):
        _impl_lookup[roles.ExpressionElementRole[py_type]] = ee_impl
