# Copyright (C) 2016-present the asyncpg authors and contributors
# <see AUTHORS file>
#
# This module is part of asyncpg and is released under
# the Apache 2.0 License: http://www.apache.org/licenses/LICENSE-2.0


import asyncio
import functools
import inspect
import logging
import time
import warnings

from . import compat
from . import connection
from . import exceptions
from . import protocol


logger = logging.getLogger(__name__)


class PoolConnectionProxyMeta(type):

    def __new__(mcls, name, bases, dct, *, wrap=False):
        if wrap:
            for attrname in dir(connection.Connection):
                if attrname.startswith('_') or attrname in dct:
                    continue

                meth = getattr(connection.Connection, attrname)
                if not inspect.isfunction(meth):
                    continue

                wrapper = mcls._wrap_connection_method(attrname)
                wrapper = functools.update_wrapper(wrapper, meth)
                dct[attrname] = wrapper

            if '__doc__' not in dct:
                dct['__doc__'] = connection.Connection.__doc__

        return super().__new__(mcls, name, bases, dct)

    @staticmethod
    def _wrap_connection_method(meth_name):
        def call_con_method(self, *args, **kwargs):
            # This method will be owned by PoolConnectionProxy class.
            if self._con is None:
                raise exceptions.InterfaceError(
                    'cannot call Connection.{}(): '
                    'connection has been released back to the pool'.format(
                        meth_name))

            meth = getattr(self._con.__class__, meth_name)
            return meth(self._con, *args, **kwargs)

        return call_con_method


class PoolConnectionProxy(connection._ConnectionProxy,
                          metaclass=PoolConnectionProxyMeta,
                          wrap=True):

    __slots__ = ('_con', '_holder')

    def __init__(self, holder: 'PoolConnectionHolder',
                 con: connection.Connection):
        self._con = con
        self._holder = holder
        con._set_proxy(self)

    def __getattr__(self, attr):
        # Proxy all unresolved attributes to the wrapped Connection object.
        return getattr(self._con, attr)

    def _detach(self) -> connection.Connection:
        if self._con is None:
            return

        con, self._con = self._con, None
        con._set_proxy(None)
        return con

    def __repr__(self):
        if self._con is None:
            return '<{classname} [released] {id:#x}>'.format(
                classname=self.__class__.__name__, id=id(self))
        else:
            return '<{classname} {con!r} {id:#x}>'.format(
                classname=self.__class__.__name__, con=self._con, id=id(self))


class PoolConnectionHolder:

    __slots__ = ('_con', '_pool', '_loop', '_proxy',
                 '_max_queries', '_setup',
                 '_max_inactive_time', '_in_use',
                 '_inactive_callback', '_timeout',
                 '_generation')

    def __init__(self, pool, *, max_queries, setup, max_inactive_time):

        self._pool = pool
        self._con = None
        self._proxy = None

        self._max_queries = max_queries
        self._max_inactive_time = max_inactive_time
        self._setup = setup
        self._inactive_callback = None
        self._in_use = None  # type: asyncio.Future
        self._timeout = None
        self._generation = None

    def is_connected(self):
        return self._con is not None and not self._con.is_closed()

    def is_idle(self):
        return not self._in_use

    async def connect(self):
        if self._con is not None:
            raise exceptions.InternalClientError(
                'PoolConnectionHolder.connect() called while another '
                'connection already exists')

        self._con = await self._pool._get_new_connection()
        self._generation = self._pool._generation
        self._maybe_cancel_inactive_callback()
        self._setup_inactive_callback()

    async def acquire(self) -> PoolConnectionProxy:
        if self._con is None or self._con.is_closed():
            self._con = None
            await self.connect()

        elif self._generation != self._pool._generation:
            # Connections have been expired, re-connect the holder.
            self._pool._loop.create_task(
                self._con.close(timeout=self._timeout))
            self._con = None
            await self.connect()

        self._maybe_cancel_inactive_callback()

        self._proxy = proxy = PoolConnectionProxy(self, self._con)

        if self._setup is not None:
            try:
                await self._setup(proxy)
            except (Exception, asyncio.CancelledError) as ex:
                # If a user-defined `setup` function fails, we don't
                # know if the connection is safe for re-use, hence
                # we close it.  A new connection will be created
                # when `acquire` is called again.
                try:
                    # Use `close()` to close the connection gracefully.
                    # An exception in `setup` isn't necessarily caused
                    # by an IO or a protocol error.  close() will
                    # do the necessary cleanup via _release_on_close().
                    await self._con.close()
                finally:
                    raise ex

        self._in_use = self._pool._loop.create_future()

        return proxy

    async def release(self, timeout):
        if self._in_use is None:
            raise exceptions.InternalClientError(
                'PoolConnectionHolder.release() called on '
                'a free connection holder')

        if self._con.is_closed():
            # When closing, pool connections perform the necessary
            # cleanup, so we don't have to do anything else here.
            return

        self._timeout = None

        if self._con._protocol.queries_count >= self._max_queries:
            # The connection has reached its maximum utilization limit,
            # so close it.  Connection.close() will call _release().
            await self._con.close(timeout=timeout)
            return

        if self._generation != self._pool._generation:
            # The connection has expired because it belongs to
            # an older generation (Pool.expire_connections() has
            # been called.)
            await self._con.close(timeout=timeout)
            return

        try:
            budget = timeout

            if self._con._protocol._is_cancelling():
                # If the connection is in cancellation state,
                # wait for the cancellation
                started = time.monotonic()
                await compat.wait_for(
                    self._con._protocol._wait_for_cancellation(),
                    budget)
                if budget is not None:
                    budget -= time.monotonic() - started

            await self._con.reset(timeout=budget)
        except (Exception, asyncio.CancelledError) as ex:
            # If the `reset` call failed, terminate the connection.
            # A new one will be created when `acquire` is called
            # again.
            try:
                # An exception in `reset` is most likely caused by
                # an IO error, so terminate the connection.
                self._con.terminate()
            finally:
                raise ex

        # Free this connection holder and invalidate the
        # connection proxy.
        self._release()

        # Rearm the connection inactivity timer.
        self._setup_inactive_callback()

    async def wait_until_released(self):
        if self._in_use is None:
            return
        else:
            await self._in_use

    async def close(self):
        if self._con is not None:
            # Connection.close() will call _release_on_close() to
            # finish holder cleanup.
            await self._con.close()

    def terminate(self):
        if self._con is not None:
            # Connection.terminate() will call _release_on_close() to
            # finish holder cleanup.
            self._con.terminate()

    def _setup_inactive_callback(self):
        if self._inactive_callback is not None:
            raise exceptions.InternalClientError(
                'pool connection inactivity timer already exists')

        if self._max_inactive_time:
            self._inactive_callback = self._pool._loop.call_later(
                self._max_inactive_time, self._deactivate_inactive_connection)

    def _maybe_cancel_inactive_callback(self):
        if self._inactive_callback is not None:
            self._inactive_callback.cancel()
            self._inactive_callback = None

    def _deactivate_inactive_connection(self):
        if self._in_use is not None:
            raise exceptions.InternalClientError(
                'attempting to deactivate an acquired connection')

        if self._con is not None:
            # The connection is idle and not in use, so it's fine to
            # use terminate() instead of close().
            self._con.terminate()
            # Must call clear_connection, because _deactivate_connection
            # is called when the connection is *not* checked out, and
            # so terminate() above will not call the below.
            self._release_on_close()

    def _release_on_close(self):
        self._maybe_cancel_inactive_callback()
        self._release()
        self._con = None

    def _release(self):
        """Release this connection holder."""
        if self._in_use is None:
            # The holder is not checked out.
            return

        if not self._in_use.done():
            self._in_use.set_result(None)
        self._in_use = None

        # Deinitialize the connection proxy.  All subsequent
        # operations on it will fail.
        if self._proxy is not None:
            self._proxy._detach()
            self._proxy = None

        # Put ourselves back to the pool queue.
        self._pool._queue.put_nowait(self)


class Pool:
    """A connection pool.

    Connection pool can be used to manage a set of connections to the database.
    Connections are first acquired from the pool, then used, and then released
    back to the pool.  Once a connection is released, it's reset to close all
    open cursors and other resources *except* prepared statements.

    Pools are created by calling :func:`~asyncpg.pool.create_pool`.
    """

    __slots__ = (
        '_queue', '_loop', '_minsize', '_maxsize',
        '_init', '_connect_args', '_connect_kwargs',
        '_holders', '_initialized', '_initializing', '_closing',
        '_closed', '_connection_class', '_record_class', '_generation',
        '_setup', '_max_queries', '_max_inactive_connection_lifetime'
    )

    def __init__(self, *connect_args,
                 min_size,
                 max_size,
                 max_queries,
                 max_inactive_connection_lifetime,
                 setup,
                 init,
                 loop,
                 connection_class,
                 record_class,
                 **connect_kwargs):

        if len(connect_args) > 1:
            warnings.warn(
                "Passing multiple positional arguments to asyncpg.Pool "
                "constructor is deprecated and will be removed in "
                "asyncpg 0.17.0.  The non-deprecated form is "
                "asyncpg.Pool(<dsn>, **kwargs)",
                DeprecationWarning, stacklevel=2)

        if loop is None:
            loop = asyncio.get_event_loop()
        self._loop = loop

        if max_size <= 0:
            raise ValueError('max_size is expected to be greater than zero')

        if min_size < 0:
            raise ValueError(
                'min_size is expected to be greater or equal to zero')

        if min_size > max_size:
            raise ValueError('min_size is greater than max_size')

        if max_queries <= 0:
            raise ValueError('max_queries is expected to be greater than zero')

        if max_inactive_connection_lifetime < 0:
            raise ValueError(
                'max_inactive_connection_lifetime is expected to be greater '
                'or equal to zero')

        if not issubclass(connection_class, connection.Connection):
            raise TypeError(
                'connection_class is expected to be a subclass of '
                'asyncpg.Connection, got {!r}'.format(connection_class))

        if not issubclass(record_class, protocol.Record):
            raise TypeError(
                'record_class is expected to be a subclass of '
                'asyncpg.Record, got {!r}'.format(record_class))

        self._minsize = min_size
        self._maxsize = max_size

        self._holders = []
        self._initialized = False
        self._initializing = False
        self._queue = None

        self._connection_class = connection_class
        self._record_class = record_class

        self._closing = False
        self._closed = False
        self._generation = 0
        self._init = init
        self._connect_args = connect_args
        self._connect_kwargs = connect_kwargs

        self._setup = setup
        self._max_queries = max_queries
        self._max_inactive_connection_lifetime = \
            max_inactive_connection_lifetime

    async def _async__init__(self):
        if self._initialized:
            return
        if self._initializing:
            raise exceptions.InterfaceError(
                'pool is being initialized in another task')
        if self._closed:
            raise exceptions.InterfaceError('pool is closed')
        self._initializing = True
        try:
            await self._initialize()
            return self
        finally:
            self._initializing = False
            self._initialized = True

    async def _initialize(self):
        self._queue = asyncio.LifoQueue(maxsize=self._maxsize)
        for _ in range(self._maxsize):
            ch = PoolConnectionHolder(
                self,
                max_queries=self._max_queries,
                max_inactive_time=self._max_inactive_connection_lifetime,
                setup=self._setup)

            self._holders.append(ch)
            self._queue.put_nowait(ch)

        if self._minsize:
            # Since we use a LIFO queue, the first items in the queue will be
            # the last ones in `self._holders`.  We want to pre-connect the
            # first few connections in the queue, therefore we want to walk
            # `self._holders` in reverse.

            # Connect the first connection holder in the queue so that
            # any connection issues are visible early.
            first_ch = self._holders[-1]  # type: PoolConnectionHolder
            await first_ch.connect()

            if self._minsize > 1:
                connect_tasks = []
                for i, ch in enumerate(reversed(self._holders[:-1])):
                    # `minsize - 1` because we already have first_ch
                    if i >= self._minsize - 1:
                        break
                    connect_tasks.append(ch.connect())

                await asyncio.gather(*connect_tasks)

    def is_closing(self):
        """Return ``True`` if the pool is closing or is closed.

        .. versionadded:: 0.28.0
        """
        return self._closed or self._closing

    def get_size(self):
        """Return the current number of connections in this pool.

        .. versionadded:: 0.25.0
        """
        return sum(h.is_connected() for h in self._holders)

    def get_min_size(self):
        """Return the minimum number of connections in this pool.

        .. versionadded:: 0.25.0
        """
        return self._minsize

    def get_max_size(self):
        """Return the maximum allowed number of connections in this pool.

        .. versionadded:: 0.25.0
        """
        return self._maxsize

    def get_idle_size(self):
        """Return the current number of idle connections in this pool.

        .. versionadded:: 0.25.0
        """
        return sum(h.is_connected() and h.is_idle() for h in self._holders)

    def set_connect_args(self, dsn=None, **connect_kwargs):
        r"""Set the new connection arguments for this pool.

        The new connection arguments will be used for all subsequent
        new connection attempts.  Existing connections will remain until
        they expire. Use :meth:`Pool.expire_connections()
        <asyncpg.pool.Pool.expire_connections>` to expedite the connection
        expiry.

        :param str dsn:
            Connection arguments specified using as a single string in
            the following format:
            ``postgres://user:pass@host:port/database?option=value``.

        :param \*\*connect_kwargs:
            Keyword arguments for the :func:`~asyncpg.connection.connect`
            function.

        .. versionadded:: 0.16.0
        """

        self._connect_args = [dsn]
        self._connect_kwargs = connect_kwargs

    async def _get_new_connection(self):
        con = await connection.connect(
            *self._connect_args,
            loop=self._loop,
            connection_class=self._connection_class,
            record_class=self._record_class,
            **self._connect_kwargs,
        )

        if self._init is not None:
            try:
                await self._init(con)
            except (Exception, asyncio.CancelledError) as ex:
                # If a user-defined `init` function fails, we don't
                # know if the connection is safe for re-use, hence
                # we close it.  A new connection will be created
                # when `acquire` is called again.
                try:
                    # Use `close()` to close the connection gracefully.
                    # An exception in `init` isn't necessarily caused
                    # by an IO or a protocol error.  close() will
                    # do the necessary cleanup via _release_on_close().
                    await con.close()
                finally:
                    raise ex

        return con

    async def execute(self, query: str, *args, timeout: float=None) -> str:
        """Execute an SQL command (or commands).

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.execute() <asyncpg.connection.Connection.execute>`.

        .. versionadded:: 0.10.0
        """
        async with self.acquire() as con:
            return await con.execute(query, *args, timeout=timeout)

    async def executemany(self, command: str, args, *, timeout: float=None):
        """Execute an SQL *command* for each sequence of arguments in *args*.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.executemany()
        <asyncpg.connection.Connection.executemany>`.

        .. versionadded:: 0.10.0
        """
        async with self.acquire() as con:
            return await con.executemany(command, args, timeout=timeout)

    async def fetch(
        self,
        query,
        *args,
        timeout=None,
        record_class=None
    ) -> list:
        """Run a query and return the results as a list of :class:`Record`.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.fetch() <asyncpg.connection.Connection.fetch>`.

        .. versionadded:: 0.10.0
        """
        async with self.acquire() as con:
            return await con.fetch(
                query,
                *args,
                timeout=timeout,
                record_class=record_class
            )

    async def fetchval(self, query, *args, column=0, timeout=None):
        """Run a query and return a value in the first row.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.fetchval()
        <asyncpg.connection.Connection.fetchval>`.

        .. versionadded:: 0.10.0
        """
        async with self.acquire() as con:
            return await con.fetchval(
                query, *args, column=column, timeout=timeout)

    async def fetchrow(self, query, *args, timeout=None, record_class=None):
        """Run a query and return the first row.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.fetchrow() <asyncpg.connection.Connection.fetchrow>`.

        .. versionadded:: 0.10.0
        """
        async with self.acquire() as con:
            return await con.fetchrow(
                query,
                *args,
                timeout=timeout,
                record_class=record_class
            )

    async def copy_from_table(
        self,
        table_name,
        *,
        output,
        columns=None,
        schema_name=None,
        timeout=None,
        format=None,
        oids=None,
        delimiter=None,
        null=None,
        header=None,
        quote=None,
        escape=None,
        force_quote=None,
        encoding=None
    ):
        """Copy table contents to a file or file-like object.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.copy_from_table()
        <asyncpg.connection.Connection.copy_from_table>`.

        .. versionadded:: 0.24.0
        """
        async with self.acquire() as con:
            return await con.copy_from_table(
                table_name,
                output=output,
                columns=columns,
                schema_name=schema_name,
                timeout=timeout,
                format=format,
                oids=oids,
                delimiter=delimiter,
                null=null,
                header=header,
                quote=quote,
                escape=escape,
                force_quote=force_quote,
                encoding=encoding
            )

    async def copy_from_query(
        self,
        query,
        *args,
        output,
        timeout=None,
        format=None,
        oids=None,
        delimiter=None,
        null=None,
        header=None,
        quote=None,
        escape=None,
        force_quote=None,
        encoding=None
    ):
        """Copy the results of a query to a file or file-like object.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.copy_from_query()
        <asyncpg.connection.Connection.copy_from_query>`.

        .. versionadded:: 0.24.0
        """
        async with self.acquire() as con:
            return await con.copy_from_query(
                query,
                *args,
                output=output,
                timeout=timeout,
                format=format,
                oids=oids,
                delimiter=delimiter,
                null=null,
                header=header,
                quote=quote,
                escape=escape,
                force_quote=force_quote,
                encoding=encoding
            )

    async def copy_to_table(
        self,
        table_name,
        *,
        source,
        columns=None,
        schema_name=None,
        timeout=None,
        format=None,
        oids=None,
        freeze=None,
        delimiter=None,
        null=None,
        header=None,
        quote=None,
        escape=None,
        force_quote=None,
        force_not_null=None,
        force_null=None,
        encoding=None,
        where=None
    ):
        """Copy data to the specified table.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.copy_to_table()
        <asyncpg.connection.Connection.copy_to_table>`.

        .. versionadded:: 0.24.0
        """
        async with self.acquire() as con:
            return await con.copy_to_table(
                table_name,
                source=source,
                columns=columns,
                schema_name=schema_name,
                timeout=timeout,
                format=format,
                oids=oids,
                freeze=freeze,
                delimiter=delimiter,
                null=null,
                header=header,
                quote=quote,
                escape=escape,
                force_quote=force_quote,
                force_not_null=force_not_null,
                force_null=force_null,
                encoding=encoding,
                where=where
            )

    async def copy_records_to_table(
        self,
        table_name,
        *,
        records,
        columns=None,
        schema_name=None,
        timeout=None,
        where=None
    ):
        """Copy a list of records to the specified table using binary COPY.

        Pool performs this operation using one of its connections.  Other than
        that, it behaves identically to
        :meth:`Connection.copy_records_to_table()
        <asyncpg.connection.Connection.copy_records_to_table>`.

        .. versionadded:: 0.24.0
        """
        async with self.acquire() as con:
            return await con.copy_records_to_table(
                table_name,
                records=records,
                columns=columns,
                schema_name=schema_name,
                timeout=timeout,
                where=where
            )

    def acquire(self, *, timeout=None):
        """Acquire a database connection from the pool.

        :param float timeout: A timeout for acquiring a Connection.
        :return: An instance of :class:`~asyncpg.connection.Connection`.

        Can be used in an ``await`` expression or with an ``async with`` block.

        .. code-block:: python

            async with pool.acquire() as con:
                await con.execute(...)

        Or:

        .. code-block:: python

            con = await pool.acquire()
            try:
                await con.execute(...)
            finally:
                await pool.release(con)
        """
        return PoolAcquireContext(self, timeout)

    async def _acquire(self, timeout):
        async def _acquire_impl():
            ch = await self._queue.get()  # type: PoolConnectionHolder
            try:
                proxy = await ch.acquire()  # type: PoolConnectionProxy
            except (Exception, asyncio.CancelledError):
                self._queue.put_nowait(ch)
                raise
            else:
                # Record the timeout, as we will apply it by default
                # in release().
                ch._timeout = timeout
                return proxy

        if self._closing:
            raise exceptions.InterfaceError('pool is closing')
        self._check_init()

        if timeout is None:
            return await _acquire_impl()
        else:
            return await compat.wait_for(
                _acquire_impl(), timeout=timeout)

    async def release(self, connection, *, timeout=None):
        """Release a database connection back to the pool.

        :param Connection connection:
            A :class:`~asyncpg.connection.Connection` object to release.
        :param float timeout:
            A timeout for releasing the connection.  If not specified, defaults
            to the timeout provided in the corresponding call to the
            :meth:`Pool.acquire() <asyncpg.pool.Pool.acquire>` method.

        .. versionchanged:: 0.14.0
            Added the *timeout* parameter.
        """
        if (type(connection) is not PoolConnectionProxy or
                connection._holder._pool is not self):
            raise exceptions.InterfaceError(
                'Pool.release() received invalid connection: '
                '{connection!r} is not a member of this pool'.format(
                    connection=connection))

        if connection._con is None:
            # Already released, do nothing.
            return

        self._check_init()

        # Let the connection do its internal housekeeping when its released.
        connection._con._on_release()

        ch = connection._holder
        if timeout is None:
            timeout = ch._timeout

        # Use asyncio.shield() to guarantee that task cancellation
        # does not prevent the connection from being returned to the
        # pool properly.
        return await asyncio.shield(ch.release(timeout))

    async def close(self):
        """Attempt to gracefully close all connections in the pool.

        Wait until all pool connections are released, close them and
        shut down the pool.  If any error (including cancellation) occurs
        in ``close()`` the pool will terminate by calling
        :meth:`Pool.terminate() <pool.Pool.terminate>`.

        It is advisable to use :func:`python:asyncio.wait_for` to set
        a timeout.

        .. versionchanged:: 0.16.0
            ``close()`` now waits until all pool connections are released
            before closing them and the pool.  Errors raised in ``close()``
            will cause immediate pool termination.
        """
        if self._closed:
            return
        self._check_init()

        self._closing = True

        warning_callback = None
        try:
            warning_callback = self._loop.call_later(
                60, self._warn_on_long_close)

            release_coros = [
                ch.wait_until_released() for ch in self._holders]
            await asyncio.gather(*release_coros)

            close_coros = [
                ch.close() for ch in self._holders]
            await asyncio.gather(*close_coros)

        except (Exception, asyncio.CancelledError):
            self.terminate()
            raise

        finally:
            if warning_callback is not None:
                warning_callback.cancel()
            self._closed = True
            self._closing = False

    def _warn_on_long_close(self):
        logger.warning('Pool.close() is taking over 60 seconds to complete. '
                       'Check if you have any unreleased connections left. '
                       'Use asyncio.wait_for() to set a timeout for '
                       'Pool.close().')

    def terminate(self):
        """Terminate all connections in the pool."""
        if self._closed:
            return
        self._check_init()
        for ch in self._holders:
            ch.terminate()
        self._closed = True

    async def expire_connections(self):
        """Expire all currently open connections.

        Cause all currently open connections to get replaced on the
        next :meth:`~asyncpg.pool.Pool.acquire()` call.

        .. versionadded:: 0.16.0
        """
        self._generation += 1

    def _check_init(self):
        if not self._initialized:
            if self._initializing:
                raise exceptions.InterfaceError(
                    'pool is being initialized, but not yet ready: '
                    'likely there is a race between creating a pool and '
                    'using it')
            raise exceptions.InterfaceError('pool is not initialized')
        if self._closed:
            raise exceptions.InterfaceError('pool is closed')

    def _drop_statement_cache(self):
        # Drop statement cache for all connections in the pool.
        for ch in self._holders:
            if ch._con is not None:
                ch._con._drop_local_statement_cache()

    def _drop_type_cache(self):
        # Drop type codec cache for all connections in the pool.
        for ch in self._holders:
            if ch._con is not None:
                ch._con._drop_local_type_cache()

    def __await__(self):
        return self._async__init__().__await__()

    async def __aenter__(self):
        await self._async__init__()
        return self

    async def __aexit__(self, *exc):
        await self.close()


class PoolAcquireContext:

    __slots__ = ('timeout', 'connection', 'done', 'pool')

    def __init__(self, pool, timeout):
        self.pool = pool
        self.timeout = timeout
        self.connection = None
        self.done = False

    async def __aenter__(self):
        if self.connection is not None or self.done:
            raise exceptions.InterfaceError('a connection is already acquired')
        self.connection = await self.pool._acquire(self.timeout)
        return self.connection

    async def __aexit__(self, *exc):
        self.done = True
        con = self.connection
        self.connection = None
        await self.pool.release(con)

    def __await__(self):
        self.done = True
        return self.pool._acquire(self.timeout).__await__()


def create_pool(dsn=None, *,
                min_size=10,
                max_size=10,
                max_queries=50000,
                max_inactive_connection_lifetime=300.0,
                setup=None,
                init=None,
                loop=None,
                connection_class=connection.Connection,
                record_class=protocol.Record,
                **connect_kwargs):
    r"""Create a connection pool.

    Can be used either with an ``async with`` block:

    .. code-block:: python

        async with asyncpg.create_pool(user='postgres',
                                       command_timeout=60) as pool:
            await pool.fetch('SELECT 1')

    Or to perform multiple operations on a single connection:

    .. code-block:: python

        async with asyncpg.create_pool(user='postgres',
                                       command_timeout=60) as pool:
            async with pool.acquire() as con:
                await con.execute('''
                   CREATE TABLE names (
                      id serial PRIMARY KEY,
                      name VARCHAR (255) NOT NULL)
                ''')
                await con.fetch('SELECT 1')

    Or directly with ``await`` (not recommended):

    .. code-block:: python

        pool = await asyncpg.create_pool(user='postgres', command_timeout=60)
        con = await pool.acquire()
        try:
            await con.fetch('SELECT 1')
        finally:
            await pool.release(con)

    .. warning::
        Prepared statements and cursors returned by
        :meth:`Connection.prepare() <asyncpg.connection.Connection.prepare>`
        and :meth:`Connection.cursor() <asyncpg.connection.Connection.cursor>`
        become invalid once the connection is released.  Likewise, all
        notification and log listeners are removed, and ``asyncpg`` will
        issue a warning if there are any listener callbacks registered on a
        connection that is being released to the pool.

    :param str dsn:
        Connection arguments specified using as a single string in
        the following format:
        ``postgres://user:pass@host:port/database?option=value``.

    :param \*\*connect_kwargs:
        Keyword arguments for the :func:`~asyncpg.connection.connect`
        function.

    :param Connection connection_class:
        The class to use for connections.  Must be a subclass of
        :class:`~asyncpg.connection.Connection`.

    :param type record_class:
        If specified, the class to use for records returned by queries on
        the connections in this pool.  Must be a subclass of
        :class:`~asyncpg.Record`.

    :param int min_size:
        Number of connection the pool will be initialized with.

    :param int max_size:
        Max number of connections in the pool.

    :param int max_queries:
        Number of queries after a connection is closed and replaced
        with a new connection.

    :param float max_inactive_connection_lifetime:
        Number of seconds after which inactive connections in the
        pool will be closed.  Pass ``0`` to disable this mechanism.

    :param coroutine setup:
        A coroutine to prepare a connection right before it is returned
        from :meth:`Pool.acquire() <pool.Pool.acquire>`.  An example use
        case would be to automatically set up notifications listeners for
        all connections of a pool.

    :param coroutine init:
        A coroutine to initialize a connection when it is created.
        An example use case would be to setup type codecs with
        :meth:`Connection.set_builtin_type_codec() <\
        asyncpg.connection.Connection.set_builtin_type_codec>`
        or :meth:`Connection.set_type_codec() <\
        asyncpg.connection.Connection.set_type_codec>`.

    :param loop:
        An asyncio event loop instance.  If ``None``, the default
        event loop will be used.

    :return: An instance of :class:`~asyncpg.pool.Pool`.

    .. versionchanged:: 0.10.0
       An :exc:`~asyncpg.exceptions.InterfaceError` will be raised on any
       attempted operation on a released connection.

    .. versionchanged:: 0.13.0
       An :exc:`~asyncpg.exceptions.InterfaceError` will be raised on any
       attempted operation on a prepared statement or a cursor created
       on a connection that has been released to the pool.

    .. versionchanged:: 0.13.0
       An :exc:`~asyncpg.exceptions.InterfaceWarning` will be produced
       if there are any active listeners (added via
       :meth:`Connection.add_listener()
       <asyncpg.connection.Connection.add_listener>`
       or :meth:`Connection.add_log_listener()
       <asyncpg.connection.Connection.add_log_listener>`) present on the
       connection at the moment of its release to the pool.

    .. versionchanged:: 0.22.0
       Added the *record_class* parameter.
    """
    return Pool(
        dsn,
        connection_class=connection_class,
        record_class=record_class,
        min_size=min_size, max_size=max_size,
        max_queries=max_queries, loop=loop, setup=setup, init=init,
        max_inactive_connection_lifetime=max_inactive_connection_lifetime,
        **connect_kwargs)
