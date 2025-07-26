# sql/elements.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Core SQL expression elements, including :class:`_expression.ClauseElement`,
:class:`_expression.ColumnElement`, and derived classes.

"""

from __future__ import annotations

from decimal import Decimal
from enum import IntEnum
import itertools
import operator
import re
import typing
from typing import AbstractSet
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import FrozenSet
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Set
from typing import Tuple as typing_Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import coercions
from . import operators
from . import roles
from . import traversals
from . import type_api
from ._typing import has_schema_attr
from ._typing import is_named_from_clause
from ._typing import is_quoted_name
from ._typing import is_tuple_type
from .annotation import Annotated
from .annotation import SupportsWrappingAnnotations
from .base import _clone
from .base import _expand_cloned
from .base import _generative
from .base import _NoArg
from .base import Executable
from .base import Generative
from .base import HasMemoized
from .base import Immutable
from .base import NO_ARG
from .base import SingletonConstant
from .cache_key import MemoizedHasCacheKey
from .cache_key import NO_CACHE
from .coercions import _document_text_coercion  # noqa
from .operators import ColumnOperators
from .traversals import HasCopyInternals
from .visitors import cloned_traverse
from .visitors import ExternallyTraversible
from .visitors import InternalTraversal
from .visitors import traverse
from .visitors import Visitable
from .. import exc
from .. import inspection
from .. import util
from ..util import HasMemoized_ro_memoized_attribute
from ..util import TypingOnly
from ..util.typing import Literal
from ..util.typing import Self

if typing.TYPE_CHECKING:
    from ._typing import _ByArgument
    from ._typing import _ColumnExpressionArgument
    from ._typing import _ColumnExpressionOrStrLabelArgument
    from ._typing import _InfoType
    from ._typing import _PropagateAttrsType
    from ._typing import _TypeEngineArgument
    from .cache_key import _CacheKeyTraversalType
    from .cache_key import CacheKey
    from .compiler import Compiled
    from .compiler import SQLCompiler
    from .functions import FunctionElement
    from .operators import OperatorType
    from .schema import Column
    from .schema import DefaultGenerator
    from .schema import FetchedValue
    from .schema import ForeignKey
    from .selectable import _SelectIterable
    from .selectable import FromClause
    from .selectable import NamedFromClause
    from .selectable import TextualSelect
    from .sqltypes import TupleType
    from .type_api import TypeEngine
    from .visitors import _CloneCallableType
    from .visitors import _TraverseInternalsType
    from ..engine import Connection
    from ..engine import Dialect
    from ..engine import Engine
    from ..engine.interfaces import _CoreMultiExecuteParams
    from ..engine.interfaces import CacheStats
    from ..engine.interfaces import CompiledCacheType
    from ..engine.interfaces import CoreExecuteOptionsParameter
    from ..engine.interfaces import SchemaTranslateMapType
    from ..engine.result import Result

_NUMERIC = Union[float, Decimal]
_NUMBER = Union[float, int, Decimal]

_T = TypeVar("_T", bound="Any")
_T_co = TypeVar("_T_co", bound=Any, covariant=True)
_OPT = TypeVar("_OPT", bound="Any")
_NT = TypeVar("_NT", bound="_NUMERIC")

_NMT = TypeVar("_NMT", bound="_NUMBER")


@overload
def literal(
    value: Any,
    type_: _TypeEngineArgument[_T],
    literal_execute: bool = False,
) -> BindParameter[_T]:
    ...


@overload
def literal(
    value: _T,
    type_: None = None,
    literal_execute: bool = False,
) -> BindParameter[_T]:
    ...


@overload
def literal(
    value: Any,
    type_: Optional[_TypeEngineArgument[Any]] = None,
    literal_execute: bool = False,
) -> BindParameter[Any]:
    ...


def literal(
    value: Any,
    type_: Optional[_TypeEngineArgument[Any]] = None,
    literal_execute: bool = False,
) -> BindParameter[Any]:
    r"""Return a literal clause, bound to a bind parameter.

    Literal clauses are created automatically when non-
    :class:`_expression.ClauseElement` objects (such as strings, ints, dates,
    etc.) are
    used in a comparison operation with a :class:`_expression.ColumnElement`
    subclass,
    such as a :class:`~sqlalchemy.schema.Column` object.  Use this function
    to force the generation of a literal clause, which will be created as a
    :class:`BindParameter` with a bound value.

    :param value: the value to be bound. Can be any Python object supported by
     the underlying DB-API, or is translatable via the given type argument.

    :param type\_: an optional :class:`~sqlalchemy.types.TypeEngine` which will
     provide bind-parameter translation for this literal.

    :param literal_execute: optional bool, when True, the SQL engine will
     attempt to render the bound value directly in the SQL statement at
     execution time rather than providing as a parameter value.

     .. versionadded:: 2.0

    """
    return coercions.expect(
        roles.LiteralValueRole,
        value,
        type_=type_,
        literal_execute=literal_execute,
    )


def literal_column(
    text: str, type_: Optional[_TypeEngineArgument[_T]] = None
) -> ColumnClause[_T]:
    r"""Produce a :class:`.ColumnClause` object that has the
    :paramref:`_expression.column.is_literal` flag set to True.

    :func:`_expression.literal_column` is similar to
    :func:`_expression.column`, except that
    it is more often used as a "standalone" column expression that renders
    exactly as stated; while :func:`_expression.column`
    stores a string name that
    will be assumed to be part of a table and may be quoted as such,
    :func:`_expression.literal_column` can be that,
    or any other arbitrary column-oriented
    expression.

    :param text: the text of the expression; can be any SQL expression.
      Quoting rules will not be applied. To specify a column-name expression
      which should be subject to quoting rules, use the :func:`column`
      function.

    :param type\_: an optional :class:`~sqlalchemy.types.TypeEngine`
      object which will
      provide result-set translation and additional expression semantics for
      this column. If left as ``None`` the type will be :class:`.NullType`.

    .. seealso::

        :func:`_expression.column`

        :func:`_expression.text`

        :ref:`tutorial_select_arbitrary_text`

    """
    return ColumnClause(text, type_=type_, is_literal=True)


class CompilerElement(Visitable):
    """base class for SQL elements that can be compiled to produce a
    SQL string.

    .. versionadded:: 2.0

    """

    __slots__ = ()
    __visit_name__ = "compiler_element"

    supports_execution = False

    stringify_dialect = "default"

    @util.preload_module("sqlalchemy.engine.default")
    @util.preload_module("sqlalchemy.engine.url")
    def compile(
        self,
        bind: Optional[Union[Engine, Connection]] = None,
        dialect: Optional[Dialect] = None,
        **kw: Any,
    ) -> Compiled:
        """Compile this SQL expression.

        The return value is a :class:`~.Compiled` object.
        Calling ``str()`` or ``unicode()`` on the returned value will yield a
        string representation of the result. The
        :class:`~.Compiled` object also can return a
        dictionary of bind parameter names and values
        using the ``params`` accessor.

        :param bind: An :class:`.Connection` or :class:`.Engine` which
           can provide a :class:`.Dialect` in order to generate a
           :class:`.Compiled` object.  If the ``bind`` and
           ``dialect`` parameters are both omitted, a default SQL compiler
           is used.

        :param column_keys: Used for INSERT and UPDATE statements, a list of
            column names which should be present in the VALUES clause of the
            compiled statement. If ``None``, all columns from the target table
            object are rendered.

        :param dialect: A :class:`.Dialect` instance which can generate
            a :class:`.Compiled` object.  This argument takes precedence over
            the ``bind`` argument.

        :param compile_kwargs: optional dictionary of additional parameters
            that will be passed through to the compiler within all "visit"
            methods.  This allows any custom flag to be passed through to
            a custom compilation construct, for example.  It is also used
            for the case of passing the ``literal_binds`` flag through::

                from sqlalchemy.sql import table, column, select

                t = table('t', column('x'))

                s = select(t).where(t.c.x == 5)

                print(s.compile(compile_kwargs={"literal_binds": True}))

        .. seealso::

            :ref:`faq_sql_expression_string`

        """

        if dialect is None:
            if bind:
                dialect = bind.dialect
            elif self.stringify_dialect == "default":
                default = util.preloaded.engine_default
                dialect = default.StrCompileDialect()
            else:
                url = util.preloaded.engine_url
                dialect = url.URL.create(
                    self.stringify_dialect
                ).get_dialect()()

        return self._compiler(dialect, **kw)

    def _compiler(self, dialect: Dialect, **kw: Any) -> Compiled:
        """Return a compiler appropriate for this ClauseElement, given a
        Dialect."""

        if TYPE_CHECKING:
            assert isinstance(self, ClauseElement)
        return dialect.statement_compiler(dialect, self, **kw)

    def __str__(self) -> str:
        return str(self.compile())


@inspection._self_inspects
class ClauseElement(
    SupportsWrappingAnnotations,
    MemoizedHasCacheKey,
    HasCopyInternals,
    ExternallyTraversible,
    CompilerElement,
):
    """Base class for elements of a programmatically constructed SQL
    expression.

    """

    __visit_name__ = "clause"

    if TYPE_CHECKING:

        @util.memoized_property
        def _propagate_attrs(self) -> _PropagateAttrsType:
            """like annotations, however these propagate outwards liberally
            as SQL constructs are built, and are set up at construction time.

            """
            ...

    else:
        _propagate_attrs = util.EMPTY_DICT

    @util.ro_memoized_property
    def description(self) -> Optional[str]:
        return None

    _is_clone_of: Optional[Self] = None

    is_clause_element = True
    is_selectable = False
    is_dml = False
    _is_column_element = False
    _is_keyed_column_element = False
    _is_table = False
    _gen_static_annotations_cache_key = False
    _is_textual = False
    _is_from_clause = False
    _is_returns_rows = False
    _is_text_clause = False
    _is_from_container = False
    _is_select_container = False
    _is_select_base = False
    _is_select_statement = False
    _is_bind_parameter = False
    _is_clause_list = False
    _is_lambda_element = False
    _is_singleton_constant = False
    _is_immutable = False
    _is_star = False

    @property
    def _order_by_label_element(self) -> Optional[Label[Any]]:
        return None

    _cache_key_traversal: _CacheKeyTraversalType = None

    negation_clause: ColumnElement[bool]

    if typing.TYPE_CHECKING:

        def get_children(
            self, *, omit_attrs: typing_Tuple[str, ...] = ..., **kw: Any
        ) -> Iterable[ClauseElement]:
            ...

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return []

    def _set_propagate_attrs(self, values: Mapping[str, Any]) -> Self:
        # usually, self._propagate_attrs is empty here.  one case where it's
        # not is a subquery against ORM select, that is then pulled as a
        # property of an aliased class.   should all be good

        # assert not self._propagate_attrs

        self._propagate_attrs = util.immutabledict(values)
        return self

    def _clone(self, **kw: Any) -> Self:
        """Create a shallow copy of this ClauseElement.

        This method may be used by a generative API.  Its also used as
        part of the "deep" copy afforded by a traversal that combines
        the _copy_internals() method.

        """

        skip = self._memoized_keys
        c = self.__class__.__new__(self.__class__)

        if skip:
            # ensure this iteration remains atomic
            c.__dict__ = {
                k: v for k, v in self.__dict__.copy().items() if k not in skip
            }
        else:
            c.__dict__ = self.__dict__.copy()

        # this is a marker that helps to "equate" clauses to each other
        # when a Select returns its list of FROM clauses.  the cloning
        # process leaves around a lot of remnants of the previous clause
        # typically in the form of column expressions still attached to the
        # old table.
        cc = self._is_clone_of
        c._is_clone_of = cc if cc is not None else self
        return c

    def _negate_in_binary(self, negated_op, original_op):
        """a hook to allow the right side of a binary expression to respond
        to a negation of the binary expression.

        Used for the special case of expanding bind parameter with IN.

        """
        return self

    def _with_binary_element_type(self, type_):
        """in the context of binary expression, convert the type of this
        object to the one given.

        applies only to :class:`_expression.ColumnElement` classes.

        """
        return self

    @property
    def _constructor(self):
        """return the 'constructor' for this ClauseElement.

        This is for the purposes for creating a new object of
        this type.   Usually, its just the element's __class__.
        However, the "Annotated" version of the object overrides
        to return the class of its proxied element.

        """
        return self.__class__

    @HasMemoized.memoized_attribute
    def _cloned_set(self):
        """Return the set consisting all cloned ancestors of this
        ClauseElement.

        Includes this ClauseElement.  This accessor tends to be used for
        FromClause objects to identify 'equivalent' FROM clauses, regardless
        of transformative operations.

        """
        s = util.column_set()
        f: Optional[ClauseElement] = self

        # note this creates a cycle, asserted in test_memusage. however,
        # turning this into a plain @property adds tends of thousands of method
        # calls to Core / ORM performance tests, so the small overhead
        # introduced by the relatively small amount of short term cycles
        # produced here is preferable
        while f is not None:
            s.add(f)
            f = f._is_clone_of
        return s

    def _de_clone(self):
        while self._is_clone_of is not None:
            self = self._is_clone_of
        return self

    @property
    def entity_namespace(self):
        raise AttributeError(
            "This SQL expression has no entity namespace "
            "with which to filter from."
        )

    def __getstate__(self):
        d = self.__dict__.copy()
        d.pop("_is_clone_of", None)
        d.pop("_generate_cache_key", None)
        return d

    def _execute_on_connection(
        self,
        connection: Connection,
        distilled_params: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> Result[Any]:
        if self.supports_execution:
            if TYPE_CHECKING:
                assert isinstance(self, Executable)
            return connection._execute_clauseelement(
                self, distilled_params, execution_options
            )
        else:
            raise exc.ObjectNotExecutableError(self)

    def _execute_on_scalar(
        self,
        connection: Connection,
        distilled_params: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> Any:
        """an additional hook for subclasses to provide a different
        implementation for connection.scalar() vs. connection.execute().

        .. versionadded:: 2.0

        """
        return self._execute_on_connection(
            connection, distilled_params, execution_options
        ).scalar()

    def _get_embedded_bindparams(self) -> Sequence[BindParameter[Any]]:
        """Return the list of :class:`.BindParameter` objects embedded in the
        object.

        This accomplishes the same purpose as ``visitors.traverse()`` or
        similar would provide, however by making use of the cache key
        it takes advantage of memoization of the key to result in fewer
        net method calls, assuming the statement is also going to be
        executed.

        """

        key = self._generate_cache_key()
        if key is None:
            bindparams: List[BindParameter[Any]] = []

            traverse(self, {}, {"bindparam": bindparams.append})
            return bindparams

        else:
            return key.bindparams

    def unique_params(
        self,
        __optionaldict: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Self:
        """Return a copy with :func:`_expression.bindparam` elements
        replaced.

        Same functionality as :meth:`_expression.ClauseElement.params`,
        except adds `unique=True`
        to affected bind parameters so that multiple statements can be
        used.

        """
        return self._replace_params(True, __optionaldict, kwargs)

    def params(
        self,
        __optionaldict: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> Self:
        """Return a copy with :func:`_expression.bindparam` elements
        replaced.

        Returns a copy of this ClauseElement with
        :func:`_expression.bindparam`
        elements replaced with values taken from the given dictionary::

          >>> clause = column('x') + bindparam('foo')
          >>> print(clause.compile().params)
          {'foo':None}
          >>> print(clause.params({'foo':7}).compile().params)
          {'foo':7}

        """
        return self._replace_params(False, __optionaldict, kwargs)

    def _replace_params(
        self,
        unique: bool,
        optionaldict: Optional[Mapping[str, Any]],
        kwargs: Dict[str, Any],
    ) -> Self:
        if optionaldict:
            kwargs.update(optionaldict)

        def visit_bindparam(bind: BindParameter[Any]) -> None:
            if bind.key in kwargs:
                bind.value = kwargs[bind.key]
                bind.required = False
            if unique:
                bind._convert_to_unique()

        return cloned_traverse(
            self,
            {"maintain_key": True, "detect_subquery_cols": True},
            {"bindparam": visit_bindparam},
        )

    def compare(self, other: ClauseElement, **kw: Any) -> bool:
        r"""Compare this :class:`_expression.ClauseElement` to
        the given :class:`_expression.ClauseElement`.

        Subclasses should override the default behavior, which is a
        straight identity comparison.

        \**kw are arguments consumed by subclass ``compare()`` methods and
        may be used to modify the criteria for comparison
        (see :class:`_expression.ColumnElement`).

        """
        return traversals.compare(self, other, **kw)

    def self_group(
        self, against: Optional[OperatorType] = None
    ) -> ClauseElement:
        """Apply a 'grouping' to this :class:`_expression.ClauseElement`.

        This method is overridden by subclasses to return a "grouping"
        construct, i.e. parenthesis.   In particular it's used by "binary"
        expressions to provide a grouping around themselves when placed into a
        larger expression, as well as by :func:`_expression.select`
        constructs when placed into the FROM clause of another
        :func:`_expression.select`.  (Note that subqueries should be
        normally created using the :meth:`_expression.Select.alias` method,
        as many
        platforms require nested SELECT statements to be named).

        As expressions are composed together, the application of
        :meth:`self_group` is automatic - end-user code should never
        need to use this method directly.  Note that SQLAlchemy's
        clause constructs take operator precedence into account -
        so parenthesis might not be needed, for example, in
        an expression like ``x OR (y AND z)`` - AND takes precedence
        over OR.

        The base :meth:`self_group` method of
        :class:`_expression.ClauseElement`
        just returns self.
        """
        return self

    def _ungroup(self) -> ClauseElement:
        """Return this :class:`_expression.ClauseElement`
        without any groupings.
        """

        return self

    def _compile_w_cache(
        self,
        dialect: Dialect,
        *,
        compiled_cache: Optional[CompiledCacheType],
        column_keys: List[str],
        for_executemany: bool = False,
        schema_translate_map: Optional[SchemaTranslateMapType] = None,
        **kw: Any,
    ) -> typing_Tuple[
        Compiled, Optional[Sequence[BindParameter[Any]]], CacheStats
    ]:
        elem_cache_key: Optional[CacheKey]

        if compiled_cache is not None and dialect._supports_statement_cache:
            elem_cache_key = self._generate_cache_key()
        else:
            elem_cache_key = None

        if elem_cache_key is not None:
            if TYPE_CHECKING:
                assert compiled_cache is not None

            cache_key, extracted_params = elem_cache_key
            key = (
                dialect,
                cache_key,
                tuple(column_keys),
                bool(schema_translate_map),
                for_executemany,
            )
            compiled_sql = compiled_cache.get(key)

            if compiled_sql is None:
                cache_hit = dialect.CACHE_MISS
                compiled_sql = self._compiler(
                    dialect,
                    cache_key=elem_cache_key,
                    column_keys=column_keys,
                    for_executemany=for_executemany,
                    schema_translate_map=schema_translate_map,
                    **kw,
                )
                compiled_cache[key] = compiled_sql
            else:
                cache_hit = dialect.CACHE_HIT
        else:
            extracted_params = None
            compiled_sql = self._compiler(
                dialect,
                cache_key=elem_cache_key,
                column_keys=column_keys,
                for_executemany=for_executemany,
                schema_translate_map=schema_translate_map,
                **kw,
            )

            if not dialect._supports_statement_cache:
                cache_hit = dialect.NO_DIALECT_SUPPORT
            elif compiled_cache is None:
                cache_hit = dialect.CACHING_DISABLED
            else:
                cache_hit = dialect.NO_CACHE_KEY

        return compiled_sql, extracted_params, cache_hit

    def __invert__(self):
        # undocumented element currently used by the ORM for
        # relationship.contains()
        if hasattr(self, "negation_clause"):
            return self.negation_clause
        else:
            return self._negate()

    def _negate(self) -> ClauseElement:
        grouped = self.self_group(against=operators.inv)
        assert isinstance(grouped, ColumnElement)
        return UnaryExpression(grouped, operator=operators.inv)

    def __bool__(self):
        raise TypeError("Boolean value of this clause is not defined")

    def __repr__(self):
        friendly = self.description
        if friendly is None:
            return object.__repr__(self)
        else:
            return "<%s.%s at 0x%x; %s>" % (
                self.__module__,
                self.__class__.__name__,
                id(self),
                friendly,
            )


class DQLDMLClauseElement(ClauseElement):
    """represents a :class:`.ClauseElement` that compiles to a DQL or DML
    expression, not DDL.

    .. versionadded:: 2.0

    """

    if typing.TYPE_CHECKING:

        def _compiler(self, dialect: Dialect, **kw: Any) -> SQLCompiler:
            """Return a compiler appropriate for this ClauseElement, given a
            Dialect."""
            ...

        def compile(  # noqa: A001
            self,
            bind: Optional[Union[Engine, Connection]] = None,
            dialect: Optional[Dialect] = None,
            **kw: Any,
        ) -> SQLCompiler:
            ...


class CompilerColumnElement(
    roles.DMLColumnRole,
    roles.DDLConstraintColumnRole,
    roles.ColumnsClauseRole,
    CompilerElement,
):
    """A compiler-only column element used for ad-hoc string compilations.

    .. versionadded:: 2.0

    """

    __slots__ = ()

    _propagate_attrs = util.EMPTY_DICT
    _is_collection_aggregate = False


# SQLCoreOperations should be suiting the ExpressionElementRole
# and ColumnsClauseRole.   however the MRO issues become too elaborate
# at the moment.
class SQLCoreOperations(Generic[_T_co], ColumnOperators, TypingOnly):
    __slots__ = ()

    # annotations for comparison methods
    # these are from operators->Operators / ColumnOperators,
    # redefined with the specific types returned by ColumnElement hierarchies
    if typing.TYPE_CHECKING:

        @util.non_memoized_property
        def _propagate_attrs(self) -> _PropagateAttrsType:
            ...

        def operate(
            self, op: OperatorType, *other: Any, **kwargs: Any
        ) -> ColumnElement[Any]:
            ...

        def reverse_operate(
            self, op: OperatorType, other: Any, **kwargs: Any
        ) -> ColumnElement[Any]:
            ...

        @overload
        def op(
            self,
            opstring: str,
            precedence: int = ...,
            is_comparison: bool = ...,
            *,
            return_type: _TypeEngineArgument[_OPT],
            python_impl: Optional[Callable[..., Any]] = None,
        ) -> Callable[[Any], BinaryExpression[_OPT]]:
            ...

        @overload
        def op(
            self,
            opstring: str,
            precedence: int = ...,
            is_comparison: bool = ...,
            return_type: Optional[_TypeEngineArgument[Any]] = ...,
            python_impl: Optional[Callable[..., Any]] = ...,
        ) -> Callable[[Any], BinaryExpression[Any]]:
            ...

        def op(
            self,
            opstring: str,
            precedence: int = 0,
            is_comparison: bool = False,
            return_type: Optional[_TypeEngineArgument[Any]] = None,
            python_impl: Optional[Callable[..., Any]] = None,
        ) -> Callable[[Any], BinaryExpression[Any]]:
            ...

        def bool_op(
            self,
            opstring: str,
            precedence: int = 0,
            python_impl: Optional[Callable[..., Any]] = None,
        ) -> Callable[[Any], BinaryExpression[bool]]:
            ...

        def __and__(self, other: Any) -> BooleanClauseList:
            ...

        def __or__(self, other: Any) -> BooleanClauseList:
            ...

        def __invert__(self) -> ColumnElement[_T_co]:
            ...

        def __lt__(self, other: Any) -> ColumnElement[bool]:
            ...

        def __le__(self, other: Any) -> ColumnElement[bool]:
            ...

        # declare also that this class has an hash method otherwise
        # it may be assumed to be None by type checkers since the
        # object defines __eq__ and python sets it to None in that case:
        # https://docs.python.org/3/reference/datamodel.html#object.__hash__
        def __hash__(self) -> int:
            ...

        def __eq__(self, other: Any) -> ColumnElement[bool]:  # type: ignore[override]  # noqa: E501
            ...

        def __ne__(self, other: Any) -> ColumnElement[bool]:  # type: ignore[override]  # noqa: E501
            ...

        def is_distinct_from(self, other: Any) -> ColumnElement[bool]:
            ...

        def is_not_distinct_from(self, other: Any) -> ColumnElement[bool]:
            ...

        def __gt__(self, other: Any) -> ColumnElement[bool]:
            ...

        def __ge__(self, other: Any) -> ColumnElement[bool]:
            ...

        def __neg__(self) -> UnaryExpression[_T_co]:
            ...

        def __contains__(self, other: Any) -> ColumnElement[bool]:
            ...

        def __getitem__(self, index: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __lshift__(self: _SQO[int], other: Any) -> ColumnElement[int]:
            ...

        @overload
        def __lshift__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __lshift__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __rshift__(self: _SQO[int], other: Any) -> ColumnElement[int]:
            ...

        @overload
        def __rshift__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __rshift__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def concat(self: _SQO[str], other: Any) -> ColumnElement[str]:
            ...

        @overload
        def concat(self, other: Any) -> ColumnElement[Any]:
            ...

        def concat(self, other: Any) -> ColumnElement[Any]:
            ...

        def like(
            self, other: Any, escape: Optional[str] = None
        ) -> BinaryExpression[bool]:
            ...

        def ilike(
            self, other: Any, escape: Optional[str] = None
        ) -> BinaryExpression[bool]:
            ...

        def bitwise_xor(self, other: Any) -> BinaryExpression[Any]:
            ...

        def bitwise_or(self, other: Any) -> BinaryExpression[Any]:
            ...

        def bitwise_and(self, other: Any) -> BinaryExpression[Any]:
            ...

        def bitwise_not(self) -> UnaryExpression[_T_co]:
            ...

        def bitwise_lshift(self, other: Any) -> BinaryExpression[Any]:
            ...

        def bitwise_rshift(self, other: Any) -> BinaryExpression[Any]:
            ...

        def in_(
            self,
            other: Union[
                Iterable[Any], BindParameter[Any], roles.InElementRole
            ],
        ) -> BinaryExpression[bool]:
            ...

        def not_in(
            self,
            other: Union[
                Iterable[Any], BindParameter[Any], roles.InElementRole
            ],
        ) -> BinaryExpression[bool]:
            ...

        def notin_(
            self,
            other: Union[
                Iterable[Any], BindParameter[Any], roles.InElementRole
            ],
        ) -> BinaryExpression[bool]:
            ...

        def not_like(
            self, other: Any, escape: Optional[str] = None
        ) -> BinaryExpression[bool]:
            ...

        def notlike(
            self, other: Any, escape: Optional[str] = None
        ) -> BinaryExpression[bool]:
            ...

        def not_ilike(
            self, other: Any, escape: Optional[str] = None
        ) -> BinaryExpression[bool]:
            ...

        def notilike(
            self, other: Any, escape: Optional[str] = None
        ) -> BinaryExpression[bool]:
            ...

        def is_(self, other: Any) -> BinaryExpression[bool]:
            ...

        def is_not(self, other: Any) -> BinaryExpression[bool]:
            ...

        def isnot(self, other: Any) -> BinaryExpression[bool]:
            ...

        def startswith(
            self,
            other: Any,
            escape: Optional[str] = None,
            autoescape: bool = False,
        ) -> ColumnElement[bool]:
            ...

        def istartswith(
            self,
            other: Any,
            escape: Optional[str] = None,
            autoescape: bool = False,
        ) -> ColumnElement[bool]:
            ...

        def endswith(
            self,
            other: Any,
            escape: Optional[str] = None,
            autoescape: bool = False,
        ) -> ColumnElement[bool]:
            ...

        def iendswith(
            self,
            other: Any,
            escape: Optional[str] = None,
            autoescape: bool = False,
        ) -> ColumnElement[bool]:
            ...

        def contains(self, other: Any, **kw: Any) -> ColumnElement[bool]:
            ...

        def icontains(self, other: Any, **kw: Any) -> ColumnElement[bool]:
            ...

        def match(self, other: Any, **kwargs: Any) -> ColumnElement[bool]:
            ...

        def regexp_match(
            self, pattern: Any, flags: Optional[str] = None
        ) -> ColumnElement[bool]:
            ...

        def regexp_replace(
            self, pattern: Any, replacement: Any, flags: Optional[str] = None
        ) -> ColumnElement[str]:
            ...

        def desc(self) -> UnaryExpression[_T_co]:
            ...

        def asc(self) -> UnaryExpression[_T_co]:
            ...

        def nulls_first(self) -> UnaryExpression[_T_co]:
            ...

        def nullsfirst(self) -> UnaryExpression[_T_co]:
            ...

        def nulls_last(self) -> UnaryExpression[_T_co]:
            ...

        def nullslast(self) -> UnaryExpression[_T_co]:
            ...

        def collate(self, collation: str) -> CollationClause:
            ...

        def between(
            self, cleft: Any, cright: Any, symmetric: bool = False
        ) -> BinaryExpression[bool]:
            ...

        def distinct(self: _SQO[_T_co]) -> UnaryExpression[_T_co]:
            ...

        def any_(self) -> CollectionAggregate[Any]:
            ...

        def all_(self) -> CollectionAggregate[Any]:
            ...

        # numeric overloads.  These need more tweaking
        # in particular they all need to have a variant for Optiona[_T]
        # because Optional only applies to the data side, not the expression
        # side

        @overload
        def __add__(
            self: _SQO[_NMT],
            other: Any,
        ) -> ColumnElement[_NMT]:
            ...

        @overload
        def __add__(
            self: _SQO[str],
            other: Any,
        ) -> ColumnElement[str]:
            ...

        def __add__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __radd__(self: _SQO[_NMT], other: Any) -> ColumnElement[_NMT]:
            ...

        @overload
        def __radd__(self: _SQO[str], other: Any) -> ColumnElement[str]:
            ...

        def __radd__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __sub__(
            self: _SQO[_NMT],
            other: Any,
        ) -> ColumnElement[_NMT]:
            ...

        @overload
        def __sub__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __sub__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __rsub__(
            self: _SQO[_NMT],
            other: Any,
        ) -> ColumnElement[_NMT]:
            ...

        @overload
        def __rsub__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __rsub__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __mul__(
            self: _SQO[_NMT],
            other: Any,
        ) -> ColumnElement[_NMT]:
            ...

        @overload
        def __mul__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __mul__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __rmul__(
            self: _SQO[_NMT],
            other: Any,
        ) -> ColumnElement[_NMT]:
            ...

        @overload
        def __rmul__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __rmul__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __mod__(self: _SQO[_NMT], other: Any) -> ColumnElement[_NMT]:
            ...

        @overload
        def __mod__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __mod__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __rmod__(self: _SQO[_NMT], other: Any) -> ColumnElement[_NMT]:
            ...

        @overload
        def __rmod__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __rmod__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __truediv__(
            self: _SQO[int], other: Any
        ) -> ColumnElement[_NUMERIC]:
            ...

        @overload
        def __truediv__(self: _SQO[_NT], other: Any) -> ColumnElement[_NT]:
            ...

        @overload
        def __truediv__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __truediv__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __rtruediv__(
            self: _SQO[_NMT], other: Any
        ) -> ColumnElement[_NUMERIC]:
            ...

        @overload
        def __rtruediv__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __rtruediv__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __floordiv__(self: _SQO[_NMT], other: Any) -> ColumnElement[_NMT]:
            ...

        @overload
        def __floordiv__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __floordiv__(self, other: Any) -> ColumnElement[Any]:
            ...

        @overload
        def __rfloordiv__(self: _SQO[_NMT], other: Any) -> ColumnElement[_NMT]:
            ...

        @overload
        def __rfloordiv__(self, other: Any) -> ColumnElement[Any]:
            ...

        def __rfloordiv__(self, other: Any) -> ColumnElement[Any]:
            ...


class SQLColumnExpression(
    SQLCoreOperations[_T_co], roles.ExpressionElementRole[_T_co], TypingOnly
):
    """A type that may be used to indicate any SQL column element or object
    that acts in place of one.

    :class:`.SQLColumnExpression` is a base of
    :class:`.ColumnElement`, as well as within the bases of ORM elements
    such as :class:`.InstrumentedAttribute`, and may be used in :pep:`484`
    typing to indicate arguments or return values that should behave
    as column expressions.

    .. versionadded:: 2.0.0b4


    """

    __slots__ = ()


_SQO = SQLCoreOperations


class ColumnElement(
    roles.ColumnArgumentOrKeyRole,
    roles.StatementOptionRole,
    roles.WhereHavingRole,
    roles.BinaryElementRole[_T],
    roles.OrderByRole,
    roles.ColumnsClauseRole,
    roles.LimitOffsetRole,
    roles.DMLColumnRole,
    roles.DDLConstraintColumnRole,
    roles.DDLExpressionRole,
    SQLColumnExpression[_T],
    DQLDMLClauseElement,
):
    """Represent a column-oriented SQL expression suitable for usage in the
    "columns" clause, WHERE clause etc. of a statement.

    While the most familiar kind of :class:`_expression.ColumnElement` is the
    :class:`_schema.Column` object, :class:`_expression.ColumnElement`
    serves as the basis
    for any unit that may be present in a SQL expression, including
    the expressions themselves, SQL functions, bound parameters,
    literal expressions, keywords such as ``NULL``, etc.
    :class:`_expression.ColumnElement`
    is the ultimate base class for all such elements.

    A wide variety of SQLAlchemy Core functions work at the SQL expression
    level, and are intended to accept instances of
    :class:`_expression.ColumnElement` as
    arguments.  These functions will typically document that they accept a
    "SQL expression" as an argument.  What this means in terms of SQLAlchemy
    usually refers to an input which is either already in the form of a
    :class:`_expression.ColumnElement` object,
    or a value which can be **coerced** into
    one.  The coercion rules followed by most, but not all, SQLAlchemy Core
    functions with regards to SQL expressions are as follows:

        * a literal Python value, such as a string, integer or floating
          point value, boolean, datetime, ``Decimal`` object, or virtually
          any other Python object, will be coerced into a "literal bound
          value".  This generally means that a :func:`.bindparam` will be
          produced featuring the given value embedded into the construct; the
          resulting :class:`.BindParameter` object is an instance of
          :class:`_expression.ColumnElement`.
          The Python value will ultimately be sent
          to the DBAPI at execution time as a parameterized argument to the
          ``execute()`` or ``executemany()`` methods, after SQLAlchemy
          type-specific converters (e.g. those provided by any associated
          :class:`.TypeEngine` objects) are applied to the value.

        * any special object value, typically ORM-level constructs, which
          feature an accessor called ``__clause_element__()``.  The Core
          expression system looks for this method when an object of otherwise
          unknown type is passed to a function that is looking to coerce the
          argument into a :class:`_expression.ColumnElement` and sometimes a
          :class:`_expression.SelectBase` expression.
          It is used within the ORM to
          convert from ORM-specific objects like mapped classes and
          mapped attributes into Core expression objects.

        * The Python ``None`` value is typically interpreted as ``NULL``,
          which in SQLAlchemy Core produces an instance of :func:`.null`.

    A :class:`_expression.ColumnElement` provides the ability to generate new
    :class:`_expression.ColumnElement`
    objects using Python expressions.  This means that Python operators
    such as ``==``, ``!=`` and ``<`` are overloaded to mimic SQL operations,
    and allow the instantiation of further :class:`_expression.ColumnElement`
    instances
    which are composed from other, more fundamental
    :class:`_expression.ColumnElement`
    objects.  For example, two :class:`.ColumnClause` objects can be added
    together with the addition operator ``+`` to produce
    a :class:`.BinaryExpression`.
    Both :class:`.ColumnClause` and :class:`.BinaryExpression` are subclasses
    of :class:`_expression.ColumnElement`:

    .. sourcecode:: pycon+sql

        >>> from sqlalchemy.sql import column
        >>> column('a') + column('b')
        <sqlalchemy.sql.expression.BinaryExpression object at 0x101029dd0>
        >>> print(column('a') + column('b'))
        {printsql}a + b

    .. seealso::

        :class:`_schema.Column`

        :func:`_expression.column`

    """

    __visit_name__ = "column_element"

    primary_key: bool = False
    _is_clone_of: Optional[ColumnElement[_T]]
    _is_column_element = True
    _insert_sentinel: bool = False
    _omit_from_statements = False
    _is_collection_aggregate = False

    foreign_keys: AbstractSet[ForeignKey] = frozenset()

    @util.memoized_property
    def _proxies(self) -> List[ColumnElement[Any]]:
        return []

    @util.non_memoized_property
    def _tq_label(self) -> Optional[str]:
        """The named label that can be used to target
        this column in a result set in a "table qualified" context.

        This label is almost always the label used when
        rendering <expr> AS <label> in a SELECT statement when using
        the LABEL_STYLE_TABLENAME_PLUS_COL label style, which is what the
        legacy ORM ``Query`` object uses as well.

        For a regular Column bound to a Table, this is typically the label
        <tablename>_<columnname>.  For other constructs, different rules
        may apply, such as anonymized labels and others.

        .. versionchanged:: 1.4.21 renamed from ``._label``

        """
        return None

    key: Optional[str] = None
    """The 'key' that in some circumstances refers to this object in a
    Python namespace.

    This typically refers to the "key" of the column as present in the
    ``.c`` collection of a selectable, e.g. ``sometable.c["somekey"]`` would
    return a :class:`_schema.Column` with a ``.key`` of "somekey".

    """

    @HasMemoized.memoized_attribute
    def _tq_key_label(self) -> Optional[str]:
        """A label-based version of 'key' that in some circumstances refers
        to this object in a Python namespace.


        _tq_key_label comes into play when a select() statement is constructed
        with apply_labels(); in this case, all Column objects in the ``.c``
        collection are rendered as <tablename>_<columnname> in SQL; this is
        essentially the value of ._label. But to locate those columns in the
        ``.c`` collection, the name is along the lines of <tablename>_<key>;
        that's the typical value of .key_label.

        .. versionchanged:: 1.4.21 renamed from ``._key_label``

        """
        return self._proxy_key

    @property
    def _key_label(self) -> Optional[str]:
        """legacy; renamed to _tq_key_label"""
        return self._tq_key_label

    @property
    def _label(self) -> Optional[str]:
        """legacy; renamed to _tq_label"""
        return self._tq_label

    @property
    def _non_anon_label(self) -> Optional[str]:
        """the 'name' that naturally applies this element when rendered in
        SQL.

        Concretely, this is the "name" of a column or a label in a
        SELECT statement; ``<columnname>`` and ``<labelname>`` below::

            SELECT <columnmame> FROM table

            SELECT column AS <labelname> FROM table

        Above, the two names noted will be what's present in the DBAPI
        ``cursor.description`` as the names.

        If this attribute returns ``None``, it means that the SQL element as
        written does not have a 100% fully predictable "name" that would appear
        in the ``cursor.description``. Examples include SQL functions, CAST
        functions, etc. While such things do return names in
        ``cursor.description``, they are only predictable on a
        database-specific basis; e.g. an expression like ``MAX(table.col)`` may
        appear as the string ``max`` on one database (like PostgreSQL) or may
        appear as the whole expression ``max(table.col)`` on SQLite.

        The default implementation looks for a ``.name`` attribute on the
        object, as has been the precedent established in SQLAlchemy for many
        years.  An exception is made on the ``FunctionElement`` subclass
        so that the return value is always ``None``.

        .. versionadded:: 1.4.21



        """
        return getattr(self, "name", None)

    _render_label_in_columns_clause = True
    """A flag used by select._columns_plus_names that helps to determine
    we are actually going to render in terms of "SELECT <col> AS <label>".
    This flag can be returned as False for some Column objects that want
    to be rendered as simple "SELECT <col>"; typically columns that don't have
    any parent table and are named the same as what the label would be
    in any case.

    """

    _allow_label_resolve = True
    """A flag that can be flipped to prevent a column from being resolvable
    by string label name.

    The joined eager loader strategy in the ORM uses this, for example.

    """

    _is_implicitly_boolean = False

    _alt_names: Sequence[str] = ()

    @overload
    def self_group(
        self: ColumnElement[_T], against: Optional[OperatorType] = None
    ) -> ColumnElement[_T]:
        ...

    @overload
    def self_group(
        self: ColumnElement[Any], against: Optional[OperatorType] = None
    ) -> ColumnElement[Any]:
        ...

    def self_group(
        self, against: Optional[OperatorType] = None
    ) -> ColumnElement[Any]:
        if (
            against in (operators.and_, operators.or_, operators._asbool)
            and self.type._type_affinity is type_api.BOOLEANTYPE._type_affinity
        ):
            return AsBoolean(self, operators.is_true, operators.is_false)
        elif against in (operators.any_op, operators.all_op):
            return Grouping(self)
        else:
            return self

    @overload
    def _negate(self: ColumnElement[bool]) -> ColumnElement[bool]:
        ...

    @overload
    def _negate(self: ColumnElement[_T]) -> ColumnElement[_T]:
        ...

    def _negate(self) -> ColumnElement[Any]:
        if self.type._type_affinity is type_api.BOOLEANTYPE._type_affinity:
            return AsBoolean(self, operators.is_false, operators.is_true)
        else:
            grouped = self.self_group(against=operators.inv)
            assert isinstance(grouped, ColumnElement)
            return UnaryExpression(
                grouped, operator=operators.inv, wraps_column_expression=True
            )

    type: TypeEngine[_T]

    if not TYPE_CHECKING:

        @util.memoized_property
        def type(self) -> TypeEngine[_T]:  # noqa: A001
            # used for delayed setup of
            # type_api
            return type_api.NULLTYPE

    @HasMemoized.memoized_attribute
    def comparator(self) -> TypeEngine.Comparator[_T]:
        try:
            comparator_factory = self.type.comparator_factory
        except AttributeError as err:
            raise TypeError(
                "Object %r associated with '.type' attribute "
                "is not a TypeEngine class or object" % self.type
            ) from err
        else:
            return comparator_factory(self)

    def __setstate__(self, state):
        self.__dict__.update(state)

    def __getattr__(self, key: str) -> Any:
        try:
            return getattr(self.comparator, key)
        except AttributeError as err:
            raise AttributeError(
                "Neither %r object nor %r object has an attribute %r"
                % (
                    type(self).__name__,
                    type(self.comparator).__name__,
                    key,
                )
            ) from err

    def operate(
        self,
        op: operators.OperatorType,
        *other: Any,
        **kwargs: Any,
    ) -> ColumnElement[Any]:
        return op(self.comparator, *other, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

    def reverse_operate(
        self, op: operators.OperatorType, other: Any, **kwargs: Any
    ) -> ColumnElement[Any]:
        return op(other, self.comparator, **kwargs)  # type: ignore[no-any-return]  # noqa: E501

    def _bind_param(
        self,
        operator: operators.OperatorType,
        obj: Any,
        type_: Optional[TypeEngine[_T]] = None,
        expanding: bool = False,
    ) -> BindParameter[_T]:
        return BindParameter(
            None,
            obj,
            _compared_to_operator=operator,
            type_=type_,
            _compared_to_type=self.type,
            unique=True,
            expanding=expanding,
        )

    @property
    def expression(self) -> ColumnElement[Any]:
        """Return a column expression.

        Part of the inspection interface; returns self.

        """
        return self

    @property
    def _select_iterable(self) -> _SelectIterable:
        return (self,)

    @util.memoized_property
    def base_columns(self) -> FrozenSet[ColumnElement[Any]]:
        return frozenset(c for c in self.proxy_set if not c._proxies)

    @util.memoized_property
    def proxy_set(self) -> FrozenSet[ColumnElement[Any]]:
        """set of all columns we are proxying

        as of 2.0 this is explicitly deannotated columns.  previously it was
        effectively deannotated columns but wasn't enforced.  annotated
        columns should basically not go into sets if at all possible because
        their hashing behavior is very non-performant.

        """
        return frozenset([self._deannotate()]).union(
            itertools.chain(*[c.proxy_set for c in self._proxies])
        )

    @util.memoized_property
    def _expanded_proxy_set(self) -> FrozenSet[ColumnElement[Any]]:
        return frozenset(_expand_cloned(self.proxy_set))

    def _uncached_proxy_list(self) -> List[ColumnElement[Any]]:
        """An 'uncached' version of proxy set.

        This list includes annotated columns which perform very poorly in
        set operations.

        """

        return [self] + list(
            itertools.chain(*[c._uncached_proxy_list() for c in self._proxies])
        )

    def shares_lineage(self, othercolumn: ColumnElement[Any]) -> bool:
        """Return True if the given :class:`_expression.ColumnElement`
        has a common ancestor to this :class:`_expression.ColumnElement`."""

        return bool(self.proxy_set.intersection(othercolumn.proxy_set))

    def _compare_name_for_result(self, other: ColumnElement[Any]) -> bool:
        """Return True if the given column element compares to this one
        when targeting within a result row."""

        return (
            hasattr(other, "name")
            and hasattr(self, "name")
            and other.name == self.name
        )

    @HasMemoized.memoized_attribute
    def _proxy_key(self) -> Optional[str]:
        if self._annotations and "proxy_key" in self._annotations:
            return cast(str, self._annotations["proxy_key"])

        name = self.key
        if not name:
            # there's a bit of a seeming contradiction which is that the
            # "_non_anon_label" of a column can in fact be an
            # "_anonymous_label"; this is when it's on a column that is
            # proxying for an anonymous expression in a subquery.
            name = self._non_anon_label

        if isinstance(name, _anonymous_label):
            return None
        else:
            return name

    @HasMemoized.memoized_attribute
    def _expression_label(self) -> Optional[str]:
        """a suggested label to use in the case that the column has no name,
        which should be used if possible as the explicit 'AS <label>'
        where this expression would normally have an anon label.

        this is essentially mostly what _proxy_key does except it returns
        None if the column has a normal name that can be used.

        """

        if getattr(self, "name", None) is not None:
            return None
        elif self._annotations and "proxy_key" in self._annotations:
            return cast(str, self._annotations["proxy_key"])
        else:
            return None

    def _make_proxy(
        self,
        selectable: FromClause,
        *,
        name: Optional[str] = None,
        key: Optional[str] = None,
        name_is_truncatable: bool = False,
        compound_select_cols: Optional[Sequence[ColumnElement[Any]]] = None,
        **kw: Any,
    ) -> typing_Tuple[str, ColumnClause[_T]]:
        """Create a new :class:`_expression.ColumnElement` representing this
        :class:`_expression.ColumnElement` as it appears in the select list of
        a descending selectable.

        """
        if name is None:
            name = self._anon_name_label
            if key is None:
                key = self._proxy_key
        else:
            key = name

        assert key is not None

        co: ColumnClause[_T] = ColumnClause(
            coercions.expect(roles.TruncatedLabelRole, name)
            if name_is_truncatable
            else name,
            type_=getattr(self, "type", None),
            _selectable=selectable,
        )

        co._propagate_attrs = selectable._propagate_attrs
        if compound_select_cols:
            co._proxies = list(compound_select_cols)
        else:
            co._proxies = [self]
        if selectable._is_clone_of is not None:
            co._is_clone_of = selectable._is_clone_of.columns.get(key)
        return key, co

    def cast(self, type_: _TypeEngineArgument[_OPT]) -> Cast[_OPT]:
        """Produce a type cast, i.e. ``CAST(<expression> AS <type>)``.

        This is a shortcut to the :func:`_expression.cast` function.

        .. seealso::

            :ref:`tutorial_casts`

            :func:`_expression.cast`

            :func:`_expression.type_coerce`

        """
        return Cast(self, type_)

    def label(self, name: Optional[str]) -> Label[_T]:
        """Produce a column label, i.e. ``<columnname> AS <name>``.

        This is a shortcut to the :func:`_expression.label` function.

        If 'name' is ``None``, an anonymous label name will be generated.

        """
        return Label(name, self, self.type)

    def _anon_label(
        self, seed: Optional[str], add_hash: Optional[int] = None
    ) -> _anonymous_label:
        while self._is_clone_of is not None:
            self = self._is_clone_of

        # as of 1.4 anonymous label for ColumnElement uses hash(), not id(),
        # as the identifier, because a column and its annotated version are
        # the same thing in a SQL statement
        hash_value = hash(self)

        if add_hash:
            # this path is used for disambiguating anon labels that would
            # otherwise be the same name for the same element repeated.
            # an additional numeric value is factored in for each label.

            # shift hash(self) (which is id(self), typically 8 byte integer)
            # 16 bits leftward.  fill extra add_hash on right
            assert add_hash < (2 << 15)
            assert seed
            hash_value = (hash_value << 16) | add_hash

            # extra underscore is added for labels with extra hash
            # values, to isolate the "deduped anon" namespace from the
            # regular namespace.  eliminates chance of these
            # manufactured hash values overlapping with regular ones for some
            # undefined python interpreter
            seed = seed + "_"

        if isinstance(seed, _anonymous_label):
            return _anonymous_label.safe_construct(
                hash_value, "", enclosing_label=seed
            )

        return _anonymous_label.safe_construct(hash_value, seed or "anon")

    @util.memoized_property
    def _anon_name_label(self) -> str:
        """Provides a constant 'anonymous label' for this ColumnElement.

        This is a label() expression which will be named at compile time.
        The same label() is returned each time ``anon_label`` is called so
        that expressions can reference ``anon_label`` multiple times,
        producing the same label name at compile time.

        The compiler uses this function automatically at compile time
        for expressions that are known to be 'unnamed' like binary
        expressions and function calls.

        .. versionchanged:: 1.4.9 - this attribute was not intended to be
           public and is renamed to _anon_name_label.  anon_name exists
           for backwards compat

        """
        name = getattr(self, "name", None)
        return self._anon_label(name)

    @util.memoized_property
    def _anon_key_label(self) -> _anonymous_label:
        """Provides a constant 'anonymous key label' for this ColumnElement.

        Compare to ``anon_label``, except that the "key" of the column,
        if available, is used to generate the label.

        This is used when a deduplicating key is placed into the columns
        collection of a selectable.

        .. versionchanged:: 1.4.9 - this attribute was not intended to be
           public and is renamed to _anon_key_label.  anon_key_label exists
           for backwards compat

        """
        return self._anon_label(self._proxy_key)

    @property
    @util.deprecated(
        "1.4",
        "The :attr:`_expression.ColumnElement.anon_label` attribute is now "
        "private, and the public accessor is deprecated.",
    )
    def anon_label(self) -> str:
        return self._anon_name_label

    @property
    @util.deprecated(
        "1.4",
        "The :attr:`_expression.ColumnElement.anon_key_label` attribute is "
        "now private, and the public accessor is deprecated.",
    )
    def anon_key_label(self) -> str:
        return self._anon_key_label

    def _dedupe_anon_label_idx(self, idx: int) -> str:
        """label to apply to a column that is anon labeled, but repeated
        in the SELECT, so that we have to make an "extra anon" label that
        disambiguates it from the previous appearance.

        these labels come out like "foo_bar_id__1" and have double underscores
        in them.

        """
        label = getattr(self, "name", None)

        # current convention is that if the element doesn't have a
        # ".name" (usually because it is not NamedColumn), we try to
        # use a "table qualified" form for the "dedupe anon" label,
        # based on the notion that a label like
        # "CAST(casttest.v1 AS DECIMAL) AS casttest_v1__1" looks better than
        # "CAST(casttest.v1 AS DECIMAL) AS anon__1"

        if label is None:
            return self._dedupe_anon_tq_label_idx(idx)
        else:
            return self._anon_label(label, add_hash=idx)

    @util.memoized_property
    def _anon_tq_label(self) -> _anonymous_label:
        return self._anon_label(getattr(self, "_tq_label", None))

    @util.memoized_property
    def _anon_tq_key_label(self) -> _anonymous_label:
        return self._anon_label(getattr(self, "_tq_key_label", None))

    def _dedupe_anon_tq_label_idx(self, idx: int) -> _anonymous_label:
        label = getattr(self, "_tq_label", None) or "anon"

        return self._anon_label(label, add_hash=idx)


class KeyedColumnElement(ColumnElement[_T]):
    """ColumnElement where ``.key`` is non-None."""

    _is_keyed_column_element = True

    key: str


class WrapsColumnExpression(ColumnElement[_T]):
    """Mixin that defines a :class:`_expression.ColumnElement`
    as a wrapper with special
    labeling behavior for an expression that already has a name.

    .. versionadded:: 1.4

    .. seealso::

        :ref:`change_4449`


    """

    @property
    def wrapped_column_expression(self) -> ColumnElement[_T]:
        raise NotImplementedError()

    @util.non_memoized_property
    def _tq_label(self) -> Optional[str]:
        wce = self.wrapped_column_expression
        if hasattr(wce, "_tq_label"):
            return wce._tq_label
        else:
            return None

    @property
    def _label(self) -> Optional[str]:
        return self._tq_label

    @property
    def _non_anon_label(self) -> Optional[str]:
        return None

    @util.non_memoized_property
    def _anon_name_label(self) -> str:
        wce = self.wrapped_column_expression

        # this logic tries to get the WrappedColumnExpression to render
        # with "<expr> AS <name>", where "<name>" is the natural name
        # within the expression itself.   e.g. "CAST(table.foo) AS foo".
        if not wce._is_text_clause:
            nal = wce._non_anon_label
            if nal:
                return nal
            elif hasattr(wce, "_anon_name_label"):
                return wce._anon_name_label
        return super()._anon_name_label

    def _dedupe_anon_label_idx(self, idx: int) -> str:
        wce = self.wrapped_column_expression
        nal = wce._non_anon_label
        if nal:
            return self._anon_label(nal + "_")
        else:
            return self._dedupe_anon_tq_label_idx(idx)

    @property
    def _proxy_key(self):
        wce = self.wrapped_column_expression

        if not wce._is_text_clause:
            return wce._proxy_key
        return super()._proxy_key


class BindParameter(roles.InElementRole, KeyedColumnElement[_T]):
    r"""Represent a "bound expression".

    :class:`.BindParameter` is invoked explicitly using the
    :func:`.bindparam` function, as in::

        from sqlalchemy import bindparam

        stmt = select(users_table).\
                    where(users_table.c.name == bindparam('username'))

    Detailed discussion of how :class:`.BindParameter` is used is
    at :func:`.bindparam`.

    .. seealso::

        :func:`.bindparam`

    """

    __visit_name__ = "bindparam"

    _traverse_internals: _TraverseInternalsType = [
        ("key", InternalTraversal.dp_anon_name),
        ("type", InternalTraversal.dp_type),
        ("callable", InternalTraversal.dp_plain_dict),
        ("value", InternalTraversal.dp_plain_obj),
        ("literal_execute", InternalTraversal.dp_boolean),
    ]

    key: str
    type: TypeEngine[_T]
    value: Optional[_T]

    _is_crud = False
    _is_bind_parameter = True
    _key_is_anon = False

    # bindparam implements its own _gen_cache_key() method however
    # we check subclasses for this flag, else no cache key is generated
    inherit_cache = True

    def __init__(
        self,
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
        _compared_to_operator: Optional[OperatorType] = None,
        _compared_to_type: Optional[TypeEngine[Any]] = None,
        _is_crud: bool = False,
    ):
        if required is _NoArg.NO_ARG:
            required = value is _NoArg.NO_ARG and callable_ is None
        if value is _NoArg.NO_ARG:
            value = None

        if quote is not None:
            key = quoted_name.construct(key, quote)

        if unique:
            self.key = _anonymous_label.safe_construct(
                id(self),
                key
                if key is not None and not isinstance(key, _anonymous_label)
                else "param",
                sanitize_key=True,
            )
            self._key_is_anon = True
        elif key:
            self.key = key
        else:
            self.key = _anonymous_label.safe_construct(id(self), "param")
            self._key_is_anon = True

        # identifying key that won't change across
        # clones, used to identify the bind's logical
        # identity
        self._identifying_key = self.key

        # key that was passed in the first place, used to
        # generate new keys
        self._orig_key = key or "param"

        self.unique = unique
        self.value = value
        self.callable = callable_
        self.isoutparam = isoutparam
        self.required = required

        # indicate an "expanding" parameter; the compiler sets this
        # automatically in the compiler _render_in_expr_w_bindparam method
        # for an IN expression
        self.expanding = expanding

        # this is another hint to help w/ expanding and is typically
        # set in the compiler _render_in_expr_w_bindparam method for an
        # IN expression
        self.expand_op = None

        self.literal_execute = literal_execute
        if _is_crud:
            self._is_crud = True

        if type_ is None:
            if expanding:
                if value:
                    check_value = value[0]
                else:
                    check_value = type_api._NO_VALUE_IN_LIST
            else:
                check_value = value
            if _compared_to_type is not None:
                self.type = _compared_to_type.coerce_compared_value(
                    _compared_to_operator, check_value
                )
            else:
                self.type = type_api._resolve_value_to_type(check_value)
        elif isinstance(type_, type):
            self.type = type_()
        elif is_tuple_type(type_):
            if value:
                if expanding:
                    check_value = value[0]
                else:
                    check_value = value
                cast(
                    "BindParameter[typing_Tuple[Any, ...]]", self
                ).type = type_._resolve_values_to_types(check_value)
            else:
                cast(
                    "BindParameter[typing_Tuple[Any, ...]]", self
                ).type = type_
        else:
            self.type = type_

    def _with_value(self, value, maintain_key=False, required=NO_ARG):
        """Return a copy of this :class:`.BindParameter` with the given value
        set.
        """
        cloned = self._clone(maintain_key=maintain_key)
        cloned.value = value
        cloned.callable = None
        cloned.required = required if required is not NO_ARG else self.required
        if cloned.type is type_api.NULLTYPE:
            cloned.type = type_api._resolve_value_to_type(value)
        return cloned

    @property
    def effective_value(self) -> Optional[_T]:
        """Return the value of this bound parameter,
        taking into account if the ``callable`` parameter
        was set.

        The ``callable`` value will be evaluated
        and returned if present, else ``value``.

        """
        if self.callable:
            # TODO: set up protocol for bind parameter callable
            return self.callable()  # type: ignore
        else:
            return self.value

    def render_literal_execute(self) -> BindParameter[_T]:
        """Produce a copy of this bound parameter that will enable the
        :paramref:`_sql.BindParameter.literal_execute` flag.

        The :paramref:`_sql.BindParameter.literal_execute` flag will
        have the effect of the parameter rendered in the compiled SQL
        string using ``[POSTCOMPILE]`` form, which is a special form that
        is converted to be a rendering of the literal value of the parameter
        at SQL execution time.    The rationale is to support caching
        of SQL statement strings that can embed per-statement literal values,
        such as LIMIT and OFFSET parameters, in the final SQL string that
        is passed to the DBAPI.   Dialects in particular may want to use
        this method within custom compilation schemes.

        .. versionadded:: 1.4.5

        .. seealso::

            :ref:`engine_thirdparty_caching`

        """
        c = ClauseElement._clone(self)
        c.literal_execute = True
        return c

    def _negate_in_binary(self, negated_op, original_op):
        if self.expand_op is original_op:
            bind = self._clone()
            bind.expand_op = negated_op
            return bind
        else:
            return self

    def _with_binary_element_type(self, type_):
        c = ClauseElement._clone(self)
        c.type = type_
        return c

    def _clone(self, maintain_key: bool = False, **kw: Any) -> Self:
        c = ClauseElement._clone(self, **kw)
        # ensure all the BindParameter objects stay in cloned set.
        # in #7823, we changed "clone" so that a clone only keeps a reference
        # to the "original" element, since for column correspondence, that's
        # all we need.   However, for BindParam, _cloned_set is used by
        # the "cache key bind match" lookup, which means if any of those
        # interim BindParameter objects became part of a cache key in the
        # cache, we need it.  So here, make sure all clones keep carrying
        # forward.
        c._cloned_set.update(self._cloned_set)
        if not maintain_key and self.unique:
            c.key = _anonymous_label.safe_construct(
                id(c), c._orig_key or "param", sanitize_key=True
            )
        return c

    def _gen_cache_key(self, anon_map, bindparams):
        _gen_cache_ok = self.__class__.__dict__.get("inherit_cache", False)

        if not _gen_cache_ok:
            if anon_map is not None:
                anon_map[NO_CACHE] = True
            return None

        id_, found = anon_map.get_anon(self)
        if found:
            return (id_, self.__class__)

        if bindparams is not None:
            bindparams.append(self)

        return (
            id_,
            self.__class__,
            self.type._static_cache_key,
            self.key % anon_map if self._key_is_anon else self.key,
            self.literal_execute,
        )

    def _convert_to_unique(self):
        if not self.unique:
            self.unique = True
            self.key = _anonymous_label.safe_construct(
                id(self), self._orig_key or "param", sanitize_key=True
            )

    def __getstate__(self):
        """execute a deferred value for serialization purposes."""

        d = self.__dict__.copy()
        v = self.value
        if self.callable:
            v = self.callable()
            d["callable"] = None
        d["value"] = v
        return d

    def __setstate__(self, state):
        if state.get("unique", False):
            state["key"] = _anonymous_label.safe_construct(
                id(self), state.get("_orig_key", "param"), sanitize_key=True
            )
        self.__dict__.update(state)

    def __repr__(self):
        return "%s(%r, %r, type_=%r)" % (
            self.__class__.__name__,
            self.key,
            self.value,
            self.type,
        )


class TypeClause(DQLDMLClauseElement):
    """Handle a type keyword in a SQL statement.

    Used by the ``Case`` statement.

    """

    __visit_name__ = "typeclause"

    _traverse_internals: _TraverseInternalsType = [
        ("type", InternalTraversal.dp_type)
    ]

    def __init__(self, type_):
        self.type = type_


class TextClause(
    roles.DDLConstraintColumnRole,
    roles.DDLExpressionRole,
    roles.StatementOptionRole,
    roles.WhereHavingRole,
    roles.OrderByRole,
    roles.FromClauseRole,
    roles.SelectStatementRole,
    roles.InElementRole,
    Generative,
    Executable,
    DQLDMLClauseElement,
    roles.BinaryElementRole[Any],
    inspection.Inspectable["TextClause"],
):
    """Represent a literal SQL text fragment.

    E.g.::

        from sqlalchemy import text

        t = text("SELECT * FROM users")
        result = connection.execute(t)


    The :class:`_expression.TextClause` construct is produced using the
    :func:`_expression.text`
    function; see that function for full documentation.

    .. seealso::

        :func:`_expression.text`

    """

    __visit_name__ = "textclause"

    _traverse_internals: _TraverseInternalsType = [
        ("_bindparams", InternalTraversal.dp_string_clauseelement_dict),
        ("text", InternalTraversal.dp_string),
    ]

    _is_text_clause = True

    _is_textual = True

    _bind_params_regex = re.compile(r"(?<![:\w\x5c]):(\w+)(?!:)", re.UNICODE)
    _is_implicitly_boolean = False

    _render_label_in_columns_clause = False

    _omit_from_statements = False

    _is_collection_aggregate = False

    @property
    def _hide_froms(self) -> Iterable[FromClause]:
        return ()

    def __and__(self, other):
        # support use in select.where(), query.filter()
        return and_(self, other)

    @property
    def _select_iterable(self) -> _SelectIterable:
        return (self,)

    # help in those cases where text() is
    # interpreted in a column expression situation
    key: Optional[str] = None
    _label: Optional[str] = None

    _allow_label_resolve = False

    @property
    def _is_star(self):
        return self.text == "*"

    def __init__(self, text: str):
        self._bindparams: Dict[str, BindParameter[Any]] = {}

        def repl(m):
            self._bindparams[m.group(1)] = BindParameter(m.group(1))
            return ":%s" % m.group(1)

        # scan the string and search for bind parameter names, add them
        # to the list of bindparams
        self.text = self._bind_params_regex.sub(repl, text)

    @_generative
    def bindparams(
        self,
        *binds: BindParameter[Any],
        **names_to_values: Any,
    ) -> Self:
        """Establish the values and/or types of bound parameters within
        this :class:`_expression.TextClause` construct.

        Given a text construct such as::

            from sqlalchemy import text
            stmt = text("SELECT id, name FROM user WHERE name=:name "
                        "AND timestamp=:timestamp")

        the :meth:`_expression.TextClause.bindparams`
        method can be used to establish
        the initial value of ``:name`` and ``:timestamp``,
        using simple keyword arguments::

            stmt = stmt.bindparams(name='jack',
                        timestamp=datetime.datetime(2012, 10, 8, 15, 12, 5))

        Where above, new :class:`.BindParameter` objects
        will be generated with the names ``name`` and ``timestamp``, and
        values of ``jack`` and ``datetime.datetime(2012, 10, 8, 15, 12, 5)``,
        respectively.  The types will be
        inferred from the values given, in this case :class:`.String` and
        :class:`.DateTime`.

        When specific typing behavior is needed, the positional ``*binds``
        argument can be used in which to specify :func:`.bindparam` constructs
        directly.  These constructs must include at least the ``key``
        argument, then an optional value and type::

            from sqlalchemy import bindparam
            stmt = stmt.bindparams(
                            bindparam('name', value='jack', type_=String),
                            bindparam('timestamp', type_=DateTime)
                        )

        Above, we specified the type of :class:`.DateTime` for the
        ``timestamp`` bind, and the type of :class:`.String` for the ``name``
        bind.  In the case of ``name`` we also set the default value of
        ``"jack"``.

        Additional bound parameters can be supplied at statement execution
        time, e.g.::

            result = connection.execute(stmt,
                        timestamp=datetime.datetime(2012, 10, 8, 15, 12, 5))

        The :meth:`_expression.TextClause.bindparams`
        method can be called repeatedly,
        where it will re-use existing :class:`.BindParameter` objects to add
        new information.  For example, we can call
        :meth:`_expression.TextClause.bindparams`
        first with typing information, and a
        second time with value information, and it will be combined::

            stmt = text("SELECT id, name FROM user WHERE name=:name "
                        "AND timestamp=:timestamp")
            stmt = stmt.bindparams(
                bindparam('name', type_=String),
                bindparam('timestamp', type_=DateTime)
            )
            stmt = stmt.bindparams(
                name='jack',
                timestamp=datetime.datetime(2012, 10, 8, 15, 12, 5)
            )

        The :meth:`_expression.TextClause.bindparams`
        method also supports the concept of
        **unique** bound parameters.  These are parameters that are
        "uniquified" on name at statement compilation time, so that  multiple
        :func:`_expression.text`
        constructs may be combined together without the names
        conflicting.  To use this feature, specify the
        :paramref:`.BindParameter.unique` flag on each :func:`.bindparam`
        object::

            stmt1 = text("select id from table where name=:name").bindparams(
                bindparam("name", value='name1', unique=True)
            )
            stmt2 = text("select id from table where name=:name").bindparams(
                bindparam("name", value='name2', unique=True)
            )

            union = union_all(
                stmt1.columns(column("id")),
                stmt2.columns(column("id"))
            )

        The above statement will render as::

            select id from table where name=:name_1
            UNION ALL select id from table where name=:name_2

        .. versionadded:: 1.3.11  Added support for the
           :paramref:`.BindParameter.unique` flag to work with
           :func:`_expression.text`
           constructs.

        """
        self._bindparams = new_params = self._bindparams.copy()

        for bind in binds:
            try:
                # the regex used for text() currently will not match
                # a unique/anonymous key in any case, so use the _orig_key
                # so that a text() construct can support unique parameters
                existing = new_params[bind._orig_key]
            except KeyError as err:
                raise exc.ArgumentError(
                    "This text() construct doesn't define a "
                    "bound parameter named %r" % bind._orig_key
                ) from err
            else:
                new_params[existing._orig_key] = bind

        for key, value in names_to_values.items():
            try:
                existing = new_params[key]
            except KeyError as err:
                raise exc.ArgumentError(
                    "This text() construct doesn't define a "
                    "bound parameter named %r" % key
                ) from err
            else:
                new_params[key] = existing._with_value(value, required=False)
        return self

    @util.preload_module("sqlalchemy.sql.selectable")
    def columns(
        self, *cols: _ColumnExpressionArgument[Any], **types: TypeEngine[Any]
    ) -> TextualSelect:
        r"""Turn this :class:`_expression.TextClause` object into a
        :class:`_expression.TextualSelect`
        object that serves the same role as a SELECT
        statement.

        The :class:`_expression.TextualSelect` is part of the
        :class:`_expression.SelectBase`
        hierarchy and can be embedded into another statement by using the
        :meth:`_expression.TextualSelect.subquery` method to produce a
        :class:`.Subquery`
        object, which can then be SELECTed from.

        This function essentially bridges the gap between an entirely
        textual SELECT statement and the SQL expression language concept
        of a "selectable"::

            from sqlalchemy.sql import column, text

            stmt = text("SELECT id, name FROM some_table")
            stmt = stmt.columns(column('id'), column('name')).subquery('st')

            stmt = select(mytable).\
                    select_from(
                        mytable.join(stmt, mytable.c.name == stmt.c.name)
                    ).where(stmt.c.id > 5)

        Above, we pass a series of :func:`_expression.column` elements to the
        :meth:`_expression.TextClause.columns` method positionally.  These
        :func:`_expression.column`
        elements now become first class elements upon the
        :attr:`_expression.TextualSelect.selected_columns` column collection,
        which then
        become part of the :attr:`.Subquery.c` collection after
        :meth:`_expression.TextualSelect.subquery` is invoked.

        The column expressions we pass to
        :meth:`_expression.TextClause.columns` may
        also be typed; when we do so, these :class:`.TypeEngine` objects become
        the effective return type of the column, so that SQLAlchemy's
        result-set-processing systems may be used on the return values.
        This is often needed for types such as date or boolean types, as well
        as for unicode processing on some dialect configurations::

            stmt = text("SELECT id, name, timestamp FROM some_table")
            stmt = stmt.columns(
                        column('id', Integer),
                        column('name', Unicode),
                        column('timestamp', DateTime)
                    )

            for id, name, timestamp in connection.execute(stmt):
                print(id, name, timestamp)

        As a shortcut to the above syntax, keyword arguments referring to
        types alone may be used, if only type conversion is needed::

            stmt = text("SELECT id, name, timestamp FROM some_table")
            stmt = stmt.columns(
                        id=Integer,
                        name=Unicode,
                        timestamp=DateTime
                    )

            for id, name, timestamp in connection.execute(stmt):
                print(id, name, timestamp)

        The positional form of :meth:`_expression.TextClause.columns`
        also provides the
        unique feature of **positional column targeting**, which is
        particularly useful when using the ORM with complex textual queries. If
        we specify the columns from our model to
        :meth:`_expression.TextClause.columns`,
        the result set will match to those columns positionally, meaning the
        name or origin of the column in the textual SQL doesn't matter::

            stmt = text("SELECT users.id, addresses.id, users.id, "
                 "users.name, addresses.email_address AS email "
                 "FROM users JOIN addresses ON users.id=addresses.user_id "
                 "WHERE users.id = 1").columns(
                    User.id,
                    Address.id,
                    Address.user_id,
                    User.name,
                    Address.email_address
                 )

            query = session.query(User).from_statement(stmt).options(
                contains_eager(User.addresses))

        The :meth:`_expression.TextClause.columns` method provides a direct
        route to calling :meth:`_expression.FromClause.subquery` as well as
        :meth:`_expression.SelectBase.cte`
        against a textual SELECT statement::

            stmt = stmt.columns(id=Integer, name=String).cte('st')

            stmt = select(sometable).where(sometable.c.id == stmt.c.id)

        :param \*cols: A series of :class:`_expression.ColumnElement` objects,
         typically
         :class:`_schema.Column` objects from a :class:`_schema.Table`
         or ORM level
         column-mapped attributes, representing a set of columns that this
         textual string will SELECT from.

        :param \**types: A mapping of string names to :class:`.TypeEngine`
         type objects indicating the datatypes to use for names that are
         SELECTed from the textual string.  Prefer to use the ``*cols``
         argument as it also indicates positional ordering.

        """
        selectable = util.preloaded.sql_selectable

        input_cols: List[NamedColumn[Any]] = [
            coercions.expect(roles.LabeledColumnExprRole, col) for col in cols
        ]

        positional_input_cols = [
            ColumnClause(col.key, types.pop(col.key))
            if col.key in types
            else col
            for col in input_cols
        ]
        keyed_input_cols: List[NamedColumn[Any]] = [
            ColumnClause(key, type_) for key, type_ in types.items()
        ]

        elem = selectable.TextualSelect.__new__(selectable.TextualSelect)
        elem._init(
            self,
            positional_input_cols + keyed_input_cols,
            positional=bool(positional_input_cols) and not keyed_input_cols,
        )
        return elem

    @property
    def type(self) -> TypeEngine[Any]:
        return type_api.NULLTYPE

    @property
    def comparator(self):
        # TODO: this seems wrong, it seems like we might not
        # be using this method.
        return self.type.comparator_factory(self)  # type: ignore

    def self_group(self, against=None):
        if against is operators.in_op:
            return Grouping(self)
        else:
            return self


class Null(SingletonConstant, roles.ConstExprRole[None], ColumnElement[None]):
    """Represent the NULL keyword in a SQL statement.

    :class:`.Null` is accessed as a constant via the
    :func:`.null` function.

    """

    __visit_name__ = "null"

    _traverse_internals: _TraverseInternalsType = []
    _singleton: Null

    if not TYPE_CHECKING:

        @util.memoized_property
        def type(self) -> TypeEngine[_T]:  # noqa: A001
            return type_api.NULLTYPE

    @classmethod
    def _instance(cls) -> Null:
        """Return a constant :class:`.Null` construct."""

        return Null._singleton


Null._create_singleton()


class False_(
    SingletonConstant, roles.ConstExprRole[bool], ColumnElement[bool]
):
    """Represent the ``false`` keyword, or equivalent, in a SQL statement.

    :class:`.False_` is accessed as a constant via the
    :func:`.false` function.

    """

    __visit_name__ = "false"
    _traverse_internals: _TraverseInternalsType = []
    _singleton: False_

    if not TYPE_CHECKING:

        @util.memoized_property
        def type(self) -> TypeEngine[_T]:  # noqa: A001
            return type_api.BOOLEANTYPE

    def _negate(self) -> True_:
        return True_._singleton

    @classmethod
    def _instance(cls) -> False_:
        return False_._singleton


False_._create_singleton()


class True_(SingletonConstant, roles.ConstExprRole[bool], ColumnElement[bool]):
    """Represent the ``true`` keyword, or equivalent, in a SQL statement.

    :class:`.True_` is accessed as a constant via the
    :func:`.true` function.

    """

    __visit_name__ = "true"

    _traverse_internals: _TraverseInternalsType = []
    _singleton: True_

    if not TYPE_CHECKING:

        @util.memoized_property
        def type(self) -> TypeEngine[_T]:  # noqa: A001
            return type_api.BOOLEANTYPE

    def _negate(self) -> False_:
        return False_._singleton

    @classmethod
    def _ifnone(
        cls, other: Optional[ColumnElement[Any]]
    ) -> ColumnElement[Any]:
        if other is None:
            return cls._instance()
        else:
            return other

    @classmethod
    def _instance(cls) -> True_:
        return True_._singleton


True_._create_singleton()


class ClauseList(
    roles.InElementRole,
    roles.OrderByRole,
    roles.ColumnsClauseRole,
    roles.DMLColumnRole,
    DQLDMLClauseElement,
):
    """Describe a list of clauses, separated by an operator.

    By default, is comma-separated, such as a column listing.

    """

    __visit_name__ = "clauselist"

    # this is used only by the ORM in a legacy use case for
    # composite attributes
    _is_clause_list = True

    _traverse_internals: _TraverseInternalsType = [
        ("clauses", InternalTraversal.dp_clauseelement_list),
        ("operator", InternalTraversal.dp_operator),
    ]

    clauses: List[ColumnElement[Any]]

    def __init__(
        self,
        *clauses: _ColumnExpressionArgument[Any],
        operator: OperatorType = operators.comma_op,
        group: bool = True,
        group_contents: bool = True,
        _literal_as_text_role: Type[roles.SQLRole] = roles.WhereHavingRole,
    ):
        self.operator = operator
        self.group = group
        self.group_contents = group_contents
        clauses_iterator: Iterable[_ColumnExpressionArgument[Any]] = clauses
        text_converter_role: Type[roles.SQLRole] = _literal_as_text_role
        self._text_converter_role = text_converter_role

        if self.group_contents:
            self.clauses = [
                coercions.expect(
                    text_converter_role, clause, apply_propagate_attrs=self
                ).self_group(against=self.operator)
                for clause in clauses_iterator
            ]
        else:
            self.clauses = [
                coercions.expect(
                    text_converter_role, clause, apply_propagate_attrs=self
                )
                for clause in clauses_iterator
            ]
        self._is_implicitly_boolean = operators.is_boolean(self.operator)

    @classmethod
    def _construct_raw(
        cls,
        operator: OperatorType,
        clauses: Optional[Sequence[ColumnElement[Any]]] = None,
    ) -> ClauseList:
        self = cls.__new__(cls)
        self.clauses = list(clauses) if clauses else []
        self.group = True
        self.operator = operator
        self.group_contents = True
        self._is_implicitly_boolean = False
        return self

    def __iter__(self) -> Iterator[ColumnElement[Any]]:
        return iter(self.clauses)

    def __len__(self) -> int:
        return len(self.clauses)

    @property
    def _select_iterable(self) -> _SelectIterable:
        return itertools.chain.from_iterable(
            [elem._select_iterable for elem in self.clauses]
        )

    def append(self, clause):
        if self.group_contents:
            self.clauses.append(
                coercions.expect(self._text_converter_role, clause).self_group(
                    against=self.operator
                )
            )
        else:
            self.clauses.append(
                coercions.expect(self._text_converter_role, clause)
            )

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return list(itertools.chain(*[c._from_objects for c in self.clauses]))

    def self_group(self, against=None):
        if self.group and operators.is_precedent(self.operator, against):
            return Grouping(self)
        else:
            return self


class OperatorExpression(ColumnElement[_T]):
    """base for expressions that contain an operator and operands

    .. versionadded:: 2.0

    """

    operator: OperatorType
    type: TypeEngine[_T]

    group: bool = True

    @property
    def is_comparison(self):
        return operators.is_comparison(self.operator)

    def self_group(self, against=None):
        if (
            self.group
            and operators.is_precedent(self.operator, against)
            or (
                # a negate against a non-boolean operator
                # doesn't make too much sense but we should
                # group for that
                against is operators.inv
                and not operators.is_boolean(self.operator)
            )
        ):
            return Grouping(self)
        else:
            return self

    @property
    def _flattened_operator_clauses(
        self,
    ) -> typing_Tuple[ColumnElement[Any], ...]:
        raise NotImplementedError()

    @classmethod
    def _construct_for_op(
        cls,
        left: ColumnElement[Any],
        right: ColumnElement[Any],
        op: OperatorType,
        *,
        type_: TypeEngine[_T],
        negate: Optional[OperatorType] = None,
        modifiers: Optional[Mapping[str, Any]] = None,
    ) -> OperatorExpression[_T]:
        if operators.is_associative(op):
            assert (
                negate is None
            ), f"negate not supported for associative operator {op}"

            multi = False
            if getattr(
                left, "operator", None
            ) is op and type_._compare_type_affinity(left.type):
                multi = True
                left_flattened = left._flattened_operator_clauses
            else:
                left_flattened = (left,)

            if getattr(
                right, "operator", None
            ) is op and type_._compare_type_affinity(right.type):
                multi = True
                right_flattened = right._flattened_operator_clauses
            else:
                right_flattened = (right,)

            if multi:
                return ExpressionClauseList._construct_for_list(
                    op,
                    type_,
                    *(left_flattened + right_flattened),
                )

        if right._is_collection_aggregate:
            negate = None

        return BinaryExpression(
            left, right, op, type_=type_, negate=negate, modifiers=modifiers
        )


class ExpressionClauseList(OperatorExpression[_T]):
    """Describe a list of clauses, separated by an operator,
    in a column expression context.

    :class:`.ExpressionClauseList` differs from :class:`.ClauseList` in that
    it represents a column-oriented DQL expression only, not an open ended
    list of anything comma separated.

    .. versionadded:: 2.0

    """

    __visit_name__ = "expression_clauselist"

    _traverse_internals: _TraverseInternalsType = [
        ("clauses", InternalTraversal.dp_clauseelement_tuple),
        ("operator", InternalTraversal.dp_operator),
    ]

    clauses: typing_Tuple[ColumnElement[Any], ...]

    group: bool

    def __init__(
        self,
        operator: OperatorType,
        *clauses: _ColumnExpressionArgument[Any],
        type_: Optional[_TypeEngineArgument[_T]] = None,
    ):
        self.operator = operator

        self.clauses = tuple(
            coercions.expect(
                roles.ExpressionElementRole, clause, apply_propagate_attrs=self
            )
            for clause in clauses
        )
        self._is_implicitly_boolean = operators.is_boolean(self.operator)
        self.type = type_api.to_instance(type_)  # type: ignore

    @property
    def _flattened_operator_clauses(
        self,
    ) -> typing_Tuple[ColumnElement[Any], ...]:
        return self.clauses

    def __iter__(self) -> Iterator[ColumnElement[Any]]:
        return iter(self.clauses)

    def __len__(self) -> int:
        return len(self.clauses)

    @property
    def _select_iterable(self) -> _SelectIterable:
        return (self,)

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return list(itertools.chain(*[c._from_objects for c in self.clauses]))

    def _append_inplace(self, clause: ColumnElement[Any]) -> None:
        self.clauses += (clause,)

    @classmethod
    def _construct_for_list(
        cls,
        operator: OperatorType,
        type_: TypeEngine[_T],
        *clauses: ColumnElement[Any],
        group: bool = True,
    ) -> ExpressionClauseList[_T]:
        self = cls.__new__(cls)
        self.group = group
        if group:
            self.clauses = tuple(
                c.self_group(against=operator) for c in clauses
            )
        else:
            self.clauses = clauses
        self.operator = operator
        self.type = type_
        return self

    def _negate(self) -> Any:
        grouped = self.self_group(against=operators.inv)
        assert isinstance(grouped, ColumnElement)
        return UnaryExpression(
            grouped, operator=operators.inv, wraps_column_expression=True
        )


class BooleanClauseList(ExpressionClauseList[bool]):
    __visit_name__ = "expression_clauselist"
    inherit_cache = True

    def __init__(self, *arg, **kw):
        raise NotImplementedError(
            "BooleanClauseList has a private constructor"
        )

    @classmethod
    def _process_clauses_for_boolean(
        cls,
        operator: OperatorType,
        continue_on: Any,
        skip_on: Any,
        clauses: Iterable[ColumnElement[Any]],
    ) -> typing_Tuple[int, List[ColumnElement[Any]]]:
        has_continue_on = None

        convert_clauses = []

        against = operators._asbool
        lcc = 0

        for clause in clauses:
            if clause is continue_on:
                # instance of continue_on, like and_(x, y, True, z), store it
                # if we didn't find one already, we will use it if there
                # are no other expressions here.
                has_continue_on = clause
            elif clause is skip_on:
                # instance of skip_on, e.g. and_(x, y, False, z), cancels
                # the rest out
                convert_clauses = [clause]
                lcc = 1
                break
            else:
                if not lcc:
                    lcc = 1
                else:
                    against = operator
                    # technically this would be len(convert_clauses) + 1
                    # however this only needs to indicate "greater than one"
                    lcc = 2
                convert_clauses.append(clause)

        if not convert_clauses and has_continue_on is not None:
            convert_clauses = [has_continue_on]
            lcc = 1

        return lcc, [c.self_group(against=against) for c in convert_clauses]

    @classmethod
    def _construct(
        cls,
        operator: OperatorType,
        continue_on: Any,
        skip_on: Any,
        initial_clause: Any = _NoArg.NO_ARG,
        *clauses: Any,
        **kw: Any,
    ) -> ColumnElement[Any]:
        if initial_clause is _NoArg.NO_ARG:
            # no elements period.  deprecated use case.  return an empty
            # ClauseList construct that generates nothing unless it has
            # elements added to it.
            name = operator.__name__

            util.warn_deprecated(
                f"Invoking {name}() without arguments is deprecated, and "
                f"will be disallowed in a future release.   For an empty "
                f"""{name}() construct, use '{name}({
                    'true()' if continue_on is True_._singleton else 'false()'
                }, *args)' """
                f"""or '{name}({
                    'True' if continue_on is True_._singleton else 'False'
                }, *args)'.""",
                version="1.4",
            )
            return cls._construct_raw(operator)

        lcc, convert_clauses = cls._process_clauses_for_boolean(
            operator,
            continue_on,
            skip_on,
            [
                coercions.expect(roles.WhereHavingRole, clause)
                for clause in util.coerce_generator_arg(
                    (initial_clause,) + clauses
                )
            ],
        )

        if lcc > 1:
            # multiple elements.  Return regular BooleanClauseList
            # which will link elements against the operator.

            flattened_clauses = itertools.chain.from_iterable(
                (c for c in to_flat._flattened_operator_clauses)
                if getattr(to_flat, "operator", None) is operator
                else (to_flat,)
                for to_flat in convert_clauses
            )

            return cls._construct_raw(operator, flattened_clauses)  # type: ignore # noqa: E501
        else:
            assert lcc
            # just one element.  return it as a single boolean element,
            # not a list and discard the operator.
            return convert_clauses[0]

    @classmethod
    def _construct_for_whereclause(
        cls, clauses: Iterable[ColumnElement[Any]]
    ) -> Optional[ColumnElement[bool]]:
        operator, continue_on, skip_on = (
            operators.and_,
            True_._singleton,
            False_._singleton,
        )

        lcc, convert_clauses = cls._process_clauses_for_boolean(
            operator,
            continue_on,
            skip_on,
            clauses,  # these are assumed to be coerced already
        )

        if lcc > 1:
            # multiple elements.  Return regular BooleanClauseList
            # which will link elements against the operator.
            return cls._construct_raw(operator, convert_clauses)
        elif lcc == 1:
            # just one element.  return it as a single boolean element,
            # not a list and discard the operator.
            return convert_clauses[0]
        else:
            return None

    @classmethod
    def _construct_raw(
        cls,
        operator: OperatorType,
        clauses: Optional[Sequence[ColumnElement[Any]]] = None,
    ) -> BooleanClauseList:
        self = cls.__new__(cls)
        self.clauses = tuple(clauses) if clauses else ()
        self.group = True
        self.operator = operator
        self.type = type_api.BOOLEANTYPE
        self._is_implicitly_boolean = True
        return self

    @classmethod
    def and_(
        cls,
        initial_clause: Union[
            Literal[True], _ColumnExpressionArgument[bool], _NoArg
        ] = _NoArg.NO_ARG,
        *clauses: _ColumnExpressionArgument[bool],
    ) -> ColumnElement[bool]:
        r"""Produce a conjunction of expressions joined by ``AND``.

        See :func:`_sql.and_` for full documentation.
        """
        return cls._construct(
            operators.and_,
            True_._singleton,
            False_._singleton,
            initial_clause,
            *clauses,
        )

    @classmethod
    def or_(
        cls,
        initial_clause: Union[
            Literal[False], _ColumnExpressionArgument[bool], _NoArg
        ] = _NoArg.NO_ARG,
        *clauses: _ColumnExpressionArgument[bool],
    ) -> ColumnElement[bool]:
        """Produce a conjunction of expressions joined by ``OR``.

        See :func:`_sql.or_` for full documentation.
        """
        return cls._construct(
            operators.or_,
            False_._singleton,
            True_._singleton,
            initial_clause,
            *clauses,
        )

    @property
    def _select_iterable(self) -> _SelectIterable:
        return (self,)

    def self_group(self, against=None):
        if not self.clauses:
            return self
        else:
            return super().self_group(against=against)


and_ = BooleanClauseList.and_
or_ = BooleanClauseList.or_


class Tuple(ClauseList, ColumnElement[typing_Tuple[Any, ...]]):
    """Represent a SQL tuple."""

    __visit_name__ = "tuple"

    _traverse_internals: _TraverseInternalsType = (
        ClauseList._traverse_internals + []
    )

    type: TupleType

    @util.preload_module("sqlalchemy.sql.sqltypes")
    def __init__(
        self,
        *clauses: _ColumnExpressionArgument[Any],
        types: Optional[Sequence[_TypeEngineArgument[Any]]] = None,
    ):
        sqltypes = util.preloaded.sql_sqltypes

        if types is None:
            init_clauses: List[ColumnElement[Any]] = [
                coercions.expect(roles.ExpressionElementRole, c)
                for c in clauses
            ]
        else:
            if len(types) != len(clauses):
                raise exc.ArgumentError(
                    "Wrong number of elements for %d-tuple: %r "
                    % (len(types), clauses)
                )
            init_clauses = [
                coercions.expect(
                    roles.ExpressionElementRole,
                    c,
                    type_=typ if not typ._isnull else None,
                )
                for typ, c in zip(types, clauses)
            ]

        self.type = sqltypes.TupleType(*[arg.type for arg in init_clauses])
        super().__init__(*init_clauses)

    @property
    def _select_iterable(self) -> _SelectIterable:
        return (self,)

    def _bind_param(self, operator, obj, type_=None, expanding=False):
        if expanding:
            return BindParameter(
                None,
                value=obj,
                _compared_to_operator=operator,
                unique=True,
                expanding=True,
                type_=type_,
                _compared_to_type=self.type,
            )
        else:
            return Tuple(
                *[
                    BindParameter(
                        None,
                        o,
                        _compared_to_operator=operator,
                        _compared_to_type=compared_to_type,
                        unique=True,
                        type_=type_,
                    )
                    for o, compared_to_type in zip(obj, self.type.types)
                ]
            )

    def self_group(self, against=None):
        # Tuple is parenthesized by definition.
        return self


class Case(ColumnElement[_T]):
    """Represent a ``CASE`` expression.

    :class:`.Case` is produced using the :func:`.case` factory function,
    as in::

        from sqlalchemy import case

        stmt = select(users_table).\
                    where(
                        case(
                            (users_table.c.name == 'wendy', 'W'),
                            (users_table.c.name == 'jack', 'J'),
                            else_='E'
                        )
                    )

    Details on :class:`.Case` usage is at :func:`.case`.

    .. seealso::

        :func:`.case`

    """

    __visit_name__ = "case"

    _traverse_internals: _TraverseInternalsType = [
        ("value", InternalTraversal.dp_clauseelement),
        ("whens", InternalTraversal.dp_clauseelement_tuples),
        ("else_", InternalTraversal.dp_clauseelement),
    ]

    # for case(), the type is derived from the whens.  so for the moment
    # users would have to cast() the case to get a specific type

    whens: List[typing_Tuple[ColumnElement[bool], ColumnElement[_T]]]
    else_: Optional[ColumnElement[_T]]
    value: Optional[ColumnElement[Any]]

    def __init__(
        self,
        *whens: Union[
            typing_Tuple[_ColumnExpressionArgument[bool], Any],
            Mapping[Any, Any],
        ],
        value: Optional[Any] = None,
        else_: Optional[Any] = None,
    ):
        new_whens: Iterable[Any] = coercions._expression_collection_was_a_list(
            "whens", "case", whens
        )
        try:
            new_whens = util.dictlike_iteritems(new_whens)
        except TypeError:
            pass

        whenlist = [
            (
                coercions.expect(
                    roles.ExpressionElementRole,
                    c,
                    apply_propagate_attrs=self,
                ).self_group(),
                coercions.expect(roles.ExpressionElementRole, r),
            )
            for (c, r) in new_whens
        ]

        if whenlist:
            type_ = whenlist[-1][-1].type
        else:
            type_ = None

        if value is None:
            self.value = None
        else:
            self.value = coercions.expect(roles.ExpressionElementRole, value)

        self.type = cast(_T, type_)
        self.whens = whenlist

        if else_ is not None:
            self.else_ = coercions.expect(roles.ExpressionElementRole, else_)
        else:
            self.else_ = None

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return list(
            itertools.chain(*[x._from_objects for x in self.get_children()])
        )


class Cast(WrapsColumnExpression[_T]):
    """Represent a ``CAST`` expression.

    :class:`.Cast` is produced using the :func:`.cast` factory function,
    as in::

        from sqlalchemy import cast, Numeric

        stmt = select(cast(product_table.c.unit_price, Numeric(10, 4)))

    Details on :class:`.Cast` usage is at :func:`.cast`.

    .. seealso::

        :ref:`tutorial_casts`

        :func:`.cast`

        :func:`.try_cast`

        :func:`.type_coerce` - an alternative to CAST that coerces the type
        on the Python side only, which is often sufficient to generate the
        correct SQL and data coercion.

    """

    __visit_name__ = "cast"

    _traverse_internals: _TraverseInternalsType = [
        ("clause", InternalTraversal.dp_clauseelement),
        ("type", InternalTraversal.dp_type),
    ]

    clause: ColumnElement[Any]
    type: TypeEngine[_T]
    typeclause: TypeClause

    def __init__(
        self,
        expression: _ColumnExpressionArgument[Any],
        type_: _TypeEngineArgument[_T],
    ):
        self.type = type_api.to_instance(type_)
        self.clause = coercions.expect(
            roles.ExpressionElementRole,
            expression,
            type_=self.type,
            apply_propagate_attrs=self,
        )
        self.typeclause = TypeClause(self.type)

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return self.clause._from_objects

    @property
    def wrapped_column_expression(self):
        return self.clause


class TryCast(Cast[_T]):
    """Represent a TRY_CAST expression.

    Details on :class:`.TryCast` usage is at :func:`.try_cast`.

    .. seealso::

        :func:`.try_cast`

        :ref:`tutorial_casts`
    """

    __visit_name__ = "try_cast"
    inherit_cache = True


class TypeCoerce(WrapsColumnExpression[_T]):
    """Represent a Python-side type-coercion wrapper.

    :class:`.TypeCoerce` supplies the :func:`_expression.type_coerce`
    function; see that function for usage details.

    .. seealso::

        :func:`_expression.type_coerce`

        :func:`.cast`

    """

    __visit_name__ = "type_coerce"

    _traverse_internals: _TraverseInternalsType = [
        ("clause", InternalTraversal.dp_clauseelement),
        ("type", InternalTraversal.dp_type),
    ]

    clause: ColumnElement[Any]
    type: TypeEngine[_T]

    def __init__(
        self,
        expression: _ColumnExpressionArgument[Any],
        type_: _TypeEngineArgument[_T],
    ):
        self.type = type_api.to_instance(type_)
        self.clause = coercions.expect(
            roles.ExpressionElementRole,
            expression,
            type_=self.type,
            apply_propagate_attrs=self,
        )

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return self.clause._from_objects

    @HasMemoized.memoized_attribute
    def typed_expression(self):
        if isinstance(self.clause, BindParameter):
            bp = self.clause._clone()
            bp.type = self.type
            return bp
        else:
            return self.clause

    @property
    def wrapped_column_expression(self):
        return self.clause

    def self_group(self, against=None):
        grouped = self.clause.self_group(against=against)
        if grouped is not self.clause:
            return TypeCoerce(grouped, self.type)
        else:
            return self


class Extract(ColumnElement[int]):
    """Represent a SQL EXTRACT clause, ``extract(field FROM expr)``."""

    __visit_name__ = "extract"

    _traverse_internals: _TraverseInternalsType = [
        ("expr", InternalTraversal.dp_clauseelement),
        ("field", InternalTraversal.dp_string),
    ]

    expr: ColumnElement[Any]
    field: str

    def __init__(self, field: str, expr: _ColumnExpressionArgument[Any]):
        self.type = type_api.INTEGERTYPE
        self.field = field
        self.expr = coercions.expect(roles.ExpressionElementRole, expr)

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return self.expr._from_objects


class _label_reference(ColumnElement[_T]):
    """Wrap a column expression as it appears in a 'reference' context.

    This expression is any that includes an _order_by_label_element,
    which is a Label, or a DESC / ASC construct wrapping a Label.

    The production of _label_reference() should occur when an expression
    is added to this context; this includes the ORDER BY or GROUP BY of a
    SELECT statement, as well as a few other places, such as the ORDER BY
    within an OVER clause.

    """

    __visit_name__ = "label_reference"

    _traverse_internals: _TraverseInternalsType = [
        ("element", InternalTraversal.dp_clauseelement)
    ]

    element: ColumnElement[_T]

    def __init__(self, element: ColumnElement[_T]):
        self.element = element

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return []


class _textual_label_reference(ColumnElement[Any]):
    __visit_name__ = "textual_label_reference"

    _traverse_internals: _TraverseInternalsType = [
        ("element", InternalTraversal.dp_string)
    ]

    def __init__(self, element: str):
        self.element = element

    @util.memoized_property
    def _text_clause(self) -> TextClause:
        return TextClause(self.element)


class UnaryExpression(ColumnElement[_T]):
    """Define a 'unary' expression.

    A unary expression has a single column expression
    and an operator.  The operator can be placed on the left
    (where it is called the 'operator') or right (where it is called the
    'modifier') of the column expression.

    :class:`.UnaryExpression` is the basis for several unary operators
    including those used by :func:`.desc`, :func:`.asc`, :func:`.distinct`,
    :func:`.nulls_first` and :func:`.nulls_last`.

    """

    __visit_name__ = "unary"

    _traverse_internals: _TraverseInternalsType = [
        ("element", InternalTraversal.dp_clauseelement),
        ("operator", InternalTraversal.dp_operator),
        ("modifier", InternalTraversal.dp_operator),
    ]

    element: ClauseElement

    def __init__(
        self,
        element: ColumnElement[Any],
        operator: Optional[OperatorType] = None,
        modifier: Optional[OperatorType] = None,
        type_: Optional[_TypeEngineArgument[_T]] = None,
        wraps_column_expression: bool = False,
    ):
        self.operator = operator
        self.modifier = modifier
        self._propagate_attrs = element._propagate_attrs
        self.element = element.self_group(
            against=self.operator or self.modifier
        )

        # if type is None, we get NULLTYPE, which is our _T.  But I don't
        # know how to get the overloads to express that correctly
        self.type = type_api.to_instance(type_)  # type: ignore

        self.wraps_column_expression = wraps_column_expression

    @classmethod
    def _create_nulls_first(
        cls,
        column: _ColumnExpressionArgument[_T],
    ) -> UnaryExpression[_T]:
        return UnaryExpression(
            coercions.expect(roles.ByOfRole, column),
            modifier=operators.nulls_first_op,
            wraps_column_expression=False,
        )

    @classmethod
    def _create_nulls_last(
        cls,
        column: _ColumnExpressionArgument[_T],
    ) -> UnaryExpression[_T]:
        return UnaryExpression(
            coercions.expect(roles.ByOfRole, column),
            modifier=operators.nulls_last_op,
            wraps_column_expression=False,
        )

    @classmethod
    def _create_desc(
        cls, column: _ColumnExpressionOrStrLabelArgument[_T]
    ) -> UnaryExpression[_T]:
        return UnaryExpression(
            coercions.expect(roles.ByOfRole, column),
            modifier=operators.desc_op,
            wraps_column_expression=False,
        )

    @classmethod
    def _create_asc(
        cls,
        column: _ColumnExpressionOrStrLabelArgument[_T],
    ) -> UnaryExpression[_T]:
        return UnaryExpression(
            coercions.expect(roles.ByOfRole, column),
            modifier=operators.asc_op,
            wraps_column_expression=False,
        )

    @classmethod
    def _create_distinct(
        cls,
        expr: _ColumnExpressionArgument[_T],
    ) -> UnaryExpression[_T]:
        col_expr: ColumnElement[_T] = coercions.expect(
            roles.ExpressionElementRole, expr
        )
        return UnaryExpression(
            col_expr,
            operator=operators.distinct_op,
            type_=col_expr.type,
            wraps_column_expression=False,
        )

    @classmethod
    def _create_bitwise_not(
        cls,
        expr: _ColumnExpressionArgument[_T],
    ) -> UnaryExpression[_T]:
        col_expr: ColumnElement[_T] = coercions.expect(
            roles.ExpressionElementRole, expr
        )
        return UnaryExpression(
            col_expr,
            operator=operators.bitwise_not_op,
            type_=col_expr.type,
            wraps_column_expression=False,
        )

    @property
    def _order_by_label_element(self) -> Optional[Label[Any]]:
        if self.modifier in (operators.desc_op, operators.asc_op):
            return self.element._order_by_label_element
        else:
            return None

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return self.element._from_objects

    def _negate(self):
        if self.type._type_affinity is type_api.BOOLEANTYPE._type_affinity:
            return UnaryExpression(
                self.self_group(against=operators.inv),
                operator=operators.inv,
                type_=type_api.BOOLEANTYPE,
                wraps_column_expression=self.wraps_column_expression,
            )
        else:
            return ClauseElement._negate(self)

    def self_group(self, against=None):
        if self.operator and operators.is_precedent(self.operator, against):
            return Grouping(self)
        else:
            return self


class CollectionAggregate(UnaryExpression[_T]):
    """Forms the basis for right-hand collection operator modifiers
    ANY and ALL.

    The ANY and ALL keywords are available in different ways on different
    backends.  On PostgreSQL, they only work for an ARRAY type.  On
    MySQL, they only work for subqueries.

    """

    inherit_cache = True
    _is_collection_aggregate = True

    @classmethod
    def _create_any(
        cls, expr: _ColumnExpressionArgument[_T]
    ) -> CollectionAggregate[bool]:
        col_expr: ColumnElement[_T] = coercions.expect(
            roles.ExpressionElementRole,
            expr,
        )
        col_expr = col_expr.self_group()
        return CollectionAggregate(
            col_expr,
            operator=operators.any_op,
            type_=type_api.BOOLEANTYPE,
            wraps_column_expression=False,
        )

    @classmethod
    def _create_all(
        cls, expr: _ColumnExpressionArgument[_T]
    ) -> CollectionAggregate[bool]:
        col_expr: ColumnElement[_T] = coercions.expect(
            roles.ExpressionElementRole,
            expr,
        )
        col_expr = col_expr.self_group()
        return CollectionAggregate(
            col_expr,
            operator=operators.all_op,
            type_=type_api.BOOLEANTYPE,
            wraps_column_expression=False,
        )

    # operate and reverse_operate are hardwired to
    # dispatch onto the type comparator directly, so that we can
    # ensure "reversed" behavior.
    def operate(self, op, *other, **kwargs):
        if not operators.is_comparison(op):
            raise exc.ArgumentError(
                "Only comparison operators may be used with ANY/ALL"
            )
        kwargs["reverse"] = True
        return self.comparator.operate(operators.mirror(op), *other, **kwargs)

    def reverse_operate(self, op, other, **kwargs):
        # comparison operators should never call reverse_operate
        assert not operators.is_comparison(op)
        raise exc.ArgumentError(
            "Only comparison operators may be used with ANY/ALL"
        )


class AsBoolean(WrapsColumnExpression[bool], UnaryExpression[bool]):
    inherit_cache = True

    def __init__(self, element, operator, negate):
        self.element = element
        self.type = type_api.BOOLEANTYPE
        self.operator = operator
        self.negate = negate
        self.modifier = None
        self.wraps_column_expression = True
        self._is_implicitly_boolean = element._is_implicitly_boolean

    @property
    def wrapped_column_expression(self):
        return self.element

    def self_group(self, against=None):
        return self

    def _negate(self):
        if isinstance(self.element, (True_, False_)):
            return self.element._negate()
        else:
            return AsBoolean(self.element, self.negate, self.operator)


class BinaryExpression(OperatorExpression[_T]):
    """Represent an expression that is ``LEFT <operator> RIGHT``.

    A :class:`.BinaryExpression` is generated automatically
    whenever two column expressions are used in a Python binary expression:

    .. sourcecode:: pycon+sql

        >>> from sqlalchemy.sql import column
        >>> column('a') + column('b')
        <sqlalchemy.sql.expression.BinaryExpression object at 0x101029dd0>
        >>> print(column('a') + column('b'))
        {printsql}a + b

    """

    __visit_name__ = "binary"

    _traverse_internals: _TraverseInternalsType = [
        ("left", InternalTraversal.dp_clauseelement),
        ("right", InternalTraversal.dp_clauseelement),
        ("operator", InternalTraversal.dp_operator),
        ("negate", InternalTraversal.dp_operator),
        ("modifiers", InternalTraversal.dp_plain_dict),
        (
            "type",
            InternalTraversal.dp_type,
        ),
    ]

    _cache_key_traversal = [
        ("left", InternalTraversal.dp_clauseelement),
        ("right", InternalTraversal.dp_clauseelement),
        ("operator", InternalTraversal.dp_operator),
        ("modifiers", InternalTraversal.dp_plain_dict),
        # "type" affects JSON CAST operators, so while redundant in most cases,
        # is needed for that one
        (
            "type",
            InternalTraversal.dp_type,
        ),
    ]

    _is_implicitly_boolean = True
    """Indicates that any database will know this is a boolean expression
    even if the database does not have an explicit boolean datatype.

    """

    modifiers: Optional[Mapping[str, Any]]

    left: ColumnElement[Any]
    right: ColumnElement[Any]

    def __init__(
        self,
        left: ColumnElement[Any],
        right: ColumnElement[Any],
        operator: OperatorType,
        type_: Optional[_TypeEngineArgument[_T]] = None,
        negate: Optional[OperatorType] = None,
        modifiers: Optional[Mapping[str, Any]] = None,
    ):
        # allow compatibility with libraries that
        # refer to BinaryExpression directly and pass strings
        if isinstance(operator, str):
            operator = operators.custom_op(operator)
        self._orig = (left.__hash__(), right.__hash__())
        self._propagate_attrs = left._propagate_attrs or right._propagate_attrs
        self.left = left.self_group(against=operator)
        self.right = right.self_group(against=operator)
        self.operator = operator

        # if type is None, we get NULLTYPE, which is our _T.  But I don't
        # know how to get the overloads to express that correctly
        self.type = type_api.to_instance(type_)  # type: ignore

        self.negate = negate
        self._is_implicitly_boolean = operators.is_boolean(operator)

        if modifiers is None:
            self.modifiers = {}
        else:
            self.modifiers = modifiers

    @property
    def _flattened_operator_clauses(
        self,
    ) -> typing_Tuple[ColumnElement[Any], ...]:
        return (self.left, self.right)

    def __bool__(self):
        """Implement Python-side "bool" for BinaryExpression as a
        simple "identity" check for the left and right attributes,
        if the operator is "eq" or "ne".  Otherwise the expression
        continues to not support "bool" like all other column expressions.

        The rationale here is so that ColumnElement objects can be hashable.
        What?  Well, suppose you do this::

            c1, c2 = column('x'), column('y')
            s1 = set([c1, c2])

        We do that **a lot**, columns inside of sets is an extremely basic
        thing all over the ORM for example.

        So what happens if we do this? ::

            c1 in s1

        Hashing means it will normally use ``__hash__()`` of the object,
        but in case of hash collision, it's going to also do ``c1 == c1``
        and/or ``c1 == c2`` inside.  Those operations need to return a
        True/False value.   But because we override ``==`` and ``!=``, they're
        going to get a BinaryExpression.  Hence we implement ``__bool__`` here
        so that these comparisons behave in this particular context mostly
        like regular object comparisons.  Thankfully Python is OK with
        that!  Otherwise we'd have to use special set classes for columns
        (which we used to do, decades ago).

        """
        if self.operator in (operators.eq, operators.ne):
            # this is using the eq/ne operator given int hash values,
            # rather than Operator, so that "bool" can be based on
            # identity
            return self.operator(*self._orig)  # type: ignore
        else:
            raise TypeError("Boolean value of this clause is not defined")

    if typing.TYPE_CHECKING:

        def __invert__(
            self: BinaryExpression[_T],
        ) -> BinaryExpression[_T]:
            ...

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return self.left._from_objects + self.right._from_objects

    def _negate(self):
        if self.negate is not None:
            return BinaryExpression(
                self.left,
                self.right._negate_in_binary(self.negate, self.operator),
                self.negate,
                negate=self.operator,
                type_=self.type,
                modifiers=self.modifiers,
            )
        else:
            return self.self_group()._negate()


class Slice(ColumnElement[Any]):
    """Represent SQL for a Python array-slice object.

    This is not a specific SQL construct at this level, but
    may be interpreted by specific dialects, e.g. PostgreSQL.

    """

    __visit_name__ = "slice"

    _traverse_internals: _TraverseInternalsType = [
        ("start", InternalTraversal.dp_clauseelement),
        ("stop", InternalTraversal.dp_clauseelement),
        ("step", InternalTraversal.dp_clauseelement),
    ]

    def __init__(self, start, stop, step, _name=None):
        self.start = coercions.expect(
            roles.ExpressionElementRole,
            start,
            name=_name,
            type_=type_api.INTEGERTYPE,
        )
        self.stop = coercions.expect(
            roles.ExpressionElementRole,
            stop,
            name=_name,
            type_=type_api.INTEGERTYPE,
        )
        self.step = coercions.expect(
            roles.ExpressionElementRole,
            step,
            name=_name,
            type_=type_api.INTEGERTYPE,
        )
        self.type = type_api.NULLTYPE

    def self_group(self, against=None):
        assert against is operator.getitem
        return self


class IndexExpression(BinaryExpression[Any]):
    """Represent the class of expressions that are like an "index"
    operation."""

    inherit_cache = True


class GroupedElement(DQLDMLClauseElement):
    """Represent any parenthesized expression"""

    __visit_name__ = "grouping"

    element: ClauseElement

    def self_group(self, against=None):
        return self

    def _ungroup(self):
        return self.element._ungroup()


class Grouping(GroupedElement, ColumnElement[_T]):
    """Represent a grouping within a column expression"""

    _traverse_internals: _TraverseInternalsType = [
        ("element", InternalTraversal.dp_clauseelement),
        ("type", InternalTraversal.dp_type),
    ]

    _cache_key_traversal = [
        ("element", InternalTraversal.dp_clauseelement),
    ]

    element: Union[TextClause, ClauseList, ColumnElement[_T]]

    def __init__(
        self, element: Union[TextClause, ClauseList, ColumnElement[_T]]
    ):
        self.element = element

        # nulltype assignment issue
        self.type = getattr(element, "type", type_api.NULLTYPE)  # type: ignore
        self._propagate_attrs = element._propagate_attrs

    def _with_binary_element_type(self, type_):
        return self.__class__(self.element._with_binary_element_type(type_))

    @util.memoized_property
    def _is_implicitly_boolean(self):
        return self.element._is_implicitly_boolean

    @util.non_memoized_property
    def _tq_label(self) -> Optional[str]:
        return (
            getattr(self.element, "_tq_label", None) or self._anon_name_label
        )

    @util.non_memoized_property
    def _proxies(self) -> List[ColumnElement[Any]]:
        if isinstance(self.element, ColumnElement):
            return [self.element]
        else:
            return []

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return self.element._from_objects

    def __getattr__(self, attr):
        return getattr(self.element, attr)

    def __getstate__(self):
        return {"element": self.element, "type": self.type}

    def __setstate__(self, state):
        self.element = state["element"]
        self.type = state["type"]


class _OverRange(IntEnum):
    RANGE_UNBOUNDED = 0
    RANGE_CURRENT = 1


RANGE_UNBOUNDED = _OverRange.RANGE_UNBOUNDED
RANGE_CURRENT = _OverRange.RANGE_CURRENT


class Over(ColumnElement[_T]):
    """Represent an OVER clause.

    This is a special operator against a so-called
    "window" function, as well as any aggregate function,
    which produces results relative to the result set
    itself.  Most modern SQL backends now support window functions.

    """

    __visit_name__ = "over"

    _traverse_internals: _TraverseInternalsType = [
        ("element", InternalTraversal.dp_clauseelement),
        ("order_by", InternalTraversal.dp_clauseelement),
        ("partition_by", InternalTraversal.dp_clauseelement),
        ("range_", InternalTraversal.dp_plain_obj),
        ("rows", InternalTraversal.dp_plain_obj),
    ]

    order_by: Optional[ClauseList] = None
    partition_by: Optional[ClauseList] = None

    element: ColumnElement[_T]
    """The underlying expression object to which this :class:`.Over`
    object refers."""

    range_: Optional[typing_Tuple[int, int]]

    def __init__(
        self,
        element: ColumnElement[_T],
        partition_by: Optional[_ByArgument] = None,
        order_by: Optional[_ByArgument] = None,
        range_: Optional[typing_Tuple[Optional[int], Optional[int]]] = None,
        rows: Optional[typing_Tuple[Optional[int], Optional[int]]] = None,
    ):
        self.element = element
        if order_by is not None:
            self.order_by = ClauseList(
                *util.to_list(order_by), _literal_as_text_role=roles.ByOfRole
            )
        if partition_by is not None:
            self.partition_by = ClauseList(
                *util.to_list(partition_by),
                _literal_as_text_role=roles.ByOfRole,
            )

        if range_:
            self.range_ = self._interpret_range(range_)
            if rows:
                raise exc.ArgumentError(
                    "'range_' and 'rows' are mutually exclusive"
                )
            else:
                self.rows = None
        elif rows:
            self.rows = self._interpret_range(rows)
            self.range_ = None
        else:
            self.rows = self.range_ = None

    def __reduce__(self):
        return self.__class__, (
            self.element,
            self.partition_by,
            self.order_by,
            self.range_,
            self.rows,
        )

    def _interpret_range(
        self, range_: typing_Tuple[Optional[int], Optional[int]]
    ) -> typing_Tuple[int, int]:
        if not isinstance(range_, tuple) or len(range_) != 2:
            raise exc.ArgumentError("2-tuple expected for range/rows")

        lower: int
        upper: int

        if range_[0] is None:
            lower = RANGE_UNBOUNDED
        else:
            try:
                lower = int(range_[0])
            except ValueError as err:
                raise exc.ArgumentError(
                    "Integer or None expected for range value"
                ) from err
            else:
                if lower == 0:
                    lower = RANGE_CURRENT

        if range_[1] is None:
            upper = RANGE_UNBOUNDED
        else:
            try:
                upper = int(range_[1])
            except ValueError as err:
                raise exc.ArgumentError(
                    "Integer or None expected for range value"
                ) from err
            else:
                if upper == 0:
                    upper = RANGE_CURRENT

        return lower, upper

    if not TYPE_CHECKING:

        @util.memoized_property
        def type(self) -> TypeEngine[_T]:  # noqa: A001
            return self.element.type

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return list(
            itertools.chain(
                *[
                    c._from_objects
                    for c in (self.element, self.partition_by, self.order_by)
                    if c is not None
                ]
            )
        )


class WithinGroup(ColumnElement[_T]):
    """Represent a WITHIN GROUP (ORDER BY) clause.

    This is a special operator against so-called
    "ordered set aggregate" and "hypothetical
    set aggregate" functions, including ``percentile_cont()``,
    ``rank()``, ``dense_rank()``, etc.

    It's supported only by certain database backends, such as PostgreSQL,
    Oracle and MS SQL Server.

    The :class:`.WithinGroup` construct extracts its type from the
    method :meth:`.FunctionElement.within_group_type`.  If this returns
    ``None``, the function's ``.type`` is used.

    """

    __visit_name__ = "withingroup"

    _traverse_internals: _TraverseInternalsType = [
        ("element", InternalTraversal.dp_clauseelement),
        ("order_by", InternalTraversal.dp_clauseelement),
    ]

    order_by: Optional[ClauseList] = None

    def __init__(
        self,
        element: FunctionElement[_T],
        *order_by: _ColumnExpressionArgument[Any],
    ):
        self.element = element
        if order_by is not None:
            self.order_by = ClauseList(
                *util.to_list(order_by), _literal_as_text_role=roles.ByOfRole
            )

    def __reduce__(self):
        return self.__class__, (self.element,) + (
            tuple(self.order_by) if self.order_by is not None else ()
        )

    def over(self, partition_by=None, order_by=None, range_=None, rows=None):
        """Produce an OVER clause against this :class:`.WithinGroup`
        construct.

        This function has the same signature as that of
        :meth:`.FunctionElement.over`.

        """
        return Over(
            self,
            partition_by=partition_by,
            order_by=order_by,
            range_=range_,
            rows=rows,
        )

    if not TYPE_CHECKING:

        @util.memoized_property
        def type(self) -> TypeEngine[_T]:  # noqa: A001
            wgt = self.element.within_group_type(self)
            if wgt is not None:
                return wgt
            else:
                return self.element.type

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return list(
            itertools.chain(
                *[
                    c._from_objects
                    for c in (self.element, self.order_by)
                    if c is not None
                ]
            )
        )


class FunctionFilter(ColumnElement[_T]):
    """Represent a function FILTER clause.

    This is a special operator against aggregate and window functions,
    which controls which rows are passed to it.
    It's supported only by certain database backends.

    Invocation of :class:`.FunctionFilter` is via
    :meth:`.FunctionElement.filter`::

        func.count(1).filter(True)

    .. seealso::

        :meth:`.FunctionElement.filter`

    """

    __visit_name__ = "funcfilter"

    _traverse_internals: _TraverseInternalsType = [
        ("func", InternalTraversal.dp_clauseelement),
        ("criterion", InternalTraversal.dp_clauseelement),
    ]

    criterion: Optional[ColumnElement[bool]] = None

    def __init__(
        self,
        func: FunctionElement[_T],
        *criterion: _ColumnExpressionArgument[bool],
    ):
        self.func = func
        self.filter(*criterion)

    def filter(self, *criterion: _ColumnExpressionArgument[bool]) -> Self:
        """Produce an additional FILTER against the function.

        This method adds additional criteria to the initial criteria
        set up by :meth:`.FunctionElement.filter`.

        Multiple criteria are joined together at SQL render time
        via ``AND``.


        """

        for crit in list(criterion):
            crit = coercions.expect(roles.WhereHavingRole, crit)

            if self.criterion is not None:
                self.criterion = self.criterion & crit
            else:
                self.criterion = crit

        return self

    def over(
        self,
        partition_by: Optional[
            Union[
                Iterable[_ColumnExpressionArgument[Any]],
                _ColumnExpressionArgument[Any],
            ]
        ] = None,
        order_by: Optional[
            Union[
                Iterable[_ColumnExpressionArgument[Any]],
                _ColumnExpressionArgument[Any],
            ]
        ] = None,
        range_: Optional[typing_Tuple[Optional[int], Optional[int]]] = None,
        rows: Optional[typing_Tuple[Optional[int], Optional[int]]] = None,
    ) -> Over[_T]:
        """Produce an OVER clause against this filtered function.

        Used against aggregate or so-called "window" functions,
        for database backends that support window functions.

        The expression::

            func.rank().filter(MyClass.y > 5).over(order_by='x')

        is shorthand for::

            from sqlalchemy import over, funcfilter
            over(funcfilter(func.rank(), MyClass.y > 5), order_by='x')

        See :func:`_expression.over` for a full description.

        """
        return Over(
            self,
            partition_by=partition_by,
            order_by=order_by,
            range_=range_,
            rows=rows,
        )

    def self_group(
        self, against: Optional[OperatorType] = None
    ) -> Union[Self, Grouping[_T]]:
        if operators.is_precedent(operators.filter_op, against):
            return Grouping(self)
        else:
            return self

    if not TYPE_CHECKING:

        @util.memoized_property
        def type(self) -> TypeEngine[_T]:  # noqa: A001
            return self.func.type

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return list(
            itertools.chain(
                *[
                    c._from_objects
                    for c in (self.func, self.criterion)
                    if c is not None
                ]
            )
        )


class NamedColumn(KeyedColumnElement[_T]):
    is_literal = False
    table: Optional[FromClause] = None
    name: str
    key: str

    def _compare_name_for_result(self, other):
        return (hasattr(other, "name") and self.name == other.name) or (
            hasattr(other, "_label") and self._label == other._label
        )

    @util.ro_memoized_property
    def description(self) -> str:
        return self.name

    @HasMemoized.memoized_attribute
    def _tq_key_label(self):
        """table qualified label based on column key.

        for table-bound columns this is <tablename>_<column key/proxy key>;

        all other expressions it resolves to key/proxy key.

        """
        proxy_key = self._proxy_key
        if proxy_key and proxy_key != self.name:
            return self._gen_tq_label(proxy_key)
        else:
            return self._tq_label

    @HasMemoized.memoized_attribute
    def _tq_label(self) -> Optional[str]:
        """table qualified label based on column name.

        for table-bound columns this is <tablename>_<columnname>; all other
        expressions it resolves to .name.

        """
        return self._gen_tq_label(self.name)

    @HasMemoized.memoized_attribute
    def _render_label_in_columns_clause(self):
        return True

    @HasMemoized.memoized_attribute
    def _non_anon_label(self):
        return self.name

    def _gen_tq_label(
        self, name: str, dedupe_on_key: bool = True
    ) -> Optional[str]:
        return name

    def _bind_param(
        self,
        operator: OperatorType,
        obj: Any,
        type_: Optional[TypeEngine[_T]] = None,
        expanding: bool = False,
    ) -> BindParameter[_T]:
        return BindParameter(
            self.key,
            obj,
            _compared_to_operator=operator,
            _compared_to_type=self.type,
            type_=type_,
            unique=True,
            expanding=expanding,
        )

    def _make_proxy(
        self,
        selectable: FromClause,
        *,
        name: Optional[str] = None,
        key: Optional[str] = None,
        name_is_truncatable: bool = False,
        compound_select_cols: Optional[Sequence[ColumnElement[Any]]] = None,
        disallow_is_literal: bool = False,
        **kw: Any,
    ) -> typing_Tuple[str, ColumnClause[_T]]:
        c = ColumnClause(
            coercions.expect(roles.TruncatedLabelRole, name or self.name)
            if name_is_truncatable
            else (name or self.name),
            type_=self.type,
            _selectable=selectable,
            is_literal=False,
        )

        c._propagate_attrs = selectable._propagate_attrs
        if name is None:
            c.key = self.key
        if compound_select_cols:
            c._proxies = list(compound_select_cols)
        else:
            c._proxies = [self]

        if selectable._is_clone_of is not None:
            c._is_clone_of = selectable._is_clone_of.columns.get(c.key)
        return c.key, c


class Label(roles.LabeledColumnExprRole[_T], NamedColumn[_T]):
    """Represents a column label (AS).

    Represent a label, as typically applied to any column-level
    element using the ``AS`` sql keyword.

    """

    __visit_name__ = "label"

    _traverse_internals: _TraverseInternalsType = [
        ("name", InternalTraversal.dp_anon_name),
        ("type", InternalTraversal.dp_type),
        ("_element", InternalTraversal.dp_clauseelement),
    ]

    _cache_key_traversal = [
        ("name", InternalTraversal.dp_anon_name),
        ("_element", InternalTraversal.dp_clauseelement),
    ]

    _element: ColumnElement[_T]
    name: str

    def __init__(
        self,
        name: Optional[str],
        element: _ColumnExpressionArgument[_T],
        type_: Optional[_TypeEngineArgument[_T]] = None,
    ):
        orig_element = element
        element = coercions.expect(
            roles.ExpressionElementRole,
            element,
            apply_propagate_attrs=self,
        )
        while isinstance(element, Label):
            # TODO: this is only covered in test_text.py, but nothing
            # fails if it's removed.  determine rationale
            element = element.element

        if name:
            self.name = name
        else:
            self.name = _anonymous_label.safe_construct(
                id(self), getattr(element, "name", "anon")
            )
            if isinstance(orig_element, Label):
                # TODO: no coverage for this block, again would be in
                # test_text.py where the resolve_label concept is important
                self._resolve_label = orig_element._label

        self.key = self._tq_label = self._tq_key_label = self.name
        self._element = element

        self.type = (
            type_api.to_instance(type_)
            if type_ is not None
            else self._element.type
        )

        self._proxies = [element]

    def __reduce__(self):
        return self.__class__, (self.name, self._element, self.type)

    @HasMemoized.memoized_attribute
    def _render_label_in_columns_clause(self):
        return True

    def _bind_param(self, operator, obj, type_=None, expanding=False):
        return BindParameter(
            None,
            obj,
            _compared_to_operator=operator,
            type_=type_,
            _compared_to_type=self.type,
            unique=True,
            expanding=expanding,
        )

    @util.memoized_property
    def _is_implicitly_boolean(self):
        return self.element._is_implicitly_boolean

    @HasMemoized.memoized_attribute
    def _allow_label_resolve(self):
        return self.element._allow_label_resolve

    @property
    def _order_by_label_element(self):
        return self

    @HasMemoized.memoized_attribute
    def element(self) -> ColumnElement[_T]:
        return self._element.self_group(against=operators.as_)

    def self_group(self, against=None):
        return self._apply_to_inner(self._element.self_group, against=against)

    def _negate(self):
        return self._apply_to_inner(self._element._negate)

    def _apply_to_inner(self, fn, *arg, **kw):
        sub_element = fn(*arg, **kw)
        if sub_element is not self._element:
            return Label(self.name, sub_element, type_=self.type)
        else:
            return self

    @property
    def primary_key(self):
        return self.element.primary_key

    @property
    def foreign_keys(self):
        return self.element.foreign_keys

    def _copy_internals(
        self,
        *,
        clone: _CloneCallableType = _clone,
        anonymize_labels: bool = False,
        **kw: Any,
    ) -> None:
        self._reset_memoizations()
        self._element = clone(self._element, **kw)
        if anonymize_labels:
            self.name = _anonymous_label.safe_construct(
                id(self), getattr(self.element, "name", "anon")
            )
            self.key = self._tq_label = self._tq_key_label = self.name

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return self.element._from_objects

    def _make_proxy(
        self,
        selectable: FromClause,
        *,
        name: Optional[str] = None,
        compound_select_cols: Optional[Sequence[ColumnElement[Any]]] = None,
        **kw: Any,
    ) -> typing_Tuple[str, ColumnClause[_T]]:
        name = self.name if not name else name

        key, e = self.element._make_proxy(
            selectable,
            name=name,
            disallow_is_literal=True,
            name_is_truncatable=isinstance(name, _truncated_label),
            compound_select_cols=compound_select_cols,
        )

        # there was a note here to remove this assertion, which was here
        # to determine if we later could support a use case where
        # the key and name of a label are separate.  But I don't know what
        # that case was.  For now, this is an unexpected case that occurs
        # when a label name conflicts with other columns and select()
        # is attempting to disambiguate an explicit label, which is not what
        # the user would want.   See issue #6090.
        if key != self.name and not isinstance(self.name, _anonymous_label):
            raise exc.InvalidRequestError(
                "Label name %s is being renamed to an anonymous label due "
                "to disambiguation "
                "which is not supported right now.  Please use unique names "
                "for explicit labels." % (self.name)
            )

        e._propagate_attrs = selectable._propagate_attrs
        e._proxies.append(self)
        if self.type is not None:
            e.type = self.type

        return self.key, e


class ColumnClause(
    roles.DDLReferredColumnRole,
    roles.LabeledColumnExprRole[_T],
    roles.StrAsPlainColumnRole,
    Immutable,
    NamedColumn[_T],
):
    """Represents a column expression from any textual string.

    The :class:`.ColumnClause`, a lightweight analogue to the
    :class:`_schema.Column` class, is typically invoked using the
    :func:`_expression.column` function, as in::

        from sqlalchemy import column

        id, name = column("id"), column("name")
        stmt = select(id, name).select_from("user")

    The above statement would produce SQL like::

        SELECT id, name FROM user

    :class:`.ColumnClause` is the immediate superclass of the schema-specific
    :class:`_schema.Column` object.  While the :class:`_schema.Column`
    class has all the
    same capabilities as :class:`.ColumnClause`, the :class:`.ColumnClause`
    class is usable by itself in those cases where behavioral requirements
    are limited to simple SQL expression generation.  The object has none of
    the associations with schema-level metadata or with execution-time
    behavior that :class:`_schema.Column` does,
    so in that sense is a "lightweight"
    version of :class:`_schema.Column`.

    Full details on :class:`.ColumnClause` usage is at
    :func:`_expression.column`.

    .. seealso::

        :func:`_expression.column`

        :class:`_schema.Column`

    """

    table: Optional[FromClause]
    is_literal: bool

    __visit_name__ = "column"

    _traverse_internals: _TraverseInternalsType = [
        ("name", InternalTraversal.dp_anon_name),
        ("type", InternalTraversal.dp_type),
        ("table", InternalTraversal.dp_clauseelement),
        ("is_literal", InternalTraversal.dp_boolean),
    ]

    onupdate: Optional[DefaultGenerator] = None
    default: Optional[DefaultGenerator] = None
    server_default: Optional[FetchedValue] = None
    server_onupdate: Optional[FetchedValue] = None

    _is_multiparam_column = False

    @property
    def _is_star(self):
        return self.is_literal and self.name == "*"

    def __init__(
        self,
        text: str,
        type_: Optional[_TypeEngineArgument[_T]] = None,
        is_literal: bool = False,
        _selectable: Optional[FromClause] = None,
    ):
        self.key = self.name = text
        self.table = _selectable

        # if type is None, we get NULLTYPE, which is our _T.  But I don't
        # know how to get the overloads to express that correctly
        self.type = type_api.to_instance(type_)  # type: ignore

        self.is_literal = is_literal

    def get_children(self, *, column_tables=False, **kw):
        # override base get_children() to not return the Table
        # or selectable that is parent to this column.  Traversals
        # expect the columns of tables and subqueries to be leaf nodes.
        return []

    @property
    def entity_namespace(self):
        if self.table is not None:
            return self.table.entity_namespace
        else:
            return super().entity_namespace

    def _clone(self, detect_subquery_cols=False, **kw):
        if (
            detect_subquery_cols
            and self.table is not None
            and self.table._is_subquery
        ):
            clone = kw.pop("clone")
            table = clone(self.table, **kw)
            new = table.c.corresponding_column(self)
            return new

        return super()._clone(**kw)

    @HasMemoized_ro_memoized_attribute
    def _from_objects(self) -> List[FromClause]:
        t = self.table
        if t is not None:
            return [t]
        else:
            return []

    @HasMemoized.memoized_attribute
    def _render_label_in_columns_clause(self):
        return self.table is not None

    @property
    def _ddl_label(self):
        return self._gen_tq_label(self.name, dedupe_on_key=False)

    def _compare_name_for_result(self, other):
        if (
            self.is_literal
            or self.table is None
            or self.table._is_textual
            or not hasattr(other, "proxy_set")
            or (
                isinstance(other, ColumnClause)
                and (
                    other.is_literal
                    or other.table is None
                    or other.table._is_textual
                )
            )
        ):
            return (hasattr(other, "name") and self.name == other.name) or (
                hasattr(other, "_tq_label")
                and self._tq_label == other._tq_label
            )
        else:
            return other.proxy_set.intersection(self.proxy_set)

    def _gen_tq_label(
        self, name: str, dedupe_on_key: bool = True
    ) -> Optional[str]:
        """generate table-qualified label

        for a table-bound column this is <tablename>_<columnname>.

        used primarily for LABEL_STYLE_TABLENAME_PLUS_COL
        as well as the .columns collection on a Join object.

        """
        label: str
        t = self.table
        if self.is_literal:
            return None
        elif t is not None and is_named_from_clause(t):
            if has_schema_attr(t) and t.schema:
                label = t.schema.replace(".", "_") + "_" + t.name + "_" + name
            else:
                assert not TYPE_CHECKING or isinstance(t, NamedFromClause)
                label = t.name + "_" + name

            # propagate name quoting rules for labels.
            if is_quoted_name(name) and name.quote is not None:
                if is_quoted_name(label):
                    label.quote = name.quote
                else:
                    label = quoted_name(label, name.quote)
            elif is_quoted_name(t.name) and t.name.quote is not None:
                # can't get this situation to occur, so let's
                # assert false on it for now
                assert not isinstance(label, quoted_name)
                label = quoted_name(label, t.name.quote)

            if dedupe_on_key:
                # ensure the label name doesn't conflict with that of an
                # existing column.   note that this implies that any Column
                # must **not** set up its _label before its parent table has
                # all of its other Column objects set up.  There are several
                # tables in the test suite which will fail otherwise; example:
                # table "owner" has columns "name" and "owner_name".  Therefore
                # column owner.name cannot use the label "owner_name", it has
                # to be "owner_name_1".
                if label in t.c:
                    _label = label
                    counter = 1
                    while _label in t.c:
                        _label = label + "_" + str(counter)
                        counter += 1
                    label = _label

            return coercions.expect(roles.TruncatedLabelRole, label)

        else:
            return name

    def _make_proxy(
        self,
        selectable: FromClause,
        *,
        name: Optional[str] = None,
        key: Optional[str] = None,
        name_is_truncatable: bool = False,
        compound_select_cols: Optional[Sequence[ColumnElement[Any]]] = None,
        disallow_is_literal: bool = False,
        **kw: Any,
    ) -> typing_Tuple[str, ColumnClause[_T]]:
        # the "is_literal" flag normally should never be propagated; a proxied
        # column is always a SQL identifier and never the actual expression
        # being evaluated. however, there is a case where the "is_literal" flag
        # might be used to allow the given identifier to have a fixed quoting
        # pattern already, so maintain the flag for the proxy unless a
        # :class:`.Label` object is creating the proxy.  See [ticket:4730].
        is_literal = (
            not disallow_is_literal
            and self.is_literal
            and (
                # note this does not accommodate for quoted_name differences
                # right now
                name is None
                or name == self.name
            )
        )
        c = self._constructor(
            coercions.expect(roles.TruncatedLabelRole, name or self.name)
            if name_is_truncatable
            else (name or self.name),
            type_=self.type,
            _selectable=selectable,
            is_literal=is_literal,
        )
        c._propagate_attrs = selectable._propagate_attrs
        if name is None:
            c.key = self.key
        if compound_select_cols:
            c._proxies = list(compound_select_cols)
        else:
            c._proxies = [self]

        if selectable._is_clone_of is not None:
            c._is_clone_of = selectable._is_clone_of.columns.get(c.key)
        return c.key, c


class TableValuedColumn(NamedColumn[_T]):
    __visit_name__ = "table_valued_column"

    _traverse_internals: _TraverseInternalsType = [
        ("name", InternalTraversal.dp_anon_name),
        ("type", InternalTraversal.dp_type),
        ("scalar_alias", InternalTraversal.dp_clauseelement),
    ]

    def __init__(self, scalar_alias: NamedFromClause, type_: TypeEngine[_T]):
        self.scalar_alias = scalar_alias
        self.key = self.name = scalar_alias.name
        self.type = type_

    def _copy_internals(
        self, clone: _CloneCallableType = _clone, **kw: Any
    ) -> None:
        self.scalar_alias = clone(self.scalar_alias, **kw)
        self.key = self.name = self.scalar_alias.name

    @util.ro_non_memoized_property
    def _from_objects(self) -> List[FromClause]:
        return [self.scalar_alias]


class CollationClause(ColumnElement[str]):
    __visit_name__ = "collation"

    _traverse_internals: _TraverseInternalsType = [
        ("collation", InternalTraversal.dp_string)
    ]

    @classmethod
    def _create_collation_expression(
        cls, expression: _ColumnExpressionArgument[str], collation: str
    ) -> BinaryExpression[str]:
        expr = coercions.expect(roles.ExpressionElementRole[str], expression)
        return BinaryExpression(
            expr,
            CollationClause(collation),
            operators.collate,
            type_=expr.type,
        )

    def __init__(self, collation):
        self.collation = collation


class _IdentifiedClause(Executable, ClauseElement):
    __visit_name__ = "identified"

    def __init__(self, ident):
        self.ident = ident


class SavepointClause(_IdentifiedClause):
    __visit_name__ = "savepoint"
    inherit_cache = False


class RollbackToSavepointClause(_IdentifiedClause):
    __visit_name__ = "rollback_to_savepoint"
    inherit_cache = False


class ReleaseSavepointClause(_IdentifiedClause):
    __visit_name__ = "release_savepoint"
    inherit_cache = False


class quoted_name(util.MemoizedSlots, str):
    """Represent a SQL identifier combined with quoting preferences.

    :class:`.quoted_name` is a Python unicode/str subclass which
    represents a particular identifier name along with a
    ``quote`` flag.  This ``quote`` flag, when set to
    ``True`` or ``False``, overrides automatic quoting behavior
    for this identifier in order to either unconditionally quote
    or to not quote the name.  If left at its default of ``None``,
    quoting behavior is applied to the identifier on a per-backend basis
    based on an examination of the token itself.

    A :class:`.quoted_name` object with ``quote=True`` is also
    prevented from being modified in the case of a so-called
    "name normalize" option.  Certain database backends, such as
    Oracle, Firebird, and DB2 "normalize" case-insensitive names
    as uppercase.  The SQLAlchemy dialects for these backends
    convert from SQLAlchemy's lower-case-means-insensitive convention
    to the upper-case-means-insensitive conventions of those backends.
    The ``quote=True`` flag here will prevent this conversion from occurring
    to support an identifier that's quoted as all lower case against
    such a backend.

    The :class:`.quoted_name` object is normally created automatically
    when specifying the name for key schema constructs such as
    :class:`_schema.Table`, :class:`_schema.Column`, and others.
    The class can also be
    passed explicitly as the name to any function that receives a name which
    can be quoted.  Such as to use the :meth:`_engine.Engine.has_table`
    method with
    an unconditionally quoted name::

        from sqlalchemy import create_engine
        from sqlalchemy import inspect
        from sqlalchemy.sql import quoted_name

        engine = create_engine("oracle+cx_oracle://some_dsn")
        print(inspect(engine).has_table(quoted_name("some_table", True)))

    The above logic will run the "has table" logic against the Oracle backend,
    passing the name exactly as ``"some_table"`` without converting to
    upper case.

    .. versionchanged:: 1.2 The :class:`.quoted_name` construct is now
       importable from ``sqlalchemy.sql``, in addition to the previous
       location of ``sqlalchemy.sql.elements``.

    """

    __slots__ = "quote", "lower", "upper"

    quote: Optional[bool]

    @overload
    @classmethod
    def construct(cls, value: str, quote: Optional[bool]) -> quoted_name:
        ...

    @overload
    @classmethod
    def construct(cls, value: None, quote: Optional[bool]) -> None:
        ...

    @classmethod
    def construct(
        cls, value: Optional[str], quote: Optional[bool]
    ) -> Optional[quoted_name]:
        if value is None:
            return None
        else:
            return quoted_name(value, quote)

    def __new__(cls, value: str, quote: Optional[bool]) -> quoted_name:
        assert (
            value is not None
        ), "use quoted_name.construct() for None passthrough"
        if isinstance(value, cls) and (quote is None or value.quote == quote):
            return value
        self = super().__new__(cls, value)

        self.quote = quote
        return self

    def __reduce__(self):
        return quoted_name, (str(self), self.quote)

    def _memoized_method_lower(self):
        if self.quote:
            return self
        else:
            return str(self).lower()

    def _memoized_method_upper(self):
        if self.quote:
            return self
        else:
            return str(self).upper()


def _find_columns(clause: ClauseElement) -> Set[ColumnClause[Any]]:
    """locate Column objects within the given expression."""

    cols: Set[ColumnClause[Any]] = set()
    traverse(clause, {}, {"column": cols.add})
    return cols


def _type_from_args(args: Sequence[ColumnElement[_T]]) -> TypeEngine[_T]:
    for a in args:
        if not a.type._isnull:
            return a.type
    else:
        return type_api.NULLTYPE  # type: ignore


def _corresponding_column_or_error(fromclause, column, require_embedded=False):
    c = fromclause.corresponding_column(
        column, require_embedded=require_embedded
    )
    if c is None:
        raise exc.InvalidRequestError(
            "Given column '%s', attached to table '%s', "
            "failed to locate a corresponding column from table '%s'"
            % (column, getattr(column, "table", None), fromclause.description)
        )
    return c


class _memoized_property_but_not_nulltype(
    util.memoized_property["TypeEngine[_T]"]
):
    """memoized property, but dont memoize NullType"""

    def __get__(self, obj, cls):
        if obj is None:
            return self
        result = self.fget(obj)
        if not result._isnull:
            obj.__dict__[self.__name__] = result
        return result


class AnnotatedColumnElement(Annotated):
    _Annotated__element: ColumnElement[Any]

    def __init__(self, element, values):
        Annotated.__init__(self, element, values)
        for attr in (
            "comparator",
            "_proxy_key",
            "_tq_key_label",
            "_tq_label",
            "_non_anon_label",
            "type",
        ):
            self.__dict__.pop(attr, None)
        for attr in ("name", "key", "table"):
            if self.__dict__.get(attr, False) is None:
                self.__dict__.pop(attr)

    def _with_annotations(self, values):
        clone = super()._with_annotations(values)
        clone.__dict__.pop("comparator", None)
        return clone

    @util.memoized_property
    def name(self):
        """pull 'name' from parent, if not present"""
        return self._Annotated__element.name

    @_memoized_property_but_not_nulltype
    def type(self):
        """pull 'type' from parent and don't cache if null.

        type is routinely changed on existing columns within the
        mapped_column() initialization process, and "type" is also consulted
        during the creation of SQL expressions.  Therefore it can change after
        it was already retrieved.  At the same time we don't want annotated
        objects having overhead when expressions are produced, so continue
        to memoize, but only when we have a non-null type.

        """
        return self._Annotated__element.type

    @util.memoized_property
    def table(self):
        """pull 'table' from parent, if not present"""
        return self._Annotated__element.table

    @util.memoized_property
    def key(self):
        """pull 'key' from parent, if not present"""
        return self._Annotated__element.key

    @util.memoized_property
    def info(self) -> _InfoType:
        if TYPE_CHECKING:
            assert isinstance(self._Annotated__element, Column)
        return self._Annotated__element.info

    @util.memoized_property
    def _anon_name_label(self) -> str:
        return self._Annotated__element._anon_name_label


class _truncated_label(quoted_name):
    """A unicode subclass used to identify symbolic "
    "names that may require truncation."""

    __slots__ = ()

    def __new__(cls, value: str, quote: Optional[bool] = None) -> Any:
        quote = getattr(value, "quote", quote)
        # return super(_truncated_label, cls).__new__(cls, value, quote, True)
        return super().__new__(cls, value, quote)

    def __reduce__(self) -> Any:
        return self.__class__, (str(self), self.quote)

    def apply_map(self, map_: Mapping[str, Any]) -> str:
        return self


class conv(_truncated_label):
    """Mark a string indicating that a name has already been converted
    by a naming convention.

    This is a string subclass that indicates a name that should not be
    subject to any further naming conventions.

    E.g. when we create a :class:`.Constraint` using a naming convention
    as follows::

        m = MetaData(naming_convention={
            "ck": "ck_%(table_name)s_%(constraint_name)s"
        })
        t = Table('t', m, Column('x', Integer),
                        CheckConstraint('x > 5', name='x5'))

    The name of the above constraint will be rendered as ``"ck_t_x5"``.
    That is, the existing name ``x5`` is used in the naming convention as the
    ``constraint_name`` token.

    In some situations, such as in migration scripts, we may be rendering
    the above :class:`.CheckConstraint` with a name that's already been
    converted.  In order to make sure the name isn't double-modified, the
    new name is applied using the :func:`_schema.conv` marker.  We can
    use this explicitly as follows::


        m = MetaData(naming_convention={
            "ck": "ck_%(table_name)s_%(constraint_name)s"
        })
        t = Table('t', m, Column('x', Integer),
                        CheckConstraint('x > 5', name=conv('ck_t_x5')))

    Where above, the :func:`_schema.conv` marker indicates that the constraint
    name here is final, and the name will render as ``"ck_t_x5"`` and not
    ``"ck_t_ck_t_x5"``

    .. seealso::

        :ref:`constraint_naming_conventions`

    """

    __slots__ = ()


# for backwards compatibility in case
# someone is re-implementing the
# _truncated_identifier() sequence in a custom
# compiler
_generated_label = _truncated_label


class _anonymous_label(_truncated_label):
    """A unicode subclass used to identify anonymously
    generated names."""

    __slots__ = ()

    @classmethod
    def safe_construct(
        cls,
        seed: int,
        body: str,
        enclosing_label: Optional[str] = None,
        sanitize_key: bool = False,
    ) -> _anonymous_label:
        # need to escape chars that interfere with format
        # strings in any case, issue #8724
        body = re.sub(r"[%\(\) \$]+", "_", body)

        if sanitize_key:
            # sanitize_key is then an extra step used by BindParameter
            body = body.strip("_")

        label = "%%(%d %s)s" % (seed, body.replace("%", "%%"))
        if enclosing_label:
            label = "%s%s" % (enclosing_label, label)

        return _anonymous_label(label)

    def __add__(self, other):
        if "%" in other and not isinstance(other, _anonymous_label):
            other = str(other).replace("%", "%%")
        else:
            other = str(other)

        return _anonymous_label(
            quoted_name(
                str.__add__(self, other),
                self.quote,
            )
        )

    def __radd__(self, other):
        if "%" in other and not isinstance(other, _anonymous_label):
            other = str(other).replace("%", "%%")
        else:
            other = str(other)

        return _anonymous_label(
            quoted_name(
                str.__add__(other, self),
                self.quote,
            )
        )

    def apply_map(self, map_):
        if self.quote is not None:
            # preserve quoting only if necessary
            return quoted_name(self % map_, self.quote)
        else:
            # else skip the constructor call
            return self % map_
