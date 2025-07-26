# sql/compiler.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Base SQL and DDL compiler implementations.

Classes provided include:

:class:`.compiler.SQLCompiler` - renders SQL
strings

:class:`.compiler.DDLCompiler` - renders DDL
(data definition language) strings

:class:`.compiler.GenericTypeCompiler` - renders
type specification strings.

To generate user-defined SQL strings, see
:doc:`/ext/compiler`.

"""
from __future__ import annotations

import collections
import collections.abc as collections_abc
import contextlib
from enum import IntEnum
import itertools
import operator
import re
from time import perf_counter
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import ClassVar
from typing import Dict
from typing import FrozenSet
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import MutableMapping
from typing import NamedTuple
from typing import NoReturn
from typing import Optional
from typing import Pattern
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import Union

from . import base
from . import coercions
from . import crud
from . import elements
from . import functions
from . import operators
from . import roles
from . import schema
from . import selectable
from . import sqltypes
from . import util as sql_util
from ._typing import is_column_element
from ._typing import is_dml
from .base import _de_clone
from .base import _from_objects
from .base import _NONE_NAME
from .base import _SentinelDefaultCharacterization
from .base import Executable
from .base import NO_ARG
from .elements import ClauseElement
from .elements import quoted_name
from .schema import Column
from .sqltypes import TupleType
from .type_api import TypeEngine
from .visitors import prefix_anon_map
from .visitors import Visitable
from .. import exc
from .. import util
from ..util import FastIntFlag
from ..util.typing import Literal
from ..util.typing import Protocol
from ..util.typing import TypedDict

if typing.TYPE_CHECKING:
    from .annotation import _AnnotationDict
    from .base import _AmbiguousTableNameMap
    from .base import CompileState
    from .cache_key import CacheKey
    from .ddl import ExecutableDDLElement
    from .dml import Insert
    from .dml import UpdateBase
    from .dml import ValuesBase
    from .elements import _truncated_label
    from .elements import BindParameter
    from .elements import ColumnClause
    from .elements import ColumnElement
    from .elements import Label
    from .functions import Function
    from .schema import Table
    from .selectable import AliasedReturnsRows
    from .selectable import CompoundSelectState
    from .selectable import CTE
    from .selectable import FromClause
    from .selectable import NamedFromClause
    from .selectable import ReturnsRows
    from .selectable import Select
    from .selectable import SelectState
    from .type_api import _BindProcessorType
    from .type_api import _SentinelProcessorType
    from ..engine.cursor import CursorResultMetaData
    from ..engine.interfaces import _CoreSingleExecuteParams
    from ..engine.interfaces import _DBAPIAnyExecuteParams
    from ..engine.interfaces import _DBAPIMultiExecuteParams
    from ..engine.interfaces import _DBAPISingleExecuteParams
    from ..engine.interfaces import _ExecuteOptions
    from ..engine.interfaces import _GenericSetInputSizesType
    from ..engine.interfaces import _MutableCoreSingleExecuteParams
    from ..engine.interfaces import Dialect
    from ..engine.interfaces import SchemaTranslateMapType

_FromHintsType = Dict["FromClause", str]

RESERVED_WORDS = {
    "all",
    "analyse",
    "analyze",
    "and",
    "any",
    "array",
    "as",
    "asc",
    "asymmetric",
    "authorization",
    "between",
    "binary",
    "both",
    "case",
    "cast",
    "check",
    "collate",
    "column",
    "constraint",
    "create",
    "cross",
    "current_date",
    "current_role",
    "current_time",
    "current_timestamp",
    "current_user",
    "default",
    "deferrable",
    "desc",
    "distinct",
    "do",
    "else",
    "end",
    "except",
    "false",
    "for",
    "foreign",
    "freeze",
    "from",
    "full",
    "grant",
    "group",
    "having",
    "ilike",
    "in",
    "initially",
    "inner",
    "intersect",
    "into",
    "is",
    "isnull",
    "join",
    "leading",
    "left",
    "like",
    "limit",
    "localtime",
    "localtimestamp",
    "natural",
    "new",
    "not",
    "notnull",
    "null",
    "off",
    "offset",
    "old",
    "on",
    "only",
    "or",
    "order",
    "outer",
    "overlaps",
    "placing",
    "primary",
    "references",
    "right",
    "select",
    "session_user",
    "set",
    "similar",
    "some",
    "symmetric",
    "table",
    "then",
    "to",
    "trailing",
    "true",
    "union",
    "unique",
    "user",
    "using",
    "verbose",
    "when",
    "where",
}

LEGAL_CHARACTERS = re.compile(r"^[A-Z0-9_$]+$", re.I)
LEGAL_CHARACTERS_PLUS_SPACE = re.compile(r"^[A-Z0-9_ $]+$", re.I)
ILLEGAL_INITIAL_CHARACTERS = {str(x) for x in range(0, 10)}.union(["$"])

FK_ON_DELETE = re.compile(
    r"^(?:RESTRICT|CASCADE|SET NULL|NO ACTION|SET DEFAULT)$", re.I
)
FK_ON_UPDATE = re.compile(
    r"^(?:RESTRICT|CASCADE|SET NULL|NO ACTION|SET DEFAULT)$", re.I
)
FK_INITIALLY = re.compile(r"^(?:DEFERRED|IMMEDIATE)$", re.I)
BIND_PARAMS = re.compile(r"(?<![:\w\$\x5c]):([\w\$]+)(?![:\w\$])", re.UNICODE)
BIND_PARAMS_ESC = re.compile(r"\x5c(:[\w\$]*)(?![:\w\$])", re.UNICODE)

_pyformat_template = "%%(%(name)s)s"
BIND_TEMPLATES = {
    "pyformat": _pyformat_template,
    "qmark": "?",
    "format": "%%s",
    "numeric": ":[_POSITION]",
    "numeric_dollar": "$[_POSITION]",
    "named": ":%(name)s",
}


OPERATORS = {
    # binary
    operators.and_: " AND ",
    operators.or_: " OR ",
    operators.add: " + ",
    operators.mul: " * ",
    operators.sub: " - ",
    operators.mod: " % ",
    operators.neg: "-",
    operators.lt: " < ",
    operators.le: " <= ",
    operators.ne: " != ",
    operators.gt: " > ",
    operators.ge: " >= ",
    operators.eq: " = ",
    operators.is_distinct_from: " IS DISTINCT FROM ",
    operators.is_not_distinct_from: " IS NOT DISTINCT FROM ",
    operators.concat_op: " || ",
    operators.match_op: " MATCH ",
    operators.not_match_op: " NOT MATCH ",
    operators.in_op: " IN ",
    operators.not_in_op: " NOT IN ",
    operators.comma_op: ", ",
    operators.from_: " FROM ",
    operators.as_: " AS ",
    operators.is_: " IS ",
    operators.is_not: " IS NOT ",
    operators.collate: " COLLATE ",
    # unary
    operators.exists: "EXISTS ",
    operators.distinct_op: "DISTINCT ",
    operators.inv: "NOT ",
    operators.any_op: "ANY ",
    operators.all_op: "ALL ",
    # modifiers
    operators.desc_op: " DESC",
    operators.asc_op: " ASC",
    operators.nulls_first_op: " NULLS FIRST",
    operators.nulls_last_op: " NULLS LAST",
    # bitwise
    operators.bitwise_xor_op: " ^ ",
    operators.bitwise_or_op: " | ",
    operators.bitwise_and_op: " & ",
    operators.bitwise_not_op: "~",
    operators.bitwise_lshift_op: " << ",
    operators.bitwise_rshift_op: " >> ",
}

FUNCTIONS: Dict[Type[Function[Any]], str] = {
    functions.coalesce: "coalesce",
    functions.current_date: "CURRENT_DATE",
    functions.current_time: "CURRENT_TIME",
    functions.current_timestamp: "CURRENT_TIMESTAMP",
    functions.current_user: "CURRENT_USER",
    functions.localtime: "LOCALTIME",
    functions.localtimestamp: "LOCALTIMESTAMP",
    functions.random: "random",
    functions.sysdate: "sysdate",
    functions.session_user: "SESSION_USER",
    functions.user: "USER",
    functions.cube: "CUBE",
    functions.rollup: "ROLLUP",
    functions.grouping_sets: "GROUPING SETS",
}


EXTRACT_MAP = {
    "month": "month",
    "day": "day",
    "year": "year",
    "second": "second",
    "hour": "hour",
    "doy": "doy",
    "minute": "minute",
    "quarter": "quarter",
    "dow": "dow",
    "week": "week",
    "epoch": "epoch",
    "milliseconds": "milliseconds",
    "microseconds": "microseconds",
    "timezone_hour": "timezone_hour",
    "timezone_minute": "timezone_minute",
}

COMPOUND_KEYWORDS = {
    selectable._CompoundSelectKeyword.UNION: "UNION",
    selectable._CompoundSelectKeyword.UNION_ALL: "UNION ALL",
    selectable._CompoundSelectKeyword.EXCEPT: "EXCEPT",
    selectable._CompoundSelectKeyword.EXCEPT_ALL: "EXCEPT ALL",
    selectable._CompoundSelectKeyword.INTERSECT: "INTERSECT",
    selectable._CompoundSelectKeyword.INTERSECT_ALL: "INTERSECT ALL",
}


class ResultColumnsEntry(NamedTuple):
    """Tracks a column expression that is expected to be represented
    in the result rows for this statement.

    This normally refers to the columns clause of a SELECT statement
    but may also refer to a RETURNING clause, as well as for dialect-specific
    emulations.

    """

    keyname: str
    """string name that's expected in cursor.description"""

    name: str
    """column name, may be labeled"""

    objects: Tuple[Any, ...]
    """sequence of objects that should be able to locate this column
    in a RowMapping.  This is typically string names and aliases
    as well as Column objects.

    """

    type: TypeEngine[Any]
    """Datatype to be associated with this column.   This is where
    the "result processing" logic directly links the compiled statement
    to the rows that come back from the cursor.

    """


class _ResultMapAppender(Protocol):
    def __call__(
        self,
        keyname: str,
        name: str,
        objects: Sequence[Any],
        type_: TypeEngine[Any],
    ) -> None:
        ...


# integer indexes into ResultColumnsEntry used by cursor.py.
# some profiling showed integer access faster than named tuple
RM_RENDERED_NAME: Literal[0] = 0
RM_NAME: Literal[1] = 1
RM_OBJECTS: Literal[2] = 2
RM_TYPE: Literal[3] = 3


class _BaseCompilerStackEntry(TypedDict):
    asfrom_froms: Set[FromClause]
    correlate_froms: Set[FromClause]
    selectable: ReturnsRows


class _CompilerStackEntry(_BaseCompilerStackEntry, total=False):
    compile_state: CompileState
    need_result_map_for_nested: bool
    need_result_map_for_compound: bool
    select_0: ReturnsRows
    insert_from_select: Select[Any]


class ExpandedState(NamedTuple):
    """represents state to use when producing "expanded" and
    "post compile" bound parameters for a statement.

    "expanded" parameters are parameters that are generated at
    statement execution time to suit a number of parameters passed, the most
    prominent example being the individual elements inside of an IN expression.

    "post compile" parameters are parameters where the SQL literal value
    will be rendered into the SQL statement at execution time, rather than
    being passed as separate parameters to the driver.

    To create an :class:`.ExpandedState` instance, use the
    :meth:`.SQLCompiler.construct_expanded_state` method on any
    :class:`.SQLCompiler` instance.

    """

    statement: str
    """String SQL statement with parameters fully expanded"""

    parameters: _CoreSingleExecuteParams
    """Parameter dictionary with parameters fully expanded.

    For a statement that uses named parameters, this dictionary will map
    exactly to the names in the statement.  For a statement that uses
    positional parameters, the :attr:`.ExpandedState.positional_parameters`
    will yield a tuple with the positional parameter set.

    """

    processors: Mapping[str, _BindProcessorType[Any]]
    """mapping of bound value processors"""

    positiontup: Optional[Sequence[str]]
    """Sequence of string names indicating the order of positional
    parameters"""

    parameter_expansion: Mapping[str, List[str]]
    """Mapping representing the intermediary link from original parameter
    name to list of "expanded" parameter names, for those parameters that
    were expanded."""

    @property
    def positional_parameters(self) -> Tuple[Any, ...]:
        """Tuple of positional parameters, for statements that were compiled
        using a positional paramstyle.

        """
        if self.positiontup is None:
            raise exc.InvalidRequestError(
                "statement does not use a positional paramstyle"
            )
        return tuple(self.parameters[key] for key in self.positiontup)

    @property
    def additional_parameters(self) -> _CoreSingleExecuteParams:
        """synonym for :attr:`.ExpandedState.parameters`."""
        return self.parameters


class _InsertManyValues(NamedTuple):
    """represents state to use for executing an "insertmanyvalues" statement.

    The primary consumers of this object are the
    :meth:`.SQLCompiler._deliver_insertmanyvalues_batches` and
    :meth:`.DefaultDialect._deliver_insertmanyvalues_batches` methods.

    .. versionadded:: 2.0

    """

    is_default_expr: bool
    """if True, the statement is of the form
    ``INSERT INTO TABLE DEFAULT VALUES``, and can't be rewritten as a "batch"

    """

    single_values_expr: str
    """The rendered "values" clause of the INSERT statement.

    This is typically the parenthesized section e.g. "(?, ?, ?)" or similar.
    The insertmanyvalues logic uses this string as a search and replace
    target.

    """

    insert_crud_params: List[crud._CrudParamElementStr]
    """List of Column / bind names etc. used while rewriting the statement"""

    num_positional_params_counted: int
    """the number of bound parameters in a single-row statement.

    This count may be larger or smaller than the actual number of columns
    targeted in the INSERT, as it accommodates for SQL expressions
    in the values list that may have zero or more parameters embedded
    within them.

    This count is part of what's used to organize rewritten parameter lists
    when batching.

    """

    sort_by_parameter_order: bool = False
    """if the deterministic_returnined_order parameter were used on the
    insert.

    All of the attributes following this will only be used if this is True.

    """

    includes_upsert_behaviors: bool = False
    """if True, we have to accommodate for upsert behaviors.

    This will in some cases downgrade "insertmanyvalues" that requests
    deterministic ordering.

    """

    sentinel_columns: Optional[Sequence[Column[Any]]] = None
    """List of sentinel columns that were located.

    This list is only here if the INSERT asked for
    sort_by_parameter_order=True,
    and dialect-appropriate sentinel columns were located.

    .. versionadded:: 2.0.10

    """

    num_sentinel_columns: int = 0
    """how many sentinel columns are in the above list, if any.

    This is the same as
    ``len(sentinel_columns) if sentinel_columns is not None else 0``

    """

    sentinel_param_keys: Optional[Sequence[Union[str, int]]] = None
    """parameter str keys / int indexes in each param dictionary / tuple
    that would link to the client side "sentinel" values for that row, which
    we can use to match up parameter sets to result rows.

    This is only present if sentinel_columns is present and the INSERT
    statement actually refers to client side values for these sentinel
    columns.

    .. versionadded:: 2.0.10

    """

    implicit_sentinel: bool = False
    """if True, we have exactly one sentinel column and it uses a server side
    value, currently has to generate an incrementing integer value.

    The dialect in question would have asserted that it supports receiving
    these values back and sorting on that value as a means of guaranteeing
    correlation with the incoming parameter list.

    .. versionadded:: 2.0.10

    """

    embed_values_counter: bool = False
    """Whether to embed an incrementing integer counter in each parameter
    set within the VALUES clause as parameters are batched over.

    This is only used for a specific INSERT..SELECT..VALUES..RETURNING syntax
    where a subquery is used to produce value tuples.  Current support
    includes PostgreSQL, Microsoft SQL Server.

    .. versionadded:: 2.0.10

    """


class _InsertManyValuesBatch(NamedTuple):
    """represents an individual batch SQL statement for insertmanyvalues.

    This is passed through the
    :meth:`.SQLCompiler._deliver_insertmanyvalues_batches` and
    :meth:`.DefaultDialect._deliver_insertmanyvalues_batches` methods out
    to the :class:`.Connection` within the
    :meth:`.Connection._exec_insertmany_context` method.

    .. versionadded:: 2.0.10

    """

    replaced_statement: str
    replaced_parameters: _DBAPIAnyExecuteParams
    processed_setinputsizes: Optional[_GenericSetInputSizesType]
    batch: Sequence[_DBAPISingleExecuteParams]
    batch_size: int
    batchnum: int
    total_batches: int
    rows_sorted: bool
    is_downgraded: bool


class InsertmanyvaluesSentinelOpts(FastIntFlag):
    """bitflag enum indicating styles of PK defaults
    which can work as implicit sentinel columns

    """

    NOT_SUPPORTED = 1
    AUTOINCREMENT = 2
    IDENTITY = 4
    SEQUENCE = 8

    ANY_AUTOINCREMENT = AUTOINCREMENT | IDENTITY | SEQUENCE
    _SUPPORTED_OR_NOT = NOT_SUPPORTED | ANY_AUTOINCREMENT

    USE_INSERT_FROM_SELECT = 16
    RENDER_SELECT_COL_CASTS = 64


class CompilerState(IntEnum):
    COMPILING = 0
    """statement is present, compilation phase in progress"""

    STRING_APPLIED = 1
    """statement is present, string form of the statement has been applied.

    Additional processors by subclasses may still be pending.

    """

    NO_STATEMENT = 2
    """compiler does not have a statement to compile, is used
    for method access"""


class Linting(IntEnum):
    """represent preferences for the 'SQL linting' feature.

    this feature currently includes support for flagging cartesian products
    in SQL statements.

    """

    NO_LINTING = 0
    "Disable all linting."

    COLLECT_CARTESIAN_PRODUCTS = 1
    """Collect data on FROMs and cartesian products and gather into
    'self.from_linter'"""

    WARN_LINTING = 2
    "Emit warnings for linters that find problems"

    FROM_LINTING = COLLECT_CARTESIAN_PRODUCTS | WARN_LINTING
    """Warn for cartesian products; combines COLLECT_CARTESIAN_PRODUCTS
    and WARN_LINTING"""


NO_LINTING, COLLECT_CARTESIAN_PRODUCTS, WARN_LINTING, FROM_LINTING = tuple(
    Linting
)


class FromLinter(collections.namedtuple("FromLinter", ["froms", "edges"])):
    """represents current state for the "cartesian product" detection
    feature."""

    def lint(self, start=None):
        froms = self.froms
        if not froms:
            return None, None

        edges = set(self.edges)
        the_rest = set(froms)

        if start is not None:
            start_with = start
            the_rest.remove(start_with)
        else:
            start_with = the_rest.pop()

        stack = collections.deque([start_with])

        while stack and the_rest:
            node = stack.popleft()
            the_rest.discard(node)

            # comparison of nodes in edges here is based on hash equality, as
            # there are "annotated" elements that match the non-annotated ones.
            #   to remove the need for in-python hash() calls, use native
            # containment routines (e.g. "node in edge", "edge.index(node)")
            to_remove = {edge for edge in edges if node in edge}

            # appendleft the node in each edge that is not
            # the one that matched.
            stack.extendleft(edge[not edge.index(node)] for edge in to_remove)
            edges.difference_update(to_remove)

        # FROMS left over?  boom
        if the_rest:
            return the_rest, start_with
        else:
            return None, None

    def warn(self, stmt_type="SELECT"):
        the_rest, start_with = self.lint()

        # FROMS left over?  boom
        if the_rest:
            froms = the_rest
            if froms:
                template = (
                    "{stmt_type} statement has a cartesian product between "
                    "FROM element(s) {froms} and "
                    'FROM element "{start}".  Apply join condition(s) '
                    "between each element to resolve."
                )
                froms_str = ", ".join(
                    f'"{self.froms[from_]}"' for from_ in froms
                )
                message = template.format(
                    stmt_type=stmt_type,
                    froms=froms_str,
                    start=self.froms[start_with],
                )

                util.warn(message)


class Compiled:

    """Represent a compiled SQL or DDL expression.

    The ``__str__`` method of the ``Compiled`` object should produce
    the actual text of the statement.  ``Compiled`` objects are
    specific to their underlying database dialect, and also may
    or may not be specific to the columns referenced within a
    particular set of bind parameters.  In no case should the
    ``Compiled`` object be dependent on the actual values of those
    bind parameters, even though it may reference those values as
    defaults.
    """

    statement: Optional[ClauseElement] = None
    "The statement to compile."
    string: str = ""
    "The string representation of the ``statement``"

    state: CompilerState
    """description of the compiler's state"""

    is_sql = False
    is_ddl = False

    _cached_metadata: Optional[CursorResultMetaData] = None

    _result_columns: Optional[List[ResultColumnsEntry]] = None

    schema_translate_map: Optional[SchemaTranslateMapType] = None

    execution_options: _ExecuteOptions = util.EMPTY_DICT
    """
    Execution options propagated from the statement.   In some cases,
    sub-elements of the statement can modify these.
    """

    preparer: IdentifierPreparer

    _annotations: _AnnotationDict = util.EMPTY_DICT

    compile_state: Optional[CompileState] = None
    """Optional :class:`.CompileState` object that maintains additional
    state used by the compiler.

    Major executable objects such as :class:`_expression.Insert`,
    :class:`_expression.Update`, :class:`_expression.Delete`,
    :class:`_expression.Select` will generate this
    state when compiled in order to calculate additional information about the
    object.   For the top level object that is to be executed, the state can be
    stored here where it can also have applicability towards result set
    processing.

    .. versionadded:: 1.4

    """

    dml_compile_state: Optional[CompileState] = None
    """Optional :class:`.CompileState` assigned at the same point that
    .isinsert, .isupdate, or .isdelete is assigned.

    This will normally be the same object as .compile_state, with the
    exception of cases like the :class:`.ORMFromStatementCompileState`
    object.

    .. versionadded:: 1.4.40

    """

    cache_key: Optional[CacheKey] = None
    """The :class:`.CacheKey` that was generated ahead of creating this
    :class:`.Compiled` object.

    This is used for routines that need access to the original
    :class:`.CacheKey` instance generated when the :class:`.Compiled`
    instance was first cached, typically in order to reconcile
    the original list of :class:`.BindParameter` objects with a
    per-statement list that's generated on each call.

    """

    _gen_time: float
    """Generation time of this :class:`.Compiled`, used for reporting
    cache stats."""

    def __init__(
        self,
        dialect: Dialect,
        statement: Optional[ClauseElement],
        schema_translate_map: Optional[SchemaTranslateMapType] = None,
        render_schema_translate: bool = False,
        compile_kwargs: Mapping[str, Any] = util.immutabledict(),
    ):
        """Construct a new :class:`.Compiled` object.

        :param dialect: :class:`.Dialect` to compile against.

        :param statement: :class:`_expression.ClauseElement` to be compiled.

        :param schema_translate_map: dictionary of schema names to be
         translated when forming the resultant SQL

         .. seealso::

            :ref:`schema_translating`

        :param compile_kwargs: additional kwargs that will be
         passed to the initial call to :meth:`.Compiled.process`.


        """
        self.dialect = dialect
        self.preparer = self.dialect.identifier_preparer
        if schema_translate_map:
            self.schema_translate_map = schema_translate_map
            self.preparer = self.preparer._with_schema_translate(
                schema_translate_map
            )

        if statement is not None:
            self.state = CompilerState.COMPILING
            self.statement = statement
            self.can_execute = statement.supports_execution
            self._annotations = statement._annotations
            if self.can_execute:
                if TYPE_CHECKING:
                    assert isinstance(statement, Executable)
                self.execution_options = statement._execution_options
            self.string = self.process(self.statement, **compile_kwargs)

            if render_schema_translate:
                self.string = self.preparer._render_schema_translates(
                    self.string, schema_translate_map
                )

            self.state = CompilerState.STRING_APPLIED
        else:
            self.state = CompilerState.NO_STATEMENT

        self._gen_time = perf_counter()

    def __init_subclass__(cls) -> None:
        cls._init_compiler_cls()
        return super().__init_subclass__()

    @classmethod
    def _init_compiler_cls(cls):
        pass

    def _execute_on_connection(
        self, connection, distilled_params, execution_options
    ):
        if self.can_execute:
            return connection._execute_compiled(
                self, distilled_params, execution_options
            )
        else:
            raise exc.ObjectNotExecutableError(self.statement)

    def visit_unsupported_compilation(self, element, err, **kw):
        raise exc.UnsupportedCompilationError(self, type(element)) from err

    @property
    def sql_compiler(self):
        """Return a Compiled that is capable of processing SQL expressions.

        If this compiler is one, it would likely just return 'self'.

        """

        raise NotImplementedError()

    def process(self, obj: Visitable, **kwargs: Any) -> str:
        return obj._compiler_dispatch(self, **kwargs)

    def __str__(self) -> str:
        """Return the string text of the generated SQL or DDL."""

        if self.state is CompilerState.STRING_APPLIED:
            return self.string
        else:
            return ""

    def construct_params(
        self,
        params: Optional[_CoreSingleExecuteParams] = None,
        extracted_parameters: Optional[Sequence[BindParameter[Any]]] = None,
        escape_names: bool = True,
    ) -> Optional[_MutableCoreSingleExecuteParams]:
        """Return the bind params for this compiled object.

        :param params: a dict of string/object pairs whose values will
                       override bind values compiled in to the
                       statement.
        """

        raise NotImplementedError()

    @property
    def params(self):
        """Return the bind params for this compiled object."""
        return self.construct_params()


class TypeCompiler(util.EnsureKWArg):
    """Produces DDL specification for TypeEngine objects."""

    ensure_kwarg = r"visit_\w+"

    def __init__(self, dialect: Dialect):
        self.dialect = dialect

    def process(self, type_: TypeEngine[Any], **kw: Any) -> str:
        if (
            type_._variant_mapping
            and self.dialect.name in type_._variant_mapping
        ):
            type_ = type_._variant_mapping[self.dialect.name]
        return type_._compiler_dispatch(self, **kw)

    def visit_unsupported_compilation(
        self, element: Any, err: Exception, **kw: Any
    ) -> NoReturn:
        raise exc.UnsupportedCompilationError(self, element) from err


# this was a Visitable, but to allow accurate detection of
# column elements this is actually a column element
class _CompileLabel(
    roles.BinaryElementRole[Any], elements.CompilerColumnElement
):

    """lightweight label object which acts as an expression.Label."""

    __visit_name__ = "label"
    __slots__ = "element", "name", "_alt_names"

    def __init__(self, col, name, alt_names=()):
        self.element = col
        self.name = name
        self._alt_names = (col,) + alt_names

    @property
    def proxy_set(self):
        return self.element.proxy_set

    @property
    def type(self):
        return self.element.type

    def self_group(self, **kw):
        return self


class ilike_case_insensitive(
    roles.BinaryElementRole[Any], elements.CompilerColumnElement
):
    """produce a wrapping element for a case-insensitive portion of
    an ILIKE construct.

    The construct usually renders the ``lower()`` function, but on
    PostgreSQL will pass silently with the assumption that "ILIKE"
    is being used.

    .. versionadded:: 2.0

    """

    __visit_name__ = "ilike_case_insensitive_operand"
    __slots__ = "element", "comparator"

    def __init__(self, element):
        self.element = element
        self.comparator = element.comparator

    @property
    def proxy_set(self):
        return self.element.proxy_set

    @property
    def type(self):
        return self.element.type

    def self_group(self, **kw):
        return self

    def _with_binary_element_type(self, type_):
        return ilike_case_insensitive(
            self.element._with_binary_element_type(type_)
        )


class SQLCompiler(Compiled):
    """Default implementation of :class:`.Compiled`.

    Compiles :class:`_expression.ClauseElement` objects into SQL strings.

    """

    extract_map = EXTRACT_MAP

    bindname_escape_characters: ClassVar[
        Mapping[str, str]
    ] = util.immutabledict(
        {
            "%": "P",
            "(": "A",
            ")": "Z",
            ":": "C",
            ".": "_",
            "[": "_",
            "]": "_",
            " ": "_",
        }
    )
    """A mapping (e.g. dict or similar) containing a lookup of
    characters keyed to replacement characters which will be applied to all
    'bind names' used in SQL statements as a form of 'escaping'; the given
    characters are replaced entirely with the 'replacement' character when
    rendered in the SQL statement, and a similar translation is performed
    on the incoming names used in parameter dictionaries passed to methods
    like :meth:`_engine.Connection.execute`.

    This allows bound parameter names used in :func:`_sql.bindparam` and
    other constructs to have any arbitrary characters present without any
    concern for characters that aren't allowed at all on the target database.

    Third party dialects can establish their own dictionary here to replace the
    default mapping, which will ensure that the particular characters in the
    mapping will never appear in a bound parameter name.

    The dictionary is evaluated at **class creation time**, so cannot be
    modified at runtime; it must be present on the class when the class
    is first declared.

    Note that for dialects that have additional bound parameter rules such
    as additional restrictions on leading characters, the
    :meth:`_sql.SQLCompiler.bindparam_string` method may need to be augmented.
    See the cx_Oracle compiler for an example of this.

    .. versionadded:: 2.0.0rc1

    """

    _bind_translate_re: ClassVar[Pattern[str]]
    _bind_translate_chars: ClassVar[Mapping[str, str]]

    is_sql = True

    compound_keywords = COMPOUND_KEYWORDS

    isdelete: bool = False
    isinsert: bool = False
    isupdate: bool = False
    """class-level defaults which can be set at the instance
    level to define if this Compiled instance represents
    INSERT/UPDATE/DELETE
    """

    postfetch: Optional[List[Column[Any]]]
    """list of columns that can be post-fetched after INSERT or UPDATE to
    receive server-updated values"""

    insert_prefetch: Sequence[Column[Any]] = ()
    """list of columns for which default values should be evaluated before
    an INSERT takes place"""

    update_prefetch: Sequence[Column[Any]] = ()
    """list of columns for which onupdate default values should be evaluated
    before an UPDATE takes place"""

    implicit_returning: Optional[Sequence[ColumnElement[Any]]] = None
    """list of "implicit" returning columns for a toplevel INSERT or UPDATE
    statement, used to receive newly generated values of columns.

    .. versionadded:: 2.0  ``implicit_returning`` replaces the previous
       ``returning`` collection, which was not a generalized RETURNING
       collection and instead was in fact specific to the "implicit returning"
       feature.

    """

    isplaintext: bool = False

    binds: Dict[str, BindParameter[Any]]
    """a dictionary of bind parameter keys to BindParameter instances."""

    bind_names: Dict[BindParameter[Any], str]
    """a dictionary of BindParameter instances to "compiled" names
    that are actually present in the generated SQL"""

    stack: List[_CompilerStackEntry]
    """major statements such as SELECT, INSERT, UPDATE, DELETE are
    tracked in this stack using an entry format."""

    returning_precedes_values: bool = False
    """set to True classwide to generate RETURNING
    clauses before the VALUES or WHERE clause (i.e. MSSQL)
    """

    render_table_with_column_in_update_from: bool = False
    """set to True classwide to indicate the SET clause
    in a multi-table UPDATE statement should qualify
    columns with the table name (i.e. MySQL only)
    """

    ansi_bind_rules: bool = False
    """SQL 92 doesn't allow bind parameters to be used
    in the columns clause of a SELECT, nor does it allow
    ambiguous expressions like "? = ?".  A compiler
    subclass can set this flag to False if the target
    driver/DB enforces this
    """

    bindtemplate: str
    """template to render bound parameters based on paramstyle."""

    compilation_bindtemplate: str
    """template used by compiler to render parameters before positional
    paramstyle application"""

    _numeric_binds_identifier_char: str
    """Character that's used to as the identifier of a numerical bind param.
    For example if this char is set to ``$``, numerical binds will be rendered
    in the form ``$1, $2, $3``.
    """

    _result_columns: List[ResultColumnsEntry]
    """relates label names in the final SQL to a tuple of local
    column/label name, ColumnElement object (if any) and
    TypeEngine. CursorResult uses this for type processing and
    column targeting"""

    _textual_ordered_columns: bool = False
    """tell the result object that the column names as rendered are important,
    but they are also "ordered" vs. what is in the compiled object here.

    As of 1.4.42 this condition is only present when the statement is a
    TextualSelect, e.g. text("....").columns(...), where it is required
    that the columns are considered positionally and not by name.

    """

    _ad_hoc_textual: bool = False
    """tell the result that we encountered text() or '*' constructs in the
    middle of the result columns, but we also have compiled columns, so
    if the number of columns in cursor.description does not match how many
    expressions we have, that means we can't rely on positional at all and
    should match on name.

    """

    _ordered_columns: bool = True
    """
    if False, means we can't be sure the list of entries
    in _result_columns is actually the rendered order.  Usually
    True unless using an unordered TextualSelect.
    """

    _loose_column_name_matching: bool = False
    """tell the result object that the SQL statement is textual, wants to match
    up to Column objects, and may be using the ._tq_label in the SELECT rather
    than the base name.

    """

    _numeric_binds: bool = False
    """
    True if paramstyle is "numeric".  This paramstyle is trickier than
    all the others.

    """

    _render_postcompile: bool = False
    """
    whether to render out POSTCOMPILE params during the compile phase.

    This attribute is used only for end-user invocation of stmt.compile();
    it's never used for actual statement execution, where instead the
    dialect internals access and render the internal postcompile structure
    directly.

    """

    _post_compile_expanded_state: Optional[ExpandedState] = None
    """When render_postcompile is used, the ``ExpandedState`` used to create
    the "expanded" SQL is assigned here, and then used by the ``.params``
    accessor and ``.construct_params()`` methods for their return values.

    .. versionadded:: 2.0.0rc1

    """

    _pre_expanded_string: Optional[str] = None
    """Stores the original string SQL before 'post_compile' is applied,
    for cases where 'post_compile' were used.

    """

    _pre_expanded_positiontup: Optional[List[str]] = None

    _insertmanyvalues: Optional[_InsertManyValues] = None

    _insert_crud_params: Optional[crud._CrudParamSequence] = None

    literal_execute_params: FrozenSet[BindParameter[Any]] = frozenset()
    """bindparameter objects that are rendered as literal values at statement
    execution time.

    """

    post_compile_params: FrozenSet[BindParameter[Any]] = frozenset()
    """bindparameter objects that are rendered as bound parameter placeholders
    at statement execution time.

    """

    escaped_bind_names: util.immutabledict[str, str] = util.EMPTY_DICT
    """Late escaping of bound parameter names that has to be converted
    to the original name when looking in the parameter dictionary.

    """

    has_out_parameters = False
    """if True, there are bindparam() objects that have the isoutparam
    flag set."""

    postfetch_lastrowid = False
    """if True, and this in insert, use cursor.lastrowid to populate
    result.inserted_primary_key. """

    _cache_key_bind_match: Optional[
        Tuple[
            Dict[
                BindParameter[Any],
                List[BindParameter[Any]],
            ],
            Dict[
                str,
                BindParameter[Any],
            ],
        ]
    ] = None
    """a mapping that will relate the BindParameter object we compile
    to those that are part of the extracted collection of parameters
    in the cache key, if we were given a cache key.

    """

    positiontup: Optional[List[str]] = None
    """for a compiled construct that uses a positional paramstyle, will be
    a sequence of strings, indicating the names of bound parameters in order.

    This is used in order to render bound parameters in their correct order,
    and is combined with the :attr:`_sql.Compiled.params` dictionary to
    render parameters.

    This sequence always contains the unescaped name of the parameters.

    .. seealso::

        :ref:`faq_sql_expression_string` - includes a usage example for
        debugging use cases.

    """
    _values_bindparam: Optional[List[str]] = None

    _visited_bindparam: Optional[List[str]] = None

    inline: bool = False

    ctes: Optional[MutableMapping[CTE, str]]

    # Detect same CTE references - Dict[(level, name), cte]
    # Level is required for supporting nesting
    ctes_by_level_name: Dict[Tuple[int, str], CTE]

    # To retrieve key/level in ctes_by_level_name -
    # Dict[cte_reference, (level, cte_name, cte_opts)]
    level_name_by_cte: Dict[CTE, Tuple[int, str, selectable._CTEOpts]]

    ctes_recursive: bool

    _post_compile_pattern = re.compile(r"__\[POSTCOMPILE_(\S+?)(~~.+?~~)?\]")
    _pyformat_pattern = re.compile(r"%\(([^)]+?)\)s")
    _positional_pattern = re.compile(
        f"{_pyformat_pattern.pattern}|{_post_compile_pattern.pattern}"
    )

    @classmethod
    def _init_compiler_cls(cls):
        cls._init_bind_translate()

    @classmethod
    def _init_bind_translate(cls):
        reg = re.escape("".join(cls.bindname_escape_characters))
        cls._bind_translate_re = re.compile(f"[{reg}]")
        cls._bind_translate_chars = cls.bindname_escape_characters

    def __init__(
        self,
        dialect: Dialect,
        statement: Optional[ClauseElement],
        cache_key: Optional[CacheKey] = None,
        column_keys: Optional[Sequence[str]] = None,
        for_executemany: bool = False,
        linting: Linting = NO_LINTING,
        _supporting_against: Optional[SQLCompiler] = None,
        **kwargs: Any,
    ):
        """Construct a new :class:`.SQLCompiler` object.

        :param dialect: :class:`.Dialect` to be used

        :param statement: :class:`_expression.ClauseElement` to be compiled

        :param column_keys:  a list of column names to be compiled into an
         INSERT or UPDATE statement.

        :param for_executemany: whether INSERT / UPDATE statements should
         expect that they are to be invoked in an "executemany" style,
         which may impact how the statement will be expected to return the
         values of defaults and autoincrement / sequences and similar.
         Depending on the backend and driver in use, support for retrieving
         these values may be disabled which means SQL expressions may
         be rendered inline, RETURNING may not be rendered, etc.

        :param kwargs: additional keyword arguments to be consumed by the
         superclass.

        """
        self.column_keys = column_keys

        self.cache_key = cache_key

        if cache_key:
            cksm = {b.key: b for b in cache_key[1]}
            ckbm = {b: [b] for b in cache_key[1]}
            self._cache_key_bind_match = (ckbm, cksm)

        # compile INSERT/UPDATE defaults/sequences to expect executemany
        # style execution, which may mean no pre-execute of defaults,
        # or no RETURNING
        self.for_executemany = for_executemany

        self.linting = linting

        # a dictionary of bind parameter keys to BindParameter
        # instances.
        self.binds = {}

        # a dictionary of BindParameter instances to "compiled" names
        # that are actually present in the generated SQL
        self.bind_names = util.column_dict()

        # stack which keeps track of nested SELECT statements
        self.stack = []

        self._result_columns = []

        # true if the paramstyle is positional
        self.positional = dialect.positional
        if self.positional:
            self._numeric_binds = nb = dialect.paramstyle.startswith("numeric")
            if nb:
                self._numeric_binds_identifier_char = (
                    "$" if dialect.paramstyle == "numeric_dollar" else ":"
                )

            self.compilation_bindtemplate = _pyformat_template
        else:
            self.compilation_bindtemplate = BIND_TEMPLATES[dialect.paramstyle]

        self.ctes = None

        self.label_length = (
            dialect.label_length or dialect.max_identifier_length
        )

        # a map which tracks "anonymous" identifiers that are created on
        # the fly here
        self.anon_map = prefix_anon_map()

        # a map which tracks "truncated" names based on
        # dialect.label_length or dialect.max_identifier_length
        self.truncated_names: Dict[Tuple[str, str], str] = {}
        self._truncated_counters: Dict[str, int] = {}

        Compiled.__init__(self, dialect, statement, **kwargs)

        if self.isinsert or self.isupdate or self.isdelete:
            if TYPE_CHECKING:
                assert isinstance(statement, UpdateBase)

            if self.isinsert or self.isupdate:
                if TYPE_CHECKING:
                    assert isinstance(statement, ValuesBase)
                if statement._inline:
                    self.inline = True
                elif self.for_executemany and (
                    not self.isinsert
                    or (
                        self.dialect.insert_executemany_returning
                        and statement._return_defaults
                    )
                ):
                    self.inline = True

        self.bindtemplate = BIND_TEMPLATES[dialect.paramstyle]

        if _supporting_against:
            self.__dict__.update(
                {
                    k: v
                    for k, v in _supporting_against.__dict__.items()
                    if k
                    not in {
                        "state",
                        "dialect",
                        "preparer",
                        "positional",
                        "_numeric_binds",
                        "compilation_bindtemplate",
                        "bindtemplate",
                    }
                }
            )

        if self.state is CompilerState.STRING_APPLIED:
            if self.positional:
                if self._numeric_binds:
                    self._process_numeric()
                else:
                    self._process_positional()

            if self._render_postcompile:
                parameters = self.construct_params(
                    escape_names=False,
                    _no_postcompile=True,
                )

                self._process_parameters_for_postcompile(
                    parameters, _populate_self=True
                )

    @property
    def insert_single_values_expr(self) -> Optional[str]:
        """When an INSERT is compiled with a single set of parameters inside
        a VALUES expression, the string is assigned here, where it can be
        used for insert batching schemes to rewrite the VALUES expression.

        .. versionadded:: 1.3.8

        .. versionchanged:: 2.0 This collection is no longer used by
           SQLAlchemy's built-in dialects, in favor of the currently
           internal ``_insertmanyvalues`` collection that is used only by
           :class:`.SQLCompiler`.

        """
        if self._insertmanyvalues is None:
            return None
        else:
            return self._insertmanyvalues.single_values_expr

    @util.ro_memoized_property
    def effective_returning(self) -> Optional[Sequence[ColumnElement[Any]]]:
        """The effective "returning" columns for INSERT, UPDATE or DELETE.

        This is either the so-called "implicit returning" columns which are
        calculated by the compiler on the fly, or those present based on what's
        present in ``self.statement._returning`` (expanded into individual
        columns using the ``._all_selected_columns`` attribute) i.e. those set
        explicitly using the :meth:`.UpdateBase.returning` method.

        .. versionadded:: 2.0

        """
        if self.implicit_returning:
            return self.implicit_returning
        elif self.statement is not None and is_dml(self.statement):
            return [
                c
                for c in self.statement._all_selected_columns
                if is_column_element(c)
            ]

        else:
            return None

    @property
    def returning(self):
        """backwards compatibility; returns the
        effective_returning collection.

        """
        return self.effective_returning

    @property
    def current_executable(self):
        """Return the current 'executable' that is being compiled.

        This is currently the :class:`_sql.Select`, :class:`_sql.Insert`,
        :class:`_sql.Update`, :class:`_sql.Delete`,
        :class:`_sql.CompoundSelect` object that is being compiled.
        Specifically it's assigned to the ``self.stack`` list of elements.

        When a statement like the above is being compiled, it normally
        is also assigned to the ``.statement`` attribute of the
        :class:`_sql.Compiler` object.   However, all SQL constructs are
        ultimately nestable, and this attribute should never be consulted
        by a ``visit_`` method, as it is not guaranteed to be assigned
        nor guaranteed to correspond to the current statement being compiled.

        .. versionadded:: 1.3.21

            For compatibility with previous versions, use the following
            recipe::

                statement = getattr(self, "current_executable", False)
                if statement is False:
                    statement = self.stack[-1]["selectable"]

            For versions 1.4 and above, ensure only .current_executable
            is used; the format of "self.stack" may change.


        """
        try:
            return self.stack[-1]["selectable"]
        except IndexError as ie:
            raise IndexError("Compiler does not have a stack entry") from ie

    @property
    def prefetch(self):
        return list(self.insert_prefetch) + list(self.update_prefetch)

    @util.memoized_property
    def _global_attributes(self) -> Dict[Any, Any]:
        return {}

    @util.memoized_instancemethod
    def _init_cte_state(self) -> MutableMapping[CTE, str]:
        """Initialize collections related to CTEs only if
        a CTE is located, to save on the overhead of
        these collections otherwise.

        """
        # collect CTEs to tack on top of a SELECT
        # To store the query to print - Dict[cte, text_query]
        ctes: MutableMapping[CTE, str] = util.OrderedDict()
        self.ctes = ctes

        # Detect same CTE references - Dict[(level, name), cte]
        # Level is required for supporting nesting
        self.ctes_by_level_name = {}

        # To retrieve key/level in ctes_by_level_name -
        # Dict[cte_reference, (level, cte_name, cte_opts)]
        self.level_name_by_cte = {}

        self.ctes_recursive = False

        return ctes

    @contextlib.contextmanager
    def _nested_result(self):
        """special API to support the use case of 'nested result sets'"""
        result_columns, ordered_columns = (
            self._result_columns,
            self._ordered_columns,
        )
        self._result_columns, self._ordered_columns = [], False

        try:
            if self.stack:
                entry = self.stack[-1]
                entry["need_result_map_for_nested"] = True
            else:
                entry = None
            yield self._result_columns, self._ordered_columns
        finally:
            if entry:
                entry.pop("need_result_map_for_nested")
            self._result_columns, self._ordered_columns = (
                result_columns,
                ordered_columns,
            )

    def _process_positional(self):
        assert not self.positiontup
        assert self.state is CompilerState.STRING_APPLIED
        assert not self._numeric_binds

        if self.dialect.paramstyle == "format":
            placeholder = "%s"
        else:
            assert self.dialect.paramstyle == "qmark"
            placeholder = "?"

        positions = []

        def find_position(m: re.Match[str]) -> str:
            normal_bind = m.group(1)
            if normal_bind:
                positions.append(normal_bind)
                return placeholder
            else:
                # this a post-compile bind
                positions.append(m.group(2))
                return m.group(0)

        self.string = re.sub(
            self._positional_pattern, find_position, self.string
        )

        if self.escaped_bind_names:
            reverse_escape = {v: k for k, v in self.escaped_bind_names.items()}
            assert len(self.escaped_bind_names) == len(reverse_escape)
            self.positiontup = [
                reverse_escape.get(name, name) for name in positions
            ]
        else:
            self.positiontup = positions

        if self._insertmanyvalues:
            positions = []

            single_values_expr = re.sub(
                self._positional_pattern,
                find_position,
                self._insertmanyvalues.single_values_expr,
            )
            insert_crud_params = [
                (
                    v[0],
                    v[1],
                    re.sub(self._positional_pattern, find_position, v[2]),
                    v[3],
                )
                for v in self._insertmanyvalues.insert_crud_params
            ]

            sentinel_param_int_idxs = (
                [
                    self.positiontup.index(cast(str, _param_key))
                    for _param_key in self._insertmanyvalues.sentinel_param_keys  # noqa: E501
                ]
                if self._insertmanyvalues.sentinel_param_keys is not None
                else None
            )

            self._insertmanyvalues = self._insertmanyvalues._replace(
                single_values_expr=single_values_expr,
                insert_crud_params=insert_crud_params,
                sentinel_param_keys=sentinel_param_int_idxs,
            )

    def _process_numeric(self):
        assert self._numeric_binds
        assert self.state is CompilerState.STRING_APPLIED

        num = 1
        param_pos: Dict[str, str] = {}
        order: Iterable[str]
        if self._insertmanyvalues and self._values_bindparam is not None:
            # bindparams that are not in values are always placed first.
            # this avoids the need of changing them when using executemany
            # values () ()
            order = itertools.chain(
                (
                    name
                    for name in self.bind_names.values()
                    if name not in self._values_bindparam
                ),
                self.bind_names.values(),
            )
        else:
            order = self.bind_names.values()

        for bind_name in order:
            if bind_name in param_pos:
                continue
            bind = self.binds[bind_name]
            if (
                bind in self.post_compile_params
                or bind in self.literal_execute_params
            ):
                # set to None to just mark the in positiontup, it will not
                # be replaced below.
                param_pos[bind_name] = None  # type: ignore
            else:
                ph = f"{self._numeric_binds_identifier_char}{num}"
                num += 1
                param_pos[bind_name] = ph

        self.next_numeric_pos = num

        self.positiontup = list(param_pos)
        if self.escaped_bind_names:
            len_before = len(param_pos)
            param_pos = {
                self.escaped_bind_names.get(name, name): pos
                for name, pos in param_pos.items()
            }
            assert len(param_pos) == len_before

        # Can't use format here since % chars are not escaped.
        self.string = self._pyformat_pattern.sub(
            lambda m: param_pos[m.group(1)], self.string
        )

        if self._insertmanyvalues:
            single_values_expr = (
                # format is ok here since single_values_expr includes only
                # place-holders
                self._insertmanyvalues.single_values_expr
                % param_pos
            )
            insert_crud_params = [
                (v[0], v[1], "%s", v[3])
                for v in self._insertmanyvalues.insert_crud_params
            ]

            sentinel_param_int_idxs = (
                [
                    self.positiontup.index(cast(str, _param_key))
                    for _param_key in self._insertmanyvalues.sentinel_param_keys  # noqa: E501
                ]
                if self._insertmanyvalues.sentinel_param_keys is not None
                else None
            )

            self._insertmanyvalues = self._insertmanyvalues._replace(
                # This has the numbers (:1, :2)
                single_values_expr=single_values_expr,
                # The single binds are instead %s so they can be formatted
                insert_crud_params=insert_crud_params,
                sentinel_param_keys=sentinel_param_int_idxs,
            )

    @util.memoized_property
    def _bind_processors(
        self,
    ) -> MutableMapping[
        str, Union[_BindProcessorType[Any], Sequence[_BindProcessorType[Any]]]
    ]:
        # mypy is not able to see the two value types as the above Union,
        # it just sees "object".  don't know how to resolve
        return {
            key: value  # type: ignore
            for key, value in (
                (
                    self.bind_names[bindparam],
                    bindparam.type._cached_bind_processor(self.dialect)
                    if not bindparam.type._is_tuple_type
                    else tuple(
                        elem_type._cached_bind_processor(self.dialect)
                        for elem_type in cast(TupleType, bindparam.type).types
                    ),
                )
                for bindparam in self.bind_names
            )
            if value is not None
        }

    @util.memoized_property
    def _imv_sentinel_value_resolvers(
        self,
    ) -> Optional[Sequence[Optional[_SentinelProcessorType[Any]]]]:
        imv = self._insertmanyvalues
        if imv is None or imv.sentinel_columns is None:
            return None

        sentinel_value_resolvers = [
            _scol.type._cached_sentinel_value_processor(self.dialect)
            for _scol in imv.sentinel_columns
        ]
        if util.NONE_SET.issuperset(sentinel_value_resolvers):
            return None
        else:
            return sentinel_value_resolvers

    def is_subquery(self):
        return len(self.stack) > 1

    @property
    def sql_compiler(self):
        return self

    def construct_expanded_state(
        self,
        params: Optional[_CoreSingleExecuteParams] = None,
        escape_names: bool = True,
    ) -> ExpandedState:
        """Return a new :class:`.ExpandedState` for a given parameter set.

        For queries that use "expanding" or other late-rendered parameters,
        this method will provide for both the finalized SQL string as well
        as the parameters that would be used for a particular parameter set.

        .. versionadded:: 2.0.0rc1

        """
        parameters = self.construct_params(
            params,
            escape_names=escape_names,
            _no_postcompile=True,
        )
        return self._process_parameters_for_postcompile(
            parameters,
        )

    def construct_params(
        self,
        params: Optional[_CoreSingleExecuteParams] = None,
        extracted_parameters: Optional[Sequence[BindParameter[Any]]] = None,
        escape_names: bool = True,
        _group_number: Optional[int] = None,
        _check: bool = True,
        _no_postcompile: bool = False,
    ) -> _MutableCoreSingleExecuteParams:
        """return a dictionary of bind parameter keys and values"""

        if self._render_postcompile and not _no_postcompile:
            assert self._post_compile_expanded_state is not None
            if not params:
                return dict(self._post_compile_expanded_state.parameters)
            else:
                raise exc.InvalidRequestError(
                    "can't construct new parameters when render_postcompile "
                    "is used; the statement is hard-linked to the original "
                    "parameters.  Use construct_expanded_state to generate a "
                    "new statement and parameters."
                )

        has_escaped_names = escape_names and bool(self.escaped_bind_names)

        if extracted_parameters:
            # related the bound parameters collected in the original cache key
            # to those collected in the incoming cache key.  They will not have
            # matching names but they will line up positionally in the same
            # way.   The parameters present in self.bind_names may be clones of
            # these original cache key params in the case of DML but the .key
            # will be guaranteed to match.
            if self.cache_key is None:
                raise exc.CompileError(
                    "This compiled object has no original cache key; "
                    "can't pass extracted_parameters to construct_params"
                )
            else:
                orig_extracted = self.cache_key[1]

            ckbm_tuple = self._cache_key_bind_match
            assert ckbm_tuple is not None
            ckbm, _ = ckbm_tuple
            resolved_extracted = {
                bind: extracted
                for b, extracted in zip(orig_extracted, extracted_parameters)
                for bind in ckbm[b]
            }
        else:
            resolved_extracted = None

        if params:
            pd = {}
            for bindparam, name in self.bind_names.items():
                escaped_name = (
                    self.escaped_bind_names.get(name, name)
                    if has_escaped_names
                    else name
                )

                if bindparam.key in params:
                    pd[escaped_name] = params[bindparam.key]
                elif name in params:
                    pd[escaped_name] = params[name]

                elif _check and bindparam.required:
                    if _group_number:
                        raise exc.InvalidRequestError(
                            "A value is required for bind parameter %r, "
                            "in parameter group %d"
                            % (bindparam.key, _group_number),
                            code="cd3x",
                        )
                    else:
                        raise exc.InvalidRequestError(
                            "A value is required for bind parameter %r"
                            % bindparam.key,
                            code="cd3x",
                        )
                else:
                    if resolved_extracted:
                        value_param = resolved_extracted.get(
                            bindparam, bindparam
                        )
                    else:
                        value_param = bindparam

                    if bindparam.callable:
                        pd[escaped_name] = value_param.effective_value
                    else:
                        pd[escaped_name] = value_param.value
            return pd
        else:
            pd = {}
            for bindparam, name in self.bind_names.items():
                escaped_name = (
                    self.escaped_bind_names.get(name, name)
                    if has_escaped_names
                    else name
                )

                if _check and bindparam.required:
                    if _group_number:
                        raise exc.InvalidRequestError(
                            "A value is required for bind parameter %r, "
                            "in parameter group %d"
                            % (bindparam.key, _group_number),
                            code="cd3x",
                        )
                    else:
                        raise exc.InvalidRequestError(
                            "A value is required for bind parameter %r"
                            % bindparam.key,
                            code="cd3x",
                        )

                if resolved_extracted:
                    value_param = resolved_extracted.get(bindparam, bindparam)
                else:
                    value_param = bindparam

                if bindparam.callable:
                    pd[escaped_name] = value_param.effective_value
                else:
                    pd[escaped_name] = value_param.value

            return pd

    @util.memoized_instancemethod
    def _get_set_input_sizes_lookup(self):
        dialect = self.dialect

        include_types = dialect.include_set_input_sizes
        exclude_types = dialect.exclude_set_input_sizes

        dbapi = dialect.dbapi

        def lookup_type(typ):
            dbtype = typ._unwrapped_dialect_impl(dialect).get_dbapi_type(dbapi)

            if (
                dbtype is not None
                and (exclude_types is None or dbtype not in exclude_types)
                and (include_types is None or dbtype in include_types)
            ):
                return dbtype
            else:
                return None

        inputsizes = {}

        literal_execute_params = self.literal_execute_params

        for bindparam in self.bind_names:
            if bindparam in literal_execute_params:
                continue

            if bindparam.type._is_tuple_type:
                inputsizes[bindparam] = [
                    lookup_type(typ)
                    for typ in cast(TupleType, bindparam.type).types
                ]
            else:
                inputsizes[bindparam] = lookup_type(bindparam.type)

        return inputsizes

    @property
    def params(self):
        """Return the bind param dictionary embedded into this
        compiled object, for those values that are present.

        .. seealso::

            :ref:`faq_sql_expression_string` - includes a usage example for
            debugging use cases.

        """
        return self.construct_params(_check=False)

    def _process_parameters_for_postcompile(
        self,
        parameters: _MutableCoreSingleExecuteParams,
        _populate_self: bool = False,
    ) -> ExpandedState:
        """handle special post compile parameters.

        These include:

        * "expanding" parameters -typically IN tuples that are rendered
          on a per-parameter basis for an otherwise fixed SQL statement string.

        * literal_binds compiled with the literal_execute flag.  Used for
          things like SQL Server "TOP N" where the driver does not accommodate
          N as a bound parameter.

        """

        expanded_parameters = {}
        new_positiontup: Optional[List[str]]

        pre_expanded_string = self._pre_expanded_string
        if pre_expanded_string is None:
            pre_expanded_string = self.string

        if self.positional:
            new_positiontup = []

            pre_expanded_positiontup = self._pre_expanded_positiontup
            if pre_expanded_positiontup is None:
                pre_expanded_positiontup = self.positiontup

        else:
            new_positiontup = pre_expanded_positiontup = None

        processors = self._bind_processors
        single_processors = cast(
            "Mapping[str, _BindProcessorType[Any]]", processors
        )
        tuple_processors = cast(
            "Mapping[str, Sequence[_BindProcessorType[Any]]]", processors
        )

        new_processors: Dict[str, _BindProcessorType[Any]] = {}

        replacement_expressions: Dict[str, Any] = {}
        to_update_sets: Dict[str, Any] = {}

        # notes:
        # *unescaped* parameter names in:
        # self.bind_names, self.binds, self._bind_processors, self.positiontup
        #
        # *escaped* parameter names in:
        # construct_params(), replacement_expressions

        numeric_positiontup: Optional[List[str]] = None

        if self.positional and pre_expanded_positiontup is not None:
            names: Iterable[str] = pre_expanded_positiontup
            if self._numeric_binds:
                numeric_positiontup = []
        else:
            names = self.bind_names.values()

        ebn = self.escaped_bind_names
        for name in names:
            escaped_name = ebn.get(name, name) if ebn else name
            parameter = self.binds[name]

            if parameter in self.literal_execute_params:
                if escaped_name not in replacement_expressions:
                    replacement_expressions[
                        escaped_name
                    ] = self.render_literal_bindparam(
                        parameter,
                        render_literal_value=parameters.pop(escaped_name),
                    )
                continue

            if parameter in self.post_compile_params:
                if escaped_name in replacement_expressions:
                    to_update = to_update_sets[escaped_name]
                    values = None
                else:
                    # we are removing the parameter from parameters
                    # because it is a list value, which is not expected by
                    # TypeEngine objects that would otherwise be asked to
                    # process it. the single name is being replaced with
                    # individual numbered parameters for each value in the
                    # param.
                    #
                    # note we are also inserting *escaped* parameter names
                    # into the given dictionary.   default dialect will
                    # use these param names directly as they will not be
                    # in the escaped_bind_names dictionary.
                    values = parameters.pop(name)

                    leep_res = self._literal_execute_expanding_parameter(
                        escaped_name, parameter, values
                    )
                    (to_update, replacement_expr) = leep_res

                    to_update_sets[escaped_name] = to_update
                    replacement_expressions[escaped_name] = replacement_expr

                if not parameter.literal_execute:
                    parameters.update(to_update)
                    if parameter.type._is_tuple_type:
                        assert values is not None
                        new_processors.update(
                            (
                                "%s_%s_%s" % (name, i, j),
                                tuple_processors[name][j - 1],
                            )
                            for i, tuple_element in enumerate(values, 1)
                            for j, _ in enumerate(tuple_element, 1)
                            if name in tuple_processors
                            and tuple_processors[name][j - 1] is not None
                        )
                    else:
                        new_processors.update(
                            (key, single_processors[name])
                            for key, _ in to_update
                            if name in single_processors
                        )
                    if numeric_positiontup is not None:
                        numeric_positiontup.extend(
                            name for name, _ in to_update
                        )
                    elif new_positiontup is not None:
                        # to_update has escaped names, but that's ok since
                        # these are new names, that aren't in the
                        # escaped_bind_names dict.
                        new_positiontup.extend(name for name, _ in to_update)
                    expanded_parameters[name] = [
                        expand_key for expand_key, _ in to_update
                    ]
            elif new_positiontup is not None:
                new_positiontup.append(name)

        def process_expanding(m):
            key = m.group(1)
            expr = replacement_expressions[key]

            # if POSTCOMPILE included a bind_expression, render that
            # around each element
            if m.group(2):
                tok = m.group(2).split("~~")
                be_left, be_right = tok[1], tok[3]
                expr = ", ".join(
                    "%s%s%s" % (be_left, exp, be_right)
                    for exp in expr.split(", ")
                )
            return expr

        statement = re.sub(
            self._post_compile_pattern, process_expanding, pre_expanded_string
        )

        if numeric_positiontup is not None:
            assert new_positiontup is not None
            param_pos = {
                key: f"{self._numeric_binds_identifier_char}{num}"
                for num, key in enumerate(
                    numeric_positiontup, self.next_numeric_pos
                )
            }
            # Can't use format here since % chars are not escaped.
            statement = self._pyformat_pattern.sub(
                lambda m: param_pos[m.group(1)], statement
            )
            new_positiontup.extend(numeric_positiontup)

        expanded_state = ExpandedState(
            statement,
            parameters,
            new_processors,
            new_positiontup,
            expanded_parameters,
        )

        if _populate_self:
            # this is for the "render_postcompile" flag, which is not
            # otherwise used internally and is for end-user debugging and
            # special use cases.
            self._pre_expanded_string = pre_expanded_string
            self._pre_expanded_positiontup = pre_expanded_positiontup
            self.string = expanded_state.statement
            self.positiontup = (
                list(expanded_state.positiontup or ())
                if self.positional
                else None
            )
            self._post_compile_expanded_state = expanded_state

        return expanded_state

    @util.preload_module("sqlalchemy.engine.cursor")
    def _create_result_map(self):
        """utility method used for unit tests only."""
        cursor = util.preloaded.engine_cursor
        return cursor.CursorResultMetaData._create_description_match_map(
            self._result_columns
        )

    # assigned by crud.py for insert/update statements
    _get_bind_name_for_col: _BindNameForColProtocol

    @util.memoized_property
    def _within_exec_param_key_getter(self) -> Callable[[Any], str]:
        getter = self._get_bind_name_for_col
        return getter

    @util.memoized_property
    @util.preload_module("sqlalchemy.engine.result")
    def _inserted_primary_key_from_lastrowid_getter(self):
        result = util.preloaded.engine_result

        param_key_getter = self._within_exec_param_key_getter

        assert self.compile_state is not None
        statement = self.compile_state.statement

        if TYPE_CHECKING:
            assert isinstance(statement, Insert)

        table = statement.table

        getters = [
            (operator.methodcaller("get", param_key_getter(col), None), col)
            for col in table.primary_key
        ]

        autoinc_getter = None
        autoinc_col = table._autoincrement_column
        if autoinc_col is not None:
            # apply type post processors to the lastrowid
            lastrowid_processor = autoinc_col.type._cached_result_processor(
                self.dialect, None
            )
            autoinc_key = param_key_getter(autoinc_col)

            # if a bind value is present for the autoincrement column
            # in the parameters, we need to do the logic dictated by
            # #7998; honor a non-None user-passed parameter over lastrowid.
            # previously in the 1.4 series we weren't fetching lastrowid
            # at all if the key were present in the parameters
            if autoinc_key in self.binds:

                def _autoinc_getter(lastrowid, parameters):
                    param_value = parameters.get(autoinc_key, lastrowid)
                    if param_value is not None:
                        # they supplied non-None parameter, use that.
                        # SQLite at least is observed to return the wrong
                        # cursor.lastrowid for INSERT..ON CONFLICT so it
                        # can't be used in all cases
                        return param_value
                    else:
                        # use lastrowid
                        return lastrowid

                # work around mypy https://github.com/python/mypy/issues/14027
                autoinc_getter = _autoinc_getter

        else:
            lastrowid_processor = None

        row_fn = result.result_tuple([col.key for col in table.primary_key])

        def get(lastrowid, parameters):
            """given cursor.lastrowid value and the parameters used for INSERT,
            return a "row" that represents the primary key, either by
            using the "lastrowid" or by extracting values from the parameters
            that were sent along with the INSERT.

            """
            if lastrowid_processor is not None:
                lastrowid = lastrowid_processor(lastrowid)

            if lastrowid is None:
                return row_fn(getter(parameters) for getter, col in getters)
            else:
                return row_fn(
                    (
                        autoinc_getter(lastrowid, parameters)
                        if autoinc_getter is not None
                        else lastrowid
                    )
                    if col is autoinc_col
                    else getter(parameters)
                    for getter, col in getters
                )

        return get

    @util.memoized_property
    @util.preload_module("sqlalchemy.engine.result")
    def _inserted_primary_key_from_returning_getter(self):
        if typing.TYPE_CHECKING:
            from ..engine import result
        else:
            result = util.preloaded.engine_result

        assert self.compile_state is not None
        statement = self.compile_state.statement

        if TYPE_CHECKING:
            assert isinstance(statement, Insert)

        param_key_getter = self._within_exec_param_key_getter
        table = statement.table

        returning = self.implicit_returning
        assert returning is not None
        ret = {col: idx for idx, col in enumerate(returning)}

        getters = cast(
            "List[Tuple[Callable[[Any], Any], bool]]",
            [
                (operator.itemgetter(ret[col]), True)
                if col in ret
                else (
                    operator.methodcaller("get", param_key_getter(col), None),
                    False,
                )
                for col in table.primary_key
            ],
        )

        row_fn = result.result_tuple([col.key for col in table.primary_key])

        def get(row, parameters):
            return row_fn(
                getter(row) if use_row else getter(parameters)
                for getter, use_row in getters
            )

        return get

    def default_from(self):
        """Called when a SELECT statement has no froms, and no FROM clause is
        to be appended.

        Gives Oracle a chance to tack on a ``FROM DUAL`` to the string output.

        """
        return ""

    def visit_grouping(self, grouping, asfrom=False, **kwargs):
        return "(" + grouping.element._compiler_dispatch(self, **kwargs) + ")"

    def visit_select_statement_grouping(self, grouping, **kwargs):
        return "(" + grouping.element._compiler_dispatch(self, **kwargs) + ")"

    def visit_label_reference(
        self, element, within_columns_clause=False, **kwargs
    ):
        if self.stack and self.dialect.supports_simple_order_by_label:
            try:
                compile_state = cast(
                    "Union[SelectState, CompoundSelectState]",
                    self.stack[-1]["compile_state"],
                )
            except KeyError as ke:
                raise exc.CompileError(
                    "Can't resolve label reference for ORDER BY / "
                    "GROUP BY / DISTINCT etc."
                ) from ke

            (
                with_cols,
                only_froms,
                only_cols,
            ) = compile_state._label_resolve_dict
            if within_columns_clause:
                resolve_dict = only_froms
            else:
                resolve_dict = only_cols

            # this can be None in the case that a _label_reference()
            # were subject to a replacement operation, in which case
            # the replacement of the Label element may have changed
            # to something else like a ColumnClause expression.
            order_by_elem = element.element._order_by_label_element

            if (
                order_by_elem is not None
                and order_by_elem.name in resolve_dict
                and order_by_elem.shares_lineage(
                    resolve_dict[order_by_elem.name]
                )
            ):
                kwargs[
                    "render_label_as_label"
                ] = element.element._order_by_label_element
        return self.process(
            element.element,
            within_columns_clause=within_columns_clause,
            **kwargs,
        )

    def visit_textual_label_reference(
        self, element, within_columns_clause=False, **kwargs
    ):
        if not self.stack:
            # compiling the element outside of the context of a SELECT
            return self.process(element._text_clause)

        try:
            compile_state = cast(
                "Union[SelectState, CompoundSelectState]",
                self.stack[-1]["compile_state"],
            )
        except KeyError as ke:
            coercions._no_text_coercion(
                element.element,
                extra=(
                    "Can't resolve label reference for ORDER BY / "
                    "GROUP BY / DISTINCT etc."
                ),
                exc_cls=exc.CompileError,
                err=ke,
            )

        with_cols, only_froms, only_cols = compile_state._label_resolve_dict
        try:
            if within_columns_clause:
                col = only_froms[element.element]
            else:
                col = with_cols[element.element]
        except KeyError as err:
            coercions._no_text_coercion(
                element.element,
                extra=(
                    "Can't resolve label reference for ORDER BY / "
                    "GROUP BY / DISTINCT etc."
                ),
                exc_cls=exc.CompileError,
                err=err,
            )
        else:
            kwargs["render_label_as_label"] = col
            return self.process(
                col, within_columns_clause=within_columns_clause, **kwargs
            )

    def visit_label(
        self,
        label,
        add_to_result_map=None,
        within_label_clause=False,
        within_columns_clause=False,
        render_label_as_label=None,
        result_map_targets=(),
        **kw,
    ):
        # only render labels within the columns clause
        # or ORDER BY clause of a select.  dialect-specific compilers
        # can modify this behavior.
        render_label_with_as = (
            within_columns_clause and not within_label_clause
        )
        render_label_only = render_label_as_label is label

        if render_label_only or render_label_with_as:
            if isinstance(label.name, elements._truncated_label):
                labelname = self._truncated_identifier("colident", label.name)
            else:
                labelname = label.name

        if render_label_with_as:
            if add_to_result_map is not None:
                add_to_result_map(
                    labelname,
                    label.name,
                    (label, labelname) + label._alt_names + result_map_targets,
                    label.type,
                )
            return (
                label.element._compiler_dispatch(
                    self,
                    within_columns_clause=True,
                    within_label_clause=True,
                    **kw,
                )
                + OPERATORS[operators.as_]
                + self.preparer.format_label(label, labelname)
            )
        elif render_label_only:
            return self.preparer.format_label(label, labelname)
        else:
            return label.element._compiler_dispatch(
                self, within_columns_clause=False, **kw
            )

    def _fallback_column_name(self, column):
        raise exc.CompileError(
            "Cannot compile Column object until " "its 'name' is assigned."
        )

    def visit_lambda_element(self, element, **kw):
        sql_element = element._resolved
        return self.process(sql_element, **kw)

    def visit_column(
        self,
        column: ColumnClause[Any],
        add_to_result_map: Optional[_ResultMapAppender] = None,
        include_table: bool = True,
        result_map_targets: Tuple[Any, ...] = (),
        ambiguous_table_name_map: Optional[_AmbiguousTableNameMap] = None,
        **kwargs: Any,
    ) -> str:
        name = orig_name = column.name
        if name is None:
            name = self._fallback_column_name(column)

        is_literal = column.is_literal
        if not is_literal and isinstance(name, elements._truncated_label):
            name = self._truncated_identifier("colident", name)

        if add_to_result_map is not None:
            targets = (column, name, column.key) + result_map_targets
            if column._tq_label:
                targets += (column._tq_label,)

            add_to_result_map(name, orig_name, targets, column.type)

        if is_literal:
            # note we are not currently accommodating for
            # literal_column(quoted_name('ident', True)) here
            name = self.escape_literal_column(name)
        else:
            name = self.preparer.quote(name)
        table = column.table
        if table is None or not include_table or not table.named_with_column:
            return name
        else:
            effective_schema = self.preparer.schema_for_object(table)

            if effective_schema:
                schema_prefix = (
                    self.preparer.quote_schema(effective_schema) + "."
                )
            else:
                schema_prefix = ""

            if TYPE_CHECKING:
                assert isinstance(table, NamedFromClause)
            tablename = table.name

            if (
                not effective_schema
                and ambiguous_table_name_map
                and tablename in ambiguous_table_name_map
            ):
                tablename = ambiguous_table_name_map[tablename]

            if isinstance(tablename, elements._truncated_label):
                tablename = self._truncated_identifier("alias", tablename)

            return schema_prefix + self.preparer.quote(tablename) + "." + name

    def visit_collation(self, element, **kw):
        return self.preparer.format_collation(element.collation)

    def visit_fromclause(self, fromclause, **kwargs):
        return fromclause.name

    def visit_index(self, index, **kwargs):
        return index.name

    def visit_typeclause(self, typeclause, **kw):
        kw["type_expression"] = typeclause
        kw["identifier_preparer"] = self.preparer
        return self.dialect.type_compiler_instance.process(
            typeclause.type, **kw
        )

    def post_process_text(self, text):
        if self.preparer._double_percents:
            text = text.replace("%", "%%")
        return text

    def escape_literal_column(self, text):
        if self.preparer._double_percents:
            text = text.replace("%", "%%")
        return text

    def visit_textclause(self, textclause, add_to_result_map=None, **kw):
        def do_bindparam(m):
            name = m.group(1)
            if name in textclause._bindparams:
                return self.process(textclause._bindparams[name], **kw)
            else:
                return self.bindparam_string(name, **kw)

        if not self.stack:
            self.isplaintext = True

        if add_to_result_map:
            # text() object is present in the columns clause of a
            # select().   Add a no-name entry to the result map so that
            # row[text()] produces a result
            add_to_result_map(None, None, (textclause,), sqltypes.NULLTYPE)

        # un-escape any \:params
        return BIND_PARAMS_ESC.sub(
            lambda m: m.group(1),
            BIND_PARAMS.sub(
                do_bindparam, self.post_process_text(textclause.text)
            ),
        )

    def visit_textual_select(
        self, taf, compound_index=None, asfrom=False, **kw
    ):
        toplevel = not self.stack
        entry = self._default_stack_entry if toplevel else self.stack[-1]

        new_entry: _CompilerStackEntry = {
            "correlate_froms": set(),
            "asfrom_froms": set(),
            "selectable": taf,
        }
        self.stack.append(new_entry)

        if taf._independent_ctes:
            self._dispatch_independent_ctes(taf, kw)

        populate_result_map = (
            toplevel
            or (
                compound_index == 0
                and entry.get("need_result_map_for_compound", False)
            )
            or entry.get("need_result_map_for_nested", False)
        )

        if populate_result_map:
            self._ordered_columns = (
                self._textual_ordered_columns
            ) = taf.positional

            # enable looser result column matching when the SQL text links to
            # Column objects by name only
            self._loose_column_name_matching = not taf.positional and bool(
                taf.column_args
            )

            for c in taf.column_args:
                self.process(
                    c,
                    within_columns_clause=True,
                    add_to_result_map=self._add_to_result_map,
                )

        text = self.process(taf.element, **kw)
        if self.ctes:
            nesting_level = len(self.stack) if not toplevel else None
            text = self._render_cte_clause(nesting_level=nesting_level) + text

        self.stack.pop(-1)

        return text

    def visit_null(self, expr, **kw):
        return "NULL"

    def visit_true(self, expr, **kw):
        if self.dialect.supports_native_boolean:
            return "true"
        else:
            return "1"

    def visit_false(self, expr, **kw):
        if self.dialect.supports_native_boolean:
            return "false"
        else:
            return "0"

    def _generate_delimited_list(self, elements, separator, **kw):
        return separator.join(
            s
            for s in (c._compiler_dispatch(self, **kw) for c in elements)
            if s
        )

    def _generate_delimited_and_list(self, clauses, **kw):
        lcc, clauses = elements.BooleanClauseList._process_clauses_for_boolean(
            operators.and_,
            elements.True_._singleton,
            elements.False_._singleton,
            clauses,
        )
        if lcc == 1:
            return clauses[0]._compiler_dispatch(self, **kw)
        else:
            separator = OPERATORS[operators.and_]
            return separator.join(
                s
                for s in (c._compiler_dispatch(self, **kw) for c in clauses)
                if s
            )

    def visit_tuple(self, clauselist, **kw):
        return "(%s)" % self.visit_clauselist(clauselist, **kw)

    def visit_clauselist(self, clauselist, **kw):
        sep = clauselist.operator
        if sep is None:
            sep = " "
        else:
            sep = OPERATORS[clauselist.operator]

        return self._generate_delimited_list(clauselist.clauses, sep, **kw)

    def visit_expression_clauselist(self, clauselist, **kw):
        operator_ = clauselist.operator

        disp = self._get_operator_dispatch(
            operator_, "expression_clauselist", None
        )
        if disp:
            return disp(clauselist, operator_, **kw)

        try:
            opstring = OPERATORS[operator_]
        except KeyError as err:
            raise exc.UnsupportedCompilationError(self, operator_) from err
        else:
            kw["_in_operator_expression"] = True
            return self._generate_delimited_list(
                clauselist.clauses, opstring, **kw
            )

    def visit_case(self, clause, **kwargs):
        x = "CASE "
        if clause.value is not None:
            x += clause.value._compiler_dispatch(self, **kwargs) + " "
        for cond, result in clause.whens:
            x += (
                "WHEN "
                + cond._compiler_dispatch(self, **kwargs)
                + " THEN "
                + result._compiler_dispatch(self, **kwargs)
                + " "
            )
        if clause.else_ is not None:
            x += (
                "ELSE " + clause.else_._compiler_dispatch(self, **kwargs) + " "
            )
        x += "END"
        return x

    def visit_type_coerce(self, type_coerce, **kw):
        return type_coerce.typed_expression._compiler_dispatch(self, **kw)

    def visit_cast(self, cast, **kwargs):
        type_clause = cast.typeclause._compiler_dispatch(self, **kwargs)
        match = re.match("(.*)( COLLATE .*)", type_clause)
        return "CAST(%s AS %s)%s" % (
            cast.clause._compiler_dispatch(self, **kwargs),
            match.group(1) if match else type_clause,
            match.group(2) if match else "",
        )

    def _format_frame_clause(self, range_, **kw):
        return "%s AND %s" % (
            "UNBOUNDED PRECEDING"
            if range_[0] is elements.RANGE_UNBOUNDED
            else "CURRENT ROW"
            if range_[0] is elements.RANGE_CURRENT
            else "%s PRECEDING"
            % (self.process(elements.literal(abs(range_[0])), **kw),)
            if range_[0] < 0
            else "%s FOLLOWING"
            % (self.process(elements.literal(range_[0]), **kw),),
            "UNBOUNDED FOLLOWING"
            if range_[1] is elements.RANGE_UNBOUNDED
            else "CURRENT ROW"
            if range_[1] is elements.RANGE_CURRENT
            else "%s PRECEDING"
            % (self.process(elements.literal(abs(range_[1])), **kw),)
            if range_[1] < 0
            else "%s FOLLOWING"
            % (self.process(elements.literal(range_[1]), **kw),),
        )

    def visit_over(self, over, **kwargs):
        text = over.element._compiler_dispatch(self, **kwargs)
        if over.range_:
            range_ = "RANGE BETWEEN %s" % self._format_frame_clause(
                over.range_, **kwargs
            )
        elif over.rows:
            range_ = "ROWS BETWEEN %s" % self._format_frame_clause(
                over.rows, **kwargs
            )
        else:
            range_ = None

        return "%s OVER (%s)" % (
            text,
            " ".join(
                [
                    "%s BY %s"
                    % (word, clause._compiler_dispatch(self, **kwargs))
                    for word, clause in (
                        ("PARTITION", over.partition_by),
                        ("ORDER", over.order_by),
                    )
                    if clause is not None and len(clause)
                ]
                + ([range_] if range_ else [])
            ),
        )

    def visit_withingroup(self, withingroup, **kwargs):
        return "%s WITHIN GROUP (ORDER BY %s)" % (
            withingroup.element._compiler_dispatch(self, **kwargs),
            withingroup.order_by._compiler_dispatch(self, **kwargs),
        )

    def visit_funcfilter(self, funcfilter, **kwargs):
        return "%s FILTER (WHERE %s)" % (
            funcfilter.func._compiler_dispatch(self, **kwargs),
            funcfilter.criterion._compiler_dispatch(self, **kwargs),
        )

    def visit_extract(self, extract, **kwargs):
        field = self.extract_map.get(extract.field, extract.field)
        return "EXTRACT(%s FROM %s)" % (
            field,
            extract.expr._compiler_dispatch(self, **kwargs),
        )

    def visit_scalar_function_column(self, element, **kw):
        compiled_fn = self.visit_function(element.fn, **kw)
        compiled_col = self.visit_column(element, **kw)
        return "(%s).%s" % (compiled_fn, compiled_col)

    def visit_function(
        self,
        func: Function[Any],
        add_to_result_map: Optional[_ResultMapAppender] = None,
        **kwargs: Any,
    ) -> str:
        if add_to_result_map is not None:
            add_to_result_map(func.name, func.name, (), func.type)

        disp = getattr(self, "visit_%s_func" % func.name.lower(), None)

        text: str

        if disp:
            text = disp(func, **kwargs)
        else:
            name = FUNCTIONS.get(func._deannotate().__class__, None)
            if name:
                if func._has_args:
                    name += "%(expr)s"
            else:
                name = func.name
                name = (
                    self.preparer.quote(name)
                    if self.preparer._requires_quotes_illegal_chars(name)
                    or isinstance(name, elements.quoted_name)
                    else name
                )
                name = name + "%(expr)s"
            text = ".".join(
                [
                    (
                        self.preparer.quote(tok)
                        if self.preparer._requires_quotes_illegal_chars(tok)
                        or isinstance(name, elements.quoted_name)
                        else tok
                    )
                    for tok in func.packagenames
                ]
                + [name]
            ) % {"expr": self.function_argspec(func, **kwargs)}

        if func._with_ordinality:
            text += " WITH ORDINALITY"
        return text

    def visit_next_value_func(self, next_value, **kw):
        return self.visit_sequence(next_value.sequence)

    def visit_sequence(self, sequence, **kw):
        raise NotImplementedError(
            "Dialect '%s' does not support sequence increments."
            % self.dialect.name
        )

    def function_argspec(self, func, **kwargs):
        return func.clause_expr._compiler_dispatch(self, **kwargs)

    def visit_compound_select(
        self, cs, asfrom=False, compound_index=None, **kwargs
    ):
        toplevel = not self.stack

        compile_state = cs._compile_state_factory(cs, self, **kwargs)

        if toplevel and not self.compile_state:
            self.compile_state = compile_state

        compound_stmt = compile_state.statement

        entry = self._default_stack_entry if toplevel else self.stack[-1]
        need_result_map = toplevel or (
            not compound_index
            and entry.get("need_result_map_for_compound", False)
        )

        # indicates there is already a CompoundSelect in play
        if compound_index == 0:
            entry["select_0"] = cs

        self.stack.append(
            {
                "correlate_froms": entry["correlate_froms"],
                "asfrom_froms": entry["asfrom_froms"],
                "selectable": cs,
                "compile_state": compile_state,
                "need_result_map_for_compound": need_result_map,
            }
        )

        if compound_stmt._independent_ctes:
            self._dispatch_independent_ctes(compound_stmt, kwargs)

        keyword = self.compound_keywords[cs.keyword]

        text = (" " + keyword + " ").join(
            (
                c._compiler_dispatch(
                    self, asfrom=asfrom, compound_index=i, **kwargs
                )
                for i, c in enumerate(cs.selects)
            )
        )

        kwargs["include_table"] = False
        text += self.group_by_clause(cs, **dict(asfrom=asfrom, **kwargs))
        text += self.order_by_clause(cs, **kwargs)
        if cs._has_row_limiting_clause:
            text += self._row_limit_clause(cs, **kwargs)

        if self.ctes:
            nesting_level = len(self.stack) if not toplevel else None
            text = (
                self._render_cte_clause(
                    nesting_level=nesting_level,
                    include_following_stack=True,
                )
                + text
            )

        self.stack.pop(-1)
        return text

    def _row_limit_clause(self, cs, **kwargs):
        if cs._fetch_clause is not None:
            return self.fetch_clause(cs, **kwargs)
        else:
            return self.limit_clause(cs, **kwargs)

    def _get_operator_dispatch(self, operator_, qualifier1, qualifier2):
        attrname = "visit_%s_%s%s" % (
            operator_.__name__,
            qualifier1,
            "_" + qualifier2 if qualifier2 else "",
        )
        return getattr(self, attrname, None)

    def visit_unary(
        self, unary, add_to_result_map=None, result_map_targets=(), **kw
    ):
        if add_to_result_map is not None:
            result_map_targets += (unary,)
            kw["add_to_result_map"] = add_to_result_map
            kw["result_map_targets"] = result_map_targets

        if unary.operator:
            if unary.modifier:
                raise exc.CompileError(
                    "Unary expression does not support operator "
                    "and modifier simultaneously"
                )
            disp = self._get_operator_dispatch(
                unary.operator, "unary", "operator"
            )
            if disp:
                return disp(unary, unary.operator, **kw)
            else:
                return self._generate_generic_unary_operator(
                    unary, OPERATORS[unary.operator], **kw
                )
        elif unary.modifier:
            disp = self._get_operator_dispatch(
                unary.modifier, "unary", "modifier"
            )
            if disp:
                return disp(unary, unary.modifier, **kw)
            else:
                return self._generate_generic_unary_modifier(
                    unary, OPERATORS[unary.modifier], **kw
                )
        else:
            raise exc.CompileError(
                "Unary expression has no operator or modifier"
            )

    def visit_truediv_binary(self, binary, operator, **kw):
        if self.dialect.div_is_floordiv:
            return (
                self.process(binary.left, **kw)
                + " / "
                # TODO: would need a fast cast again here,
                # unless we want to use an implicit cast like "+ 0.0"
                + self.process(
                    elements.Cast(
                        binary.right,
                        binary.right.type
                        if binary.right.type._type_affinity is sqltypes.Numeric
                        else sqltypes.Numeric(),
                    ),
                    **kw,
                )
            )
        else:
            return (
                self.process(binary.left, **kw)
                + " / "
                + self.process(binary.right, **kw)
            )

    def visit_floordiv_binary(self, binary, operator, **kw):
        if (
            self.dialect.div_is_floordiv
            and binary.right.type._type_affinity is sqltypes.Integer
        ):
            return (
                self.process(binary.left, **kw)
                + " / "
                + self.process(binary.right, **kw)
            )
        else:
            return "FLOOR(%s)" % (
                self.process(binary.left, **kw)
                + " / "
                + self.process(binary.right, **kw)
            )

    def visit_is_true_unary_operator(self, element, operator, **kw):
        if (
            element._is_implicitly_boolean
            or self.dialect.supports_native_boolean
        ):
            return self.process(element.element, **kw)
        else:
            return "%s = 1" % self.process(element.element, **kw)

    def visit_is_false_unary_operator(self, element, operator, **kw):
        if (
            element._is_implicitly_boolean
            or self.dialect.supports_native_boolean
        ):
            return "NOT %s" % self.process(element.element, **kw)
        else:
            return "%s = 0" % self.process(element.element, **kw)

    def visit_not_match_op_binary(self, binary, operator, **kw):
        return "NOT %s" % self.visit_binary(
            binary, override_operator=operators.match_op
        )

    def visit_not_in_op_binary(self, binary, operator, **kw):
        # The brackets are required in the NOT IN operation because the empty
        # case is handled using the form "(col NOT IN (null) OR 1 = 1)".
        # The presence of the OR makes the brackets required.
        return "(%s)" % self._generate_generic_binary(
            binary, OPERATORS[operator], **kw
        )

    def visit_empty_set_op_expr(self, type_, expand_op, **kw):
        if expand_op is operators.not_in_op:
            if len(type_) > 1:
                return "(%s)) OR (1 = 1" % (
                    ", ".join("NULL" for element in type_)
                )
            else:
                return "NULL) OR (1 = 1"
        elif expand_op is operators.in_op:
            if len(type_) > 1:
                return "(%s)) AND (1 != 1" % (
                    ", ".join("NULL" for element in type_)
                )
            else:
                return "NULL) AND (1 != 1"
        else:
            return self.visit_empty_set_expr(type_)

    def visit_empty_set_expr(self, element_types, **kw):
        raise NotImplementedError(
            "Dialect '%s' does not support empty set expression."
            % self.dialect.name
        )

    def _literal_execute_expanding_parameter_literal_binds(
        self, parameter, values, bind_expression_template=None
    ):
        typ_dialect_impl = parameter.type._unwrapped_dialect_impl(self.dialect)

        if not values:
            # empty IN expression.  note we don't need to use
            # bind_expression_template here because there are no
            # expressions to render.

            if typ_dialect_impl._is_tuple_type:
                replacement_expression = (
                    "VALUES " if self.dialect.tuple_in_values else ""
                ) + self.visit_empty_set_op_expr(
                    parameter.type.types, parameter.expand_op
                )

            else:
                replacement_expression = self.visit_empty_set_op_expr(
                    [parameter.type], parameter.expand_op
                )

        elif typ_dialect_impl._is_tuple_type or (
            typ_dialect_impl._isnull
            and isinstance(values[0], collections_abc.Sequence)
            and not isinstance(values[0], (str, bytes))
        ):
            if typ_dialect_impl._has_bind_expression:
                raise NotImplementedError(
                    "bind_expression() on TupleType not supported with "
                    "literal_binds"
                )

            replacement_expression = (
                "VALUES " if self.dialect.tuple_in_values else ""
            ) + ", ".join(
                "(%s)"
                % (
                    ", ".join(
                        self.render_literal_value(value, param_type)
                        for value, param_type in zip(
                            tuple_element, parameter.type.types
                        )
                    )
                )
                for i, tuple_element in enumerate(values)
            )
        else:
            if bind_expression_template:
                post_compile_pattern = self._post_compile_pattern
                m = post_compile_pattern.search(bind_expression_template)
                assert m and m.group(
                    2
                ), "unexpected format for expanding parameter"

                tok = m.group(2).split("~~")
                be_left, be_right = tok[1], tok[3]
                replacement_expression = ", ".join(
                    "%s%s%s"
                    % (
                        be_left,
                        self.render_literal_value(value, parameter.type),
                        be_right,
                    )
                    for value in values
                )
            else:
                replacement_expression = ", ".join(
                    self.render_literal_value(value, parameter.type)
                    for value in values
                )

        return (), replacement_expression

    def _literal_execute_expanding_parameter(self, name, parameter, values):
        if parameter.literal_execute:
            return self._literal_execute_expanding_parameter_literal_binds(
                parameter, values
            )

        dialect = self.dialect
        typ_dialect_impl = parameter.type._unwrapped_dialect_impl(dialect)

        if self._numeric_binds:
            bind_template = self.compilation_bindtemplate
        else:
            bind_template = self.bindtemplate

        if (
            self.dialect._bind_typing_render_casts
            and typ_dialect_impl.render_bind_cast
        ):

            def _render_bindtemplate(name):
                return self.render_bind_cast(
                    parameter.type,
                    typ_dialect_impl,
                    bind_template % {"name": name},
                )

        else:

            def _render_bindtemplate(name):
                return bind_template % {"name": name}

        if not values:
            to_update = []
            if typ_dialect_impl._is_tuple_type:
                replacement_expression = self.visit_empty_set_op_expr(
                    parameter.type.types, parameter.expand_op
                )
            else:
                replacement_expression = self.visit_empty_set_op_expr(
                    [parameter.type], parameter.expand_op
                )

        elif typ_dialect_impl._is_tuple_type or (
            typ_dialect_impl._isnull
            and isinstance(values[0], collections_abc.Sequence)
            and not isinstance(values[0], (str, bytes))
        ):
            assert not typ_dialect_impl._is_array
            to_update = [
                ("%s_%s_%s" % (name, i, j), value)
                for i, tuple_element in enumerate(values, 1)
                for j, value in enumerate(tuple_element, 1)
            ]

            replacement_expression = (
                "VALUES " if dialect.tuple_in_values else ""
            ) + ", ".join(
                "(%s)"
                % (
                    ", ".join(
                        _render_bindtemplate(
                            to_update[i * len(tuple_element) + j][0]
                        )
                        for j, value in enumerate(tuple_element)
                    )
                )
                for i, tuple_element in enumerate(values)
            )
        else:
            to_update = [
                ("%s_%s" % (name, i), value)
                for i, value in enumerate(values, 1)
            ]
            replacement_expression = ", ".join(
                _render_bindtemplate(key) for key, value in to_update
            )

        return to_update, replacement_expression

    def visit_binary(
        self,
        binary,
        override_operator=None,
        eager_grouping=False,
        from_linter=None,
        lateral_from_linter=None,
        **kw,
    ):
        if from_linter and operators.is_comparison(binary.operator):
            if lateral_from_linter is not None:
                enclosing_lateral = kw["enclosing_lateral"]
                lateral_from_linter.edges.update(
                    itertools.product(
                        _de_clone(
                            binary.left._from_objects + [enclosing_lateral]
                        ),
                        _de_clone(
                            binary.right._from_objects + [enclosing_lateral]
                        ),
                    )
                )
            else:
                from_linter.edges.update(
                    itertools.product(
                        _de_clone(binary.left._from_objects),
                        _de_clone(binary.right._from_objects),
                    )
                )

        # don't allow "? = ?" to render
        if (
            self.ansi_bind_rules
            and isinstance(binary.left, elements.BindParameter)
            and isinstance(binary.right, elements.BindParameter)
        ):
            kw["literal_execute"] = True

        operator_ = override_operator or binary.operator
        disp = self._get_operator_dispatch(operator_, "binary", None)
        if disp:
            return disp(binary, operator_, **kw)
        else:
            try:
                opstring = OPERATORS[operator_]
            except KeyError as err:
                raise exc.UnsupportedCompilationError(self, operator_) from err
            else:
                return self._generate_generic_binary(
                    binary,
                    opstring,
                    from_linter=from_linter,
                    lateral_from_linter=lateral_from_linter,
                    **kw,
                )

    def visit_function_as_comparison_op_binary(self, element, operator, **kw):
        return self.process(element.sql_function, **kw)

    def visit_mod_binary(self, binary, operator, **kw):
        if self.preparer._double_percents:
            return (
                self.process(binary.left, **kw)
                + " %% "
                + self.process(binary.right, **kw)
            )
        else:
            return (
                self.process(binary.left, **kw)
                + " % "
                + self.process(binary.right, **kw)
            )

    def visit_custom_op_binary(self, element, operator, **kw):
        kw["eager_grouping"] = operator.eager_grouping
        return self._generate_generic_binary(
            element,
            " " + self.escape_literal_column(operator.opstring) + " ",
            **kw,
        )

    def visit_custom_op_unary_operator(self, element, operator, **kw):
        return self._generate_generic_unary_operator(
            element, self.escape_literal_column(operator.opstring) + " ", **kw
        )

    def visit_custom_op_unary_modifier(self, element, operator, **kw):
        return self._generate_generic_unary_modifier(
            element, " " + self.escape_literal_column(operator.opstring), **kw
        )

    def _generate_generic_binary(
        self, binary, opstring, eager_grouping=False, **kw
    ):
        _in_operator_expression = kw.get("_in_operator_expression", False)

        kw["_in_operator_expression"] = True
        kw["_binary_op"] = binary.operator
        text = (
            binary.left._compiler_dispatch(
                self, eager_grouping=eager_grouping, **kw
            )
            + opstring
            + binary.right._compiler_dispatch(
                self, eager_grouping=eager_grouping, **kw
            )
        )

        if _in_operator_expression and eager_grouping:
            text = "(%s)" % text
        return text

    def _generate_generic_unary_operator(self, unary, opstring, **kw):
        return opstring + unary.element._compiler_dispatch(self, **kw)

    def _generate_generic_unary_modifier(self, unary, opstring, **kw):
        return unary.element._compiler_dispatch(self, **kw) + opstring

    @util.memoized_property
    def _like_percent_literal(self):
        return elements.literal_column("'%'", type_=sqltypes.STRINGTYPE)

    def visit_ilike_case_insensitive_operand(self, element, **kw):
        return f"lower({element.element._compiler_dispatch(self, **kw)})"

    def visit_contains_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.right = percent.concat(binary.right).concat(percent)
        return self.visit_like_op_binary(binary, operator, **kw)

    def visit_not_contains_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.right = percent.concat(binary.right).concat(percent)
        return self.visit_not_like_op_binary(binary, operator, **kw)

    def visit_icontains_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.left = ilike_case_insensitive(binary.left)
        binary.right = percent.concat(
            ilike_case_insensitive(binary.right)
        ).concat(percent)
        return self.visit_ilike_op_binary(binary, operator, **kw)

    def visit_not_icontains_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.left = ilike_case_insensitive(binary.left)
        binary.right = percent.concat(
            ilike_case_insensitive(binary.right)
        ).concat(percent)
        return self.visit_not_ilike_op_binary(binary, operator, **kw)

    def visit_startswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.right = percent._rconcat(binary.right)
        return self.visit_like_op_binary(binary, operator, **kw)

    def visit_not_startswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.right = percent._rconcat(binary.right)
        return self.visit_not_like_op_binary(binary, operator, **kw)

    def visit_istartswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.left = ilike_case_insensitive(binary.left)
        binary.right = percent._rconcat(ilike_case_insensitive(binary.right))
        return self.visit_ilike_op_binary(binary, operator, **kw)

    def visit_not_istartswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.left = ilike_case_insensitive(binary.left)
        binary.right = percent._rconcat(ilike_case_insensitive(binary.right))
        return self.visit_not_ilike_op_binary(binary, operator, **kw)

    def visit_endswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.right = percent.concat(binary.right)
        return self.visit_like_op_binary(binary, operator, **kw)

    def visit_not_endswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.right = percent.concat(binary.right)
        return self.visit_not_like_op_binary(binary, operator, **kw)

    def visit_iendswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.left = ilike_case_insensitive(binary.left)
        binary.right = percent.concat(ilike_case_insensitive(binary.right))
        return self.visit_ilike_op_binary(binary, operator, **kw)

    def visit_not_iendswith_op_binary(self, binary, operator, **kw):
        binary = binary._clone()
        percent = self._like_percent_literal
        binary.left = ilike_case_insensitive(binary.left)
        binary.right = percent.concat(ilike_case_insensitive(binary.right))
        return self.visit_not_ilike_op_binary(binary, operator, **kw)

    def visit_like_op_binary(self, binary, operator, **kw):
        escape = binary.modifiers.get("escape", None)

        return "%s LIKE %s" % (
            binary.left._compiler_dispatch(self, **kw),
            binary.right._compiler_dispatch(self, **kw),
        ) + (
            " ESCAPE " + self.render_literal_value(escape, sqltypes.STRINGTYPE)
            if escape is not None
            else ""
        )

    def visit_not_like_op_binary(self, binary, operator, **kw):
        escape = binary.modifiers.get("escape", None)
        return "%s NOT LIKE %s" % (
            binary.left._compiler_dispatch(self, **kw),
            binary.right._compiler_dispatch(self, **kw),
        ) + (
            " ESCAPE " + self.render_literal_value(escape, sqltypes.STRINGTYPE)
            if escape is not None
            else ""
        )

    def visit_ilike_op_binary(self, binary, operator, **kw):
        if operator is operators.ilike_op:
            binary = binary._clone()
            binary.left = ilike_case_insensitive(binary.left)
            binary.right = ilike_case_insensitive(binary.right)
        # else we assume ilower() has been applied

        return self.visit_like_op_binary(binary, operator, **kw)

    def visit_not_ilike_op_binary(self, binary, operator, **kw):
        if operator is operators.not_ilike_op:
            binary = binary._clone()
            binary.left = ilike_case_insensitive(binary.left)
            binary.right = ilike_case_insensitive(binary.right)
        # else we assume ilower() has been applied

        return self.visit_not_like_op_binary(binary, operator, **kw)

    def visit_between_op_binary(self, binary, operator, **kw):
        symmetric = binary.modifiers.get("symmetric", False)
        return self._generate_generic_binary(
            binary, " BETWEEN SYMMETRIC " if symmetric else " BETWEEN ", **kw
        )

    def visit_not_between_op_binary(self, binary, operator, **kw):
        symmetric = binary.modifiers.get("symmetric", False)
        return self._generate_generic_binary(
            binary,
            " NOT BETWEEN SYMMETRIC " if symmetric else " NOT BETWEEN ",
            **kw,
        )

    def visit_regexp_match_op_binary(self, binary, operator, **kw):
        raise exc.CompileError(
            "%s dialect does not support regular expressions"
            % self.dialect.name
        )

    def visit_not_regexp_match_op_binary(self, binary, operator, **kw):
        raise exc.CompileError(
            "%s dialect does not support regular expressions"
            % self.dialect.name
        )

    def visit_regexp_replace_op_binary(self, binary, operator, **kw):
        raise exc.CompileError(
            "%s dialect does not support regular expression replacements"
            % self.dialect.name
        )

    def visit_bindparam(
        self,
        bindparam,
        within_columns_clause=False,
        literal_binds=False,
        skip_bind_expression=False,
        literal_execute=False,
        render_postcompile=False,
        **kwargs,
    ):
        if not skip_bind_expression:
            impl = bindparam.type.dialect_impl(self.dialect)
            if impl._has_bind_expression:
                bind_expression = impl.bind_expression(bindparam)
                wrapped = self.process(
                    bind_expression,
                    skip_bind_expression=True,
                    within_columns_clause=within_columns_clause,
                    literal_binds=literal_binds and not bindparam.expanding,
                    literal_execute=literal_execute,
                    render_postcompile=render_postcompile,
                    **kwargs,
                )
                if bindparam.expanding:
                    # for postcompile w/ expanding, move the "wrapped" part
                    # of this into the inside

                    m = re.match(
                        r"^(.*)\(__\[POSTCOMPILE_(\S+?)\]\)(.*)$", wrapped
                    )
                    assert m, "unexpected format for expanding parameter"
                    wrapped = "(__[POSTCOMPILE_%s~~%s~~REPL~~%s~~])" % (
                        m.group(2),
                        m.group(1),
                        m.group(3),
                    )

                    if literal_binds:
                        ret = self.render_literal_bindparam(
                            bindparam,
                            within_columns_clause=True,
                            bind_expression_template=wrapped,
                            **kwargs,
                        )
                        return "(%s)" % ret

                return wrapped

        if not literal_binds:
            literal_execute = (
                literal_execute
                or bindparam.literal_execute
                or (within_columns_clause and self.ansi_bind_rules)
            )
            post_compile = literal_execute or bindparam.expanding
        else:
            post_compile = False

        if literal_binds:
            ret = self.render_literal_bindparam(
                bindparam, within_columns_clause=True, **kwargs
            )
            if bindparam.expanding:
                ret = "(%s)" % ret
            return ret

        name = self._truncate_bindparam(bindparam)

        if name in self.binds:
            existing = self.binds[name]
            if existing is not bindparam:
                if (
                    (existing.unique or bindparam.unique)
                    and not existing.proxy_set.intersection(
                        bindparam.proxy_set
                    )
                    and not existing._cloned_set.intersection(
                        bindparam._cloned_set
                    )
                ):
                    raise exc.CompileError(
                        "Bind parameter '%s' conflicts with "
                        "unique bind parameter of the same name" % name
                    )
                elif existing.expanding != bindparam.expanding:
                    raise exc.CompileError(
                        "Can't reuse bound parameter name '%s' in both "
                        "'expanding' (e.g. within an IN expression) and "
                        "non-expanding contexts.  If this parameter is to "
                        "receive a list/array value, set 'expanding=True' on "
                        "it for expressions that aren't IN, otherwise use "
                        "a different parameter name." % (name,)
                    )
                elif existing._is_crud or bindparam._is_crud:
                    if existing._is_crud and bindparam._is_crud:
                        # TODO: this condition is not well understood.
                        # see tests in test/sql/test_update.py
                        raise exc.CompileError(
                            "Encountered unsupported case when compiling an "
                            "INSERT or UPDATE statement.  If this is a "
                            "multi-table "
                            "UPDATE statement, please provide string-named "
                            "arguments to the "
                            "values() method with distinct names; support for "
                            "multi-table UPDATE statements that "
                            "target multiple tables for UPDATE is very "
                            "limited",
                        )
                    else:
                        raise exc.CompileError(
                            f"bindparam() name '{bindparam.key}' is reserved "
                            "for automatic usage in the VALUES or SET "
                            "clause of this "
                            "insert/update statement.   Please use a "
                            "name other than column name when using "
                            "bindparam() "
                            "with insert() or update() (for example, "
                            f"'b_{bindparam.key}')."
                        )

        self.binds[bindparam.key] = self.binds[name] = bindparam

        # if we are given a cache key that we're going to match against,
        # relate the bindparam here to one that is most likely present
        # in the "extracted params" portion of the cache key.  this is used
        # to set up a positional mapping that is used to determine the
        # correct parameters for a subsequent use of this compiled with
        # a different set of parameter values.   here, we accommodate for
        # parameters that may have been cloned both before and after the cache
        # key was been generated.
        ckbm_tuple = self._cache_key_bind_match

        if ckbm_tuple:
            ckbm, cksm = ckbm_tuple
            for bp in bindparam._cloned_set:
                if bp.key in cksm:
                    cb = cksm[bp.key]
                    ckbm[cb].append(bindparam)

        if bindparam.isoutparam:
            self.has_out_parameters = True

        if post_compile:
            if render_postcompile:
                self._render_postcompile = True

            if literal_execute:
                self.literal_execute_params |= {bindparam}
            else:
                self.post_compile_params |= {bindparam}

        ret = self.bindparam_string(
            name,
            post_compile=post_compile,
            expanding=bindparam.expanding,
            bindparam_type=bindparam.type,
            **kwargs,
        )

        if bindparam.expanding:
            ret = "(%s)" % ret

        return ret

    def render_bind_cast(self, type_, dbapi_type, sqltext):
        raise NotImplementedError()

    def render_literal_bindparam(
        self,
        bindparam,
        render_literal_value=NO_ARG,
        bind_expression_template=None,
        **kw,
    ):
        if render_literal_value is not NO_ARG:
            value = render_literal_value
        else:
            if bindparam.value is None and bindparam.callable is None:
                op = kw.get("_binary_op", None)
                if op and op not in (operators.is_, operators.is_not):
                    util.warn_limited(
                        "Bound parameter '%s' rendering literal NULL in a SQL "
                        "expression; comparisons to NULL should not use "
                        "operators outside of 'is' or 'is not'",
                        (bindparam.key,),
                    )
                return self.process(sqltypes.NULLTYPE, **kw)
            value = bindparam.effective_value

        if bindparam.expanding:
            leep = self._literal_execute_expanding_parameter_literal_binds
            to_update, replacement_expr = leep(
                bindparam,
                value,
                bind_expression_template=bind_expression_template,
            )
            return replacement_expr
        else:
            return self.render_literal_value(value, bindparam.type)

    def render_literal_value(self, value, type_):
        """Render the value of a bind parameter as a quoted literal.

        This is used for statement sections that do not accept bind parameters
        on the target driver/database.

        This should be implemented by subclasses using the quoting services
        of the DBAPI.

        """

        if value is None and not type_.should_evaluate_none:
            # issue #10535 - handle NULL in the compiler without placing
            # this onto each type, except for "evaluate None" types
            # (e.g. JSON)
            return self.process(elements.Null._instance())

        processor = type_._cached_literal_processor(self.dialect)
        if processor:
            try:
                return processor(value)
            except Exception as e:
                raise exc.CompileError(
                    f"Could not render literal value "
                    f'"{sql_util._repr_single_value(value)}" '
                    f"with datatype "
                    f"{type_}; see parent stack trace for "
                    "more detail."
                ) from e

        else:
            raise exc.CompileError(
                f"No literal value renderer is available for literal value "
                f'"{sql_util._repr_single_value(value)}" '
                f"with datatype {type_}"
            )

    def _truncate_bindparam(self, bindparam):
        if bindparam in self.bind_names:
            return self.bind_names[bindparam]

        bind_name = bindparam.key
        if isinstance(bind_name, elements._truncated_label):
            bind_name = self._truncated_identifier("bindparam", bind_name)

        # add to bind_names for translation
        self.bind_names[bindparam] = bind_name

        return bind_name

    def _truncated_identifier(
        self, ident_class: str, name: _truncated_label
    ) -> str:
        if (ident_class, name) in self.truncated_names:
            return self.truncated_names[(ident_class, name)]

        anonname = name.apply_map(self.anon_map)

        if len(anonname) > self.label_length - 6:
            counter = self._truncated_counters.get(ident_class, 1)
            truncname = (
                anonname[0 : max(self.label_length - 6, 0)]
                + "_"
                + hex(counter)[2:]
            )
            self._truncated_counters[ident_class] = counter + 1
        else:
            truncname = anonname
        self.truncated_names[(ident_class, name)] = truncname
        return truncname

    def _anonymize(self, name: str) -> str:
        return name % self.anon_map

    def bindparam_string(
        self,
        name: str,
        post_compile: bool = False,
        expanding: bool = False,
        escaped_from: Optional[str] = None,
        bindparam_type: Optional[TypeEngine[Any]] = None,
        accumulate_bind_names: Optional[Set[str]] = None,
        visited_bindparam: Optional[List[str]] = None,
        **kw: Any,
    ) -> str:
        # TODO: accumulate_bind_names is passed by crud.py to gather
        # names on a per-value basis, visited_bindparam is passed by
        # visit_insert() to collect all parameters in the statement.
        # see if this gathering can be simplified somehow
        if accumulate_bind_names is not None:
            accumulate_bind_names.add(name)
        if visited_bindparam is not None:
            visited_bindparam.append(name)

        if not escaped_from:
            if self._bind_translate_re.search(name):
                # not quite the translate use case as we want to
                # also get a quick boolean if we even found
                # unusual characters in the name
                new_name = self._bind_translate_re.sub(
                    lambda m: self._bind_translate_chars[m.group(0)],
                    name,
                )
                escaped_from = name
                name = new_name

        if escaped_from:
            self.escaped_bind_names = self.escaped_bind_names.union(
                {escaped_from: name}
            )
        if post_compile:
            ret = "__[POSTCOMPILE_%s]" % name
            if expanding:
                # for expanding, bound parameters or literal values will be
                # rendered per item
                return ret

            # otherwise, for non-expanding "literal execute", apply
            # bind casts as determined by the datatype
            if bindparam_type is not None:
                type_impl = bindparam_type._unwrapped_dialect_impl(
                    self.dialect
                )
                if type_impl.render_literal_cast:
                    ret = self.render_bind_cast(bindparam_type, type_impl, ret)
            return ret
        elif self.state is CompilerState.COMPILING:
            ret = self.compilation_bindtemplate % {"name": name}
        else:
            ret = self.bindtemplate % {"name": name}

        if (
            bindparam_type is not None
            and self.dialect._bind_typing_render_casts
        ):
            type_impl = bindparam_type._unwrapped_dialect_impl(self.dialect)
            if type_impl.render_bind_cast:
                ret = self.render_bind_cast(bindparam_type, type_impl, ret)

        return ret

    def _dispatch_independent_ctes(self, stmt, kw):
        local_kw = kw.copy()
        local_kw.pop("cte_opts", None)
        for cte, opt in zip(
            stmt._independent_ctes, stmt._independent_ctes_opts
        ):
            cte._compiler_dispatch(self, cte_opts=opt, **local_kw)

    def visit_cte(
        self,
        cte: CTE,
        asfrom: bool = False,
        ashint: bool = False,
        fromhints: Optional[_FromHintsType] = None,
        visiting_cte: Optional[CTE] = None,
        from_linter: Optional[FromLinter] = None,
        cte_opts: selectable._CTEOpts = selectable._CTEOpts(False),
        **kwargs: Any,
    ) -> Optional[str]:
        self_ctes = self._init_cte_state()
        assert self_ctes is self.ctes

        kwargs["visiting_cte"] = cte

        cte_name = cte.name

        if isinstance(cte_name, elements._truncated_label):
            cte_name = self._truncated_identifier("alias", cte_name)

        is_new_cte = True
        embedded_in_current_named_cte = False

        _reference_cte = cte._get_reference_cte()

        nesting = cte.nesting or cte_opts.nesting

        # check for CTE already encountered
        if _reference_cte in self.level_name_by_cte:
            cte_level, _, existing_cte_opts = self.level_name_by_cte[
                _reference_cte
            ]
            assert _ == cte_name

            cte_level_name = (cte_level, cte_name)
            existing_cte = self.ctes_by_level_name[cte_level_name]

            # check if we are receiving it here with a specific
            # "nest_here" location; if so, move it to this location

            if cte_opts.nesting:
                if existing_cte_opts.nesting:
                    raise exc.CompileError(
                        "CTE is stated as 'nest_here' in "
                        "more than one location"
                    )

                old_level_name = (cte_level, cte_name)
                cte_level = len(self.stack) if nesting else 1
                cte_level_name = new_level_name = (cte_level, cte_name)

                del self.ctes_by_level_name[old_level_name]
                self.ctes_by_level_name[new_level_name] = existing_cte
                self.level_name_by_cte[_reference_cte] = new_level_name + (
                    cte_opts,
                )

        else:
            cte_level = len(self.stack) if nesting else 1
            cte_level_name = (cte_level, cte_name)

            if cte_level_name in self.ctes_by_level_name:
                existing_cte = self.ctes_by_level_name[cte_level_name]
            else:
                existing_cte = None

        if existing_cte is not None:
            embedded_in_current_named_cte = visiting_cte is existing_cte

            # we've generated a same-named CTE that we are enclosed in,
            # or this is the same CTE.  just return the name.
            if cte is existing_cte._restates or cte is existing_cte:
                is_new_cte = False
            elif existing_cte is cte._restates:
                # we've generated a same-named CTE that is
                # enclosed in us - we take precedence, so
                # discard the text for the "inner".
                del self_ctes[existing_cte]

                existing_cte_reference_cte = existing_cte._get_reference_cte()

                assert existing_cte_reference_cte is _reference_cte
                assert existing_cte_reference_cte is existing_cte

                del self.level_name_by_cte[existing_cte_reference_cte]
            else:
                # if the two CTEs are deep-copy identical, consider them
                # the same, **if** they are clones, that is, they came from
                # the ORM or other visit method
                if (
                    cte._is_clone_of is not None
                    or existing_cte._is_clone_of is not None
                ) and cte.compare(existing_cte):
                    is_new_cte = False
                else:
                    raise exc.CompileError(
                        "Multiple, unrelated CTEs found with "
                        "the same name: %r" % cte_name
                    )

        if not asfrom and not is_new_cte:
            return None

        if cte._cte_alias is not None:
            pre_alias_cte = cte._cte_alias
            cte_pre_alias_name = cte._cte_alias.name
            if isinstance(cte_pre_alias_name, elements._truncated_label):
                cte_pre_alias_name = self._truncated_identifier(
                    "alias", cte_pre_alias_name
                )
        else:
            pre_alias_cte = cte
            cte_pre_alias_name = None

        if is_new_cte:
            self.ctes_by_level_name[cte_level_name] = cte
            self.level_name_by_cte[_reference_cte] = cte_level_name + (
                cte_opts,
            )

            if pre_alias_cte not in self.ctes:
                self.visit_cte(pre_alias_cte, **kwargs)

            if not cte_pre_alias_name and cte not in self_ctes:
                if cte.recursive:
                    self.ctes_recursive = True
                text = self.preparer.format_alias(cte, cte_name)
                if cte.recursive:
                    col_source = cte.element

                    # TODO: can we get at the .columns_plus_names collection
                    # that is already (or will be?) generated for the SELECT
                    # rather than calling twice?
                    recur_cols = [
                        # TODO: proxy_name is not technically safe,
                        # see test_cte->
                        # test_with_recursive_no_name_currently_buggy.  not
                        # clear what should be done with such a case
                        fallback_label_name or proxy_name
                        for (
                            _,
                            proxy_name,
                            fallback_label_name,
                            c,
                            repeated,
                        ) in (col_source._generate_columns_plus_names(True))
                        if not repeated
                    ]

                    text += "(%s)" % (
                        ", ".join(
                            self.preparer.format_label_name(
                                ident, anon_map=self.anon_map
                            )
                            for ident in recur_cols
                        )
                    )

                assert kwargs.get("subquery", False) is False

                if not self.stack:
                    # toplevel, this is a stringify of the
                    # cte directly.  just compile the inner
                    # the way alias() does.
                    return cte.element._compiler_dispatch(
                        self, asfrom=asfrom, **kwargs
                    )
                else:
                    prefixes = self._generate_prefixes(
                        cte, cte._prefixes, **kwargs
                    )
                    inner = cte.element._compiler_dispatch(
                        self, asfrom=True, **kwargs
                    )

                    text += " AS %s\n(%s)" % (prefixes, inner)

                if cte._suffixes:
                    text += " " + self._generate_prefixes(
                        cte, cte._suffixes, **kwargs
                    )

                self_ctes[cte] = text

        if asfrom:
            if from_linter:
                from_linter.froms[cte._de_clone()] = cte_name

            if not is_new_cte and embedded_in_current_named_cte:
                return self.preparer.format_alias(cte, cte_name)

            if cte_pre_alias_name:
                text = self.preparer.format_alias(cte, cte_pre_alias_name)
                if self.preparer._requires_quotes(cte_name):
                    cte_name = self.preparer.quote(cte_name)
                text += self.get_render_as_alias_suffix(cte_name)
                return text
            else:
                return self.preparer.format_alias(cte, cte_name)

        return None

    def visit_table_valued_alias(self, element, **kw):
        if element.joins_implicitly:
            kw["from_linter"] = None
        if element._is_lateral:
            return self.visit_lateral(element, **kw)
        else:
            return self.visit_alias(element, **kw)

    def visit_table_valued_column(self, element, **kw):
        return self.visit_column(element, **kw)

    def visit_alias(
        self,
        alias,
        asfrom=False,
        ashint=False,
        iscrud=False,
        fromhints=None,
        subquery=False,
        lateral=False,
        enclosing_alias=None,
        from_linter=None,
        **kwargs,
    ):
        if lateral:
            if "enclosing_lateral" not in kwargs:
                # if lateral is set and enclosing_lateral is not
                # present, we assume we are being called directly
                # from visit_lateral() and we need to set enclosing_lateral.
                assert alias._is_lateral
                kwargs["enclosing_lateral"] = alias

            # for lateral objects, we track a second from_linter that is...
            # lateral!  to the level above us.
            if (
                from_linter
                and "lateral_from_linter" not in kwargs
                and "enclosing_lateral" in kwargs
            ):
                kwargs["lateral_from_linter"] = from_linter

        if enclosing_alias is not None and enclosing_alias.element is alias:
            inner = alias.element._compiler_dispatch(
                self,
                asfrom=asfrom,
                ashint=ashint,
                iscrud=iscrud,
                fromhints=fromhints,
                lateral=lateral,
                enclosing_alias=alias,
                **kwargs,
            )
            if subquery and (asfrom or lateral):
                inner = "(%s)" % (inner,)
            return inner
        else:
            enclosing_alias = kwargs["enclosing_alias"] = alias

        if asfrom or ashint:
            if isinstance(alias.name, elements._truncated_label):
                alias_name = self._truncated_identifier("alias", alias.name)
            else:
                alias_name = alias.name

        if ashint:
            return self.preparer.format_alias(alias, alias_name)
        elif asfrom:
            if from_linter:
                from_linter.froms[alias._de_clone()] = alias_name

            inner = alias.element._compiler_dispatch(
                self, asfrom=True, lateral=lateral, **kwargs
            )
            if subquery:
                inner = "(%s)" % (inner,)

            ret = inner + self.get_render_as_alias_suffix(
                self.preparer.format_alias(alias, alias_name)
            )

            if alias._supports_derived_columns and alias._render_derived:
                ret += "(%s)" % (
                    ", ".join(
                        "%s%s"
                        % (
                            self.preparer.quote(col.name),
                            " %s"
                            % self.dialect.type_compiler_instance.process(
                                col.type, **kwargs
                            )
                            if alias._render_derived_w_types
                            else "",
                        )
                        for col in alias.c
                    )
                )

            if fromhints and alias in fromhints:
                ret = self.format_from_hint_text(
                    ret, alias, fromhints[alias], iscrud
                )

            return ret
        else:
            # note we cancel the "subquery" flag here as well
            return alias.element._compiler_dispatch(
                self, lateral=lateral, **kwargs
            )

    def visit_subquery(self, subquery, **kw):
        kw["subquery"] = True
        return self.visit_alias(subquery, **kw)

    def visit_lateral(self, lateral_, **kw):
        kw["lateral"] = True
        return "LATERAL %s" % self.visit_alias(lateral_, **kw)

    def visit_tablesample(self, tablesample, asfrom=False, **kw):
        text = "%s TABLESAMPLE %s" % (
            self.visit_alias(tablesample, asfrom=True, **kw),
            tablesample._get_method()._compiler_dispatch(self, **kw),
        )

        if tablesample.seed is not None:
            text += " REPEATABLE (%s)" % (
                tablesample.seed._compiler_dispatch(self, **kw)
            )

        return text

    def _render_values(self, element, **kw):
        kw.setdefault("literal_binds", element.literal_binds)
        tuples = ", ".join(
            self.process(
                elements.Tuple(
                    types=element._column_types, *elem
                ).self_group(),
                **kw,
            )
            for chunk in element._data
            for elem in chunk
        )
        return f"VALUES {tuples}"

    def visit_values(self, element, asfrom=False, from_linter=None, **kw):
        v = self._render_values(element, **kw)

        if element._unnamed:
            name = None
        elif isinstance(element.name, elements._truncated_label):
            name = self._truncated_identifier("values", element.name)
        else:
            name = element.name

        if element._is_lateral:
            lateral = "LATERAL "
        else:
            lateral = ""

        if asfrom:
            if from_linter:
                from_linter.froms[element._de_clone()] = (
                    name if name is not None else "(unnamed VALUES element)"
                )

            if name:
                kw["include_table"] = False
                v = "%s(%s)%s (%s)" % (
                    lateral,
                    v,
                    self.get_render_as_alias_suffix(self.preparer.quote(name)),
                    (
                        ", ".join(
                            c._compiler_dispatch(self, **kw)
                            for c in element.columns
                        )
                    ),
                )
            else:
                v = "%s(%s)" % (lateral, v)
        return v

    def visit_scalar_values(self, element, **kw):
        return f"({self._render_values(element, **kw)})"

    def get_render_as_alias_suffix(self, alias_name_text):
        return " AS " + alias_name_text

    def _add_to_result_map(
        self,
        keyname: str,
        name: str,
        objects: Tuple[Any, ...],
        type_: TypeEngine[Any],
    ) -> None:
        if keyname is None or keyname == "*":
            self._ordered_columns = False
            self._ad_hoc_textual = True
        if type_._is_tuple_type:
            raise exc.CompileError(
                "Most backends don't support SELECTing "
                "from a tuple() object.  If this is an ORM query, "
                "consider using the Bundle object."
            )
        self._result_columns.append(
            ResultColumnsEntry(keyname, name, objects, type_)
        )

    def _label_returning_column(
        self, stmt, column, populate_result_map, column_clause_args=None, **kw
    ):
        """Render a column with necessary labels inside of a RETURNING clause.

        This method is provided for individual dialects in place of calling
        the _label_select_column method directly, so that the two use cases
        of RETURNING vs. SELECT can be disambiguated going forward.

        .. versionadded:: 1.4.21

        """
        return self._label_select_column(
            None,
            column,
            populate_result_map,
            False,
            {} if column_clause_args is None else column_clause_args,
            **kw,
        )

    def _label_select_column(
        self,
        select,
        column,
        populate_result_map,
        asfrom,
        column_clause_args,
        name=None,
        proxy_name=None,
        fallback_label_name=None,
        within_columns_clause=True,
        column_is_repeated=False,
        need_column_expressions=False,
        include_table=True,
    ):
        """produce labeled columns present in a select()."""
        impl = column.type.dialect_impl(self.dialect)

        if impl._has_column_expression and (
            need_column_expressions or populate_result_map
        ):
            col_expr = impl.column_expression(column)
        else:
            col_expr = column

        if populate_result_map:
            # pass an "add_to_result_map" callable into the compilation
            # of embedded columns.  this collects information about the
            # column as it will be fetched in the result and is coordinated
            # with cursor.description when the query is executed.
            add_to_result_map = self._add_to_result_map

            # if the SELECT statement told us this column is a repeat,
            # wrap the callable with one that prevents the addition of the
            # targets
            if column_is_repeated:
                _add_to_result_map = add_to_result_map

                def add_to_result_map(keyname, name, objects, type_):
                    _add_to_result_map(keyname, name, (), type_)

            # if we redefined col_expr for type expressions, wrap the
            # callable with one that adds the original column to the targets
            elif col_expr is not column:
                _add_to_result_map = add_to_result_map

                def add_to_result_map(keyname, name, objects, type_):
                    _add_to_result_map(
                        keyname, name, (column,) + objects, type_
                    )

        else:
            add_to_result_map = None

        # this method is used by some of the dialects for RETURNING,
        # which has different inputs.  _label_returning_column was added
        # as the better target for this now however for 1.4 we will keep
        # _label_select_column directly compatible with this use case.
        # these assertions right now set up the current expected inputs
        assert within_columns_clause, (
            "_label_select_column is only relevant within "
            "the columns clause of a SELECT or RETURNING"
        )
        if isinstance(column, elements.Label):
            if col_expr is not column:
                result_expr = _CompileLabel(
                    col_expr, column.name, alt_names=(column.element,)
                )
            else:
                result_expr = col_expr

        elif name:
            # here, _columns_plus_names has determined there's an explicit
            # label name we need to use.  this is the default for
            # tablenames_plus_columnnames as well as when columns are being
            # deduplicated on name

            assert (
                proxy_name is not None
            ), "proxy_name is required if 'name' is passed"

            result_expr = _CompileLabel(
                col_expr,
                name,
                alt_names=(
                    proxy_name,
                    # this is a hack to allow legacy result column lookups
                    # to work as they did before; this goes away in 2.0.
                    # TODO: this only seems to be tested indirectly
                    # via test/orm/test_deprecations.py.   should be a
                    # resultset test for this
                    column._tq_label,
                ),
            )
        else:
            # determine here whether this column should be rendered in
            # a labelled context or not, as we were given no required label
            # name from the caller. Here we apply heuristics based on the kind
            # of SQL expression involved.

            if col_expr is not column:
                # type-specific expression wrapping the given column,
                # so we render a label
                render_with_label = True
            elif isinstance(column, elements.ColumnClause):
                # table-bound column, we render its name as a label if we are
                # inside of a subquery only
                render_with_label = (
                    asfrom
                    and not column.is_literal
                    and column.table is not None
                )
            elif isinstance(column, elements.TextClause):
                render_with_label = False
            elif isinstance(column, elements.UnaryExpression):
                render_with_label = column.wraps_column_expression or asfrom
            elif (
                # general class of expressions that don't have a SQL-column
                # addressible name.  includes scalar selects, bind parameters,
                # SQL functions, others
                not isinstance(column, elements.NamedColumn)
                # deeper check that indicates there's no natural "name" to
                # this element, which accommodates for custom SQL constructs
                # that might have a ".name" attribute (but aren't SQL
                # functions) but are not implementing this more recently added
                # base class.  in theory the "NamedColumn" check should be
                # enough, however here we seek to maintain legacy behaviors
                # as well.
                and column._non_anon_label is None
            ):
                render_with_label = True
            else:
                render_with_label = False

            if render_with_label:
                if not fallback_label_name:
                    # used by the RETURNING case right now.  we generate it
                    # here as 3rd party dialects may be referring to
                    # _label_select_column method directly instead of the
                    # just-added _label_returning_column method
                    assert not column_is_repeated
                    fallback_label_name = column._anon_name_label

                fallback_label_name = (
                    elements._truncated_label(fallback_label_name)
                    if not isinstance(
                        fallback_label_name, elements._truncated_label
                    )
                    else fallback_label_name
                )

                result_expr = _CompileLabel(
                    col_expr, fallback_label_name, alt_names=(proxy_name,)
                )
            else:
                result_expr = col_expr

        column_clause_args.update(
            within_columns_clause=within_columns_clause,
            add_to_result_map=add_to_result_map,
            include_table=include_table,
        )
        return result_expr._compiler_dispatch(self, **column_clause_args)

    def format_from_hint_text(self, sqltext, table, hint, iscrud):
        hinttext = self.get_from_hint_text(table, hint)
        if hinttext:
            sqltext += " " + hinttext
        return sqltext

    def get_select_hint_text(self, byfroms):
        return None

    def get_from_hint_text(self, table, text):
        return None

    def get_crud_hint_text(self, table, text):
        return None

    def get_statement_hint_text(self, hint_texts):
        return " ".join(hint_texts)

    _default_stack_entry: _CompilerStackEntry

    if not typing.TYPE_CHECKING:
        _default_stack_entry = util.immutabledict(
            [("correlate_froms", frozenset()), ("asfrom_froms", frozenset())]
        )

    def _display_froms_for_select(
        self, select_stmt, asfrom, lateral=False, **kw
    ):
        # utility method to help external dialects
        # get the correct from list for a select.
        # specifically the oracle dialect needs this feature
        # right now.
        toplevel = not self.stack
        entry = self._default_stack_entry if toplevel else self.stack[-1]

        compile_state = select_stmt._compile_state_factory(select_stmt, self)

        correlate_froms = entry["correlate_froms"]
        asfrom_froms = entry["asfrom_froms"]

        if asfrom and not lateral:
            froms = compile_state._get_display_froms(
                explicit_correlate_froms=correlate_froms.difference(
                    asfrom_froms
                ),
                implicit_correlate_froms=(),
            )
        else:
            froms = compile_state._get_display_froms(
                explicit_correlate_froms=correlate_froms,
                implicit_correlate_froms=asfrom_froms,
            )
        return froms

    translate_select_structure: Any = None
    """if not ``None``, should be a callable which accepts ``(select_stmt,
    **kw)`` and returns a select object.   this is used for structural changes
    mostly to accommodate for LIMIT/OFFSET schemes

    """

    def visit_select(
        self,
        select_stmt,
        asfrom=False,
        insert_into=False,
        fromhints=None,
        compound_index=None,
        select_wraps_for=None,
        lateral=False,
        from_linter=None,
        **kwargs,
    ):
        assert select_wraps_for is None, (
            "SQLAlchemy 1.4 requires use of "
            "the translate_select_structure hook for structural "
            "translations of SELECT objects"
        )

        # initial setup of SELECT.  the compile_state_factory may now
        # be creating a totally different SELECT from the one that was
        # passed in.  for ORM use this will convert from an ORM-state
        # SELECT to a regular "Core" SELECT.  other composed operations
        # such as computation of joins will be performed.

        kwargs["within_columns_clause"] = False

        compile_state = select_stmt._compile_state_factory(
            select_stmt, self, **kwargs
        )
        kwargs[
            "ambiguous_table_name_map"
        ] = compile_state._ambiguous_table_name_map

        select_stmt = compile_state.statement

        toplevel = not self.stack

        if toplevel and not self.compile_state:
            self.compile_state = compile_state

        is_embedded_select = compound_index is not None or insert_into

        # translate step for Oracle, SQL Server which often need to
        # restructure the SELECT to allow for LIMIT/OFFSET and possibly
        # other conditions
        if self.translate_select_structure:
            new_select_stmt = self.translate_select_structure(
                select_stmt, asfrom=asfrom, **kwargs
            )

            # if SELECT was restructured, maintain a link to the originals
            # and assemble a new compile state
            if new_select_stmt is not select_stmt:
                compile_state_wraps_for = compile_state
                select_wraps_for = select_stmt
                select_stmt = new_select_stmt

                compile_state = select_stmt._compile_state_factory(
                    select_stmt, self, **kwargs
                )
                select_stmt = compile_state.statement

        entry = self._default_stack_entry if toplevel else self.stack[-1]

        populate_result_map = need_column_expressions = (
            toplevel
            or entry.get("need_result_map_for_compound", False)
            or entry.get("need_result_map_for_nested", False)
        )

        # indicates there is a CompoundSelect in play and we are not the
        # first select
        if compound_index:
            populate_result_map = False

        # this was first proposed as part of #3372; however, it is not
        # reached in current tests and could possibly be an assertion
        # instead.
        if not populate_result_map and "add_to_result_map" in kwargs:
            del kwargs["add_to_result_map"]

        froms = self._setup_select_stack(
            select_stmt, compile_state, entry, asfrom, lateral, compound_index
        )

        column_clause_args = kwargs.copy()
        column_clause_args.update(
            {"within_label_clause": False, "within_columns_clause": False}
        )

        text = "SELECT "  # we're off to a good start !

        if select_stmt._hints:
            hint_text, byfrom = self._setup_select_hints(select_stmt)
            if hint_text:
                text += hint_text + " "
        else:
            byfrom = None

        if select_stmt._independent_ctes:
            self._dispatch_independent_ctes(select_stmt, kwargs)

        if select_stmt._prefixes:
            text += self._generate_prefixes(
                select_stmt, select_stmt._prefixes, **kwargs
            )

        text += self.get_select_precolumns(select_stmt, **kwargs)
        # the actual list of columns to print in the SELECT column list.
        inner_columns = [
            c
            for c in [
                self._label_select_column(
                    select_stmt,
                    column,
                    populate_result_map,
                    asfrom,
                    column_clause_args,
                    name=name,
                    proxy_name=proxy_name,
                    fallback_label_name=fallback_label_name,
                    column_is_repeated=repeated,
                    need_column_expressions=need_column_expressions,
                )
                for (
                    name,
                    proxy_name,
                    fallback_label_name,
                    column,
                    repeated,
                ) in compile_state.columns_plus_names
            ]
            if c is not None
        ]

        if populate_result_map and select_wraps_for is not None:
            # if this select was generated from translate_select,
            # rewrite the targeted columns in the result map

            translate = dict(
                zip(
                    [
                        name
                        for (
                            key,
                            proxy_name,
                            fallback_label_name,
                            name,
                            repeated,
                        ) in compile_state.columns_plus_names
                    ],
                    [
                        name
                        for (
                            key,
                            proxy_name,
                            fallback_label_name,
                            name,
                            repeated,
                        ) in compile_state_wraps_for.columns_plus_names
                    ],
                )
            )

            self._result_columns = [
                ResultColumnsEntry(
                    key, name, tuple(translate.get(o, o) for o in obj), type_
                )
                for key, name, obj, type_ in self._result_columns
            ]

        text = self._compose_select_body(
            text,
            select_stmt,
            compile_state,
            inner_columns,
            froms,
            byfrom,
            toplevel,
            kwargs,
        )

        if select_stmt._statement_hints:
            per_dialect = [
                ht
                for (dialect_name, ht) in select_stmt._statement_hints
                if dialect_name in ("*", self.dialect.name)
            ]
            if per_dialect:
                text += " " + self.get_statement_hint_text(per_dialect)

        # In compound query, CTEs are shared at the compound level
        if self.ctes and (not is_embedded_select or toplevel):
            nesting_level = len(self.stack) if not toplevel else None
            text = self._render_cte_clause(nesting_level=nesting_level) + text

        if select_stmt._suffixes:
            text += " " + self._generate_prefixes(
                select_stmt, select_stmt._suffixes, **kwargs
            )

        self.stack.pop(-1)

        return text

    def _setup_select_hints(
        self, select: Select[Any]
    ) -> Tuple[str, _FromHintsType]:
        byfrom = {
            from_: hinttext
            % {"name": from_._compiler_dispatch(self, ashint=True)}
            for (from_, dialect), hinttext in select._hints.items()
            if dialect in ("*", self.dialect.name)
        }
        hint_text = self.get_select_hint_text(byfrom)
        return hint_text, byfrom

    def _setup_select_stack(
        self, select, compile_state, entry, asfrom, lateral, compound_index
    ):
        correlate_froms = entry["correlate_froms"]
        asfrom_froms = entry["asfrom_froms"]

        if compound_index == 0:
            entry["select_0"] = select
        elif compound_index:
            select_0 = entry["select_0"]
            numcols = len(select_0._all_selected_columns)

            if len(compile_state.columns_plus_names) != numcols:
                raise exc.CompileError(
                    "All selectables passed to "
                    "CompoundSelect must have identical numbers of "
                    "columns; select #%d has %d columns, select "
                    "#%d has %d"
                    % (
                        1,
                        numcols,
                        compound_index + 1,
                        len(select._all_selected_columns),
                    )
                )

        if asfrom and not lateral:
            froms = compile_state._get_display_froms(
                explicit_correlate_froms=correlate_froms.difference(
                    asfrom_froms
                ),
                implicit_correlate_froms=(),
            )
        else:
            froms = compile_state._get_display_froms(
                explicit_correlate_froms=correlate_froms,
                implicit_correlate_froms=asfrom_froms,
            )

        new_correlate_froms = set(_from_objects(*froms))
        all_correlate_froms = new_correlate_froms.union(correlate_froms)

        new_entry: _CompilerStackEntry = {
            "asfrom_froms": new_correlate_froms,
            "correlate_froms": all_correlate_froms,
            "selectable": select,
            "compile_state": compile_state,
        }
        self.stack.append(new_entry)

        return froms

    def _compose_select_body(
        self,
        text,
        select,
        compile_state,
        inner_columns,
        froms,
        byfrom,
        toplevel,
        kwargs,
    ):
        text += ", ".join(inner_columns)

        if self.linting & COLLECT_CARTESIAN_PRODUCTS:
            from_linter = FromLinter({}, set())
            warn_linting = self.linting & WARN_LINTING
            if toplevel:
                self.from_linter = from_linter
        else:
            from_linter = None
            warn_linting = False

        # adjust the whitespace for no inner columns, part of #9440,
        # so that a no-col SELECT comes out as "SELECT WHERE..." or
        # "SELECT FROM ...".
        # while it would be better to have built the SELECT starting string
        # without trailing whitespace first, then add whitespace only if inner
        # cols were present, this breaks compatibility with various custom
        # compilation schemes that are currently being tested.
        if not inner_columns:
            text = text.rstrip()

        if froms:
            text += " \nFROM "

            if select._hints:
                text += ", ".join(
                    [
                        f._compiler_dispatch(
                            self,
                            asfrom=True,
                            fromhints=byfrom,
                            from_linter=from_linter,
                            **kwargs,
                        )
                        for f in froms
                    ]
                )
            else:
                text += ", ".join(
                    [
                        f._compiler_dispatch(
                            self,
                            asfrom=True,
                            from_linter=from_linter,
                            **kwargs,
                        )
                        for f in froms
                    ]
                )
        else:
            text += self.default_from()

        if select._where_criteria:
            t = self._generate_delimited_and_list(
                select._where_criteria, from_linter=from_linter, **kwargs
            )
            if t:
                text += " \nWHERE " + t

        if warn_linting:
            assert from_linter is not None
            from_linter.warn()

        if select._group_by_clauses:
            text += self.group_by_clause(select, **kwargs)

        if select._having_criteria:
            t = self._generate_delimited_and_list(
                select._having_criteria, **kwargs
            )
            if t:
                text += " \nHAVING " + t

        if select._order_by_clauses:
            text += self.order_by_clause(select, **kwargs)

        if select._has_row_limiting_clause:
            text += self._row_limit_clause(select, **kwargs)

        if select._for_update_arg is not None:
            text += self.for_update_clause(select, **kwargs)

        return text

    def _generate_prefixes(self, stmt, prefixes, **kw):
        clause = " ".join(
            prefix._compiler_dispatch(self, **kw)
            for prefix, dialect_name in prefixes
            if dialect_name in (None, "*") or dialect_name == self.dialect.name
        )
        if clause:
            clause += " "
        return clause

    def _render_cte_clause(
        self,
        nesting_level=None,
        include_following_stack=False,
    ):
        """
        include_following_stack
            Also render the nesting CTEs on the next stack. Useful for
            SQL structures like UNION or INSERT that can wrap SELECT
            statements containing nesting CTEs.
        """
        if not self.ctes:
            return ""

        ctes: MutableMapping[CTE, str]

        if nesting_level and nesting_level > 1:
            ctes = util.OrderedDict()
            for cte in list(self.ctes.keys()):
                cte_level, cte_name, cte_opts = self.level_name_by_cte[
                    cte._get_reference_cte()
                ]
                nesting = cte.nesting or cte_opts.nesting
                is_rendered_level = cte_level == nesting_level or (
                    include_following_stack and cte_level == nesting_level + 1
                )
                if not (nesting and is_rendered_level):
                    continue

                ctes[cte] = self.ctes[cte]

        else:
            ctes = self.ctes

        if not ctes:
            return ""
        ctes_recursive = any([cte.recursive for cte in ctes])

        cte_text = self.get_cte_preamble(ctes_recursive) + " "
        cte_text += ", \n".join([txt for txt in ctes.values()])
        cte_text += "\n "

        if nesting_level and nesting_level > 1:
            for cte in list(ctes.keys()):
                cte_level, cte_name, cte_opts = self.level_name_by_cte[
                    cte._get_reference_cte()
                ]
                del self.ctes[cte]
                del self.ctes_by_level_name[(cte_level, cte_name)]
                del self.level_name_by_cte[cte._get_reference_cte()]

        return cte_text

    def get_cte_preamble(self, recursive):
        if recursive:
            return "WITH RECURSIVE"
        else:
            return "WITH"

    def get_select_precolumns(self, select, **kw):
        """Called when building a ``SELECT`` statement, position is just
        before column list.

        """
        if select._distinct_on:
            util.warn_deprecated(
                "DISTINCT ON is currently supported only by the PostgreSQL "
                "dialect.  Use of DISTINCT ON for other backends is currently "
                "silently ignored, however this usage is deprecated, and will "
                "raise CompileError in a future release for all backends "
                "that do not support this syntax.",
                version="1.4",
            )
        return "DISTINCT " if select._distinct else ""

    def group_by_clause(self, select, **kw):
        """allow dialects to customize how GROUP BY is rendered."""

        group_by = self._generate_delimited_list(
            select._group_by_clauses, OPERATORS[operators.comma_op], **kw
        )
        if group_by:
            return " GROUP BY " + group_by
        else:
            return ""

    def order_by_clause(self, select, **kw):
        """allow dialects to customize how ORDER BY is rendered."""

        order_by = self._generate_delimited_list(
            select._order_by_clauses, OPERATORS[operators.comma_op], **kw
        )

        if order_by:
            return " ORDER BY " + order_by
        else:
            return ""

    def for_update_clause(self, select, **kw):
        return " FOR UPDATE"

    def returning_clause(
        self,
        stmt: UpdateBase,
        returning_cols: Sequence[ColumnElement[Any]],
        *,
        populate_result_map: bool,
        **kw: Any,
    ) -> str:
        columns = [
            self._label_returning_column(
                stmt,
                column,
                populate_result_map,
                fallback_label_name=fallback_label_name,
                column_is_repeated=repeated,
                name=name,
                proxy_name=proxy_name,
                **kw,
            )
            for (
                name,
                proxy_name,
                fallback_label_name,
                column,
                repeated,
            ) in stmt._generate_columns_plus_names(
                True, cols=base._select_iterables(returning_cols)
            )
        ]

        return "RETURNING " + ", ".join(columns)

    def limit_clause(self, select, **kw):
        text = ""
        if select._limit_clause is not None:
            text += "\n LIMIT " + self.process(select._limit_clause, **kw)
        if select._offset_clause is not None:
            if select._limit_clause is None:
                text += "\n LIMIT -1"
            text += " OFFSET " + self.process(select._offset_clause, **kw)
        return text

    def fetch_clause(
        self,
        select,
        fetch_clause=None,
        require_offset=False,
        use_literal_execute_for_simple_int=False,
        **kw,
    ):
        if fetch_clause is None:
            fetch_clause = select._fetch_clause
            fetch_clause_options = select._fetch_clause_options
        else:
            fetch_clause_options = {"percent": False, "with_ties": False}

        text = ""

        if select._offset_clause is not None:
            offset_clause = select._offset_clause
            if (
                use_literal_execute_for_simple_int
                and select._simple_int_clause(offset_clause)
            ):
                offset_clause = offset_clause.render_literal_execute()
            offset_str = self.process(offset_clause, **kw)
            text += "\n OFFSET %s ROWS" % offset_str
        elif require_offset:
            text += "\n OFFSET 0 ROWS"

        if fetch_clause is not None:
            if (
                use_literal_execute_for_simple_int
                and select._simple_int_clause(fetch_clause)
            ):
                fetch_clause = fetch_clause.render_literal_execute()
            text += "\n FETCH FIRST %s%s ROWS %s" % (
                self.process(fetch_clause, **kw),
                " PERCENT" if fetch_clause_options["percent"] else "",
                "WITH TIES" if fetch_clause_options["with_ties"] else "ONLY",
            )
        return text

    def visit_table(
        self,
        table,
        asfrom=False,
        iscrud=False,
        ashint=False,
        fromhints=None,
        use_schema=True,
        from_linter=None,
        ambiguous_table_name_map=None,
        **kwargs,
    ):
        if from_linter:
            from_linter.froms[table] = table.fullname

        if asfrom or ashint:
            effective_schema = self.preparer.schema_for_object(table)

            if use_schema and effective_schema:
                ret = (
                    self.preparer.quote_schema(effective_schema)
                    + "."
                    + self.preparer.quote(table.name)
                )
            else:
                ret = self.preparer.quote(table.name)

                if (
                    not effective_schema
                    and ambiguous_table_name_map
                    and table.name in ambiguous_table_name_map
                ):
                    anon_name = self._truncated_identifier(
                        "alias", ambiguous_table_name_map[table.name]
                    )

                    ret = ret + self.get_render_as_alias_suffix(
                        self.preparer.format_alias(None, anon_name)
                    )

            if fromhints and table in fromhints:
                ret = self.format_from_hint_text(
                    ret, table, fromhints[table], iscrud
                )
            return ret
        else:
            return ""

    def visit_join(self, join, asfrom=False, from_linter=None, **kwargs):
        if from_linter:
            from_linter.edges.update(
                itertools.product(
                    _de_clone(join.left._from_objects),
                    _de_clone(join.right._from_objects),
                )
            )

        if join.full:
            join_type = " FULL OUTER JOIN "
        elif join.isouter:
            join_type = " LEFT OUTER JOIN "
        else:
            join_type = " JOIN "
        return (
            join.left._compiler_dispatch(
                self, asfrom=True, from_linter=from_linter, **kwargs
            )
            + join_type
            + join.right._compiler_dispatch(
                self, asfrom=True, from_linter=from_linter, **kwargs
            )
            + " ON "
            # TODO: likely need asfrom=True here?
            + join.onclause._compiler_dispatch(
                self, from_linter=from_linter, **kwargs
            )
        )

    def _setup_crud_hints(self, stmt, table_text):
        dialect_hints = {
            table: hint_text
            for (table, dialect), hint_text in stmt._hints.items()
            if dialect in ("*", self.dialect.name)
        }
        if stmt.table in dialect_hints:
            table_text = self.format_from_hint_text(
                table_text, stmt.table, dialect_hints[stmt.table], True
            )
        return dialect_hints, table_text

    # within the realm of "insertmanyvalues sentinel columns",
    # these lookups match different kinds of Column() configurations
    # to specific backend capabilities.  they are broken into two
    # lookups, one for autoincrement columns and the other for non
    # autoincrement columns
    _sentinel_col_non_autoinc_lookup = util.immutabledict(
        {
            _SentinelDefaultCharacterization.CLIENTSIDE: (
                InsertmanyvaluesSentinelOpts._SUPPORTED_OR_NOT
            ),
            _SentinelDefaultCharacterization.SENTINEL_DEFAULT: (
                InsertmanyvaluesSentinelOpts._SUPPORTED_OR_NOT
            ),
            _SentinelDefaultCharacterization.NONE: (
                InsertmanyvaluesSentinelOpts._SUPPORTED_OR_NOT
            ),
            _SentinelDefaultCharacterization.IDENTITY: (
                InsertmanyvaluesSentinelOpts.IDENTITY
            ),
            _SentinelDefaultCharacterization.SEQUENCE: (
                InsertmanyvaluesSentinelOpts.SEQUENCE
            ),
        }
    )
    _sentinel_col_autoinc_lookup = _sentinel_col_non_autoinc_lookup.union(
        {
            _SentinelDefaultCharacterization.NONE: (
                InsertmanyvaluesSentinelOpts.AUTOINCREMENT
            ),
        }
    )

    def _get_sentinel_column_for_table(
        self, table: Table
    ) -> Optional[Sequence[Column[Any]]]:
        """given a :class:`.Table`, return a usable sentinel column or
        columns for this dialect if any.

        Return None if no sentinel columns could be identified, or raise an
        error if a column was marked as a sentinel explicitly but isn't
        compatible with this dialect.

        """

        sentinel_opts = self.dialect.insertmanyvalues_implicit_sentinel
        sentinel_characteristics = table._sentinel_column_characteristics

        sent_cols = sentinel_characteristics.columns

        if sent_cols is None:
            return None

        if sentinel_characteristics.is_autoinc:
            bitmask = self._sentinel_col_autoinc_lookup.get(
                sentinel_characteristics.default_characterization, 0
            )
        else:
            bitmask = self._sentinel_col_non_autoinc_lookup.get(
                sentinel_characteristics.default_characterization, 0
            )

        if sentinel_opts & bitmask:
            return sent_cols

        if sentinel_characteristics.is_explicit:
            # a column was explicitly marked as insert_sentinel=True,
            # however it is not compatible with this dialect.   they should
            # not indicate this column as a sentinel if they need to include
            # this dialect.

            # TODO: do we want non-primary key explicit sentinel cols
            # that can gracefully degrade for some backends?
            # insert_sentinel="degrade" perhaps.  not for the initial release.
            # I am hoping people are generally not dealing with this sentinel
            # business at all.

            # if is_explicit is True, there will be only one sentinel column.

            raise exc.InvalidRequestError(
                f"Column {sent_cols[0]} can't be explicitly "
                "marked as a sentinel column when using the "
                f"{self.dialect.name} dialect, as the "
                "particular type of default generation on this column is "
                "not currently compatible with this dialect's specific "
                f"INSERT..RETURNING syntax which can receive the "
                "server-generated value in "
                "a deterministic way.  To remove this error, remove "
                "insert_sentinel=True from primary key autoincrement "
                "columns; these columns are automatically used as "
                "sentinels for supported dialects in any case."
            )

        return None

    def _deliver_insertmanyvalues_batches(
        self,
        statement: str,
        parameters: _DBAPIMultiExecuteParams,
        generic_setinputsizes: Optional[_GenericSetInputSizesType],
        batch_size: int,
        sort_by_parameter_order: bool,
    ) -> Iterator[_InsertManyValuesBatch]:
        imv = self._insertmanyvalues
        assert imv is not None

        lenparams = len(parameters)
        if imv.is_default_expr and not self.dialect.supports_default_metavalue:
            # backend doesn't support
            # INSERT INTO table (pk_col) VALUES (DEFAULT), (DEFAULT), ...
            # at the moment this is basically SQL Server due to
            # not being able to use DEFAULT for identity column
            # just yield out that many single statements!  still
            # faster than a whole connection.execute() call ;)
            #
            # note we still are taking advantage of the fact that we know
            # we are using RETURNING.   The generalized approach of fetching
            # cursor.lastrowid etc. still goes through the more heavyweight
            # "ExecutionContext per statement" system as it isn't usable
            # as a generic "RETURNING" approach
            use_row_at_a_time = True
            downgraded = False
        elif not self.dialect.supports_multivalues_insert or (
            sort_by_parameter_order
            and self._result_columns
            and (imv.sentinel_columns is None or imv.includes_upsert_behaviors)
        ):
            # deterministic order was requested and the compiler could
            # not organize sentinel columns for this dialect/statement.
            # use row at a time
            use_row_at_a_time = True
            downgraded = True
        else:
            use_row_at_a_time = False
            downgraded = False

        if use_row_at_a_time:
            for batchnum, param in enumerate(
                cast("Sequence[_DBAPISingleExecuteParams]", parameters), 1
            ):
                yield _InsertManyValuesBatch(
                    statement,
                    param,
                    generic_setinputsizes,
                    [param],
                    batch_size,
                    batchnum,
                    lenparams,
                    sort_by_parameter_order,
                    downgraded,
                )
            return

        executemany_values = f"({imv.single_values_expr})"
        statement = statement.replace(executemany_values, "__EXECMANY_TOKEN__")

        # Use optional insertmanyvalues_max_parameters
        # to further shrink the batch size so that there are no more than
        # insertmanyvalues_max_parameters params.
        # Currently used by SQL Server, which limits statements to 2100 bound
        # parameters (actually 2099).
        max_params = self.dialect.insertmanyvalues_max_parameters
        if max_params:
            total_num_of_params = len(self.bind_names)
            num_params_per_batch = len(imv.insert_crud_params)
            num_params_outside_of_batch = (
                total_num_of_params - num_params_per_batch
            )
            batch_size = min(
                batch_size,
                (
                    (max_params - num_params_outside_of_batch)
                    // num_params_per_batch
                ),
            )

        batches = list(parameters)

        processed_setinputsizes: Optional[_GenericSetInputSizesType] = None
        batchnum = 1
        total_batches = lenparams // batch_size + (
            1 if lenparams % batch_size else 0
        )

        insert_crud_params = imv.insert_crud_params
        assert insert_crud_params is not None

        escaped_bind_names: Mapping[str, str]
        expand_pos_lower_index = expand_pos_upper_index = 0

        if not self.positional:
            if self.escaped_bind_names:
                escaped_bind_names = self.escaped_bind_names
            else:
                escaped_bind_names = {}

            all_keys = set(parameters[0])

            def apply_placeholders(keys, formatted):
                for key in keys:
                    key = escaped_bind_names.get(key, key)
                    formatted = formatted.replace(
                        self.bindtemplate % {"name": key},
                        self.bindtemplate
                        % {"name": f"{key}__EXECMANY_INDEX__"},
                    )
                return formatted

            if imv.embed_values_counter:
                imv_values_counter = ", _IMV_VALUES_COUNTER"
            else:
                imv_values_counter = ""
            formatted_values_clause = f"""({', '.join(
                apply_placeholders(bind_keys, formatted)
                for _, _, formatted, bind_keys in insert_crud_params
            )}{imv_values_counter})"""

            keys_to_replace = all_keys.intersection(
                escaped_bind_names.get(key, key)
                for _, _, _, bind_keys in insert_crud_params
                for key in bind_keys
            )
            base_parameters = {
                key: parameters[0][key]
                for key in all_keys.difference(keys_to_replace)
            }
            executemany_values_w_comma = ""
        else:
            formatted_values_clause = ""
            keys_to_replace = set()
            base_parameters = {}

            if imv.embed_values_counter:
                executemany_values_w_comma = (
                    f"({imv.single_values_expr}, _IMV_VALUES_COUNTER), "
                )
            else:
                executemany_values_w_comma = f"({imv.single_values_expr}), "

            all_names_we_will_expand: Set[str] = set()
            for elem in imv.insert_crud_params:
                all_names_we_will_expand.update(elem[3])

            # get the start and end position in a particular list
            # of parameters where we will be doing the "expanding".
            # statements can have params on either side or both sides,
            # given RETURNING and CTEs
            if all_names_we_will_expand:
                positiontup = self.positiontup
                assert positiontup is not None

                all_expand_positions = {
                    idx
                    for idx, name in enumerate(positiontup)
                    if name in all_names_we_will_expand
                }
                expand_pos_lower_index = min(all_expand_positions)
                expand_pos_upper_index = max(all_expand_positions) + 1
                assert (
                    len(all_expand_positions)
                    == expand_pos_upper_index - expand_pos_lower_index
                )

            if self._numeric_binds:
                escaped = re.escape(self._numeric_binds_identifier_char)
                executemany_values_w_comma = re.sub(
                    rf"{escaped}\d+", "%s", executemany_values_w_comma
                )

        while batches:
            batch = cast("Sequence[Any]", batches[0:batch_size])
            batches[0:batch_size] = []

            if generic_setinputsizes:
                # if setinputsizes is present, expand this collection to
                # suit the batch length as well
                # currently this will be mssql+pyodbc for internal dialects
                processed_setinputsizes = [
                    (new_key, len_, typ)
                    for new_key, len_, typ in (
                        (f"{key}_{index}", len_, typ)
                        for index in range(len(batch))
                        for key, len_, typ in generic_setinputsizes
                    )
                ]

            replaced_parameters: Any
            if self.positional:
                num_ins_params = imv.num_positional_params_counted

                batch_iterator: Iterable[Sequence[Any]]
                if num_ins_params == len(batch[0]):
                    extra_params_left = extra_params_right = ()
                    batch_iterator = batch
                else:
                    extra_params_left = batch[0][:expand_pos_lower_index]
                    extra_params_right = batch[0][expand_pos_upper_index:]
                    batch_iterator = (
                        b[expand_pos_lower_index:expand_pos_upper_index]
                        for b in batch
                    )

                if imv.embed_values_counter:
                    expanded_values_string = (
                        "".join(
                            executemany_values_w_comma.replace(
                                "_IMV_VALUES_COUNTER", str(i)
                            )
                            for i, _ in enumerate(batch)
                        )
                    )[:-2]
                else:
                    expanded_values_string = (
                        (executemany_values_w_comma * len(batch))
                    )[:-2]

                if self._numeric_binds and num_ins_params > 0:
                    # numeric will always number the parameters inside of
                    # VALUES (and thus order self.positiontup) to be higher
                    # than non-VALUES parameters, no matter where in the
                    # statement those non-VALUES parameters appear (this is
                    # ensured in _process_numeric by numbering first all
                    # params that are not in _values_bindparam)
                    # therefore all extra params are always
                    # on the left side and numbered lower than the VALUES
                    # parameters
                    assert not extra_params_right

                    start = expand_pos_lower_index + 1
                    end = num_ins_params * (len(batch)) + start

                    # need to format here, since statement may contain
                    # unescaped %, while values_string contains just (%s, %s)
                    positions = tuple(
                        f"{self._numeric_binds_identifier_char}{i}"
                        for i in range(start, end)
                    )
                    expanded_values_string = expanded_values_string % positions

                replaced_statement = statement.replace(
                    "__EXECMANY_TOKEN__", expanded_values_string
                )

                replaced_parameters = tuple(
                    itertools.chain.from_iterable(batch_iterator)
                )

                replaced_parameters = (
                    extra_params_left
                    + replaced_parameters
                    + extra_params_right
                )

            else:
                replaced_values_clauses = []
                replaced_parameters = base_parameters.copy()

                for i, param in enumerate(batch):
                    fmv = formatted_values_clause.replace(
                        "EXECMANY_INDEX__", str(i)
                    )
                    if imv.embed_values_counter:
                        fmv = fmv.replace("_IMV_VALUES_COUNTER", str(i))

                    replaced_values_clauses.append(fmv)
                    replaced_parameters.update(
                        {f"{key}__{i}": param[key] for key in keys_to_replace}
                    )

                replaced_statement = statement.replace(
                    "__EXECMANY_TOKEN__",
                    ", ".join(replaced_values_clauses),
                )

            yield _InsertManyValuesBatch(
                replaced_statement,
                replaced_parameters,
                processed_setinputsizes,
                batch,
                batch_size,
                batchnum,
                total_batches,
                sort_by_parameter_order,
                False,
            )
            batchnum += 1

    def visit_insert(
        self, insert_stmt, visited_bindparam=None, visiting_cte=None, **kw
    ):
        compile_state = insert_stmt._compile_state_factory(
            insert_stmt, self, **kw
        )
        insert_stmt = compile_state.statement

        if visiting_cte is not None:
            kw["visiting_cte"] = visiting_cte
            toplevel = False
        else:
            toplevel = not self.stack

        if toplevel:
            self.isinsert = True
            if not self.dml_compile_state:
                self.dml_compile_state = compile_state
            if not self.compile_state:
                self.compile_state = compile_state

        self.stack.append(
            {
                "correlate_froms": set(),
                "asfrom_froms": set(),
                "selectable": insert_stmt,
            }
        )

        counted_bindparam = 0

        # reset any incoming "visited_bindparam" collection
        visited_bindparam = None

        # for positional, insertmanyvalues needs to know how many
        # bound parameters are in the VALUES sequence; there's no simple
        # rule because default expressions etc. can have zero or more
        # params inside them.   After multiple attempts to figure this out,
        # this very simplistic "count after" works and is
        # likely the least amount of callcounts, though looks clumsy
        if self.positional and visiting_cte is None:
            # if we are inside a CTE, don't count parameters
            # here since they wont be for insertmanyvalues. keep
            # visited_bindparam at None so no counting happens.
            # see #9173
            visited_bindparam = []

        crud_params_struct = crud._get_crud_params(
            self,
            insert_stmt,
            compile_state,
            toplevel,
            visited_bindparam=visited_bindparam,
            **kw,
        )

        if self.positional and visited_bindparam is not None:
            counted_bindparam = len(visited_bindparam)
            if self._numeric_binds:
                if self._values_bindparam is not None:
                    self._values_bindparam += visited_bindparam
                else:
                    self._values_bindparam = visited_bindparam

        crud_params_single = crud_params_struct.single_params

        if (
            not crud_params_single
            and not self.dialect.supports_default_values
            and not self.dialect.supports_default_metavalue
            and not self.dialect.supports_empty_insert
        ):
            raise exc.CompileError(
                "The '%s' dialect with current database "
                "version settings does not support empty "
                "inserts." % self.dialect.name
            )

        if compile_state._has_multi_parameters:
            if not self.dialect.supports_multivalues_insert:
                raise exc.CompileError(
                    "The '%s' dialect with current database "
                    "version settings does not support "
                    "in-place multirow inserts." % self.dialect.name
                )
            elif (
                self.implicit_returning or insert_stmt._returning
            ) and insert_stmt._sort_by_parameter_order:
                raise exc.CompileError(
                    "RETURNING cannot be determinstically sorted when "
                    "using an INSERT which includes multi-row values()."
                )
            crud_params_single = crud_params_struct.single_params
        else:
            crud_params_single = crud_params_struct.single_params

        preparer = self.preparer
        supports_default_values = self.dialect.supports_default_values

        text = "INSERT "

        if insert_stmt._prefixes:
            text += self._generate_prefixes(
                insert_stmt, insert_stmt._prefixes, **kw
            )

        text += "INTO "
        table_text = preparer.format_table(insert_stmt.table)

        if insert_stmt._hints:
            _, table_text = self._setup_crud_hints(insert_stmt, table_text)

        if insert_stmt._independent_ctes:
            self._dispatch_independent_ctes(insert_stmt, kw)

        text += table_text

        if crud_params_single or not supports_default_values:
            text += " (%s)" % ", ".join(
                [expr for _, expr, _, _ in crud_params_single]
            )

        # look for insertmanyvalues attributes that would have been configured
        # by crud.py as it scanned through the columns to be part of the
        # INSERT
        use_insertmanyvalues = crud_params_struct.use_insertmanyvalues
        named_sentinel_params: Optional[Sequence[str]] = None
        add_sentinel_cols = None
        implicit_sentinel = False

        returning_cols = self.implicit_returning or insert_stmt._returning
        if returning_cols:
            add_sentinel_cols = crud_params_struct.use_sentinel_columns

            if add_sentinel_cols is not None:
                assert use_insertmanyvalues

                # search for the sentinel column explicitly present
                # in the INSERT columns list, and additionally check that
                # this column has a bound parameter name set up that's in the
                # parameter list.  If both of these cases are present, it means
                # we will have a client side value for the sentinel in each
                # parameter set.

                _params_by_col = {
                    col: param_names
                    for col, _, _, param_names in crud_params_single
                }
                named_sentinel_params = []
                for _add_sentinel_col in add_sentinel_cols:
                    if _add_sentinel_col not in _params_by_col:
                        named_sentinel_params = None
                        break
                    param_name = self._within_exec_param_key_getter(
                        _add_sentinel_col
                    )
                    if param_name not in _params_by_col[_add_sentinel_col]:
                        named_sentinel_params = None
                        break
                    named_sentinel_params.append(param_name)

                if named_sentinel_params is None:
                    # if we are not going to have a client side value for
                    # the sentinel in the parameter set, that means it's
                    # an autoincrement, an IDENTITY, or a server-side SQL
                    # expression like nextval('seqname').  So this is
                    # an "implicit" sentinel; we will look for it in
                    # RETURNING
                    # only, and then sort on it.  For this case on PG,
                    # SQL Server we have to use a special INSERT form
                    # that guarantees the server side function lines up with
                    # the entries in the VALUES.
                    if (
                        self.dialect.insertmanyvalues_implicit_sentinel
                        & InsertmanyvaluesSentinelOpts.ANY_AUTOINCREMENT
                    ):
                        implicit_sentinel = True
                    else:
                        # here, we are not using a sentinel at all
                        # and we are likely the SQLite dialect.
                        # The first add_sentinel_col that we have should not
                        # be marked as "insert_sentinel=True".  if it was,
                        # an error should have been raised in
                        # _get_sentinel_column_for_table.
                        assert not add_sentinel_cols[0]._insert_sentinel, (
                            "sentinel selection rules should have prevented "
                            "us from getting here for this dialect"
                        )

                # always put the sentinel columns last.  even if they are
                # in the returning list already, they will be there twice
                # then.
                returning_cols = list(returning_cols) + list(add_sentinel_cols)

            returning_clause = self.returning_clause(
                insert_stmt,
                returning_cols,
                populate_result_map=toplevel,
            )

            if self.returning_precedes_values:
                text += " " + returning_clause

        else:
            returning_clause = None

        if insert_stmt.select is not None:
            # placed here by crud.py
            select_text = self.process(
                self.stack[-1]["insert_from_select"], insert_into=True, **kw
            )

            if self.ctes and self.dialect.cte_follows_insert:
                nesting_level = len(self.stack) if not toplevel else None
                text += " %s%s" % (
                    self._render_cte_clause(
                        nesting_level=nesting_level,
                        include_following_stack=True,
                    ),
                    select_text,
                )
            else:
                text += " %s" % select_text
        elif not crud_params_single and supports_default_values:
            text += " DEFAULT VALUES"
            if use_insertmanyvalues:
                self._insertmanyvalues = _InsertManyValues(
                    True,
                    self.dialect.default_metavalue_token,
                    cast(
                        "List[crud._CrudParamElementStr]", crud_params_single
                    ),
                    counted_bindparam,
                    sort_by_parameter_order=(
                        insert_stmt._sort_by_parameter_order
                    ),
                    includes_upsert_behaviors=(
                        insert_stmt._post_values_clause is not None
                    ),
                    sentinel_columns=add_sentinel_cols,
                    num_sentinel_columns=len(add_sentinel_cols)
                    if add_sentinel_cols
                    else 0,
                    implicit_sentinel=implicit_sentinel,
                )
        elif compile_state._has_multi_parameters:
            text += " VALUES %s" % (
                ", ".join(
                    "(%s)"
                    % (", ".join(value for _, _, value, _ in crud_param_set))
                    for crud_param_set in crud_params_struct.all_multi_params
                ),
            )
        else:
            insert_single_values_expr = ", ".join(
                [
                    value
                    for _, _, value, _ in cast(
                        "List[crud._CrudParamElementStr]",
                        crud_params_single,
                    )
                ]
            )

            if use_insertmanyvalues:
                if (
                    implicit_sentinel
                    and (
                        self.dialect.insertmanyvalues_implicit_sentinel
                        & InsertmanyvaluesSentinelOpts.USE_INSERT_FROM_SELECT
                    )
                    # this is checking if we have
                    # INSERT INTO table (id) VALUES (DEFAULT).
                    and not (crud_params_struct.is_default_metavalue_only)
                ):
                    # if we have a sentinel column that is server generated,
                    # then for selected backends render the VALUES list as a
                    # subquery.  This is the orderable form supported by
                    # PostgreSQL and SQL Server.
                    embed_sentinel_value = True

                    render_bind_casts = (
                        self.dialect.insertmanyvalues_implicit_sentinel
                        & InsertmanyvaluesSentinelOpts.RENDER_SELECT_COL_CASTS
                    )

                    colnames = ", ".join(
                        f"p{i}" for i, _ in enumerate(crud_params_single)
                    )

                    if render_bind_casts:
                        # render casts for the SELECT list.  For PG, we are
                        # already rendering bind casts in the parameter list,
                        # selectively for the more "tricky" types like ARRAY.
                        # however, even for the "easy" types, if the parameter
                        # is NULL for every entry, PG gives up and says
                        # "it must be TEXT", which fails for other easy types
                        # like ints.  So we cast on this side too.
                        colnames_w_cast = ", ".join(
                            self.render_bind_cast(
                                col.type,
                                col.type._unwrapped_dialect_impl(self.dialect),
                                f"p{i}",
                            )
                            for i, (col, *_) in enumerate(crud_params_single)
                        )
                    else:
                        colnames_w_cast = colnames

                    text += (
                        f" SELECT {colnames_w_cast} FROM "
                        f"(VALUES ({insert_single_values_expr})) "
                        f"AS imp_sen({colnames}, sen_counter) "
                        "ORDER BY sen_counter"
                    )
                else:
                    # otherwise, if no sentinel or backend doesn't support
                    # orderable subquery form, use a plain VALUES list
                    embed_sentinel_value = False
                    text += f" VALUES ({insert_single_values_expr})"

                self._insertmanyvalues = _InsertManyValues(
                    is_default_expr=False,
                    single_values_expr=insert_single_values_expr,
                    insert_crud_params=cast(
                        "List[crud._CrudParamElementStr]",
                        crud_params_single,
                    ),
                    num_positional_params_counted=counted_bindparam,
                    sort_by_parameter_order=(
                        insert_stmt._sort_by_parameter_order
                    ),
                    includes_upsert_behaviors=(
                        insert_stmt._post_values_clause is not None
                    ),
                    sentinel_columns=add_sentinel_cols,
                    num_sentinel_columns=len(add_sentinel_cols)
                    if add_sentinel_cols
                    else 0,
                    sentinel_param_keys=named_sentinel_params,
                    implicit_sentinel=implicit_sentinel,
                    embed_values_counter=embed_sentinel_value,
                )

            else:
                text += f" VALUES ({insert_single_values_expr})"

        if insert_stmt._post_values_clause is not None:
            post_values_clause = self.process(
                insert_stmt._post_values_clause, **kw
            )
            if post_values_clause:
                text += " " + post_values_clause

        if returning_clause and not self.returning_precedes_values:
            text += " " + returning_clause

        if self.ctes and not self.dialect.cte_follows_insert:
            nesting_level = len(self.stack) if not toplevel else None
            text = (
                self._render_cte_clause(
                    nesting_level=nesting_level,
                    include_following_stack=True,
                )
                + text
            )

        self.stack.pop(-1)

        return text

    def update_limit_clause(self, update_stmt):
        """Provide a hook for MySQL to add LIMIT to the UPDATE"""
        return None

    def update_tables_clause(self, update_stmt, from_table, extra_froms, **kw):
        """Provide a hook to override the initial table clause
        in an UPDATE statement.

        MySQL overrides this.

        """
        kw["asfrom"] = True
        return from_table._compiler_dispatch(self, iscrud=True, **kw)

    def update_from_clause(
        self, update_stmt, from_table, extra_froms, from_hints, **kw
    ):
        """Provide a hook to override the generation of an
        UPDATE..FROM clause.

        MySQL and MSSQL override this.

        """
        raise NotImplementedError(
            "This backend does not support multiple-table "
            "criteria within UPDATE"
        )

    def visit_update(self, update_stmt, visiting_cte=None, **kw):
        compile_state = update_stmt._compile_state_factory(
            update_stmt, self, **kw
        )
        update_stmt = compile_state.statement

        if visiting_cte is not None:
            kw["visiting_cte"] = visiting_cte
            toplevel = False
        else:
            toplevel = not self.stack

        if toplevel:
            self.isupdate = True
            if not self.dml_compile_state:
                self.dml_compile_state = compile_state
            if not self.compile_state:
                self.compile_state = compile_state

        if self.linting & COLLECT_CARTESIAN_PRODUCTS:
            from_linter = FromLinter({}, set())
            warn_linting = self.linting & WARN_LINTING
            if toplevel:
                self.from_linter = from_linter
        else:
            from_linter = None
            warn_linting = False

        extra_froms = compile_state._extra_froms
        is_multitable = bool(extra_froms)

        if is_multitable:
            # main table might be a JOIN
            main_froms = set(_from_objects(update_stmt.table))
            render_extra_froms = [
                f for f in extra_froms if f not in main_froms
            ]
            correlate_froms = main_froms.union(extra_froms)
        else:
            render_extra_froms = []
            correlate_froms = {update_stmt.table}

        self.stack.append(
            {
                "correlate_froms": correlate_froms,
                "asfrom_froms": correlate_froms,
                "selectable": update_stmt,
            }
        )

        text = "UPDATE "

        if update_stmt._prefixes:
            text += self._generate_prefixes(
                update_stmt, update_stmt._prefixes, **kw
            )

        table_text = self.update_tables_clause(
            update_stmt,
            update_stmt.table,
            render_extra_froms,
            from_linter=from_linter,
            **kw,
        )
        crud_params_struct = crud._get_crud_params(
            self, update_stmt, compile_state, toplevel, **kw
        )
        crud_params = crud_params_struct.single_params

        if update_stmt._hints:
            dialect_hints, table_text = self._setup_crud_hints(
                update_stmt, table_text
            )
        else:
            dialect_hints = None

        if update_stmt._independent_ctes:
            self._dispatch_independent_ctes(update_stmt, kw)

        text += table_text

        text += " SET "
        text += ", ".join(
            expr + "=" + value
            for _, expr, value, _ in cast(
                "List[Tuple[Any, str, str, Any]]", crud_params
            )
        )

        if self.implicit_returning or update_stmt._returning:
            if self.returning_precedes_values:
                text += " " + self.returning_clause(
                    update_stmt,
                    self.implicit_returning or update_stmt._returning,
                    populate_result_map=toplevel,
                )

        if extra_froms:
            extra_from_text = self.update_from_clause(
                update_stmt,
                update_stmt.table,
                render_extra_froms,
                dialect_hints,
                from_linter=from_linter,
                **kw,
            )
            if extra_from_text:
                text += " " + extra_from_text

        if update_stmt._where_criteria:
            t = self._generate_delimited_and_list(
                update_stmt._where_criteria, from_linter=from_linter, **kw
            )
            if t:
                text += " WHERE " + t

        limit_clause = self.update_limit_clause(update_stmt)
        if limit_clause:
            text += " " + limit_clause

        if (
            self.implicit_returning or update_stmt._returning
        ) and not self.returning_precedes_values:
            text += " " + self.returning_clause(
                update_stmt,
                self.implicit_returning or update_stmt._returning,
                populate_result_map=toplevel,
            )

        if self.ctes:
            nesting_level = len(self.stack) if not toplevel else None
            text = self._render_cte_clause(nesting_level=nesting_level) + text

        if warn_linting:
            assert from_linter is not None
            from_linter.warn(stmt_type="UPDATE")

        self.stack.pop(-1)

        return text

    def delete_extra_from_clause(
        self, update_stmt, from_table, extra_froms, from_hints, **kw
    ):
        """Provide a hook to override the generation of an
        DELETE..FROM clause.

        This can be used to implement DELETE..USING for example.

        MySQL and MSSQL override this.

        """
        raise NotImplementedError(
            "This backend does not support multiple-table "
            "criteria within DELETE"
        )

    def delete_table_clause(self, delete_stmt, from_table, extra_froms, **kw):
        return from_table._compiler_dispatch(
            self, asfrom=True, iscrud=True, **kw
        )

    def visit_delete(self, delete_stmt, visiting_cte=None, **kw):
        compile_state = delete_stmt._compile_state_factory(
            delete_stmt, self, **kw
        )
        delete_stmt = compile_state.statement

        if visiting_cte is not None:
            kw["visiting_cte"] = visiting_cte
            toplevel = False
        else:
            toplevel = not self.stack

        if toplevel:
            self.isdelete = True
            if not self.dml_compile_state:
                self.dml_compile_state = compile_state
            if not self.compile_state:
                self.compile_state = compile_state

        if self.linting & COLLECT_CARTESIAN_PRODUCTS:
            from_linter = FromLinter({}, set())
            warn_linting = self.linting & WARN_LINTING
            if toplevel:
                self.from_linter = from_linter
        else:
            from_linter = None
            warn_linting = False

        extra_froms = compile_state._extra_froms

        correlate_froms = {delete_stmt.table}.union(extra_froms)
        self.stack.append(
            {
                "correlate_froms": correlate_froms,
                "asfrom_froms": correlate_froms,
                "selectable": delete_stmt,
            }
        )

        text = "DELETE "

        if delete_stmt._prefixes:
            text += self._generate_prefixes(
                delete_stmt, delete_stmt._prefixes, **kw
            )

        text += "FROM "

        try:
            table_text = self.delete_table_clause(
                delete_stmt,
                delete_stmt.table,
                extra_froms,
                from_linter=from_linter,
            )
        except TypeError:
            # anticipate 3rd party dialects that don't include **kw
            # TODO: remove in 2.1
            table_text = self.delete_table_clause(
                delete_stmt, delete_stmt.table, extra_froms
            )
            if from_linter:
                _ = self.process(delete_stmt.table, from_linter=from_linter)

        crud._get_crud_params(self, delete_stmt, compile_state, toplevel, **kw)

        if delete_stmt._hints:
            dialect_hints, table_text = self._setup_crud_hints(
                delete_stmt, table_text
            )
        else:
            dialect_hints = None

        if delete_stmt._independent_ctes:
            self._dispatch_independent_ctes(delete_stmt, kw)

        text += table_text

        if (
            self.implicit_returning or delete_stmt._returning
        ) and self.returning_precedes_values:
            text += " " + self.returning_clause(
                delete_stmt,
                self.implicit_returning or delete_stmt._returning,
                populate_result_map=toplevel,
            )

        if extra_froms:
            extra_from_text = self.delete_extra_from_clause(
                delete_stmt,
                delete_stmt.table,
                extra_froms,
                dialect_hints,
                from_linter=from_linter,
                **kw,
            )
            if extra_from_text:
                text += " " + extra_from_text

        if delete_stmt._where_criteria:
            t = self._generate_delimited_and_list(
                delete_stmt._where_criteria, from_linter=from_linter, **kw
            )
            if t:
                text += " WHERE " + t

        if (
            self.implicit_returning or delete_stmt._returning
        ) and not self.returning_precedes_values:
            text += " " + self.returning_clause(
                delete_stmt,
                self.implicit_returning or delete_stmt._returning,
                populate_result_map=toplevel,
            )

        if self.ctes:
            nesting_level = len(self.stack) if not toplevel else None
            text = self._render_cte_clause(nesting_level=nesting_level) + text

        if warn_linting:
            assert from_linter is not None
            from_linter.warn(stmt_type="DELETE")

        self.stack.pop(-1)

        return text

    def visit_savepoint(self, savepoint_stmt, **kw):
        return "SAVEPOINT %s" % self.preparer.format_savepoint(savepoint_stmt)

    def visit_rollback_to_savepoint(self, savepoint_stmt, **kw):
        return "ROLLBACK TO SAVEPOINT %s" % self.preparer.format_savepoint(
            savepoint_stmt
        )

    def visit_release_savepoint(self, savepoint_stmt, **kw):
        return "RELEASE SAVEPOINT %s" % self.preparer.format_savepoint(
            savepoint_stmt
        )


class StrSQLCompiler(SQLCompiler):
    """A :class:`.SQLCompiler` subclass which allows a small selection
    of non-standard SQL features to render into a string value.

    The :class:`.StrSQLCompiler` is invoked whenever a Core expression
    element is directly stringified without calling upon the
    :meth:`_expression.ClauseElement.compile` method.
    It can render a limited set
    of non-standard SQL constructs to assist in basic stringification,
    however for more substantial custom or dialect-specific SQL constructs,
    it will be necessary to make use of
    :meth:`_expression.ClauseElement.compile`
    directly.

    .. seealso::

        :ref:`faq_sql_expression_string`

    """

    def _fallback_column_name(self, column):
        return "<name unknown>"

    @util.preload_module("sqlalchemy.engine.url")
    def visit_unsupported_compilation(self, element, err, **kw):
        if element.stringify_dialect != "default":
            url = util.preloaded.engine_url
            dialect = url.URL.create(element.stringify_dialect).get_dialect()()

            compiler = dialect.statement_compiler(
                dialect, None, _supporting_against=self
            )
            if not isinstance(compiler, StrSQLCompiler):
                return compiler.process(element, **kw)

        return super().visit_unsupported_compilation(element, err)

    def visit_getitem_binary(self, binary, operator, **kw):
        return "%s[%s]" % (
            self.process(binary.left, **kw),
            self.process(binary.right, **kw),
        )

    def visit_json_getitem_op_binary(self, binary, operator, **kw):
        return self.visit_getitem_binary(binary, operator, **kw)

    def visit_json_path_getitem_op_binary(self, binary, operator, **kw):
        return self.visit_getitem_binary(binary, operator, **kw)

    def visit_sequence(self, seq, **kw):
        return "<next sequence value: %s>" % self.preparer.format_sequence(seq)

    def returning_clause(
        self,
        stmt: UpdateBase,
        returning_cols: Sequence[ColumnElement[Any]],
        *,
        populate_result_map: bool,
        **kw: Any,
    ) -> str:
        columns = [
            self._label_select_column(None, c, True, False, {})
            for c in base._select_iterables(returning_cols)
        ]
        return "RETURNING " + ", ".join(columns)

    def update_from_clause(
        self, update_stmt, from_table, extra_froms, from_hints, **kw
    ):
        kw["asfrom"] = True
        return "FROM " + ", ".join(
            t._compiler_dispatch(self, fromhints=from_hints, **kw)
            for t in extra_froms
        )

    def delete_extra_from_clause(
        self, update_stmt, from_table, extra_froms, from_hints, **kw
    ):
        kw["asfrom"] = True
        return ", " + ", ".join(
            t._compiler_dispatch(self, fromhints=from_hints, **kw)
            for t in extra_froms
        )

    def visit_empty_set_expr(self, type_, **kw):
        return "SELECT 1 WHERE 1!=1"

    def get_from_hint_text(self, table, text):
        return "[%s]" % text

    def visit_regexp_match_op_binary(self, binary, operator, **kw):
        return self._generate_generic_binary(binary, " <regexp> ", **kw)

    def visit_not_regexp_match_op_binary(self, binary, operator, **kw):
        return self._generate_generic_binary(binary, " <not regexp> ", **kw)

    def visit_regexp_replace_op_binary(self, binary, operator, **kw):
        return "<regexp replace>(%s, %s)" % (
            binary.left._compiler_dispatch(self, **kw),
            binary.right._compiler_dispatch(self, **kw),
        )

    def visit_try_cast(self, cast, **kwargs):
        return "TRY_CAST(%s AS %s)" % (
            cast.clause._compiler_dispatch(self, **kwargs),
            cast.typeclause._compiler_dispatch(self, **kwargs),
        )


class DDLCompiler(Compiled):
    is_ddl = True

    if TYPE_CHECKING:

        def __init__(
            self,
            dialect: Dialect,
            statement: ExecutableDDLElement,
            schema_translate_map: Optional[SchemaTranslateMapType] = ...,
            render_schema_translate: bool = ...,
            compile_kwargs: Mapping[str, Any] = ...,
        ):
            ...

    @util.memoized_property
    def sql_compiler(self):
        return self.dialect.statement_compiler(
            self.dialect, None, schema_translate_map=self.schema_translate_map
        )

    @util.memoized_property
    def type_compiler(self):
        return self.dialect.type_compiler_instance

    def construct_params(
        self,
        params: Optional[_CoreSingleExecuteParams] = None,
        extracted_parameters: Optional[Sequence[BindParameter[Any]]] = None,
        escape_names: bool = True,
    ) -> Optional[_MutableCoreSingleExecuteParams]:
        return None

    def visit_ddl(self, ddl, **kwargs):
        # table events can substitute table and schema name
        context = ddl.context
        if isinstance(ddl.target, schema.Table):
            context = context.copy()

            preparer = self.preparer
            path = preparer.format_table_seq(ddl.target)
            if len(path) == 1:
                table, sch = path[0], ""
            else:
                table, sch = path[-1], path[0]

            context.setdefault("table", table)
            context.setdefault("schema", sch)
            context.setdefault("fullname", preparer.format_table(ddl.target))

        return self.sql_compiler.post_process_text(ddl.statement % context)

    def visit_create_schema(self, create, **kw):
        text = "CREATE SCHEMA "
        if create.if_not_exists:
            text += "IF NOT EXISTS "
        return text + self.preparer.format_schema(create.element)

    def visit_drop_schema(self, drop, **kw):
        text = "DROP SCHEMA "
        if drop.if_exists:
            text += "IF EXISTS "
        text += self.preparer.format_schema(drop.element)
        if drop.cascade:
            text += " CASCADE"
        return text

    def visit_create_table(self, create, **kw):
        table = create.element
        preparer = self.preparer

        text = "\nCREATE "
        if table._prefixes:
            text += " ".join(table._prefixes) + " "

        text += "TABLE "
        if create.if_not_exists:
            text += "IF NOT EXISTS "

        text += preparer.format_table(table) + " "

        create_table_suffix = self.create_table_suffix(table)
        if create_table_suffix:
            text += create_table_suffix + " "

        text += "("

        separator = "\n"

        # if only one primary key, specify it along with the column
        first_pk = False
        for create_column in create.columns:
            column = create_column.element
            try:
                processed = self.process(
                    create_column, first_pk=column.primary_key and not first_pk
                )
                if processed is not None:
                    text += separator
                    separator = ", \n"
                    text += "\t" + processed
                if column.primary_key:
                    first_pk = True
            except exc.CompileError as ce:
                raise exc.CompileError(
                    "(in table '%s', column '%s'): %s"
                    % (table.description, column.name, ce.args[0])
                ) from ce

        const = self.create_table_constraints(
            table,
            _include_foreign_key_constraints=create.include_foreign_key_constraints,  # noqa
        )
        if const:
            text += separator + "\t" + const

        text += "\n)%s\n\n" % self.post_create_table(table)
        return text

    def visit_create_column(self, create, first_pk=False, **kw):
        column = create.element

        if column.system:
            return None

        text = self.get_column_specification(column, first_pk=first_pk)
        const = " ".join(
            self.process(constraint) for constraint in column.constraints
        )
        if const:
            text += " " + const

        return text

    def create_table_constraints(
        self, table, _include_foreign_key_constraints=None, **kw
    ):
        # On some DB order is significant: visit PK first, then the
        # other constraints (engine.ReflectionTest.testbasic failed on FB2)
        constraints = []
        if table.primary_key:
            constraints.append(table.primary_key)

        all_fkcs = table.foreign_key_constraints
        if _include_foreign_key_constraints is not None:
            omit_fkcs = all_fkcs.difference(_include_foreign_key_constraints)
        else:
            omit_fkcs = set()

        constraints.extend(
            [
                c
                for c in table._sorted_constraints
                if c is not table.primary_key and c not in omit_fkcs
            ]
        )

        return ", \n\t".join(
            p
            for p in (
                self.process(constraint)
                for constraint in constraints
                if (constraint._should_create_for_compiler(self))
                and (
                    not self.dialect.supports_alter
                    or not getattr(constraint, "use_alter", False)
                )
            )
            if p is not None
        )

    def visit_drop_table(self, drop, **kw):
        text = "\nDROP TABLE "
        if drop.if_exists:
            text += "IF EXISTS "
        return text + self.preparer.format_table(drop.element)

    def visit_drop_view(self, drop, **kw):
        return "\nDROP VIEW " + self.preparer.format_table(drop.element)

    def _verify_index_table(self, index):
        if index.table is None:
            raise exc.CompileError(
                "Index '%s' is not associated " "with any table." % index.name
            )

    def visit_create_index(
        self, create, include_schema=False, include_table_schema=True, **kw
    ):
        index = create.element
        self._verify_index_table(index)
        preparer = self.preparer
        text = "CREATE "
        if index.unique:
            text += "UNIQUE "
        if index.name is None:
            raise exc.CompileError(
                "CREATE INDEX requires that the index have a name"
            )

        text += "INDEX "
        if create.if_not_exists:
            text += "IF NOT EXISTS "

        text += "%s ON %s (%s)" % (
            self._prepared_index_name(index, include_schema=include_schema),
            preparer.format_table(
                index.table, use_schema=include_table_schema
            ),
            ", ".join(
                self.sql_compiler.process(
                    expr, include_table=False, literal_binds=True
                )
                for expr in index.expressions
            ),
        )
        return text

    def visit_drop_index(self, drop, **kw):
        index = drop.element

        if index.name is None:
            raise exc.CompileError(
                "DROP INDEX requires that the index have a name"
            )
        text = "\nDROP INDEX "
        if drop.if_exists:
            text += "IF EXISTS "

        return text + self._prepared_index_name(index, include_schema=True)

    def _prepared_index_name(self, index, include_schema=False):
        if index.table is not None:
            effective_schema = self.preparer.schema_for_object(index.table)
        else:
            effective_schema = None
        if include_schema and effective_schema:
            schema_name = self.preparer.quote_schema(effective_schema)
        else:
            schema_name = None

        index_name = self.preparer.format_index(index)

        if schema_name:
            index_name = schema_name + "." + index_name
        return index_name

    def visit_add_constraint(self, create, **kw):
        return "ALTER TABLE %s ADD %s" % (
            self.preparer.format_table(create.element.table),
            self.process(create.element),
        )

    def visit_set_table_comment(self, create, **kw):
        return "COMMENT ON TABLE %s IS %s" % (
            self.preparer.format_table(create.element),
            self.sql_compiler.render_literal_value(
                create.element.comment, sqltypes.String()
            ),
        )

    def visit_drop_table_comment(self, drop, **kw):
        return "COMMENT ON TABLE %s IS NULL" % self.preparer.format_table(
            drop.element
        )

    def visit_set_column_comment(self, create, **kw):
        return "COMMENT ON COLUMN %s IS %s" % (
            self.preparer.format_column(
                create.element, use_table=True, use_schema=True
            ),
            self.sql_compiler.render_literal_value(
                create.element.comment, sqltypes.String()
            ),
        )

    def visit_drop_column_comment(self, drop, **kw):
        return "COMMENT ON COLUMN %s IS NULL" % self.preparer.format_column(
            drop.element, use_table=True
        )

    def visit_set_constraint_comment(self, create, **kw):
        raise exc.UnsupportedCompilationError(self, type(create))

    def visit_drop_constraint_comment(self, drop, **kw):
        raise exc.UnsupportedCompilationError(self, type(drop))

    def get_identity_options(self, identity_options):
        text = []
        if identity_options.increment is not None:
            text.append("INCREMENT BY %d" % identity_options.increment)
        if identity_options.start is not None:
            text.append("START WITH %d" % identity_options.start)
        if identity_options.minvalue is not None:
            text.append("MINVALUE %d" % identity_options.minvalue)
        if identity_options.maxvalue is not None:
            text.append("MAXVALUE %d" % identity_options.maxvalue)
        if identity_options.nominvalue is not None:
            text.append("NO MINVALUE")
        if identity_options.nomaxvalue is not None:
            text.append("NO MAXVALUE")
        if identity_options.cache is not None:
            text.append("CACHE %d" % identity_options.cache)
        if identity_options.cycle is not None:
            text.append("CYCLE" if identity_options.cycle else "NO CYCLE")
        return " ".join(text)

    def visit_create_sequence(self, create, prefix=None, **kw):
        text = "CREATE SEQUENCE "
        if create.if_not_exists:
            text += "IF NOT EXISTS "
        text += self.preparer.format_sequence(create.element)

        if prefix:
            text += prefix
        options = self.get_identity_options(create.element)
        if options:
            text += " " + options
        return text

    def visit_drop_sequence(self, drop, **kw):
        text = "DROP SEQUENCE "
        if drop.if_exists:
            text += "IF EXISTS "
        return text + self.preparer.format_sequence(drop.element)

    def visit_drop_constraint(self, drop, **kw):
        constraint = drop.element
        if constraint.name is not None:
            formatted_name = self.preparer.format_constraint(constraint)
        else:
            formatted_name = None

        if formatted_name is None:
            raise exc.CompileError(
                "Can't emit DROP CONSTRAINT for constraint %r; "
                "it has no name" % drop.element
            )
        return "ALTER TABLE %s DROP CONSTRAINT %s%s%s" % (
            self.preparer.format_table(drop.element.table),
            "IF EXISTS " if drop.if_exists else "",
            formatted_name,
            " CASCADE" if drop.cascade else "",
        )

    def get_column_specification(self, column, **kwargs):
        colspec = (
            self.preparer.format_column(column)
            + " "
            + self.dialect.type_compiler_instance.process(
                column.type, type_expression=column
            )
        )
        default = self.get_column_default_string(column)
        if default is not None:
            colspec += " DEFAULT " + default

        if column.computed is not None:
            colspec += " " + self.process(column.computed)

        if (
            column.identity is not None
            and self.dialect.supports_identity_columns
        ):
            colspec += " " + self.process(column.identity)

        if not column.nullable and (
            not column.identity or not self.dialect.supports_identity_columns
        ):
            colspec += " NOT NULL"
        return colspec

    def create_table_suffix(self, table):
        return ""

    def post_create_table(self, table):
        return ""

    def get_column_default_string(self, column):
        if isinstance(column.server_default, schema.DefaultClause):
            return self.render_default_string(column.server_default.arg)
        else:
            return None

    def render_default_string(self, default):
        if isinstance(default, str):
            return self.sql_compiler.render_literal_value(
                default, sqltypes.STRINGTYPE
            )
        else:
            return self.sql_compiler.process(default, literal_binds=True)

    def visit_table_or_column_check_constraint(self, constraint, **kw):
        if constraint.is_column_level:
            return self.visit_column_check_constraint(constraint)
        else:
            return self.visit_check_constraint(constraint)

    def visit_check_constraint(self, constraint, **kw):
        text = ""
        if constraint.name is not None:
            formatted_name = self.preparer.format_constraint(constraint)
            if formatted_name is not None:
                text += "CONSTRAINT %s " % formatted_name
        text += "CHECK (%s)" % self.sql_compiler.process(
            constraint.sqltext, include_table=False, literal_binds=True
        )
        text += self.define_constraint_deferrability(constraint)
        return text

    def visit_column_check_constraint(self, constraint, **kw):
        text = ""
        if constraint.name is not None:
            formatted_name = self.preparer.format_constraint(constraint)
            if formatted_name is not None:
                text += "CONSTRAINT %s " % formatted_name
        text += "CHECK (%s)" % self.sql_compiler.process(
            constraint.sqltext, include_table=False, literal_binds=True
        )
        text += self.define_constraint_deferrability(constraint)
        return text

    def visit_primary_key_constraint(self, constraint, **kw):
        if len(constraint) == 0:
            return ""
        text = ""
        if constraint.name is not None:
            formatted_name = self.preparer.format_constraint(constraint)
            if formatted_name is not None:
                text += "CONSTRAINT %s " % formatted_name
        text += "PRIMARY KEY "
        text += "(%s)" % ", ".join(
            self.preparer.quote(c.name)
            for c in (
                constraint.columns_autoinc_first
                if constraint._implicit_generated
                else constraint.columns
            )
        )
        text += self.define_constraint_deferrability(constraint)
        return text

    def visit_foreign_key_constraint(self, constraint, **kw):
        preparer = self.preparer
        text = ""
        if constraint.name is not None:
            formatted_name = self.preparer.format_constraint(constraint)
            if formatted_name is not None:
                text += "CONSTRAINT %s " % formatted_name
        remote_table = list(constraint.elements)[0].column.table
        text += "FOREIGN KEY(%s) REFERENCES %s (%s)" % (
            ", ".join(
                preparer.quote(f.parent.name) for f in constraint.elements
            ),
            self.define_constraint_remote_table(
                constraint, remote_table, preparer
            ),
            ", ".join(
                preparer.quote(f.column.name) for f in constraint.elements
            ),
        )
        text += self.define_constraint_match(constraint)
        text += self.define_constraint_cascades(constraint)
        text += self.define_constraint_deferrability(constraint)
        return text

    def define_constraint_remote_table(self, constraint, table, preparer):
        """Format the remote table clause of a CREATE CONSTRAINT clause."""

        return preparer.format_table(table)

    def visit_unique_constraint(self, constraint, **kw):
        if len(constraint) == 0:
            return ""
        text = ""
        if constraint.name is not None:
            formatted_name = self.preparer.format_constraint(constraint)
            if formatted_name is not None:
                text += "CONSTRAINT %s " % formatted_name
        text += "UNIQUE %s(%s)" % (
            self.define_unique_constraint_distinct(constraint, **kw),
            ", ".join(self.preparer.quote(c.name) for c in constraint),
        )
        text += self.define_constraint_deferrability(constraint)
        return text

    def define_unique_constraint_distinct(self, constraint, **kw):
        return ""

    def define_constraint_cascades(self, constraint):
        text = ""
        if constraint.ondelete is not None:
            text += " ON DELETE %s" % self.preparer.validate_sql_phrase(
                constraint.ondelete, FK_ON_DELETE
            )
        if constraint.onupdate is not None:
            text += " ON UPDATE %s" % self.preparer.validate_sql_phrase(
                constraint.onupdate, FK_ON_UPDATE
            )
        return text

    def define_constraint_deferrability(self, constraint):
        text = ""
        if constraint.deferrable is not None:
            if constraint.deferrable:
                text += " DEFERRABLE"
            else:
                text += " NOT DEFERRABLE"
        if constraint.initially is not None:
            text += " INITIALLY %s" % self.preparer.validate_sql_phrase(
                constraint.initially, FK_INITIALLY
            )
        return text

    def define_constraint_match(self, constraint):
        text = ""
        if constraint.match is not None:
            text += " MATCH %s" % constraint.match
        return text

    def visit_computed_column(self, generated, **kw):
        text = "GENERATED ALWAYS AS (%s)" % self.sql_compiler.process(
            generated.sqltext, include_table=False, literal_binds=True
        )
        if generated.persisted is True:
            text += " STORED"
        elif generated.persisted is False:
            text += " VIRTUAL"
        return text

    def visit_identity_column(self, identity, **kw):
        text = "GENERATED %s AS IDENTITY" % (
            "ALWAYS" if identity.always else "BY DEFAULT",
        )
        options = self.get_identity_options(identity)
        if options:
            text += " (%s)" % options
        return text


class GenericTypeCompiler(TypeCompiler):
    def visit_FLOAT(self, type_, **kw):
        return "FLOAT"

    def visit_DOUBLE(self, type_, **kw):
        return "DOUBLE"

    def visit_DOUBLE_PRECISION(self, type_, **kw):
        return "DOUBLE PRECISION"

    def visit_REAL(self, type_, **kw):
        return "REAL"

    def visit_NUMERIC(self, type_, **kw):
        if type_.precision is None:
            return "NUMERIC"
        elif type_.scale is None:
            return "NUMERIC(%(precision)s)" % {"precision": type_.precision}
        else:
            return "NUMERIC(%(precision)s, %(scale)s)" % {
                "precision": type_.precision,
                "scale": type_.scale,
            }

    def visit_DECIMAL(self, type_, **kw):
        if type_.precision is None:
            return "DECIMAL"
        elif type_.scale is None:
            return "DECIMAL(%(precision)s)" % {"precision": type_.precision}
        else:
            return "DECIMAL(%(precision)s, %(scale)s)" % {
                "precision": type_.precision,
                "scale": type_.scale,
            }

    def visit_INTEGER(self, type_, **kw):
        return "INTEGER"

    def visit_SMALLINT(self, type_, **kw):
        return "SMALLINT"

    def visit_BIGINT(self, type_, **kw):
        return "BIGINT"

    def visit_TIMESTAMP(self, type_, **kw):
        return "TIMESTAMP"

    def visit_DATETIME(self, type_, **kw):
        return "DATETIME"

    def visit_DATE(self, type_, **kw):
        return "DATE"

    def visit_TIME(self, type_, **kw):
        return "TIME"

    def visit_CLOB(self, type_, **kw):
        return "CLOB"

    def visit_NCLOB(self, type_, **kw):
        return "NCLOB"

    def _render_string_type(self, type_, name, length_override=None):
        text = name
        if length_override:
            text += "(%d)" % length_override
        elif type_.length:
            text += "(%d)" % type_.length
        if type_.collation:
            text += ' COLLATE "%s"' % type_.collation
        return text

    def visit_CHAR(self, type_, **kw):
        return self._render_string_type(type_, "CHAR")

    def visit_NCHAR(self, type_, **kw):
        return self._render_string_type(type_, "NCHAR")

    def visit_VARCHAR(self, type_, **kw):
        return self._render_string_type(type_, "VARCHAR")

    def visit_NVARCHAR(self, type_, **kw):
        return self._render_string_type(type_, "NVARCHAR")

    def visit_TEXT(self, type_, **kw):
        return self._render_string_type(type_, "TEXT")

    def visit_BLOB(self, type_, **kw):
        return "BLOB"

    def visit_BINARY(self, type_, **kw):
        return "BINARY" + (type_.length and "(%d)" % type_.length or "")

    def visit_VARBINARY(self, type_, **kw):
        return "VARBINARY" + (type_.length and "(%d)" % type_.length or "")

    def visit_BOOLEAN(self, type_, **kw):
        return "BOOLEAN"

    def visit_uuid(self, type_, **kw):
        return self._render_string_type(type_, "CHAR", length_override=32)

    def visit_large_binary(self, type_, **kw):
        return self.visit_BLOB(type_, **kw)

    def visit_boolean(self, type_, **kw):
        return self.visit_BOOLEAN(type_, **kw)

    def visit_time(self, type_, **kw):
        return self.visit_TIME(type_, **kw)

    def visit_datetime(self, type_, **kw):
        return self.visit_DATETIME(type_, **kw)

    def visit_date(self, type_, **kw):
        return self.visit_DATE(type_, **kw)

    def visit_big_integer(self, type_, **kw):
        return self.visit_BIGINT(type_, **kw)

    def visit_small_integer(self, type_, **kw):
        return self.visit_SMALLINT(type_, **kw)

    def visit_integer(self, type_, **kw):
        return self.visit_INTEGER(type_, **kw)

    def visit_real(self, type_, **kw):
        return self.visit_REAL(type_, **kw)

    def visit_float(self, type_, **kw):
        return self.visit_FLOAT(type_, **kw)

    def visit_double(self, type_, **kw):
        return self.visit_DOUBLE(type_, **kw)

    def visit_numeric(self, type_, **kw):
        return self.visit_NUMERIC(type_, **kw)

    def visit_string(self, type_, **kw):
        return self.visit_VARCHAR(type_, **kw)

    def visit_unicode(self, type_, **kw):
        return self.visit_VARCHAR(type_, **kw)

    def visit_text(self, type_, **kw):
        return self.visit_TEXT(type_, **kw)

    def visit_unicode_text(self, type_, **kw):
        return self.visit_TEXT(type_, **kw)

    def visit_enum(self, type_, **kw):
        return self.visit_VARCHAR(type_, **kw)

    def visit_null(self, type_, **kw):
        raise exc.CompileError(
            "Can't generate DDL for %r; "
            "did you forget to specify a "
            "type on this Column?" % type_
        )

    def visit_type_decorator(self, type_, **kw):
        return self.process(type_.type_engine(self.dialect), **kw)

    def visit_user_defined(self, type_, **kw):
        return type_.get_col_spec(**kw)


class StrSQLTypeCompiler(GenericTypeCompiler):
    def process(self, type_, **kw):
        try:
            _compiler_dispatch = type_._compiler_dispatch
        except AttributeError:
            return self._visit_unknown(type_, **kw)
        else:
            return _compiler_dispatch(self, **kw)

    def __getattr__(self, key):
        if key.startswith("visit_"):
            return self._visit_unknown
        else:
            raise AttributeError(key)

    def _visit_unknown(self, type_, **kw):
        if type_.__class__.__name__ == type_.__class__.__name__.upper():
            return type_.__class__.__name__
        else:
            return repr(type_)

    def visit_null(self, type_, **kw):
        return "NULL"

    def visit_user_defined(self, type_, **kw):
        try:
            get_col_spec = type_.get_col_spec
        except AttributeError:
            return repr(type_)
        else:
            return get_col_spec(**kw)


class _SchemaForObjectCallable(Protocol):
    def __call__(self, obj: Any) -> str:
        ...


class _BindNameForColProtocol(Protocol):
    def __call__(self, col: ColumnClause[Any]) -> str:
        ...


class IdentifierPreparer:

    """Handle quoting and case-folding of identifiers based on options."""

    reserved_words = RESERVED_WORDS

    legal_characters = LEGAL_CHARACTERS

    illegal_initial_characters = ILLEGAL_INITIAL_CHARACTERS

    initial_quote: str

    final_quote: str

    _strings: MutableMapping[str, str]

    schema_for_object: _SchemaForObjectCallable = operator.attrgetter("schema")
    """Return the .schema attribute for an object.

    For the default IdentifierPreparer, the schema for an object is always
    the value of the ".schema" attribute.   if the preparer is replaced
    with one that has a non-empty schema_translate_map, the value of the
    ".schema" attribute is rendered a symbol that will be converted to a
    real schema name from the mapping post-compile.

    """

    _includes_none_schema_translate: bool = False

    def __init__(
        self,
        dialect,
        initial_quote='"',
        final_quote=None,
        escape_quote='"',
        quote_case_sensitive_collations=True,
        omit_schema=False,
    ):
        """Construct a new ``IdentifierPreparer`` object.

        initial_quote
          Character that begins a delimited identifier.

        final_quote
          Character that ends a delimited identifier. Defaults to
          `initial_quote`.

        omit_schema
          Prevent prepending schema name. Useful for databases that do
          not support schemae.
        """

        self.dialect = dialect
        self.initial_quote = initial_quote
        self.final_quote = final_quote or self.initial_quote
        self.escape_quote = escape_quote
        self.escape_to_quote = self.escape_quote * 2
        self.omit_schema = omit_schema
        self.quote_case_sensitive_collations = quote_case_sensitive_collations
        self._strings = {}
        self._double_percents = self.dialect.paramstyle in (
            "format",
            "pyformat",
        )

    def _with_schema_translate(self, schema_translate_map):
        prep = self.__class__.__new__(self.__class__)
        prep.__dict__.update(self.__dict__)

        includes_none = None in schema_translate_map

        def symbol_getter(obj):
            name = obj.schema
            if obj._use_schema_map and (name is not None or includes_none):
                if name is not None and ("[" in name or "]" in name):
                    raise exc.CompileError(
                        "Square bracket characters ([]) not supported "
                        "in schema translate name '%s'" % name
                    )
                return quoted_name(
                    "__[SCHEMA_%s]" % (name or "_none"), quote=False
                )
            else:
                return obj.schema

        prep.schema_for_object = symbol_getter
        prep._includes_none_schema_translate = includes_none
        return prep

    def _render_schema_translates(self, statement, schema_translate_map):
        d = schema_translate_map
        if None in d:
            if not self._includes_none_schema_translate:
                raise exc.InvalidRequestError(
                    "schema translate map which previously did not have "
                    "`None` present as a key now has `None` present; compiled "
                    "statement may lack adequate placeholders.  Please use "
                    "consistent keys in successive "
                    "schema_translate_map dictionaries."
                )

            d["_none"] = d[None]

        def replace(m):
            name = m.group(2)
            if name in d:
                effective_schema = d[name]
            else:
                if name in (None, "_none"):
                    raise exc.InvalidRequestError(
                        "schema translate map which previously had `None` "
                        "present as a key now no longer has it present; don't "
                        "know how to apply schema for compiled statement. "
                        "Please use consistent keys in successive "
                        "schema_translate_map dictionaries."
                    )
                effective_schema = name

            if not effective_schema:
                effective_schema = self.dialect.default_schema_name
                if not effective_schema:
                    # TODO: no coverage here
                    raise exc.CompileError(
                        "Dialect has no default schema name; can't "
                        "use None as dynamic schema target."
                    )
            return self.quote_schema(effective_schema)

        return re.sub(r"(__\[SCHEMA_([^\]]+)\])", replace, statement)

    def _escape_identifier(self, value: str) -> str:
        """Escape an identifier.

        Subclasses should override this to provide database-dependent
        escaping behavior.
        """

        value = value.replace(self.escape_quote, self.escape_to_quote)
        if self._double_percents:
            value = value.replace("%", "%%")
        return value

    def _unescape_identifier(self, value: str) -> str:
        """Canonicalize an escaped identifier.

        Subclasses should override this to provide database-dependent
        unescaping behavior that reverses _escape_identifier.
        """

        return value.replace(self.escape_to_quote, self.escape_quote)

    def validate_sql_phrase(self, element, reg):
        """keyword sequence filter.

        a filter for elements that are intended to represent keyword sequences,
        such as "INITIALLY", "INITIALLY DEFERRED", etc.   no special characters
        should be present.

        .. versionadded:: 1.3

        """

        if element is not None and not reg.match(element):
            raise exc.CompileError(
                "Unexpected SQL phrase: %r (matching against %r)"
                % (element, reg.pattern)
            )
        return element

    def quote_identifier(self, value: str) -> str:
        """Quote an identifier.

        Subclasses should override this to provide database-dependent
        quoting behavior.
        """

        return (
            self.initial_quote
            + self._escape_identifier(value)
            + self.final_quote
        )

    def _requires_quotes(self, value: str) -> bool:
        """Return True if the given identifier requires quoting."""
        lc_value = value.lower()
        return (
            lc_value in self.reserved_words
            or value[0] in self.illegal_initial_characters
            or not self.legal_characters.match(str(value))
            or (lc_value != value)
        )

    def _requires_quotes_illegal_chars(self, value):
        """Return True if the given identifier requires quoting, but
        not taking case convention into account."""
        return not self.legal_characters.match(str(value))

    def quote_schema(self, schema: str, force: Any = None) -> str:
        """Conditionally quote a schema name.


        The name is quoted if it is a reserved word, contains quote-necessary
        characters, or is an instance of :class:`.quoted_name` which includes
        ``quote`` set to ``True``.

        Subclasses can override this to provide database-dependent
        quoting behavior for schema names.

        :param schema: string schema name
        :param force: unused

            .. deprecated:: 0.9

                The :paramref:`.IdentifierPreparer.quote_schema.force`
                parameter is deprecated and will be removed in a future
                release.  This flag has no effect on the behavior of the
                :meth:`.IdentifierPreparer.quote` method; please refer to
                :class:`.quoted_name`.

        """
        if force is not None:
            # not using the util.deprecated_params() decorator in this
            # case because of the additional function call overhead on this
            # very performance-critical spot.
            util.warn_deprecated(
                "The IdentifierPreparer.quote_schema.force parameter is "
                "deprecated and will be removed in a future release.  This "
                "flag has no effect on the behavior of the "
                "IdentifierPreparer.quote method; please refer to "
                "quoted_name().",
                # deprecated 0.9. warning from 1.3
                version="0.9",
            )

        return self.quote(schema)

    def quote(self, ident: str, force: Any = None) -> str:
        """Conditionally quote an identifier.

        The identifier is quoted if it is a reserved word, contains
        quote-necessary characters, or is an instance of
        :class:`.quoted_name` which includes ``quote`` set to ``True``.

        Subclasses can override this to provide database-dependent
        quoting behavior for identifier names.

        :param ident: string identifier
        :param force: unused

            .. deprecated:: 0.9

                The :paramref:`.IdentifierPreparer.quote.force`
                parameter is deprecated and will be removed in a future
                release.  This flag has no effect on the behavior of the
                :meth:`.IdentifierPreparer.quote` method; please refer to
                :class:`.quoted_name`.

        """
        if force is not None:
            # not using the util.deprecated_params() decorator in this
            # case because of the additional function call overhead on this
            # very performance-critical spot.
            util.warn_deprecated(
                "The IdentifierPreparer.quote.force parameter is "
                "deprecated and will be removed in a future release.  This "
                "flag has no effect on the behavior of the "
                "IdentifierPreparer.quote method; please refer to "
                "quoted_name().",
                # deprecated 0.9. warning from 1.3
                version="0.9",
            )

        force = getattr(ident, "quote", None)

        if force is None:
            if ident in self._strings:
                return self._strings[ident]
            else:
                if self._requires_quotes(ident):
                    self._strings[ident] = self.quote_identifier(ident)
                else:
                    self._strings[ident] = ident
                return self._strings[ident]
        elif force:
            return self.quote_identifier(ident)
        else:
            return ident

    def format_collation(self, collation_name):
        if self.quote_case_sensitive_collations:
            return self.quote(collation_name)
        else:
            return collation_name

    def format_sequence(self, sequence, use_schema=True):
        name = self.quote(sequence.name)

        effective_schema = self.schema_for_object(sequence)

        if (
            not self.omit_schema
            and use_schema
            and effective_schema is not None
        ):
            name = self.quote_schema(effective_schema) + "." + name
        return name

    def format_label(
        self, label: Label[Any], name: Optional[str] = None
    ) -> str:
        return self.quote(name or label.name)

    def format_alias(
        self, alias: Optional[AliasedReturnsRows], name: Optional[str] = None
    ) -> str:
        if name is None:
            assert alias is not None
            return self.quote(alias.name)
        else:
            return self.quote(name)

    def format_savepoint(self, savepoint, name=None):
        # Running the savepoint name through quoting is unnecessary
        # for all known dialects.  This is here to support potential
        # third party use cases
        ident = name or savepoint.ident
        if self._requires_quotes(ident):
            ident = self.quote_identifier(ident)
        return ident

    @util.preload_module("sqlalchemy.sql.naming")
    def format_constraint(self, constraint, _alembic_quote=True):
        naming = util.preloaded.sql_naming

        if constraint.name is _NONE_NAME:
            name = naming._constraint_name_for_table(
                constraint, constraint.table
            )

            if name is None:
                return None
        else:
            name = constraint.name

        if constraint.__visit_name__ == "index":
            return self.truncate_and_render_index_name(
                name, _alembic_quote=_alembic_quote
            )
        else:
            return self.truncate_and_render_constraint_name(
                name, _alembic_quote=_alembic_quote
            )

    def truncate_and_render_index_name(self, name, _alembic_quote=True):
        # calculate these at format time so that ad-hoc changes
        # to dialect.max_identifier_length etc. can be reflected
        # as IdentifierPreparer is long lived
        max_ = (
            self.dialect.max_index_name_length
            or self.dialect.max_identifier_length
        )
        return self._truncate_and_render_maxlen_name(
            name, max_, _alembic_quote
        )

    def truncate_and_render_constraint_name(self, name, _alembic_quote=True):
        # calculate these at format time so that ad-hoc changes
        # to dialect.max_identifier_length etc. can be reflected
        # as IdentifierPreparer is long lived
        max_ = (
            self.dialect.max_constraint_name_length
            or self.dialect.max_identifier_length
        )
        return self._truncate_and_render_maxlen_name(
            name, max_, _alembic_quote
        )

    def _truncate_and_render_maxlen_name(self, name, max_, _alembic_quote):
        if isinstance(name, elements._truncated_label):
            if len(name) > max_:
                name = name[0 : max_ - 8] + "_" + util.md5_hex(name)[-4:]
        else:
            self.dialect.validate_identifier(name)

        if not _alembic_quote:
            return name
        else:
            return self.quote(name)

    def format_index(self, index):
        return self.format_constraint(index)

    def format_table(self, table, use_schema=True, name=None):
        """Prepare a quoted table and schema name."""

        if name is None:
            name = table.name

        result = self.quote(name)

        effective_schema = self.schema_for_object(table)

        if not self.omit_schema and use_schema and effective_schema:
            result = self.quote_schema(effective_schema) + "." + result
        return result

    def format_schema(self, name):
        """Prepare a quoted schema name."""

        return self.quote(name)

    def format_label_name(
        self,
        name,
        anon_map=None,
    ):
        """Prepare a quoted column name."""

        if anon_map is not None and isinstance(
            name, elements._truncated_label
        ):
            name = name.apply_map(anon_map)

        return self.quote(name)

    def format_column(
        self,
        column,
        use_table=False,
        name=None,
        table_name=None,
        use_schema=False,
        anon_map=None,
    ):
        """Prepare a quoted column name."""

        if name is None:
            name = column.name

        if anon_map is not None and isinstance(
            name, elements._truncated_label
        ):
            name = name.apply_map(anon_map)

        if not getattr(column, "is_literal", False):
            if use_table:
                return (
                    self.format_table(
                        column.table, use_schema=use_schema, name=table_name
                    )
                    + "."
                    + self.quote(name)
                )
            else:
                return self.quote(name)
        else:
            # literal textual elements get stuck into ColumnClause a lot,
            # which shouldn't get quoted

            if use_table:
                return (
                    self.format_table(
                        column.table, use_schema=use_schema, name=table_name
                    )
                    + "."
                    + name
                )
            else:
                return name

    def format_table_seq(self, table, use_schema=True):
        """Format table name and schema as a tuple."""

        # Dialects with more levels in their fully qualified references
        # ('database', 'owner', etc.) could override this and return
        # a longer sequence.

        effective_schema = self.schema_for_object(table)

        if not self.omit_schema and use_schema and effective_schema:
            return (
                self.quote_schema(effective_schema),
                self.format_table(table, use_schema=False),
            )
        else:
            return (self.format_table(table, use_schema=False),)

    @util.memoized_property
    def _r_identifiers(self):
        initial, final, escaped_final = (
            re.escape(s)
            for s in (
                self.initial_quote,
                self.final_quote,
                self._escape_identifier(self.final_quote),
            )
        )
        r = re.compile(
            r"(?:"
            r"(?:%(initial)s((?:%(escaped)s|[^%(final)s])+)%(final)s"
            r"|([^\.]+))(?=\.|$))+"
            % {"initial": initial, "final": final, "escaped": escaped_final}
        )
        return r

    def unformat_identifiers(self, identifiers):
        """Unpack 'schema.table.column'-like strings into components."""

        r = self._r_identifiers
        return [
            self._unescape_identifier(i)
            for i in [a or b for a, b in r.findall(identifiers)]
        ]
