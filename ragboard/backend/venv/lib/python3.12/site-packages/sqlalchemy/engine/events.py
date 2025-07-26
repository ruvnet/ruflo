# engine/events.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php


from __future__ import annotations

import typing
from typing import Any
from typing import Dict
from typing import Optional
from typing import Tuple
from typing import Type
from typing import Union

from .base import Connection
from .base import Engine
from .interfaces import ConnectionEventsTarget
from .interfaces import DBAPIConnection
from .interfaces import DBAPICursor
from .interfaces import Dialect
from .. import event
from .. import exc
from ..util.typing import Literal

if typing.TYPE_CHECKING:
    from .interfaces import _CoreMultiExecuteParams
    from .interfaces import _CoreSingleExecuteParams
    from .interfaces import _DBAPIAnyExecuteParams
    from .interfaces import _DBAPIMultiExecuteParams
    from .interfaces import _DBAPISingleExecuteParams
    from .interfaces import _ExecuteOptions
    from .interfaces import ExceptionContext
    from .interfaces import ExecutionContext
    from .result import Result
    from ..pool import ConnectionPoolEntry
    from ..sql import Executable
    from ..sql.elements import BindParameter


class ConnectionEvents(event.Events[ConnectionEventsTarget]):
    """Available events for
    :class:`_engine.Connection` and :class:`_engine.Engine`.

    The methods here define the name of an event as well as the names of
    members that are passed to listener functions.

    An event listener can be associated with any
    :class:`_engine.Connection` or :class:`_engine.Engine`
    class or instance, such as an :class:`_engine.Engine`, e.g.::

        from sqlalchemy import event, create_engine

        def before_cursor_execute(conn, cursor, statement, parameters, context,
                                                        executemany):
            log.info("Received statement: %s", statement)

        engine = create_engine('postgresql+psycopg2://scott:tiger@localhost/test')
        event.listen(engine, "before_cursor_execute", before_cursor_execute)

    or with a specific :class:`_engine.Connection`::

        with engine.begin() as conn:
            @event.listens_for(conn, 'before_cursor_execute')
            def before_cursor_execute(conn, cursor, statement, parameters,
                                            context, executemany):
                log.info("Received statement: %s", statement)

    When the methods are called with a `statement` parameter, such as in
    :meth:`.after_cursor_execute` or :meth:`.before_cursor_execute`,
    the statement is the exact SQL string that was prepared for transmission
    to the DBAPI ``cursor`` in the connection's :class:`.Dialect`.

    The :meth:`.before_execute` and :meth:`.before_cursor_execute`
    events can also be established with the ``retval=True`` flag, which
    allows modification of the statement and parameters to be sent
    to the database.  The :meth:`.before_cursor_execute` event is
    particularly useful here to add ad-hoc string transformations, such
    as comments, to all executions::

        from sqlalchemy.engine import Engine
        from sqlalchemy import event

        @event.listens_for(Engine, "before_cursor_execute", retval=True)
        def comment_sql_calls(conn, cursor, statement, parameters,
                                            context, executemany):
            statement = statement + " -- some comment"
            return statement, parameters

    .. note:: :class:`_events.ConnectionEvents` can be established on any
       combination of :class:`_engine.Engine`, :class:`_engine.Connection`,
       as well
       as instances of each of those classes.  Events across all
       four scopes will fire off for a given instance of
       :class:`_engine.Connection`.  However, for performance reasons, the
       :class:`_engine.Connection` object determines at instantiation time
       whether or not its parent :class:`_engine.Engine` has event listeners
       established.   Event listeners added to the :class:`_engine.Engine`
       class or to an instance of :class:`_engine.Engine`
       *after* the instantiation
       of a dependent :class:`_engine.Connection` instance will usually
       *not* be available on that :class:`_engine.Connection` instance.
       The newly
       added listeners will instead take effect for
       :class:`_engine.Connection`
       instances created subsequent to those event listeners being
       established on the parent :class:`_engine.Engine` class or instance.

    :param retval=False: Applies to the :meth:`.before_execute` and
      :meth:`.before_cursor_execute` events only.  When True, the
      user-defined event function must have a return value, which
      is a tuple of parameters that replace the given statement
      and parameters.  See those methods for a description of
      specific return arguments.

    """  # noqa

    _target_class_doc = "SomeEngine"
    _dispatch_target = ConnectionEventsTarget

    @classmethod
    def _accept_with(
        cls,
        target: Union[ConnectionEventsTarget, Type[ConnectionEventsTarget]],
        identifier: str,
    ) -> Optional[Union[ConnectionEventsTarget, Type[ConnectionEventsTarget]]]:
        default_dispatch = super()._accept_with(target, identifier)
        if default_dispatch is None and hasattr(
            target, "_no_async_engine_events"
        ):
            target._no_async_engine_events()

        return default_dispatch

    @classmethod
    def _listen(
        cls,
        event_key: event._EventKey[ConnectionEventsTarget],
        *,
        retval: bool = False,
        **kw: Any,
    ) -> None:
        target, identifier, fn = (
            event_key.dispatch_target,
            event_key.identifier,
            event_key._listen_fn,
        )
        target._has_events = True

        if not retval:
            if identifier == "before_execute":
                orig_fn = fn

                def wrap_before_execute(  # type: ignore
                    conn, clauseelement, multiparams, params, execution_options
                ):
                    orig_fn(
                        conn,
                        clauseelement,
                        multiparams,
                        params,
                        execution_options,
                    )
                    return clauseelement, multiparams, params

                fn = wrap_before_execute
            elif identifier == "before_cursor_execute":
                orig_fn = fn

                def wrap_before_cursor_execute(  # type: ignore
                    conn, cursor, statement, parameters, context, executemany
                ):
                    orig_fn(
                        conn,
                        cursor,
                        statement,
                        parameters,
                        context,
                        executemany,
                    )
                    return statement, parameters

                fn = wrap_before_cursor_execute
        elif retval and identifier not in (
            "before_execute",
            "before_cursor_execute",
        ):
            raise exc.ArgumentError(
                "Only the 'before_execute', "
                "'before_cursor_execute' and 'handle_error' engine "
                "event listeners accept the 'retval=True' "
                "argument."
            )
        event_key.with_wrapper(fn).base_listen()

    @event._legacy_signature(
        "1.4",
        ["conn", "clauseelement", "multiparams", "params"],
        lambda conn, clauseelement, multiparams, params, execution_options: (
            conn,
            clauseelement,
            multiparams,
            params,
        ),
    )
    def before_execute(
        self,
        conn: Connection,
        clauseelement: Executable,
        multiparams: _CoreMultiExecuteParams,
        params: _CoreSingleExecuteParams,
        execution_options: _ExecuteOptions,
    ) -> Optional[
        Tuple[Executable, _CoreMultiExecuteParams, _CoreSingleExecuteParams]
    ]:
        """Intercept high level execute() events, receiving uncompiled
        SQL constructs and other objects prior to rendering into SQL.

        This event is good for debugging SQL compilation issues as well
        as early manipulation of the parameters being sent to the database,
        as the parameter lists will be in a consistent format here.

        This event can be optionally established with the ``retval=True``
        flag.  The ``clauseelement``, ``multiparams``, and ``params``
        arguments should be returned as a three-tuple in this case::

            @event.listens_for(Engine, "before_execute", retval=True)
            def before_execute(conn, clauseelement, multiparams, params):
                # do something with clauseelement, multiparams, params
                return clauseelement, multiparams, params

        :param conn: :class:`_engine.Connection` object
        :param clauseelement: SQL expression construct, :class:`.Compiled`
         instance, or string statement passed to
         :meth:`_engine.Connection.execute`.
        :param multiparams: Multiple parameter sets, a list of dictionaries.
        :param params: Single parameter set, a single dictionary.
        :param execution_options: dictionary of execution
         options passed along with the statement, if any.  This is a merge
         of all options that will be used, including those of the statement,
         the connection, and those passed in to the method itself for
         the 2.0 style of execution.

         .. versionadded: 1.4

        .. seealso::

            :meth:`.before_cursor_execute`

        """

    @event._legacy_signature(
        "1.4",
        ["conn", "clauseelement", "multiparams", "params", "result"],
        lambda conn, clauseelement, multiparams, params, execution_options, result: (  # noqa
            conn,
            clauseelement,
            multiparams,
            params,
            result,
        ),
    )
    def after_execute(
        self,
        conn: Connection,
        clauseelement: Executable,
        multiparams: _CoreMultiExecuteParams,
        params: _CoreSingleExecuteParams,
        execution_options: _ExecuteOptions,
        result: Result[Any],
    ) -> None:
        """Intercept high level execute() events after execute.


        :param conn: :class:`_engine.Connection` object
        :param clauseelement: SQL expression construct, :class:`.Compiled`
         instance, or string statement passed to
         :meth:`_engine.Connection.execute`.
        :param multiparams: Multiple parameter sets, a list of dictionaries.
        :param params: Single parameter set, a single dictionary.
        :param execution_options: dictionary of execution
         options passed along with the statement, if any.  This is a merge
         of all options that will be used, including those of the statement,
         the connection, and those passed in to the method itself for
         the 2.0 style of execution.

         .. versionadded: 1.4

        :param result: :class:`_engine.CursorResult` generated by the
         execution.

        """

    def before_cursor_execute(
        self,
        conn: Connection,
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPIAnyExecuteParams,
        context: Optional[ExecutionContext],
        executemany: bool,
    ) -> Optional[Tuple[str, _DBAPIAnyExecuteParams]]:
        """Intercept low-level cursor execute() events before execution,
        receiving the string SQL statement and DBAPI-specific parameter list to
        be invoked against a cursor.

        This event is a good choice for logging as well as late modifications
        to the SQL string.  It's less ideal for parameter modifications except
        for those which are specific to a target backend.

        This event can be optionally established with the ``retval=True``
        flag.  The ``statement`` and ``parameters`` arguments should be
        returned as a two-tuple in this case::

            @event.listens_for(Engine, "before_cursor_execute", retval=True)
            def before_cursor_execute(conn, cursor, statement,
                            parameters, context, executemany):
                # do something with statement, parameters
                return statement, parameters

        See the example at :class:`_events.ConnectionEvents`.

        :param conn: :class:`_engine.Connection` object
        :param cursor: DBAPI cursor object
        :param statement: string SQL statement, as to be passed to the DBAPI
        :param parameters: Dictionary, tuple, or list of parameters being
         passed to the ``execute()`` or ``executemany()`` method of the
         DBAPI ``cursor``.  In some cases may be ``None``.
        :param context: :class:`.ExecutionContext` object in use.  May
         be ``None``.
        :param executemany: boolean, if ``True``, this is an ``executemany()``
         call, if ``False``, this is an ``execute()`` call.

        .. seealso::

            :meth:`.before_execute`

            :meth:`.after_cursor_execute`

        """

    def after_cursor_execute(
        self,
        conn: Connection,
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPIAnyExecuteParams,
        context: Optional[ExecutionContext],
        executemany: bool,
    ) -> None:
        """Intercept low-level cursor execute() events after execution.

        :param conn: :class:`_engine.Connection` object
        :param cursor: DBAPI cursor object.  Will have results pending
         if the statement was a SELECT, but these should not be consumed
         as they will be needed by the :class:`_engine.CursorResult`.
        :param statement: string SQL statement, as passed to the DBAPI
        :param parameters: Dictionary, tuple, or list of parameters being
         passed to the ``execute()`` or ``executemany()`` method of the
         DBAPI ``cursor``.  In some cases may be ``None``.
        :param context: :class:`.ExecutionContext` object in use.  May
         be ``None``.
        :param executemany: boolean, if ``True``, this is an ``executemany()``
         call, if ``False``, this is an ``execute()`` call.

        """

    @event._legacy_signature(
        "2.0", ["conn", "branch"], converter=lambda conn: (conn, False)
    )
    def engine_connect(self, conn: Connection) -> None:
        """Intercept the creation of a new :class:`_engine.Connection`.

        This event is called typically as the direct result of calling
        the :meth:`_engine.Engine.connect` method.

        It differs from the :meth:`_events.PoolEvents.connect` method, which
        refers to the actual connection to a database at the DBAPI level;
        a DBAPI connection may be pooled and reused for many operations.
        In contrast, this event refers only to the production of a higher level
        :class:`_engine.Connection` wrapper around such a DBAPI connection.

        It also differs from the :meth:`_events.PoolEvents.checkout` event
        in that it is specific to the :class:`_engine.Connection` object,
        not the
        DBAPI connection that :meth:`_events.PoolEvents.checkout` deals with,
        although
        this DBAPI connection is available here via the
        :attr:`_engine.Connection.connection` attribute.
        But note there can in fact
        be multiple :meth:`_events.PoolEvents.checkout`
        events within the lifespan
        of a single :class:`_engine.Connection` object, if that
        :class:`_engine.Connection`
        is invalidated and re-established.

        :param conn: :class:`_engine.Connection` object.

        .. seealso::

            :meth:`_events.PoolEvents.checkout`
            the lower-level pool checkout event
            for an individual DBAPI connection

        """

    def set_connection_execution_options(
        self, conn: Connection, opts: Dict[str, Any]
    ) -> None:
        """Intercept when the :meth:`_engine.Connection.execution_options`
        method is called.

        This method is called after the new :class:`_engine.Connection`
        has been
        produced, with the newly updated execution options collection, but
        before the :class:`.Dialect` has acted upon any of those new options.

        Note that this method is not called when a new
        :class:`_engine.Connection`
        is produced which is inheriting execution options from its parent
        :class:`_engine.Engine`; to intercept this condition, use the
        :meth:`_events.ConnectionEvents.engine_connect` event.

        :param conn: The newly copied :class:`_engine.Connection` object

        :param opts: dictionary of options that were passed to the
         :meth:`_engine.Connection.execution_options` method.
         This dictionary may be modified in place to affect the ultimate
         options which take effect.

         .. versionadded:: 2.0 the ``opts`` dictionary may be modified
            in place.


        .. seealso::

            :meth:`_events.ConnectionEvents.set_engine_execution_options`
            - event
            which is called when :meth:`_engine.Engine.execution_options`
            is called.


        """

    def set_engine_execution_options(
        self, engine: Engine, opts: Dict[str, Any]
    ) -> None:
        """Intercept when the :meth:`_engine.Engine.execution_options`
        method is called.

        The :meth:`_engine.Engine.execution_options` method produces a shallow
        copy of the :class:`_engine.Engine` which stores the new options.
        That new
        :class:`_engine.Engine` is passed here.
        A particular application of this
        method is to add a :meth:`_events.ConnectionEvents.engine_connect`
        event
        handler to the given :class:`_engine.Engine`
        which will perform some per-
        :class:`_engine.Connection` task specific to these execution options.

        :param conn: The newly copied :class:`_engine.Engine` object

        :param opts: dictionary of options that were passed to the
         :meth:`_engine.Connection.execution_options` method.
         This dictionary may be modified in place to affect the ultimate
         options which take effect.

         .. versionadded:: 2.0 the ``opts`` dictionary may be modified
            in place.

        .. seealso::

            :meth:`_events.ConnectionEvents.set_connection_execution_options`
            - event
            which is called when :meth:`_engine.Connection.execution_options`
            is
            called.

        """

    def engine_disposed(self, engine: Engine) -> None:
        """Intercept when the :meth:`_engine.Engine.dispose` method is called.

        The :meth:`_engine.Engine.dispose` method instructs the engine to
        "dispose" of it's connection pool (e.g. :class:`_pool.Pool`), and
        replaces it with a new one.  Disposing of the old pool has the
        effect that existing checked-in connections are closed.  The new
        pool does not establish any new connections until it is first used.

        This event can be used to indicate that resources related to the
        :class:`_engine.Engine` should also be cleaned up,
        keeping in mind that the
        :class:`_engine.Engine`
        can still be used for new requests in which case
        it re-acquires connection resources.

        """

    def begin(self, conn: Connection) -> None:
        """Intercept begin() events.

        :param conn: :class:`_engine.Connection` object

        """

    def rollback(self, conn: Connection) -> None:
        """Intercept rollback() events, as initiated by a
        :class:`.Transaction`.

        Note that the :class:`_pool.Pool` also "auto-rolls back"
        a DBAPI connection upon checkin, if the ``reset_on_return``
        flag is set to its default value of ``'rollback'``.
        To intercept this
        rollback, use the :meth:`_events.PoolEvents.reset` hook.

        :param conn: :class:`_engine.Connection` object

        .. seealso::

            :meth:`_events.PoolEvents.reset`

        """

    def commit(self, conn: Connection) -> None:
        """Intercept commit() events, as initiated by a
        :class:`.Transaction`.

        Note that the :class:`_pool.Pool` may also "auto-commit"
        a DBAPI connection upon checkin, if the ``reset_on_return``
        flag is set to the value ``'commit'``.  To intercept this
        commit, use the :meth:`_events.PoolEvents.reset` hook.

        :param conn: :class:`_engine.Connection` object
        """

    def savepoint(self, conn: Connection, name: str) -> None:
        """Intercept savepoint() events.

        :param conn: :class:`_engine.Connection` object
        :param name: specified name used for the savepoint.

        """

    def rollback_savepoint(
        self, conn: Connection, name: str, context: None
    ) -> None:
        """Intercept rollback_savepoint() events.

        :param conn: :class:`_engine.Connection` object
        :param name: specified name used for the savepoint.
        :param context: not used

        """
        # TODO: deprecate "context"

    def release_savepoint(
        self, conn: Connection, name: str, context: None
    ) -> None:
        """Intercept release_savepoint() events.

        :param conn: :class:`_engine.Connection` object
        :param name: specified name used for the savepoint.
        :param context: not used

        """
        # TODO: deprecate "context"

    def begin_twophase(self, conn: Connection, xid: Any) -> None:
        """Intercept begin_twophase() events.

        :param conn: :class:`_engine.Connection` object
        :param xid: two-phase XID identifier

        """

    def prepare_twophase(self, conn: Connection, xid: Any) -> None:
        """Intercept prepare_twophase() events.

        :param conn: :class:`_engine.Connection` object
        :param xid: two-phase XID identifier
        """

    def rollback_twophase(
        self, conn: Connection, xid: Any, is_prepared: bool
    ) -> None:
        """Intercept rollback_twophase() events.

        :param conn: :class:`_engine.Connection` object
        :param xid: two-phase XID identifier
        :param is_prepared: boolean, indicates if
         :meth:`.TwoPhaseTransaction.prepare` was called.

        """

    def commit_twophase(
        self, conn: Connection, xid: Any, is_prepared: bool
    ) -> None:
        """Intercept commit_twophase() events.

        :param conn: :class:`_engine.Connection` object
        :param xid: two-phase XID identifier
        :param is_prepared: boolean, indicates if
         :meth:`.TwoPhaseTransaction.prepare` was called.

        """


class DialectEvents(event.Events[Dialect]):
    """event interface for execution-replacement functions.

    These events allow direct instrumentation and replacement
    of key dialect functions which interact with the DBAPI.

    .. note::

        :class:`.DialectEvents` hooks should be considered **semi-public**
        and experimental.
        These hooks are not for general use and are only for those situations
        where intricate re-statement of DBAPI mechanics must be injected onto
        an existing dialect.  For general-use statement-interception events,
        please use the :class:`_events.ConnectionEvents` interface.

    .. seealso::

        :meth:`_events.ConnectionEvents.before_cursor_execute`

        :meth:`_events.ConnectionEvents.before_execute`

        :meth:`_events.ConnectionEvents.after_cursor_execute`

        :meth:`_events.ConnectionEvents.after_execute`

    """

    _target_class_doc = "SomeEngine"
    _dispatch_target = Dialect

    @classmethod
    def _listen(
        cls,
        event_key: event._EventKey[Dialect],
        *,
        retval: bool = False,
        **kw: Any,
    ) -> None:
        target = event_key.dispatch_target

        target._has_events = True
        event_key.base_listen()

    @classmethod
    def _accept_with(
        cls,
        target: Union[Engine, Type[Engine], Dialect, Type[Dialect]],
        identifier: str,
    ) -> Optional[Union[Dialect, Type[Dialect]]]:
        if isinstance(target, type):
            if issubclass(target, Engine):
                return Dialect
            elif issubclass(target, Dialect):
                return target
        elif isinstance(target, Engine):
            return target.dialect
        elif isinstance(target, Dialect):
            return target
        elif isinstance(target, Connection) and identifier == "handle_error":
            raise exc.InvalidRequestError(
                "The handle_error() event hook as of SQLAlchemy 2.0 is "
                "established on the Dialect, and may only be applied to the "
                "Engine as a whole or to a specific Dialect as a whole, "
                "not on a per-Connection basis."
            )
        elif hasattr(target, "_no_async_engine_events"):
            target._no_async_engine_events()
        else:
            return None

    def handle_error(
        self, exception_context: ExceptionContext
    ) -> Optional[BaseException]:
        r"""Intercept all exceptions processed by the
        :class:`_engine.Dialect`, typically but not limited to those
        emitted within the scope of a :class:`_engine.Connection`.

        .. versionchanged:: 2.0 the :meth:`.DialectEvents.handle_error` event
           is moved to the :class:`.DialectEvents` class, moved from the
           :class:`.ConnectionEvents` class, so that it may also participate in
           the "pre ping" operation configured with the
           :paramref:`_sa.create_engine.pool_pre_ping` parameter. The event
           remains registered by using the :class:`_engine.Engine` as the event
           target, however note that using the :class:`_engine.Connection` as
           an event target for :meth:`.DialectEvents.handle_error` is no longer
           supported.

        This includes all exceptions emitted by the DBAPI as well as
        within SQLAlchemy's statement invocation process, including
        encoding errors and other statement validation errors.  Other areas
        in which the event is invoked include transaction begin and end,
        result row fetching, cursor creation.

        Note that :meth:`.handle_error` may support new kinds of exceptions
        and new calling scenarios at *any time*.  Code which uses this
        event must expect new calling patterns to be present in minor
        releases.

        To support the wide variety of members that correspond to an exception,
        as well as to allow extensibility of the event without backwards
        incompatibility, the sole argument received is an instance of
        :class:`.ExceptionContext`.   This object contains data members
        representing detail about the exception.

        Use cases supported by this hook include:

        * read-only, low-level exception handling for logging and
          debugging purposes
        * Establishing whether a DBAPI connection error message indicates
          that the database connection needs to be reconnected, including
          for the "pre_ping" handler used by **some** dialects
        * Establishing or disabling whether a connection or the owning
          connection pool is invalidated or expired in response to a
          specific exception
        * exception re-writing

        The hook is called while the cursor from the failed operation
        (if any) is still open and accessible.   Special cleanup operations
        can be called on this cursor; SQLAlchemy will attempt to close
        this cursor subsequent to this hook being invoked.

        As of SQLAlchemy 2.0, the "pre_ping" handler enabled using the
        :paramref:`_sa.create_engine.pool_pre_ping` parameter will also
        participate in the :meth:`.handle_error` process, **for those dialects
        that rely upon disconnect codes to detect database liveness**. Note
        that some dialects such as psycopg, psycopg2, and most MySQL dialects
        make use of a native ``ping()`` method supplied by the DBAPI which does
        not make use of disconnect codes.

        .. versionchanged:: 2.0.0 The :meth:`.DialectEvents.handle_error`
           event hook participates in connection pool "pre-ping" operations.
           Within this usage, the :attr:`.ExceptionContext.engine` attribute
           will be ``None``, however the :class:`.Dialect` in use is always
           available via the :attr:`.ExceptionContext.dialect` attribute.

        .. versionchanged:: 2.0.5 Added :attr:`.ExceptionContext.is_pre_ping`
           attribute which will be set to ``True`` when the
           :meth:`.DialectEvents.handle_error` event hook is triggered within
           a connection pool pre-ping operation.

        .. versionchanged:: 2.0.5 An issue was repaired that allows for the
           PostgreSQL ``psycopg`` and ``psycopg2`` drivers, as well as all
           MySQL drivers, to properly participate in the
           :meth:`.DialectEvents.handle_error` event hook during
           connection pool "pre-ping" operations; previously, the
           implementation was non-working for these drivers.


        A handler function has two options for replacing
        the SQLAlchemy-constructed exception into one that is user
        defined.   It can either raise this new exception directly, in
        which case all further event listeners are bypassed and the
        exception will be raised, after appropriate cleanup as taken
        place::

            @event.listens_for(Engine, "handle_error")
            def handle_exception(context):
                if isinstance(context.original_exception,
                    psycopg2.OperationalError) and \
                    "failed" in str(context.original_exception):
                    raise MySpecialException("failed operation")

        .. warning::  Because the
           :meth:`_events.DialectEvents.handle_error`
           event specifically provides for exceptions to be re-thrown as
           the ultimate exception raised by the failed statement,
           **stack traces will be misleading** if the user-defined event
           handler itself fails and throws an unexpected exception;
           the stack trace may not illustrate the actual code line that
           failed!  It is advised to code carefully here and use
           logging and/or inline debugging if unexpected exceptions are
           occurring.

        Alternatively, a "chained" style of event handling can be
        used, by configuring the handler with the ``retval=True``
        modifier and returning the new exception instance from the
        function.  In this case, event handling will continue onto the
        next handler.   The "chained" exception is available using
        :attr:`.ExceptionContext.chained_exception`::

            @event.listens_for(Engine, "handle_error", retval=True)
            def handle_exception(context):
                if context.chained_exception is not None and \
                    "special" in context.chained_exception.message:
                    return MySpecialException("failed",
                        cause=context.chained_exception)

        Handlers that return ``None`` may be used within the chain; when
        a handler returns ``None``, the previous exception instance,
        if any, is maintained as the current exception that is passed onto the
        next handler.

        When a custom exception is raised or returned, SQLAlchemy raises
        this new exception as-is, it is not wrapped by any SQLAlchemy
        object.  If the exception is not a subclass of
        :class:`sqlalchemy.exc.StatementError`,
        certain features may not be available; currently this includes
        the ORM's feature of adding a detail hint about "autoflush" to
        exceptions raised within the autoflush process.

        :param context: an :class:`.ExceptionContext` object.  See this
         class for details on all available members.


        .. seealso::

            :ref:`pool_new_disconnect_codes`

        """

    def do_connect(
        self,
        dialect: Dialect,
        conn_rec: ConnectionPoolEntry,
        cargs: Tuple[Any, ...],
        cparams: Dict[str, Any],
    ) -> Optional[DBAPIConnection]:
        """Receive connection arguments before a connection is made.

        This event is useful in that it allows the handler to manipulate the
        cargs and/or cparams collections that control how the DBAPI
        ``connect()`` function will be called. ``cargs`` will always be a
        Python list that can be mutated in-place, and ``cparams`` a Python
        dictionary that may also be mutated::

            e = create_engine("postgresql+psycopg2://user@host/dbname")

            @event.listens_for(e, 'do_connect')
            def receive_do_connect(dialect, conn_rec, cargs, cparams):
                cparams["password"] = "some_password"

        The event hook may also be used to override the call to ``connect()``
        entirely, by returning a non-``None`` DBAPI connection object::

            e = create_engine("postgresql+psycopg2://user@host/dbname")

            @event.listens_for(e, 'do_connect')
            def receive_do_connect(dialect, conn_rec, cargs, cparams):
                return psycopg2.connect(*cargs, **cparams)

        .. seealso::

            :ref:`custom_dbapi_args`

        """

    def do_executemany(
        self,
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPIMultiExecuteParams,
        context: ExecutionContext,
    ) -> Optional[Literal[True]]:
        """Receive a cursor to have executemany() called.

        Return the value True to halt further events from invoking,
        and to indicate that the cursor execution has already taken
        place within the event handler.

        """

    def do_execute_no_params(
        self, cursor: DBAPICursor, statement: str, context: ExecutionContext
    ) -> Optional[Literal[True]]:
        """Receive a cursor to have execute() with no parameters called.

        Return the value True to halt further events from invoking,
        and to indicate that the cursor execution has already taken
        place within the event handler.

        """

    def do_execute(
        self,
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPISingleExecuteParams,
        context: ExecutionContext,
    ) -> Optional[Literal[True]]:
        """Receive a cursor to have execute() called.

        Return the value True to halt further events from invoking,
        and to indicate that the cursor execution has already taken
        place within the event handler.

        """

    def do_setinputsizes(
        self,
        inputsizes: Dict[BindParameter[Any], Any],
        cursor: DBAPICursor,
        statement: str,
        parameters: _DBAPIAnyExecuteParams,
        context: ExecutionContext,
    ) -> None:
        """Receive the setinputsizes dictionary for possible modification.

        This event is emitted in the case where the dialect makes use of the
        DBAPI ``cursor.setinputsizes()`` method which passes information about
        parameter binding for a particular statement.   The given
        ``inputsizes`` dictionary will contain :class:`.BindParameter` objects
        as keys, linked to DBAPI-specific type objects as values; for
        parameters that are not bound, they are added to the dictionary with
        ``None`` as the value, which means the parameter will not be included
        in the ultimate setinputsizes call.   The event may be used to inspect
        and/or log the datatypes that are being bound, as well as to modify the
        dictionary in place.  Parameters can be added, modified, or removed
        from this dictionary.   Callers will typically want to inspect the
        :attr:`.BindParameter.type` attribute of the given bind objects in
        order to make decisions about the DBAPI object.

        After the event, the ``inputsizes`` dictionary is converted into
        an appropriate datastructure to be passed to ``cursor.setinputsizes``;
        either a list for a positional bound parameter execution style,
        or a dictionary of string parameter keys to DBAPI type objects for
        a named bound parameter execution style.

        The setinputsizes hook overall is only used for dialects which include
        the flag ``use_setinputsizes=True``.  Dialects which use this
        include cx_Oracle, pg8000, asyncpg, and pyodbc dialects.

        .. note::

            For use with pyodbc, the ``use_setinputsizes`` flag
            must be passed to the dialect, e.g.::

                create_engine("mssql+pyodbc://...", use_setinputsizes=True)

            .. seealso::

                  :ref:`mssql_pyodbc_setinputsizes`

        .. versionadded:: 1.2.9

        .. seealso::

            :ref:`cx_oracle_setinputsizes`

        """
        pass
