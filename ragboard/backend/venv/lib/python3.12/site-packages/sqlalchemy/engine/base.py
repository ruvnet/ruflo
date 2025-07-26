# engine/base.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
"""Defines :class:`_engine.Connection` and :class:`_engine.Engine`.

"""
from __future__ import annotations

import contextlib
import sys
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Tuple
from typing import Type
from typing import TypeVar
from typing import Union

from .interfaces import BindTyping
from .interfaces import ConnectionEventsTarget
from .interfaces import DBAPICursor
from .interfaces import ExceptionContext
from .interfaces import ExecuteStyle
from .interfaces import ExecutionContext
from .interfaces import IsolationLevel
from .util import _distill_params_20
from .util import _distill_raw_params
from .util import TransactionalContext
from .. import exc
from .. import inspection
from .. import log
from .. import util
from ..sql import compiler
from ..sql import util as sql_util

if typing.TYPE_CHECKING:
    from . import CursorResult
    from . import ScalarResult
    from .interfaces import _AnyExecuteParams
    from .interfaces import _AnyMultiExecuteParams
    from .interfaces import _CoreAnyExecuteParams
    from .interfaces import _CoreMultiExecuteParams
    from .interfaces import _CoreSingleExecuteParams
    from .interfaces import _DBAPIAnyExecuteParams
    from .interfaces import _DBAPISingleExecuteParams
    from .interfaces import _ExecuteOptions
    from .interfaces import CompiledCacheType
    from .interfaces import CoreExecuteOptionsParameter
    from .interfaces import Dialect
    from .interfaces import SchemaTranslateMapType
    from .reflection import Inspector  # noqa
    from .url import URL
    from ..event import dispatcher
    from ..log import _EchoFlagType
    from ..pool import _ConnectionFairy
    from ..pool import Pool
    from ..pool import PoolProxiedConnection
    from ..sql import Executable
    from ..sql._typing import _InfoType
    from ..sql.compiler import Compiled
    from ..sql.ddl import ExecutableDDLElement
    from ..sql.ddl import SchemaDropper
    from ..sql.ddl import SchemaGenerator
    from ..sql.functions import FunctionElement
    from ..sql.schema import DefaultGenerator
    from ..sql.schema import HasSchemaAttr
    from ..sql.schema import SchemaItem
    from ..sql.selectable import TypedReturnsRows


_T = TypeVar("_T", bound=Any)
_EMPTY_EXECUTION_OPTS: _ExecuteOptions = util.EMPTY_DICT
NO_OPTIONS: Mapping[str, Any] = util.EMPTY_DICT


class Connection(ConnectionEventsTarget, inspection.Inspectable["Inspector"]):
    """Provides high-level functionality for a wrapped DB-API connection.

    The :class:`_engine.Connection` object is procured by calling the
    :meth:`_engine.Engine.connect` method of the :class:`_engine.Engine`
    object, and provides services for execution of SQL statements as well
    as transaction control.

    The Connection object is **not** thread-safe. While a Connection can be
    shared among threads using properly synchronized access, it is still
    possible that the underlying DBAPI connection may not support shared
    access between threads. Check the DBAPI documentation for details.

    The Connection object represents a single DBAPI connection checked out
    from the connection pool. In this state, the connection pool has no
    affect upon the connection, including its expiration or timeout state.
    For the connection pool to properly manage connections, connections
    should be returned to the connection pool (i.e. ``connection.close()``)
    whenever the connection is not in use.

    .. index::
      single: thread safety; Connection

    """

    dispatch: dispatcher[ConnectionEventsTarget]

    _sqla_logger_namespace = "sqlalchemy.engine.Connection"

    # used by sqlalchemy.engine.util.TransactionalContext
    _trans_context_manager: Optional[TransactionalContext] = None

    # legacy as of 2.0, should be eventually deprecated and
    # removed.  was used in the "pre_ping" recipe that's been in the docs
    # a long time
    should_close_with_result = False

    _dbapi_connection: Optional[PoolProxiedConnection]

    _execution_options: _ExecuteOptions

    _transaction: Optional[RootTransaction]
    _nested_transaction: Optional[NestedTransaction]

    def __init__(
        self,
        engine: Engine,
        connection: Optional[PoolProxiedConnection] = None,
        _has_events: Optional[bool] = None,
        _allow_revalidate: bool = True,
        _allow_autobegin: bool = True,
    ):
        """Construct a new Connection."""
        self.engine = engine
        self.dialect = dialect = engine.dialect

        if connection is None:
            try:
                self._dbapi_connection = engine.raw_connection()
            except dialect.loaded_dbapi.Error as err:
                Connection._handle_dbapi_exception_noconnection(
                    err, dialect, engine
                )
                raise
        else:
            self._dbapi_connection = connection

        self._transaction = self._nested_transaction = None
        self.__savepoint_seq = 0
        self.__in_begin = False

        self.__can_reconnect = _allow_revalidate
        self._allow_autobegin = _allow_autobegin
        self._echo = self.engine._should_log_info()

        if _has_events is None:
            # if _has_events is sent explicitly as False,
            # then don't join the dispatch of the engine; we don't
            # want to handle any of the engine's events in that case.
            self.dispatch = self.dispatch._join(engine.dispatch)
        self._has_events = _has_events or (
            _has_events is None and engine._has_events
        )

        self._execution_options = engine._execution_options

        if self._has_events or self.engine._has_events:
            self.dispatch.engine_connect(self)

    @util.memoized_property
    def _message_formatter(self) -> Any:
        if "logging_token" in self._execution_options:
            token = self._execution_options["logging_token"]
            return lambda msg: "[%s] %s" % (token, msg)
        else:
            return None

    def _log_info(self, message: str, *arg: Any, **kw: Any) -> None:
        fmt = self._message_formatter

        if fmt:
            message = fmt(message)

        if log.STACKLEVEL:
            kw["stacklevel"] = 1 + log.STACKLEVEL_OFFSET

        self.engine.logger.info(message, *arg, **kw)

    def _log_debug(self, message: str, *arg: Any, **kw: Any) -> None:
        fmt = self._message_formatter

        if fmt:
            message = fmt(message)

        if log.STACKLEVEL:
            kw["stacklevel"] = 1 + log.STACKLEVEL_OFFSET

        self.engine.logger.debug(message, *arg, **kw)

    @property
    def _schema_translate_map(self) -> Optional[SchemaTranslateMapType]:
        schema_translate_map: Optional[
            SchemaTranslateMapType
        ] = self._execution_options.get("schema_translate_map", None)

        return schema_translate_map

    def schema_for_object(self, obj: HasSchemaAttr) -> Optional[str]:
        """Return the schema name for the given schema item taking into
        account current schema translate map.

        """

        name = obj.schema
        schema_translate_map: Optional[
            SchemaTranslateMapType
        ] = self._execution_options.get("schema_translate_map", None)

        if (
            schema_translate_map
            and name in schema_translate_map
            and obj._use_schema_map
        ):
            return schema_translate_map[name]
        else:
            return name

    def __enter__(self) -> Connection:
        return self

    def __exit__(self, type_: Any, value: Any, traceback: Any) -> None:
        self.close()

    @overload
    def execution_options(
        self,
        *,
        compiled_cache: Optional[CompiledCacheType] = ...,
        logging_token: str = ...,
        isolation_level: IsolationLevel = ...,
        no_parameters: bool = False,
        stream_results: bool = False,
        max_row_buffer: int = ...,
        yield_per: int = ...,
        insertmanyvalues_page_size: int = ...,
        schema_translate_map: Optional[SchemaTranslateMapType] = ...,
        **opt: Any,
    ) -> Connection:
        ...

    @overload
    def execution_options(self, **opt: Any) -> Connection:
        ...

    def execution_options(self, **opt: Any) -> Connection:
        r"""Set non-SQL options for the connection which take effect
        during execution.

        This method modifies this :class:`_engine.Connection` **in-place**;
        the return value is the same :class:`_engine.Connection` object
        upon which the method is called.   Note that this is in contrast
        to the behavior of the ``execution_options`` methods on other
        objects such as :meth:`_engine.Engine.execution_options` and
        :meth:`_sql.Executable.execution_options`.  The rationale is that many
        such execution options necessarily modify the state of the base
        DBAPI connection in any case so there is no feasible means of
        keeping the effect of such an option localized to a "sub" connection.

        .. versionchanged:: 2.0  The :meth:`_engine.Connection.execution_options`
           method, in contrast to other objects with this method, modifies
           the connection in-place without creating copy of it.

        As discussed elsewhere, the :meth:`_engine.Connection.execution_options`
        method accepts any arbitrary parameters including user defined names.
        All parameters given are consumable in a number of ways including
        by using the :meth:`_engine.Connection.get_execution_options` method.
        See the examples at :meth:`_sql.Executable.execution_options`
        and :meth:`_engine.Engine.execution_options`.

        The keywords that are currently recognized by SQLAlchemy itself
        include all those listed under :meth:`.Executable.execution_options`,
        as well as others that are specific to :class:`_engine.Connection`.

        :param compiled_cache: Available on: :class:`_engine.Connection`,
          :class:`_engine.Engine`.

          A dictionary where :class:`.Compiled` objects
          will be cached when the :class:`_engine.Connection`
          compiles a clause
          expression into a :class:`.Compiled` object.  This dictionary will
          supersede the statement cache that may be configured on the
          :class:`_engine.Engine` itself.   If set to None, caching
          is disabled, even if the engine has a configured cache size.

          Note that the ORM makes use of its own "compiled" caches for
          some operations, including flush operations.  The caching
          used by the ORM internally supersedes a cache dictionary
          specified here.

        :param logging_token: Available on: :class:`_engine.Connection`,
          :class:`_engine.Engine`, :class:`_sql.Executable`.

          Adds the specified string token surrounded by brackets in log
          messages logged by the connection, i.e. the logging that's enabled
          either via the :paramref:`_sa.create_engine.echo` flag or via the
          ``logging.getLogger("sqlalchemy.engine")`` logger. This allows a
          per-connection or per-sub-engine token to be available which is
          useful for debugging concurrent connection scenarios.

          .. versionadded:: 1.4.0b2

          .. seealso::

            :ref:`dbengine_logging_tokens` - usage example

            :paramref:`_sa.create_engine.logging_name` - adds a name to the
            name used by the Python logger object itself.

        :param isolation_level: Available on: :class:`_engine.Connection`,
          :class:`_engine.Engine`.

          Set the transaction isolation level for the lifespan of this
          :class:`_engine.Connection` object.
          Valid values include those string
          values accepted by the :paramref:`_sa.create_engine.isolation_level`
          parameter passed to :func:`_sa.create_engine`.  These levels are
          semi-database specific; see individual dialect documentation for
          valid levels.

          The isolation level option applies the isolation level by emitting
          statements on the DBAPI connection, and **necessarily affects the
          original Connection object overall**. The isolation level will remain
          at the given setting until explicitly changed, or when the DBAPI
          connection itself is :term:`released` to the connection pool, i.e. the
          :meth:`_engine.Connection.close` method is called, at which time an
          event handler will emit additional statements on the DBAPI connection
          in order to revert the isolation level change.

          .. note:: The ``isolation_level`` execution option may only be
             established before the :meth:`_engine.Connection.begin` method is
             called, as well as before any SQL statements are emitted which
             would otherwise trigger "autobegin", or directly after a call to
             :meth:`_engine.Connection.commit` or
             :meth:`_engine.Connection.rollback`. A database cannot change the
             isolation level on a transaction in progress.

          .. note:: The ``isolation_level`` execution option is implicitly
             reset if the :class:`_engine.Connection` is invalidated, e.g. via
             the :meth:`_engine.Connection.invalidate` method, or if a
             disconnection error occurs. The new connection produced after the
             invalidation will **not** have the selected isolation level
             re-applied to it automatically.

          .. seealso::

                :ref:`dbapi_autocommit`

                :meth:`_engine.Connection.get_isolation_level`
                - view current actual level

        :param no_parameters: Available on: :class:`_engine.Connection`,
          :class:`_sql.Executable`.

          When ``True``, if the final parameter
          list or dictionary is totally empty, will invoke the
          statement on the cursor as ``cursor.execute(statement)``,
          not passing the parameter collection at all.
          Some DBAPIs such as psycopg2 and mysql-python consider
          percent signs as significant only when parameters are
          present; this option allows code to generate SQL
          containing percent signs (and possibly other characters)
          that is neutral regarding whether it's executed by the DBAPI
          or piped into a script that's later invoked by
          command line tools.

        :param stream_results: Available on: :class:`_engine.Connection`,
          :class:`_sql.Executable`.

          Indicate to the dialect that results should be
          "streamed" and not pre-buffered, if possible.  For backends
          such as PostgreSQL, MySQL and MariaDB, this indicates the use of
          a "server side cursor" as opposed to a client side cursor.
          Other backends such as that of Oracle may already use server
          side cursors by default.

          The usage of
          :paramref:`_engine.Connection.execution_options.stream_results` is
          usually combined with setting a fixed number of rows to to be fetched
          in batches, to allow for efficient iteration of database rows while
          at the same time not loading all result rows into memory at once;
          this can be configured on a :class:`_engine.Result` object using the
          :meth:`_engine.Result.yield_per` method, after execution has
          returned a new :class:`_engine.Result`.   If
          :meth:`_engine.Result.yield_per` is not used,
          the :paramref:`_engine.Connection.execution_options.stream_results`
          mode of operation will instead use a dynamically sized buffer
          which buffers sets of rows at a time, growing on each batch
          based on a fixed growth size up until a limit which may
          be configured using the
          :paramref:`_engine.Connection.execution_options.max_row_buffer`
          parameter.

          When using the ORM to fetch ORM mapped objects from a result,
          :meth:`_engine.Result.yield_per` should always be used with
          :paramref:`_engine.Connection.execution_options.stream_results`,
          so that the ORM does not fetch all rows into new ORM objects at once.

          For typical use, the
          :paramref:`_engine.Connection.execution_options.yield_per` execution
          option should be preferred, which sets up both
          :paramref:`_engine.Connection.execution_options.stream_results` and
          :meth:`_engine.Result.yield_per` at once. This option is supported
          both at a core level by :class:`_engine.Connection` as well as by the
          ORM :class:`_engine.Session`; the latter is described at
          :ref:`orm_queryguide_yield_per`.

          .. seealso::

            :ref:`engine_stream_results` - background on
            :paramref:`_engine.Connection.execution_options.stream_results`

            :paramref:`_engine.Connection.execution_options.max_row_buffer`

            :paramref:`_engine.Connection.execution_options.yield_per`

            :ref:`orm_queryguide_yield_per` - in the :ref:`queryguide_toplevel`
            describing the ORM version of ``yield_per``

        :param max_row_buffer: Available on: :class:`_engine.Connection`,
          :class:`_sql.Executable`.  Sets a maximum
          buffer size to use when the
          :paramref:`_engine.Connection.execution_options.stream_results`
          execution option is used on a backend that supports server side
          cursors.  The default value if not specified is 1000.

          .. seealso::

            :paramref:`_engine.Connection.execution_options.stream_results`

            :ref:`engine_stream_results`


        :param yield_per: Available on: :class:`_engine.Connection`,
          :class:`_sql.Executable`.  Integer value applied which will
          set the :paramref:`_engine.Connection.execution_options.stream_results`
          execution option and invoke :meth:`_engine.Result.yield_per`
          automatically at once.  Allows equivalent functionality as
          is present when using this parameter with the ORM.

          .. versionadded:: 1.4.40

          .. seealso::

            :ref:`engine_stream_results` - background and examples
            on using server side cursors with Core.

            :ref:`orm_queryguide_yield_per` - in the :ref:`queryguide_toplevel`
            describing the ORM version of ``yield_per``

        :param insertmanyvalues_page_size: Available on: :class:`_engine.Connection`,
            :class:`_engine.Engine`. Number of rows to format into an
            INSERT statement when the statement uses "insertmanyvalues" mode,
            which is a paged form of bulk insert that is used for many backends
            when using :term:`executemany` execution typically in conjunction
            with RETURNING. Defaults to 1000. May also be modified on a
            per-engine basis using the
            :paramref:`_sa.create_engine.insertmanyvalues_page_size` parameter.

            .. versionadded:: 2.0

            .. seealso::

                :ref:`engine_insertmanyvalues`

        :param schema_translate_map: Available on: :class:`_engine.Connection`,
          :class:`_engine.Engine`, :class:`_sql.Executable`.

          A dictionary mapping schema names to schema names, that will be
          applied to the :paramref:`_schema.Table.schema` element of each
          :class:`_schema.Table`
          encountered when SQL or DDL expression elements
          are compiled into strings; the resulting schema name will be
          converted based on presence in the map of the original name.

          .. seealso::

            :ref:`schema_translating`

        .. seealso::

            :meth:`_engine.Engine.execution_options`

            :meth:`.Executable.execution_options`

            :meth:`_engine.Connection.get_execution_options`

            :ref:`orm_queryguide_execution_options` - documentation on all
            ORM-specific execution options

        """  # noqa
        if self._has_events or self.engine._has_events:
            self.dispatch.set_connection_execution_options(self, opt)
        self._execution_options = self._execution_options.union(opt)
        self.dialect.set_connection_execution_options(self, opt)
        return self

    def get_execution_options(self) -> _ExecuteOptions:
        """Get the non-SQL options which will take effect during execution.

        .. versionadded:: 1.3

        .. seealso::

            :meth:`_engine.Connection.execution_options`
        """
        return self._execution_options

    @property
    def _still_open_and_dbapi_connection_is_valid(self) -> bool:
        pool_proxied_connection = self._dbapi_connection
        return (
            pool_proxied_connection is not None
            and pool_proxied_connection.is_valid
        )

    @property
    def closed(self) -> bool:
        """Return True if this connection is closed."""

        return self._dbapi_connection is None and not self.__can_reconnect

    @property
    def invalidated(self) -> bool:
        """Return True if this connection was invalidated.

        This does not indicate whether or not the connection was
        invalidated at the pool level, however

        """

        # prior to 1.4, "invalid" was stored as a state independent of
        # "closed", meaning an invalidated connection could be "closed",
        # the _dbapi_connection would be None and closed=True, yet the
        # "invalid" flag would stay True.  This meant that there were
        # three separate states (open/valid, closed/valid, closed/invalid)
        # when there is really no reason for that; a connection that's
        # "closed" does not need to be "invalid".  So the state is now
        # represented by the two facts alone.

        pool_proxied_connection = self._dbapi_connection
        return pool_proxied_connection is None and self.__can_reconnect

    @property
    def connection(self) -> PoolProxiedConnection:
        """The underlying DB-API connection managed by this Connection.

        This is a SQLAlchemy connection-pool proxied connection
        which then has the attribute
        :attr:`_pool._ConnectionFairy.dbapi_connection` that refers to the
        actual driver connection.

        .. seealso::


            :ref:`dbapi_connections`

        """

        if self._dbapi_connection is None:
            try:
                return self._revalidate_connection()
            except (exc.PendingRollbackError, exc.ResourceClosedError):
                raise
            except BaseException as e:
                self._handle_dbapi_exception(e, None, None, None, None)
        else:
            return self._dbapi_connection

    def get_isolation_level(self) -> IsolationLevel:
        """Return the current **actual** isolation level that's present on
        the database within the scope of this connection.

        This attribute will perform a live SQL operation against the database
        in order to procure the current isolation level, so the value returned
        is the actual level on the underlying DBAPI connection regardless of
        how this state was set. This will be one of the four actual isolation
        modes ``READ UNCOMMITTED``, ``READ COMMITTED``, ``REPEATABLE READ``,
        ``SERIALIZABLE``. It will **not** include the ``AUTOCOMMIT`` isolation
        level setting. Third party dialects may also feature additional
        isolation level settings.

        .. note::  This method **will not report** on the ``AUTOCOMMIT``
          isolation level, which is a separate :term:`dbapi` setting that's
          independent of **actual** isolation level.  When ``AUTOCOMMIT`` is
          in use, the database connection still has a "traditional" isolation
          mode in effect, that is typically one of the four values
          ``READ UNCOMMITTED``, ``READ COMMITTED``, ``REPEATABLE READ``,
          ``SERIALIZABLE``.

        Compare to the :attr:`_engine.Connection.default_isolation_level`
        accessor which returns the isolation level that is present on the
        database at initial connection time.

        .. seealso::

            :attr:`_engine.Connection.default_isolation_level`
            - view default level

            :paramref:`_sa.create_engine.isolation_level`
            - set per :class:`_engine.Engine` isolation level

            :paramref:`.Connection.execution_options.isolation_level`
            - set per :class:`_engine.Connection` isolation level

        """
        dbapi_connection = self.connection.dbapi_connection
        assert dbapi_connection is not None
        try:
            return self.dialect.get_isolation_level(dbapi_connection)
        except BaseException as e:
            self._handle_dbapi_exception(e, None, None, None, None)

    @property
    def default_isolation_level(self) -> Optional[IsolationLevel]:
        """The initial-connection time isolation level associated with the
        :class:`_engine.Dialect` in use.

        This value is independent of the
        :paramref:`.Connection.execution_options.isolation_level` and
        :paramref:`.Engine.execution_options.isolation_level` execution
        options, and is determined by the :class:`_engine.Dialect` when the
        first connection is created, by performing a SQL query against the
        database for the current isolation level before any additional commands
        have been emitted.

        Calling this accessor does not invoke any new SQL queries.

        .. seealso::

            :meth:`_engine.Connection.get_isolation_level`
            - view current actual isolation level

            :paramref:`_sa.create_engine.isolation_level`
            - set per :class:`_engine.Engine` isolation level

            :paramref:`.Connection.execution_options.isolation_level`
            - set per :class:`_engine.Connection` isolation level

        """
        return self.dialect.default_isolation_level

    def _invalid_transaction(self) -> NoReturn:
        raise exc.PendingRollbackError(
            "Can't reconnect until invalid %stransaction is rolled "
            "back.  Please rollback() fully before proceeding"
            % ("savepoint " if self._nested_transaction is not None else ""),
            code="8s2b",
        )

    def _revalidate_connection(self) -> PoolProxiedConnection:
        if self.__can_reconnect and self.invalidated:
            if self._transaction is not None:
                self._invalid_transaction()
            self._dbapi_connection = self.engine.raw_connection()
            return self._dbapi_connection
        raise exc.ResourceClosedError("This Connection is closed")

    @property
    def info(self) -> _InfoType:
        """Info dictionary associated with the underlying DBAPI connection
        referred to by this :class:`_engine.Connection`, allowing user-defined
        data to be associated with the connection.

        The data here will follow along with the DBAPI connection including
        after it is returned to the connection pool and used again
        in subsequent instances of :class:`_engine.Connection`.

        """

        return self.connection.info

    def invalidate(self, exception: Optional[BaseException] = None) -> None:
        """Invalidate the underlying DBAPI connection associated with
        this :class:`_engine.Connection`.

        An attempt will be made to close the underlying DBAPI connection
        immediately; however if this operation fails, the error is logged
        but not raised.  The connection is then discarded whether or not
        close() succeeded.

        Upon the next use (where "use" typically means using the
        :meth:`_engine.Connection.execute` method or similar),
        this :class:`_engine.Connection` will attempt to
        procure a new DBAPI connection using the services of the
        :class:`_pool.Pool` as a source of connectivity (e.g.
        a "reconnection").

        If a transaction was in progress (e.g. the
        :meth:`_engine.Connection.begin` method has been called) when
        :meth:`_engine.Connection.invalidate` method is called, at the DBAPI
        level all state associated with this transaction is lost, as
        the DBAPI connection is closed.  The :class:`_engine.Connection`
        will not allow a reconnection to proceed until the
        :class:`.Transaction` object is ended, by calling the
        :meth:`.Transaction.rollback` method; until that point, any attempt at
        continuing to use the :class:`_engine.Connection` will raise an
        :class:`~sqlalchemy.exc.InvalidRequestError`.
        This is to prevent applications from accidentally
        continuing an ongoing transactional operations despite the
        fact that the transaction has been lost due to an
        invalidation.

        The :meth:`_engine.Connection.invalidate` method,
        just like auto-invalidation,
        will at the connection pool level invoke the
        :meth:`_events.PoolEvents.invalidate` event.

        :param exception: an optional ``Exception`` instance that's the
         reason for the invalidation.  is passed along to event handlers
         and logging functions.

        .. seealso::

            :ref:`pool_connection_invalidation`

        """

        if self.invalidated:
            return

        if self.closed:
            raise exc.ResourceClosedError("This Connection is closed")

        if self._still_open_and_dbapi_connection_is_valid:
            pool_proxied_connection = self._dbapi_connection
            assert pool_proxied_connection is not None
            pool_proxied_connection.invalidate(exception)

        self._dbapi_connection = None

    def detach(self) -> None:
        """Detach the underlying DB-API connection from its connection pool.

        E.g.::

            with engine.connect() as conn:
                conn.detach()
                conn.execute(text("SET search_path TO schema1, schema2"))

                # work with connection

            # connection is fully closed (since we used "with:", can
            # also call .close())

        This :class:`_engine.Connection` instance will remain usable.
        When closed
        (or exited from a context manager context as above),
        the DB-API connection will be literally closed and not
        returned to its originating pool.

        This method can be used to insulate the rest of an application
        from a modified state on a connection (such as a transaction
        isolation level or similar).

        """

        if self.closed:
            raise exc.ResourceClosedError("This Connection is closed")

        pool_proxied_connection = self._dbapi_connection
        if pool_proxied_connection is None:
            raise exc.InvalidRequestError(
                "Can't detach an invalidated Connection"
            )
        pool_proxied_connection.detach()

    def _autobegin(self) -> None:
        if self._allow_autobegin and not self.__in_begin:
            self.begin()

    def begin(self) -> RootTransaction:
        """Begin a transaction prior to autobegin occurring.

        E.g.::

            with engine.connect() as conn:
                with conn.begin() as trans:
                    conn.execute(table.insert(), {"username": "sandy"})


        The returned object is an instance of :class:`_engine.RootTransaction`.
        This object represents the "scope" of the transaction,
        which completes when either the :meth:`_engine.Transaction.rollback`
        or :meth:`_engine.Transaction.commit` method is called; the object
        also works as a context manager as illustrated above.

        The :meth:`_engine.Connection.begin` method begins a
        transaction that normally will be begun in any case when the connection
        is first used to execute a statement.  The reason this method might be
        used would be to invoke the :meth:`_events.ConnectionEvents.begin`
        event at a specific time, or to organize code within the scope of a
        connection checkout in terms of context managed blocks, such as::

            with engine.connect() as conn:
                with conn.begin():
                    conn.execute(...)
                    conn.execute(...)

                with conn.begin():
                    conn.execute(...)
                    conn.execute(...)

        The above code is not  fundamentally any different in its behavior than
        the following code  which does not use
        :meth:`_engine.Connection.begin`; the below style is known
        as "commit as you go" style::

            with engine.connect() as conn:
                conn.execute(...)
                conn.execute(...)
                conn.commit()

                conn.execute(...)
                conn.execute(...)
                conn.commit()

        From a database point of view, the :meth:`_engine.Connection.begin`
        method does not emit any SQL or change the state of the underlying
        DBAPI connection in any way; the Python DBAPI does not have any
        concept of explicit transaction begin.

        .. seealso::

            :ref:`tutorial_working_with_transactions` - in the
            :ref:`unified_tutorial`

            :meth:`_engine.Connection.begin_nested` - use a SAVEPOINT

            :meth:`_engine.Connection.begin_twophase` -
            use a two phase /XID transaction

            :meth:`_engine.Engine.begin` - context manager available from
            :class:`_engine.Engine`

        """
        if self._transaction is None:
            self._transaction = RootTransaction(self)
            return self._transaction
        else:
            raise exc.InvalidRequestError(
                "This connection has already initialized a SQLAlchemy "
                "Transaction() object via begin() or autobegin; can't "
                "call begin() here unless rollback() or commit() "
                "is called first."
            )

    def begin_nested(self) -> NestedTransaction:
        """Begin a nested transaction (i.e. SAVEPOINT) and return a transaction
        handle that controls the scope of the SAVEPOINT.

        E.g.::

            with engine.begin() as connection:
                with connection.begin_nested():
                    connection.execute(table.insert(), {"username": "sandy"})

        The returned object is an instance of
        :class:`_engine.NestedTransaction`, which includes transactional
        methods :meth:`_engine.NestedTransaction.commit` and
        :meth:`_engine.NestedTransaction.rollback`; for a nested transaction,
        these methods correspond to the operations "RELEASE SAVEPOINT <name>"
        and "ROLLBACK TO SAVEPOINT <name>". The name of the savepoint is local
        to the :class:`_engine.NestedTransaction` object and is generated
        automatically. Like any other :class:`_engine.Transaction`, the
        :class:`_engine.NestedTransaction` may be used as a context manager as
        illustrated above which will "release" or "rollback" corresponding to
        if the operation within the block were successful or raised an
        exception.

        Nested transactions require SAVEPOINT support in the underlying
        database, else the behavior is undefined. SAVEPOINT is commonly used to
        run operations within a transaction that may fail, while continuing the
        outer transaction. E.g.::

            from sqlalchemy import exc

            with engine.begin() as connection:
                trans = connection.begin_nested()
                try:
                    connection.execute(table.insert(), {"username": "sandy"})
                    trans.commit()
                except exc.IntegrityError:  # catch for duplicate username
                    trans.rollback()  # rollback to savepoint

                # outer transaction continues
                connection.execute( ... )

        If :meth:`_engine.Connection.begin_nested` is called without first
        calling :meth:`_engine.Connection.begin` or
        :meth:`_engine.Engine.begin`, the :class:`_engine.Connection` object
        will "autobegin" the outer transaction first. This outer transaction
        may be committed using "commit-as-you-go" style, e.g.::

            with engine.connect() as connection:  # begin() wasn't called

                with connection.begin_nested(): will auto-"begin()" first
                    connection.execute( ... )
                # savepoint is released

                connection.execute( ... )

                # explicitly commit outer transaction
                connection.commit()

                # can continue working with connection here

        .. versionchanged:: 2.0

            :meth:`_engine.Connection.begin_nested` will now participate
            in the connection "autobegin" behavior that is new as of
            2.0 / "future" style connections in 1.4.

        .. seealso::

            :meth:`_engine.Connection.begin`

            :ref:`session_begin_nested` - ORM support for SAVEPOINT

        """
        if self._transaction is None:
            self._autobegin()

        return NestedTransaction(self)

    def begin_twophase(self, xid: Optional[Any] = None) -> TwoPhaseTransaction:
        """Begin a two-phase or XA transaction and return a transaction
        handle.

        The returned object is an instance of :class:`.TwoPhaseTransaction`,
        which in addition to the methods provided by
        :class:`.Transaction`, also provides a
        :meth:`~.TwoPhaseTransaction.prepare` method.

        :param xid: the two phase transaction id.  If not supplied, a
          random id will be generated.

        .. seealso::

            :meth:`_engine.Connection.begin`

            :meth:`_engine.Connection.begin_twophase`

        """

        if self._transaction is not None:
            raise exc.InvalidRequestError(
                "Cannot start a two phase transaction when a transaction "
                "is already in progress."
            )
        if xid is None:
            xid = self.engine.dialect.create_xid()
        return TwoPhaseTransaction(self, xid)

    def commit(self) -> None:
        """Commit the transaction that is currently in progress.

        This method commits the current transaction if one has been started.
        If no transaction was started, the method has no effect, assuming
        the connection is in a non-invalidated state.

        A transaction is begun on a :class:`_engine.Connection` automatically
        whenever a statement is first executed, or when the
        :meth:`_engine.Connection.begin` method is called.

        .. note:: The :meth:`_engine.Connection.commit` method only acts upon
          the primary database transaction that is linked to the
          :class:`_engine.Connection` object.  It does not operate upon a
          SAVEPOINT that would have been invoked from the
          :meth:`_engine.Connection.begin_nested` method; for control of a
          SAVEPOINT, call :meth:`_engine.NestedTransaction.commit` on the
          :class:`_engine.NestedTransaction` that is returned by the
          :meth:`_engine.Connection.begin_nested` method itself.


        """
        if self._transaction:
            self._transaction.commit()

    def rollback(self) -> None:
        """Roll back the transaction that is currently in progress.

        This method rolls back the current transaction if one has been started.
        If no transaction was started, the method has no effect.  If a
        transaction was started and the connection is in an invalidated state,
        the transaction is cleared using this method.

        A transaction is begun on a :class:`_engine.Connection` automatically
        whenever a statement is first executed, or when the
        :meth:`_engine.Connection.begin` method is called.

        .. note:: The :meth:`_engine.Connection.rollback` method only acts
          upon the primary database transaction that is linked to the
          :class:`_engine.Connection` object.  It does not operate upon a
          SAVEPOINT that would have been invoked from the
          :meth:`_engine.Connection.begin_nested` method; for control of a
          SAVEPOINT, call :meth:`_engine.NestedTransaction.rollback` on the
          :class:`_engine.NestedTransaction` that is returned by the
          :meth:`_engine.Connection.begin_nested` method itself.


        """
        if self._transaction:
            self._transaction.rollback()

    def recover_twophase(self) -> List[Any]:
        return self.engine.dialect.do_recover_twophase(self)

    def rollback_prepared(self, xid: Any, recover: bool = False) -> None:
        self.engine.dialect.do_rollback_twophase(self, xid, recover=recover)

    def commit_prepared(self, xid: Any, recover: bool = False) -> None:
        self.engine.dialect.do_commit_twophase(self, xid, recover=recover)

    def in_transaction(self) -> bool:
        """Return True if a transaction is in progress."""
        return self._transaction is not None and self._transaction.is_active

    def in_nested_transaction(self) -> bool:
        """Return True if a transaction is in progress."""
        return (
            self._nested_transaction is not None
            and self._nested_transaction.is_active
        )

    def _is_autocommit_isolation(self) -> bool:
        opt_iso = self._execution_options.get("isolation_level", None)
        return bool(
            opt_iso == "AUTOCOMMIT"
            or (
                opt_iso is None
                and self.engine.dialect._on_connect_isolation_level
                == "AUTOCOMMIT"
            )
        )

    def _get_required_transaction(self) -> RootTransaction:
        trans = self._transaction
        if trans is None:
            raise exc.InvalidRequestError("connection is not in a transaction")
        return trans

    def _get_required_nested_transaction(self) -> NestedTransaction:
        trans = self._nested_transaction
        if trans is None:
            raise exc.InvalidRequestError(
                "connection is not in a nested transaction"
            )
        return trans

    def get_transaction(self) -> Optional[RootTransaction]:
        """Return the current root transaction in progress, if any.

        .. versionadded:: 1.4

        """

        return self._transaction

    def get_nested_transaction(self) -> Optional[NestedTransaction]:
        """Return the current nested transaction in progress, if any.

        .. versionadded:: 1.4

        """
        return self._nested_transaction

    def _begin_impl(self, transaction: RootTransaction) -> None:
        if self._echo:
            if self._is_autocommit_isolation():
                self._log_info(
                    "BEGIN (implicit; DBAPI should not BEGIN due to "
                    "autocommit mode)"
                )
            else:
                self._log_info("BEGIN (implicit)")

        self.__in_begin = True

        if self._has_events or self.engine._has_events:
            self.dispatch.begin(self)

        try:
            self.engine.dialect.do_begin(self.connection)
        except BaseException as e:
            self._handle_dbapi_exception(e, None, None, None, None)
        finally:
            self.__in_begin = False

    def _rollback_impl(self) -> None:
        if self._has_events or self.engine._has_events:
            self.dispatch.rollback(self)

        if self._still_open_and_dbapi_connection_is_valid:
            if self._echo:
                if self._is_autocommit_isolation():
                    self._log_info(
                        "ROLLBACK using DBAPI connection.rollback(), "
                        "DBAPI should ignore due to autocommit mode"
                    )
                else:
                    self._log_info("ROLLBACK")
            try:
                self.engine.dialect.do_rollback(self.connection)
            except BaseException as e:
                self._handle_dbapi_exception(e, None, None, None, None)

    def _commit_impl(self) -> None:
        if self._has_events or self.engine._has_events:
            self.dispatch.commit(self)

        if self._echo:
            if self._is_autocommit_isolation():
                self._log_info(
                    "COMMIT using DBAPI connection.commit(), "
                    "DBAPI should ignore due to autocommit mode"
                )
            else:
                self._log_info("COMMIT")
        try:
            self.engine.dialect.do_commit(self.connection)
        except BaseException as e:
            self._handle_dbapi_exception(e, None, None, None, None)

    def _savepoint_impl(self, name: Optional[str] = None) -> str:
        if self._has_events or self.engine._has_events:
            self.dispatch.savepoint(self, name)

        if name is None:
            self.__savepoint_seq += 1
            name = "sa_savepoint_%s" % self.__savepoint_seq
        self.engine.dialect.do_savepoint(self, name)
        return name

    def _rollback_to_savepoint_impl(self, name: str) -> None:
        if self._has_events or self.engine._has_events:
            self.dispatch.rollback_savepoint(self, name, None)

        if self._still_open_and_dbapi_connection_is_valid:
            self.engine.dialect.do_rollback_to_savepoint(self, name)

    def _release_savepoint_impl(self, name: str) -> None:
        if self._has_events or self.engine._has_events:
            self.dispatch.release_savepoint(self, name, None)

        self.engine.dialect.do_release_savepoint(self, name)

    def _begin_twophase_impl(self, transaction: TwoPhaseTransaction) -> None:
        if self._echo:
            self._log_info("BEGIN TWOPHASE (implicit)")
        if self._has_events or self.engine._has_events:
            self.dispatch.begin_twophase(self, transaction.xid)

        self.__in_begin = True
        try:
            self.engine.dialect.do_begin_twophase(self, transaction.xid)
        except BaseException as e:
            self._handle_dbapi_exception(e, None, None, None, None)
        finally:
            self.__in_begin = False

    def _prepare_twophase_impl(self, xid: Any) -> None:
        if self._has_events or self.engine._has_events:
            self.dispatch.prepare_twophase(self, xid)

        assert isinstance(self._transaction, TwoPhaseTransaction)
        try:
            self.engine.dialect.do_prepare_twophase(self, xid)
        except BaseException as e:
            self._handle_dbapi_exception(e, None, None, None, None)

    def _rollback_twophase_impl(self, xid: Any, is_prepared: bool) -> None:
        if self._has_events or self.engine._has_events:
            self.dispatch.rollback_twophase(self, xid, is_prepared)

        if self._still_open_and_dbapi_connection_is_valid:
            assert isinstance(self._transaction, TwoPhaseTransaction)
            try:
                self.engine.dialect.do_rollback_twophase(
                    self, xid, is_prepared
                )
            except BaseException as e:
                self._handle_dbapi_exception(e, None, None, None, None)

    def _commit_twophase_impl(self, xid: Any, is_prepared: bool) -> None:
        if self._has_events or self.engine._has_events:
            self.dispatch.commit_twophase(self, xid, is_prepared)

        assert isinstance(self._transaction, TwoPhaseTransaction)
        try:
            self.engine.dialect.do_commit_twophase(self, xid, is_prepared)
        except BaseException as e:
            self._handle_dbapi_exception(e, None, None, None, None)

    def close(self) -> None:
        """Close this :class:`_engine.Connection`.

        This results in a release of the underlying database
        resources, that is, the DBAPI connection referenced
        internally. The DBAPI connection is typically restored
        back to the connection-holding :class:`_pool.Pool` referenced
        by the :class:`_engine.Engine` that produced this
        :class:`_engine.Connection`. Any transactional state present on
        the DBAPI connection is also unconditionally released via
        the DBAPI connection's ``rollback()`` method, regardless
        of any :class:`.Transaction` object that may be
        outstanding with regards to this :class:`_engine.Connection`.

        This has the effect of also calling :meth:`_engine.Connection.rollback`
        if any transaction is in place.

        After :meth:`_engine.Connection.close` is called, the
        :class:`_engine.Connection` is permanently in a closed state,
        and will allow no further operations.

        """

        if self._transaction:
            self._transaction.close()
            skip_reset = True
        else:
            skip_reset = False

        if self._dbapi_connection is not None:
            conn = self._dbapi_connection

            # as we just closed the transaction, close the connection
            # pool connection without doing an additional reset
            if skip_reset:
                cast("_ConnectionFairy", conn)._close_special(
                    transaction_reset=True
                )
            else:
                conn.close()

            # There is a slight chance that conn.close() may have
            # triggered an invalidation here in which case
            # _dbapi_connection would already be None, however usually
            # it will be non-None here and in a "closed" state.
            self._dbapi_connection = None
        self.__can_reconnect = False

    @overload
    def scalar(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> Optional[_T]:
        ...

    @overload
    def scalar(
        self,
        statement: Executable,
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> Any:
        ...

    def scalar(
        self,
        statement: Executable,
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> Any:
        r"""Executes a SQL statement construct and returns a scalar object.

        This method is shorthand for invoking the
        :meth:`_engine.Result.scalar` method after invoking the
        :meth:`_engine.Connection.execute` method.  Parameters are equivalent.

        :return: a scalar Python value representing the first column of the
         first row returned.

        """
        distilled_parameters = _distill_params_20(parameters)
        try:
            meth = statement._execute_on_scalar
        except AttributeError as err:
            raise exc.ObjectNotExecutableError(statement) from err
        else:
            return meth(
                self,
                distilled_parameters,
                execution_options or NO_OPTIONS,
            )

    @overload
    def scalars(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> ScalarResult[_T]:
        ...

    @overload
    def scalars(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> ScalarResult[Any]:
        ...

    def scalars(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> ScalarResult[Any]:
        """Executes and returns a scalar result set, which yields scalar values
        from the first column of each row.

        This method is equivalent to calling :meth:`_engine.Connection.execute`
        to receive a :class:`_result.Result` object, then invoking the
        :meth:`_result.Result.scalars` method to produce a
        :class:`_result.ScalarResult` instance.

        :return: a :class:`_result.ScalarResult`

        .. versionadded:: 1.4.24

        """

        return self.execute(
            statement, parameters, execution_options=execution_options
        ).scalars()

    @overload
    def execute(
        self,
        statement: TypedReturnsRows[_T],
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[_T]:
        ...

    @overload
    def execute(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[Any]:
        ...

    def execute(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[Any]:
        r"""Executes a SQL statement construct and returns a
        :class:`_engine.CursorResult`.

        :param statement: The statement to be executed.  This is always
         an object that is in both the :class:`_expression.ClauseElement` and
         :class:`_expression.Executable` hierarchies, including:

         * :class:`_expression.Select`
         * :class:`_expression.Insert`, :class:`_expression.Update`,
           :class:`_expression.Delete`
         * :class:`_expression.TextClause` and
           :class:`_expression.TextualSelect`
         * :class:`_schema.DDL` and objects which inherit from
           :class:`_schema.ExecutableDDLElement`

        :param parameters: parameters which will be bound into the statement.
         This may be either a dictionary of parameter names to values,
         or a mutable sequence (e.g. a list) of dictionaries.  When a
         list of dictionaries is passed, the underlying statement execution
         will make use of the DBAPI ``cursor.executemany()`` method.
         When a single dictionary is passed, the DBAPI ``cursor.execute()``
         method will be used.

        :param execution_options: optional dictionary of execution options,
         which will be associated with the statement execution.  This
         dictionary can provide a subset of the options that are accepted
         by :meth:`_engine.Connection.execution_options`.

        :return: a :class:`_engine.Result` object.

        """
        distilled_parameters = _distill_params_20(parameters)
        try:
            meth = statement._execute_on_connection
        except AttributeError as err:
            raise exc.ObjectNotExecutableError(statement) from err
        else:
            return meth(
                self,
                distilled_parameters,
                execution_options or NO_OPTIONS,
            )

    def _execute_function(
        self,
        func: FunctionElement[Any],
        distilled_parameters: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> CursorResult[Any]:
        """Execute a sql.FunctionElement object."""

        return self._execute_clauseelement(
            func.select(), distilled_parameters, execution_options
        )

    def _execute_default(
        self,
        default: DefaultGenerator,
        distilled_parameters: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> Any:
        """Execute a schema.ColumnDefault object."""

        execution_options = self._execution_options.merge_with(
            execution_options
        )

        event_multiparams: Optional[_CoreMultiExecuteParams]
        event_params: Optional[_CoreAnyExecuteParams]

        # note for event handlers, the "distilled parameters" which is always
        # a list of dicts is broken out into separate "multiparams" and
        # "params" collections, which allows the handler to distinguish
        # between an executemany and execute style set of parameters.
        if self._has_events or self.engine._has_events:
            (
                default,
                distilled_parameters,
                event_multiparams,
                event_params,
            ) = self._invoke_before_exec_event(
                default, distilled_parameters, execution_options
            )
        else:
            event_multiparams = event_params = None

        try:
            conn = self._dbapi_connection
            if conn is None:
                conn = self._revalidate_connection()

            dialect = self.dialect
            ctx = dialect.execution_ctx_cls._init_default(
                dialect, self, conn, execution_options
            )
        except (exc.PendingRollbackError, exc.ResourceClosedError):
            raise
        except BaseException as e:
            self._handle_dbapi_exception(e, None, None, None, None)

        ret = ctx._exec_default(None, default, None)

        if self._has_events or self.engine._has_events:
            self.dispatch.after_execute(
                self,
                default,
                event_multiparams,
                event_params,
                execution_options,
                ret,
            )

        return ret

    def _execute_ddl(
        self,
        ddl: ExecutableDDLElement,
        distilled_parameters: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> CursorResult[Any]:
        """Execute a schema.DDL object."""

        execution_options = ddl._execution_options.merge_with(
            self._execution_options, execution_options
        )

        event_multiparams: Optional[_CoreMultiExecuteParams]
        event_params: Optional[_CoreSingleExecuteParams]

        if self._has_events or self.engine._has_events:
            (
                ddl,
                distilled_parameters,
                event_multiparams,
                event_params,
            ) = self._invoke_before_exec_event(
                ddl, distilled_parameters, execution_options
            )
        else:
            event_multiparams = event_params = None

        exec_opts = self._execution_options.merge_with(execution_options)
        schema_translate_map = exec_opts.get("schema_translate_map", None)

        dialect = self.dialect

        compiled = ddl.compile(
            dialect=dialect, schema_translate_map=schema_translate_map
        )
        ret = self._execute_context(
            dialect,
            dialect.execution_ctx_cls._init_ddl,
            compiled,
            None,
            execution_options,
            compiled,
        )
        if self._has_events or self.engine._has_events:
            self.dispatch.after_execute(
                self,
                ddl,
                event_multiparams,
                event_params,
                execution_options,
                ret,
            )
        return ret

    def _invoke_before_exec_event(
        self,
        elem: Any,
        distilled_params: _CoreMultiExecuteParams,
        execution_options: _ExecuteOptions,
    ) -> Tuple[
        Any,
        _CoreMultiExecuteParams,
        _CoreMultiExecuteParams,
        _CoreSingleExecuteParams,
    ]:
        event_multiparams: _CoreMultiExecuteParams
        event_params: _CoreSingleExecuteParams

        if len(distilled_params) == 1:
            event_multiparams, event_params = [], distilled_params[0]
        else:
            event_multiparams, event_params = distilled_params, {}

        for fn in self.dispatch.before_execute:
            elem, event_multiparams, event_params = fn(
                self,
                elem,
                event_multiparams,
                event_params,
                execution_options,
            )

        if event_multiparams:
            distilled_params = list(event_multiparams)
            if event_params:
                raise exc.InvalidRequestError(
                    "Event handler can't return non-empty multiparams "
                    "and params at the same time"
                )
        elif event_params:
            distilled_params = [event_params]
        else:
            distilled_params = []

        return elem, distilled_params, event_multiparams, event_params

    def _execute_clauseelement(
        self,
        elem: Executable,
        distilled_parameters: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter,
    ) -> CursorResult[Any]:
        """Execute a sql.ClauseElement object."""

        execution_options = elem._execution_options.merge_with(
            self._execution_options, execution_options
        )

        has_events = self._has_events or self.engine._has_events
        if has_events:
            (
                elem,
                distilled_parameters,
                event_multiparams,
                event_params,
            ) = self._invoke_before_exec_event(
                elem, distilled_parameters, execution_options
            )

        if distilled_parameters:
            # ensure we don't retain a link to the view object for keys()
            # which links to the values, which we don't want to cache
            keys = sorted(distilled_parameters[0])
            for_executemany = len(distilled_parameters) > 1
        else:
            keys = []
            for_executemany = False

        dialect = self.dialect

        schema_translate_map = execution_options.get(
            "schema_translate_map", None
        )

        compiled_cache: Optional[CompiledCacheType] = execution_options.get(
            "compiled_cache", self.engine._compiled_cache
        )

        compiled_sql, extracted_params, cache_hit = elem._compile_w_cache(
            dialect=dialect,
            compiled_cache=compiled_cache,
            column_keys=keys,
            for_executemany=for_executemany,
            schema_translate_map=schema_translate_map,
            linting=self.dialect.compiler_linting | compiler.WARN_LINTING,
        )
        ret = self._execute_context(
            dialect,
            dialect.execution_ctx_cls._init_compiled,
            compiled_sql,
            distilled_parameters,
            execution_options,
            compiled_sql,
            distilled_parameters,
            elem,
            extracted_params,
            cache_hit=cache_hit,
        )
        if has_events:
            self.dispatch.after_execute(
                self,
                elem,
                event_multiparams,
                event_params,
                execution_options,
                ret,
            )
        return ret

    def _execute_compiled(
        self,
        compiled: Compiled,
        distilled_parameters: _CoreMultiExecuteParams,
        execution_options: CoreExecuteOptionsParameter = _EMPTY_EXECUTION_OPTS,
    ) -> CursorResult[Any]:
        """Execute a sql.Compiled object.

        TODO: why do we have this?   likely deprecate or remove

        """

        execution_options = compiled.execution_options.merge_with(
            self._execution_options, execution_options
        )

        if self._has_events or self.engine._has_events:
            (
                compiled,
                distilled_parameters,
                event_multiparams,
                event_params,
            ) = self._invoke_before_exec_event(
                compiled, distilled_parameters, execution_options
            )

        dialect = self.dialect

        ret = self._execute_context(
            dialect,
            dialect.execution_ctx_cls._init_compiled,
            compiled,
            distilled_parameters,
            execution_options,
            compiled,
            distilled_parameters,
            None,
            None,
        )
        if self._has_events or self.engine._has_events:
            self.dispatch.after_execute(
                self,
                compiled,
                event_multiparams,
                event_params,
                execution_options,
                ret,
            )
        return ret

    def exec_driver_sql(
        self,
        statement: str,
        parameters: Optional[_DBAPIAnyExecuteParams] = None,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[Any]:
        r"""Executes a string SQL statement on the DBAPI cursor directly,
        without any SQL compilation steps.

        This can be used to pass any string directly to the
        ``cursor.execute()`` method of the DBAPI in use.

        :param statement: The statement str to be executed.   Bound parameters
         must use the underlying DBAPI's paramstyle, such as "qmark",
         "pyformat", "format", etc.

        :param parameters: represent bound parameter values to be used in the
         execution.  The format is one of:   a dictionary of named parameters,
         a tuple of positional parameters, or a list containing either
         dictionaries or tuples for multiple-execute support.

        :return: a :class:`_engine.CursorResult`.

         E.g. multiple dictionaries::


             conn.exec_driver_sql(
                 "INSERT INTO table (id, value) VALUES (%(id)s, %(value)s)",
                 [{"id":1, "value":"v1"}, {"id":2, "value":"v2"}]
             )

         Single dictionary::

             conn.exec_driver_sql(
                 "INSERT INTO table (id, value) VALUES (%(id)s, %(value)s)",
                 dict(id=1, value="v1")
             )

         Single tuple::

             conn.exec_driver_sql(
                 "INSERT INTO table (id, value) VALUES (?, ?)",
                 (1, 'v1')
             )

         .. note:: The :meth:`_engine.Connection.exec_driver_sql` method does
             not participate in the
             :meth:`_events.ConnectionEvents.before_execute` and
             :meth:`_events.ConnectionEvents.after_execute` events.   To
             intercept calls to :meth:`_engine.Connection.exec_driver_sql`, use
             :meth:`_events.ConnectionEvents.before_cursor_execute` and
             :meth:`_events.ConnectionEvents.after_cursor_execute`.

         .. seealso::

            :pep:`249`

        """

        distilled_parameters = _distill_raw_params(parameters)

        execution_options = self._execution_options.merge_with(
            execution_options
        )

        dialect = self.dialect
        ret = self._execute_context(
            dialect,
            dialect.execution_ctx_cls._init_statement,
            statement,
            None,
            execution_options,
            statement,
            distilled_parameters,
        )

        return ret

    def _execute_context(
        self,
        dialect: Dialect,
        constructor: Callable[..., ExecutionContext],
        statement: Union[str, Compiled],
        parameters: Optional[_AnyMultiExecuteParams],
        execution_options: _ExecuteOptions,
        *args: Any,
        **kw: Any,
    ) -> CursorResult[Any]:
        """Create an :class:`.ExecutionContext` and execute, returning
        a :class:`_engine.CursorResult`."""

        if execution_options:
            yp = execution_options.get("yield_per", None)
            if yp:
                execution_options = execution_options.union(
                    {"stream_results": True, "max_row_buffer": yp}
                )
        try:
            conn = self._dbapi_connection
            if conn is None:
                conn = self._revalidate_connection()

            context = constructor(
                dialect, self, conn, execution_options, *args, **kw
            )
        except (exc.PendingRollbackError, exc.ResourceClosedError):
            raise
        except BaseException as e:
            self._handle_dbapi_exception(
                e, str(statement), parameters, None, None
            )

        if (
            self._transaction
            and not self._transaction.is_active
            or (
                self._nested_transaction
                and not self._nested_transaction.is_active
            )
        ):
            self._invalid_transaction()

        elif self._trans_context_manager:
            TransactionalContext._trans_ctx_check(self)

        if self._transaction is None:
            self._autobegin()

        context.pre_exec()

        if context.execute_style is ExecuteStyle.INSERTMANYVALUES:
            return self._exec_insertmany_context(
                dialect,
                context,
            )
        else:
            return self._exec_single_context(
                dialect, context, statement, parameters
            )

    def _exec_single_context(
        self,
        dialect: Dialect,
        context: ExecutionContext,
        statement: Union[str, Compiled],
        parameters: Optional[_AnyMultiExecuteParams],
    ) -> CursorResult[Any]:
        """continue the _execute_context() method for a single DBAPI
        cursor.execute() or cursor.executemany() call.

        """
        if dialect.bind_typing is BindTyping.SETINPUTSIZES:
            generic_setinputsizes = context._prepare_set_input_sizes()

            if generic_setinputsizes:
                try:
                    dialect.do_set_input_sizes(
                        context.cursor, generic_setinputsizes, context
                    )
                except BaseException as e:
                    self._handle_dbapi_exception(
                        e, str(statement), parameters, None, context
                    )

        cursor, str_statement, parameters = (
            context.cursor,
            context.statement,
            context.parameters,
        )

        effective_parameters: Optional[_AnyExecuteParams]

        if not context.executemany:
            effective_parameters = parameters[0]
        else:
            effective_parameters = parameters

        if self._has_events or self.engine._has_events:
            for fn in self.dispatch.before_cursor_execute:
                str_statement, effective_parameters = fn(
                    self,
                    cursor,
                    str_statement,
                    effective_parameters,
                    context,
                    context.executemany,
                )

        if self._echo:
            self._log_info(str_statement)

            stats = context._get_cache_stats()

            if not self.engine.hide_parameters:
                self._log_info(
                    "[%s] %r",
                    stats,
                    sql_util._repr_params(
                        effective_parameters,
                        batches=10,
                        ismulti=context.executemany,
                    ),
                )
            else:
                self._log_info(
                    "[%s] [SQL parameters hidden due to hide_parameters=True]",
                    stats,
                )

        evt_handled: bool = False
        try:
            if context.execute_style is ExecuteStyle.EXECUTEMANY:
                effective_parameters = cast(
                    "_CoreMultiExecuteParams", effective_parameters
                )
                if self.dialect._has_events:
                    for fn in self.dialect.dispatch.do_executemany:
                        if fn(
                            cursor,
                            str_statement,
                            effective_parameters,
                            context,
                        ):
                            evt_handled = True
                            break
                if not evt_handled:
                    self.dialect.do_executemany(
                        cursor,
                        str_statement,
                        effective_parameters,
                        context,
                    )
            elif not effective_parameters and context.no_parameters:
                if self.dialect._has_events:
                    for fn in self.dialect.dispatch.do_execute_no_params:
                        if fn(cursor, str_statement, context):
                            evt_handled = True
                            break
                if not evt_handled:
                    self.dialect.do_execute_no_params(
                        cursor, str_statement, context
                    )
            else:
                effective_parameters = cast(
                    "_CoreSingleExecuteParams", effective_parameters
                )
                if self.dialect._has_events:
                    for fn in self.dialect.dispatch.do_execute:
                        if fn(
                            cursor,
                            str_statement,
                            effective_parameters,
                            context,
                        ):
                            evt_handled = True
                            break
                if not evt_handled:
                    self.dialect.do_execute(
                        cursor, str_statement, effective_parameters, context
                    )

            if self._has_events or self.engine._has_events:
                self.dispatch.after_cursor_execute(
                    self,
                    cursor,
                    str_statement,
                    effective_parameters,
                    context,
                    context.executemany,
                )

            context.post_exec()

            result = context._setup_result_proxy()

        except BaseException as e:
            self._handle_dbapi_exception(
                e, str_statement, effective_parameters, cursor, context
            )

        return result

    def _exec_insertmany_context(
        self,
        dialect: Dialect,
        context: ExecutionContext,
    ) -> CursorResult[Any]:
        """continue the _execute_context() method for an "insertmanyvalues"
        operation, which will invoke DBAPI
        cursor.execute() one or more times with individual log and
        event hook calls.

        """

        if dialect.bind_typing is BindTyping.SETINPUTSIZES:
            generic_setinputsizes = context._prepare_set_input_sizes()
        else:
            generic_setinputsizes = None

        cursor, str_statement, parameters = (
            context.cursor,
            context.statement,
            context.parameters,
        )

        effective_parameters = parameters

        engine_events = self._has_events or self.engine._has_events
        if self.dialect._has_events:
            do_execute_dispatch: Iterable[
                Any
            ] = self.dialect.dispatch.do_execute
        else:
            do_execute_dispatch = ()

        if self._echo:
            stats = context._get_cache_stats() + " (insertmanyvalues)"

        for imv_batch in dialect._deliver_insertmanyvalues_batches(
            cursor,
            str_statement,
            effective_parameters,
            generic_setinputsizes,
            context,
        ):
            if imv_batch.processed_setinputsizes:
                try:
                    dialect.do_set_input_sizes(
                        context.cursor,
                        imv_batch.processed_setinputsizes,
                        context,
                    )
                except BaseException as e:
                    self._handle_dbapi_exception(
                        e,
                        sql_util._long_statement(imv_batch.replaced_statement),
                        imv_batch.replaced_parameters,
                        None,
                        context,
                    )

            sub_stmt = imv_batch.replaced_statement
            sub_params = imv_batch.replaced_parameters

            if engine_events:
                for fn in self.dispatch.before_cursor_execute:
                    sub_stmt, sub_params = fn(
                        self,
                        cursor,
                        sub_stmt,
                        sub_params,
                        context,
                        True,
                    )

            if self._echo:
                self._log_info(sql_util._long_statement(sub_stmt))

                imv_stats = f""" {imv_batch.batchnum}/{
                            imv_batch.total_batches
                } ({
                    'ordered'
                    if imv_batch.rows_sorted else 'unordered'
                }{
                    '; batch not supported'
                    if imv_batch.is_downgraded
                    else ''
                })"""

                if imv_batch.batchnum == 1:
                    stats += imv_stats
                else:
                    stats = f"insertmanyvalues{imv_stats}"

                if not self.engine.hide_parameters:
                    self._log_info(
                        "[%s] %r",
                        stats,
                        sql_util._repr_params(
                            sub_params,
                            batches=10,
                            ismulti=False,
                        ),
                    )
                else:
                    self._log_info(
                        "[%s] [SQL parameters hidden due to "
                        "hide_parameters=True]",
                        stats,
                    )

            try:
                for fn in do_execute_dispatch:
                    if fn(
                        cursor,
                        sub_stmt,
                        sub_params,
                        context,
                    ):
                        break
                else:
                    dialect.do_execute(
                        cursor,
                        sub_stmt,
                        sub_params,
                        context,
                    )

            except BaseException as e:
                self._handle_dbapi_exception(
                    e,
                    sql_util._long_statement(sub_stmt),
                    sub_params,
                    cursor,
                    context,
                    is_sub_exec=True,
                )

            if engine_events:
                self.dispatch.after_cursor_execute(
                    self,
                    cursor,
                    str_statement,
                    effective_parameters,
                    context,
                    context.executemany,
                )

        try:
            context.post_exec()

            result = context._setup_result_proxy()

        except BaseException as e:
            self._handle_dbapi_exception(
                e, str_statement, effective_parameters, cursor, context
            )

        return result

    def _cursor_execute(
        self,
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPISingleExecuteParams,
        context: Optional[ExecutionContext] = None,
    ) -> None:
        """Execute a statement + params on the given cursor.

        Adds appropriate logging and exception handling.

        This method is used by DefaultDialect for special-case
        executions, such as for sequences and column defaults.
        The path of statement execution in the majority of cases
        terminates at _execute_context().

        """
        if self._has_events or self.engine._has_events:
            for fn in self.dispatch.before_cursor_execute:
                statement, parameters = fn(
                    self, cursor, statement, parameters, context, False
                )

        if self._echo:
            self._log_info(statement)
            self._log_info("[raw sql] %r", parameters)
        try:
            for fn in (
                ()
                if not self.dialect._has_events
                else self.dialect.dispatch.do_execute
            ):
                if fn(cursor, statement, parameters, context):
                    break
            else:
                self.dialect.do_execute(cursor, statement, parameters, context)
        except BaseException as e:
            self._handle_dbapi_exception(
                e, statement, parameters, cursor, context
            )

        if self._has_events or self.engine._has_events:
            self.dispatch.after_cursor_execute(
                self, cursor, statement, parameters, context, False
            )

    def _safe_close_cursor(self, cursor: DBAPICursor) -> None:
        """Close the given cursor, catching exceptions
        and turning into log warnings.

        """
        try:
            cursor.close()
        except Exception:
            # log the error through the connection pool's logger.
            self.engine.pool.logger.error(
                "Error closing cursor", exc_info=True
            )

    _reentrant_error = False
    _is_disconnect = False

    def _handle_dbapi_exception(
        self,
        e: BaseException,
        statement: Optional[str],
        parameters: Optional[_AnyExecuteParams],
        cursor: Optional[DBAPICursor],
        context: Optional[ExecutionContext],
        is_sub_exec: bool = False,
    ) -> NoReturn:
        exc_info = sys.exc_info()

        is_exit_exception = util.is_exit_exception(e)

        if not self._is_disconnect:
            self._is_disconnect = (
                isinstance(e, self.dialect.loaded_dbapi.Error)
                and not self.closed
                and self.dialect.is_disconnect(
                    e,
                    self._dbapi_connection if not self.invalidated else None,
                    cursor,
                )
            ) or (is_exit_exception and not self.closed)

        invalidate_pool_on_disconnect = not is_exit_exception

        ismulti: bool = (
            not is_sub_exec and context.executemany
            if context is not None
            else False
        )
        if self._reentrant_error:
            raise exc.DBAPIError.instance(
                statement,
                parameters,
                e,
                self.dialect.loaded_dbapi.Error,
                hide_parameters=self.engine.hide_parameters,
                dialect=self.dialect,
                ismulti=ismulti,
            ).with_traceback(exc_info[2]) from e
        self._reentrant_error = True
        try:
            # non-DBAPI error - if we already got a context,
            # or there's no string statement, don't wrap it
            should_wrap = isinstance(e, self.dialect.loaded_dbapi.Error) or (
                statement is not None
                and context is None
                and not is_exit_exception
            )

            if should_wrap:
                sqlalchemy_exception = exc.DBAPIError.instance(
                    statement,
                    parameters,
                    cast(Exception, e),
                    self.dialect.loaded_dbapi.Error,
                    hide_parameters=self.engine.hide_parameters,
                    connection_invalidated=self._is_disconnect,
                    dialect=self.dialect,
                    ismulti=ismulti,
                )
            else:
                sqlalchemy_exception = None

            newraise = None

            if (self.dialect._has_events) and not self._execution_options.get(
                "skip_user_error_events", False
            ):
                ctx = ExceptionContextImpl(
                    e,
                    sqlalchemy_exception,
                    self.engine,
                    self.dialect,
                    self,
                    cursor,
                    statement,
                    parameters,
                    context,
                    self._is_disconnect,
                    invalidate_pool_on_disconnect,
                    False,
                )

                for fn in self.dialect.dispatch.handle_error:
                    try:
                        # handler returns an exception;
                        # call next handler in a chain
                        per_fn = fn(ctx)
                        if per_fn is not None:
                            ctx.chained_exception = newraise = per_fn
                    except Exception as _raised:
                        # handler raises an exception - stop processing
                        newraise = _raised
                        break

                if self._is_disconnect != ctx.is_disconnect:
                    self._is_disconnect = ctx.is_disconnect
                    if sqlalchemy_exception:
                        sqlalchemy_exception.connection_invalidated = (
                            ctx.is_disconnect
                        )

                # set up potentially user-defined value for
                # invalidate pool.
                invalidate_pool_on_disconnect = (
                    ctx.invalidate_pool_on_disconnect
                )

            if should_wrap and context:
                context.handle_dbapi_exception(e)

            if not self._is_disconnect:
                if cursor:
                    self._safe_close_cursor(cursor)
                # "autorollback" was mostly relevant in 1.x series.
                # It's very unlikely to reach here, as the connection
                # does autobegin so when we are here, we are usually
                # in an explicit / semi-explicit transaction.
                # however we have a test which manufactures this
                # scenario in any case using an event handler.
                # test/engine/test_execute.py-> test_actual_autorollback
                if not self.in_transaction():
                    self._rollback_impl()

            if newraise:
                raise newraise.with_traceback(exc_info[2]) from e
            elif should_wrap:
                assert sqlalchemy_exception is not None
                raise sqlalchemy_exception.with_traceback(exc_info[2]) from e
            else:
                assert exc_info[1] is not None
                raise exc_info[1].with_traceback(exc_info[2])
        finally:
            del self._reentrant_error
            if self._is_disconnect:
                del self._is_disconnect
                if not self.invalidated:
                    dbapi_conn_wrapper = self._dbapi_connection
                    assert dbapi_conn_wrapper is not None
                    if invalidate_pool_on_disconnect:
                        self.engine.pool._invalidate(dbapi_conn_wrapper, e)
                    self.invalidate(e)

    @classmethod
    def _handle_dbapi_exception_noconnection(
        cls,
        e: BaseException,
        dialect: Dialect,
        engine: Optional[Engine] = None,
        is_disconnect: Optional[bool] = None,
        invalidate_pool_on_disconnect: bool = True,
        is_pre_ping: bool = False,
    ) -> NoReturn:
        exc_info = sys.exc_info()

        if is_disconnect is None:
            is_disconnect = isinstance(
                e, dialect.loaded_dbapi.Error
            ) and dialect.is_disconnect(e, None, None)

        should_wrap = isinstance(e, dialect.loaded_dbapi.Error)

        if should_wrap:
            sqlalchemy_exception = exc.DBAPIError.instance(
                None,
                None,
                cast(Exception, e),
                dialect.loaded_dbapi.Error,
                hide_parameters=engine.hide_parameters
                if engine is not None
                else False,
                connection_invalidated=is_disconnect,
                dialect=dialect,
            )
        else:
            sqlalchemy_exception = None

        newraise = None

        if dialect._has_events:
            ctx = ExceptionContextImpl(
                e,
                sqlalchemy_exception,
                engine,
                dialect,
                None,
                None,
                None,
                None,
                None,
                is_disconnect,
                invalidate_pool_on_disconnect,
                is_pre_ping,
            )
            for fn in dialect.dispatch.handle_error:
                try:
                    # handler returns an exception;
                    # call next handler in a chain
                    per_fn = fn(ctx)
                    if per_fn is not None:
                        ctx.chained_exception = newraise = per_fn
                except Exception as _raised:
                    # handler raises an exception - stop processing
                    newraise = _raised
                    break

            if sqlalchemy_exception and is_disconnect != ctx.is_disconnect:
                sqlalchemy_exception.connection_invalidated = (
                    is_disconnect
                ) = ctx.is_disconnect

        if newraise:
            raise newraise.with_traceback(exc_info[2]) from e
        elif should_wrap:
            assert sqlalchemy_exception is not None
            raise sqlalchemy_exception.with_traceback(exc_info[2]) from e
        else:
            assert exc_info[1] is not None
            raise exc_info[1].with_traceback(exc_info[2])

    def _run_ddl_visitor(
        self,
        visitorcallable: Type[Union[SchemaGenerator, SchemaDropper]],
        element: SchemaItem,
        **kwargs: Any,
    ) -> None:
        """run a DDL visitor.

        This method is only here so that the MockConnection can change the
        options given to the visitor so that "checkfirst" is skipped.

        """
        visitorcallable(self.dialect, self, **kwargs).traverse_single(element)


class ExceptionContextImpl(ExceptionContext):
    """Implement the :class:`.ExceptionContext` interface."""

    __slots__ = (
        "connection",
        "engine",
        "dialect",
        "cursor",
        "statement",
        "parameters",
        "original_exception",
        "sqlalchemy_exception",
        "chained_exception",
        "execution_context",
        "is_disconnect",
        "invalidate_pool_on_disconnect",
        "is_pre_ping",
    )

    def __init__(
        self,
        exception: BaseException,
        sqlalchemy_exception: Optional[exc.StatementError],
        engine: Optional[Engine],
        dialect: Dialect,
        connection: Optional[Connection],
        cursor: Optional[DBAPICursor],
        statement: Optional[str],
        parameters: Optional[_DBAPIAnyExecuteParams],
        context: Optional[ExecutionContext],
        is_disconnect: bool,
        invalidate_pool_on_disconnect: bool,
        is_pre_ping: bool,
    ):
        self.engine = engine
        self.dialect = dialect
        self.connection = connection
        self.sqlalchemy_exception = sqlalchemy_exception
        self.original_exception = exception
        self.execution_context = context
        self.statement = statement
        self.parameters = parameters
        self.is_disconnect = is_disconnect
        self.invalidate_pool_on_disconnect = invalidate_pool_on_disconnect
        self.is_pre_ping = is_pre_ping


class Transaction(TransactionalContext):
    """Represent a database transaction in progress.

    The :class:`.Transaction` object is procured by
    calling the :meth:`_engine.Connection.begin` method of
    :class:`_engine.Connection`::

        from sqlalchemy import create_engine
        engine = create_engine("postgresql+psycopg2://scott:tiger@localhost/test")
        connection = engine.connect()
        trans = connection.begin()
        connection.execute(text("insert into x (a, b) values (1, 2)"))
        trans.commit()

    The object provides :meth:`.rollback` and :meth:`.commit`
    methods in order to control transaction boundaries.  It
    also implements a context manager interface so that
    the Python ``with`` statement can be used with the
    :meth:`_engine.Connection.begin` method::

        with connection.begin():
            connection.execute(text("insert into x (a, b) values (1, 2)"))

    The Transaction object is **not** threadsafe.

    .. seealso::

        :meth:`_engine.Connection.begin`

        :meth:`_engine.Connection.begin_twophase`

        :meth:`_engine.Connection.begin_nested`

    .. index::
      single: thread safety; Transaction
    """  # noqa

    __slots__ = ()

    _is_root: bool = False
    is_active: bool
    connection: Connection

    def __init__(self, connection: Connection):
        raise NotImplementedError()

    @property
    def _deactivated_from_connection(self) -> bool:
        """True if this transaction is totally deactivated from the connection
        and therefore can no longer affect its state.

        """
        raise NotImplementedError()

    def _do_close(self) -> None:
        raise NotImplementedError()

    def _do_rollback(self) -> None:
        raise NotImplementedError()

    def _do_commit(self) -> None:
        raise NotImplementedError()

    @property
    def is_valid(self) -> bool:
        return self.is_active and not self.connection.invalidated

    def close(self) -> None:
        """Close this :class:`.Transaction`.

        If this transaction is the base transaction in a begin/commit
        nesting, the transaction will rollback().  Otherwise, the
        method returns.

        This is used to cancel a Transaction without affecting the scope of
        an enclosing transaction.

        """
        try:
            self._do_close()
        finally:
            assert not self.is_active

    def rollback(self) -> None:
        """Roll back this :class:`.Transaction`.

        The implementation of this may vary based on the type of transaction in
        use:

        * For a simple database transaction (e.g. :class:`.RootTransaction`),
          it corresponds to a ROLLBACK.

        * For a :class:`.NestedTransaction`, it corresponds to a
          "ROLLBACK TO SAVEPOINT" operation.

        * For a :class:`.TwoPhaseTransaction`, DBAPI-specific methods for two
          phase transactions may be used.


        """
        try:
            self._do_rollback()
        finally:
            assert not self.is_active

    def commit(self) -> None:
        """Commit this :class:`.Transaction`.

        The implementation of this may vary based on the type of transaction in
        use:

        * For a simple database transaction (e.g. :class:`.RootTransaction`),
          it corresponds to a COMMIT.

        * For a :class:`.NestedTransaction`, it corresponds to a
          "RELEASE SAVEPOINT" operation.

        * For a :class:`.TwoPhaseTransaction`, DBAPI-specific methods for two
          phase transactions may be used.

        """
        try:
            self._do_commit()
        finally:
            assert not self.is_active

    def _get_subject(self) -> Connection:
        return self.connection

    def _transaction_is_active(self) -> bool:
        return self.is_active

    def _transaction_is_closed(self) -> bool:
        return not self._deactivated_from_connection

    def _rollback_can_be_called(self) -> bool:
        # for RootTransaction / NestedTransaction, it's safe to call
        # rollback() even if the transaction is deactive and no warnings
        # will be emitted.  tested in
        # test_transaction.py -> test_no_rollback_in_deactive(?:_savepoint)?
        return True


class RootTransaction(Transaction):
    """Represent the "root" transaction on a :class:`_engine.Connection`.

    This corresponds to the current "BEGIN/COMMIT/ROLLBACK" that's occurring
    for the :class:`_engine.Connection`. The :class:`_engine.RootTransaction`
    is created by calling upon the :meth:`_engine.Connection.begin` method, and
    remains associated with the :class:`_engine.Connection` throughout its
    active span. The current :class:`_engine.RootTransaction` in use is
    accessible via the :attr:`_engine.Connection.get_transaction` method of
    :class:`_engine.Connection`.

    In :term:`2.0 style` use, the :class:`_engine.Connection` also employs
    "autobegin" behavior that will create a new
    :class:`_engine.RootTransaction` whenever a connection in a
    non-transactional state is used to emit commands on the DBAPI connection.
    The scope of the :class:`_engine.RootTransaction` in 2.0 style
    use can be controlled using the :meth:`_engine.Connection.commit` and
    :meth:`_engine.Connection.rollback` methods.


    """

    _is_root = True

    __slots__ = ("connection", "is_active")

    def __init__(self, connection: Connection):
        assert connection._transaction is None
        if connection._trans_context_manager:
            TransactionalContext._trans_ctx_check(connection)
        self.connection = connection
        self._connection_begin_impl()
        connection._transaction = self

        self.is_active = True

    def _deactivate_from_connection(self) -> None:
        if self.is_active:
            assert self.connection._transaction is self
            self.is_active = False

        elif self.connection._transaction is not self:
            util.warn("transaction already deassociated from connection")

    @property
    def _deactivated_from_connection(self) -> bool:
        return self.connection._transaction is not self

    def _connection_begin_impl(self) -> None:
        self.connection._begin_impl(self)

    def _connection_rollback_impl(self) -> None:
        self.connection._rollback_impl()

    def _connection_commit_impl(self) -> None:
        self.connection._commit_impl()

    def _close_impl(self, try_deactivate: bool = False) -> None:
        try:
            if self.is_active:
                self._connection_rollback_impl()

            if self.connection._nested_transaction:
                self.connection._nested_transaction._cancel()
        finally:
            if self.is_active or try_deactivate:
                self._deactivate_from_connection()
            if self.connection._transaction is self:
                self.connection._transaction = None

        assert not self.is_active
        assert self.connection._transaction is not self

    def _do_close(self) -> None:
        self._close_impl()

    def _do_rollback(self) -> None:
        self._close_impl(try_deactivate=True)

    def _do_commit(self) -> None:
        if self.is_active:
            assert self.connection._transaction is self

            try:
                self._connection_commit_impl()
            finally:
                # whether or not commit succeeds, cancel any
                # nested transactions, make this transaction "inactive"
                # and remove it as a reset agent
                if self.connection._nested_transaction:
                    self.connection._nested_transaction._cancel()

                self._deactivate_from_connection()

            # ...however only remove as the connection's current transaction
            # if commit succeeded.  otherwise it stays on so that a rollback
            # needs to occur.
            self.connection._transaction = None
        else:
            if self.connection._transaction is self:
                self.connection._invalid_transaction()
            else:
                raise exc.InvalidRequestError("This transaction is inactive")

        assert not self.is_active
        assert self.connection._transaction is not self


class NestedTransaction(Transaction):
    """Represent a 'nested', or SAVEPOINT transaction.

    The :class:`.NestedTransaction` object is created by calling the
    :meth:`_engine.Connection.begin_nested` method of
    :class:`_engine.Connection`.

    When using :class:`.NestedTransaction`, the semantics of "begin" /
    "commit" / "rollback" are as follows:

    * the "begin" operation corresponds to the "BEGIN SAVEPOINT" command, where
      the savepoint is given an explicit name that is part of the state
      of this object.

    * The :meth:`.NestedTransaction.commit` method corresponds to a
      "RELEASE SAVEPOINT" operation, using the savepoint identifier associated
      with this :class:`.NestedTransaction`.

    * The :meth:`.NestedTransaction.rollback` method corresponds to a
      "ROLLBACK TO SAVEPOINT" operation, using the savepoint identifier
      associated with this :class:`.NestedTransaction`.

    The rationale for mimicking the semantics of an outer transaction in
    terms of savepoints so that code may deal with a "savepoint" transaction
    and an "outer" transaction in an agnostic way.

    .. seealso::

        :ref:`session_begin_nested` - ORM version of the SAVEPOINT API.

    """

    __slots__ = ("connection", "is_active", "_savepoint", "_previous_nested")

    _savepoint: str

    def __init__(self, connection: Connection):
        assert connection._transaction is not None
        if connection._trans_context_manager:
            TransactionalContext._trans_ctx_check(connection)
        self.connection = connection
        self._savepoint = self.connection._savepoint_impl()
        self.is_active = True
        self._previous_nested = connection._nested_transaction
        connection._nested_transaction = self

    def _deactivate_from_connection(self, warn: bool = True) -> None:
        if self.connection._nested_transaction is self:
            self.connection._nested_transaction = self._previous_nested
        elif warn:
            util.warn(
                "nested transaction already deassociated from connection"
            )

    @property
    def _deactivated_from_connection(self) -> bool:
        return self.connection._nested_transaction is not self

    def _cancel(self) -> None:
        # called by RootTransaction when the outer transaction is
        # committed, rolled back, or closed to cancel all savepoints
        # without any action being taken
        self.is_active = False
        self._deactivate_from_connection()
        if self._previous_nested:
            self._previous_nested._cancel()

    def _close_impl(
        self, deactivate_from_connection: bool, warn_already_deactive: bool
    ) -> None:
        try:
            if (
                self.is_active
                and self.connection._transaction
                and self.connection._transaction.is_active
            ):
                self.connection._rollback_to_savepoint_impl(self._savepoint)
        finally:
            self.is_active = False

            if deactivate_from_connection:
                self._deactivate_from_connection(warn=warn_already_deactive)

        assert not self.is_active
        if deactivate_from_connection:
            assert self.connection._nested_transaction is not self

    def _do_close(self) -> None:
        self._close_impl(True, False)

    def _do_rollback(self) -> None:
        self._close_impl(True, True)

    def _do_commit(self) -> None:
        if self.is_active:
            try:
                self.connection._release_savepoint_impl(self._savepoint)
            finally:
                # nested trans becomes inactive on failed release
                # unconditionally.  this prevents it from trying to
                # emit SQL when it rolls back.
                self.is_active = False

            # but only de-associate from connection if it succeeded
            self._deactivate_from_connection()
        else:
            if self.connection._nested_transaction is self:
                self.connection._invalid_transaction()
            else:
                raise exc.InvalidRequestError(
                    "This nested transaction is inactive"
                )


class TwoPhaseTransaction(RootTransaction):
    """Represent a two-phase transaction.

    A new :class:`.TwoPhaseTransaction` object may be procured
    using the :meth:`_engine.Connection.begin_twophase` method.

    The interface is the same as that of :class:`.Transaction`
    with the addition of the :meth:`prepare` method.

    """

    __slots__ = ("xid", "_is_prepared")

    xid: Any

    def __init__(self, connection: Connection, xid: Any):
        self._is_prepared = False
        self.xid = xid
        super().__init__(connection)

    def prepare(self) -> None:
        """Prepare this :class:`.TwoPhaseTransaction`.

        After a PREPARE, the transaction can be committed.

        """
        if not self.is_active:
            raise exc.InvalidRequestError("This transaction is inactive")
        self.connection._prepare_twophase_impl(self.xid)
        self._is_prepared = True

    def _connection_begin_impl(self) -> None:
        self.connection._begin_twophase_impl(self)

    def _connection_rollback_impl(self) -> None:
        self.connection._rollback_twophase_impl(self.xid, self._is_prepared)

    def _connection_commit_impl(self) -> None:
        self.connection._commit_twophase_impl(self.xid, self._is_prepared)


class Engine(
    ConnectionEventsTarget, log.Identified, inspection.Inspectable["Inspector"]
):
    """
    Connects a :class:`~sqlalchemy.pool.Pool` and
    :class:`~sqlalchemy.engine.interfaces.Dialect` together to provide a
    source of database connectivity and behavior.

    An :class:`_engine.Engine` object is instantiated publicly using the
    :func:`~sqlalchemy.create_engine` function.

    .. seealso::

        :doc:`/core/engines`

        :ref:`connections_toplevel`

    """

    dispatch: dispatcher[ConnectionEventsTarget]

    _compiled_cache: Optional[CompiledCacheType]

    _execution_options: _ExecuteOptions = _EMPTY_EXECUTION_OPTS
    _has_events: bool = False
    _connection_cls: Type[Connection] = Connection
    _sqla_logger_namespace: str = "sqlalchemy.engine.Engine"
    _is_future: bool = False

    _schema_translate_map: Optional[SchemaTranslateMapType] = None
    _option_cls: Type[OptionEngine]

    dialect: Dialect
    pool: Pool
    url: URL
    hide_parameters: bool

    def __init__(
        self,
        pool: Pool,
        dialect: Dialect,
        url: URL,
        logging_name: Optional[str] = None,
        echo: Optional[_EchoFlagType] = None,
        query_cache_size: int = 500,
        execution_options: Optional[Mapping[str, Any]] = None,
        hide_parameters: bool = False,
    ):
        self.pool = pool
        self.url = url
        self.dialect = dialect
        if logging_name:
            self.logging_name = logging_name
        self.echo = echo
        self.hide_parameters = hide_parameters
        if query_cache_size != 0:
            self._compiled_cache = util.LRUCache(
                query_cache_size, size_alert=self._lru_size_alert
            )
        else:
            self._compiled_cache = None
        log.instance_logger(self, echoflag=echo)
        if execution_options:
            self.update_execution_options(**execution_options)

    def _lru_size_alert(self, cache: util.LRUCache[Any, Any]) -> None:
        if self._should_log_info():
            self.logger.info(
                "Compiled cache size pruning from %d items to %d.  "
                "Increase cache size to reduce the frequency of pruning.",
                len(cache),
                cache.capacity,
            )

    @property
    def engine(self) -> Engine:
        """Returns this :class:`.Engine`.

        Used for legacy schemes that accept :class:`.Connection` /
        :class:`.Engine` objects within the same variable.

        """
        return self

    def clear_compiled_cache(self) -> None:
        """Clear the compiled cache associated with the dialect.

        This applies **only** to the built-in cache that is established
        via the :paramref:`_engine.create_engine.query_cache_size` parameter.
        It will not impact any dictionary caches that were passed via the
        :paramref:`.Connection.execution_options.query_cache` parameter.

        .. versionadded:: 1.4

        """
        if self._compiled_cache:
            self._compiled_cache.clear()

    def update_execution_options(self, **opt: Any) -> None:
        r"""Update the default execution_options dictionary
        of this :class:`_engine.Engine`.

        The given keys/values in \**opt are added to the
        default execution options that will be used for
        all connections.  The initial contents of this dictionary
        can be sent via the ``execution_options`` parameter
        to :func:`_sa.create_engine`.

        .. seealso::

            :meth:`_engine.Connection.execution_options`

            :meth:`_engine.Engine.execution_options`

        """
        self.dispatch.set_engine_execution_options(self, opt)
        self._execution_options = self._execution_options.union(opt)
        self.dialect.set_engine_execution_options(self, opt)

    @overload
    def execution_options(
        self,
        *,
        compiled_cache: Optional[CompiledCacheType] = ...,
        logging_token: str = ...,
        isolation_level: IsolationLevel = ...,
        insertmanyvalues_page_size: int = ...,
        schema_translate_map: Optional[SchemaTranslateMapType] = ...,
        **opt: Any,
    ) -> OptionEngine:
        ...

    @overload
    def execution_options(self, **opt: Any) -> OptionEngine:
        ...

    def execution_options(self, **opt: Any) -> OptionEngine:
        """Return a new :class:`_engine.Engine` that will provide
        :class:`_engine.Connection` objects with the given execution options.

        The returned :class:`_engine.Engine` remains related to the original
        :class:`_engine.Engine` in that it shares the same connection pool and
        other state:

        * The :class:`_pool.Pool` used by the new :class:`_engine.Engine`
          is the
          same instance.  The :meth:`_engine.Engine.dispose`
          method will replace
          the connection pool instance for the parent engine as well
          as this one.
        * Event listeners are "cascaded" - meaning, the new
          :class:`_engine.Engine`
          inherits the events of the parent, and new events can be associated
          with the new :class:`_engine.Engine` individually.
        * The logging configuration and logging_name is copied from the parent
          :class:`_engine.Engine`.

        The intent of the :meth:`_engine.Engine.execution_options` method is
        to implement schemes where multiple :class:`_engine.Engine`
        objects refer to the same connection pool, but are differentiated
        by options that affect some execution-level behavior for each
        engine.    One such example is breaking into separate "reader" and
        "writer" :class:`_engine.Engine` instances, where one
        :class:`_engine.Engine`
        has a lower :term:`isolation level` setting configured or is even
        transaction-disabled using "autocommit".  An example of this
        configuration is at :ref:`dbapi_autocommit_multiple`.

        Another example is one that
        uses a custom option ``shard_id`` which is consumed by an event
        to change the current schema on a database connection::

            from sqlalchemy import event
            from sqlalchemy.engine import Engine

            primary_engine = create_engine("mysql+mysqldb://")
            shard1 = primary_engine.execution_options(shard_id="shard1")
            shard2 = primary_engine.execution_options(shard_id="shard2")

            shards = {"default": "base", "shard_1": "db1", "shard_2": "db2"}

            @event.listens_for(Engine, "before_cursor_execute")
            def _switch_shard(conn, cursor, stmt,
                    params, context, executemany):
                shard_id = conn.get_execution_options().get('shard_id', "default")
                current_shard = conn.info.get("current_shard", None)

                if current_shard != shard_id:
                    cursor.execute("use %s" % shards[shard_id])
                    conn.info["current_shard"] = shard_id

        The above recipe illustrates two :class:`_engine.Engine` objects that
        will each serve as factories for :class:`_engine.Connection` objects
        that have pre-established "shard_id" execution options present. A
        :meth:`_events.ConnectionEvents.before_cursor_execute` event handler
        then interprets this execution option to emit a MySQL ``use`` statement
        to switch databases before a statement execution, while at the same
        time keeping track of which database we've established using the
        :attr:`_engine.Connection.info` dictionary.

        .. seealso::

            :meth:`_engine.Connection.execution_options`
            - update execution options
            on a :class:`_engine.Connection` object.

            :meth:`_engine.Engine.update_execution_options`
            - update the execution
            options for a given :class:`_engine.Engine` in place.

            :meth:`_engine.Engine.get_execution_options`


        """  # noqa: E501
        return self._option_cls(self, opt)

    def get_execution_options(self) -> _ExecuteOptions:
        """Get the non-SQL options which will take effect during execution.

        .. versionadded: 1.3

        .. seealso::

            :meth:`_engine.Engine.execution_options`
        """
        return self._execution_options

    @property
    def name(self) -> str:
        """String name of the :class:`~sqlalchemy.engine.interfaces.Dialect`
        in use by this :class:`Engine`.

        """

        return self.dialect.name

    @property
    def driver(self) -> str:
        """Driver name of the :class:`~sqlalchemy.engine.interfaces.Dialect`
        in use by this :class:`Engine`.

        """

        return self.dialect.driver

    echo = log.echo_property()

    def __repr__(self) -> str:
        return "Engine(%r)" % (self.url,)

    def dispose(self, close: bool = True) -> None:
        """Dispose of the connection pool used by this
        :class:`_engine.Engine`.

        A new connection pool is created immediately after the old one has been
        disposed. The previous connection pool is disposed either actively, by
        closing out all currently checked-in connections in that pool, or
        passively, by losing references to it but otherwise not closing any
        connections. The latter strategy is more appropriate for an initializer
        in a forked Python process.

        :param close: if left at its default of ``True``, has the
         effect of fully closing all **currently checked in**
         database connections.  Connections that are still checked out
         will **not** be closed, however they will no longer be associated
         with this :class:`_engine.Engine`,
         so when they are closed individually, eventually the
         :class:`_pool.Pool` which they are associated with will
         be garbage collected and they will be closed out fully, if
         not already closed on checkin.

         If set to ``False``, the previous connection pool is de-referenced,
         and otherwise not touched in any way.

        .. versionadded:: 1.4.33  Added the :paramref:`.Engine.dispose.close`
            parameter to allow the replacement of a connection pool in a child
            process without interfering with the connections used by the parent
            process.


        .. seealso::

            :ref:`engine_disposal`

            :ref:`pooling_multiprocessing`

        """
        if close:
            self.pool.dispose()
        self.pool = self.pool.recreate()
        self.dispatch.engine_disposed(self)

    @contextlib.contextmanager
    def _optional_conn_ctx_manager(
        self, connection: Optional[Connection] = None
    ) -> Iterator[Connection]:
        if connection is None:
            with self.connect() as conn:
                yield conn
        else:
            yield connection

    @contextlib.contextmanager
    def begin(self) -> Iterator[Connection]:
        """Return a context manager delivering a :class:`_engine.Connection`
        with a :class:`.Transaction` established.

        E.g.::

            with engine.begin() as conn:
                conn.execute(
                    text("insert into table (x, y, z) values (1, 2, 3)")
                )
                conn.execute(text("my_special_procedure(5)"))

        Upon successful operation, the :class:`.Transaction`
        is committed.  If an error is raised, the :class:`.Transaction`
        is rolled back.

        .. seealso::

            :meth:`_engine.Engine.connect` - procure a
            :class:`_engine.Connection` from
            an :class:`_engine.Engine`.

            :meth:`_engine.Connection.begin` - start a :class:`.Transaction`
            for a particular :class:`_engine.Connection`.

        """
        with self.connect() as conn:
            with conn.begin():
                yield conn

    def _run_ddl_visitor(
        self,
        visitorcallable: Type[Union[SchemaGenerator, SchemaDropper]],
        element: SchemaItem,
        **kwargs: Any,
    ) -> None:
        with self.begin() as conn:
            conn._run_ddl_visitor(visitorcallable, element, **kwargs)

    def connect(self) -> Connection:
        """Return a new :class:`_engine.Connection` object.

        The :class:`_engine.Connection` acts as a Python context manager, so
        the typical use of this method looks like::

            with engine.connect() as connection:
                connection.execute(text("insert into table values ('foo')"))
                connection.commit()

        Where above, after the block is completed, the connection is "closed"
        and its underlying DBAPI resources are returned to the connection pool.
        This also has the effect of rolling back any transaction that
        was explicitly begun or was begun via autobegin, and will
        emit the :meth:`_events.ConnectionEvents.rollback` event if one was
        started and is still in progress.

        .. seealso::

            :meth:`_engine.Engine.begin`

        """

        return self._connection_cls(self)

    def raw_connection(self) -> PoolProxiedConnection:
        """Return a "raw" DBAPI connection from the connection pool.

        The returned object is a proxied version of the DBAPI
        connection object used by the underlying driver in use.
        The object will have all the same behavior as the real DBAPI
        connection, except that its ``close()`` method will result in the
        connection being returned to the pool, rather than being closed
        for real.

        This method provides direct DBAPI connection access for
        special situations when the API provided by
        :class:`_engine.Connection`
        is not needed.   When a :class:`_engine.Connection` object is already
        present, the DBAPI connection is available using
        the :attr:`_engine.Connection.connection` accessor.

        .. seealso::

            :ref:`dbapi_connections`

        """
        return self.pool.connect()


class OptionEngineMixin(log.Identified):
    _sa_propagate_class_events = False

    dispatch: dispatcher[ConnectionEventsTarget]
    _compiled_cache: Optional[CompiledCacheType]
    dialect: Dialect
    pool: Pool
    url: URL
    hide_parameters: bool
    echo: log.echo_property

    def __init__(
        self, proxied: Engine, execution_options: CoreExecuteOptionsParameter
    ):
        self._proxied = proxied
        self.url = proxied.url
        self.dialect = proxied.dialect
        self.logging_name = proxied.logging_name
        self.echo = proxied.echo
        self._compiled_cache = proxied._compiled_cache
        self.hide_parameters = proxied.hide_parameters
        log.instance_logger(self, echoflag=self.echo)

        # note: this will propagate events that are assigned to the parent
        # engine after this OptionEngine is created.   Since we share
        # the events of the parent we also disallow class-level events
        # to apply to the OptionEngine class directly.
        #
        # the other way this can work would be to transfer existing
        # events only, using:
        # self.dispatch._update(proxied.dispatch)
        #
        # that might be more appropriate however it would be a behavioral
        # change for logic that assigns events to the parent engine and
        # would like it to take effect for the already-created sub-engine.
        self.dispatch = self.dispatch._join(proxied.dispatch)

        self._execution_options = proxied._execution_options
        self.update_execution_options(**execution_options)

    def update_execution_options(self, **opt: Any) -> None:
        raise NotImplementedError()

    if not typing.TYPE_CHECKING:
        # https://github.com/python/typing/discussions/1095

        @property
        def pool(self) -> Pool:
            return self._proxied.pool

        @pool.setter
        def pool(self, pool: Pool) -> None:
            self._proxied.pool = pool

        @property
        def _has_events(self) -> bool:
            return self._proxied._has_events or self.__dict__.get(
                "_has_events", False
            )

        @_has_events.setter
        def _has_events(self, value: bool) -> None:
            self.__dict__["_has_events"] = value


class OptionEngine(OptionEngineMixin, Engine):
    def update_execution_options(self, **opt: Any) -> None:
        Engine.update_execution_options(self, **opt)


Engine._option_cls = OptionEngine
