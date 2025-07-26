# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import asyncio
import asyncpg
import collections
import collections.abc
import contextlib
import functools
import itertools
import inspect
import os
import sys
import time
import traceback
import typing
import warnings
import weakref

from . import compat
from . import connect_utils
from . import cursor
from . import exceptions
from . import introspection
from . import prepared_stmt
from . import protocol
from . import serverversion
from . import transaction
from . import utils


class ConnectionMeta(type):

    def __instancecheck__(cls, instance):
        mro = type(instance).__mro__
        return Connection in mro or _ConnectionProxy in mro


class Connection(metaclass=ConnectionMeta):
    """A representation of a database session.

    Connections are created by calling :func:`~asyncpg.connection.connect`.
    """

    __slots__ = ('_protocol', '_transport', '_loop',
                 '_top_xact', '_aborted',
                 '_pool_release_ctr', '_stmt_cache', '_stmts_to_close',
                 '_stmt_cache_enabled',
                 '_listeners', '_server_version', '_server_caps',
                 '_intro_query', '_reset_query', '_proxy',
                 '_stmt_exclusive_section', '_config', '_params', '_addr',
                 '_log_listeners', '_termination_listeners', '_cancellations',
                 '_source_traceback', '_query_loggers', '__weakref__')

    def __init__(self, protocol, transport, loop,
                 addr,
                 config: connect_utils._ClientConfiguration,
                 params: connect_utils._ConnectionParameters):
        self._protocol = protocol
        self._transport = transport
        self._loop = loop
        self._top_xact = None
        self._aborted = False
        # Incremented every time the connection is released back to a pool.
        # Used to catch invalid references to connection-related resources
        # post-release (e.g. explicit prepared statements).
        self._pool_release_ctr = 0

        self._addr = addr
        self._config = config
        self._params = params

        self._stmt_cache = _StatementCache(
            loop=loop,
            max_size=config.statement_cache_size,
            on_remove=functools.partial(
                _weak_maybe_gc_stmt, weakref.ref(self)),
            max_lifetime=config.max_cached_statement_lifetime)

        self._stmts_to_close = set()
        self._stmt_cache_enabled = config.statement_cache_size > 0

        self._listeners = {}
        self._log_listeners = set()
        self._cancellations = set()
        self._termination_listeners = set()
        self._query_loggers = set()

        settings = self._protocol.get_settings()
        ver_string = settings.server_version
        self._server_version = \
            serverversion.split_server_version_string(ver_string)

        self._server_caps = _detect_server_capabilities(
            self._server_version, settings)

        if self._server_version < (14, 0):
            self._intro_query = introspection.INTRO_LOOKUP_TYPES_13
        else:
            self._intro_query = introspection.INTRO_LOOKUP_TYPES

        self._reset_query = None
        self._proxy = None

        # Used to serialize operations that might involve anonymous
        # statements.  Specifically, we want to make the following
        # operation atomic:
        #    ("prepare an anonymous statement", "use the statement")
        #
        # Used for `con.fetchval()`, `con.fetch()`, `con.fetchrow()`,
        # `con.execute()`, and `con.executemany()`.
        self._stmt_exclusive_section = _Atomic()

        if loop.get_debug():
            self._source_traceback = _extract_stack()
        else:
            self._source_traceback = None

    def __del__(self):
        if not self.is_closed() and self._protocol is not None:
            if self._source_traceback:
                msg = "unclosed connection {!r}; created at:\n {}".format(
                    self, self._source_traceback)
            else:
                msg = (
                    "unclosed connection {!r}; run in asyncio debug "
                    "mode to show the traceback of connection "
                    "origin".format(self)
                )

            warnings.warn(msg, ResourceWarning)
            if not self._loop.is_closed():
                self.terminate()

    async def add_listener(self, channel, callback):
        """Add a listener for Postgres notifications.

        :param str channel: Channel to listen on.

        :param callable callback:
            A callable or a coroutine function receiving the following
            arguments:
            **connection**: a Connection the callback is registered with;
            **pid**: PID of the Postgres server that sent the notification;
            **channel**: name of the channel the notification was sent to;
            **payload**: the payload.

        .. versionchanged:: 0.24.0
            The ``callback`` argument may be a coroutine function.
        """
        self._check_open()
        if channel not in self._listeners:
            await self.fetch('LISTEN {}'.format(utils._quote_ident(channel)))
            self._listeners[channel] = set()
        self._listeners[channel].add(_Callback.from_callable(callback))

    async def remove_listener(self, channel, callback):
        """Remove a listening callback on the specified channel."""
        if self.is_closed():
            return
        if channel not in self._listeners:
            return
        cb = _Callback.from_callable(callback)
        if cb not in self._listeners[channel]:
            return
        self._listeners[channel].remove(cb)
        if not self._listeners[channel]:
            del self._listeners[channel]
            await self.fetch('UNLISTEN {}'.format(utils._quote_ident(channel)))

    def add_log_listener(self, callback):
        """Add a listener for Postgres log messages.

        It will be called when asyncronous NoticeResponse is received
        from the connection.  Possible message types are: WARNING, NOTICE,
        DEBUG, INFO, or LOG.

        :param callable callback:
            A callable or a coroutine function receiving the following
            arguments:
            **connection**: a Connection the callback is registered with;
            **message**: the `exceptions.PostgresLogMessage` message.

        .. versionadded:: 0.12.0

        .. versionchanged:: 0.24.0
            The ``callback`` argument may be a coroutine function.
        """
        if self.is_closed():
            raise exceptions.InterfaceError('connection is closed')
        self._log_listeners.add(_Callback.from_callable(callback))

    def remove_log_listener(self, callback):
        """Remove a listening callback for log messages.

        .. versionadded:: 0.12.0
        """
        self._log_listeners.discard(_Callback.from_callable(callback))

    def add_termination_listener(self, callback):
        """Add a listener that will be called when the connection is closed.

        :param callable callback:
            A callable or a coroutine function receiving one argument:
            **connection**: a Connection the callback is registered with.

        .. versionadded:: 0.21.0

        .. versionchanged:: 0.24.0
            The ``callback`` argument may be a coroutine function.
        """
        self._termination_listeners.add(_Callback.from_callable(callback))

    def remove_termination_listener(self, callback):
        """Remove a listening callback for connection termination.

        :param callable callback:
            The callable or coroutine function that was passed to
            :meth:`Connection.add_termination_listener`.

        .. versionadded:: 0.21.0
        """
        self._termination_listeners.discard(_Callback.from_callable(callback))

    def add_query_logger(self, callback):
        """Add a logger that will be called when queries are executed.

        :param callable callback:
            A callable or a coroutine function receiving one argument:
            **record**: a LoggedQuery containing `query`, `args`, `timeout`,
                        `elapsed`, `exception`, `conn_addr`, and
                        `conn_params`.

        .. versionadded:: 0.29.0
        """
        self._query_loggers.add(_Callback.from_callable(callback))

    def remove_query_logger(self, callback):
        """Remove a query logger callback.

        :param callable callback:
            The callable or coroutine function that was passed to
            :meth:`Connection.add_query_logger`.

        .. versionadded:: 0.29.0
        """
        self._query_loggers.discard(_Callback.from_callable(callback))

    def get_server_pid(self):
        """Return the PID of the Postgres server the connection is bound to."""
        return self._protocol.get_server_pid()

    def get_server_version(self):
        """Return the version of the connected PostgreSQL server.

        The returned value is a named tuple similar to that in
        ``sys.version_info``:

        .. code-block:: pycon

            >>> con.get_server_version()
            ServerVersion(major=9, minor=6, micro=1,
                          releaselevel='final', serial=0)

        .. versionadded:: 0.8.0
        """
        return self._server_version

    def get_settings(self):
        """Return connection settings.

        :return: :class:`~asyncpg.ConnectionSettings`.
        """
        return self._protocol.get_settings()

    def transaction(self, *, isolation=None, readonly=False,
                    deferrable=False):
        """Create a :class:`~transaction.Transaction` object.

        Refer to `PostgreSQL documentation`_ on the meaning of transaction
        parameters.

        :param isolation: Transaction isolation mode, can be one of:
                          `'serializable'`, `'repeatable_read'`,
                          `'read_uncommitted'`, `'read_committed'`. If not
                          specified, the behavior is up to the server and
                          session, which is usually ``read_committed``.

        :param readonly: Specifies whether or not this transaction is
                         read-only.

        :param deferrable: Specifies whether or not this transaction is
                           deferrable.

        .. _`PostgreSQL documentation`:
                https://www.postgresql.org/docs/
                current/static/sql-set-transaction.html
        """
        self._check_open()
        return transaction.Transaction(self, isolation, readonly, deferrable)

    def is_in_transaction(self):
        """Return True if Connection is currently inside a transaction.

        :return bool: True if inside transaction, False otherwise.

        .. versionadded:: 0.16.0
        """
        return self._protocol.is_in_transaction()

    async def execute(self, query: str, *args, timeout: float=None) -> str:
        """Execute an SQL command (or commands).

        This method can execute many SQL commands at once, when no arguments
        are provided.

        Example:

        .. code-block:: pycon

            >>> await con.execute('''
            ...     CREATE TABLE mytab (a int);
            ...     INSERT INTO mytab (a) VALUES (100), (200), (300);
            ... ''')
            INSERT 0 3

            >>> await con.execute('''
            ...     INSERT INTO mytab (a) VALUES ($1), ($2)
            ... ''', 10, 20)
            INSERT 0 2

        :param args: Query arguments.
        :param float timeout: Optional timeout value in seconds.
        :return str: Status of the last SQL command.

        .. versionchanged:: 0.5.4
           Made it possible to pass query arguments.
        """
        self._check_open()

        if not args:
            if self._query_loggers:
                with self._time_and_log(query, args, timeout):
                    result = await self._protocol.query(query, timeout)
            else:
                result = await self._protocol.query(query, timeout)
            return result

        _, status, _ = await self._execute(
            query,
            args,
            0,
            timeout,
            return_status=True,
        )
        return status.decode()

    async def executemany(self, command: str, args, *, timeout: float=None):
        """Execute an SQL *command* for each sequence of arguments in *args*.

        Example:

        .. code-block:: pycon

            >>> await con.executemany('''
            ...     INSERT INTO mytab (a) VALUES ($1, $2, $3);
            ... ''', [(1, 2, 3), (4, 5, 6)])

        :param command: Command to execute.
        :param args: An iterable containing sequences of arguments.
        :param float timeout: Optional timeout value in seconds.
        :return None: This method discards the results of the operations.

        .. versionadded:: 0.7.0

        .. versionchanged:: 0.11.0
           `timeout` became a keyword-only parameter.

        .. versionchanged:: 0.22.0
           ``executemany()`` is now an atomic operation, which means that
           either all executions succeed, or none at all.  This is in contrast
           to prior versions, where the effect of already-processed iterations
           would remain in place when an error has occurred, unless
           ``executemany()`` was called in a transaction.
        """
        self._check_open()
        return await self._executemany(command, args, timeout)

    async def _get_statement(
        self,
        query,
        timeout,
        *,
        named=False,
        use_cache=True,
        ignore_custom_codec=False,
        record_class=None
    ):
        if record_class is None:
            record_class = self._protocol.get_record_class()
        else:
            _check_record_class(record_class)

        if use_cache:
            statement = self._stmt_cache.get(
                (query, record_class, ignore_custom_codec)
            )
            if statement is not None:
                return statement

            # Only use the cache when:
            #  * `statement_cache_size` is greater than 0;
            #  * query size is less than `max_cacheable_statement_size`.
            use_cache = (
                self._stmt_cache_enabled
                and (
                    not self._config.max_cacheable_statement_size
                    or len(query) <= self._config.max_cacheable_statement_size
                )
            )

        if isinstance(named, str):
            stmt_name = named
        elif use_cache or named:
            stmt_name = self._get_unique_id('stmt')
        else:
            stmt_name = ''

        statement = await self._protocol.prepare(
            stmt_name,
            query,
            timeout,
            record_class=record_class,
            ignore_custom_codec=ignore_custom_codec,
        )
        need_reprepare = False
        types_with_missing_codecs = statement._init_types()
        tries = 0
        while types_with_missing_codecs:
            settings = self._protocol.get_settings()

            # Introspect newly seen types and populate the
            # codec cache.
            types, intro_stmt = await self._introspect_types(
                types_with_missing_codecs, timeout)

            settings.register_data_types(types)

            # The introspection query has used an anonymous statement,
            # which has blown away the anonymous statement we've prepared
            # for the query, so we need to re-prepare it.
            need_reprepare = not intro_stmt.name and not statement.name
            types_with_missing_codecs = statement._init_types()
            tries += 1
            if tries > 5:
                # In the vast majority of cases there will be only
                # one iteration.  In rare cases, there might be a race
                # with reload_schema_state(), which would cause a
                # second try.  More than five is clearly a bug.
                raise exceptions.InternalClientError(
                    'could not resolve query result and/or argument types '
                    'in {} attempts'.format(tries)
                )

        # Now that types have been resolved, populate the codec pipeline
        # for the statement.
        statement._init_codecs()

        if (
            need_reprepare
            or (not statement.name and not self._stmt_cache_enabled)
        ):
            # Mark this anonymous prepared statement as "unprepared",
            # causing it to get re-Parsed in next bind_execute.
            # We always do this when stmt_cache_size is set to 0 assuming
            # people are running PgBouncer which is mishandling implicit
            # transactions.
            statement.mark_unprepared()

        if use_cache:
            self._stmt_cache.put(
                (query, record_class, ignore_custom_codec), statement)

        # If we've just created a new statement object, check if there
        # are any statements for GC.
        if self._stmts_to_close:
            await self._cleanup_stmts()

        return statement

    async def _introspect_types(self, typeoids, timeout):
        if self._server_caps.jit:
            try:
                cfgrow, _ = await self.__execute(
                    """
                    SELECT
                        current_setting('jit') AS cur,
                        set_config('jit', 'off', false) AS new
                    """,
                    (),
                    0,
                    timeout,
                    ignore_custom_codec=True,
                )
                jit_state = cfgrow[0]['cur']
            except exceptions.UndefinedObjectError:
                jit_state = 'off'
        else:
            jit_state = 'off'

        result = await self.__execute(
            self._intro_query,
            (list(typeoids),),
            0,
            timeout,
            ignore_custom_codec=True,
        )

        if jit_state != 'off':
            await self.__execute(
                """
                SELECT
                    set_config('jit', $1, false)
                """,
                (jit_state,),
                0,
                timeout,
                ignore_custom_codec=True,
            )

        return result

    async def _introspect_type(self, typename, schema):
        if (
            schema == 'pg_catalog'
            and typename.lower() in protocol.BUILTIN_TYPE_NAME_MAP
        ):
            typeoid = protocol.BUILTIN_TYPE_NAME_MAP[typename.lower()]
            rows = await self._execute(
                introspection.TYPE_BY_OID,
                [typeoid],
                limit=0,
                timeout=None,
                ignore_custom_codec=True,
            )
        else:
            rows = await self._execute(
                introspection.TYPE_BY_NAME,
                [typename, schema],
                limit=1,
                timeout=None,
                ignore_custom_codec=True,
            )

        if not rows:
            raise ValueError(
                'unknown type: {}.{}'.format(schema, typename))

        return rows[0]

    def cursor(
        self,
        query,
        *args,
        prefetch=None,
        timeout=None,
        record_class=None
    ):
        """Return a *cursor factory* for the specified query.

        :param args:
            Query arguments.
        :param int prefetch:
            The number of rows the *cursor iterator*
            will prefetch (defaults to ``50``.)
        :param float timeout:
            Optional timeout in seconds.
        :param type record_class:
            If specified, the class to use for records returned by this cursor.
            Must be a subclass of :class:`~asyncpg.Record`.  If not specified,
            a per-connection *record_class* is used.

        :return:
            A :class:`~cursor.CursorFactory` object.

        .. versionchanged:: 0.22.0
            Added the *record_class* parameter.
        """
        self._check_open()
        return cursor.CursorFactory(
            self,
            query,
            None,
            args,
            prefetch,
            timeout,
            record_class,
        )

    async def prepare(
        self,
        query,
        *,
        name=None,
        timeout=None,
        record_class=None,
    ):
        """Create a *prepared statement* for the specified query.

        :param str query:
            Text of the query to create a prepared statement for.
        :param str name:
            Optional name of the returned prepared statement.  If not
            specified, the name is auto-generated.
        :param float timeout:
            Optional timeout value in seconds.
        :param type record_class:
            If specified, the class to use for records returned by the
            prepared statement.  Must be a subclass of
            :class:`~asyncpg.Record`.  If not specified, a per-connection
            *record_class* is used.

        :return:
            A :class:`~prepared_stmt.PreparedStatement` instance.

        .. versionchanged:: 0.22.0
            Added the *record_class* parameter.

        .. versionchanged:: 0.25.0
            Added the *name* parameter.
        """
        return await self._prepare(
            query,
            name=name,
            timeout=timeout,
            use_cache=False,
            record_class=record_class,
        )

    async def _prepare(
        self,
        query,
        *,
        name=None,
        timeout=None,
        use_cache: bool=False,
        record_class=None
    ):
        self._check_open()
        stmt = await self._get_statement(
            query,
            timeout,
            named=True if name is None else name,
            use_cache=use_cache,
            record_class=record_class,
        )
        return prepared_stmt.PreparedStatement(self, query, stmt)

    async def fetch(
        self,
        query,
        *args,
        timeout=None,
        record_class=None
    ) -> list:
        """Run a query and return the results as a list of :class:`Record`.

        :param str query:
            Query text.
        :param args:
            Query arguments.
        :param float timeout:
            Optional timeout value in seconds.
        :param type record_class:
            If specified, the class to use for records returned by this method.
            Must be a subclass of :class:`~asyncpg.Record`.  If not specified,
            a per-connection *record_class* is used.

        :return list:
            A list of :class:`~asyncpg.Record` instances.  If specified, the
            actual type of list elements would be *record_class*.

        .. versionchanged:: 0.22.0
            Added the *record_class* parameter.
        """
        self._check_open()
        return await self._execute(
            query,
            args,
            0,
            timeout,
            record_class=record_class,
        )

    async def fetchval(self, query, *args, column=0, timeout=None):
        """Run a query and return a value in the first row.

        :param str query: Query text.
        :param args: Query arguments.
        :param int column: Numeric index within the record of the value to
                           return (defaults to 0).
        :param float timeout: Optional timeout value in seconds.
                            If not specified, defaults to the value of
                            ``command_timeout`` argument to the ``Connection``
                            instance constructor.

        :return: The value of the specified column of the first record, or
                 None if no records were returned by the query.
        """
        self._check_open()
        data = await self._execute(query, args, 1, timeout)
        if not data:
            return None
        return data[0][column]

    async def fetchrow(
        self,
        query,
        *args,
        timeout=None,
        record_class=None
    ):
        """Run a query and return the first row.

        :param str query:
            Query text
        :param args:
            Query arguments
        :param float timeout:
            Optional timeout value in seconds.
        :param type record_class:
            If specified, the class to use for the value returned by this
            method.  Must be a subclass of :class:`~asyncpg.Record`.
            If not specified, a per-connection *record_class* is used.

        :return:
            The first row as a :class:`~asyncpg.Record` instance, or None if
            no records were returned by the query.  If specified,
            *record_class* is used as the type for the result value.

        .. versionchanged:: 0.22.0
            Added the *record_class* parameter.
        """
        self._check_open()
        data = await self._execute(
            query,
            args,
            1,
            timeout,
            record_class=record_class,
        )
        if not data:
            return None
        return data[0]

    async def copy_from_table(self, table_name, *, output,
                              columns=None, schema_name=None, timeout=None,
                              format=None, oids=None, delimiter=None,
                              null=None, header=None, quote=None,
                              escape=None, force_quote=None, encoding=None):
        """Copy table contents to a file or file-like object.

        :param str table_name:
            The name of the table to copy data from.

        :param output:
            A :term:`path-like object <python:path-like object>`,
            or a :term:`file-like object <python:file-like object>`, or
            a :term:`coroutine function <python:coroutine function>`
            that takes a ``bytes`` instance as a sole argument.

        :param list columns:
            An optional list of column names to copy.

        :param str schema_name:
            An optional schema name to qualify the table.

        :param float timeout:
            Optional timeout value in seconds.

        The remaining keyword arguments are ``COPY`` statement options,
        see `COPY statement documentation`_ for details.

        :return: The status string of the COPY command.

        Example:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> async def run():
            ...     con = await asyncpg.connect(user='postgres')
            ...     result = await con.copy_from_table(
            ...         'mytable', columns=('foo', 'bar'),
            ...         output='file.csv', format='csv')
            ...     print(result)
            ...
            >>> asyncio.get_event_loop().run_until_complete(run())
            'COPY 100'

        .. _`COPY statement documentation`:
            https://www.postgresql.org/docs/current/static/sql-copy.html

        .. versionadded:: 0.11.0
        """
        tabname = utils._quote_ident(table_name)
        if schema_name:
            tabname = utils._quote_ident(schema_name) + '.' + tabname

        if columns:
            cols = '({})'.format(
                ', '.join(utils._quote_ident(c) for c in columns))
        else:
            cols = ''

        opts = self._format_copy_opts(
            format=format, oids=oids, delimiter=delimiter,
            null=null, header=header, quote=quote, escape=escape,
            force_quote=force_quote, encoding=encoding
        )

        copy_stmt = 'COPY {tab}{cols} TO STDOUT {opts}'.format(
            tab=tabname, cols=cols, opts=opts)

        return await self._copy_out(copy_stmt, output, timeout)

    async def copy_from_query(self, query, *args, output,
                              timeout=None, format=None, oids=None,
                              delimiter=None, null=None, header=None,
                              quote=None, escape=None, force_quote=None,
                              encoding=None):
        """Copy the results of a query to a file or file-like object.

        :param str query:
            The query to copy the results of.

        :param args:
            Query arguments.

        :param output:
            A :term:`path-like object <python:path-like object>`,
            or a :term:`file-like object <python:file-like object>`, or
            a :term:`coroutine function <python:coroutine function>`
            that takes a ``bytes`` instance as a sole argument.

        :param float timeout:
            Optional timeout value in seconds.

        The remaining keyword arguments are ``COPY`` statement options,
        see `COPY statement documentation`_ for details.

        :return: The status string of the COPY command.

        Example:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> async def run():
            ...     con = await asyncpg.connect(user='postgres')
            ...     result = await con.copy_from_query(
            ...         'SELECT foo, bar FROM mytable WHERE foo > $1', 10,
            ...         output='file.csv', format='csv')
            ...     print(result)
            ...
            >>> asyncio.get_event_loop().run_until_complete(run())
            'COPY 10'

        .. _`COPY statement documentation`:
            https://www.postgresql.org/docs/current/static/sql-copy.html

        .. versionadded:: 0.11.0
        """
        opts = self._format_copy_opts(
            format=format, oids=oids, delimiter=delimiter,
            null=null, header=header, quote=quote, escape=escape,
            force_quote=force_quote, encoding=encoding
        )

        if args:
            query = await utils._mogrify(self, query, args)

        copy_stmt = 'COPY ({query}) TO STDOUT {opts}'.format(
            query=query, opts=opts)

        return await self._copy_out(copy_stmt, output, timeout)

    async def copy_to_table(self, table_name, *, source,
                            columns=None, schema_name=None, timeout=None,
                            format=None, oids=None, freeze=None,
                            delimiter=None, null=None, header=None,
                            quote=None, escape=None, force_quote=None,
                            force_not_null=None, force_null=None,
                            encoding=None, where=None):
        """Copy data to the specified table.

        :param str table_name:
            The name of the table to copy data to.

        :param source:
            A :term:`path-like object <python:path-like object>`,
            or a :term:`file-like object <python:file-like object>`, or
            an :term:`asynchronous iterable <python:asynchronous iterable>`
            that returns ``bytes``, or an object supporting the
            :ref:`buffer protocol <python:bufferobjects>`.

        :param list columns:
            An optional list of column names to copy.

        :param str schema_name:
            An optional schema name to qualify the table.

        :param str where:
            An optional SQL expression used to filter rows when copying.

            .. note::

                Usage of this parameter requires support for the
                ``COPY FROM ... WHERE`` syntax, introduced in
                PostgreSQL version 12.

        :param float timeout:
            Optional timeout value in seconds.

        The remaining keyword arguments are ``COPY`` statement options,
        see `COPY statement documentation`_ for details.

        :return: The status string of the COPY command.

        Example:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> async def run():
            ...     con = await asyncpg.connect(user='postgres')
            ...     result = await con.copy_to_table(
            ...         'mytable', source='datafile.tbl')
            ...     print(result)
            ...
            >>> asyncio.get_event_loop().run_until_complete(run())
            'COPY 140000'

        .. _`COPY statement documentation`:
            https://www.postgresql.org/docs/current/static/sql-copy.html

        .. versionadded:: 0.11.0

        .. versionadded:: 0.29.0
            Added the *where* parameter.
        """
        tabname = utils._quote_ident(table_name)
        if schema_name:
            tabname = utils._quote_ident(schema_name) + '.' + tabname

        if columns:
            cols = '({})'.format(
                ', '.join(utils._quote_ident(c) for c in columns))
        else:
            cols = ''

        cond = self._format_copy_where(where)
        opts = self._format_copy_opts(
            format=format, oids=oids, freeze=freeze, delimiter=delimiter,
            null=null, header=header, quote=quote, escape=escape,
            force_not_null=force_not_null, force_null=force_null,
            encoding=encoding
        )

        copy_stmt = 'COPY {tab}{cols} FROM STDIN {opts} {cond}'.format(
            tab=tabname, cols=cols, opts=opts, cond=cond)

        return await self._copy_in(copy_stmt, source, timeout)

    async def copy_records_to_table(self, table_name, *, records,
                                    columns=None, schema_name=None,
                                    timeout=None, where=None):
        """Copy a list of records to the specified table using binary COPY.

        :param str table_name:
            The name of the table to copy data to.

        :param records:
            An iterable returning row tuples to copy into the table.
            :term:`Asynchronous iterables <python:asynchronous iterable>`
            are also supported.

        :param list columns:
            An optional list of column names to copy.

        :param str schema_name:
            An optional schema name to qualify the table.

        :param str where:
            An optional SQL expression used to filter rows when copying.

            .. note::

                Usage of this parameter requires support for the
                ``COPY FROM ... WHERE`` syntax, introduced in
                PostgreSQL version 12.


        :param float timeout:
            Optional timeout value in seconds.

        :return: The status string of the COPY command.

        Example:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> async def run():
            ...     con = await asyncpg.connect(user='postgres')
            ...     result = await con.copy_records_to_table(
            ...         'mytable', records=[
            ...             (1, 'foo', 'bar'),
            ...             (2, 'ham', 'spam')])
            ...     print(result)
            ...
            >>> asyncio.get_event_loop().run_until_complete(run())
            'COPY 2'

        Asynchronous record iterables are also supported:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> async def run():
            ...     con = await asyncpg.connect(user='postgres')
            ...     async def record_gen(size):
            ...         for i in range(size):
            ...             yield (i,)
            ...     result = await con.copy_records_to_table(
            ...         'mytable', records=record_gen(100))
            ...     print(result)
            ...
            >>> asyncio.get_event_loop().run_until_complete(run())
            'COPY 100'

        .. versionadded:: 0.11.0

        .. versionchanged:: 0.24.0
            The ``records`` argument may be an asynchronous iterable.

        .. versionadded:: 0.29.0
            Added the *where* parameter.
        """
        tabname = utils._quote_ident(table_name)
        if schema_name:
            tabname = utils._quote_ident(schema_name) + '.' + tabname

        if columns:
            col_list = ', '.join(utils._quote_ident(c) for c in columns)
            cols = '({})'.format(col_list)
        else:
            col_list = '*'
            cols = ''

        intro_query = 'SELECT {cols} FROM {tab} LIMIT 1'.format(
            tab=tabname, cols=col_list)

        intro_ps = await self._prepare(intro_query, use_cache=True)

        cond = self._format_copy_where(where)
        opts = '(FORMAT binary)'

        copy_stmt = 'COPY {tab}{cols} FROM STDIN {opts} {cond}'.format(
            tab=tabname, cols=cols, opts=opts, cond=cond)

        return await self._protocol.copy_in(
            copy_stmt, None, None, records, intro_ps._state, timeout)

    def _format_copy_where(self, where):
        if where and not self._server_caps.sql_copy_from_where:
            raise exceptions.UnsupportedServerFeatureError(
                'the `where` parameter requires PostgreSQL 12 or later')

        if where:
            where_clause = 'WHERE ' + where
        else:
            where_clause = ''

        return where_clause

    def _format_copy_opts(self, *, format=None, oids=None, freeze=None,
                          delimiter=None, null=None, header=None, quote=None,
                          escape=None, force_quote=None, force_not_null=None,
                          force_null=None, encoding=None):
        kwargs = dict(locals())
        kwargs.pop('self')
        opts = []

        if force_quote is not None and isinstance(force_quote, bool):
            kwargs.pop('force_quote')
            if force_quote:
                opts.append('FORCE_QUOTE *')

        for k, v in kwargs.items():
            if v is not None:
                if k in ('force_not_null', 'force_null', 'force_quote'):
                    v = '(' + ', '.join(utils._quote_ident(c) for c in v) + ')'
                elif k in ('oids', 'freeze', 'header'):
                    v = str(v)
                else:
                    v = utils._quote_literal(v)

                opts.append('{} {}'.format(k.upper(), v))

        if opts:
            return '(' + ', '.join(opts) + ')'
        else:
            return ''

    async def _copy_out(self, copy_stmt, output, timeout):
        try:
            path = os.fspath(output)
        except TypeError:
            # output is not a path-like object
            path = None

        writer = None
        opened_by_us = False
        run_in_executor = self._loop.run_in_executor

        if path is not None:
            # a path
            f = await run_in_executor(None, open, path, 'wb')
            opened_by_us = True
        elif hasattr(output, 'write'):
            # file-like
            f = output
        elif callable(output):
            # assuming calling output returns an awaitable.
            writer = output
        else:
            raise TypeError(
                'output is expected to be a file-like object, '
                'a path-like object or a coroutine function, '
                'not {}'.format(type(output).__name__)
            )

        if writer is None:
            async def _writer(data):
                await run_in_executor(None, f.write, data)
            writer = _writer

        try:
            return await self._protocol.copy_out(copy_stmt, writer, timeout)
        finally:
            if opened_by_us:
                f.close()

    async def _copy_in(self, copy_stmt, source, timeout):
        try:
            path = os.fspath(source)
        except TypeError:
            # source is not a path-like object
            path = None

        f = None
        reader = None
        data = None
        opened_by_us = False
        run_in_executor = self._loop.run_in_executor

        if path is not None:
            # a path
            f = await run_in_executor(None, open, path, 'rb')
            opened_by_us = True
        elif hasattr(source, 'read'):
            # file-like
            f = source
        elif isinstance(source, collections.abc.AsyncIterable):
            # assuming calling output returns an awaitable.
            # copy_in() is designed to handle very large amounts of data, and
            # the source async iterable is allowed to return an arbitrary
            # amount of data on every iteration.
            reader = source
        else:
            # assuming source is an instance supporting the buffer protocol.
            data = source

        if f is not None:
            # Copying from a file-like object.
            class _Reader:
                def __aiter__(self):
                    return self

                async def __anext__(self):
                    data = await run_in_executor(None, f.read, 524288)
                    if len(data) == 0:
                        raise StopAsyncIteration
                    else:
                        return data

            reader = _Reader()

        try:
            return await self._protocol.copy_in(
                copy_stmt, reader, data, None, None, timeout)
        finally:
            if opened_by_us:
                await run_in_executor(None, f.close)

    async def set_type_codec(self, typename, *,
                             schema='public', encoder, decoder,
                             format='text'):
        """Set an encoder/decoder pair for the specified data type.

        :param typename:
            Name of the data type the codec is for.

        :param schema:
            Schema name of the data type the codec is for
            (defaults to ``'public'``)

        :param format:
            The type of the argument received by the *decoder* callback,
            and the type of the *encoder* callback return value.

            If *format* is ``'text'`` (the default), the exchange datum is a
            ``str`` instance containing valid text representation of the
            data type.

            If *format* is ``'binary'``, the exchange datum is a ``bytes``
            instance containing valid _binary_ representation of the
            data type.

            If *format* is ``'tuple'``, the exchange datum is a type-specific
            ``tuple`` of values.  The table below lists supported data
            types and their format for this mode.

            +-----------------+---------------------------------------------+
            |  Type           |                Tuple layout                 |
            +=================+=============================================+
            | ``interval``    | (``months``, ``days``, ``microseconds``)    |
            +-----------------+---------------------------------------------+
            | ``date``        | (``date ordinal relative to Jan 1 2000``,)  |
            |                 | ``-2^31`` for negative infinity timestamp   |
            |                 | ``2^31-1`` for positive infinity timestamp. |
            +-----------------+---------------------------------------------+
            | ``timestamp``   | (``microseconds relative to Jan 1 2000``,)  |
            |                 | ``-2^63`` for negative infinity timestamp   |
            |                 | ``2^63-1`` for positive infinity timestamp. |
            +-----------------+---------------------------------------------+
            | ``timestamp     | (``microseconds relative to Jan 1 2000      |
            | with time zone``| UTC``,)                                     |
            |                 | ``-2^63`` for negative infinity timestamp   |
            |                 | ``2^63-1`` for positive infinity timestamp. |
            +-----------------+---------------------------------------------+
            | ``time``        | (``microseconds``,)                         |
            +-----------------+---------------------------------------------+
            | ``time with     | (``microseconds``,                          |
            | time zone``     | ``time zone offset in seconds``)            |
            +-----------------+---------------------------------------------+
            | any composite   | Composite value elements                    |
            | type            |                                             |
            +-----------------+---------------------------------------------+

        :param encoder:
            Callable accepting a Python object as a single argument and
            returning a value encoded according to *format*.

        :param decoder:
            Callable accepting a single argument encoded according to *format*
            and returning a decoded Python object.

        Example:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> import datetime
            >>> from dateutil.relativedelta import relativedelta
            >>> async def run():
            ...     con = await asyncpg.connect(user='postgres')
            ...     def encoder(delta):
            ...         ndelta = delta.normalized()
            ...         return (ndelta.years * 12 + ndelta.months,
            ...                 ndelta.days,
            ...                 ((ndelta.hours * 3600 +
            ...                    ndelta.minutes * 60 +
            ...                    ndelta.seconds) * 1000000 +
            ...                  ndelta.microseconds))
            ...     def decoder(tup):
            ...         return relativedelta(months=tup[0], days=tup[1],
            ...                              microseconds=tup[2])
            ...     await con.set_type_codec(
            ...         'interval', schema='pg_catalog', encoder=encoder,
            ...         decoder=decoder, format='tuple')
            ...     result = await con.fetchval(
            ...         "SELECT '2 years 3 mons 1 day'::interval")
            ...     print(result)
            ...     print(datetime.datetime(2002, 1, 1) + result)
            ...
            >>> asyncio.get_event_loop().run_until_complete(run())
            relativedelta(years=+2, months=+3, days=+1)
            2004-04-02 00:00:00

        .. versionadded:: 0.12.0
            Added the ``format`` keyword argument and support for 'tuple'
            format.

        .. versionchanged:: 0.12.0
            The ``binary`` keyword argument is deprecated in favor of
            ``format``.

        .. versionchanged:: 0.13.0
            The ``binary`` keyword argument was removed in favor of
            ``format``.

        .. versionchanged:: 0.29.0
            Custom codecs for composite types are now supported with
            ``format='tuple'``.

        .. note::

           It is recommended to use the ``'binary'`` or ``'tuple'`` *format*
           whenever possible and if the underlying type supports it. Asyncpg
           currently does not support text I/O for composite and range types,
           and some other functionality, such as
           :meth:`Connection.copy_to_table`, does not support types with text
           codecs.
        """
        self._check_open()
        settings = self._protocol.get_settings()
        typeinfo = await self._introspect_type(typename, schema)
        full_typeinfos = []
        if introspection.is_scalar_type(typeinfo):
            kind = 'scalar'
        elif introspection.is_composite_type(typeinfo):
            if format != 'tuple':
                raise exceptions.UnsupportedClientFeatureError(
                    'only tuple-format codecs can be used on composite types',
                    hint="Use `set_type_codec(..., format='tuple')` and "
                         "pass/interpret data as a Python tuple.  See an "
                         "example at https://magicstack.github.io/asyncpg/"
                         "current/usage.html#example-decoding-complex-types",
                )
            kind = 'composite'
            full_typeinfos, _ = await self._introspect_types(
                (typeinfo['oid'],), 10)
        else:
            raise exceptions.InterfaceError(
                f'cannot use custom codec on type {schema}.{typename}: '
                f'it is neither a scalar type nor a composite type'
            )
        if introspection.is_domain_type(typeinfo):
            raise exceptions.UnsupportedClientFeatureError(
                'custom codecs on domain types are not supported',
                hint='Set the codec on the base type.',
                detail=(
                    'PostgreSQL does not distinguish domains from '
                    'their base types in query results at the protocol level.'
                )
            )

        oid = typeinfo['oid']
        settings.add_python_codec(
            oid, typename, schema, full_typeinfos, kind,
            encoder, decoder, format)

        # Statement cache is no longer valid due to codec changes.
        self._drop_local_statement_cache()

    async def reset_type_codec(self, typename, *, schema='public'):
        """Reset *typename* codec to the default implementation.

        :param typename:
            Name of the data type the codec is for.

        :param schema:
            Schema name of the data type the codec is for
            (defaults to ``'public'``)

        .. versionadded:: 0.12.0
        """

        typeinfo = await self._introspect_type(typename, schema)
        self._protocol.get_settings().remove_python_codec(
            typeinfo['oid'], typename, schema)

        # Statement cache is no longer valid due to codec changes.
        self._drop_local_statement_cache()

    async def set_builtin_type_codec(self, typename, *,
                                     schema='public', codec_name,
                                     format=None):
        """Set a builtin codec for the specified scalar data type.

        This method has two uses.  The first is to register a builtin
        codec for an extension type without a stable OID, such as 'hstore'.
        The second use is to declare that an extension type or a
        user-defined type is wire-compatible with a certain builtin
        data type and should be exchanged as such.

        :param typename:
            Name of the data type the codec is for.

        :param schema:
            Schema name of the data type the codec is for
            (defaults to ``'public'``).

        :param codec_name:
            The name of the builtin codec to use for the type.
            This should be either the name of a known core type
            (such as ``"int"``), or the name of a supported extension
            type.  Currently, the only supported extension type is
            ``"pg_contrib.hstore"``.

        :param format:
            If *format* is ``None`` (the default), all formats supported
            by the target codec are declared to be supported for *typename*.
            If *format* is ``'text'`` or ``'binary'``, then only the
            specified format is declared to be supported for *typename*.

        .. versionchanged:: 0.18.0
            The *codec_name* argument can be the name of any known
            core data type.  Added the *format* keyword argument.
        """
        self._check_open()
        typeinfo = await self._introspect_type(typename, schema)
        if not introspection.is_scalar_type(typeinfo):
            raise exceptions.InterfaceError(
                'cannot alias non-scalar type {}.{}'.format(
                    schema, typename))

        oid = typeinfo['oid']

        self._protocol.get_settings().set_builtin_type_codec(
            oid, typename, schema, 'scalar', codec_name, format)

        # Statement cache is no longer valid due to codec changes.
        self._drop_local_statement_cache()

    def is_closed(self):
        """Return ``True`` if the connection is closed, ``False`` otherwise.

        :return bool: ``True`` if the connection is closed, ``False``
                      otherwise.
        """
        return self._aborted or not self._protocol.is_connected()

    async def close(self, *, timeout=None):
        """Close the connection gracefully.

        :param float timeout:
            Optional timeout value in seconds.

        .. versionchanged:: 0.14.0
           Added the *timeout* parameter.
        """
        try:
            if not self.is_closed():
                await self._protocol.close(timeout)
        except (Exception, asyncio.CancelledError):
            # If we fail to close gracefully, abort the connection.
            self._abort()
            raise
        finally:
            self._cleanup()

    def terminate(self):
        """Terminate the connection without waiting for pending data."""
        if not self.is_closed():
            self._abort()
        self._cleanup()

    async def reset(self, *, timeout=None):
        self._check_open()
        self._listeners.clear()
        self._log_listeners.clear()
        reset_query = self._get_reset_query()

        if self._protocol.is_in_transaction() or self._top_xact is not None:
            if self._top_xact is None or not self._top_xact._managed:
                # Managed transactions are guaranteed to __aexit__
                # correctly.
                self._loop.call_exception_handler({
                    'message': 'Resetting connection with an '
                               'active transaction {!r}'.format(self)
                })

            self._top_xact = None
            reset_query = 'ROLLBACK;\n' + reset_query

        if reset_query:
            await self.execute(reset_query, timeout=timeout)

    def _abort(self):
        # Put the connection into the aborted state.
        self._aborted = True
        self._protocol.abort()
        self._protocol = None

    def _cleanup(self):
        self._call_termination_listeners()
        # Free the resources associated with this connection.
        # This must be called when a connection is terminated.

        if self._proxy is not None:
            # Connection is a member of a pool, so let the pool
            # know that this connection is dead.
            self._proxy._holder._release_on_close()

        self._mark_stmts_as_closed()
        self._listeners.clear()
        self._log_listeners.clear()
        self._query_loggers.clear()
        self._clean_tasks()

    def _clean_tasks(self):
        # Wrap-up any remaining tasks associated with this connection.
        if self._cancellations:
            for fut in self._cancellations:
                if not fut.done():
                    fut.cancel()
            self._cancellations.clear()

    def _check_open(self):
        if self.is_closed():
            raise exceptions.InterfaceError('connection is closed')

    def _get_unique_id(self, prefix):
        global _uid
        _uid += 1
        return '__asyncpg_{}_{:x}__'.format(prefix, _uid)

    def _mark_stmts_as_closed(self):
        for stmt in self._stmt_cache.iter_statements():
            stmt.mark_closed()

        for stmt in self._stmts_to_close:
            stmt.mark_closed()

        self._stmt_cache.clear()
        self._stmts_to_close.clear()

    def _maybe_gc_stmt(self, stmt):
        if (
            stmt.refs == 0
            and stmt.name
            and not self._stmt_cache.has(
                (stmt.query, stmt.record_class, stmt.ignore_custom_codec)
            )
        ):
            # If low-level `stmt` isn't referenced from any high-level
            # `PreparedStatement` object and is not in the `_stmt_cache`:
            #
            #  * mark it as closed, which will make it non-usable
            #    for any `PreparedStatement` or for methods like
            #    `Connection.fetch()`.
            #
            # * schedule it to be formally closed on the server.
            stmt.mark_closed()
            self._stmts_to_close.add(stmt)

    async def _cleanup_stmts(self):
        # Called whenever we create a new prepared statement in
        # `Connection._get_statement()` and `_stmts_to_close` is
        # not empty.
        to_close = self._stmts_to_close
        self._stmts_to_close = set()
        for stmt in to_close:
            # It is imperative that statements are cleaned properly,
            # so we ignore the timeout.
            await self._protocol.close_statement(stmt, protocol.NO_TIMEOUT)

    async def _cancel(self, waiter):
        try:
            # Open new connection to the server
            await connect_utils._cancel(
                loop=self._loop, addr=self._addr, params=self._params,
                backend_pid=self._protocol.backend_pid,
                backend_secret=self._protocol.backend_secret)
        except ConnectionResetError as ex:
            # On some systems Postgres will reset the connection
            # after processing the cancellation command.
            if not waiter.done():
                waiter.set_exception(ex)
        except asyncio.CancelledError:
            # There are two scenarios in which the cancellation
            # itself will be cancelled: 1) the connection is being closed,
            # 2) the event loop is being shut down.
            # In either case we do not care about the propagation of
            # the CancelledError, and don't want the loop to warn about
            # an unretrieved exception.
            pass
        except (Exception, asyncio.CancelledError) as ex:
            if not waiter.done():
                waiter.set_exception(ex)
        finally:
            self._cancellations.discard(
                asyncio.current_task(self._loop))
            if not waiter.done():
                waiter.set_result(None)

    def _cancel_current_command(self, waiter):
        self._cancellations.add(self._loop.create_task(self._cancel(waiter)))

    def _process_log_message(self, fields, last_query):
        if not self._log_listeners:
            return

        message = exceptions.PostgresLogMessage.new(fields, query=last_query)

        con_ref = self._unwrap()
        for cb in self._log_listeners:
            if cb.is_async:
                self._loop.create_task(cb.cb(con_ref, message))
            else:
                self._loop.call_soon(cb.cb, con_ref, message)

    def _call_termination_listeners(self):
        if not self._termination_listeners:
            return

        con_ref = self._unwrap()
        for cb in self._termination_listeners:
            if cb.is_async:
                self._loop.create_task(cb.cb(con_ref))
            else:
                self._loop.call_soon(cb.cb, con_ref)

        self._termination_listeners.clear()

    def _process_notification(self, pid, channel, payload):
        if channel not in self._listeners:
            return

        con_ref = self._unwrap()
        for cb in self._listeners[channel]:
            if cb.is_async:
                self._loop.create_task(cb.cb(con_ref, pid, channel, payload))
            else:
                self._loop.call_soon(cb.cb, con_ref, pid, channel, payload)

    def _unwrap(self):
        if self._proxy is None:
            con_ref = self
        else:
            # `_proxy` is not None when the connection is a member
            # of a connection pool.  Which means that the user is working
            # with a `PoolConnectionProxy` instance, and expects to see it
            # (and not the actual Connection) in their event callbacks.
            con_ref = self._proxy
        return con_ref

    def _get_reset_query(self):
        if self._reset_query is not None:
            return self._reset_query

        caps = self._server_caps

        _reset_query = []
        if caps.advisory_locks:
            _reset_query.append('SELECT pg_advisory_unlock_all();')
        if caps.sql_close_all:
            _reset_query.append('CLOSE ALL;')
        if caps.notifications and caps.plpgsql:
            _reset_query.append('UNLISTEN *;')
        if caps.sql_reset:
            _reset_query.append('RESET ALL;')

        _reset_query = '\n'.join(_reset_query)
        self._reset_query = _reset_query

        return _reset_query

    def _set_proxy(self, proxy):
        if self._proxy is not None and proxy is not None:
            # Should not happen unless there is a bug in `Pool`.
            raise exceptions.InterfaceError(
                'internal asyncpg error: connection is already proxied')

        self._proxy = proxy

    def _check_listeners(self, listeners, listener_type):
        if listeners:
            count = len(listeners)

            w = exceptions.InterfaceWarning(
                '{conn!r} is being released to the pool but has {c} active '
                '{type} listener{s}'.format(
                    conn=self, c=count, type=listener_type,
                    s='s' if count > 1 else ''))

            warnings.warn(w)

    def _on_release(self, stacklevel=1):
        # Invalidate external references to the connection.
        self._pool_release_ctr += 1
        # Called when the connection is about to be released to the pool.
        # Let's check that the user has not left any listeners on it.
        self._check_listeners(
            list(itertools.chain.from_iterable(self._listeners.values())),
            'notification')
        self._check_listeners(
            self._log_listeners, 'log')

    def _drop_local_statement_cache(self):
        self._stmt_cache.clear()

    def _drop_global_statement_cache(self):
        if self._proxy is not None:
            # This connection is a member of a pool, so we delegate
            # the cache drop to the pool.
            pool = self._proxy._holder._pool
            pool._drop_statement_cache()
        else:
            self._drop_local_statement_cache()

    def _drop_local_type_cache(self):
        self._protocol.get_settings().clear_type_cache()

    def _drop_global_type_cache(self):
        if self._proxy is not None:
            # This connection is a member of a pool, so we delegate
            # the cache drop to the pool.
            pool = self._proxy._holder._pool
            pool._drop_type_cache()
        else:
            self._drop_local_type_cache()

    async def reload_schema_state(self):
        """Indicate that the database schema information must be reloaded.

        For performance reasons, asyncpg caches certain aspects of the
        database schema, such as the layout of composite types.  Consequently,
        when the database schema changes, and asyncpg is not able to
        gracefully recover from an error caused by outdated schema
        assumptions, an :exc:`~asyncpg.exceptions.OutdatedSchemaCacheError`
        is raised.  To prevent the exception, this method may be used to inform
        asyncpg that the database schema has changed.

        Example:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> async def change_type(con):
            ...     result = await con.fetch('SELECT id, info FROM tbl')
            ...     # Change composite's attribute type "int"=>"text"
            ...     await con.execute('ALTER TYPE custom DROP ATTRIBUTE y')
            ...     await con.execute('ALTER TYPE custom ADD ATTRIBUTE y text')
            ...     await con.reload_schema_state()
            ...     for id_, info in result:
            ...         new = (info['x'], str(info['y']))
            ...         await con.execute(
            ...             'UPDATE tbl SET info=$2 WHERE id=$1', id_, new)
            ...
            >>> async def run():
            ...     # Initial schema:
            ...     # CREATE TYPE custom AS (x int, y int);
            ...     # CREATE TABLE tbl(id int, info custom);
            ...     con = await asyncpg.connect(user='postgres')
            ...     async with con.transaction():
            ...         # Prevent concurrent changes in the table
            ...         await con.execute('LOCK TABLE tbl')
            ...         await change_type(con)
            ...
            >>> asyncio.get_event_loop().run_until_complete(run())

        .. versionadded:: 0.14.0
        """
        self._drop_global_type_cache()
        self._drop_global_statement_cache()

    async def _execute(
        self,
        query,
        args,
        limit,
        timeout,
        *,
        return_status=False,
        ignore_custom_codec=False,
        record_class=None
    ):
        with self._stmt_exclusive_section:
            result, _ = await self.__execute(
                query,
                args,
                limit,
                timeout,
                return_status=return_status,
                record_class=record_class,
                ignore_custom_codec=ignore_custom_codec,
            )
        return result

    @contextlib.contextmanager
    def query_logger(self, callback):
        """Context manager that adds `callback` to the list of query loggers,
        and removes it upon exit.

        :param callable callback:
            A callable or a coroutine function receiving one argument:
            **record**: a LoggedQuery containing `query`, `args`, `timeout`,
                        `elapsed`, `exception`, `conn_addr`, and
                        `conn_params`.

        Example:

        .. code-block:: pycon

            >>> class QuerySaver:
                    def __init__(self):
                        self.queries = []
                    def __call__(self, record):
                        self.queries.append(record.query)
            >>> with con.query_logger(QuerySaver()):
            >>>     await con.execute("SELECT 1")
            >>> print(log.queries)
            ['SELECT 1']

        .. versionadded:: 0.29.0
        """
        self.add_query_logger(callback)
        yield
        self.remove_query_logger(callback)

    @contextlib.contextmanager
    def _time_and_log(self, query, args, timeout):
        start = time.monotonic()
        exception = None
        try:
            yield
        except BaseException as ex:
            exception = ex
            raise
        finally:
            elapsed = time.monotonic() - start
            record = LoggedQuery(
                query=query,
                args=args,
                timeout=timeout,
                elapsed=elapsed,
                exception=exception,
                conn_addr=self._addr,
                conn_params=self._params,
            )
            for cb in self._query_loggers:
                if cb.is_async:
                    self._loop.create_task(cb.cb(record))
                else:
                    self._loop.call_soon(cb.cb, record)

    async def __execute(
        self,
        query,
        args,
        limit,
        timeout,
        *,
        return_status=False,
        ignore_custom_codec=False,
        record_class=None
    ):
        executor = lambda stmt, timeout: self._protocol.bind_execute(
            state=stmt,
            args=args,
            portal_name='',
            limit=limit,
            return_extra=return_status,
            timeout=timeout,
        )
        timeout = self._protocol._get_timeout(timeout)
        if self._query_loggers:
            with self._time_and_log(query, args, timeout):
                result, stmt = await self._do_execute(
                    query,
                    executor,
                    timeout,
                    record_class=record_class,
                    ignore_custom_codec=ignore_custom_codec,
                )
        else:
            result, stmt = await self._do_execute(
                query,
                executor,
                timeout,
                record_class=record_class,
                ignore_custom_codec=ignore_custom_codec,
            )
        return result, stmt

    async def _executemany(self, query, args, timeout):
        executor = lambda stmt, timeout: self._protocol.bind_execute_many(
            state=stmt,
            args=args,
            portal_name='',
            timeout=timeout,
        )
        timeout = self._protocol._get_timeout(timeout)
        with self._stmt_exclusive_section:
            with self._time_and_log(query, args, timeout):
                result, _ = await self._do_execute(query, executor, timeout)
        return result

    async def _do_execute(
        self,
        query,
        executor,
        timeout,
        retry=True,
        *,
        ignore_custom_codec=False,
        record_class=None
    ):
        if timeout is None:
            stmt = await self._get_statement(
                query,
                None,
                record_class=record_class,
                ignore_custom_codec=ignore_custom_codec,
            )
        else:
            before = time.monotonic()
            stmt = await self._get_statement(
                query,
                timeout,
                record_class=record_class,
                ignore_custom_codec=ignore_custom_codec,
            )
            after = time.monotonic()
            timeout -= after - before
            before = after

        try:
            if timeout is None:
                result = await executor(stmt, None)
            else:
                try:
                    result = await executor(stmt, timeout)
                finally:
                    after = time.monotonic()
                    timeout -= after - before

        except exceptions.OutdatedSchemaCacheError:
            # This exception is raised when we detect a difference between
            # cached type's info and incoming tuple from the DB (when a type is
            # changed by the ALTER TYPE).
            # It is not possible to recover (the statement is already done at
            # the server's side), the only way is to drop our caches and
            # reraise the exception to the caller.
            await self.reload_schema_state()
            raise
        except exceptions.InvalidCachedStatementError:
            # PostgreSQL will raise an exception when it detects
            # that the result type of the query has changed from
            # when the statement was prepared.  This may happen,
            # for example, after an ALTER TABLE or SET search_path.
            #
            # When this happens, and there is no transaction running,
            # we can simply re-prepare the statement and try once
            # again.  We deliberately retry only once as this is
            # supposed to be a rare occurrence.
            #
            # If the transaction _is_ running, this error will put it
            # into an error state, and we have no choice but to
            # re-raise the exception.
            #
            # In either case we clear the statement cache for this
            # connection and all other connections of the pool this
            # connection belongs to (if any).
            #
            # See https://github.com/MagicStack/asyncpg/issues/72
            # and https://github.com/MagicStack/asyncpg/issues/76
            # for discussion.
            #
            self._drop_global_statement_cache()
            if self._protocol.is_in_transaction() or not retry:
                raise
            else:
                return await self._do_execute(
                    query, executor, timeout, retry=False)

        return result, stmt


async def connect(dsn=None, *,
                  host=None, port=None,
                  user=None, password=None, passfile=None,
                  database=None,
                  loop=None,
                  timeout=60,
                  statement_cache_size=100,
                  max_cached_statement_lifetime=300,
                  max_cacheable_statement_size=1024 * 15,
                  command_timeout=None,
                  ssl=None,
                  direct_tls=False,
                  connection_class=Connection,
                  record_class=protocol.Record,
                  server_settings=None,
                  target_session_attrs=None):
    r"""A coroutine to establish a connection to a PostgreSQL server.

    The connection parameters may be specified either as a connection
    URI in *dsn*, or as specific keyword arguments, or both.
    If both *dsn* and keyword arguments are specified, the latter
    override the corresponding values parsed from the connection URI.
    The default values for the majority of arguments can be specified
    using `environment variables <postgres envvars_>`_.

    Returns a new :class:`~asyncpg.connection.Connection` object.

    :param dsn:
        Connection arguments specified using as a single string in the
        `libpq connection URI format`_:
        ``postgres://user:password@host:port/database?option=value``.
        The following options are recognized by asyncpg: ``host``,
        ``port``, ``user``, ``database`` (or ``dbname``), ``password``,
        ``passfile``, ``sslmode``, ``sslcert``, ``sslkey``, ``sslrootcert``,
        and ``sslcrl``.  Unlike libpq, asyncpg will treat unrecognized
        options as `server settings`_ to be used for the connection.

        .. note::

           The URI must be *valid*, which means that all components must
           be properly quoted with :py:func:`urllib.parse.quote`, and
           any literal IPv6 addresses must be enclosed in square brackets.
           For example:

           .. code-block:: text

              postgres://dbuser@[fe80::1ff:fe23:4567:890a%25eth0]/dbname

    :param host:
        Database host address as one of the following:

        - an IP address or a domain name;
        - an absolute path to the directory containing the database
          server Unix-domain socket (not supported on Windows);
        - a sequence of any of the above, in which case the addresses
          will be tried in order, and the first successful connection
          will be returned.

        If not specified, asyncpg will try the following, in order:

        - host address(es) parsed from the *dsn* argument,
        - the value of the ``PGHOST`` environment variable,
        - on Unix, common directories used for PostgreSQL Unix-domain
          sockets: ``"/run/postgresql"``, ``"/var/run/postgresl"``,
          ``"/var/pgsql_socket"``, ``"/private/tmp"``, and ``"/tmp"``,
        - ``"localhost"``.

    :param port:
        Port number to connect to at the server host
        (or Unix-domain socket file extension).  If multiple host
        addresses were specified, this parameter may specify a
        sequence of port numbers of the same length as the host sequence,
        or it may specify a single port number to be used for all host
        addresses.

        If not specified, the value parsed from the *dsn* argument is used,
        or the value of the ``PGPORT`` environment variable, or ``5432`` if
        neither is specified.

    :param user:
        The name of the database role used for authentication.

        If not specified, the value parsed from the *dsn* argument is used,
        or the value of the ``PGUSER`` environment variable, or the
        operating system name of the user running the application.

    :param database:
        The name of the database to connect to.

        If not specified, the value parsed from the *dsn* argument is used,
        or the value of the ``PGDATABASE`` environment variable, or the
        computed value of the *user* argument.

    :param password:
        Password to be used for authentication, if the server requires
        one.  If not specified, the value parsed from the *dsn* argument
        is used, or the value of the ``PGPASSWORD`` environment variable.
        Note that the use of the environment variable is discouraged as
        other users and applications may be able to read it without needing
        specific privileges.  It is recommended to use *passfile* instead.

        Password may be either a string, or a callable that returns a string.
        If a callable is provided, it will be called each time a new connection
        is established.

    :param passfile:
        The name of the file used to store passwords
        (defaults to ``~/.pgpass``, or ``%APPDATA%\postgresql\pgpass.conf``
        on Windows).

    :param loop:
        An asyncio event loop instance.  If ``None``, the default
        event loop will be used.

    :param float timeout:
        Connection timeout in seconds.

    :param int statement_cache_size:
        The size of prepared statement LRU cache.  Pass ``0`` to
        disable the cache.

    :param int max_cached_statement_lifetime:
        The maximum time in seconds a prepared statement will stay
        in the cache.  Pass ``0`` to allow statements be cached
        indefinitely.

    :param int max_cacheable_statement_size:
        The maximum size of a statement that can be cached (15KiB by
        default).  Pass ``0`` to allow all statements to be cached
        regardless of their size.

    :param float command_timeout:
        The default timeout for operations on this connection
        (the default is ``None``: no timeout).

    :param ssl:
        Pass ``True`` or an `ssl.SSLContext <SSLContext_>`_ instance to
        require an SSL connection.  If ``True``, a default SSL context
        returned by `ssl.create_default_context() <create_default_context_>`_
        will be used.  The value can also be one of the following strings:

        - ``'disable'`` - SSL is disabled (equivalent to ``False``)
        - ``'prefer'`` - try SSL first, fallback to non-SSL connection
          if SSL connection fails
        - ``'allow'`` - try without SSL first, then retry with SSL if the first
          attempt fails.
        - ``'require'`` - only try an SSL connection.  Certificate
          verification errors are ignored
        - ``'verify-ca'`` - only try an SSL connection, and verify
          that the server certificate is issued by a trusted certificate
          authority (CA)
        - ``'verify-full'`` - only try an SSL connection, verify
          that the server certificate is issued by a trusted CA and
          that the requested server host name matches that in the
          certificate.

        The default is ``'prefer'``: try an SSL connection and fallback to
        non-SSL connection if that fails.

        .. note::

           *ssl* is ignored for Unix domain socket communication.

        Example of programmatic SSL context configuration that is equivalent
        to ``sslmode=verify-full&sslcert=..&sslkey=..&sslrootcert=..``:

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> import ssl
            >>> async def main():
            ...     # Load CA bundle for server certificate verification,
            ...     # equivalent to sslrootcert= in DSN.
            ...     sslctx = ssl.create_default_context(
            ...         ssl.Purpose.SERVER_AUTH,
            ...         cafile="path/to/ca_bundle.pem")
            ...     # If True, equivalent to sslmode=verify-full, if False:
            ...     # sslmode=verify-ca.
            ...     sslctx.check_hostname = True
            ...     # Load client certificate and private key for client
            ...     # authentication, equivalent to sslcert= and sslkey= in
            ...     # DSN.
            ...     sslctx.load_cert_chain(
            ...         "path/to/client.cert",
            ...         keyfile="path/to/client.key",
            ...     )
            ...     con = await asyncpg.connect(user='postgres', ssl=sslctx)
            ...     await con.close()
            >>> asyncio.run(main())

        Example of programmatic SSL context configuration that is equivalent
        to ``sslmode=require`` (no server certificate or host verification):

        .. code-block:: pycon

            >>> import asyncpg
            >>> import asyncio
            >>> import ssl
            >>> async def main():
            ...     sslctx = ssl.create_default_context(
            ...         ssl.Purpose.SERVER_AUTH)
            ...     sslctx.check_hostname = False
            ...     sslctx.verify_mode = ssl.CERT_NONE
            ...     con = await asyncpg.connect(user='postgres', ssl=sslctx)
            ...     await con.close()
            >>> asyncio.run(main())

    :param bool direct_tls:
        Pass ``True`` to skip PostgreSQL STARTTLS mode and perform a direct
        SSL connection. Must be used alongside ``ssl`` param.

    :param dict server_settings:
        An optional dict of server runtime parameters.  Refer to
        PostgreSQL documentation for
        a `list of supported options <server settings_>`_.

    :param type connection_class:
        Class of the returned connection object.  Must be a subclass of
        :class:`~asyncpg.connection.Connection`.

    :param type record_class:
        If specified, the class to use for records returned by queries on
        this connection object.  Must be a subclass of
        :class:`~asyncpg.Record`.

    :param SessionAttribute target_session_attrs:
        If specified, check that the host has the correct attribute.
        Can be one of:

        - ``"any"`` - the first successfully connected host
        - ``"primary"`` - the host must NOT be in hot standby mode
        - ``"standby"`` - the host must be in hot standby mode
        - ``"read-write"`` - the host must allow writes
        - ``"read-only"`` - the host most NOT allow writes
        - ``"prefer-standby"`` - first try to find a standby host, but if
          none of the listed hosts is a standby server,
          return any of them.

        If not specified, the value parsed from the *dsn* argument is used,
        or the value of the ``PGTARGETSESSIONATTRS`` environment variable,
        or ``"any"`` if neither is specified.

    :return: A :class:`~asyncpg.connection.Connection` instance.

    Example:

    .. code-block:: pycon

        >>> import asyncpg
        >>> import asyncio
        >>> async def run():
        ...     con = await asyncpg.connect(user='postgres')
        ...     types = await con.fetch('SELECT * FROM pg_type')
        ...     print(types)
        ...
        >>> asyncio.get_event_loop().run_until_complete(run())
        [<Record typname='bool' typnamespace=11 ...

    .. versionadded:: 0.10.0
       Added ``max_cached_statement_use_count`` parameter.

    .. versionchanged:: 0.11.0
       Removed ability to pass arbitrary keyword arguments to set
       server settings.  Added a dedicated parameter ``server_settings``
       for that.

    .. versionadded:: 0.11.0
       Added ``connection_class`` parameter.

    .. versionadded:: 0.16.0
       Added ``passfile`` parameter
       (and support for password files in general).

    .. versionadded:: 0.18.0
       Added ability to specify multiple hosts in the *dsn*
       and *host* arguments.

    .. versionchanged:: 0.21.0
       The *password* argument now accepts a callable or an async function.

    .. versionchanged:: 0.22.0
       Added the *record_class* parameter.

    .. versionchanged:: 0.22.0
       The *ssl* argument now defaults to ``'prefer'``.

    .. versionchanged:: 0.24.0
       The ``sslcert``, ``sslkey``, ``sslrootcert``, and ``sslcrl`` options
       are supported in the *dsn* argument.

    .. versionchanged:: 0.25.0
       The ``sslpassword``, ``ssl_min_protocol_version``,
       and ``ssl_max_protocol_version`` options are supported in the *dsn*
       argument.

    .. versionchanged:: 0.25.0
       Default system root CA certificates won't be loaded when specifying a
       particular sslmode, following the same behavior in libpq.

    .. versionchanged:: 0.25.0
       The ``sslcert``, ``sslkey``, ``sslrootcert``, and ``sslcrl`` options
       in the *dsn* argument now have consistent default values of files under
       ``~/.postgresql/`` as libpq.

    .. versionchanged:: 0.26.0
       Added the *direct_tls* parameter.

    .. versionchanged:: 0.28.0
       Added the *target_session_attrs* parameter.

    .. _SSLContext: https://docs.python.org/3/library/ssl.html#ssl.SSLContext
    .. _create_default_context:
        https://docs.python.org/3/library/ssl.html#ssl.create_default_context
    .. _server settings:
        https://www.postgresql.org/docs/current/static/runtime-config.html
    .. _postgres envvars:
        https://www.postgresql.org/docs/current/static/libpq-envars.html
    .. _libpq connection URI format:
        https://www.postgresql.org/docs/current/static/
        libpq-connect.html#LIBPQ-CONNSTRING
    """
    if not issubclass(connection_class, Connection):
        raise exceptions.InterfaceError(
            'connection_class is expected to be a subclass of '
            'asyncpg.Connection, got {!r}'.format(connection_class))

    if record_class is not protocol.Record:
        _check_record_class(record_class)

    if loop is None:
        loop = asyncio.get_event_loop()

    async with compat.timeout(timeout):
        return await connect_utils._connect(
            loop=loop,
            connection_class=connection_class,
            record_class=record_class,
            dsn=dsn,
            host=host,
            port=port,
            user=user,
            password=password,
            passfile=passfile,
            ssl=ssl,
            direct_tls=direct_tls,
            database=database,
            server_settings=server_settings,
            command_timeout=command_timeout,
            statement_cache_size=statement_cache_size,
            max_cached_statement_lifetime=max_cached_statement_lifetime,
            max_cacheable_statement_size=max_cacheable_statement_size,
            target_session_attrs=target_session_attrs
        )


class _StatementCacheEntry:

    __slots__ = ('_query', '_statement', '_cache', '_cleanup_cb')

    def __init__(self, cache, query, statement):
        self._cache = cache
        self._query = query
        self._statement = statement
        self._cleanup_cb = None


class _StatementCache:

    __slots__ = ('_loop', '_entries', '_max_size', '_on_remove',
                 '_max_lifetime')

    def __init__(self, *, loop, max_size, on_remove, max_lifetime):
        self._loop = loop
        self._max_size = max_size
        self._on_remove = on_remove
        self._max_lifetime = max_lifetime

        # We use an OrderedDict for LRU implementation.  Operations:
        #
        # * We use a simple `__setitem__` to push a new entry:
        #       `entries[key] = new_entry`
        #   That will push `new_entry` to the *end* of the entries dict.
        #
        # * When we have a cache hit, we call
        #       `entries.move_to_end(key, last=True)`
        #   to move the entry to the *end* of the entries dict.
        #
        # * When we need to remove entries to maintain `max_size`, we call
        #       `entries.popitem(last=False)`
        #   to remove an entry from the *beginning* of the entries dict.
        #
        # So new entries and hits are always promoted to the end of the
        # entries dict, whereas the unused one will group in the
        # beginning of it.
        self._entries = collections.OrderedDict()

    def __len__(self):
        return len(self._entries)

    def get_max_size(self):
        return self._max_size

    def set_max_size(self, new_size):
        assert new_size >= 0
        self._max_size = new_size
        self._maybe_cleanup()

    def get_max_lifetime(self):
        return self._max_lifetime

    def set_max_lifetime(self, new_lifetime):
        assert new_lifetime >= 0
        self._max_lifetime = new_lifetime
        for entry in self._entries.values():
            # For every entry cancel the existing callback
            # and setup a new one if necessary.
            self._set_entry_timeout(entry)

    def get(self, query, *, promote=True):
        if not self._max_size:
            # The cache is disabled.
            return

        entry = self._entries.get(query)  # type: _StatementCacheEntry
        if entry is None:
            return

        if entry._statement.closed:
            # Happens in unittests when we call `stmt._state.mark_closed()`
            # manually or when a prepared statement closes itself on type
            # cache error.
            self._entries.pop(query)
            self._clear_entry_callback(entry)
            return

        if promote:
            # `promote` is `False` when `get()` is called by `has()`.
            self._entries.move_to_end(query, last=True)

        return entry._statement

    def has(self, query):
        return self.get(query, promote=False) is not None

    def put(self, query, statement):
        if not self._max_size:
            # The cache is disabled.
            return

        self._entries[query] = self._new_entry(query, statement)

        # Check if the cache is bigger than max_size and trim it
        # if necessary.
        self._maybe_cleanup()

    def iter_statements(self):
        return (e._statement for e in self._entries.values())

    def clear(self):
        # Store entries for later.
        entries = tuple(self._entries.values())

        # Clear the entries dict.
        self._entries.clear()

        # Make sure that we cancel all scheduled callbacks
        # and call on_remove callback for each entry.
        for entry in entries:
            self._clear_entry_callback(entry)
            self._on_remove(entry._statement)

    def _set_entry_timeout(self, entry):
        # Clear the existing timeout.
        self._clear_entry_callback(entry)

        # Set the new timeout if it's not 0.
        if self._max_lifetime:
            entry._cleanup_cb = self._loop.call_later(
                self._max_lifetime, self._on_entry_expired, entry)

    def _new_entry(self, query, statement):
        entry = _StatementCacheEntry(self, query, statement)
        self._set_entry_timeout(entry)
        return entry

    def _on_entry_expired(self, entry):
        # `call_later` callback, called when an entry stayed longer
        # than `self._max_lifetime`.
        if self._entries.get(entry._query) is entry:
            self._entries.pop(entry._query)
            self._on_remove(entry._statement)

    def _clear_entry_callback(self, entry):
        if entry._cleanup_cb is not None:
            entry._cleanup_cb.cancel()

    def _maybe_cleanup(self):
        # Delete cache entries until the size of the cache is `max_size`.
        while len(self._entries) > self._max_size:
            old_query, old_entry = self._entries.popitem(last=False)
            self._clear_entry_callback(old_entry)

            # Let the connection know that the statement was removed
            # from the cache.
            self._on_remove(old_entry._statement)


class _Callback(typing.NamedTuple):

    cb: typing.Callable[..., None]
    is_async: bool

    @classmethod
    def from_callable(cls, cb: typing.Callable[..., None]) -> '_Callback':
        if inspect.iscoroutinefunction(cb):
            is_async = True
        elif callable(cb):
            is_async = False
        else:
            raise exceptions.InterfaceError(
                'expected a callable or an `async def` function,'
                'got {!r}'.format(cb)
            )

        return cls(cb, is_async)


class _Atomic:
    __slots__ = ('_acquired',)

    def __init__(self):
        self._acquired = 0

    def __enter__(self):
        if self._acquired:
            raise exceptions.InterfaceError(
                'cannot perform operation: another operation is in progress')
        self._acquired = 1

    def __exit__(self, t, e, tb):
        self._acquired = 0


class _ConnectionProxy:
    # Base class to enable `isinstance(Connection)` check.
    __slots__ = ()


LoggedQuery = collections.namedtuple(
    'LoggedQuery',
    ['query', 'args', 'timeout', 'elapsed', 'exception', 'conn_addr',
     'conn_params'])
LoggedQuery.__doc__ = 'Log record of an executed query.'


ServerCapabilities = collections.namedtuple(
    'ServerCapabilities',
    ['advisory_locks', 'notifications', 'plpgsql', 'sql_reset',
     'sql_close_all', 'sql_copy_from_where', 'jit'])
ServerCapabilities.__doc__ = 'PostgreSQL server capabilities.'


def _detect_server_capabilities(server_version, connection_settings):
    if hasattr(connection_settings, 'padb_revision'):
        # Amazon Redshift detected.
        advisory_locks = False
        notifications = False
        plpgsql = False
        sql_reset = True
        sql_close_all = False
        jit = False
        sql_copy_from_where = False
    elif hasattr(connection_settings, 'crdb_version'):
        # CockroachDB detected.
        advisory_locks = False
        notifications = False
        plpgsql = False
        sql_reset = False
        sql_close_all = False
        jit = False
        sql_copy_from_where = False
    elif hasattr(connection_settings, 'crate_version'):
        # CrateDB detected.
        advisory_locks = False
        notifications = False
        plpgsql = False
        sql_reset = False
        sql_close_all = False
        jit = False
        sql_copy_from_where = False
    else:
        # Standard PostgreSQL server assumed.
        advisory_locks = True
        notifications = True
        plpgsql = True
        sql_reset = True
        sql_close_all = True
        jit = server_version >= (11, 0)
        sql_copy_from_where = server_version.major >= 12

    return ServerCapabilities(
        advisory_locks=advisory_locks,
        notifications=notifications,
        plpgsql=plpgsql,
        sql_reset=sql_reset,
        sql_close_all=sql_close_all,
        sql_copy_from_where=sql_copy_from_where,
        jit=jit,
    )


def _extract_stack(limit=10):
    """Replacement for traceback.extract_stack() that only does the
    necessary work for asyncio debug mode.
    """
    frame = sys._getframe().f_back
    try:
        stack = traceback.StackSummary.extract(
            traceback.walk_stack(frame), lookup_lines=False)
    finally:
        del frame

    apg_path = asyncpg.__path__[0]
    i = 0
    while i < len(stack) and stack[i][0].startswith(apg_path):
        i += 1
    stack = stack[i:i + limit]

    stack.reverse()
    return ''.join(traceback.format_list(stack))


def _check_record_class(record_class):
    if record_class is protocol.Record:
        pass
    elif (
        isinstance(record_class, type)
        and issubclass(record_class, protocol.Record)
    ):
        if (
            record_class.__new__ is not object.__new__
            or record_class.__init__ is not object.__init__
        ):
            raise exceptions.InterfaceError(
                'record_class must not redefine __new__ or __init__'
            )
    else:
        raise exceptions.InterfaceError(
            'record_class is expected to be a subclass of '
            'asyncpg.Record, got {!r}'.format(record_class)
        )


def _weak_maybe_gc_stmt(weak_ref, stmt):
    self = weak_ref()
    if self is not None:
        self._maybe_gc_stmt(stmt)


_uid = 0
