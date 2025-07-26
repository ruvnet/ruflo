# engine/interfaces.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Define core interfaces used by the engine system."""

from __future__ import annotations

from enum import Enum
from types import ModuleType
from typing import Any
from typing import Awaitable
from typing import Callable
from typing import ClassVar
from typing import Collection
from typing import Dict
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import MutableMapping
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from .. import util
from ..event import EventTarget
from ..pool import Pool
from ..pool import PoolProxiedConnection
from ..sql.compiler import Compiled as Compiled
from ..sql.compiler import Compiled  # noqa
from ..sql.compiler import TypeCompiler as TypeCompiler
from ..sql.compiler import TypeCompiler  # noqa
from ..util import immutabledict
from ..util.concurrency import await_only
from ..util.typing import Literal
from ..util.typing import NotRequired
from ..util.typing import Protocol
from ..util.typing import TypedDict

if TYPE_CHECKING:
    from .base import Connection
    from .base import Engine
    from .cursor import CursorResult
    from .url import URL
    from ..event import _ListenerFnType
    from ..event import dispatcher
    from ..exc import StatementError
    from ..sql import Executable
    from ..sql.compiler import _InsertManyValuesBatch
    from ..sql.compiler import DDLCompiler
    from ..sql.compiler import IdentifierPreparer
    from ..sql.compiler import InsertmanyvaluesSentinelOpts
    from ..sql.compiler import Linting
    from ..sql.compiler import SQLCompiler
    from ..sql.elements import BindParameter
    from ..sql.elements import ClauseElement
    from ..sql.schema import Column
    from ..sql.schema import DefaultGenerator
    from ..sql.schema import SchemaItem
    from ..sql.schema import Sequence as Sequence_SchemaItem
    from ..sql.sqltypes import Integer
    from ..sql.type_api import _TypeMemoDict
    from ..sql.type_api import TypeEngine

ConnectArgsType = Tuple[Sequence[str], MutableMapping[str, Any]]

_T = TypeVar("_T", bound="Any")


class CacheStats(Enum):
    CACHE_HIT = 0
    CACHE_MISS = 1
    CACHING_DISABLED = 2
    NO_CACHE_KEY = 3
    NO_DIALECT_SUPPORT = 4


class ExecuteStyle(Enum):
    """indicates the :term:`DBAPI` cursor method that will be used to invoke
    a statement."""

    EXECUTE = 0
    """indicates cursor.execute() will be used"""

    EXECUTEMANY = 1
    """indicates cursor.executemany() will be used."""

    INSERTMANYVALUES = 2
    """indicates cursor.execute() will be used with an INSERT where the
    VALUES expression will be expanded to accommodate for multiple
    parameter sets

    .. seealso::

        :ref:`engine_insertmanyvalues`

    """


class DBAPIConnection(Protocol):
    """protocol representing a :pep:`249` database connection.

    .. versionadded:: 2.0

    .. seealso::

        `Connection Objects <https://www.python.org/dev/peps/pep-0249/#connection-objects>`_
        - in :pep:`249`

    """  # noqa: E501

    def close(self) -> None:
        ...

    def commit(self) -> None:
        ...

    def cursor(self) -> DBAPICursor:
        ...

    def rollback(self) -> None:
        ...

    autocommit: bool


class DBAPIType(Protocol):
    """protocol representing a :pep:`249` database type.

    .. versionadded:: 2.0

    .. seealso::

        `Type Objects <https://www.python.org/dev/peps/pep-0249/#type-objects>`_
        - in :pep:`249`

    """  # noqa: E501


class DBAPICursor(Protocol):
    """protocol representing a :pep:`249` database cursor.

    .. versionadded:: 2.0

    .. seealso::

        `Cursor Objects <https://www.python.org/dev/peps/pep-0249/#cursor-objects>`_
        - in :pep:`249`

    """  # noqa: E501

    @property
    def description(
        self,
    ) -> _DBAPICursorDescription:
        """The description attribute of the Cursor.

        .. seealso::

            `cursor.description <https://www.python.org/dev/peps/pep-0249/#description>`_
            - in :pep:`249`


        """  # noqa: E501
        ...

    @property
    def rowcount(self) -> int:
        ...

    arraysize: int

    lastrowid: int

    def close(self) -> None:
        ...

    def execute(
        self,
        operation: Any,
        parameters: Optional[_DBAPISingleExecuteParams] = None,
    ) -> Any:
        ...

    def executemany(
        self,
        operation: Any,
        parameters: _DBAPIMultiExecuteParams,
    ) -> Any:
        ...

    def fetchone(self) -> Optional[Any]:
        ...

    def fetchmany(self, size: int = ...) -> Sequence[Any]:
        ...

    def fetchall(self) -> Sequence[Any]:
        ...

    def setinputsizes(self, sizes: Sequence[Any]) -> None:
        ...

    def setoutputsize(self, size: Any, column: Any) -> None:
        ...

    def callproc(self, procname: str, parameters: Sequence[Any] = ...) -> Any:
        ...

    def nextset(self) -> Optional[bool]:
        ...

    def __getattr__(self, key: str) -> Any:
        ...


_CoreSingleExecuteParams = Mapping[str, Any]
_MutableCoreSingleExecuteParams = MutableMapping[str, Any]
_CoreMultiExecuteParams = Sequence[_CoreSingleExecuteParams]
_CoreAnyExecuteParams = Union[
    _CoreMultiExecuteParams, _CoreSingleExecuteParams
]

_DBAPISingleExecuteParams = Union[Sequence[Any], _CoreSingleExecuteParams]

_DBAPIMultiExecuteParams = Union[
    Sequence[Sequence[Any]], _CoreMultiExecuteParams
]
_DBAPIAnyExecuteParams = Union[
    _DBAPIMultiExecuteParams, _DBAPISingleExecuteParams
]
_DBAPICursorDescription = Sequence[
    Tuple[
        str,
        "DBAPIType",
        Optional[int],
        Optional[int],
        Optional[int],
        Optional[int],
        Optional[bool],
    ]
]

_AnySingleExecuteParams = _DBAPISingleExecuteParams
_AnyMultiExecuteParams = _DBAPIMultiExecuteParams
_AnyExecuteParams = _DBAPIAnyExecuteParams

CompiledCacheType = MutableMapping[Any, "Compiled"]
SchemaTranslateMapType = Mapping[Optional[str], Optional[str]]

_ImmutableExecuteOptions = immutabledict[str, Any]

_ParamStyle = Literal[
    "qmark", "numeric", "named", "format", "pyformat", "numeric_dollar"
]

_GenericSetInputSizesType = List[Tuple[str, Any, "TypeEngine[Any]"]]

IsolationLevel = Literal[
    "SERIALIZABLE",
    "REPEATABLE READ",
    "READ COMMITTED",
    "READ UNCOMMITTED",
    "AUTOCOMMIT",
]


class _CoreKnownExecutionOptions(TypedDict, total=False):
    compiled_cache: Optional[CompiledCacheType]
    logging_token: str
    isolation_level: IsolationLevel
    no_parameters: bool
    stream_results: bool
    max_row_buffer: int
    yield_per: int
    insertmanyvalues_page_size: int
    schema_translate_map: Optional[SchemaTranslateMapType]


_ExecuteOptions = immutabledict[str, Any]
CoreExecuteOptionsParameter = Union[
    _CoreKnownExecutionOptions, Mapping[str, Any]
]


class ReflectedIdentity(TypedDict):
    """represent the reflected IDENTITY structure of a column, corresponding
    to the :class:`_schema.Identity` construct.

    The :class:`.ReflectedIdentity` structure is part of the
    :class:`.ReflectedColumn` structure, which is returned by the
    :meth:`.Inspector.get_columns` method.

    """

    always: bool
    """type of identity column"""

    on_null: bool
    """indicates ON NULL"""

    start: int
    """starting index of the sequence"""

    increment: int
    """increment value of the sequence"""

    minvalue: int
    """the minimum value of the sequence."""

    maxvalue: int
    """the maximum value of the sequence."""

    nominvalue: bool
    """no minimum value of the sequence."""

    nomaxvalue: bool
    """no maximum value of the sequence."""

    cycle: bool
    """allows the sequence to wrap around when the maxvalue
    or minvalue has been reached."""

    cache: Optional[int]
    """number of future values in the
    sequence which are calculated in advance."""

    order: bool
    """if true, renders the ORDER keyword."""


class ReflectedComputed(TypedDict):
    """Represent the reflected elements of a computed column, corresponding
    to the :class:`_schema.Computed` construct.

    The :class:`.ReflectedComputed` structure is part of the
    :class:`.ReflectedColumn` structure, which is returned by the
    :meth:`.Inspector.get_columns` method.

    """

    sqltext: str
    """the expression used to generate this column returned
    as a string SQL expression"""

    persisted: NotRequired[bool]
    """indicates if the value is stored in the table or computed on demand"""


class ReflectedColumn(TypedDict):
    """Dictionary representing the reflected elements corresponding to
    a :class:`_schema.Column` object.

    The :class:`.ReflectedColumn` structure is returned by the
    :class:`.Inspector.get_columns` method.

    """

    name: str
    """column name"""

    type: TypeEngine[Any]
    """column type represented as a :class:`.TypeEngine` instance."""

    nullable: bool
    """boolean flag if the column is NULL or NOT NULL"""

    default: Optional[str]
    """column default expression as a SQL string"""

    autoincrement: NotRequired[bool]
    """database-dependent autoincrement flag.

    This flag indicates if the column has a database-side "autoincrement"
    flag of some kind.   Within SQLAlchemy, other kinds of columns may
    also act as an "autoincrement" column without necessarily having
    such a flag on them.

    See :paramref:`_schema.Column.autoincrement` for more background on
    "autoincrement".

    """

    comment: NotRequired[Optional[str]]
    """comment for the column, if present.
    Only some dialects return this key
    """

    computed: NotRequired[ReflectedComputed]
    """indicates that this column is computed by the database.
    Only some dialects return this key.

    .. versionadded:: 1.3.16 - added support for computed reflection.
    """

    identity: NotRequired[ReflectedIdentity]
    """indicates this column is an IDENTITY column.
    Only some dialects return this key.

    .. versionadded:: 1.4 - added support for identity column reflection.
    """

    dialect_options: NotRequired[Dict[str, Any]]
    """Additional dialect-specific options detected for this reflected
    object"""


class ReflectedConstraint(TypedDict):
    """Dictionary representing the reflected elements corresponding to
    :class:`.Constraint`

    A base class for all constraints
    """

    name: Optional[str]
    """constraint name"""

    comment: NotRequired[Optional[str]]
    """comment for the constraint, if present"""


class ReflectedCheckConstraint(ReflectedConstraint):
    """Dictionary representing the reflected elements corresponding to
    :class:`.CheckConstraint`.

    The :class:`.ReflectedCheckConstraint` structure is returned by the
    :meth:`.Inspector.get_check_constraints` method.

    """

    sqltext: str
    """the check constraint's SQL expression"""

    dialect_options: NotRequired[Dict[str, Any]]
    """Additional dialect-specific options detected for this check constraint

    .. versionadded:: 1.3.8
    """


class ReflectedUniqueConstraint(ReflectedConstraint):
    """Dictionary representing the reflected elements corresponding to
    :class:`.UniqueConstraint`.

    The :class:`.ReflectedUniqueConstraint` structure is returned by the
    :meth:`.Inspector.get_unique_constraints` method.

    """

    column_names: List[str]
    """column names which comprise the unique constraint"""

    duplicates_index: NotRequired[Optional[str]]
    "Indicates if this unique constraint duplicates an index with this name"

    dialect_options: NotRequired[Dict[str, Any]]
    """Additional dialect-specific options detected for this unique
    constraint"""


class ReflectedPrimaryKeyConstraint(ReflectedConstraint):
    """Dictionary representing the reflected elements corresponding to
    :class:`.PrimaryKeyConstraint`.

    The :class:`.ReflectedPrimaryKeyConstraint` structure is returned by the
    :meth:`.Inspector.get_pk_constraint` method.

    """

    constrained_columns: List[str]
    """column names which comprise the primary key"""

    dialect_options: NotRequired[Dict[str, Any]]
    """Additional dialect-specific options detected for this primary key"""


class ReflectedForeignKeyConstraint(ReflectedConstraint):
    """Dictionary representing the reflected elements corresponding to
    :class:`.ForeignKeyConstraint`.

    The :class:`.ReflectedForeignKeyConstraint` structure is returned by
    the :meth:`.Inspector.get_foreign_keys` method.

    """

    constrained_columns: List[str]
    """local column names which comprise the foreign key"""

    referred_schema: Optional[str]
    """schema name of the table being referred"""

    referred_table: str
    """name of the table being referred"""

    referred_columns: List[str]
    """referred column names that correspond to ``constrained_columns``"""

    options: NotRequired[Dict[str, Any]]
    """Additional options detected for this foreign key constraint"""


class ReflectedIndex(TypedDict):
    """Dictionary representing the reflected elements corresponding to
    :class:`.Index`.

    The :class:`.ReflectedIndex` structure is returned by the
    :meth:`.Inspector.get_indexes` method.

    """

    name: Optional[str]
    """index name"""

    column_names: List[Optional[str]]
    """column names which the index references.
    An element of this list is ``None`` if it's an expression and is
    returned in the ``expressions`` list.
    """

    expressions: NotRequired[List[str]]
    """Expressions that compose the index. This list, when present, contains
    both plain column names (that are also in ``column_names``) and
    expressions (that are ``None`` in ``column_names``).
    """

    unique: bool
    """whether or not the index has a unique flag"""

    duplicates_constraint: NotRequired[Optional[str]]
    "Indicates if this index mirrors a constraint with this name"

    include_columns: NotRequired[List[str]]
    """columns to include in the INCLUDE clause for supporting databases.

    .. deprecated:: 2.0

        Legacy value, will be replaced with
        ``index_dict["dialect_options"]["<dialect name>_include"]``

    """

    column_sorting: NotRequired[Dict[str, Tuple[str]]]
    """optional dict mapping column names or expressions to tuple of sort
    keywords, which may include ``asc``, ``desc``, ``nulls_first``,
    ``nulls_last``.

    .. versionadded:: 1.3.5
    """

    dialect_options: NotRequired[Dict[str, Any]]
    """Additional dialect-specific options detected for this index"""


class ReflectedTableComment(TypedDict):
    """Dictionary representing the reflected comment corresponding to
    the :attr:`_schema.Table.comment` attribute.

    The :class:`.ReflectedTableComment` structure is returned by the
    :meth:`.Inspector.get_table_comment` method.

    """

    text: Optional[str]
    """text of the comment"""


class BindTyping(Enum):
    """Define different methods of passing typing information for
    bound parameters in a statement to the database driver.

    .. versionadded:: 2.0

    """

    NONE = 1
    """No steps are taken to pass typing information to the database driver.

    This is the default behavior for databases such as SQLite, MySQL / MariaDB,
    SQL Server.

    """

    SETINPUTSIZES = 2
    """Use the pep-249 setinputsizes method.

    This is only implemented for DBAPIs that support this method and for which
    the SQLAlchemy dialect has the appropriate infrastructure for that
    dialect set up.   Current dialects include cx_Oracle as well as
    optional support for SQL Server using pyodbc.

    When using setinputsizes, dialects also have a means of only using the
    method for certain datatypes using include/exclude lists.

    When SETINPUTSIZES is used, the :meth:`.Dialect.do_set_input_sizes` method
    is called for each statement executed which has bound parameters.

    """

    RENDER_CASTS = 3
    """Render casts or other directives in the SQL string.

    This method is used for all PostgreSQL dialects, including asyncpg,
    pg8000, psycopg, psycopg2.   Dialects which implement this can choose
    which kinds of datatypes are explicitly cast in SQL statements and which
    aren't.

    When RENDER_CASTS is used, the compiler will invoke the
    :meth:`.SQLCompiler.render_bind_cast` method for the rendered
    string representation of each :class:`.BindParameter` object whose
    dialect-level type sets the :attr:`.TypeEngine.render_bind_cast` attribute.

    The :meth:`.SQLCompiler.render_bind_cast` is also used to render casts
    for one form of "insertmanyvalues" query, when both
    :attr:`.InsertmanyvaluesSentinelOpts.USE_INSERT_FROM_SELECT` and
    :attr:`.InsertmanyvaluesSentinelOpts.RENDER_SELECT_COL_CASTS` are set,
    where the casts are applied to the intermediary columns e.g.
    "INSERT INTO t (a, b, c) SELECT p0::TYP, p1::TYP, p2::TYP "
    "FROM (VALUES (?, ?), (?, ?), ...)".

    .. versionadded:: 2.0.10 - :meth:`.SQLCompiler.render_bind_cast` is now
       used within some elements of the "insertmanyvalues" implementation.


    """


VersionInfoType = Tuple[Union[int, str], ...]
TableKey = Tuple[Optional[str], str]


class Dialect(EventTarget):
    """Define the behavior of a specific database and DB-API combination.

    Any aspect of metadata definition, SQL query generation,
    execution, result-set handling, or anything else which varies
    between databases is defined under the general category of the
    Dialect.  The Dialect acts as a factory for other
    database-specific object implementations including
    ExecutionContext, Compiled, DefaultGenerator, and TypeEngine.

    .. note:: Third party dialects should not subclass :class:`.Dialect`
       directly.  Instead, subclass :class:`.default.DefaultDialect` or
       descendant class.

    """

    CACHE_HIT = CacheStats.CACHE_HIT
    CACHE_MISS = CacheStats.CACHE_MISS
    CACHING_DISABLED = CacheStats.CACHING_DISABLED
    NO_CACHE_KEY = CacheStats.NO_CACHE_KEY
    NO_DIALECT_SUPPORT = CacheStats.NO_DIALECT_SUPPORT

    dispatch: dispatcher[Dialect]

    name: str
    """identifying name for the dialect from a DBAPI-neutral point of view
      (i.e. 'sqlite')
    """

    driver: str
    """identifying name for the dialect's DBAPI"""

    dialect_description: str

    dbapi: Optional[ModuleType]
    """A reference to the DBAPI module object itself.

    SQLAlchemy dialects import DBAPI modules using the classmethod
    :meth:`.Dialect.import_dbapi`. The rationale is so that any dialect
    module can be imported and used to generate SQL statements without the
    need for the actual DBAPI driver to be installed.  Only when an
    :class:`.Engine` is constructed using :func:`.create_engine` does the
    DBAPI get imported; at that point, the creation process will assign
    the DBAPI module to this attribute.

    Dialects should therefore implement :meth:`.Dialect.import_dbapi`
    which will import the necessary module and return it, and then refer
    to ``self.dbapi`` in dialect code in order to refer to the DBAPI module
    contents.

    .. versionchanged:: The :attr:`.Dialect.dbapi` attribute is exclusively
       used as the per-:class:`.Dialect`-instance reference to the DBAPI
       module.   The previous not-fully-documented ``.Dialect.dbapi()``
       classmethod is deprecated and replaced by :meth:`.Dialect.import_dbapi`.

    """

    @util.non_memoized_property
    def loaded_dbapi(self) -> ModuleType:
        """same as .dbapi, but is never None; will raise an error if no
        DBAPI was set up.

        .. versionadded:: 2.0

        """
        raise NotImplementedError()

    positional: bool
    """True if the paramstyle for this Dialect is positional."""

    paramstyle: str
    """the paramstyle to be used (some DB-APIs support multiple
      paramstyles).
    """

    compiler_linting: Linting

    statement_compiler: Type[SQLCompiler]
    """a :class:`.Compiled` class used to compile SQL statements"""

    ddl_compiler: Type[DDLCompiler]
    """a :class:`.Compiled` class used to compile DDL statements"""

    type_compiler_cls: ClassVar[Type[TypeCompiler]]
    """a :class:`.Compiled` class used to compile SQL type objects

    .. versionadded:: 2.0

    """

    type_compiler_instance: TypeCompiler
    """instance of a :class:`.Compiled` class used to compile SQL type
    objects

    .. versionadded:: 2.0

    """

    type_compiler: Any
    """legacy; this is a TypeCompiler class at the class level, a
    TypeCompiler instance at the instance level.

    Refer to type_compiler_instance instead.

    """

    preparer: Type[IdentifierPreparer]
    """a :class:`.IdentifierPreparer` class used to
    quote identifiers.
    """

    identifier_preparer: IdentifierPreparer
    """This element will refer to an instance of :class:`.IdentifierPreparer`
    once a :class:`.DefaultDialect` has been constructed.

    """

    server_version_info: Optional[Tuple[Any, ...]]
    """a tuple containing a version number for the DB backend in use.

    This value is only available for supporting dialects, and is
    typically populated during the initial connection to the database.
    """

    default_schema_name: Optional[str]
    """the name of the default schema.  This value is only available for
    supporting dialects, and is typically populated during the
    initial connection to the database.

    """

    # NOTE: this does not take into effect engine-level isolation level.
    # not clear if this should be changed, seems like it should
    default_isolation_level: Optional[IsolationLevel]
    """the isolation that is implicitly present on new connections"""

    # create_engine()  -> isolation_level  currently goes here
    _on_connect_isolation_level: Optional[IsolationLevel]

    execution_ctx_cls: Type[ExecutionContext]
    """a :class:`.ExecutionContext` class used to handle statement execution"""

    execute_sequence_format: Union[
        Type[Tuple[Any, ...]], Type[Tuple[List[Any]]]
    ]
    """either the 'tuple' or 'list' type, depending on what cursor.execute()
    accepts for the second argument (they vary)."""

    supports_alter: bool
    """``True`` if the database supports ``ALTER TABLE`` - used only for
    generating foreign key constraints in certain circumstances
    """

    max_identifier_length: int
    """The maximum length of identifier names."""

    supports_server_side_cursors: bool
    """indicates if the dialect supports server side cursors"""

    server_side_cursors: bool
    """deprecated; indicates if the dialect should attempt to use server
    side cursors by default"""

    supports_sane_rowcount: bool
    """Indicate whether the dialect properly implements rowcount for
      ``UPDATE`` and ``DELETE`` statements.
    """

    supports_sane_multi_rowcount: bool
    """Indicate whether the dialect properly implements rowcount for
      ``UPDATE`` and ``DELETE`` statements when executed via
      executemany.
    """

    supports_empty_insert: bool
    """dialect supports INSERT () VALUES (), i.e. a plain INSERT with no
    columns in it.

    This is not usually supported; an "empty" insert is typically
    suited using either "INSERT..DEFAULT VALUES" or
    "INSERT ... (col) VALUES (DEFAULT)".

    """

    supports_default_values: bool
    """dialect supports INSERT... DEFAULT VALUES syntax"""

    supports_default_metavalue: bool
    """dialect supports INSERT...(col) VALUES (DEFAULT) syntax.

    Most databases support this in some way, e.g. SQLite supports it using
    ``VALUES (NULL)``.    MS SQL Server supports the syntax also however
    is the only included dialect where we have this disabled, as
    MSSQL does not support the field for the IDENTITY column, which is
    usually where we like to make use of the feature.

    """

    default_metavalue_token: str = "DEFAULT"
    """for INSERT... VALUES (DEFAULT) syntax, the token to put in the
    parenthesis.

    E.g. for SQLite this is the keyword "NULL".

    """

    supports_multivalues_insert: bool
    """Target database supports INSERT...VALUES with multiple value
    sets, i.e. INSERT INTO table (cols) VALUES (...), (...), (...), ...

    """

    insert_executemany_returning: bool
    """dialect / driver / database supports some means of providing
    INSERT...RETURNING support when dialect.do_executemany() is used.

    """

    insert_executemany_returning_sort_by_parameter_order: bool
    """dialect / driver / database supports some means of providing
    INSERT...RETURNING support when dialect.do_executemany() is used
    along with the :paramref:`_dml.Insert.returning.sort_by_parameter_order`
    parameter being set.

    """

    update_executemany_returning: bool
    """dialect supports UPDATE..RETURNING with executemany."""

    delete_executemany_returning: bool
    """dialect supports DELETE..RETURNING with executemany."""

    use_insertmanyvalues: bool
    """if True, indicates "insertmanyvalues" functionality should be used
    to allow for ``insert_executemany_returning`` behavior, if possible.

    In practice, setting this to True means:

    if ``supports_multivalues_insert``, ``insert_returning`` and
    ``use_insertmanyvalues`` are all True, the SQL compiler will produce
    an INSERT that will be interpreted by the :class:`.DefaultDialect`
    as an :attr:`.ExecuteStyle.INSERTMANYVALUES` execution that allows
    for INSERT of many rows with RETURNING by rewriting a single-row
    INSERT statement to have multiple VALUES clauses, also executing
    the statement multiple times for a series of batches when large numbers
    of rows are given.

    The parameter is False for the default dialect, and is set to
    True for SQLAlchemy internal dialects SQLite, MySQL/MariaDB, PostgreSQL,
    SQL Server.   It remains at False for Oracle, which provides native
    "executemany with RETURNING" support and also does not support
    ``supports_multivalues_insert``.    For MySQL/MariaDB, those MySQL
    dialects that don't support RETURNING will not report
    ``insert_executemany_returning`` as True.

    .. versionadded:: 2.0

    .. seealso::

        :ref:`engine_insertmanyvalues`

    """

    use_insertmanyvalues_wo_returning: bool
    """if True, and use_insertmanyvalues is also True, INSERT statements
    that don't include RETURNING will also use "insertmanyvalues".

    .. versionadded:: 2.0

    .. seealso::

        :ref:`engine_insertmanyvalues`

    """

    insertmanyvalues_implicit_sentinel: InsertmanyvaluesSentinelOpts
    """Options indicating the database supports a form of bulk INSERT where
    the autoincrement integer primary key can be reliably used as an ordering
    for INSERTed rows.

    .. versionadded:: 2.0.10

    .. seealso::

        :ref:`engine_insertmanyvalues_returning_order`

    """

    insertmanyvalues_page_size: int
    """Number of rows to render into an individual INSERT..VALUES() statement
    for :attr:`.ExecuteStyle.INSERTMANYVALUES` executions.

    The default dialect defaults this to 1000.

    .. versionadded:: 2.0

    .. seealso::

        :paramref:`_engine.Connection.execution_options.insertmanyvalues_page_size` -
        execution option available on :class:`_engine.Connection`, statements

    """  # noqa: E501

    insertmanyvalues_max_parameters: int
    """Alternate to insertmanyvalues_page_size, will additionally limit
    page size based on number of parameters total in the statement.


    """

    preexecute_autoincrement_sequences: bool
    """True if 'implicit' primary key functions must be executed separately
      in order to get their value, if RETURNING is not used.

      This is currently oriented towards PostgreSQL when the
      ``implicit_returning=False`` parameter is used on a :class:`.Table`
      object.

    """

    insert_returning: bool
    """if the dialect supports RETURNING with INSERT

    .. versionadded:: 2.0

    """

    update_returning: bool
    """if the dialect supports RETURNING with UPDATE

    .. versionadded:: 2.0

    """

    update_returning_multifrom: bool
    """if the dialect supports RETURNING with UPDATE..FROM

    .. versionadded:: 2.0

    """

    delete_returning: bool
    """if the dialect supports RETURNING with DELETE

    .. versionadded:: 2.0

    """

    delete_returning_multifrom: bool
    """if the dialect supports RETURNING with DELETE..FROM

    .. versionadded:: 2.0

    """

    favor_returning_over_lastrowid: bool
    """for backends that support both a lastrowid and a RETURNING insert
    strategy, favor RETURNING for simple single-int pk inserts.

    cursor.lastrowid tends to be more performant on most backends.

    """

    supports_identity_columns: bool
    """target database supports IDENTITY"""

    cte_follows_insert: bool
    """target database, when given a CTE with an INSERT statement, needs
    the CTE to be below the INSERT"""

    colspecs: MutableMapping[Type[TypeEngine[Any]], Type[TypeEngine[Any]]]
    """A dictionary of TypeEngine classes from sqlalchemy.types mapped
      to subclasses that are specific to the dialect class.  This
      dictionary is class-level only and is not accessed from the
      dialect instance itself.
    """

    supports_sequences: bool
    """Indicates if the dialect supports CREATE SEQUENCE or similar."""

    sequences_optional: bool
    """If True, indicates if the :paramref:`_schema.Sequence.optional`
      parameter on the :class:`_schema.Sequence` construct
      should signal to not generate a CREATE SEQUENCE. Applies only to
      dialects that support sequences. Currently used only to allow PostgreSQL
      SERIAL to be used on a column that specifies Sequence() for usage on
      other backends.
    """

    default_sequence_base: int
    """the default value that will be rendered as the "START WITH" portion of
    a CREATE SEQUENCE DDL statement.

    """

    supports_native_enum: bool
    """Indicates if the dialect supports a native ENUM construct.
      This will prevent :class:`_types.Enum` from generating a CHECK
      constraint when that type is used in "native" mode.
    """

    supports_native_boolean: bool
    """Indicates if the dialect supports a native boolean construct.
      This will prevent :class:`_types.Boolean` from generating a CHECK
      constraint when that type is used.
    """

    supports_native_decimal: bool
    """indicates if Decimal objects are handled and returned for precision
    numeric types, or if floats are returned"""

    supports_native_uuid: bool
    """indicates if Python UUID() objects are handled natively by the
    driver for SQL UUID datatypes.

    .. versionadded:: 2.0

    """

    returns_native_bytes: bool
    """indicates if Python bytes() objects are returned natively by the
    driver for SQL "binary" datatypes.

    .. versionadded:: 2.0.11

    """

    construct_arguments: Optional[
        List[Tuple[Type[Union[SchemaItem, ClauseElement]], Mapping[str, Any]]]
    ] = None
    """Optional set of argument specifiers for various SQLAlchemy
    constructs, typically schema items.

    To implement, establish as a series of tuples, as in::

        construct_arguments = [
            (schema.Index, {
                "using": False,
                "where": None,
                "ops": None
            })
        ]

    If the above construct is established on the PostgreSQL dialect,
    the :class:`.Index` construct will now accept the keyword arguments
    ``postgresql_using``, ``postgresql_where``, nad ``postgresql_ops``.
    Any other argument specified to the constructor of :class:`.Index`
    which is prefixed with ``postgresql_`` will raise :class:`.ArgumentError`.

    A dialect which does not include a ``construct_arguments`` member will
    not participate in the argument validation system.  For such a dialect,
    any argument name is accepted by all participating constructs, within
    the namespace of arguments prefixed with that dialect name.  The rationale
    here is so that third-party dialects that haven't yet implemented this
    feature continue to function in the old way.

    .. seealso::

        :class:`.DialectKWArgs` - implementing base class which consumes
        :attr:`.DefaultDialect.construct_arguments`


    """

    reflection_options: Sequence[str] = ()
    """Sequence of string names indicating keyword arguments that can be
    established on a :class:`.Table` object which will be passed as
    "reflection options" when using :paramref:`.Table.autoload_with`.

    Current example is "oracle_resolve_synonyms" in the Oracle dialect.

    """

    dbapi_exception_translation_map: Mapping[str, str] = util.EMPTY_DICT
    """A dictionary of names that will contain as values the names of
       pep-249 exceptions ("IntegrityError", "OperationalError", etc)
       keyed to alternate class names, to support the case where a
       DBAPI has exception classes that aren't named as they are
       referred to (e.g. IntegrityError = MyException).   In the vast
       majority of cases this dictionary is empty.
    """

    supports_comments: bool
    """Indicates the dialect supports comment DDL on tables and columns."""

    inline_comments: bool
    """Indicates the dialect supports comment DDL that's inline with the
    definition of a Table or Column.  If False, this implies that ALTER must
    be used to set table and column comments."""

    supports_constraint_comments: bool
    """Indicates if the dialect supports comment DDL on constraints.

    .. versionadded: 2.0
    """

    _has_events = False

    supports_statement_cache: bool = True
    """indicates if this dialect supports caching.

    All dialects that are compatible with statement caching should set this
    flag to True directly on each dialect class and subclass that supports
    it.  SQLAlchemy tests that this flag is locally present on each dialect
    subclass before it will use statement caching.  This is to provide
    safety for legacy or new dialects that are not yet fully tested to be
    compliant with SQL statement caching.

    .. versionadded:: 1.4.5

    .. seealso::

        :ref:`engine_thirdparty_caching`

    """

    _supports_statement_cache: bool
    """internal evaluation for supports_statement_cache"""

    bind_typing = BindTyping.NONE
    """define a means of passing typing information to the database and/or
    driver for bound parameters.

    See :class:`.BindTyping` for values.

    .. versionadded:: 2.0

    """

    is_async: bool
    """Whether or not this dialect is intended for asyncio use."""

    has_terminate: bool
    """Whether or not this dialect has a separate "terminate" implementation
    that does not block or require awaiting."""

    engine_config_types: Mapping[str, Any]
    """a mapping of string keys that can be in an engine config linked to
    type conversion functions.

    """

    label_length: Optional[int]
    """optional user-defined max length for SQL labels"""

    include_set_input_sizes: Optional[Set[Any]]
    """set of DBAPI type objects that should be included in
    automatic cursor.setinputsizes() calls.

    This is only used if bind_typing is BindTyping.SET_INPUT_SIZES

    """

    exclude_set_input_sizes: Optional[Set[Any]]
    """set of DBAPI type objects that should be excluded in
    automatic cursor.setinputsizes() calls.

    This is only used if bind_typing is BindTyping.SET_INPUT_SIZES

    """

    supports_simple_order_by_label: bool
    """target database supports ORDER BY <labelname>, where <labelname>
    refers to a label in the columns clause of the SELECT"""

    div_is_floordiv: bool
    """target database treats the / division operator as "floor division" """

    tuple_in_values: bool
    """target database supports tuple IN, i.e. (x, y) IN ((q, p), (r, z))"""

    _bind_typing_render_casts: bool

    _type_memos: MutableMapping[TypeEngine[Any], _TypeMemoDict]

    def _builtin_onconnect(self) -> Optional[_ListenerFnType]:
        raise NotImplementedError()

    def create_connect_args(self, url: URL) -> ConnectArgsType:
        """Build DB-API compatible connection arguments.

        Given a :class:`.URL` object, returns a tuple
        consisting of a ``(*args, **kwargs)`` suitable to send directly
        to the dbapi's connect function.   The arguments are sent to the
        :meth:`.Dialect.connect` method which then runs the DBAPI-level
        ``connect()`` function.

        The method typically makes use of the
        :meth:`.URL.translate_connect_args`
        method in order to generate a dictionary of options.

        The default implementation is::

            def create_connect_args(self, url):
                opts = url.translate_connect_args()
                opts.update(url.query)
                return ([], opts)

        :param url: a :class:`.URL` object

        :return: a tuple of ``(*args, **kwargs)`` which will be passed to the
         :meth:`.Dialect.connect` method.

        .. seealso::

            :meth:`.URL.translate_connect_args`

        """

        raise NotImplementedError()

    @classmethod
    def import_dbapi(cls) -> ModuleType:
        """Import the DBAPI module that is used by this dialect.

        The Python module object returned here will be assigned as an
        instance variable to a constructed dialect under the name
        ``.dbapi``.

        .. versionchanged:: 2.0  The :meth:`.Dialect.import_dbapi` class
           method is renamed from the previous method ``.Dialect.dbapi()``,
           which would be replaced at dialect instantiation time by the
           DBAPI module itself, thus using the same name in two different ways.
           If a ``.Dialect.dbapi()`` classmethod is present on a third-party
           dialect, it will be used and a deprecation warning will be emitted.

        """
        raise NotImplementedError()

    @classmethod
    def type_descriptor(cls, typeobj: TypeEngine[_T]) -> TypeEngine[_T]:
        """Transform a generic type to a dialect-specific type.

        Dialect classes will usually use the
        :func:`_types.adapt_type` function in the types module to
        accomplish this.

        The returned result is cached *per dialect class* so can
        contain no dialect-instance state.

        """

        raise NotImplementedError()

    def initialize(self, connection: Connection) -> None:
        """Called during strategized creation of the dialect with a
        connection.

        Allows dialects to configure options based on server version info or
        other properties.

        The connection passed here is a SQLAlchemy Connection object,
        with full capabilities.

        The initialize() method of the base dialect should be called via
        super().

        .. note:: as of SQLAlchemy 1.4, this method is called **before**
           any :meth:`_engine.Dialect.on_connect` hooks are called.

        """

        pass

    if TYPE_CHECKING:

        def _overrides_default(self, method_name: str) -> bool:
            ...

    def get_columns(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> List[ReflectedColumn]:
        """Return information about columns in ``table_name``.

        Given a :class:`_engine.Connection`, a string
        ``table_name``, and an optional string ``schema``, return column
        information as a list of dictionaries
        corresponding to the :class:`.ReflectedColumn` dictionary.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_columns`.

        """

        raise NotImplementedError()

    def get_multi_columns(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, List[ReflectedColumn]]]:
        """Return information about columns in all tables in the
        given ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_multi_columns`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def get_pk_constraint(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> ReflectedPrimaryKeyConstraint:
        """Return information about the primary key constraint on
        table_name`.

        Given a :class:`_engine.Connection`, a string
        ``table_name``, and an optional string ``schema``, return primary
        key information as a dictionary corresponding to the
        :class:`.ReflectedPrimaryKeyConstraint` dictionary.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_pk_constraint`.

        """
        raise NotImplementedError()

    def get_multi_pk_constraint(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, ReflectedPrimaryKeyConstraint]]:
        """Return information about primary key constraints in
        all tables in the given ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_multi_pk_constraint`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """
        raise NotImplementedError()

    def get_foreign_keys(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> List[ReflectedForeignKeyConstraint]:
        """Return information about foreign_keys in ``table_name``.

        Given a :class:`_engine.Connection`, a string
        ``table_name``, and an optional string ``schema``, return foreign
        key information as a list of dicts corresponding to the
        :class:`.ReflectedForeignKeyConstraint` dictionary.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_foreign_keys`.
        """

        raise NotImplementedError()

    def get_multi_foreign_keys(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, List[ReflectedForeignKeyConstraint]]]:
        """Return information about foreign_keys in all tables
        in the given ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_multi_foreign_keys`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def get_table_names(
        self, connection: Connection, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        """Return a list of table names for ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_table_names`.

        """

        raise NotImplementedError()

    def get_temp_table_names(
        self, connection: Connection, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        """Return a list of temporary table names on the given connection,
        if supported by the underlying backend.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_temp_table_names`.

        """

        raise NotImplementedError()

    def get_view_names(
        self, connection: Connection, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        """Return a list of all non-materialized view names available in the
        database.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_view_names`.

        :param schema: schema name to query, if not the default schema.

        """

        raise NotImplementedError()

    def get_materialized_view_names(
        self, connection: Connection, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        """Return a list of all materialized view names available in the
        database.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_materialized_view_names`.

        :param schema: schema name to query, if not the default schema.

         .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def get_sequence_names(
        self, connection: Connection, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        """Return a list of all sequence names available in the database.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_sequence_names`.

        :param schema: schema name to query, if not the default schema.

        .. versionadded:: 1.4
        """

        raise NotImplementedError()

    def get_temp_view_names(
        self, connection: Connection, schema: Optional[str] = None, **kw: Any
    ) -> List[str]:
        """Return a list of temporary view names on the given connection,
        if supported by the underlying backend.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_temp_view_names`.

        """

        raise NotImplementedError()

    def get_schema_names(self, connection: Connection, **kw: Any) -> List[str]:
        """Return a list of all schema names available in the database.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_schema_names`.
        """
        raise NotImplementedError()

    def get_view_definition(
        self,
        connection: Connection,
        view_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> str:
        """Return plain or materialized view definition.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_view_definition`.

        Given a :class:`_engine.Connection`, a string
        ``view_name``, and an optional string ``schema``, return the view
        definition.
        """

        raise NotImplementedError()

    def get_indexes(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> List[ReflectedIndex]:
        """Return information about indexes in ``table_name``.

        Given a :class:`_engine.Connection`, a string
        ``table_name`` and an optional string ``schema``, return index
        information as a list of dictionaries corresponding to the
        :class:`.ReflectedIndex` dictionary.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_indexes`.
        """

        raise NotImplementedError()

    def get_multi_indexes(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, List[ReflectedIndex]]]:
        """Return information about indexes in in all tables
        in the given ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_multi_indexes`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def get_unique_constraints(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> List[ReflectedUniqueConstraint]:
        r"""Return information about unique constraints in ``table_name``.

        Given a string ``table_name`` and an optional string ``schema``, return
        unique constraint information as a list of dicts corresponding
        to the :class:`.ReflectedUniqueConstraint` dictionary.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_unique_constraints`.
        """

        raise NotImplementedError()

    def get_multi_unique_constraints(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, List[ReflectedUniqueConstraint]]]:
        """Return information about unique constraints in all tables
        in the given ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_multi_unique_constraints`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def get_check_constraints(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> List[ReflectedCheckConstraint]:
        r"""Return information about check constraints in ``table_name``.

        Given a string ``table_name`` and an optional string ``schema``, return
        check constraint information as a list of dicts corresponding
        to the :class:`.ReflectedCheckConstraint` dictionary.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_check_constraints`.

        """

        raise NotImplementedError()

    def get_multi_check_constraints(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, List[ReflectedCheckConstraint]]]:
        """Return information about check constraints in all tables
        in the given ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_multi_check_constraints`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def get_table_options(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> Dict[str, Any]:
        """Return a dictionary of options specified when ``table_name``
        was created.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_table_options`.
        """
        raise NotImplementedError()

    def get_multi_table_options(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, Dict[str, Any]]]:
        """Return a dictionary of options specified when the tables in the
        given schema were created.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_multi_table_options`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """
        raise NotImplementedError()

    def get_table_comment(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> ReflectedTableComment:
        r"""Return the "comment" for the table identified by ``table_name``.

        Given a string ``table_name`` and an optional string ``schema``, return
        table comment information as a dictionary corresponding to the
        :class:`.ReflectedTableComment` dictionary.

        This is an internal dialect method. Applications should use
        :meth:`.Inspector.get_table_comment`.

        :raise: ``NotImplementedError`` for dialects that don't support
         comments.

        .. versionadded:: 1.2

        """

        raise NotImplementedError()

    def get_multi_table_comment(
        self,
        connection: Connection,
        schema: Optional[str] = None,
        filter_names: Optional[Collection[str]] = None,
        **kw: Any,
    ) -> Iterable[Tuple[TableKey, ReflectedTableComment]]:
        """Return information about the table comment in all tables
        in the given ``schema``.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.get_multi_table_comment`.

        .. note:: The :class:`_engine.DefaultDialect` provides a default
          implementation that will call the single table method for
          each object returned by :meth:`Dialect.get_table_names`,
          :meth:`Dialect.get_view_names` or
          :meth:`Dialect.get_materialized_view_names` depending on the
          provided ``kind``. Dialects that want to support a faster
          implementation should implement this method.

        .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def normalize_name(self, name: str) -> str:
        """convert the given name to lowercase if it is detected as
        case insensitive.

        This method is only used if the dialect defines
        requires_name_normalize=True.

        """
        raise NotImplementedError()

    def denormalize_name(self, name: str) -> str:
        """convert the given name to a case insensitive identifier
        for the backend if it is an all-lowercase name.

        This method is only used if the dialect defines
        requires_name_normalize=True.

        """
        raise NotImplementedError()

    def has_table(
        self,
        connection: Connection,
        table_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> bool:
        """For internal dialect use, check the existence of a particular table
        or view in the database.

        Given a :class:`_engine.Connection` object, a string table_name and
        optional schema name, return True if the given table exists in the
        database, False otherwise.

        This method serves as the underlying implementation of the
        public facing :meth:`.Inspector.has_table` method, and is also used
        internally to implement the "checkfirst" behavior for methods like
        :meth:`_schema.Table.create` and :meth:`_schema.MetaData.create_all`.

        .. note:: This method is used internally by SQLAlchemy, and is
           published so that third-party dialects may provide an
           implementation. It is **not** the public API for checking for table
           presence. Please use the :meth:`.Inspector.has_table` method.

        .. versionchanged:: 2.0:: :meth:`_engine.Dialect.has_table` now
           formally supports checking for additional table-like objects:

           * any type of views (plain or materialized)
           * temporary tables of any kind

           Previously, these two checks were not formally specified and
           different dialects would vary in their behavior.   The dialect
           testing suite now includes tests for all of these object types,
           and dialects to the degree that the backing database supports views
           or temporary tables should seek to support locating these objects
           for full compliance.

        """

        raise NotImplementedError()

    def has_index(
        self,
        connection: Connection,
        table_name: str,
        index_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> bool:
        """Check the existence of a particular index name in the database.

        Given a :class:`_engine.Connection` object, a string
        ``table_name`` and string index name, return ``True`` if an index of
        the given name on the given table exists, ``False`` otherwise.

        The :class:`.DefaultDialect` implements this in terms of the
        :meth:`.Dialect.has_table` and :meth:`.Dialect.get_indexes` methods,
        however dialects can implement a more performant version.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.has_index`.

        .. versionadded:: 1.4

        """

        raise NotImplementedError()

    def has_sequence(
        self,
        connection: Connection,
        sequence_name: str,
        schema: Optional[str] = None,
        **kw: Any,
    ) -> bool:
        """Check the existence of a particular sequence in the database.

        Given a :class:`_engine.Connection` object and a string
        `sequence_name`, return ``True`` if the given sequence exists in
        the database, ``False`` otherwise.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.has_sequence`.
        """

        raise NotImplementedError()

    def has_schema(
        self, connection: Connection, schema_name: str, **kw: Any
    ) -> bool:
        """Check the existence of a particular schema name in the database.

        Given a :class:`_engine.Connection` object, a string
        ``schema_name``, return ``True`` if a schema of the
        given exists, ``False`` otherwise.

        The :class:`.DefaultDialect` implements this by checking
        the presence of ``schema_name`` among the schemas returned by
        :meth:`.Dialect.get_schema_names`,
        however dialects can implement a more performant version.

        This is an internal dialect method. Applications should use
        :meth:`_engine.Inspector.has_schema`.

        .. versionadded:: 2.0

        """

        raise NotImplementedError()

    def _get_server_version_info(self, connection: Connection) -> Any:
        """Retrieve the server version info from the given connection.

        This is used by the default implementation to populate the
        "server_version_info" attribute and is called exactly
        once upon first connect.

        """

        raise NotImplementedError()

    def _get_default_schema_name(self, connection: Connection) -> str:
        """Return the string name of the currently selected schema from
        the given connection.

        This is used by the default implementation to populate the
        "default_schema_name" attribute and is called exactly
        once upon first connect.

        """

        raise NotImplementedError()

    def do_begin(self, dbapi_connection: PoolProxiedConnection) -> None:
        """Provide an implementation of ``connection.begin()``, given a
        DB-API connection.

        The DBAPI has no dedicated "begin" method and it is expected
        that transactions are implicit.  This hook is provided for those
        DBAPIs that might need additional help in this area.

        :param dbapi_connection: a DBAPI connection, typically
         proxied within a :class:`.ConnectionFairy`.

        """

        raise NotImplementedError()

    def do_rollback(self, dbapi_connection: PoolProxiedConnection) -> None:
        """Provide an implementation of ``connection.rollback()``, given
        a DB-API connection.

        :param dbapi_connection: a DBAPI connection, typically
         proxied within a :class:`.ConnectionFairy`.

        """

        raise NotImplementedError()

    def do_commit(self, dbapi_connection: PoolProxiedConnection) -> None:
        """Provide an implementation of ``connection.commit()``, given a
        DB-API connection.

        :param dbapi_connection: a DBAPI connection, typically
         proxied within a :class:`.ConnectionFairy`.

        """

        raise NotImplementedError()

    def do_terminate(self, dbapi_connection: DBAPIConnection) -> None:
        """Provide an implementation of ``connection.close()`` that tries as
        much as possible to not block, given a DBAPI
        connection.

        In the vast majority of cases this just calls .close(), however
        for some asyncio dialects may call upon different API features.

        This hook is called by the :class:`_pool.Pool`
        when a connection is being recycled or has been invalidated.

        .. versionadded:: 1.4.41

        """

        raise NotImplementedError()

    def do_close(self, dbapi_connection: DBAPIConnection) -> None:
        """Provide an implementation of ``connection.close()``, given a DBAPI
        connection.

        This hook is called by the :class:`_pool.Pool`
        when a connection has been
        detached from the pool, or is being returned beyond the normal
        capacity of the pool.

        """

        raise NotImplementedError()

    def _do_ping_w_event(self, dbapi_connection: DBAPIConnection) -> bool:
        raise NotImplementedError()

    def do_ping(self, dbapi_connection: DBAPIConnection) -> bool:
        """ping the DBAPI connection and return True if the connection is
        usable."""
        raise NotImplementedError()

    def do_set_input_sizes(
        self,
        cursor: DBAPICursor,
        list_of_tuples: _GenericSetInputSizesType,
        context: ExecutionContext,
    ) -> Any:
        """invoke the cursor.setinputsizes() method with appropriate arguments

        This hook is called if the :attr:`.Dialect.bind_typing` attribute is
        set to the
        :attr:`.BindTyping.SETINPUTSIZES` value.
        Parameter data is passed in a list of tuples (paramname, dbtype,
        sqltype), where ``paramname`` is the key of the parameter in the
        statement, ``dbtype`` is the DBAPI datatype and ``sqltype`` is the
        SQLAlchemy type. The order of tuples is in the correct parameter order.

        .. versionadded:: 1.4

        .. versionchanged:: 2.0  - setinputsizes mode is now enabled by
           setting :attr:`.Dialect.bind_typing` to
           :attr:`.BindTyping.SETINPUTSIZES`.  Dialects which accept
           a ``use_setinputsizes`` parameter should set this value
           appropriately.


        """
        raise NotImplementedError()

    def create_xid(self) -> Any:
        """Create a two-phase transaction ID.

        This id will be passed to do_begin_twophase(),
        do_rollback_twophase(), do_commit_twophase().  Its format is
        unspecified.
        """

        raise NotImplementedError()

    def do_savepoint(self, connection: Connection, name: str) -> None:
        """Create a savepoint with the given name.

        :param connection: a :class:`_engine.Connection`.
        :param name: savepoint name.

        """

        raise NotImplementedError()

    def do_rollback_to_savepoint(
        self, connection: Connection, name: str
    ) -> None:
        """Rollback a connection to the named savepoint.

        :param connection: a :class:`_engine.Connection`.
        :param name: savepoint name.

        """

        raise NotImplementedError()

    def do_release_savepoint(self, connection: Connection, name: str) -> None:
        """Release the named savepoint on a connection.

        :param connection: a :class:`_engine.Connection`.
        :param name: savepoint name.
        """

        raise NotImplementedError()

    def do_begin_twophase(self, connection: Connection, xid: Any) -> None:
        """Begin a two phase transaction on the given connection.

        :param connection: a :class:`_engine.Connection`.
        :param xid: xid

        """

        raise NotImplementedError()

    def do_prepare_twophase(self, connection: Connection, xid: Any) -> None:
        """Prepare a two phase transaction on the given connection.

        :param connection: a :class:`_engine.Connection`.
        :param xid: xid

        """

        raise NotImplementedError()

    def do_rollback_twophase(
        self,
        connection: Connection,
        xid: Any,
        is_prepared: bool = True,
        recover: bool = False,
    ) -> None:
        """Rollback a two phase transaction on the given connection.

        :param connection: a :class:`_engine.Connection`.
        :param xid: xid
        :param is_prepared: whether or not
         :meth:`.TwoPhaseTransaction.prepare` was called.
        :param recover: if the recover flag was passed.

        """

        raise NotImplementedError()

    def do_commit_twophase(
        self,
        connection: Connection,
        xid: Any,
        is_prepared: bool = True,
        recover: bool = False,
    ) -> None:
        """Commit a two phase transaction on the given connection.


        :param connection: a :class:`_engine.Connection`.
        :param xid: xid
        :param is_prepared: whether or not
         :meth:`.TwoPhaseTransaction.prepare` was called.
        :param recover: if the recover flag was passed.

        """

        raise NotImplementedError()

    def do_recover_twophase(self, connection: Connection) -> List[Any]:
        """Recover list of uncommitted prepared two phase transaction
        identifiers on the given connection.

        :param connection: a :class:`_engine.Connection`.

        """

        raise NotImplementedError()

    def _deliver_insertmanyvalues_batches(
        self,
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPIMultiExecuteParams,
        generic_setinputsizes: Optional[_GenericSetInputSizesType],
        context: ExecutionContext,
    ) -> Iterator[_InsertManyValuesBatch]:
        """convert executemany parameters for an INSERT into an iterator
        of statement/single execute values, used by the insertmanyvalues
        feature.

        """
        raise NotImplementedError()

    def do_executemany(
        self,
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPIMultiExecuteParams,
        context: Optional[ExecutionContext] = None,
    ) -> None:
        """Provide an implementation of ``cursor.executemany(statement,
        parameters)``."""

        raise NotImplementedError()

    def do_execute(
        self,
        cursor: DBAPICursor,
        statement: str,
        parameters: Optional[_DBAPISingleExecuteParams],
        context: Optional[ExecutionContext] = None,
    ) -> None:
        """Provide an implementation of ``cursor.execute(statement,
        parameters)``."""

        raise NotImplementedError()

    def do_execute_no_params(
        self,
        cursor: DBAPICursor,
        statement: str,
        context: Optional[ExecutionContext] = None,
    ) -> None:
        """Provide an implementation of ``cursor.execute(statement)``.

        The parameter collection should not be sent.

        """

        raise NotImplementedError()

    def is_disconnect(
        self,
        e: Exception,
        connection: Optional[Union[PoolProxiedConnection, DBAPIConnection]],
        cursor: Optional[DBAPICursor],
    ) -> bool:
        """Return True if the given DB-API error indicates an invalid
        connection"""

        raise NotImplementedError()

    def connect(self, *cargs: Any, **cparams: Any) -> DBAPIConnection:
        r"""Establish a connection using this dialect's DBAPI.

        The default implementation of this method is::

            def connect(self, *cargs, **cparams):
                return self.dbapi.connect(*cargs, **cparams)

        The ``*cargs, **cparams`` parameters are generated directly
        from this dialect's :meth:`.Dialect.create_connect_args` method.

        This method may be used for dialects that need to perform programmatic
        per-connection steps when a new connection is procured from the
        DBAPI.


        :param \*cargs: positional parameters returned from the
         :meth:`.Dialect.create_connect_args` method

        :param \*\*cparams: keyword parameters returned from the
         :meth:`.Dialect.create_connect_args` method.

        :return: a DBAPI connection, typically from the :pep:`249` module
         level ``.connect()`` function.

        .. seealso::

            :meth:`.Dialect.create_connect_args`

            :meth:`.Dialect.on_connect`

        """
        raise NotImplementedError()

    def on_connect_url(self, url: URL) -> Optional[Callable[[Any], Any]]:
        """return a callable which sets up a newly created DBAPI connection.

        This method is a new hook that supersedes the
        :meth:`_engine.Dialect.on_connect` method when implemented by a
        dialect.   When not implemented by a dialect, it invokes the
        :meth:`_engine.Dialect.on_connect` method directly to maintain
        compatibility with existing dialects.   There is no deprecation
        for :meth:`_engine.Dialect.on_connect` expected.

        The callable should accept a single argument "conn" which is the
        DBAPI connection itself.  The inner callable has no
        return value.

        E.g.::

            class MyDialect(default.DefaultDialect):
                # ...

                def on_connect_url(self, url):
                    def do_on_connect(connection):
                        connection.execute("SET SPECIAL FLAGS etc")

                    return do_on_connect

        This is used to set dialect-wide per-connection options such as
        isolation modes, Unicode modes, etc.

        This method differs from :meth:`_engine.Dialect.on_connect` in that
        it is passed the :class:`_engine.URL` object that's relevant to the
        connect args.  Normally the only way to get this is from the
        :meth:`_engine.Dialect.on_connect` hook is to look on the
        :class:`_engine.Engine` itself, however this URL object may have been
        replaced by plugins.

        .. note::

            The default implementation of
            :meth:`_engine.Dialect.on_connect_url` is to invoke the
            :meth:`_engine.Dialect.on_connect` method. Therefore if a dialect
            implements this method, the :meth:`_engine.Dialect.on_connect`
            method **will not be called** unless the overriding dialect calls
            it directly from here.

        .. versionadded:: 1.4.3 added :meth:`_engine.Dialect.on_connect_url`
           which normally calls into :meth:`_engine.Dialect.on_connect`.

        :param url: a :class:`_engine.URL` object representing the
         :class:`_engine.URL` that was passed to the
         :meth:`_engine.Dialect.create_connect_args` method.

        :return: a callable that accepts a single DBAPI connection as an
         argument, or None.

        .. seealso::

            :meth:`_engine.Dialect.on_connect`

        """
        return self.on_connect()

    def on_connect(self) -> Optional[Callable[[Any], Any]]:
        """return a callable which sets up a newly created DBAPI connection.

        The callable should accept a single argument "conn" which is the
        DBAPI connection itself.  The inner callable has no
        return value.

        E.g.::

            class MyDialect(default.DefaultDialect):
                # ...

                def on_connect(self):
                    def do_on_connect(connection):
                        connection.execute("SET SPECIAL FLAGS etc")

                    return do_on_connect

        This is used to set dialect-wide per-connection options such as
        isolation modes, Unicode modes, etc.

        The "do_on_connect" callable is invoked by using the
        :meth:`_events.PoolEvents.connect` event
        hook, then unwrapping the DBAPI connection and passing it into the
        callable.

        .. versionchanged:: 1.4 the on_connect hook is no longer called twice
           for the first connection of a dialect.  The on_connect hook is still
           called before the :meth:`_engine.Dialect.initialize` method however.

        .. versionchanged:: 1.4.3 the on_connect hook is invoked from a new
           method on_connect_url that passes the URL that was used to create
           the connect args.   Dialects can implement on_connect_url instead
           of on_connect if they need the URL object that was used for the
           connection in order to get additional context.

        If None is returned, no event listener is generated.

        :return: a callable that accepts a single DBAPI connection as an
         argument, or None.

        .. seealso::

            :meth:`.Dialect.connect` - allows the DBAPI ``connect()`` sequence
            itself to be controlled.

            :meth:`.Dialect.on_connect_url` - supersedes
            :meth:`.Dialect.on_connect` to also receive the
            :class:`_engine.URL` object in context.

        """
        return None

    def reset_isolation_level(self, dbapi_connection: DBAPIConnection) -> None:
        """Given a DBAPI connection, revert its isolation to the default.

        Note that this is a dialect-level method which is used as part
        of the implementation of the :class:`_engine.Connection` and
        :class:`_engine.Engine`
        isolation level facilities; these APIs should be preferred for
        most typical use cases.

        .. seealso::

            :meth:`_engine.Connection.get_isolation_level`
            - view current level

            :attr:`_engine.Connection.default_isolation_level`
            - view default level

            :paramref:`.Connection.execution_options.isolation_level` -
            set per :class:`_engine.Connection` isolation level

            :paramref:`_sa.create_engine.isolation_level` -
            set per :class:`_engine.Engine` isolation level

        """

        raise NotImplementedError()

    def set_isolation_level(
        self, dbapi_connection: DBAPIConnection, level: IsolationLevel
    ) -> None:
        """Given a DBAPI connection, set its isolation level.

        Note that this is a dialect-level method which is used as part
        of the implementation of the :class:`_engine.Connection` and
        :class:`_engine.Engine`
        isolation level facilities; these APIs should be preferred for
        most typical use cases.

        If the dialect also implements the
        :meth:`.Dialect.get_isolation_level_values` method, then the given
        level is guaranteed to be one of the string names within that sequence,
        and the method will not need to anticipate a lookup failure.

        .. seealso::

            :meth:`_engine.Connection.get_isolation_level`
            - view current level

            :attr:`_engine.Connection.default_isolation_level`
            - view default level

            :paramref:`.Connection.execution_options.isolation_level` -
            set per :class:`_engine.Connection` isolation level

            :paramref:`_sa.create_engine.isolation_level` -
            set per :class:`_engine.Engine` isolation level

        """

        raise NotImplementedError()

    def get_isolation_level(
        self, dbapi_connection: DBAPIConnection
    ) -> IsolationLevel:
        """Given a DBAPI connection, return its isolation level.

        When working with a :class:`_engine.Connection` object,
        the corresponding
        DBAPI connection may be procured using the
        :attr:`_engine.Connection.connection` accessor.

        Note that this is a dialect-level method which is used as part
        of the implementation of the :class:`_engine.Connection` and
        :class:`_engine.Engine` isolation level facilities;
        these APIs should be preferred for most typical use cases.


        .. seealso::

            :meth:`_engine.Connection.get_isolation_level`
            - view current level

            :attr:`_engine.Connection.default_isolation_level`
            - view default level

            :paramref:`.Connection.execution_options.isolation_level` -
            set per :class:`_engine.Connection` isolation level

            :paramref:`_sa.create_engine.isolation_level` -
            set per :class:`_engine.Engine` isolation level


        """

        raise NotImplementedError()

    def get_default_isolation_level(
        self, dbapi_conn: DBAPIConnection
    ) -> IsolationLevel:
        """Given a DBAPI connection, return its isolation level, or
        a default isolation level if one cannot be retrieved.

        This method may only raise NotImplementedError and
        **must not raise any other exception**, as it is used implicitly upon
        first connect.

        The method **must return a value** for a dialect that supports
        isolation level settings, as this level is what will be reverted
        towards when a per-connection isolation level change is made.

        The method defaults to using the :meth:`.Dialect.get_isolation_level`
        method unless overridden by a dialect.

        .. versionadded:: 1.3.22

        """
        raise NotImplementedError()

    def get_isolation_level_values(
        self, dbapi_conn: DBAPIConnection
    ) -> List[IsolationLevel]:
        """return a sequence of string isolation level names that are accepted
        by this dialect.

        The available names should use the following conventions:

        * use UPPERCASE names.   isolation level methods will accept lowercase
          names but these are normalized into UPPERCASE before being passed
          along to the dialect.
        * separate words should be separated by spaces, not underscores, e.g.
          ``REPEATABLE READ``.  isolation level names will have underscores
          converted to spaces before being passed along to the dialect.
        * The names for the four standard isolation names to the extent that
          they are supported by the backend should be ``READ UNCOMMITTED``
          ``READ COMMITTED``, ``REPEATABLE READ``, ``SERIALIZABLE``
        * if the dialect supports an autocommit option it should be provided
          using the isolation level name ``AUTOCOMMIT``.
        * Other isolation modes may also be present, provided that they
          are named in UPPERCASE and use spaces not underscores.

        This function is used so that the default dialect can check that
        a given isolation level parameter is valid, else raises an
        :class:`_exc.ArgumentError`.

        A DBAPI connection is passed to the method, in the unlikely event that
        the dialect needs to interrogate the connection itself to determine
        this list, however it is expected that most backends will return
        a hardcoded list of values.  If the dialect supports "AUTOCOMMIT",
        that value should also be present in the sequence returned.

        The method raises ``NotImplementedError`` by default.  If a dialect
        does not implement this method, then the default dialect will not
        perform any checking on a given isolation level value before passing
        it onto the :meth:`.Dialect.set_isolation_level` method.  This is
        to allow backwards-compatibility with third party dialects that may
        not yet be implementing this method.

        .. versionadded:: 2.0

        """
        raise NotImplementedError()

    def _assert_and_set_isolation_level(
        self, dbapi_conn: DBAPIConnection, level: IsolationLevel
    ) -> None:
        raise NotImplementedError()

    @classmethod
    def get_dialect_cls(cls, url: URL) -> Type[Dialect]:
        """Given a URL, return the :class:`.Dialect` that will be used.

        This is a hook that allows an external plugin to provide functionality
        around an existing dialect, by allowing the plugin to be loaded
        from the url based on an entrypoint, and then the plugin returns
        the actual dialect to be used.

        By default this just returns the cls.

        """
        return cls

    @classmethod
    def get_async_dialect_cls(cls, url: URL) -> Type[Dialect]:
        """Given a URL, return the :class:`.Dialect` that will be used by
        an async engine.

        By default this is an alias of :meth:`.Dialect.get_dialect_cls` and
        just returns the cls. It may be used if a dialect provides
        both a sync and async version under the same name, like the
        ``psycopg`` driver.

        .. versionadded:: 2

        .. seealso::

            :meth:`.Dialect.get_dialect_cls`

        """
        return cls.get_dialect_cls(url)

    @classmethod
    def load_provisioning(cls) -> None:
        """set up the provision.py module for this dialect.

        For dialects that include a provision.py module that sets up
        provisioning followers, this method should initiate that process.

        A typical implementation would be::

            @classmethod
            def load_provisioning(cls):
                __import__("mydialect.provision")

        The default method assumes a module named ``provision.py`` inside
        the owning package of the current dialect, based on the ``__module__``
        attribute::

            @classmethod
            def load_provisioning(cls):
                package = ".".join(cls.__module__.split(".")[0:-1])
                try:
                    __import__(package + ".provision")
                except ImportError:
                    pass

        .. versionadded:: 1.3.14

        """

    @classmethod
    def engine_created(cls, engine: Engine) -> None:
        """A convenience hook called before returning the final
        :class:`_engine.Engine`.

        If the dialect returned a different class from the
        :meth:`.get_dialect_cls`
        method, then the hook is called on both classes, first on
        the dialect class returned by the :meth:`.get_dialect_cls` method and
        then on the class on which the method was called.

        The hook should be used by dialects and/or wrappers to apply special
        events to the engine or its components.   In particular, it allows
        a dialect-wrapping class to apply dialect-level events.

        """

    def get_driver_connection(self, connection: DBAPIConnection) -> Any:
        """Returns the connection object as returned by the external driver
        package.

        For normal dialects that use a DBAPI compliant driver this call
        will just return the ``connection`` passed as argument.
        For dialects that instead adapt a non DBAPI compliant driver, like
        when adapting an asyncio driver, this call will return the
        connection-like object as returned by the driver.

        .. versionadded:: 1.4.24

        """
        raise NotImplementedError()

    def set_engine_execution_options(
        self, engine: Engine, opts: CoreExecuteOptionsParameter
    ) -> None:
        """Establish execution options for a given engine.

        This is implemented by :class:`.DefaultDialect` to establish
        event hooks for new :class:`.Connection` instances created
        by the given :class:`.Engine` which will then invoke the
        :meth:`.Dialect.set_connection_execution_options` method for that
        connection.

        """
        raise NotImplementedError()

    def set_connection_execution_options(
        self, connection: Connection, opts: CoreExecuteOptionsParameter
    ) -> None:
        """Establish execution options for a given connection.

        This is implemented by :class:`.DefaultDialect` in order to implement
        the :paramref:`_engine.Connection.execution_options.isolation_level`
        execution option.  Dialects can intercept various execution options
        which may need to modify state on a particular DBAPI connection.

        .. versionadded:: 1.4

        """
        raise NotImplementedError()

    def get_dialect_pool_class(self, url: URL) -> Type[Pool]:
        """return a Pool class to use for a given URL"""
        raise NotImplementedError()


class CreateEnginePlugin:
    """A set of hooks intended to augment the construction of an
    :class:`_engine.Engine` object based on entrypoint names in a URL.

    The purpose of :class:`_engine.CreateEnginePlugin` is to allow third-party
    systems to apply engine, pool and dialect level event listeners without
    the need for the target application to be modified; instead, the plugin
    names can be added to the database URL.  Target applications for
    :class:`_engine.CreateEnginePlugin` include:

    * connection and SQL performance tools, e.g. which use events to track
      number of checkouts and/or time spent with statements

    * connectivity plugins such as proxies

    A rudimentary :class:`_engine.CreateEnginePlugin` that attaches a logger
    to an :class:`_engine.Engine` object might look like::


        import logging

        from sqlalchemy.engine import CreateEnginePlugin
        from sqlalchemy import event

        class LogCursorEventsPlugin(CreateEnginePlugin):
            def __init__(self, url, kwargs):
                # consume the parameter "log_cursor_logging_name" from the
                # URL query
                logging_name = url.query.get("log_cursor_logging_name", "log_cursor")

                self.log = logging.getLogger(logging_name)

            def update_url(self, url):
                "update the URL to one that no longer includes our parameters"
                return url.difference_update_query(["log_cursor_logging_name"])

            def engine_created(self, engine):
                "attach an event listener after the new Engine is constructed"
                event.listen(engine, "before_cursor_execute", self._log_event)


            def _log_event(
                self,
                conn,
                cursor,
                statement,
                parameters,
                context,
                executemany):

                self.log.info("Plugin logged cursor event: %s", statement)



    Plugins are registered using entry points in a similar way as that
    of dialects::

        entry_points={
            'sqlalchemy.plugins': [
                'log_cursor_plugin = myapp.plugins:LogCursorEventsPlugin'
            ]

    A plugin that uses the above names would be invoked from a database
    URL as in::

        from sqlalchemy import create_engine

        engine = create_engine(
            "mysql+pymysql://scott:tiger@localhost/test?"
            "plugin=log_cursor_plugin&log_cursor_logging_name=mylogger"
        )

    The ``plugin`` URL parameter supports multiple instances, so that a URL
    may specify multiple plugins; they are loaded in the order stated
    in the URL::

        engine = create_engine(
          "mysql+pymysql://scott:tiger@localhost/test?"
          "plugin=plugin_one&plugin=plugin_twp&plugin=plugin_three")

    The plugin names may also be passed directly to :func:`_sa.create_engine`
    using the :paramref:`_sa.create_engine.plugins` argument::

        engine = create_engine(
          "mysql+pymysql://scott:tiger@localhost/test",
          plugins=["myplugin"])

    .. versionadded:: 1.2.3  plugin names can also be specified
       to :func:`_sa.create_engine` as a list

    A plugin may consume plugin-specific arguments from the
    :class:`_engine.URL` object as well as the ``kwargs`` dictionary, which is
    the dictionary of arguments passed to the :func:`_sa.create_engine`
    call.  "Consuming" these arguments includes that they must be removed
    when the plugin initializes, so that the arguments are not passed along
    to the :class:`_engine.Dialect` constructor, where they will raise an
    :class:`_exc.ArgumentError` because they are not known by the dialect.

    As of version 1.4 of SQLAlchemy, arguments should continue to be consumed
    from the ``kwargs`` dictionary directly, by removing the values with a
    method such as ``dict.pop``. Arguments from the :class:`_engine.URL` object
    should be consumed by implementing the
    :meth:`_engine.CreateEnginePlugin.update_url` method, returning a new copy
    of the :class:`_engine.URL` with plugin-specific parameters removed::

        class MyPlugin(CreateEnginePlugin):
            def __init__(self, url, kwargs):
                self.my_argument_one = url.query['my_argument_one']
                self.my_argument_two = url.query['my_argument_two']
                self.my_argument_three = kwargs.pop('my_argument_three', None)

            def update_url(self, url):
                return url.difference_update_query(
                    ["my_argument_one", "my_argument_two"]
                )

    Arguments like those illustrated above would be consumed from a
    :func:`_sa.create_engine` call such as::

        from sqlalchemy import create_engine

        engine = create_engine(
          "mysql+pymysql://scott:tiger@localhost/test?"
          "plugin=myplugin&my_argument_one=foo&my_argument_two=bar",
          my_argument_three='bat'
        )

    .. versionchanged:: 1.4

        The :class:`_engine.URL` object is now immutable; a
        :class:`_engine.CreateEnginePlugin` that needs to alter the
        :class:`_engine.URL` should implement the newly added
        :meth:`_engine.CreateEnginePlugin.update_url` method, which
        is invoked after the plugin is constructed.

        For migration, construct the plugin in the following way, checking
        for the existence of the :meth:`_engine.CreateEnginePlugin.update_url`
        method to detect which version is running::

            class MyPlugin(CreateEnginePlugin):
                def __init__(self, url, kwargs):
                    if hasattr(CreateEnginePlugin, "update_url"):
                        # detect the 1.4 API
                        self.my_argument_one = url.query['my_argument_one']
                        self.my_argument_two = url.query['my_argument_two']
                    else:
                        # detect the 1.3 and earlier API - mutate the
                        # URL directly
                        self.my_argument_one = url.query.pop('my_argument_one')
                        self.my_argument_two = url.query.pop('my_argument_two')

                    self.my_argument_three = kwargs.pop('my_argument_three', None)

                def update_url(self, url):
                    # this method is only called in the 1.4 version
                    return url.difference_update_query(
                        ["my_argument_one", "my_argument_two"]
                    )

        .. seealso::

            :ref:`change_5526` - overview of the :class:`_engine.URL` change which
            also includes notes regarding :class:`_engine.CreateEnginePlugin`.


    When the engine creation process completes and produces the
    :class:`_engine.Engine` object, it is again passed to the plugin via the
    :meth:`_engine.CreateEnginePlugin.engine_created` hook.  In this hook, additional
    changes can be made to the engine, most typically involving setup of
    events (e.g. those defined in :ref:`core_event_toplevel`).

    """  # noqa: E501

    def __init__(self, url: URL, kwargs: Dict[str, Any]):
        """Construct a new :class:`.CreateEnginePlugin`.

        The plugin object is instantiated individually for each call
        to :func:`_sa.create_engine`.  A single :class:`_engine.
        Engine` will be
        passed to the :meth:`.CreateEnginePlugin.engine_created` method
        corresponding to this URL.

        :param url: the :class:`_engine.URL` object.  The plugin may inspect
         the :class:`_engine.URL` for arguments.  Arguments used by the
         plugin should be removed, by returning an updated :class:`_engine.URL`
         from the :meth:`_engine.CreateEnginePlugin.update_url` method.

         .. versionchanged::  1.4

            The :class:`_engine.URL` object is now immutable, so a
            :class:`_engine.CreateEnginePlugin` that needs to alter the
            :class:`_engine.URL` object should implement the
            :meth:`_engine.CreateEnginePlugin.update_url` method.

        :param kwargs: The keyword arguments passed to
         :func:`_sa.create_engine`.

        """
        self.url = url

    def update_url(self, url: URL) -> URL:
        """Update the :class:`_engine.URL`.

        A new :class:`_engine.URL` should be returned.   This method is
        typically used to consume configuration arguments from the
        :class:`_engine.URL` which must be removed, as they will not be
        recognized by the dialect.  The
        :meth:`_engine.URL.difference_update_query` method is available
        to remove these arguments.   See the docstring at
        :class:`_engine.CreateEnginePlugin` for an example.


        .. versionadded:: 1.4

        """
        raise NotImplementedError()

    def handle_dialect_kwargs(
        self, dialect_cls: Type[Dialect], dialect_args: Dict[str, Any]
    ) -> None:
        """parse and modify dialect kwargs"""

    def handle_pool_kwargs(
        self, pool_cls: Type[Pool], pool_args: Dict[str, Any]
    ) -> None:
        """parse and modify pool kwargs"""

    def engine_created(self, engine: Engine) -> None:
        """Receive the :class:`_engine.Engine`
        object when it is fully constructed.

        The plugin may make additional changes to the engine, such as
        registering engine or connection pool events.

        """


class ExecutionContext:
    """A messenger object for a Dialect that corresponds to a single
    execution.

    """

    engine: Engine
    """engine which the Connection is associated with"""

    connection: Connection
    """Connection object which can be freely used by default value
      generators to execute SQL.  This Connection should reference the
      same underlying connection/transactional resources of
      root_connection."""

    root_connection: Connection
    """Connection object which is the source of this ExecutionContext."""

    dialect: Dialect
    """dialect which created this ExecutionContext."""

    cursor: DBAPICursor
    """DB-API cursor procured from the connection"""

    compiled: Optional[Compiled]
    """if passed to constructor, sqlalchemy.engine.base.Compiled object
      being executed"""

    statement: str
    """string version of the statement to be executed.  Is either
      passed to the constructor, or must be created from the
      sql.Compiled object by the time pre_exec() has completed."""

    invoked_statement: Optional[Executable]
    """The Executable statement object that was given in the first place.

    This should be structurally equivalent to compiled.statement, but not
    necessarily the same object as in a caching scenario the compiled form
    will have been extracted from the cache.

    """

    parameters: _AnyMultiExecuteParams
    """bind parameters passed to the execute() or exec_driver_sql() methods.

    These are always stored as a list of parameter entries.  A single-element
    list corresponds to a ``cursor.execute()`` call and a multiple-element
    list corresponds to ``cursor.executemany()``, except in the case
    of :attr:`.ExecuteStyle.INSERTMANYVALUES` which will use
    ``cursor.execute()`` one or more times.

    """

    no_parameters: bool
    """True if the execution style does not use parameters"""

    isinsert: bool
    """True if the statement is an INSERT."""

    isupdate: bool
    """True if the statement is an UPDATE."""

    execute_style: ExecuteStyle
    """the style of DBAPI cursor method that will be used to execute
    a statement.

    .. versionadded:: 2.0

    """

    executemany: bool
    """True if the context has a list of more than one parameter set.

    Historically this attribute links to whether ``cursor.execute()`` or
    ``cursor.executemany()`` will be used.  It also can now mean that
    "insertmanyvalues" may be used which indicates one or more
    ``cursor.execute()`` calls.

    """

    prefetch_cols: util.generic_fn_descriptor[Optional[Sequence[Column[Any]]]]
    """a list of Column objects for which a client-side default
      was fired off.  Applies to inserts and updates."""

    postfetch_cols: util.generic_fn_descriptor[Optional[Sequence[Column[Any]]]]
    """a list of Column objects for which a server-side default or
      inline SQL expression value was fired off.  Applies to inserts
      and updates."""

    @classmethod
    def _init_ddl(
        cls,
        dialect: Dialect,
        connection: Connection,
        dbapi_connection: PoolProxiedConnection,
        execution_options: _ExecuteOptions,
        compiled_ddl: DDLCompiler,
    ) -> ExecutionContext:
        raise NotImplementedError()

    @classmethod
    def _init_compiled(
        cls,
        dialect: Dialect,
        connection: Connection,
        dbapi_connection: PoolProxiedConnection,
        execution_options: _ExecuteOptions,
        compiled: SQLCompiler,
        parameters: _CoreMultiExecuteParams,
        invoked_statement: Executable,
        extracted_parameters: Optional[Sequence[BindParameter[Any]]],
        cache_hit: CacheStats = CacheStats.CACHING_DISABLED,
    ) -> ExecutionContext:
        raise NotImplementedError()

    @classmethod
    def _init_statement(
        cls,
        dialect: Dialect,
        connection: Connection,
        dbapi_connection: PoolProxiedConnection,
        execution_options: _ExecuteOptions,
        statement: str,
        parameters: _DBAPIMultiExecuteParams,
    ) -> ExecutionContext:
        raise NotImplementedError()

    @classmethod
    def _init_default(
        cls,
        dialect: Dialect,
        connection: Connection,
        dbapi_connection: PoolProxiedConnection,
        execution_options: _ExecuteOptions,
    ) -> ExecutionContext:
        raise NotImplementedError()

    def _exec_default(
        self,
        column: Optional[Column[Any]],
        default: DefaultGenerator,
        type_: Optional[TypeEngine[Any]],
    ) -> Any:
        raise NotImplementedError()

    def _prepare_set_input_sizes(
        self,
    ) -> Optional[List[Tuple[str, Any, TypeEngine[Any]]]]:
        raise NotImplementedError()

    def _get_cache_stats(self) -> str:
        raise NotImplementedError()

    def _setup_result_proxy(self) -> CursorResult[Any]:
        raise NotImplementedError()

    def fire_sequence(self, seq: Sequence_SchemaItem, type_: Integer) -> int:
        """given a :class:`.Sequence`, invoke it and return the next int
        value"""
        raise NotImplementedError()

    def create_cursor(self) -> DBAPICursor:
        """Return a new cursor generated from this ExecutionContext's
        connection.

        Some dialects may wish to change the behavior of
        connection.cursor(), such as postgresql which may return a PG
        "server side" cursor.
        """

        raise NotImplementedError()

    def pre_exec(self) -> None:
        """Called before an execution of a compiled statement.

        If a compiled statement was passed to this ExecutionContext,
        the `statement` and `parameters` datamembers must be
        initialized after this statement is complete.
        """

        raise NotImplementedError()

    def get_out_parameter_values(
        self, out_param_names: Sequence[str]
    ) -> Sequence[Any]:
        """Return a sequence of OUT parameter values from a cursor.

        For dialects that support OUT parameters, this method will be called
        when there is a :class:`.SQLCompiler` object which has the
        :attr:`.SQLCompiler.has_out_parameters` flag set.  This flag in turn
        will be set to True if the statement itself has :class:`.BindParameter`
        objects that have the ``.isoutparam`` flag set which are consumed by
        the :meth:`.SQLCompiler.visit_bindparam` method.  If the dialect
        compiler produces :class:`.BindParameter` objects with ``.isoutparam``
        set which are not handled by :meth:`.SQLCompiler.visit_bindparam`, it
        should set this flag explicitly.

        The list of names that were rendered for each bound parameter
        is passed to the method.  The method should then return a sequence of
        values corresponding to the list of parameter objects. Unlike in
        previous SQLAlchemy versions, the values can be the **raw values** from
        the DBAPI; the execution context will apply the appropriate type
        handler based on what's present in self.compiled.binds and update the
        values.  The processed dictionary will then be made available via the
        ``.out_parameters`` collection on the result object.  Note that
        SQLAlchemy 1.4 has multiple kinds of result object as part of the 2.0
        transition.

        .. versionadded:: 1.4 - added
           :meth:`.ExecutionContext.get_out_parameter_values`, which is invoked
           automatically by the :class:`.DefaultExecutionContext` when there
           are :class:`.BindParameter` objects with the ``.isoutparam`` flag
           set.  This replaces the practice of setting out parameters within
           the now-removed ``get_result_proxy()`` method.

        """
        raise NotImplementedError()

    def post_exec(self) -> None:
        """Called after the execution of a compiled statement.

        If a compiled statement was passed to this ExecutionContext,
        the `last_insert_ids`, `last_inserted_params`, etc.
        datamembers should be available after this method completes.
        """

        raise NotImplementedError()

    def handle_dbapi_exception(self, e: BaseException) -> None:
        """Receive a DBAPI exception which occurred upon execute, result
        fetch, etc."""

        raise NotImplementedError()

    def lastrow_has_defaults(self) -> bool:
        """Return True if the last INSERT or UPDATE row contained
        inlined or database-side defaults.
        """

        raise NotImplementedError()

    def get_rowcount(self) -> Optional[int]:
        """Return the DBAPI ``cursor.rowcount`` value, or in some
        cases an interpreted value.

        See :attr:`_engine.CursorResult.rowcount` for details on this.

        """

        raise NotImplementedError()

    def fetchall_for_returning(self, cursor: DBAPICursor) -> Sequence[Any]:
        """For a RETURNING result, deliver cursor.fetchall() from the
        DBAPI cursor.

        This is a dialect-specific hook for dialects that have special
        considerations when calling upon the rows delivered for a
        "RETURNING" statement.   Default implementation is
        ``cursor.fetchall()``.

        This hook is currently used only by the :term:`insertmanyvalues`
        feature.   Dialects that don't set ``use_insertmanyvalues=True``
        don't need to consider this hook.

        .. versionadded:: 2.0.10

        """
        raise NotImplementedError()


class ConnectionEventsTarget(EventTarget):
    """An object which can accept events from :class:`.ConnectionEvents`.

    Includes :class:`_engine.Connection` and :class:`_engine.Engine`.

    .. versionadded:: 2.0

    """

    dispatch: dispatcher[ConnectionEventsTarget]


Connectable = ConnectionEventsTarget


class ExceptionContext:
    """Encapsulate information about an error condition in progress.

    This object exists solely to be passed to the
    :meth:`_events.DialectEvents.handle_error` event,
    supporting an interface that
    can be extended without backwards-incompatibility.


    """

    __slots__ = ()

    dialect: Dialect
    """The :class:`_engine.Dialect` in use.

    This member is present for all invocations of the event hook.

    .. versionadded:: 2.0

    """

    connection: Optional[Connection]
    """The :class:`_engine.Connection` in use during the exception.

    This member is present, except in the case of a failure when
    first connecting.

    .. seealso::

        :attr:`.ExceptionContext.engine`


    """

    engine: Optional[Engine]
    """The :class:`_engine.Engine` in use during the exception.

    This member is present in all cases except for when handling an error
    within the connection pool "pre-ping" process.

    """

    cursor: Optional[DBAPICursor]
    """The DBAPI cursor object.

    May be None.

    """

    statement: Optional[str]
    """String SQL statement that was emitted directly to the DBAPI.

    May be None.

    """

    parameters: Optional[_DBAPIAnyExecuteParams]
    """Parameter collection that was emitted directly to the DBAPI.

    May be None.

    """

    original_exception: BaseException
    """The exception object which was caught.

    This member is always present.

    """

    sqlalchemy_exception: Optional[StatementError]
    """The :class:`sqlalchemy.exc.StatementError` which wraps the original,
    and will be raised if exception handling is not circumvented by the event.

    May be None, as not all exception types are wrapped by SQLAlchemy.
    For DBAPI-level exceptions that subclass the dbapi's Error class, this
    field will always be present.

    """

    chained_exception: Optional[BaseException]
    """The exception that was returned by the previous handler in the
    exception chain, if any.

    If present, this exception will be the one ultimately raised by
    SQLAlchemy unless a subsequent handler replaces it.

    May be None.

    """

    execution_context: Optional[ExecutionContext]
    """The :class:`.ExecutionContext` corresponding to the execution
    operation in progress.

    This is present for statement execution operations, but not for
    operations such as transaction begin/end.  It also is not present when
    the exception was raised before the :class:`.ExecutionContext`
    could be constructed.

    Note that the :attr:`.ExceptionContext.statement` and
    :attr:`.ExceptionContext.parameters` members may represent a
    different value than that of the :class:`.ExecutionContext`,
    potentially in the case where a
    :meth:`_events.ConnectionEvents.before_cursor_execute` event or similar
    modified the statement/parameters to be sent.

    May be None.

    """

    is_disconnect: bool
    """Represent whether the exception as occurred represents a "disconnect"
    condition.

    This flag will always be True or False within the scope of the
    :meth:`_events.DialectEvents.handle_error` handler.

    SQLAlchemy will defer to this flag in order to determine whether or not
    the connection should be invalidated subsequently.    That is, by
    assigning to this flag, a "disconnect" event which then results in
    a connection and pool invalidation can be invoked or prevented by
    changing this flag.


    .. note:: The pool "pre_ping" handler enabled using the
        :paramref:`_sa.create_engine.pool_pre_ping` parameter does **not**
        consult this event before deciding if the "ping" returned false,
        as opposed to receiving an unhandled error.   For this use case, the
        :ref:`legacy recipe based on engine_connect() may be used
        <pool_disconnects_pessimistic_custom>`.  A future API allow more
        comprehensive customization of the "disconnect" detection mechanism
        across all functions.

    """

    invalidate_pool_on_disconnect: bool
    """Represent whether all connections in the pool should be invalidated
    when a "disconnect" condition is in effect.

    Setting this flag to False within the scope of the
    :meth:`_events.DialectEvents.handle_error`
    event will have the effect such
    that the full collection of connections in the pool will not be
    invalidated during a disconnect; only the current connection that is the
    subject of the error will actually be invalidated.

    The purpose of this flag is for custom disconnect-handling schemes where
    the invalidation of other connections in the pool is to be performed
    based on other conditions, or even on a per-connection basis.

    """

    is_pre_ping: bool
    """Indicates if this error is occurring within the "pre-ping" step
    performed when :paramref:`_sa.create_engine.pool_pre_ping` is set to
    ``True``.  In this mode, the :attr:`.ExceptionContext.engine` attribute
    will be ``None``.  The dialect in use is accessible via the
    :attr:`.ExceptionContext.dialect` attribute.

    .. versionadded:: 2.0.5

    """


class AdaptedConnection:
    """Interface of an adapted connection object to support the DBAPI protocol.

    Used by asyncio dialects to provide a sync-style pep-249 facade on top
    of the asyncio connection/cursor API provided by the driver.

    .. versionadded:: 1.4.24

    """

    __slots__ = ("_connection",)

    _connection: Any

    @property
    def driver_connection(self) -> Any:
        """The connection object as returned by the driver after a connect."""
        return self._connection

    def run_async(self, fn: Callable[[Any], Awaitable[_T]]) -> _T:
        """Run the awaitable returned by the given function, which is passed
        the raw asyncio driver connection.

        This is used to invoke awaitable-only methods on the driver connection
        within the context of a "synchronous" method, like a connection
        pool event handler.

        E.g.::

            engine = create_async_engine(...)

            @event.listens_for(engine.sync_engine, "connect")
            def register_custom_types(dbapi_connection, ...):
                dbapi_connection.run_async(
                    lambda connection: connection.set_type_codec(
                        'MyCustomType', encoder, decoder, ...
                    )
                )

        .. versionadded:: 1.4.30

        .. seealso::

            :ref:`asyncio_events_run_async`

        """
        return await_only(fn(self._connection))

    def __repr__(self) -> str:
        return "<AdaptedConnection %s>" % self._connection
