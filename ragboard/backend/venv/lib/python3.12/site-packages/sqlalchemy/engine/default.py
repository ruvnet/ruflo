# engine/default.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Default implementations of per-dialect sqlalchemy.engine classes.

These are semi-private implementation classes which are only of importance
to database dialect authors; dialects will usually use the classes here
as the base class for their own corresponding classes.

"""

from __future__ import annotations

import functools
import operator
import random
import re
from time import perf_counter
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import List
from typing import Mapping
from typing import MutableMapping
from typing import MutableSequence
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import Union
import weakref

from . import characteristics
from . import cursor as _cursor
from . import interfaces
from .base import Connection
from .interfaces import CacheStats
from .interfaces import DBAPICursor
from .interfaces import Dialect
from .interfaces import ExecuteStyle
from .interfaces import ExecutionContext
from .reflection import ObjectKind
from .reflection import ObjectScope
from .. import event
from .. import exc
from .. import pool
from .. import util
from ..sql import compiler
from ..sql import dml
from ..sql import expression
from ..sql import type_api
from ..sql._typing import is_tuple_type
from ..sql.base import _NoArg
from ..sql.compiler import DDLCompiler
from ..sql.compiler import InsertmanyvaluesSentinelOpts
from ..sql.compiler import SQLCompiler
from ..sql.elements import quoted_name
from ..util.typing import Final
from ..util.typing import Literal

if typing.TYPE_CHECKING:
    from types import ModuleType

    from .base import Engine
    from .cursor import ResultFetchStrategy
    from .interfaces import _CoreMultiExecuteParams
    from .interfaces import _CoreSingleExecuteParams
    from .interfaces import _DBAPICursorDescription
    from .interfaces import _DBAPIMultiExecuteParams
    from .interfaces import _ExecuteOptions
    from .interfaces import _MutableCoreSingleExecuteParams
    from .interfaces import _ParamStyle
    from .interfaces import DBAPIConnection
    from .interfaces import IsolationLevel
    from .row import Row
    from .url import URL
    from ..event import _ListenerFnType
    from ..pool import Pool
    from ..pool import PoolProxiedConnection
    from ..sql import Executable
    from ..sql.compiler import Compiled
    from ..sql.compiler import Linting
    from ..sql.compiler import ResultColumnsEntry
    from ..sql.dml import DMLState
    from ..sql.dml import UpdateBase
    from ..sql.elements import BindParameter
    from ..sql.schema import Column
    from ..sql.type_api import _BindProcessorType
    from ..sql.type_api import TypeEngine

# When we're handed literal SQL, ensure it's a SELECT query
SERVER_SIDE_CURSOR_RE = re.compile(r"\s*SELECT", re.I | re.UNICODE)


(
    CACHE_HIT,
    CACHE_MISS,
    CACHING_DISABLED,
    NO_CACHE_KEY,
    NO_DIALECT_SUPPORT,
) = list(CacheStats)


class DefaultDialect(Dialect):
    """Default implementation of Dialect"""

    statement_compiler = compiler.SQLCompiler
    ddl_compiler = compiler.DDLCompiler
    type_compiler_cls = compiler.GenericTypeCompiler

    preparer = compiler.IdentifierPreparer
    supports_alter = True
    supports_comments = False
    supports_constraint_comments = False
    inline_comments = False
    supports_statement_cache = True

    div_is_floordiv = True

    bind_typing = interfaces.BindTyping.NONE

    include_set_input_sizes: Optional[Set[Any]] = None
    exclude_set_input_sizes: Optional[Set[Any]] = None

    # the first value we'd get for an autoincrement column.
    default_sequence_base = 1

    # most DBAPIs happy with this for execute().
    # not cx_oracle.
    execute_sequence_format = tuple

    supports_schemas = True
    supports_views = True
    supports_sequences = False
    sequences_optional = False
    preexecute_autoincrement_sequences = False
    supports_identity_columns = False
    postfetch_lastrowid = True
    favor_returning_over_lastrowid = False
    insert_null_pk_still_autoincrements = False
    update_returning = False
    delete_returning = False
    update_returning_multifrom = False
    delete_returning_multifrom = False
    insert_returning = False

    cte_follows_insert = False

    supports_native_enum = False
    supports_native_boolean = False
    supports_native_uuid = False
    returns_native_bytes = False

    non_native_boolean_check_constraint = True

    supports_simple_order_by_label = True

    tuple_in_values = False

    connection_characteristics = util.immutabledict(
        {"isolation_level": characteristics.IsolationLevelCharacteristic()}
    )

    engine_config_types: Mapping[str, Any] = util.immutabledict(
        {
            "pool_timeout": util.asint,
            "echo": util.bool_or_str("debug"),
            "echo_pool": util.bool_or_str("debug"),
            "pool_recycle": util.asint,
            "pool_size": util.asint,
            "max_overflow": util.asint,
            "future": util.asbool,
        }
    )

    # if the NUMERIC type
    # returns decimal.Decimal.
    # *not* the FLOAT type however.
    supports_native_decimal = False

    name = "default"

    # length at which to truncate
    # any identifier.
    max_identifier_length = 9999
    _user_defined_max_identifier_length: Optional[int] = None

    isolation_level: Optional[str] = None

    # sub-categories of max_identifier_length.
    # currently these accommodate for MySQL which allows alias names
    # of 255 but DDL names only of 64.
    max_index_name_length: Optional[int] = None
    max_constraint_name_length: Optional[int] = None

    supports_sane_rowcount = True
    supports_sane_multi_rowcount = True
    colspecs: MutableMapping[Type[TypeEngine[Any]], Type[TypeEngine[Any]]] = {}
    default_paramstyle = "named"

    supports_default_values = False
    """dialect supports INSERT... DEFAULT VALUES syntax"""

    supports_default_metavalue = False
    """dialect supports INSERT... VALUES (DEFAULT) syntax"""

    default_metavalue_token = "DEFAULT"
    """for INSERT... VALUES (DEFAULT) syntax, the token to put in the
    parenthesis."""

    # not sure if this is a real thing but the compiler will deliver it
    # if this is the only flag enabled.
    supports_empty_insert = True
    """dialect supports INSERT () VALUES ()"""

    supports_multivalues_insert = False

    use_insertmanyvalues: bool = False

    use_insertmanyvalues_wo_returning: bool = False

    insertmanyvalues_implicit_sentinel: InsertmanyvaluesSentinelOpts = (
        InsertmanyvaluesSentinelOpts.NOT_SUPPORTED
    )

    insertmanyvalues_page_size: int = 1000
    insertmanyvalues_max_parameters = 32700

    supports_is_distinct_from = True

    supports_server_side_cursors = False

    server_side_cursors = False

    # extra record-level locking features (#4860)
    supports_for_update_of = False

    server_version_info = None

    default_schema_name: Optional[str] = None

    # indicates symbol names are
    # UPPERCASEd if they are case insensitive
    # within the database.
    # if this is True, the methods normalize_name()
    # and denormalize_name() must be provided.
    requires_name_normalize = False

    is_async = False

    has_terminate = False

    # TODO: this is not to be part of 2.0.  implement rudimentary binary
    # literals for SQLite, PostgreSQL, MySQL only within
    # _Binary.literal_processor
    _legacy_binary_type_literal_encoding = "utf-8"

    @util.deprecated_params(
        empty_in_strategy=(
            "1.4",
            "The :paramref:`_sa.create_engine.empty_in_strategy` keyword is "
            "deprecated, and no longer has any effect.  All IN expressions "
            "are now rendered using "
            'the "expanding parameter" strategy which renders a set of bound'
            'expressions, or an "empty set" SELECT, at statement execution'
            "time.",
        ),
        server_side_cursors=(
            "1.4",
            "The :paramref:`_sa.create_engine.server_side_cursors` parameter "
            "is deprecated and will be removed in a future release.  Please "
            "use the "
            ":paramref:`_engine.Connection.execution_options.stream_results` "
            "parameter.",
        ),
    )
    def __init__(
        self,
        paramstyle: Optional[_ParamStyle] = None,
        isolation_level: Optional[IsolationLevel] = None,
        dbapi: Optional[ModuleType] = None,
        implicit_returning: Literal[True] = True,
        supports_native_boolean: Optional[bool] = None,
        max_identifier_length: Optional[int] = None,
        label_length: Optional[int] = None,
        insertmanyvalues_page_size: Union[_NoArg, int] = _NoArg.NO_ARG,
        use_insertmanyvalues: Optional[bool] = None,
        # util.deprecated_params decorator cannot render the
        # Linting.NO_LINTING constant
        compiler_linting: Linting = int(compiler.NO_LINTING),  # type: ignore
        server_side_cursors: bool = False,
        **kwargs: Any,
    ):
        if server_side_cursors:
            if not self.supports_server_side_cursors:
                raise exc.ArgumentError(
                    "Dialect %s does not support server side cursors" % self
                )
            else:
                self.server_side_cursors = True

        if getattr(self, "use_setinputsizes", False):
            util.warn_deprecated(
                "The dialect-level use_setinputsizes attribute is "
                "deprecated.  Please use "
                "bind_typing = BindTyping.SETINPUTSIZES",
                "2.0",
            )
            self.bind_typing = interfaces.BindTyping.SETINPUTSIZES

        self.positional = False
        self._ischema = None

        self.dbapi = dbapi

        if paramstyle is not None:
            self.paramstyle = paramstyle
        elif self.dbapi is not None:
            self.paramstyle = self.dbapi.paramstyle
        else:
            self.paramstyle = self.default_paramstyle
        self.positional = self.paramstyle in (
            "qmark",
            "format",
            "numeric",
            "numeric_dollar",
        )
        self.identifier_preparer = self.preparer(self)
        self._on_connect_isolation_level = isolation_level

        legacy_tt_callable = getattr(self, "type_compiler", None)
        if legacy_tt_callable is not None:
            tt_callable = cast(
                Type[compiler.GenericTypeCompiler],
                self.type_compiler,
            )
        else:
            tt_callable = self.type_compiler_cls

        self.type_compiler_instance = self.type_compiler = tt_callable(self)

        if supports_native_boolean is not None:
            self.supports_native_boolean = supports_native_boolean

        self._user_defined_max_identifier_length = max_identifier_length
        if self._user_defined_max_identifier_length:
            self.max_identifier_length = (
                self._user_defined_max_identifier_length
            )
        self.label_length = label_length
        self.compiler_linting = compiler_linting

        if use_insertmanyvalues is not None:
            self.use_insertmanyvalues = use_insertmanyvalues

        if insertmanyvalues_page_size is not _NoArg.NO_ARG:
            self.insertmanyvalues_page_size = insertmanyvalues_page_size

    @property
    @util.deprecated(
        "2.0",
        "full_returning is deprecated, please use insert_returning, "
        "update_returning, delete_returning",
    )
    def full_returning(self):
        return (
            self.insert_returning
            and self.update_returning
            and self.delete_returning
        )

    @util.memoized_property
    def insert_executemany_returning(self):
        """Default implementation for insert_executemany_returning, if not
        otherwise overridden by the specific dialect.

        The default dialect determines "insert_executemany_returning" is
        available if the dialect in use has opted into using the
        "use_insertmanyvalues" feature. If they haven't opted into that, then
        this attribute is False, unless the dialect in question overrides this
        and provides some other implementation (such as the Oracle dialect).

        """
        return self.insert_returning and self.use_insertmanyvalues

    @util.memoized_property
    def insert_executemany_returning_sort_by_parameter_order(self):
        """Default implementation for
        insert_executemany_returning_deterministic_order, if not otherwise
        overridden by the specific dialect.

        The default dialect determines "insert_executemany_returning" can have
        deterministic order only if the dialect in use has opted into using the
        "use_insertmanyvalues" feature, which implements deterministic ordering
        using client side sentinel columns only by default.  The
        "insertmanyvalues" feature also features alternate forms that can
        use server-generated PK values as "sentinels", but those are only
        used if the :attr:`.Dialect.insertmanyvalues_implicit_sentinel`
        bitflag enables those alternate SQL forms, which are disabled
        by default.

        If the dialect in use hasn't opted into that, then this attribute is
        False, unless the dialect in question overrides this and provides some
        other implementation (such as the Oracle dialect).

        """
        return self.insert_returning and self.use_insertmanyvalues

    update_executemany_returning = False
    delete_executemany_returning = False

    @util.memoized_property
    def loaded_dbapi(self) -> ModuleType:
        if self.dbapi is None:
            raise exc.InvalidRequestError(
                f"Dialect {self} does not have a Python DBAPI established "
                "and cannot be used for actual database interaction"
            )
        return self.dbapi

    @util.memoized_property
    def _bind_typing_render_casts(self):
        return self.bind_typing is interfaces.BindTyping.RENDER_CASTS

    def _ensure_has_table_connection(self, arg):
        if not isinstance(arg, Connection):
            raise exc.ArgumentError(
                "The argument passed to Dialect.has_table() should be a "
                "%s, got %s. "
                "Additionally, the Dialect.has_table() method is for "
                "internal dialect "
                "use only; please use "
                "``inspect(some_engine).has_table(<tablename>>)`` "
                "for public API use." % (Connection, type(arg))
            )

    @util.memoized_property
    def _supports_statement_cache(self):
        ssc = self.__class__.__dict__.get("supports_statement_cache", None)
        if ssc is None:
            util.warn(
                "Dialect %s:%s will not make use of SQL compilation caching "
                "as it does not set the 'supports_statement_cache' attribute "
                "to ``True``.  This can have "
                "significant performance implications including some "
                "performance degradations in comparison to prior SQLAlchemy "
                "versions.  Dialect maintainers should seek to set this "
                "attribute to True after appropriate development and testing "
                "for SQLAlchemy 1.4 caching support.   Alternatively, this "
                "attribute may be set to False which will disable this "
                "warning." % (self.name, self.driver),
                code="cprf",
            )

        return bool(ssc)

    @util.memoized_property
    def _type_memos(self):
        return weakref.WeakKeyDictionary()

    @property
    def dialect_description(self):
        return self.name + "+" + self.driver

    @property
    def supports_sane_rowcount_returning(self):
        """True if this dialect supports sane rowcount even if RETURNING is
        in use.

        For dialects that don't support RETURNING, this is synonymous with
        ``supports_sane_rowcount``.

        """
        return self.supports_sane_rowcount

    @classmethod
    def get_pool_class(cls, url: URL) -> Type[Pool]:
        return getattr(cls, "poolclass", pool.QueuePool)

    def get_dialect_pool_class(self, url: URL) -> Type[Pool]:
        return self.get_pool_class(url)

    @classmethod
    def load_provisioning(cls):
        package = ".".join(cls.__module__.split(".")[0:-1])
        try:
            __import__(package + ".provision")
        except ImportError:
            pass

    def _builtin_onconnect(self) -> Optional[_ListenerFnType]:
        if self._on_connect_isolation_level is not None:

            def builtin_connect(dbapi_conn, conn_rec):
                self._assert_and_set_isolation_level(
                    dbapi_conn, self._on_connect_isolation_level
                )

            return builtin_connect
        else:
            return None

    def initialize(self, connection):
        try:
            self.server_version_info = self._get_server_version_info(
                connection
            )
        except NotImplementedError:
            self.server_version_info = None
        try:
            self.default_schema_name = self._get_default_schema_name(
                connection
            )
        except NotImplementedError:
            self.default_schema_name = None

        try:
            self.default_isolation_level = self.get_default_isolation_level(
                connection.connection.dbapi_connection
            )
        except NotImplementedError:
            self.default_isolation_level = None

        if not self._user_defined_max_identifier_length:
            max_ident_length = self._check_max_identifier_length(connection)
            if max_ident_length:
                self.max_identifier_length = max_ident_length

        if (
            self.label_length
            and self.label_length > self.max_identifier_length
        ):
            raise exc.ArgumentError(
                "Label length of %d is greater than this dialect's"
                " maximum identifier length of %d"
                % (self.label_length, self.max_identifier_length)
            )

    def on_connect(self):
        # inherits the docstring from interfaces.Dialect.on_connect
        return None

    def _check_max_identifier_length(self, connection):
        """Perform a connection / server version specific check to determine
        the max_identifier_length.

        If the dialect's class level max_identifier_length should be used,
        can return None.

        .. versionadded:: 1.3.9

        """
        return None

    def get_default_isolation_level(self, dbapi_conn):
        """Given a DBAPI connection, return its isolation level, or
        a default isolation level if one cannot be retrieved.

        May be overridden by subclasses in order to provide a
        "fallback" isolation level for databases that cannot reliably
        retrieve the actual isolation level.

        By default, calls the :meth:`_engine.Interfaces.get_isolation_level`
        method, propagating any exceptions raised.

        .. versionadded:: 1.3.22

        """
        return self.get_isolation_level(dbapi_conn)

    def type_descriptor(self, typeobj):
        """Provide a database-specific :class:`.TypeEngine` object, given
        the generic object which comes from the types module.

        This method looks for a dictionary called
        ``colspecs`` as a class or instance-level variable,
        and passes on to :func:`_types.adapt_type`.

        """
        return type_api.adapt_type(typeobj, self.colspecs)

    def has_index(self, connection, table_name, index_name, schema=None, **kw):
        if not self.has_table(connection, table_name, schema=schema, **kw):
            return False
        for idx in self.get_indexes(
            connection, table_name, schema=schema, **kw
        ):
            if idx["name"] == index_name:
                return True
        else:
            return False

    def has_schema(
        self, connection: Connection, schema_name: str, **kw: Any
    ) -> bool:
        return schema_name in self.get_schema_names(connection, **kw)

    def validate_identifier(self, ident):
        if len(ident) > self.max_identifier_length:
            raise exc.IdentifierError(
                "Identifier '%s' exceeds maximum length of %d characters"
                % (ident, self.max_identifier_length)
            )

    def connect(self, *cargs, **cparams):
        # inherits the docstring from interfaces.Dialect.connect
        return self.loaded_dbapi.connect(*cargs, **cparams)

    def create_connect_args(self, url):
        # inherits the docstring from interfaces.Dialect.create_connect_args
        opts = url.translate_connect_args()
        opts.update(url.query)
        return ([], opts)

    def set_engine_execution_options(
        self, engine: Engine, opts: Mapping[str, Any]
    ) -> None:
        supported_names = set(self.connection_characteristics).intersection(
            opts
        )
        if supported_names:
            characteristics: Mapping[str, Any] = util.immutabledict(
                (name, opts[name]) for name in supported_names
            )

            @event.listens_for(engine, "engine_connect")
            def set_connection_characteristics(connection):
                self._set_connection_characteristics(
                    connection, characteristics
                )

    def set_connection_execution_options(
        self, connection: Connection, opts: Mapping[str, Any]
    ) -> None:
        supported_names = set(self.connection_characteristics).intersection(
            opts
        )
        if supported_names:
            characteristics: Mapping[str, Any] = util.immutabledict(
                (name, opts[name]) for name in supported_names
            )
            self._set_connection_characteristics(connection, characteristics)

    def _set_connection_characteristics(self, connection, characteristics):
        characteristic_values = [
            (name, self.connection_characteristics[name], value)
            for name, value in characteristics.items()
        ]

        if connection.in_transaction():
            trans_objs = [
                (name, obj)
                for name, obj, value in characteristic_values
                if obj.transactional
            ]
            if trans_objs:
                raise exc.InvalidRequestError(
                    "This connection has already initialized a SQLAlchemy "
                    "Transaction() object via begin() or autobegin; "
                    "%s may not be altered unless rollback() or commit() "
                    "is called first."
                    % (", ".join(name for name, obj in trans_objs))
                )

        dbapi_connection = connection.connection.dbapi_connection
        for name, characteristic, value in characteristic_values:
            characteristic.set_characteristic(self, dbapi_connection, value)
        connection.connection._connection_record.finalize_callback.append(
            functools.partial(self._reset_characteristics, characteristics)
        )

    def _reset_characteristics(self, characteristics, dbapi_connection):
        for characteristic_name in characteristics:
            characteristic = self.connection_characteristics[
                characteristic_name
            ]
            characteristic.reset_characteristic(self, dbapi_connection)

    def do_begin(self, dbapi_connection):
        pass

    def do_rollback(self, dbapi_connection):
        dbapi_connection.rollback()

    def do_commit(self, dbapi_connection):
        dbapi_connection.commit()

    def do_terminate(self, dbapi_connection):
        self.do_close(dbapi_connection)

    def do_close(self, dbapi_connection):
        dbapi_connection.close()

    @util.memoized_property
    def _dialect_specific_select_one(self):
        return str(expression.select(1).compile(dialect=self))

    def _do_ping_w_event(self, dbapi_connection: DBAPIConnection) -> bool:
        try:
            return self.do_ping(dbapi_connection)
        except self.loaded_dbapi.Error as err:
            is_disconnect = self.is_disconnect(err, dbapi_connection, None)

            if self._has_events:
                try:
                    Connection._handle_dbapi_exception_noconnection(
                        err,
                        self,
                        is_disconnect=is_disconnect,
                        invalidate_pool_on_disconnect=False,
                        is_pre_ping=True,
                    )
                except exc.StatementError as new_err:
                    is_disconnect = new_err.connection_invalidated

            if is_disconnect:
                return False
            else:
                raise

    def do_ping(self, dbapi_connection: DBAPIConnection) -> bool:
        cursor = None

        cursor = dbapi_connection.cursor()
        try:
            cursor.execute(self._dialect_specific_select_one)
        finally:
            cursor.close()
        return True

    def create_xid(self):
        """Create a random two-phase transaction ID.

        This id will be passed to do_begin_twophase(), do_rollback_twophase(),
        do_commit_twophase().  Its format is unspecified.
        """

        return "_sa_%032x" % random.randint(0, 2**128)

    def do_savepoint(self, connection, name):
        connection.execute(expression.SavepointClause(name))

    def do_rollback_to_savepoint(self, connection, name):
        connection.execute(expression.RollbackToSavepointClause(name))

    def do_release_savepoint(self, connection, name):
        connection.execute(expression.ReleaseSavepointClause(name))

    def _deliver_insertmanyvalues_batches(
        self, cursor, statement, parameters, generic_setinputsizes, context
    ):
        context = cast(DefaultExecutionContext, context)
        compiled = cast(SQLCompiler, context.compiled)

        imv = compiled._insertmanyvalues
        assert imv is not None

        is_returning: Final[bool] = bool(compiled.effective_returning)
        batch_size = context.execution_options.get(
            "insertmanyvalues_page_size", self.insertmanyvalues_page_size
        )

        sentinel_value_resolvers = None

        if is_returning:
            result: Optional[List[Any]] = []
            context._insertmanyvalues_rows = result

            sort_by_parameter_order = imv.sort_by_parameter_order

            if imv.num_sentinel_columns:
                sentinel_value_resolvers = (
                    compiled._imv_sentinel_value_resolvers
                )
        else:
            sort_by_parameter_order = False
            result = None

        for imv_batch in compiled._deliver_insertmanyvalues_batches(
            statement,
            parameters,
            generic_setinputsizes,
            batch_size,
            sort_by_parameter_order,
        ):
            yield imv_batch

            if is_returning:
                rows = context.fetchall_for_returning(cursor)

                # I would have thought "is_returning: Final[bool]"
                # would have assured this but pylance thinks not
                assert result is not None

                if imv.num_sentinel_columns and not imv_batch.is_downgraded:
                    composite_sentinel = imv.num_sentinel_columns > 1
                    if imv.implicit_sentinel:
                        # for implicit sentinel, which is currently single-col
                        # integer autoincrement, do a simple sort.
                        assert not composite_sentinel
                        result.extend(
                            sorted(rows, key=operator.itemgetter(-1))
                        )
                        continue

                    # otherwise, create dictionaries to match up batches
                    # with parameters
                    assert imv.sentinel_param_keys

                    if composite_sentinel:
                        _nsc = imv.num_sentinel_columns
                        rows_by_sentinel = {
                            tuple(row[-_nsc:]): row for row in rows
                        }
                    else:
                        rows_by_sentinel = {row[-1]: row for row in rows}

                    if len(rows_by_sentinel) != len(imv_batch.batch):
                        # see test_insert_exec.py::
                        # IMVSentinelTest::test_sentinel_incorrect_rowcount
                        # for coverage / demonstration
                        raise exc.InvalidRequestError(
                            f"Sentinel-keyed result set did not produce "
                            f"correct number of rows {len(imv_batch.batch)}; "
                            "produced "
                            f"{len(rows_by_sentinel)}.  Please ensure the "
                            "sentinel column is fully unique and populated in "
                            "all cases."
                        )

                    try:
                        if composite_sentinel:
                            if sentinel_value_resolvers:
                                # composite sentinel (PK) with value resolvers
                                ordered_rows = [
                                    rows_by_sentinel[
                                        tuple(
                                            _resolver(parameters[_spk])  # type: ignore  # noqa: E501
                                            if _resolver
                                            else parameters[_spk]  # type: ignore  # noqa: E501
                                            for _resolver, _spk in zip(
                                                sentinel_value_resolvers,
                                                imv.sentinel_param_keys,
                                            )
                                        )
                                    ]
                                    for parameters in imv_batch.batch
                                ]
                            else:
                                # composite sentinel (PK) with no value
                                # resolvers
                                ordered_rows = [
                                    rows_by_sentinel[
                                        tuple(
                                            parameters[_spk]  # type: ignore
                                            for _spk in imv.sentinel_param_keys
                                        )
                                    ]
                                    for parameters in imv_batch.batch
                                ]
                        else:
                            _sentinel_param_key = imv.sentinel_param_keys[0]
                            if (
                                sentinel_value_resolvers
                                and sentinel_value_resolvers[0]
                            ):
                                # single-column sentinel with value resolver
                                _sentinel_value_resolver = (
                                    sentinel_value_resolvers[0]
                                )
                                ordered_rows = [
                                    rows_by_sentinel[
                                        _sentinel_value_resolver(
                                            parameters[_sentinel_param_key]  # type: ignore  # noqa: E501
                                        )
                                    ]
                                    for parameters in imv_batch.batch
                                ]
                            else:
                                # single-column sentinel with no value resolver
                                ordered_rows = [
                                    rows_by_sentinel[
                                        parameters[_sentinel_param_key]  # type: ignore  # noqa: E501
                                    ]
                                    for parameters in imv_batch.batch
                                ]
                    except KeyError as ke:
                        # see test_insert_exec.py::
                        # IMVSentinelTest::test_sentinel_cant_match_keys
                        # for coverage / demonstration
                        raise exc.InvalidRequestError(
                            f"Can't match sentinel values in result set to "
                            f"parameter sets; key {ke.args[0]!r} was not "
                            "found. "
                            "There may be a mismatch between the datatype "
                            "passed to the DBAPI driver vs. that which it "
                            "returns in a result row.  Ensure the given "
                            "Python value matches the expected result type "
                            "*exactly*, taking care to not rely upon implicit "
                            "conversions which may occur such as when using "
                            "strings in place of UUID or integer values, etc. "
                        ) from ke

                    result.extend(ordered_rows)

                else:
                    result.extend(rows)

    def do_executemany(self, cursor, statement, parameters, context=None):
        cursor.executemany(statement, parameters)

    def do_execute(self, cursor, statement, parameters, context=None):
        cursor.execute(statement, parameters)

    def do_execute_no_params(self, cursor, statement, context=None):
        cursor.execute(statement)

    def is_disconnect(self, e, connection, cursor):
        return False

    @util.memoized_instancemethod
    def _gen_allowed_isolation_levels(self, dbapi_conn):
        try:
            raw_levels = list(self.get_isolation_level_values(dbapi_conn))
        except NotImplementedError:
            return None
        else:
            normalized_levels = [
                level.replace("_", " ").upper() for level in raw_levels
            ]
            if raw_levels != normalized_levels:
                raise ValueError(
                    f"Dialect {self.name!r} get_isolation_level_values() "
                    f"method should return names as UPPERCASE using spaces, "
                    f"not underscores; got "
                    f"{sorted(set(raw_levels).difference(normalized_levels))}"
                )
            return tuple(normalized_levels)

    def _assert_and_set_isolation_level(self, dbapi_conn, level):
        level = level.replace("_", " ").upper()

        _allowed_isolation_levels = self._gen_allowed_isolation_levels(
            dbapi_conn
        )
        if (
            _allowed_isolation_levels
            and level not in _allowed_isolation_levels
        ):
            raise exc.ArgumentError(
                f"Invalid value {level!r} for isolation_level. "
                f"Valid isolation levels for {self.name!r} are "
                f"{', '.join(_allowed_isolation_levels)}"
            )

        self.set_isolation_level(dbapi_conn, level)

    def reset_isolation_level(self, dbapi_conn):
        if self._on_connect_isolation_level is not None:
            assert (
                self._on_connect_isolation_level == "AUTOCOMMIT"
                or self._on_connect_isolation_level
                == self.default_isolation_level
            )
            self._assert_and_set_isolation_level(
                dbapi_conn, self._on_connect_isolation_level
            )
        else:
            assert self.default_isolation_level is not None
            self._assert_and_set_isolation_level(
                dbapi_conn,
                self.default_isolation_level,
            )

    def normalize_name(self, name):
        if name is None:
            return None

        name_lower = name.lower()
        name_upper = name.upper()

        if name_upper == name_lower:
            # name has no upper/lower conversion, e.g. non-european characters.
            # return unchanged
            return name
        elif name_upper == name and not (
            self.identifier_preparer._requires_quotes
        )(name_lower):
            # name is all uppercase and doesn't require quoting; normalize
            # to all lower case
            return name_lower
        elif name_lower == name:
            # name is all lower case, which if denormalized means we need to
            # force quoting on it
            return quoted_name(name, quote=True)
        else:
            # name is mixed case, means it will be quoted in SQL when used
            # later, no normalizes
            return name

    def denormalize_name(self, name):
        if name is None:
            return None

        name_lower = name.lower()
        name_upper = name.upper()

        if name_upper == name_lower:
            # name has no upper/lower conversion, e.g. non-european characters.
            # return unchanged
            return name
        elif name_lower == name and not (
            self.identifier_preparer._requires_quotes
        )(name_lower):
            name = name_upper
        return name

    def get_driver_connection(self, connection):
        return connection

    def _overrides_default(self, method):
        return (
            getattr(type(self), method).__code__
            is not getattr(DefaultDialect, method).__code__
        )

    def _default_multi_reflect(
        self,
        single_tbl_method,
        connection,
        kind,
        schema,
        filter_names,
        scope,
        **kw,
    ):
        names_fns = []
        temp_names_fns = []
        if ObjectKind.TABLE in kind:
            names_fns.append(self.get_table_names)
            temp_names_fns.append(self.get_temp_table_names)
        if ObjectKind.VIEW in kind:
            names_fns.append(self.get_view_names)
            temp_names_fns.append(self.get_temp_view_names)
        if ObjectKind.MATERIALIZED_VIEW in kind:
            names_fns.append(self.get_materialized_view_names)
            # no temp materialized view at the moment
            # temp_names_fns.append(self.get_temp_materialized_view_names)

        unreflectable = kw.pop("unreflectable", {})

        if (
            filter_names
            and scope is ObjectScope.ANY
            and kind is ObjectKind.ANY
        ):
            # if names are given and no qualification on type of table
            # (i.e. the Table(..., autoload) case), take the names as given,
            # don't run names queries. If a table does not exit
            # NoSuchTableError is raised and it's skipped

            # this also suits the case for mssql where we can reflect
            # individual temp tables but there's no temp_names_fn
            names = filter_names
        else:
            names = []
            name_kw = {"schema": schema, **kw}
            fns = []
            if ObjectScope.DEFAULT in scope:
                fns.extend(names_fns)
            if ObjectScope.TEMPORARY in scope:
                fns.extend(temp_names_fns)

            for fn in fns:
                try:
                    names.extend(fn(connection, **name_kw))
                except NotImplementedError:
                    pass

        if filter_names:
            filter_names = set(filter_names)

        # iterate over all the tables/views and call the single table method
        for table in names:
            if not filter_names or table in filter_names:
                key = (schema, table)
                try:
                    yield (
                        key,
                        single_tbl_method(
                            connection, table, schema=schema, **kw
                        ),
                    )
                except exc.UnreflectableTableError as err:
                    if key not in unreflectable:
                        unreflectable[key] = err
                except exc.NoSuchTableError:
                    pass

    def get_multi_table_options(self, connection, **kw):
        return self._default_multi_reflect(
            self.get_table_options, connection, **kw
        )

    def get_multi_columns(self, connection, **kw):
        return self._default_multi_reflect(self.get_columns, connection, **kw)

    def get_multi_pk_constraint(self, connection, **kw):
        return self._default_multi_reflect(
            self.get_pk_constraint, connection, **kw
        )

    def get_multi_foreign_keys(self, connection, **kw):
        return self._default_multi_reflect(
            self.get_foreign_keys, connection, **kw
        )

    def get_multi_indexes(self, connection, **kw):
        return self._default_multi_reflect(self.get_indexes, connection, **kw)

    def get_multi_unique_constraints(self, connection, **kw):
        return self._default_multi_reflect(
            self.get_unique_constraints, connection, **kw
        )

    def get_multi_check_constraints(self, connection, **kw):
        return self._default_multi_reflect(
            self.get_check_constraints, connection, **kw
        )

    def get_multi_table_comment(self, connection, **kw):
        return self._default_multi_reflect(
            self.get_table_comment, connection, **kw
        )


class StrCompileDialect(DefaultDialect):
    statement_compiler = compiler.StrSQLCompiler
    ddl_compiler = compiler.DDLCompiler
    type_compiler_cls = compiler.StrSQLTypeCompiler
    preparer = compiler.IdentifierPreparer

    insert_returning = True
    update_returning = True
    delete_returning = True

    supports_statement_cache = True

    supports_identity_columns = True

    supports_sequences = True
    sequences_optional = True
    preexecute_autoincrement_sequences = False

    supports_native_boolean = True

    supports_multivalues_insert = True
    supports_simple_order_by_label = True


class DefaultExecutionContext(ExecutionContext):
    isinsert = False
    isupdate = False
    isdelete = False
    is_crud = False
    is_text = False
    isddl = False

    execute_style: ExecuteStyle = ExecuteStyle.EXECUTE

    compiled: Optional[Compiled] = None
    result_column_struct: Optional[
        Tuple[List[ResultColumnsEntry], bool, bool, bool, bool]
    ] = None
    returned_default_rows: Optional[Sequence[Row[Any]]] = None

    execution_options: _ExecuteOptions = util.EMPTY_DICT

    cursor_fetch_strategy = _cursor._DEFAULT_FETCH

    invoked_statement: Optional[Executable] = None

    _is_implicit_returning = False
    _is_explicit_returning = False
    _is_supplemental_returning = False
    _is_server_side = False

    _soft_closed = False

    _has_rowcount = False

    # a hook for SQLite's translation of
    # result column names
    # NOTE: pyhive is using this hook, can't remove it :(
    _translate_colname: Optional[Callable[[str], str]] = None

    _expanded_parameters: Mapping[str, List[str]] = util.immutabledict()
    """used by set_input_sizes().

    This collection comes from ``ExpandedState.parameter_expansion``.

    """

    cache_hit = NO_CACHE_KEY

    root_connection: Connection
    _dbapi_connection: PoolProxiedConnection
    dialect: Dialect
    unicode_statement: str
    cursor: DBAPICursor
    compiled_parameters: List[_MutableCoreSingleExecuteParams]
    parameters: _DBAPIMultiExecuteParams
    extracted_parameters: Optional[Sequence[BindParameter[Any]]]

    _empty_dict_params = cast("Mapping[str, Any]", util.EMPTY_DICT)

    _insertmanyvalues_rows: Optional[List[Tuple[Any, ...]]] = None
    _num_sentinel_cols: int = 0

    @classmethod
    def _init_ddl(
        cls,
        dialect: Dialect,
        connection: Connection,
        dbapi_connection: PoolProxiedConnection,
        execution_options: _ExecuteOptions,
        compiled_ddl: DDLCompiler,
    ) -> ExecutionContext:
        """Initialize execution context for an ExecutableDDLElement
        construct."""

        self = cls.__new__(cls)
        self.root_connection = connection
        self._dbapi_connection = dbapi_connection
        self.dialect = connection.dialect

        self.compiled = compiled = compiled_ddl
        self.isddl = True

        self.execution_options = execution_options

        self.unicode_statement = str(compiled)
        if compiled.schema_translate_map:
            schema_translate_map = self.execution_options.get(
                "schema_translate_map", {}
            )

            rst = compiled.preparer._render_schema_translates
            self.unicode_statement = rst(
                self.unicode_statement, schema_translate_map
            )

        self.statement = self.unicode_statement

        self.cursor = self.create_cursor()
        self.compiled_parameters = []

        if dialect.positional:
            self.parameters = [dialect.execute_sequence_format()]
        else:
            self.parameters = [self._empty_dict_params]

        return self

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
        """Initialize execution context for a Compiled construct."""

        self = cls.__new__(cls)
        self.root_connection = connection
        self._dbapi_connection = dbapi_connection
        self.dialect = connection.dialect
        self.extracted_parameters = extracted_parameters
        self.invoked_statement = invoked_statement
        self.compiled = compiled
        self.cache_hit = cache_hit

        self.execution_options = execution_options

        self.result_column_struct = (
            compiled._result_columns,
            compiled._ordered_columns,
            compiled._textual_ordered_columns,
            compiled._ad_hoc_textual,
            compiled._loose_column_name_matching,
        )

        self.isinsert = ii = compiled.isinsert
        self.isupdate = iu = compiled.isupdate
        self.isdelete = id_ = compiled.isdelete
        self.is_text = compiled.isplaintext

        if ii or iu or id_:
            dml_statement = compiled.compile_state.statement  # type: ignore
            if TYPE_CHECKING:
                assert isinstance(dml_statement, UpdateBase)
            self.is_crud = True
            self._is_explicit_returning = ier = bool(dml_statement._returning)
            self._is_implicit_returning = iir = bool(
                compiled.implicit_returning
            )
            if iir and dml_statement._supplemental_returning:
                self._is_supplemental_returning = True

            # dont mix implicit and explicit returning
            assert not (iir and ier)

            if (ier or iir) and compiled.for_executemany:
                if ii and not self.dialect.insert_executemany_returning:
                    raise exc.InvalidRequestError(
                        f"Dialect {self.dialect.dialect_description} with "
                        f"current server capabilities does not support "
                        "INSERT..RETURNING when executemany is used"
                    )
                elif (
                    ii
                    and dml_statement._sort_by_parameter_order
                    and not self.dialect.insert_executemany_returning_sort_by_parameter_order  # noqa: E501
                ):
                    raise exc.InvalidRequestError(
                        f"Dialect {self.dialect.dialect_description} with "
                        f"current server capabilities does not support "
                        "INSERT..RETURNING with deterministic row ordering "
                        "when executemany is used"
                    )
                elif (
                    ii
                    and self.dialect.use_insertmanyvalues
                    and not compiled._insertmanyvalues
                ):
                    raise exc.InvalidRequestError(
                        'Statement does not have "insertmanyvalues" '
                        "enabled, can't use INSERT..RETURNING with "
                        "executemany in this case."
                    )
                elif iu and not self.dialect.update_executemany_returning:
                    raise exc.InvalidRequestError(
                        f"Dialect {self.dialect.dialect_description} with "
                        f"current server capabilities does not support "
                        "UPDATE..RETURNING when executemany is used"
                    )
                elif id_ and not self.dialect.delete_executemany_returning:
                    raise exc.InvalidRequestError(
                        f"Dialect {self.dialect.dialect_description} with "
                        f"current server capabilities does not support "
                        "DELETE..RETURNING when executemany is used"
                    )

        if not parameters:
            self.compiled_parameters = [
                compiled.construct_params(
                    extracted_parameters=extracted_parameters,
                    escape_names=False,
                )
            ]
        else:
            self.compiled_parameters = [
                compiled.construct_params(
                    m,
                    escape_names=False,
                    _group_number=grp,
                    extracted_parameters=extracted_parameters,
                )
                for grp, m in enumerate(parameters)
            ]

            if len(parameters) > 1:
                if self.isinsert and compiled._insertmanyvalues:
                    self.execute_style = ExecuteStyle.INSERTMANYVALUES

                    imv = compiled._insertmanyvalues
                    if imv.sentinel_columns is not None:
                        self._num_sentinel_cols = imv.num_sentinel_columns
                else:
                    self.execute_style = ExecuteStyle.EXECUTEMANY

        self.unicode_statement = compiled.string

        self.cursor = self.create_cursor()

        if self.compiled.insert_prefetch or self.compiled.update_prefetch:
            self._process_execute_defaults()

        processors = compiled._bind_processors

        flattened_processors: Mapping[
            str, _BindProcessorType[Any]
        ] = processors  # type: ignore[assignment]

        if compiled.literal_execute_params or compiled.post_compile_params:
            if self.executemany:
                raise exc.InvalidRequestError(
                    "'literal_execute' or 'expanding' parameters can't be "
                    "used with executemany()"
                )

            expanded_state = compiled._process_parameters_for_postcompile(
                self.compiled_parameters[0]
            )

            # re-assign self.unicode_statement
            self.unicode_statement = expanded_state.statement

            self._expanded_parameters = expanded_state.parameter_expansion

            flattened_processors = dict(processors)  # type: ignore
            flattened_processors.update(expanded_state.processors)
            positiontup = expanded_state.positiontup
        elif compiled.positional:
            positiontup = self.compiled.positiontup
        else:
            positiontup = None

        if compiled.schema_translate_map:
            schema_translate_map = self.execution_options.get(
                "schema_translate_map", {}
            )
            rst = compiled.preparer._render_schema_translates
            self.unicode_statement = rst(
                self.unicode_statement, schema_translate_map
            )

        # final self.unicode_statement is now assigned, encode if needed
        # by dialect
        self.statement = self.unicode_statement

        # Convert the dictionary of bind parameter values
        # into a dict or list to be sent to the DBAPI's
        # execute() or executemany() method.

        if compiled.positional:
            core_positional_parameters: MutableSequence[Sequence[Any]] = []
            assert positiontup is not None
            for compiled_params in self.compiled_parameters:
                l_param: List[Any] = [
                    flattened_processors[key](compiled_params[key])
                    if key in flattened_processors
                    else compiled_params[key]
                    for key in positiontup
                ]
                core_positional_parameters.append(
                    dialect.execute_sequence_format(l_param)
                )

            self.parameters = core_positional_parameters
        else:
            core_dict_parameters: MutableSequence[Dict[str, Any]] = []
            escaped_names = compiled.escaped_bind_names

            # note that currently, "expanded" parameters will be present
            # in self.compiled_parameters in their quoted form.   This is
            # slightly inconsistent with the approach taken as of
            # #8056 where self.compiled_parameters is meant to contain unquoted
            # param names.
            d_param: Dict[str, Any]
            for compiled_params in self.compiled_parameters:
                if escaped_names:
                    d_param = {
                        escaped_names.get(key, key): flattened_processors[key](
                            compiled_params[key]
                        )
                        if key in flattened_processors
                        else compiled_params[key]
                        for key in compiled_params
                    }
                else:
                    d_param = {
                        key: flattened_processors[key](compiled_params[key])
                        if key in flattened_processors
                        else compiled_params[key]
                        for key in compiled_params
                    }

                core_dict_parameters.append(d_param)

            self.parameters = core_dict_parameters

        return self

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
        """Initialize execution context for a string SQL statement."""

        self = cls.__new__(cls)
        self.root_connection = connection
        self._dbapi_connection = dbapi_connection
        self.dialect = connection.dialect
        self.is_text = True

        self.execution_options = execution_options

        if not parameters:
            if self.dialect.positional:
                self.parameters = [dialect.execute_sequence_format()]
            else:
                self.parameters = [self._empty_dict_params]
        elif isinstance(parameters[0], dialect.execute_sequence_format):
            self.parameters = parameters
        elif isinstance(parameters[0], dict):
            self.parameters = parameters
        else:
            self.parameters = [
                dialect.execute_sequence_format(p) for p in parameters
            ]

        if len(parameters) > 1:
            self.execute_style = ExecuteStyle.EXECUTEMANY

        self.statement = self.unicode_statement = statement

        self.cursor = self.create_cursor()
        return self

    @classmethod
    def _init_default(
        cls,
        dialect: Dialect,
        connection: Connection,
        dbapi_connection: PoolProxiedConnection,
        execution_options: _ExecuteOptions,
    ) -> ExecutionContext:
        """Initialize execution context for a ColumnDefault construct."""

        self = cls.__new__(cls)
        self.root_connection = connection
        self._dbapi_connection = dbapi_connection
        self.dialect = connection.dialect

        self.execution_options = execution_options

        self.cursor = self.create_cursor()
        return self

    def _get_cache_stats(self) -> str:
        if self.compiled is None:
            return "raw sql"

        now = perf_counter()

        ch = self.cache_hit

        gen_time = self.compiled._gen_time
        assert gen_time is not None

        if ch is NO_CACHE_KEY:
            return "no key %.5fs" % (now - gen_time,)
        elif ch is CACHE_HIT:
            return "cached since %.4gs ago" % (now - gen_time,)
        elif ch is CACHE_MISS:
            return "generated in %.5fs" % (now - gen_time,)
        elif ch is CACHING_DISABLED:
            return "caching disabled %.5fs" % (now - gen_time,)
        elif ch is NO_DIALECT_SUPPORT:
            return "dialect %s+%s does not support caching %.5fs" % (
                self.dialect.name,
                self.dialect.driver,
                now - gen_time,
            )
        else:
            return "unknown"

    @property
    def executemany(self):
        return self.execute_style in (
            ExecuteStyle.EXECUTEMANY,
            ExecuteStyle.INSERTMANYVALUES,
        )

    @util.memoized_property
    def identifier_preparer(self):
        if self.compiled:
            return self.compiled.preparer
        elif "schema_translate_map" in self.execution_options:
            return self.dialect.identifier_preparer._with_schema_translate(
                self.execution_options["schema_translate_map"]
            )
        else:
            return self.dialect.identifier_preparer

    @util.memoized_property
    def engine(self):
        return self.root_connection.engine

    @util.memoized_property
    def postfetch_cols(self) -> Optional[Sequence[Column[Any]]]:
        if TYPE_CHECKING:
            assert isinstance(self.compiled, SQLCompiler)
        return self.compiled.postfetch

    @util.memoized_property
    def prefetch_cols(self) -> Optional[Sequence[Column[Any]]]:
        if TYPE_CHECKING:
            assert isinstance(self.compiled, SQLCompiler)
        if self.isinsert:
            return self.compiled.insert_prefetch
        elif self.isupdate:
            return self.compiled.update_prefetch
        else:
            return ()

    @util.memoized_property
    def no_parameters(self):
        return self.execution_options.get("no_parameters", False)

    def _execute_scalar(self, stmt, type_, parameters=None):
        """Execute a string statement on the current cursor, returning a
        scalar result.

        Used to fire off sequences, default phrases, and "select lastrowid"
        types of statements individually or in the context of a parent INSERT
        or UPDATE statement.

        """

        conn = self.root_connection

        if "schema_translate_map" in self.execution_options:
            schema_translate_map = self.execution_options.get(
                "schema_translate_map", {}
            )

            rst = self.identifier_preparer._render_schema_translates
            stmt = rst(stmt, schema_translate_map)

        if not parameters:
            if self.dialect.positional:
                parameters = self.dialect.execute_sequence_format()
            else:
                parameters = {}

        conn._cursor_execute(self.cursor, stmt, parameters, context=self)
        row = self.cursor.fetchone()
        if row is not None:
            r = row[0]
        else:
            r = None
        if type_ is not None:
            # apply type post processors to the result
            proc = type_._cached_result_processor(
                self.dialect, self.cursor.description[0][1]
            )
            if proc:
                return proc(r)
        return r

    @util.memoized_property
    def connection(self):
        return self.root_connection

    def _use_server_side_cursor(self):
        if not self.dialect.supports_server_side_cursors:
            return False

        if self.dialect.server_side_cursors:
            # this is deprecated
            use_server_side = self.execution_options.get(
                "stream_results", True
            ) and (
                self.compiled
                and isinstance(self.compiled.statement, expression.Selectable)
                or (
                    (
                        not self.compiled
                        or isinstance(
                            self.compiled.statement, expression.TextClause
                        )
                    )
                    and self.unicode_statement
                    and SERVER_SIDE_CURSOR_RE.match(self.unicode_statement)
                )
            )
        else:
            use_server_side = self.execution_options.get(
                "stream_results", False
            )

        return use_server_side

    def create_cursor(self):
        if (
            # inlining initial preference checks for SS cursors
            self.dialect.supports_server_side_cursors
            and (
                self.execution_options.get("stream_results", False)
                or (
                    self.dialect.server_side_cursors
                    and self._use_server_side_cursor()
                )
            )
        ):
            self._is_server_side = True
            return self.create_server_side_cursor()
        else:
            self._is_server_side = False
            return self.create_default_cursor()

    def fetchall_for_returning(self, cursor):
        return cursor.fetchall()

    def create_default_cursor(self):
        return self._dbapi_connection.cursor()

    def create_server_side_cursor(self):
        raise NotImplementedError()

    def pre_exec(self):
        pass

    def get_out_parameter_values(self, names):
        raise NotImplementedError(
            "This dialect does not support OUT parameters"
        )

    def post_exec(self):
        pass

    def get_result_processor(self, type_, colname, coltype):
        """Return a 'result processor' for a given type as present in
        cursor.description.

        This has a default implementation that dialects can override
        for context-sensitive result type handling.

        """
        return type_._cached_result_processor(self.dialect, coltype)

    def get_lastrowid(self):
        """return self.cursor.lastrowid, or equivalent, after an INSERT.

        This may involve calling special cursor functions, issuing a new SELECT
        on the cursor (or a new one), or returning a stored value that was
        calculated within post_exec().

        This function will only be called for dialects which support "implicit"
        primary key generation, keep preexecute_autoincrement_sequences set to
        False, and when no explicit id value was bound to the statement.

        The function is called once for an INSERT statement that would need to
        return the last inserted primary key for those dialects that make use
        of the lastrowid concept.  In these cases, it is called directly after
        :meth:`.ExecutionContext.post_exec`.

        """
        return self.cursor.lastrowid

    def handle_dbapi_exception(self, e):
        pass

    @util.non_memoized_property
    def rowcount(self) -> int:
        return self.cursor.rowcount

    def supports_sane_rowcount(self):
        return self.dialect.supports_sane_rowcount

    def supports_sane_multi_rowcount(self):
        return self.dialect.supports_sane_multi_rowcount

    def _setup_result_proxy(self):
        exec_opt = self.execution_options

        if self.is_crud or self.is_text:
            result = self._setup_dml_or_text_result()
            yp = sr = False
        else:
            yp = exec_opt.get("yield_per", None)
            sr = self._is_server_side or exec_opt.get("stream_results", False)
            strategy = self.cursor_fetch_strategy
            if sr and strategy is _cursor._DEFAULT_FETCH:
                strategy = _cursor.BufferedRowCursorFetchStrategy(
                    self.cursor, self.execution_options
                )
            cursor_description: _DBAPICursorDescription = (
                strategy.alternate_cursor_description
                or self.cursor.description
            )
            if cursor_description is None:
                strategy = _cursor._NO_CURSOR_DQL

            result = _cursor.CursorResult(self, strategy, cursor_description)

        compiled = self.compiled

        if (
            compiled
            and not self.isddl
            and cast(SQLCompiler, compiled).has_out_parameters
        ):
            self._setup_out_parameters(result)

        self._soft_closed = result._soft_closed

        if yp:
            result = result.yield_per(yp)

        return result

    def _setup_out_parameters(self, result):
        compiled = cast(SQLCompiler, self.compiled)

        out_bindparams = [
            (param, name)
            for param, name in compiled.bind_names.items()
            if param.isoutparam
        ]
        out_parameters = {}

        for bindparam, raw_value in zip(
            [param for param, name in out_bindparams],
            self.get_out_parameter_values(
                [name for param, name in out_bindparams]
            ),
        ):
            type_ = bindparam.type
            impl_type = type_.dialect_impl(self.dialect)
            dbapi_type = impl_type.get_dbapi_type(self.dialect.loaded_dbapi)
            result_processor = impl_type.result_processor(
                self.dialect, dbapi_type
            )
            if result_processor is not None:
                raw_value = result_processor(raw_value)
            out_parameters[bindparam.key] = raw_value

        result.out_parameters = out_parameters

    def _setup_dml_or_text_result(self):
        compiled = cast(SQLCompiler, self.compiled)

        strategy: ResultFetchStrategy = self.cursor_fetch_strategy

        if self.isinsert:
            if (
                self.execute_style is ExecuteStyle.INSERTMANYVALUES
                and compiled.effective_returning
            ):
                strategy = _cursor.FullyBufferedCursorFetchStrategy(
                    self.cursor,
                    initial_buffer=self._insertmanyvalues_rows,
                    # maintain alt cursor description if set by the
                    # dialect, e.g. mssql preserves it
                    alternate_description=(
                        strategy.alternate_cursor_description
                    ),
                )

            if compiled.postfetch_lastrowid:
                self.inserted_primary_key_rows = (
                    self._setup_ins_pk_from_lastrowid()
                )
            # else if not self._is_implicit_returning,
            # the default inserted_primary_key_rows accessor will
            # return an "empty" primary key collection when accessed.

        if self._is_server_side and strategy is _cursor._DEFAULT_FETCH:
            strategy = _cursor.BufferedRowCursorFetchStrategy(
                self.cursor, self.execution_options
            )

        if strategy is _cursor._NO_CURSOR_DML:
            cursor_description = None
        else:
            cursor_description = (
                strategy.alternate_cursor_description
                or self.cursor.description
            )

        if cursor_description is None:
            strategy = _cursor._NO_CURSOR_DML
        elif self._num_sentinel_cols:
            assert self.execute_style is ExecuteStyle.INSERTMANYVALUES
            # strip out the sentinel columns from cursor description
            # a similar logic is done to the rows only in CursorResult
            cursor_description = cursor_description[
                0 : -self._num_sentinel_cols
            ]

        result: _cursor.CursorResult[Any] = _cursor.CursorResult(
            self, strategy, cursor_description
        )

        if self.isinsert:
            if self._is_implicit_returning:
                rows = result.all()

                self.returned_default_rows = rows

                self.inserted_primary_key_rows = (
                    self._setup_ins_pk_from_implicit_returning(result, rows)
                )

                # test that it has a cursor metadata that is accurate. the
                # first row will have been fetched and current assumptions
                # are that the result has only one row, until executemany()
                # support is added here.
                assert result._metadata.returns_rows

                # Insert statement has both return_defaults() and
                # returning().  rewind the result on the list of rows
                # we just used.
                if self._is_supplemental_returning:
                    result._rewind(rows)
                else:
                    result._soft_close()
            elif not self._is_explicit_returning:
                result._soft_close()

                # we assume here the result does not return any rows.
                # *usually*, this will be true.  However, some dialects
                # such as that of MSSQL/pyodbc need to SELECT a post fetch
                # function so this is not necessarily true.
                # assert not result.returns_rows

        elif self._is_implicit_returning:
            rows = result.all()

            if rows:
                self.returned_default_rows = rows
            result.rowcount = len(rows)
            self._has_rowcount = True

            if self._is_supplemental_returning:
                result._rewind(rows)
            else:
                result._soft_close()

            # test that it has a cursor metadata that is accurate.
            # the rows have all been fetched however.
            assert result._metadata.returns_rows

        elif not result._metadata.returns_rows:
            # no results, get rowcount
            # (which requires open cursor on some drivers)
            result.rowcount
            self._has_rowcount = True
            result._soft_close()
        elif self.isupdate or self.isdelete:
            result.rowcount
            self._has_rowcount = True
        return result

    @util.memoized_property
    def inserted_primary_key_rows(self):
        # if no specific "get primary key" strategy was set up
        # during execution, return a "default" primary key based
        # on what's in the compiled_parameters and nothing else.
        return self._setup_ins_pk_from_empty()

    def _setup_ins_pk_from_lastrowid(self):
        getter = cast(
            SQLCompiler, self.compiled
        )._inserted_primary_key_from_lastrowid_getter
        lastrowid = self.get_lastrowid()
        return [getter(lastrowid, self.compiled_parameters[0])]

    def _setup_ins_pk_from_empty(self):
        getter = cast(
            SQLCompiler, self.compiled
        )._inserted_primary_key_from_lastrowid_getter
        return [getter(None, param) for param in self.compiled_parameters]

    def _setup_ins_pk_from_implicit_returning(self, result, rows):
        if not rows:
            return []

        getter = cast(
            SQLCompiler, self.compiled
        )._inserted_primary_key_from_returning_getter
        compiled_params = self.compiled_parameters

        return [
            getter(row, param) for row, param in zip(rows, compiled_params)
        ]

    def lastrow_has_defaults(self):
        return (self.isinsert or self.isupdate) and bool(
            cast(SQLCompiler, self.compiled).postfetch
        )

    def _prepare_set_input_sizes(
        self,
    ) -> Optional[List[Tuple[str, Any, TypeEngine[Any]]]]:
        """Given a cursor and ClauseParameters, prepare arguments
        in order to call the appropriate
        style of ``setinputsizes()`` on the cursor, using DB-API types
        from the bind parameter's ``TypeEngine`` objects.

        This method only called by those dialects which set
        the :attr:`.Dialect.bind_typing` attribute to
        :attr:`.BindTyping.SETINPUTSIZES`.   cx_Oracle is the only DBAPI
        that requires setinputsizes(), pyodbc offers it as an option.

        Prior to SQLAlchemy 2.0, the setinputsizes() approach was also used
        for pg8000 and asyncpg, which has been changed to inline rendering
        of casts.

        """
        if self.isddl or self.is_text:
            return None

        compiled = cast(SQLCompiler, self.compiled)

        inputsizes = compiled._get_set_input_sizes_lookup()

        if inputsizes is None:
            return None

        dialect = self.dialect

        # all of the rest of this... cython?

        if dialect._has_events:
            inputsizes = dict(inputsizes)
            dialect.dispatch.do_setinputsizes(
                inputsizes, self.cursor, self.statement, self.parameters, self
            )

        if compiled.escaped_bind_names:
            escaped_bind_names = compiled.escaped_bind_names
        else:
            escaped_bind_names = None

        if dialect.positional:
            items = [
                (key, compiled.binds[key])
                for key in compiled.positiontup or ()
            ]
        else:
            items = [
                (key, bindparam)
                for bindparam, key in compiled.bind_names.items()
            ]

        generic_inputsizes: List[Tuple[str, Any, TypeEngine[Any]]] = []
        for key, bindparam in items:
            if bindparam in compiled.literal_execute_params:
                continue

            if key in self._expanded_parameters:
                if is_tuple_type(bindparam.type):
                    num = len(bindparam.type.types)
                    dbtypes = inputsizes[bindparam]
                    generic_inputsizes.extend(
                        (
                            (
                                escaped_bind_names.get(paramname, paramname)
                                if escaped_bind_names is not None
                                else paramname
                            ),
                            dbtypes[idx % num],
                            bindparam.type.types[idx % num],
                        )
                        for idx, paramname in enumerate(
                            self._expanded_parameters[key]
                        )
                    )
                else:
                    dbtype = inputsizes.get(bindparam, None)
                    generic_inputsizes.extend(
                        (
                            (
                                escaped_bind_names.get(paramname, paramname)
                                if escaped_bind_names is not None
                                else paramname
                            ),
                            dbtype,
                            bindparam.type,
                        )
                        for paramname in self._expanded_parameters[key]
                    )
            else:
                dbtype = inputsizes.get(bindparam, None)

                escaped_name = (
                    escaped_bind_names.get(key, key)
                    if escaped_bind_names is not None
                    else key
                )

                generic_inputsizes.append(
                    (escaped_name, dbtype, bindparam.type)
                )

        return generic_inputsizes

    def _exec_default(self, column, default, type_):
        if default.is_sequence:
            return self.fire_sequence(default, type_)
        elif default.is_callable:
            # this codepath is not normally used as it's inlined
            # into _process_execute_defaults
            self.current_column = column
            return default.arg(self)
        elif default.is_clause_element:
            return self._exec_default_clause_element(column, default, type_)
        else:
            # this codepath is not normally used as it's inlined
            # into _process_execute_defaults
            return default.arg

    def _exec_default_clause_element(self, column, default, type_):
        # execute a default that's a complete clause element.  Here, we have
        # to re-implement a miniature version of the compile->parameters->
        # cursor.execute() sequence, since we don't want to modify the state
        # of the connection  / result in progress or create new connection/
        # result objects etc.
        # .. versionchanged:: 1.4

        if not default._arg_is_typed:
            default_arg = expression.type_coerce(default.arg, type_)
        else:
            default_arg = default.arg
        compiled = expression.select(default_arg).compile(dialect=self.dialect)
        compiled_params = compiled.construct_params()
        processors = compiled._bind_processors
        if compiled.positional:
            parameters = self.dialect.execute_sequence_format(
                [
                    processors[key](compiled_params[key])  # type: ignore
                    if key in processors
                    else compiled_params[key]
                    for key in compiled.positiontup or ()
                ]
            )
        else:
            parameters = {
                key: processors[key](compiled_params[key])  # type: ignore
                if key in processors
                else compiled_params[key]
                for key in compiled_params
            }
        return self._execute_scalar(
            str(compiled), type_, parameters=parameters
        )

    current_parameters: Optional[_CoreSingleExecuteParams] = None
    """A dictionary of parameters applied to the current row.

    This attribute is only available in the context of a user-defined default
    generation function, e.g. as described at :ref:`context_default_functions`.
    It consists of a dictionary which includes entries for each column/value
    pair that is to be part of the INSERT or UPDATE statement. The keys of the
    dictionary will be the key value of each :class:`_schema.Column`,
    which is usually
    synonymous with the name.

    Note that the :attr:`.DefaultExecutionContext.current_parameters` attribute
    does not accommodate for the "multi-values" feature of the
    :meth:`_expression.Insert.values` method.  The
    :meth:`.DefaultExecutionContext.get_current_parameters` method should be
    preferred.

    .. seealso::

        :meth:`.DefaultExecutionContext.get_current_parameters`

        :ref:`context_default_functions`

    """

    def get_current_parameters(self, isolate_multiinsert_groups=True):
        """Return a dictionary of parameters applied to the current row.

        This method can only be used in the context of a user-defined default
        generation function, e.g. as described at
        :ref:`context_default_functions`. When invoked, a dictionary is
        returned which includes entries for each column/value pair that is part
        of the INSERT or UPDATE statement. The keys of the dictionary will be
        the key value of each :class:`_schema.Column`,
        which is usually synonymous
        with the name.

        :param isolate_multiinsert_groups=True: indicates that multi-valued
         INSERT constructs created using :meth:`_expression.Insert.values`
         should be
         handled by returning only the subset of parameters that are local
         to the current column default invocation.   When ``False``, the
         raw parameters of the statement are returned including the
         naming convention used in the case of multi-valued INSERT.

        .. versionadded:: 1.2  added
           :meth:`.DefaultExecutionContext.get_current_parameters`
           which provides more functionality over the existing
           :attr:`.DefaultExecutionContext.current_parameters`
           attribute.

        .. seealso::

            :attr:`.DefaultExecutionContext.current_parameters`

            :ref:`context_default_functions`

        """
        try:
            parameters = self.current_parameters
            column = self.current_column
        except AttributeError:
            raise exc.InvalidRequestError(
                "get_current_parameters() can only be invoked in the "
                "context of a Python side column default function"
            )
        else:
            assert column is not None
            assert parameters is not None
        compile_state = cast(
            "DMLState", cast(SQLCompiler, self.compiled).compile_state
        )
        assert compile_state is not None
        if (
            isolate_multiinsert_groups
            and dml.isinsert(compile_state)
            and compile_state._has_multi_parameters
        ):
            if column._is_multiparam_column:
                index = column.index + 1
                d = {column.original.key: parameters[column.key]}
            else:
                d = {column.key: parameters[column.key]}
                index = 0
            assert compile_state._dict_parameters is not None
            keys = compile_state._dict_parameters.keys()
            d.update(
                (key, parameters["%s_m%d" % (key, index)]) for key in keys
            )
            return d
        else:
            return parameters

    def get_insert_default(self, column):
        if column.default is None:
            return None
        else:
            return self._exec_default(column, column.default, column.type)

    def get_update_default(self, column):
        if column.onupdate is None:
            return None
        else:
            return self._exec_default(column, column.onupdate, column.type)

    def _process_execute_defaults(self):
        compiled = cast(SQLCompiler, self.compiled)

        key_getter = compiled._within_exec_param_key_getter

        sentinel_counter = 0

        if compiled.insert_prefetch:
            prefetch_recs = [
                (
                    c,
                    key_getter(c),
                    c._default_description_tuple,
                    self.get_insert_default,
                )
                for c in compiled.insert_prefetch
            ]
        elif compiled.update_prefetch:
            prefetch_recs = [
                (
                    c,
                    key_getter(c),
                    c._onupdate_description_tuple,
                    self.get_update_default,
                )
                for c in compiled.update_prefetch
            ]
        else:
            prefetch_recs = []

        for param in self.compiled_parameters:
            self.current_parameters = param

            for (
                c,
                param_key,
                (arg, is_scalar, is_callable, is_sentinel),
                fallback,
            ) in prefetch_recs:
                if is_sentinel:
                    param[param_key] = sentinel_counter
                    sentinel_counter += 1
                elif is_scalar:
                    param[param_key] = arg
                elif is_callable:
                    self.current_column = c
                    param[param_key] = arg(self)
                else:
                    val = fallback(c)
                    if val is not None:
                        param[param_key] = val

        del self.current_parameters


DefaultDialect.execution_ctx_cls = DefaultExecutionContext
