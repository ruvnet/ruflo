# ext/asyncio/engine.py
# Copyright (C) 2020-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

import asyncio
import contextlib
from typing import Any
from typing import AsyncIterator
from typing import Callable
from typing import Dict
from typing import Generator
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import exc as async_exc
from .base import asyncstartablecontext
from .base import GeneratorStartableContext
from .base import ProxyComparable
from .base import StartableContext
from .result import _ensure_sync_result
from .result import AsyncResult
from .result import AsyncScalarResult
from ... import exc
from ... import inspection
from ... import util
from ...engine import Connection
from ...engine import create_engine as _create_engine
from ...engine import create_pool_from_url as _create_pool_from_url
from ...engine import Engine
from ...engine.base import NestedTransaction
from ...engine.base import Transaction
from ...exc import ArgumentError
from ...util.concurrency import greenlet_spawn

if TYPE_CHECKING:
    from ...engine.cursor import CursorResult
    from ...engine.interfaces import _CoreAnyExecuteParams
    from ...engine.interfaces import _CoreSingleExecuteParams
    from ...engine.interfaces import _DBAPIAnyExecuteParams
    from ...engine.interfaces import _ExecuteOptions
    from ...engine.interfaces import CompiledCacheType
    from ...engine.interfaces import CoreExecuteOptionsParameter
    from ...engine.interfaces import Dialect
    from ...engine.interfaces import IsolationLevel
    from ...engine.interfaces import SchemaTranslateMapType
    from ...engine.result import ScalarResult
    from ...engine.url import URL
    from ...pool import Pool
    from ...pool import PoolProxiedConnection
    from ...sql._typing import _InfoType
    from ...sql.base import Executable
    from ...sql.selectable import TypedReturnsRows

_T = TypeVar("_T", bound=Any)


def create_async_engine(url: Union[str, URL], **kw: Any) -> AsyncEngine:
    """Create a new async engine instance.

    Arguments passed to :func:`_asyncio.create_async_engine` are mostly
    identical to those passed to the :func:`_sa.create_engine` function.
    The specified dialect must be an asyncio-compatible dialect
    such as :ref:`dialect-postgresql-asyncpg`.

    .. versionadded:: 1.4

    :param async_creator: an async callable which returns a driver-level
        asyncio connection. If given, the function should take no arguments,
        and return a new asyncio connection from the underlying asyncio
        database driver; the connection will be wrapped in the appropriate
        structures to be used with the :class:`.AsyncEngine`.   Note that the
        parameters specified in the URL are not applied here, and the creator
        function should use its own connection parameters.

        This parameter is the asyncio equivalent of the
        :paramref:`_sa.create_engine.creator` parameter of the
        :func:`_sa.create_engine` function.

        .. versionadded:: 2.0.16

    """

    if kw.get("server_side_cursors", False):
        raise async_exc.AsyncMethodRequired(
            "Can't set server_side_cursors for async engine globally; "
            "use the connection.stream() method for an async "
            "streaming result set"
        )
    kw["_is_async"] = True
    async_creator = kw.pop("async_creator", None)
    if async_creator:
        if kw.get("creator", None):
            raise ArgumentError(
                "Can only specify one of 'async_creator' or 'creator', "
                "not both."
            )

        def creator() -> Any:
            # note that to send adapted arguments like
            # prepared_statement_cache_size, user would use
            # "creator" and emulate this form here
            return sync_engine.dialect.dbapi.connect(  # type: ignore
                async_creator_fn=async_creator
            )

        kw["creator"] = creator
    sync_engine = _create_engine(url, **kw)
    return AsyncEngine(sync_engine)


def async_engine_from_config(
    configuration: Dict[str, Any], prefix: str = "sqlalchemy.", **kwargs: Any
) -> AsyncEngine:
    """Create a new AsyncEngine instance using a configuration dictionary.

    This function is analogous to the :func:`_sa.engine_from_config` function
    in SQLAlchemy Core, except that the requested dialect must be an
    asyncio-compatible dialect such as :ref:`dialect-postgresql-asyncpg`.
    The argument signature of the function is identical to that
    of :func:`_sa.engine_from_config`.

    .. versionadded:: 1.4.29

    """
    options = {
        key[len(prefix) :]: value
        for key, value in configuration.items()
        if key.startswith(prefix)
    }
    options["_coerce_config"] = True
    options.update(kwargs)
    url = options.pop("url")
    return create_async_engine(url, **options)


def create_async_pool_from_url(url: Union[str, URL], **kwargs: Any) -> Pool:
    """Create a new async engine instance.

    Arguments passed to :func:`_asyncio.create_async_pool_from_url` are mostly
    identical to those passed to the :func:`_sa.create_pool_from_url` function.
    The specified dialect must be an asyncio-compatible dialect
    such as :ref:`dialect-postgresql-asyncpg`.

    .. versionadded:: 2.0.10

    """
    kwargs["_is_async"] = True
    return _create_pool_from_url(url, **kwargs)


class AsyncConnectable:
    __slots__ = "_slots_dispatch", "__weakref__"

    @classmethod
    def _no_async_engine_events(cls) -> NoReturn:
        raise NotImplementedError(
            "asynchronous events are not implemented at this time.  Apply "
            "synchronous listeners to the AsyncEngine.sync_engine or "
            "AsyncConnection.sync_connection attributes."
        )


@util.create_proxy_methods(
    Connection,
    ":class:`_engine.Connection`",
    ":class:`_asyncio.AsyncConnection`",
    classmethods=[],
    methods=[],
    attributes=[
        "closed",
        "invalidated",
        "dialect",
        "default_isolation_level",
    ],
)
class AsyncConnection(
    ProxyComparable[Connection],
    StartableContext["AsyncConnection"],
    AsyncConnectable,
):
    """An asyncio proxy for a :class:`_engine.Connection`.

    :class:`_asyncio.AsyncConnection` is acquired using the
    :meth:`_asyncio.AsyncEngine.connect`
    method of :class:`_asyncio.AsyncEngine`::

        from sqlalchemy.ext.asyncio import create_async_engine
        engine = create_async_engine("postgresql+asyncpg://user:pass@host/dbname")

        async with engine.connect() as conn:
            result = await conn.execute(select(table))

    .. versionadded:: 1.4

    """  # noqa

    # AsyncConnection is a thin proxy; no state should be added here
    # that is not retrievable from the "sync" engine / connection, e.g.
    # current transaction, info, etc.   It should be possible to
    # create a new AsyncConnection that matches this one given only the
    # "sync" elements.
    __slots__ = (
        "engine",
        "sync_engine",
        "sync_connection",
    )

    def __init__(
        self,
        async_engine: AsyncEngine,
        sync_connection: Optional[Connection] = None,
    ):
        self.engine = async_engine
        self.sync_engine = async_engine.sync_engine
        self.sync_connection = self._assign_proxied(sync_connection)

    sync_connection: Optional[Connection]
    """Reference to the sync-style :class:`_engine.Connection` this
    :class:`_asyncio.AsyncConnection` proxies requests towards.

    This instance can be used as an event target.

    .. seealso::

        :ref:`asyncio_events`

    """

    sync_engine: Engine
    """Reference to the sync-style :class:`_engine.Engine` this
    :class:`_asyncio.AsyncConnection` is associated with via its underlying
    :class:`_engine.Connection`.

    This instance can be used as an event target.

    .. seealso::

        :ref:`asyncio_events`

    """

    @classmethod
    def _regenerate_proxy_for_target(
        cls, target: Connection
    ) -> AsyncConnection:
        return AsyncConnection(
            AsyncEngine._retrieve_proxy_for_target(target.engine), target
        )

    async def start(
        self, is_ctxmanager: bool = False  # noqa: U100
    ) -> AsyncConnection:
        """Start this :class:`_asyncio.AsyncConnection` object's context
        outside of using a Python ``with:`` block.

        """
        if self.sync_connection:
            raise exc.InvalidRequestError("connection is already started")
        self.sync_connection = self._assign_proxied(
            await greenlet_spawn(self.sync_engine.connect)
        )
        return self

    @property
    def connection(self) -> NoReturn:
        """Not implemented for async; call
        :meth:`_asyncio.AsyncConnection.get_raw_connection`.
        """
        raise exc.InvalidRequestError(
            "AsyncConnection.connection accessor is not implemented as the "
            "attribute may need to reconnect on an invalidated connection.  "
            "Use the get_raw_connection() method."
        )

    async def get_raw_connection(self) -> PoolProxiedConnection:
        """Return the pooled DBAPI-level connection in use by this
        :class:`_asyncio.AsyncConnection`.

        This is a SQLAlchemy connection-pool proxied connection
        which then has the attribute
        :attr:`_pool._ConnectionFairy.driver_connection` that refers to the
        actual driver connection. Its
        :attr:`_pool._ConnectionFairy.dbapi_connection` refers instead
        to an :class:`_engine.AdaptedConnection` instance that
        adapts the driver connection to the DBAPI protocol.

        """

        return await greenlet_spawn(getattr, self._proxied, "connection")

    @util.ro_non_memoized_property
    def info(self) -> _InfoType:
        """Return the :attr:`_engine.Connection.info` dictionary of the
        underlying :class:`_engine.Connection`.

        This dictionary is freely writable for user-defined state to be
        associated with the database connection.

        This attribute is only available if the :class:`.AsyncConnection` is
        currently connected.   If the :attr:`.AsyncConnection.closed` attribute
        is ``True``, then accessing this attribute will raise
        :class:`.ResourceClosedError`.

        .. versionadded:: 1.4.0b2

        """
        return self._proxied.info

    @util.ro_non_memoized_property
    def _proxied(self) -> Connection:
        if not self.sync_connection:
            self._raise_for_not_started()
        return self.sync_connection

    def begin(self) -> AsyncTransaction:
        """Begin a transaction prior to autobegin occurring."""
        assert self._proxied
        return AsyncTransaction(self)

    def begin_nested(self) -> AsyncTransaction:
        """Begin a nested transaction and return a transaction handle."""
        assert self._proxied
        return AsyncTransaction(self, nested=True)

    async def invalidate(
        self, exception: Optional[BaseException] = None
    ) -> None:
        """Invalidate the underlying DBAPI connection associated with
        this :class:`_engine.Connection`.

        See the method :meth:`_engine.Connection.invalidate` for full
        detail on this method.

        """

        return await greenlet_spawn(
            self._proxied.invalidate, exception=exception
        )

    async def get_isolation_level(self) -> IsolationLevel:
        return await greenlet_spawn(self._proxied.get_isolation_level)

    def in_transaction(self) -> bool:
        """Return True if a transaction is in progress."""

        return self._proxied.in_transaction()

    def in_nested_transaction(self) -> bool:
        """Return True if a transaction is in progress.

        .. versionadded:: 1.4.0b2

        """
        return self._proxied.in_nested_transaction()

    def get_transaction(self) -> Optional[AsyncTransaction]:
        """Return an :class:`.AsyncTransaction` representing the current
        transaction, if any.

        This makes use of the underlying synchronous connection's
        :meth:`_engine.Connection.get_transaction` method to get the current
        :class:`_engine.Transaction`, which is then proxied in a new
        :class:`.AsyncTransaction` object.

        .. versionadded:: 1.4.0b2

        """

        trans = self._proxied.get_transaction()
        if trans is not None:
            return AsyncTransaction._retrieve_proxy_for_target(trans)
        else:
            return None

    def get_nested_transaction(self) -> Optional[AsyncTransaction]:
        """Return an :class:`.AsyncTransaction` representing the current
        nested (savepoint) transaction, if any.

        This makes use of the underlying synchronous connection's
        :meth:`_engine.Connection.get_nested_transaction` method to get the
        current :class:`_engine.Transaction`, which is then proxied in a new
        :class:`.AsyncTransaction` object.

        .. versionadded:: 1.4.0b2

        """

        trans = self._proxied.get_nested_transaction()
        if trans is not None:
            return AsyncTransaction._retrieve_proxy_for_target(trans)
        else:
            return None

    @overload
    async def execution_options(
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
    ) -> AsyncConnection:
        ...

    @overload
    async def execution_options(self, **opt: Any) -> AsyncConnection:
        ...

    async def execution_options(self, **opt: Any) -> AsyncConnection:
        r"""Set non-SQL options for the connection which take effect
        during execution.

        This returns this :class:`_asyncio.AsyncConnection` object with
        the new options added.

        See :meth:`_engine.Connection.execution_options` for full details
        on this method.

        """

        conn = self._proxied
        c2 = await greenlet_spawn(conn.execution_options, **opt)
        assert c2 is conn
        return self

    async def commit(self) -> None:
        """Commit the transaction that is currently in progress.

        This method commits the current transaction if one has been started.
        If no transaction was started, the method has no effect, assuming
        the connection is in a non-invalidated state.

        A transaction is begun on a :class:`_engine.Connection` automatically
        whenever a statement is first executed, or when the
        :meth:`_engine.Connection.begin` method is called.

        """
        await greenlet_spawn(self._proxied.commit)

    async def rollback(self) -> None:
        """Roll back the transaction that is currently in progress.

        This method rolls back the current transaction if one has been started.
        If no transaction was started, the method has no effect.  If a
        transaction was started and the connection is in an invalidated state,
        the transaction is cleared using this method.

        A transaction is begun on a :class:`_engine.Connection` automatically
        whenever a statement is first executed, or when the
        :meth:`_engine.Connection.begin` method is called.


        """
        await greenlet_spawn(self._proxied.rollback)

    async def close(self) -> None:
        """Close this :class:`_asyncio.AsyncConnection`.

        This has the effect of also rolling back the transaction if one
        is in place.

        """
        await greenlet_spawn(self._proxied.close)

    async def aclose(self) -> None:
        """A synonym for :meth:`_asyncio.AsyncConnection.close`.

        The :meth:`_asyncio.AsyncConnection.aclose` name is specifically
        to support the Python standard library ``@contextlib.aclosing``
        context manager function.

        .. versionadded:: 2.0.20

        """
        await self.close()

    async def exec_driver_sql(
        self,
        statement: str,
        parameters: Optional[_DBAPIAnyExecuteParams] = None,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[Any]:
        r"""Executes a driver-level SQL string and return buffered
        :class:`_engine.Result`.

        """

        result = await greenlet_spawn(
            self._proxied.exec_driver_sql,
            statement,
            parameters,
            execution_options,
            _require_await=True,
        )

        return await _ensure_sync_result(result, self.exec_driver_sql)

    @overload
    def stream(
        self,
        statement: TypedReturnsRows[_T],
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> GeneratorStartableContext[AsyncResult[_T]]:
        ...

    @overload
    def stream(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> GeneratorStartableContext[AsyncResult[Any]]:
        ...

    @asyncstartablecontext
    async def stream(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> AsyncIterator[AsyncResult[Any]]:
        """Execute a statement and return an awaitable yielding a
        :class:`_asyncio.AsyncResult` object.

        E.g.::

            result = await conn.stream(stmt):
            async for row in result:
                print(f"{row}")

        The :meth:`.AsyncConnection.stream`
        method supports optional context manager use against the
        :class:`.AsyncResult` object, as in::

            async with conn.stream(stmt) as result:
                async for row in result:
                    print(f"{row}")

        In the above pattern, the :meth:`.AsyncResult.close` method is
        invoked unconditionally, even if the iterator is interrupted by an
        exception throw.   Context manager use remains optional, however,
        and the function may be called in either an ``async with fn():`` or
        ``await fn()`` style.

        .. versionadded:: 2.0.0b3 added context manager support


        :return: an awaitable object that will yield an
         :class:`_asyncio.AsyncResult` object.

        .. seealso::

            :meth:`.AsyncConnection.stream_scalars`

        """
        if not self.dialect.supports_server_side_cursors:
            raise exc.InvalidRequestError(
                "Cant use `stream` or `stream_scalars` with the current "
                "dialect since it does not support server side cursors."
            )

        result = await greenlet_spawn(
            self._proxied.execute,
            statement,
            parameters,
            execution_options=util.EMPTY_DICT.merge_with(
                execution_options, {"stream_results": True}
            ),
            _require_await=True,
        )
        assert result.context._is_server_side
        ar = AsyncResult(result)
        try:
            yield ar
        except GeneratorExit:
            pass
        else:
            task = asyncio.create_task(ar.close())
            await asyncio.shield(task)

    @overload
    async def execute(
        self,
        statement: TypedReturnsRows[_T],
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[_T]:
        ...

    @overload
    async def execute(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[Any]:
        ...

    async def execute(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> CursorResult[Any]:
        r"""Executes a SQL statement construct and return a buffered
        :class:`_engine.Result`.

        :param object: The statement to be executed.  This is always
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
        result = await greenlet_spawn(
            self._proxied.execute,
            statement,
            parameters,
            execution_options=execution_options,
            _require_await=True,
        )
        return await _ensure_sync_result(result, self.execute)

    @overload
    async def scalar(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> Optional[_T]:
        ...

    @overload
    async def scalar(
        self,
        statement: Executable,
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> Any:
        ...

    async def scalar(
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
        result = await self.execute(
            statement, parameters, execution_options=execution_options
        )
        return result.scalar()

    @overload
    async def scalars(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> ScalarResult[_T]:
        ...

    @overload
    async def scalars(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> ScalarResult[Any]:
        ...

    async def scalars(
        self,
        statement: Executable,
        parameters: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> ScalarResult[Any]:
        r"""Executes a SQL statement construct and returns a scalar objects.

        This method is shorthand for invoking the
        :meth:`_engine.Result.scalars` method after invoking the
        :meth:`_engine.Connection.execute` method.  Parameters are equivalent.

        :return: a :class:`_engine.ScalarResult` object.

        .. versionadded:: 1.4.24

        """
        result = await self.execute(
            statement, parameters, execution_options=execution_options
        )
        return result.scalars()

    @overload
    def stream_scalars(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> GeneratorStartableContext[AsyncScalarResult[_T]]:
        ...

    @overload
    def stream_scalars(
        self,
        statement: Executable,
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> GeneratorStartableContext[AsyncScalarResult[Any]]:
        ...

    @asyncstartablecontext
    async def stream_scalars(
        self,
        statement: Executable,
        parameters: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> AsyncIterator[AsyncScalarResult[Any]]:
        r"""Execute a statement and return an awaitable yielding a
        :class:`_asyncio.AsyncScalarResult` object.

        E.g.::

            result = await conn.stream_scalars(stmt)
            async for scalar in result:
                print(f"{scalar}")

        This method is shorthand for invoking the
        :meth:`_engine.AsyncResult.scalars` method after invoking the
        :meth:`_engine.Connection.stream` method.  Parameters are equivalent.

        The :meth:`.AsyncConnection.stream_scalars`
        method supports optional context manager use against the
        :class:`.AsyncScalarResult` object, as in::

            async with conn.stream_scalars(stmt) as result:
                async for scalar in result:
                    print(f"{scalar}")

        In the above pattern, the :meth:`.AsyncScalarResult.close` method is
        invoked unconditionally, even if the iterator is interrupted by an
        exception throw.  Context manager use remains optional, however,
        and the function may be called in either an ``async with fn():`` or
        ``await fn()`` style.

        .. versionadded:: 2.0.0b3 added context manager support

        :return: an awaitable object that will yield an
         :class:`_asyncio.AsyncScalarResult` object.

        .. versionadded:: 1.4.24

        .. seealso::

            :meth:`.AsyncConnection.stream`

        """

        async with self.stream(
            statement, parameters, execution_options=execution_options
        ) as result:
            yield result.scalars()

    async def run_sync(
        self, fn: Callable[..., _T], *arg: Any, **kw: Any
    ) -> _T:
        """Invoke the given synchronous (i.e. not async) callable,
        passing a synchronous-style :class:`_engine.Connection` as the first
        argument.

        This method allows traditional synchronous SQLAlchemy functions to
        run within the context of an asyncio application.

        E.g.::

            def do_something_with_core(conn: Connection, arg1: int, arg2: str) -> str:
                '''A synchronous function that does not require awaiting

                :param conn: a Core SQLAlchemy Connection, used synchronously

                :return: an optional return value is supported

                '''
                conn.execute(
                    some_table.insert().values(int_col=arg1, str_col=arg2)
                )
                return "success"


            async def do_something_async(async_engine: AsyncEngine) -> None:
                '''an async function that uses awaiting'''

                async with async_engine.begin() as async_conn:
                    # run do_something_with_core() with a sync-style
                    # Connection, proxied into an awaitable
                    return_code = await async_conn.run_sync(do_something_with_core, 5, "strval")
                    print(return_code)

        This method maintains the asyncio event loop all the way through
        to the database connection by running the given callable in a
        specially instrumented greenlet.

        The most rudimentary use of :meth:`.AsyncConnection.run_sync` is to
        invoke methods such as :meth:`_schema.MetaData.create_all`, given
        an :class:`.AsyncConnection` that needs to be provided to
        :meth:`_schema.MetaData.create_all` as a :class:`_engine.Connection`
        object::

            # run metadata.create_all(conn) with a sync-style Connection,
            # proxied into an awaitable
            with async_engine.begin() as conn:
                await conn.run_sync(metadata.create_all)

        .. note::

            The provided callable is invoked inline within the asyncio event
            loop, and will block on traditional IO calls.  IO within this
            callable should only call into SQLAlchemy's asyncio database
            APIs which will be properly adapted to the greenlet context.

        .. seealso::

            :meth:`.AsyncSession.run_sync`

            :ref:`session_run_sync`

        """  # noqa: E501

        return await greenlet_spawn(fn, self._proxied, *arg, **kw)

    def __await__(self) -> Generator[Any, None, AsyncConnection]:
        return self.start().__await__()

    async def __aexit__(self, type_: Any, value: Any, traceback: Any) -> None:
        task = asyncio.create_task(self.close())
        await asyncio.shield(task)

    # START PROXY METHODS AsyncConnection

    # code within this block is **programmatically,
    # statically generated** by tools/generate_proxy_methods.py

    @property
    def closed(self) -> Any:
        r"""Return True if this connection is closed.

        .. container:: class_bases

            Proxied for the :class:`_engine.Connection` class
            on behalf of the :class:`_asyncio.AsyncConnection` class.

        """  # noqa: E501

        return self._proxied.closed

    @property
    def invalidated(self) -> Any:
        r"""Return True if this connection was invalidated.

        .. container:: class_bases

            Proxied for the :class:`_engine.Connection` class
            on behalf of the :class:`_asyncio.AsyncConnection` class.

        This does not indicate whether or not the connection was
        invalidated at the pool level, however


        """  # noqa: E501

        return self._proxied.invalidated

    @property
    def dialect(self) -> Any:
        r"""Proxy for the :attr:`_engine.Connection.dialect` attribute
        on behalf of the :class:`_asyncio.AsyncConnection` class.

        """  # noqa: E501

        return self._proxied.dialect

    @dialect.setter
    def dialect(self, attr: Any) -> None:
        self._proxied.dialect = attr

    @property
    def default_isolation_level(self) -> Any:
        r"""The initial-connection time isolation level associated with the
        :class:`_engine.Dialect` in use.

        .. container:: class_bases

            Proxied for the :class:`_engine.Connection` class
            on behalf of the :class:`_asyncio.AsyncConnection` class.

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


        """  # noqa: E501

        return self._proxied.default_isolation_level

    # END PROXY METHODS AsyncConnection


@util.create_proxy_methods(
    Engine,
    ":class:`_engine.Engine`",
    ":class:`_asyncio.AsyncEngine`",
    classmethods=[],
    methods=[
        "clear_compiled_cache",
        "update_execution_options",
        "get_execution_options",
    ],
    attributes=["url", "pool", "dialect", "engine", "name", "driver", "echo"],
)
class AsyncEngine(ProxyComparable[Engine], AsyncConnectable):
    """An asyncio proxy for a :class:`_engine.Engine`.

    :class:`_asyncio.AsyncEngine` is acquired using the
    :func:`_asyncio.create_async_engine` function::

        from sqlalchemy.ext.asyncio import create_async_engine
        engine = create_async_engine("postgresql+asyncpg://user:pass@host/dbname")

    .. versionadded:: 1.4

    """  # noqa

    # AsyncEngine is a thin proxy; no state should be added here
    # that is not retrievable from the "sync" engine / connection, e.g.
    # current transaction, info, etc.   It should be possible to
    # create a new AsyncEngine that matches this one given only the
    # "sync" elements.
    __slots__ = "sync_engine"

    _connection_cls: Type[AsyncConnection] = AsyncConnection

    sync_engine: Engine
    """Reference to the sync-style :class:`_engine.Engine` this
    :class:`_asyncio.AsyncEngine` proxies requests towards.

    This instance can be used as an event target.

    .. seealso::

        :ref:`asyncio_events`
    """

    def __init__(self, sync_engine: Engine):
        if not sync_engine.dialect.is_async:
            raise exc.InvalidRequestError(
                "The asyncio extension requires an async driver to be used. "
                f"The loaded {sync_engine.dialect.driver!r} is not async."
            )
        self.sync_engine = self._assign_proxied(sync_engine)

    @util.ro_non_memoized_property
    def _proxied(self) -> Engine:
        return self.sync_engine

    @classmethod
    def _regenerate_proxy_for_target(cls, target: Engine) -> AsyncEngine:
        return AsyncEngine(target)

    @contextlib.asynccontextmanager
    async def begin(self) -> AsyncIterator[AsyncConnection]:
        """Return a context manager which when entered will deliver an
        :class:`_asyncio.AsyncConnection` with an
        :class:`_asyncio.AsyncTransaction` established.

        E.g.::

            async with async_engine.begin() as conn:
                await conn.execute(
                    text("insert into table (x, y, z) values (1, 2, 3)")
                )
                await conn.execute(text("my_special_procedure(5)"))


        """
        conn = self.connect()

        async with conn:
            async with conn.begin():
                yield conn

    def connect(self) -> AsyncConnection:
        """Return an :class:`_asyncio.AsyncConnection` object.

        The :class:`_asyncio.AsyncConnection` will procure a database
        connection from the underlying connection pool when it is entered
        as an async context manager::

            async with async_engine.connect() as conn:
                result = await conn.execute(select(user_table))

        The :class:`_asyncio.AsyncConnection` may also be started outside of a
        context manager by invoking its :meth:`_asyncio.AsyncConnection.start`
        method.

        """

        return self._connection_cls(self)

    async def raw_connection(self) -> PoolProxiedConnection:
        """Return a "raw" DBAPI connection from the connection pool.

        .. seealso::

            :ref:`dbapi_connections`

        """
        return await greenlet_spawn(self.sync_engine.raw_connection)

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
    ) -> AsyncEngine:
        ...

    @overload
    def execution_options(self, **opt: Any) -> AsyncEngine:
        ...

    def execution_options(self, **opt: Any) -> AsyncEngine:
        """Return a new :class:`_asyncio.AsyncEngine` that will provide
        :class:`_asyncio.AsyncConnection` objects with the given execution
        options.

        Proxied from :meth:`_engine.Engine.execution_options`.  See that
        method for details.

        """

        return AsyncEngine(self.sync_engine.execution_options(**opt))

    async def dispose(self, close: bool = True) -> None:
        """Dispose of the connection pool used by this
        :class:`_asyncio.AsyncEngine`.

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

        .. seealso::

            :meth:`_engine.Engine.dispose`

        """

        await greenlet_spawn(self.sync_engine.dispose, close=close)

    # START PROXY METHODS AsyncEngine

    # code within this block is **programmatically,
    # statically generated** by tools/generate_proxy_methods.py

    def clear_compiled_cache(self) -> None:
        r"""Clear the compiled cache associated with the dialect.

        .. container:: class_bases

            Proxied for the :class:`_engine.Engine` class on
            behalf of the :class:`_asyncio.AsyncEngine` class.

        This applies **only** to the built-in cache that is established
        via the :paramref:`_engine.create_engine.query_cache_size` parameter.
        It will not impact any dictionary caches that were passed via the
        :paramref:`.Connection.execution_options.query_cache` parameter.

        .. versionadded:: 1.4


        """  # noqa: E501

        return self._proxied.clear_compiled_cache()

    def update_execution_options(self, **opt: Any) -> None:
        r"""Update the default execution_options dictionary
        of this :class:`_engine.Engine`.

        .. container:: class_bases

            Proxied for the :class:`_engine.Engine` class on
            behalf of the :class:`_asyncio.AsyncEngine` class.

        The given keys/values in \**opt are added to the
        default execution options that will be used for
        all connections.  The initial contents of this dictionary
        can be sent via the ``execution_options`` parameter
        to :func:`_sa.create_engine`.

        .. seealso::

            :meth:`_engine.Connection.execution_options`

            :meth:`_engine.Engine.execution_options`


        """  # noqa: E501

        return self._proxied.update_execution_options(**opt)

    def get_execution_options(self) -> _ExecuteOptions:
        r"""Get the non-SQL options which will take effect during execution.

        .. container:: class_bases

            Proxied for the :class:`_engine.Engine` class on
            behalf of the :class:`_asyncio.AsyncEngine` class.

        .. versionadded: 1.3

        .. seealso::

            :meth:`_engine.Engine.execution_options`

        """  # noqa: E501

        return self._proxied.get_execution_options()

    @property
    def url(self) -> URL:
        r"""Proxy for the :attr:`_engine.Engine.url` attribute
        on behalf of the :class:`_asyncio.AsyncEngine` class.

        """  # noqa: E501

        return self._proxied.url

    @url.setter
    def url(self, attr: URL) -> None:
        self._proxied.url = attr

    @property
    def pool(self) -> Pool:
        r"""Proxy for the :attr:`_engine.Engine.pool` attribute
        on behalf of the :class:`_asyncio.AsyncEngine` class.

        """  # noqa: E501

        return self._proxied.pool

    @pool.setter
    def pool(self, attr: Pool) -> None:
        self._proxied.pool = attr

    @property
    def dialect(self) -> Dialect:
        r"""Proxy for the :attr:`_engine.Engine.dialect` attribute
        on behalf of the :class:`_asyncio.AsyncEngine` class.

        """  # noqa: E501

        return self._proxied.dialect

    @dialect.setter
    def dialect(self, attr: Dialect) -> None:
        self._proxied.dialect = attr

    @property
    def engine(self) -> Any:
        r"""Returns this :class:`.Engine`.

        .. container:: class_bases

            Proxied for the :class:`_engine.Engine` class
            on behalf of the :class:`_asyncio.AsyncEngine` class.

        Used for legacy schemes that accept :class:`.Connection` /
        :class:`.Engine` objects within the same variable.


        """  # noqa: E501

        return self._proxied.engine

    @property
    def name(self) -> Any:
        r"""String name of the :class:`~sqlalchemy.engine.interfaces.Dialect`
        in use by this :class:`Engine`.

        .. container:: class_bases

            Proxied for the :class:`_engine.Engine` class
            on behalf of the :class:`_asyncio.AsyncEngine` class.


        """  # noqa: E501

        return self._proxied.name

    @property
    def driver(self) -> Any:
        r"""Driver name of the :class:`~sqlalchemy.engine.interfaces.Dialect`
        in use by this :class:`Engine`.

        .. container:: class_bases

            Proxied for the :class:`_engine.Engine` class
            on behalf of the :class:`_asyncio.AsyncEngine` class.


        """  # noqa: E501

        return self._proxied.driver

    @property
    def echo(self) -> Any:
        r"""When ``True``, enable log output for this element.

        .. container:: class_bases

            Proxied for the :class:`_engine.Engine` class
            on behalf of the :class:`_asyncio.AsyncEngine` class.

        This has the effect of setting the Python logging level for the namespace
        of this element's class and object reference.  A value of boolean ``True``
        indicates that the loglevel ``logging.INFO`` will be set for the logger,
        whereas the string value ``debug`` will set the loglevel to
        ``logging.DEBUG``.

        """  # noqa: E501

        return self._proxied.echo

    @echo.setter
    def echo(self, attr: Any) -> None:
        self._proxied.echo = attr

    # END PROXY METHODS AsyncEngine


class AsyncTransaction(
    ProxyComparable[Transaction], StartableContext["AsyncTransaction"]
):
    """An asyncio proxy for a :class:`_engine.Transaction`."""

    __slots__ = ("connection", "sync_transaction", "nested")

    sync_transaction: Optional[Transaction]
    connection: AsyncConnection
    nested: bool

    def __init__(self, connection: AsyncConnection, nested: bool = False):
        self.connection = connection
        self.sync_transaction = None
        self.nested = nested

    @classmethod
    def _regenerate_proxy_for_target(
        cls, target: Transaction
    ) -> AsyncTransaction:
        sync_connection = target.connection
        sync_transaction = target
        nested = isinstance(target, NestedTransaction)

        async_connection = AsyncConnection._retrieve_proxy_for_target(
            sync_connection
        )
        assert async_connection is not None

        obj = cls.__new__(cls)
        obj.connection = async_connection
        obj.sync_transaction = obj._assign_proxied(sync_transaction)
        obj.nested = nested
        return obj

    @util.ro_non_memoized_property
    def _proxied(self) -> Transaction:
        if not self.sync_transaction:
            self._raise_for_not_started()
        return self.sync_transaction

    @property
    def is_valid(self) -> bool:
        return self._proxied.is_valid

    @property
    def is_active(self) -> bool:
        return self._proxied.is_active

    async def close(self) -> None:
        """Close this :class:`.AsyncTransaction`.

        If this transaction is the base transaction in a begin/commit
        nesting, the transaction will rollback().  Otherwise, the
        method returns.

        This is used to cancel a Transaction without affecting the scope of
        an enclosing transaction.

        """
        await greenlet_spawn(self._proxied.close)

    async def rollback(self) -> None:
        """Roll back this :class:`.AsyncTransaction`."""
        await greenlet_spawn(self._proxied.rollback)

    async def commit(self) -> None:
        """Commit this :class:`.AsyncTransaction`."""

        await greenlet_spawn(self._proxied.commit)

    async def start(self, is_ctxmanager: bool = False) -> AsyncTransaction:
        """Start this :class:`_asyncio.AsyncTransaction` object's context
        outside of using a Python ``with:`` block.

        """

        self.sync_transaction = self._assign_proxied(
            await greenlet_spawn(
                self.connection._proxied.begin_nested
                if self.nested
                else self.connection._proxied.begin
            )
        )
        if is_ctxmanager:
            self.sync_transaction.__enter__()
        return self

    async def __aexit__(self, type_: Any, value: Any, traceback: Any) -> None:
        await greenlet_spawn(self._proxied.__exit__, type_, value, traceback)


@overload
def _get_sync_engine_or_connection(async_engine: AsyncEngine) -> Engine:
    ...


@overload
def _get_sync_engine_or_connection(
    async_engine: AsyncConnection,
) -> Connection:
    ...


def _get_sync_engine_or_connection(
    async_engine: Union[AsyncEngine, AsyncConnection]
) -> Union[Engine, Connection]:
    if isinstance(async_engine, AsyncConnection):
        return async_engine._proxied

    try:
        return async_engine.sync_engine
    except AttributeError as e:
        raise exc.ArgumentError(
            "AsyncEngine expected, got %r" % async_engine
        ) from e


@inspection._inspects(AsyncConnection)
def _no_insp_for_async_conn_yet(
    subject: AsyncConnection,  # noqa: U100
) -> NoReturn:
    raise exc.NoInspectionAvailable(
        "Inspection on an AsyncConnection is currently not supported. "
        "Please use ``run_sync`` to pass a callable where it's possible "
        "to call ``inspect`` on the passed connection.",
        code="xd3s",
    )


@inspection._inspects(AsyncEngine)
def _no_insp_for_async_engine_xyet(
    subject: AsyncEngine,  # noqa: U100
) -> NoReturn:
    raise exc.NoInspectionAvailable(
        "Inspection on an AsyncEngine is currently not supported. "
        "Please obtain a connection then use ``conn.run_sync`` to pass a "
        "callable where it's possible to call ``inspect`` on the "
        "passed connection.",
        code="xd3s",
    )
