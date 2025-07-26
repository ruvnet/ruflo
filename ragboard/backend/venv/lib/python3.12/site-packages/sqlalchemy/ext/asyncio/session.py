# ext/asyncio/session.py
# Copyright (C) 2020-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
from __future__ import annotations

import asyncio
from typing import Any
from typing import Awaitable
from typing import Callable
from typing import cast
from typing import Dict
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import engine
from .base import ReversibleProxy
from .base import StartableContext
from .result import _ensure_sync_result
from .result import AsyncResult
from .result import AsyncScalarResult
from ... import util
from ...orm import close_all_sessions as _sync_close_all_sessions
from ...orm import object_session
from ...orm import Session
from ...orm import SessionTransaction
from ...orm import state as _instance_state
from ...util.concurrency import greenlet_spawn

if TYPE_CHECKING:
    from .engine import AsyncConnection
    from .engine import AsyncEngine
    from ...engine import Connection
    from ...engine import CursorResult
    from ...engine import Engine
    from ...engine import Result
    from ...engine import Row
    from ...engine import RowMapping
    from ...engine import ScalarResult
    from ...engine.interfaces import _CoreAnyExecuteParams
    from ...engine.interfaces import CoreExecuteOptionsParameter
    from ...event import dispatcher
    from ...orm._typing import _IdentityKeyType
    from ...orm._typing import _O
    from ...orm._typing import OrmExecuteOptionsParameter
    from ...orm.identity import IdentityMap
    from ...orm.interfaces import ORMOption
    from ...orm.session import _BindArguments
    from ...orm.session import _EntityBindKey
    from ...orm.session import _PKIdentityArgument
    from ...orm.session import _SessionBind
    from ...orm.session import _SessionBindKey
    from ...sql._typing import _InfoType
    from ...sql.base import Executable
    from ...sql.dml import UpdateBase
    from ...sql.elements import ClauseElement
    from ...sql.selectable import ForUpdateParameter
    from ...sql.selectable import TypedReturnsRows

_AsyncSessionBind = Union["AsyncEngine", "AsyncConnection"]

_T = TypeVar("_T", bound=Any)


_EXECUTE_OPTIONS = util.immutabledict({"prebuffer_rows": True})
_STREAM_OPTIONS = util.immutabledict({"stream_results": True})


class AsyncAttrs:
    """Mixin class which provides an awaitable accessor for all attributes.

    E.g.::

        from __future__ import annotations

        from typing import List

        from sqlalchemy import ForeignKey
        from sqlalchemy import func
        from sqlalchemy.ext.asyncio import AsyncAttrs
        from sqlalchemy.orm import DeclarativeBase
        from sqlalchemy.orm import Mapped
        from sqlalchemy.orm import mapped_column
        from sqlalchemy.orm import relationship


        class Base(AsyncAttrs, DeclarativeBase):
            pass


        class A(Base):
            __tablename__ = "a"

            id: Mapped[int] = mapped_column(primary_key=True)
            data: Mapped[str]
            bs: Mapped[List[B]] = relationship()


        class B(Base):
            __tablename__ = "b"
            id: Mapped[int] = mapped_column(primary_key=True)
            a_id: Mapped[int] = mapped_column(ForeignKey("a.id"))
            data: Mapped[str]

    In the above example, the :class:`_asyncio.AsyncAttrs` mixin is applied to
    the declarative ``Base`` class where it takes effect for all subclasses.
    This mixin adds a single new attribute
    :attr:`_asyncio.AsyncAttrs.awaitable_attrs` to all classes, which will
    yield the value of any attribute as an awaitable. This allows attributes
    which may be subject to lazy loading or deferred / unexpiry loading to be
    accessed such that IO can still be emitted::

        a1 = (await async_session.scalars(select(A).where(A.id == 5))).one()

        # use the lazy loader on ``a1.bs`` via the ``.awaitable_attrs``
        # interface, so that it may be awaited
        for b1 in await a1.awaitable_attrs.bs:
            print(b1)

    The :attr:`_asyncio.AsyncAttrs.awaitable_attrs` performs a call against the
    attribute that is approximately equivalent to using the
    :meth:`_asyncio.AsyncSession.run_sync` method, e.g.::

        for b1 in await async_session.run_sync(lambda sess: a1.bs):
            print(b1)

    .. versionadded:: 2.0.13

    .. seealso::

        :ref:`asyncio_orm_avoid_lazyloads`

    """

    class _AsyncAttrGetitem:
        __slots__ = "_instance"

        def __init__(self, _instance: Any):
            self._instance = _instance

        def __getattr__(self, name: str) -> Awaitable[Any]:
            return greenlet_spawn(getattr, self._instance, name)

    @property
    def awaitable_attrs(self) -> AsyncAttrs._AsyncAttrGetitem:
        """provide a namespace of all attributes on this object wrapped
        as awaitables.

        e.g.::


            a1 = (await async_session.scalars(select(A).where(A.id == 5))).one()

            some_attribute = await a1.awaitable_attrs.some_deferred_attribute
            some_collection = await a1.awaitable_attrs.some_collection

        """  # noqa: E501

        return AsyncAttrs._AsyncAttrGetitem(self)


@util.create_proxy_methods(
    Session,
    ":class:`_orm.Session`",
    ":class:`_asyncio.AsyncSession`",
    classmethods=["object_session", "identity_key"],
    methods=[
        "__contains__",
        "__iter__",
        "add",
        "add_all",
        "expire",
        "expire_all",
        "expunge",
        "expunge_all",
        "is_modified",
        "in_transaction",
        "in_nested_transaction",
    ],
    attributes=[
        "dirty",
        "deleted",
        "new",
        "identity_map",
        "is_active",
        "autoflush",
        "no_autoflush",
        "info",
    ],
)
class AsyncSession(ReversibleProxy[Session]):
    """Asyncio version of :class:`_orm.Session`.

    The :class:`_asyncio.AsyncSession` is a proxy for a traditional
    :class:`_orm.Session` instance.

    The :class:`_asyncio.AsyncSession` is **not safe for use in concurrent
    tasks.**.  See :ref:`session_faq_threadsafe` for background.

    .. versionadded:: 1.4

    To use an :class:`_asyncio.AsyncSession` with custom :class:`_orm.Session`
    implementations, see the
    :paramref:`_asyncio.AsyncSession.sync_session_class` parameter.


    """

    _is_asyncio = True

    dispatch: dispatcher[Session]

    def __init__(
        self,
        bind: Optional[_AsyncSessionBind] = None,
        *,
        binds: Optional[Dict[_SessionBindKey, _AsyncSessionBind]] = None,
        sync_session_class: Optional[Type[Session]] = None,
        **kw: Any,
    ):
        r"""Construct a new :class:`_asyncio.AsyncSession`.

        All parameters other than ``sync_session_class`` are passed to the
        ``sync_session_class`` callable directly to instantiate a new
        :class:`_orm.Session`. Refer to :meth:`_orm.Session.__init__` for
        parameter documentation.

        :param sync_session_class:
          A :class:`_orm.Session` subclass or other callable which will be used
          to construct the :class:`_orm.Session` which will be proxied. This
          parameter may be used to provide custom :class:`_orm.Session`
          subclasses. Defaults to the
          :attr:`_asyncio.AsyncSession.sync_session_class` class-level
          attribute.

          .. versionadded:: 1.4.24

        """
        sync_bind = sync_binds = None

        if bind:
            self.bind = bind
            sync_bind = engine._get_sync_engine_or_connection(bind)

        if binds:
            self.binds = binds
            sync_binds = {
                key: engine._get_sync_engine_or_connection(b)
                for key, b in binds.items()
            }

        if sync_session_class:
            self.sync_session_class = sync_session_class

        self.sync_session = self._proxied = self._assign_proxied(
            self.sync_session_class(bind=sync_bind, binds=sync_binds, **kw)
        )

    sync_session_class: Type[Session] = Session
    """The class or callable that provides the
    underlying :class:`_orm.Session` instance for a particular
    :class:`_asyncio.AsyncSession`.

    At the class level, this attribute is the default value for the
    :paramref:`_asyncio.AsyncSession.sync_session_class` parameter. Custom
    subclasses of :class:`_asyncio.AsyncSession` can override this.

    At the instance level, this attribute indicates the current class or
    callable that was used to provide the :class:`_orm.Session` instance for
    this :class:`_asyncio.AsyncSession` instance.

    .. versionadded:: 1.4.24

    """

    sync_session: Session
    """Reference to the underlying :class:`_orm.Session` this
    :class:`_asyncio.AsyncSession` proxies requests towards.

    This instance can be used as an event target.

    .. seealso::

        :ref:`asyncio_events`

    """

    @classmethod
    def _no_async_engine_events(cls) -> NoReturn:
        raise NotImplementedError(
            "asynchronous events are not implemented at this time.  Apply "
            "synchronous listeners to the AsyncSession.sync_session."
        )

    async def refresh(
        self,
        instance: object,
        attribute_names: Optional[Iterable[str]] = None,
        with_for_update: ForUpdateParameter = None,
    ) -> None:
        """Expire and refresh the attributes on the given instance.

        A query will be issued to the database and all attributes will be
        refreshed with their current database value.

        This is the async version of the :meth:`_orm.Session.refresh` method.
        See that method for a complete description of all options.

        .. seealso::

            :meth:`_orm.Session.refresh` - main documentation for refresh

        """

        await greenlet_spawn(
            self.sync_session.refresh,
            instance,
            attribute_names=attribute_names,
            with_for_update=with_for_update,
        )

    async def run_sync(
        self, fn: Callable[..., _T], *arg: Any, **kw: Any
    ) -> _T:
        """Invoke the given synchronous (i.e. not async) callable,
        passing a synchronous-style :class:`_orm.Session` as the first
        argument.

        This method allows traditional synchronous SQLAlchemy functions to
        run within the context of an asyncio application.

        E.g.::

            def some_business_method(session: Session, param: str) -> str:
                '''A synchronous function that does not require awaiting

                :param session: a SQLAlchemy Session, used synchronously

                :return: an optional return value is supported

                '''
                session.add(MyObject(param=param))
                session.flush()
                return "success"


            async def do_something_async(async_engine: AsyncEngine) -> None:
                '''an async function that uses awaiting'''

                with AsyncSession(async_engine) as async_session:
                    # run some_business_method() with a sync-style
                    # Session, proxied into an awaitable
                    return_code = await async_session.run_sync(some_business_method, param="param1")
                    print(return_code)

        This method maintains the asyncio event loop all the way through
        to the database connection by running the given callable in a
        specially instrumented greenlet.

        .. tip::

            The provided callable is invoked inline within the asyncio event
            loop, and will block on traditional IO calls.  IO within this
            callable should only call into SQLAlchemy's asyncio database
            APIs which will be properly adapted to the greenlet context.

        .. seealso::

            :class:`.AsyncAttrs`  - a mixin for ORM mapped classes that provides
            a similar feature more succinctly on a per-attribute basis

            :meth:`.AsyncConnection.run_sync`

            :ref:`session_run_sync`
        """  # noqa: E501

        return await greenlet_spawn(fn, self.sync_session, *arg, **kw)

    @overload
    async def execute(
        self,
        statement: TypedReturnsRows[_T],
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        _parent_execute_state: Optional[Any] = None,
        _add_event: Optional[Any] = None,
    ) -> Result[_T]:
        ...

    @overload
    async def execute(
        self,
        statement: UpdateBase,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        _parent_execute_state: Optional[Any] = None,
        _add_event: Optional[Any] = None,
    ) -> CursorResult[Any]:
        ...

    @overload
    async def execute(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        _parent_execute_state: Optional[Any] = None,
        _add_event: Optional[Any] = None,
    ) -> Result[Any]:
        ...

    async def execute(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Result[Any]:
        """Execute a statement and return a buffered
        :class:`_engine.Result` object.

        .. seealso::

            :meth:`_orm.Session.execute` - main documentation for execute

        """

        if execution_options:
            execution_options = util.immutabledict(execution_options).union(
                _EXECUTE_OPTIONS
            )
        else:
            execution_options = _EXECUTE_OPTIONS

        result = await greenlet_spawn(
            self.sync_session.execute,
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            **kw,
        )
        return await _ensure_sync_result(result, self.execute)

    @overload
    async def scalar(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Optional[_T]:
        ...

    @overload
    async def scalar(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Any:
        ...

    async def scalar(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Any:
        """Execute a statement and return a scalar result.

        .. seealso::

            :meth:`_orm.Session.scalar` - main documentation for scalar

        """

        if execution_options:
            execution_options = util.immutabledict(execution_options).union(
                _EXECUTE_OPTIONS
            )
        else:
            execution_options = _EXECUTE_OPTIONS

        return await greenlet_spawn(
            self.sync_session.scalar,
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            **kw,
        )

    @overload
    async def scalars(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> ScalarResult[_T]:
        ...

    @overload
    async def scalars(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> ScalarResult[Any]:
        ...

    async def scalars(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> ScalarResult[Any]:
        """Execute a statement and return scalar results.

        :return: a :class:`_result.ScalarResult` object

        .. versionadded:: 1.4.24 Added :meth:`_asyncio.AsyncSession.scalars`

        .. versionadded:: 1.4.26 Added
           :meth:`_asyncio.async_scoped_session.scalars`

        .. seealso::

            :meth:`_orm.Session.scalars` - main documentation for scalars

            :meth:`_asyncio.AsyncSession.stream_scalars` - streaming version

        """

        result = await self.execute(
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            **kw,
        )
        return result.scalars()

    async def get(
        self,
        entity: _EntityBindKey[_O],
        ident: _PKIdentityArgument,
        *,
        options: Optional[Sequence[ORMOption]] = None,
        populate_existing: bool = False,
        with_for_update: ForUpdateParameter = None,
        identity_token: Optional[Any] = None,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
    ) -> Union[_O, None]:
        """Return an instance based on the given primary key identifier,
        or ``None`` if not found.

        .. seealso::

            :meth:`_orm.Session.get` - main documentation for get


        """

        return await greenlet_spawn(
            cast("Callable[..., _O]", self.sync_session.get),
            entity,
            ident,
            options=options,
            populate_existing=populate_existing,
            with_for_update=with_for_update,
            identity_token=identity_token,
            execution_options=execution_options,
        )

    async def get_one(
        self,
        entity: _EntityBindKey[_O],
        ident: _PKIdentityArgument,
        *,
        options: Optional[Sequence[ORMOption]] = None,
        populate_existing: bool = False,
        with_for_update: ForUpdateParameter = None,
        identity_token: Optional[Any] = None,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
    ) -> _O:
        """Return an instance based on the given primary key identifier,
        or raise an exception if not found.

        Raises ``sqlalchemy.orm.exc.NoResultFound`` if the query selects
        no rows.

        ..versionadded: 2.0.22

        .. seealso::

            :meth:`_orm.Session.get_one` - main documentation for get_one

        """

        return await greenlet_spawn(
            cast("Callable[..., _O]", self.sync_session.get_one),
            entity,
            ident,
            options=options,
            populate_existing=populate_existing,
            with_for_update=with_for_update,
            identity_token=identity_token,
            execution_options=execution_options,
        )

    @overload
    async def stream(
        self,
        statement: TypedReturnsRows[_T],
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> AsyncResult[_T]:
        ...

    @overload
    async def stream(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> AsyncResult[Any]:
        ...

    async def stream(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> AsyncResult[Any]:
        """Execute a statement and return a streaming
        :class:`_asyncio.AsyncResult` object.

        """

        if execution_options:
            execution_options = util.immutabledict(execution_options).union(
                _STREAM_OPTIONS
            )
        else:
            execution_options = _STREAM_OPTIONS

        result = await greenlet_spawn(
            self.sync_session.execute,
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            **kw,
        )
        return AsyncResult(result)

    @overload
    async def stream_scalars(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> AsyncScalarResult[_T]:
        ...

    @overload
    async def stream_scalars(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> AsyncScalarResult[Any]:
        ...

    async def stream_scalars(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> AsyncScalarResult[Any]:
        """Execute a statement and return a stream of scalar results.

        :return: an :class:`_asyncio.AsyncScalarResult` object

        .. versionadded:: 1.4.24

        .. seealso::

            :meth:`_orm.Session.scalars` - main documentation for scalars

            :meth:`_asyncio.AsyncSession.scalars` - non streaming version

        """

        result = await self.stream(
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            **kw,
        )
        return result.scalars()

    async def delete(self, instance: object) -> None:
        """Mark an instance as deleted.

        The database delete operation occurs upon ``flush()``.

        As this operation may need to cascade along unloaded relationships,
        it is awaitable to allow for those queries to take place.

        .. seealso::

            :meth:`_orm.Session.delete` - main documentation for delete

        """
        await greenlet_spawn(self.sync_session.delete, instance)

    async def merge(
        self,
        instance: _O,
        *,
        load: bool = True,
        options: Optional[Sequence[ORMOption]] = None,
    ) -> _O:
        """Copy the state of a given instance into a corresponding instance
        within this :class:`_asyncio.AsyncSession`.

        .. seealso::

            :meth:`_orm.Session.merge` - main documentation for merge

        """
        return await greenlet_spawn(
            self.sync_session.merge, instance, load=load, options=options
        )

    async def flush(self, objects: Optional[Sequence[Any]] = None) -> None:
        """Flush all the object changes to the database.

        .. seealso::

            :meth:`_orm.Session.flush` - main documentation for flush

        """
        await greenlet_spawn(self.sync_session.flush, objects=objects)

    def get_transaction(self) -> Optional[AsyncSessionTransaction]:
        """Return the current root transaction in progress, if any.

        :return: an :class:`_asyncio.AsyncSessionTransaction` object, or
         ``None``.

        .. versionadded:: 1.4.18

        """
        trans = self.sync_session.get_transaction()
        if trans is not None:
            return AsyncSessionTransaction._retrieve_proxy_for_target(trans)
        else:
            return None

    def get_nested_transaction(self) -> Optional[AsyncSessionTransaction]:
        """Return the current nested transaction in progress, if any.

        :return: an :class:`_asyncio.AsyncSessionTransaction` object, or
         ``None``.

        .. versionadded:: 1.4.18

        """

        trans = self.sync_session.get_nested_transaction()
        if trans is not None:
            return AsyncSessionTransaction._retrieve_proxy_for_target(trans)
        else:
            return None

    def get_bind(
        self,
        mapper: Optional[_EntityBindKey[_O]] = None,
        clause: Optional[ClauseElement] = None,
        bind: Optional[_SessionBind] = None,
        **kw: Any,
    ) -> Union[Engine, Connection]:
        """Return a "bind" to which the synchronous proxied :class:`_orm.Session`
        is bound.

        Unlike the :meth:`_orm.Session.get_bind` method, this method is
        currently **not** used by this :class:`.AsyncSession` in any way
        in order to resolve engines for requests.

        .. note::

            This method proxies directly to the :meth:`_orm.Session.get_bind`
            method, however is currently **not** useful as an override target,
            in contrast to that of the :meth:`_orm.Session.get_bind` method.
            The example below illustrates how to implement custom
            :meth:`_orm.Session.get_bind` schemes that work with
            :class:`.AsyncSession` and :class:`.AsyncEngine`.

        The pattern introduced at :ref:`session_custom_partitioning`
        illustrates how to apply a custom bind-lookup scheme to a
        :class:`_orm.Session` given a set of :class:`_engine.Engine` objects.
        To apply a corresponding :meth:`_orm.Session.get_bind` implementation
        for use with a :class:`.AsyncSession` and :class:`.AsyncEngine`
        objects, continue to subclass :class:`_orm.Session` and apply it to
        :class:`.AsyncSession` using
        :paramref:`.AsyncSession.sync_session_class`. The inner method must
        continue to return :class:`_engine.Engine` instances, which can be
        acquired from a :class:`_asyncio.AsyncEngine` using the
        :attr:`_asyncio.AsyncEngine.sync_engine` attribute::

            # using example from "Custom Vertical Partitioning"


            import random

            from sqlalchemy.ext.asyncio import AsyncSession
            from sqlalchemy.ext.asyncio import create_async_engine
            from sqlalchemy.ext.asyncio import async_sessionmaker
            from sqlalchemy.orm import Session

            # construct async engines w/ async drivers
            engines = {
                'leader':create_async_engine("sqlite+aiosqlite:///leader.db"),
                'other':create_async_engine("sqlite+aiosqlite:///other.db"),
                'follower1':create_async_engine("sqlite+aiosqlite:///follower1.db"),
                'follower2':create_async_engine("sqlite+aiosqlite:///follower2.db"),
            }

            class RoutingSession(Session):
                def get_bind(self, mapper=None, clause=None, **kw):
                    # within get_bind(), return sync engines
                    if mapper and issubclass(mapper.class_, MyOtherClass):
                        return engines['other'].sync_engine
                    elif self._flushing or isinstance(clause, (Update, Delete)):
                        return engines['leader'].sync_engine
                    else:
                        return engines[
                            random.choice(['follower1','follower2'])
                        ].sync_engine

            # apply to AsyncSession using sync_session_class
            AsyncSessionMaker = async_sessionmaker(
                sync_session_class=RoutingSession
            )

        The :meth:`_orm.Session.get_bind` method is called in a non-asyncio,
        implicitly non-blocking context in the same manner as ORM event hooks
        and functions that are invoked via :meth:`.AsyncSession.run_sync`, so
        routines that wish to run SQL commands inside of
        :meth:`_orm.Session.get_bind` can continue to do so using
        blocking-style code, which will be translated to implicitly async calls
        at the point of invoking IO on the database drivers.

        """  # noqa: E501

        return self.sync_session.get_bind(
            mapper=mapper, clause=clause, bind=bind, **kw
        )

    async def connection(
        self,
        bind_arguments: Optional[_BindArguments] = None,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
        **kw: Any,
    ) -> AsyncConnection:
        r"""Return a :class:`_asyncio.AsyncConnection` object corresponding to
        this :class:`.Session` object's transactional state.

        This method may also be used to establish execution options for the
        database connection used by the current transaction.

        .. versionadded:: 1.4.24  Added \**kw arguments which are passed
           through to the underlying :meth:`_orm.Session.connection` method.

        .. seealso::

            :meth:`_orm.Session.connection` - main documentation for
            "connection"

        """

        sync_connection = await greenlet_spawn(
            self.sync_session.connection,
            bind_arguments=bind_arguments,
            execution_options=execution_options,
            **kw,
        )
        return engine.AsyncConnection._retrieve_proxy_for_target(
            sync_connection
        )

    def begin(self) -> AsyncSessionTransaction:
        """Return an :class:`_asyncio.AsyncSessionTransaction` object.

        The underlying :class:`_orm.Session` will perform the
        "begin" action when the :class:`_asyncio.AsyncSessionTransaction`
        object is entered::

            async with async_session.begin():
                # .. ORM transaction is begun

        Note that database IO will not normally occur when the session-level
        transaction is begun, as database transactions begin on an
        on-demand basis.  However, the begin block is async to accommodate
        for a :meth:`_orm.SessionEvents.after_transaction_create`
        event hook that may perform IO.

        For a general description of ORM begin, see
        :meth:`_orm.Session.begin`.

        """

        return AsyncSessionTransaction(self)

    def begin_nested(self) -> AsyncSessionTransaction:
        """Return an :class:`_asyncio.AsyncSessionTransaction` object
        which will begin a "nested" transaction, e.g. SAVEPOINT.

        Behavior is the same as that of :meth:`_asyncio.AsyncSession.begin`.

        For a general description of ORM begin nested, see
        :meth:`_orm.Session.begin_nested`.

        .. seealso::

            :ref:`aiosqlite_serializable` - special workarounds required
            with the SQLite asyncio driver in order for SAVEPOINT to work
            correctly.

        """

        return AsyncSessionTransaction(self, nested=True)

    async def rollback(self) -> None:
        """Rollback the current transaction in progress.

        .. seealso::

            :meth:`_orm.Session.rollback` - main documentation for
            "rollback"
        """
        await greenlet_spawn(self.sync_session.rollback)

    async def commit(self) -> None:
        """Commit the current transaction in progress.

        .. seealso::

            :meth:`_orm.Session.commit` - main documentation for
            "commit"
        """
        await greenlet_spawn(self.sync_session.commit)

    async def close(self) -> None:
        """Close out the transactional resources and ORM objects used by this
        :class:`_asyncio.AsyncSession`.

        .. seealso::

            :meth:`_orm.Session.close` - main documentation for
            "close"

            :ref:`session_closing` - detail on the semantics of
            :meth:`_asyncio.AsyncSession.close` and
            :meth:`_asyncio.AsyncSession.reset`.

        """
        await greenlet_spawn(self.sync_session.close)

    async def reset(self) -> None:
        """Close out the transactional resources and ORM objects used by this
        :class:`_orm.Session`, resetting the session to its initial state.

        .. versionadded:: 2.0.22

        .. seealso::

            :meth:`_orm.Session.reset` - main documentation for
            "reset"

            :ref:`session_closing` - detail on the semantics of
            :meth:`_asyncio.AsyncSession.close` and
            :meth:`_asyncio.AsyncSession.reset`.

        """
        await greenlet_spawn(self.sync_session.reset)

    async def aclose(self) -> None:
        """A synonym for :meth:`_asyncio.AsyncSession.close`.

        The :meth:`_asyncio.AsyncSession.aclose` name is specifically
        to support the Python standard library ``@contextlib.aclosing``
        context manager function.

        .. versionadded:: 2.0.20

        """
        await self.close()

    async def invalidate(self) -> None:
        """Close this Session, using connection invalidation.

        For a complete description, see :meth:`_orm.Session.invalidate`.
        """
        await greenlet_spawn(self.sync_session.invalidate)

    @classmethod
    @util.deprecated(
        "2.0",
        "The :meth:`.AsyncSession.close_all` method is deprecated and will be "
        "removed in a future release.  Please refer to "
        ":func:`_asyncio.close_all_sessions`.",
    )
    async def close_all(cls) -> None:
        """Close all :class:`_asyncio.AsyncSession` sessions."""
        await close_all_sessions()

    async def __aenter__(self: _AS) -> _AS:
        return self

    async def __aexit__(self, type_: Any, value: Any, traceback: Any) -> None:
        task = asyncio.create_task(self.close())
        await asyncio.shield(task)

    def _maker_context_manager(self: _AS) -> _AsyncSessionContextManager[_AS]:
        return _AsyncSessionContextManager(self)

    # START PROXY METHODS AsyncSession

    # code within this block is **programmatically,
    # statically generated** by tools/generate_proxy_methods.py

    def __contains__(self, instance: object) -> bool:
        r"""Return True if the instance is associated with this session.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        The instance may be pending or persistent within the Session for a
        result of True.


        """  # noqa: E501

        return self._proxied.__contains__(instance)

    def __iter__(self) -> Iterator[object]:
        r"""Iterate over all pending or persistent instances within this
        Session.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.


        """  # noqa: E501

        return self._proxied.__iter__()

    def add(self, instance: object, _warn: bool = True) -> None:
        r"""Place an object into this :class:`_orm.Session`.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        Objects that are in the :term:`transient` state when passed to the
        :meth:`_orm.Session.add` method will move to the
        :term:`pending` state, until the next flush, at which point they
        will move to the :term:`persistent` state.

        Objects that are in the :term:`detached` state when passed to the
        :meth:`_orm.Session.add` method will move to the :term:`persistent`
        state directly.

        If the transaction used by the :class:`_orm.Session` is rolled back,
        objects which were transient when they were passed to
        :meth:`_orm.Session.add` will be moved back to the
        :term:`transient` state, and will no longer be present within this
        :class:`_orm.Session`.

        .. seealso::

            :meth:`_orm.Session.add_all`

            :ref:`session_adding` - at :ref:`session_basics`


        """  # noqa: E501

        return self._proxied.add(instance, _warn=_warn)

    def add_all(self, instances: Iterable[object]) -> None:
        r"""Add the given collection of instances to this :class:`_orm.Session`.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        See the documentation for :meth:`_orm.Session.add` for a general
        behavioral description.

        .. seealso::

            :meth:`_orm.Session.add`

            :ref:`session_adding` - at :ref:`session_basics`


        """  # noqa: E501

        return self._proxied.add_all(instances)

    def expire(
        self, instance: object, attribute_names: Optional[Iterable[str]] = None
    ) -> None:
        r"""Expire the attributes on an instance.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        Marks the attributes of an instance as out of date. When an expired
        attribute is next accessed, a query will be issued to the
        :class:`.Session` object's current transactional context in order to
        load all expired attributes for the given instance.   Note that
        a highly isolated transaction will return the same values as were
        previously read in that same transaction, regardless of changes
        in database state outside of that transaction.

        To expire all objects in the :class:`.Session` simultaneously,
        use :meth:`Session.expire_all`.

        The :class:`.Session` object's default behavior is to
        expire all state whenever the :meth:`Session.rollback`
        or :meth:`Session.commit` methods are called, so that new
        state can be loaded for the new transaction.   For this reason,
        calling :meth:`Session.expire` only makes sense for the specific
        case that a non-ORM SQL statement was emitted in the current
        transaction.

        :param instance: The instance to be refreshed.
        :param attribute_names: optional list of string attribute names
          indicating a subset of attributes to be expired.

        .. seealso::

            :ref:`session_expire` - introductory material

            :meth:`.Session.expire`

            :meth:`.Session.refresh`

            :meth:`_orm.Query.populate_existing`


        """  # noqa: E501

        return self._proxied.expire(instance, attribute_names=attribute_names)

    def expire_all(self) -> None:
        r"""Expires all persistent instances within this Session.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        When any attributes on a persistent instance is next accessed,
        a query will be issued using the
        :class:`.Session` object's current transactional context in order to
        load all expired attributes for the given instance.   Note that
        a highly isolated transaction will return the same values as were
        previously read in that same transaction, regardless of changes
        in database state outside of that transaction.

        To expire individual objects and individual attributes
        on those objects, use :meth:`Session.expire`.

        The :class:`.Session` object's default behavior is to
        expire all state whenever the :meth:`Session.rollback`
        or :meth:`Session.commit` methods are called, so that new
        state can be loaded for the new transaction.   For this reason,
        calling :meth:`Session.expire_all` is not usually needed,
        assuming the transaction is isolated.

        .. seealso::

            :ref:`session_expire` - introductory material

            :meth:`.Session.expire`

            :meth:`.Session.refresh`

            :meth:`_orm.Query.populate_existing`


        """  # noqa: E501

        return self._proxied.expire_all()

    def expunge(self, instance: object) -> None:
        r"""Remove the `instance` from this ``Session``.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        This will free all internal references to the instance.  Cascading
        will be applied according to the *expunge* cascade rule.


        """  # noqa: E501

        return self._proxied.expunge(instance)

    def expunge_all(self) -> None:
        r"""Remove all object instances from this ``Session``.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        This is equivalent to calling ``expunge(obj)`` on all objects in this
        ``Session``.


        """  # noqa: E501

        return self._proxied.expunge_all()

    def is_modified(
        self, instance: object, include_collections: bool = True
    ) -> bool:
        r"""Return ``True`` if the given instance has locally
        modified attributes.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        This method retrieves the history for each instrumented
        attribute on the instance and performs a comparison of the current
        value to its previously committed value, if any.

        It is in effect a more expensive and accurate
        version of checking for the given instance in the
        :attr:`.Session.dirty` collection; a full test for
        each attribute's net "dirty" status is performed.

        E.g.::

            return session.is_modified(someobject)

        A few caveats to this method apply:

        * Instances present in the :attr:`.Session.dirty` collection may
          report ``False`` when tested with this method.  This is because
          the object may have received change events via attribute mutation,
          thus placing it in :attr:`.Session.dirty`, but ultimately the state
          is the same as that loaded from the database, resulting in no net
          change here.
        * Scalar attributes may not have recorded the previously set
          value when a new value was applied, if the attribute was not loaded,
          or was expired, at the time the new value was received - in these
          cases, the attribute is assumed to have a change, even if there is
          ultimately no net change against its database value. SQLAlchemy in
          most cases does not need the "old" value when a set event occurs, so
          it skips the expense of a SQL call if the old value isn't present,
          based on the assumption that an UPDATE of the scalar value is
          usually needed, and in those few cases where it isn't, is less
          expensive on average than issuing a defensive SELECT.

          The "old" value is fetched unconditionally upon set only if the
          attribute container has the ``active_history`` flag set to ``True``.
          This flag is set typically for primary key attributes and scalar
          object references that are not a simple many-to-one.  To set this
          flag for any arbitrary mapped column, use the ``active_history``
          argument with :func:`.column_property`.

        :param instance: mapped instance to be tested for pending changes.
        :param include_collections: Indicates if multivalued collections
         should be included in the operation.  Setting this to ``False`` is a
         way to detect only local-column based properties (i.e. scalar columns
         or many-to-one foreign keys) that would result in an UPDATE for this
         instance upon flush.


        """  # noqa: E501

        return self._proxied.is_modified(
            instance, include_collections=include_collections
        )

    def in_transaction(self) -> bool:
        r"""Return True if this :class:`_orm.Session` has begun a transaction.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        .. versionadded:: 1.4

        .. seealso::

            :attr:`_orm.Session.is_active`



        """  # noqa: E501

        return self._proxied.in_transaction()

    def in_nested_transaction(self) -> bool:
        r"""Return True if this :class:`_orm.Session` has begun a nested
        transaction, e.g. SAVEPOINT.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        .. versionadded:: 1.4


        """  # noqa: E501

        return self._proxied.in_nested_transaction()

    @property
    def dirty(self) -> Any:
        r"""The set of all persistent instances considered dirty.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_asyncio.AsyncSession` class.

        E.g.::

            some_mapped_object in session.dirty

        Instances are considered dirty when they were modified but not
        deleted.

        Note that this 'dirty' calculation is 'optimistic'; most
        attribute-setting or collection modification operations will
        mark an instance as 'dirty' and place it in this set, even if
        there is no net change to the attribute's value.  At flush
        time, the value of each attribute is compared to its
        previously saved value, and if there's no net change, no SQL
        operation will occur (this is a more expensive operation so
        it's only done at flush time).

        To check if an instance has actionable net changes to its
        attributes, use the :meth:`.Session.is_modified` method.


        """  # noqa: E501

        return self._proxied.dirty

    @property
    def deleted(self) -> Any:
        r"""The set of all instances marked as 'deleted' within this ``Session``

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_asyncio.AsyncSession` class.

        """  # noqa: E501

        return self._proxied.deleted

    @property
    def new(self) -> Any:
        r"""The set of all instances marked as 'new' within this ``Session``.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_asyncio.AsyncSession` class.

        """  # noqa: E501

        return self._proxied.new

    @property
    def identity_map(self) -> IdentityMap:
        r"""Proxy for the :attr:`_orm.Session.identity_map` attribute
        on behalf of the :class:`_asyncio.AsyncSession` class.

        """  # noqa: E501

        return self._proxied.identity_map

    @identity_map.setter
    def identity_map(self, attr: IdentityMap) -> None:
        self._proxied.identity_map = attr

    @property
    def is_active(self) -> Any:
        r"""True if this :class:`.Session` not in "partial rollback" state.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_asyncio.AsyncSession` class.

        .. versionchanged:: 1.4 The :class:`_orm.Session` no longer begins
           a new transaction immediately, so this attribute will be False
           when the :class:`_orm.Session` is first instantiated.

        "partial rollback" state typically indicates that the flush process
        of the :class:`_orm.Session` has failed, and that the
        :meth:`_orm.Session.rollback` method must be emitted in order to
        fully roll back the transaction.

        If this :class:`_orm.Session` is not in a transaction at all, the
        :class:`_orm.Session` will autobegin when it is first used, so in this
        case :attr:`_orm.Session.is_active` will return True.

        Otherwise, if this :class:`_orm.Session` is within a transaction,
        and that transaction has not been rolled back internally, the
        :attr:`_orm.Session.is_active` will also return True.

        .. seealso::

            :ref:`faq_session_rollback`

            :meth:`_orm.Session.in_transaction`


        """  # noqa: E501

        return self._proxied.is_active

    @property
    def autoflush(self) -> bool:
        r"""Proxy for the :attr:`_orm.Session.autoflush` attribute
        on behalf of the :class:`_asyncio.AsyncSession` class.

        """  # noqa: E501

        return self._proxied.autoflush

    @autoflush.setter
    def autoflush(self, attr: bool) -> None:
        self._proxied.autoflush = attr

    @property
    def no_autoflush(self) -> Any:
        r"""Return a context manager that disables autoflush.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_asyncio.AsyncSession` class.

        e.g.::

            with session.no_autoflush:

                some_object = SomeClass()
                session.add(some_object)
                # won't autoflush
                some_object.related_thing = session.query(SomeRelated).first()

        Operations that proceed within the ``with:`` block
        will not be subject to flushes occurring upon query
        access.  This is useful when initializing a series
        of objects which involve existing database queries,
        where the uncompleted object should not yet be flushed.


        """  # noqa: E501

        return self._proxied.no_autoflush

    @property
    def info(self) -> Any:
        r"""A user-modifiable dictionary.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_asyncio.AsyncSession` class.

        The initial value of this dictionary can be populated using the
        ``info`` argument to the :class:`.Session` constructor or
        :class:`.sessionmaker` constructor or factory methods.  The dictionary
        here is always local to this :class:`.Session` and can be modified
        independently of all other :class:`.Session` objects.


        """  # noqa: E501

        return self._proxied.info

    @classmethod
    def object_session(cls, instance: object) -> Optional[Session]:
        r"""Return the :class:`.Session` to which an object belongs.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        This is an alias of :func:`.object_session`.


        """  # noqa: E501

        return Session.object_session(instance)

    @classmethod
    def identity_key(
        cls,
        class_: Optional[Type[Any]] = None,
        ident: Union[Any, Tuple[Any, ...]] = None,
        *,
        instance: Optional[Any] = None,
        row: Optional[Union[Row[Any], RowMapping]] = None,
        identity_token: Optional[Any] = None,
    ) -> _IdentityKeyType[Any]:
        r"""Return an identity key.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_asyncio.AsyncSession` class.

        This is an alias of :func:`.util.identity_key`.


        """  # noqa: E501

        return Session.identity_key(
            class_=class_,
            ident=ident,
            instance=instance,
            row=row,
            identity_token=identity_token,
        )

    # END PROXY METHODS AsyncSession


_AS = TypeVar("_AS", bound="AsyncSession")


class async_sessionmaker(Generic[_AS]):
    """A configurable :class:`.AsyncSession` factory.

    The :class:`.async_sessionmaker` factory works in the same way as the
    :class:`.sessionmaker` factory, to generate new :class:`.AsyncSession`
    objects when called, creating them given
    the configurational arguments established here.

    e.g.::

        from sqlalchemy.ext.asyncio import create_async_engine
        from sqlalchemy.ext.asyncio import AsyncSession
        from sqlalchemy.ext.asyncio import async_sessionmaker

        async def run_some_sql(async_session: async_sessionmaker[AsyncSession]) -> None:
            async with async_session() as session:
                session.add(SomeObject(data="object"))
                session.add(SomeOtherObject(name="other object"))
                await session.commit()

        async def main() -> None:
            # an AsyncEngine, which the AsyncSession will use for connection
            # resources
            engine = create_async_engine('postgresql+asyncpg://scott:tiger@localhost/')

            # create a reusable factory for new AsyncSession instances
            async_session = async_sessionmaker(engine)

            await run_some_sql(async_session)

            await engine.dispose()

    The :class:`.async_sessionmaker` is useful so that different parts
    of a program can create new :class:`.AsyncSession` objects with a
    fixed configuration established up front.  Note that :class:`.AsyncSession`
    objects may also be instantiated directly when not using
    :class:`.async_sessionmaker`.

    .. versionadded:: 2.0  :class:`.async_sessionmaker` provides a
       :class:`.sessionmaker` class that's dedicated to the
       :class:`.AsyncSession` object, including pep-484 typing support.

    .. seealso::

        :ref:`asyncio_orm` - shows example use

        :class:`.sessionmaker`  - general overview of the
         :class:`.sessionmaker` architecture


        :ref:`session_getting` - introductory text on creating
        sessions using :class:`.sessionmaker`.

    """  # noqa E501

    class_: Type[_AS]

    @overload
    def __init__(
        self,
        bind: Optional[_AsyncSessionBind] = ...,
        *,
        class_: Type[_AS],
        autoflush: bool = ...,
        expire_on_commit: bool = ...,
        info: Optional[_InfoType] = ...,
        **kw: Any,
    ):
        ...

    @overload
    def __init__(
        self: "async_sessionmaker[AsyncSession]",
        bind: Optional[_AsyncSessionBind] = ...,
        *,
        autoflush: bool = ...,
        expire_on_commit: bool = ...,
        info: Optional[_InfoType] = ...,
        **kw: Any,
    ):
        ...

    def __init__(
        self,
        bind: Optional[_AsyncSessionBind] = None,
        *,
        class_: Type[_AS] = AsyncSession,  # type: ignore
        autoflush: bool = True,
        expire_on_commit: bool = True,
        info: Optional[_InfoType] = None,
        **kw: Any,
    ):
        r"""Construct a new :class:`.async_sessionmaker`.

        All arguments here except for ``class_`` correspond to arguments
        accepted by :class:`.Session` directly. See the
        :meth:`.AsyncSession.__init__` docstring for more details on
        parameters.


        """
        kw["bind"] = bind
        kw["autoflush"] = autoflush
        kw["expire_on_commit"] = expire_on_commit
        if info is not None:
            kw["info"] = info
        self.kw = kw
        self.class_ = class_

    def begin(self) -> _AsyncSessionContextManager[_AS]:
        """Produce a context manager that both provides a new
        :class:`_orm.AsyncSession` as well as a transaction that commits.


        e.g.::

            async def main():
                Session = async_sessionmaker(some_engine)

                async with Session.begin() as session:
                    session.add(some_object)

                # commits transaction, closes session


        """

        session = self()
        return session._maker_context_manager()

    def __call__(self, **local_kw: Any) -> _AS:
        """Produce a new :class:`.AsyncSession` object using the configuration
        established in this :class:`.async_sessionmaker`.

        In Python, the ``__call__`` method is invoked on an object when
        it is "called" in the same way as a function::

            AsyncSession = async_sessionmaker(async_engine, expire_on_commit=False)
            session = AsyncSession()  # invokes sessionmaker.__call__()

        """  # noqa E501
        for k, v in self.kw.items():
            if k == "info" and "info" in local_kw:
                d = v.copy()
                d.update(local_kw["info"])
                local_kw["info"] = d
            else:
                local_kw.setdefault(k, v)
        return self.class_(**local_kw)

    def configure(self, **new_kw: Any) -> None:
        """(Re)configure the arguments for this async_sessionmaker.

        e.g.::

            AsyncSession = async_sessionmaker(some_engine)

            AsyncSession.configure(bind=create_async_engine('sqlite+aiosqlite://'))
        """  # noqa E501

        self.kw.update(new_kw)

    def __repr__(self) -> str:
        return "%s(class_=%r, %s)" % (
            self.__class__.__name__,
            self.class_.__name__,
            ", ".join("%s=%r" % (k, v) for k, v in self.kw.items()),
        )


class _AsyncSessionContextManager(Generic[_AS]):
    __slots__ = ("async_session", "trans")

    async_session: _AS
    trans: AsyncSessionTransaction

    def __init__(self, async_session: _AS):
        self.async_session = async_session

    async def __aenter__(self) -> _AS:
        self.trans = self.async_session.begin()
        await self.trans.__aenter__()
        return self.async_session

    async def __aexit__(self, type_: Any, value: Any, traceback: Any) -> None:
        async def go() -> None:
            await self.trans.__aexit__(type_, value, traceback)
            await self.async_session.__aexit__(type_, value, traceback)

        task = asyncio.create_task(go())
        await asyncio.shield(task)


class AsyncSessionTransaction(
    ReversibleProxy[SessionTransaction],
    StartableContext["AsyncSessionTransaction"],
):
    """A wrapper for the ORM :class:`_orm.SessionTransaction` object.

    This object is provided so that a transaction-holding object
    for the :meth:`_asyncio.AsyncSession.begin` may be returned.

    The object supports both explicit calls to
    :meth:`_asyncio.AsyncSessionTransaction.commit` and
    :meth:`_asyncio.AsyncSessionTransaction.rollback`, as well as use as an
    async context manager.


    .. versionadded:: 1.4

    """

    __slots__ = ("session", "sync_transaction", "nested")

    session: AsyncSession
    sync_transaction: Optional[SessionTransaction]

    def __init__(self, session: AsyncSession, nested: bool = False):
        self.session = session
        self.nested = nested
        self.sync_transaction = None

    @property
    def is_active(self) -> bool:
        return (
            self._sync_transaction() is not None
            and self._sync_transaction().is_active
        )

    def _sync_transaction(self) -> SessionTransaction:
        if not self.sync_transaction:
            self._raise_for_not_started()
        return self.sync_transaction

    async def rollback(self) -> None:
        """Roll back this :class:`_asyncio.AsyncTransaction`."""
        await greenlet_spawn(self._sync_transaction().rollback)

    async def commit(self) -> None:
        """Commit this :class:`_asyncio.AsyncTransaction`."""

        await greenlet_spawn(self._sync_transaction().commit)

    async def start(
        self, is_ctxmanager: bool = False
    ) -> AsyncSessionTransaction:
        self.sync_transaction = self._assign_proxied(
            await greenlet_spawn(
                self.session.sync_session.begin_nested  # type: ignore
                if self.nested
                else self.session.sync_session.begin
            )
        )
        if is_ctxmanager:
            self.sync_transaction.__enter__()
        return self

    async def __aexit__(self, type_: Any, value: Any, traceback: Any) -> None:
        await greenlet_spawn(
            self._sync_transaction().__exit__, type_, value, traceback
        )


def async_object_session(instance: object) -> Optional[AsyncSession]:
    """Return the :class:`_asyncio.AsyncSession` to which the given instance
    belongs.

    This function makes use of the sync-API function
    :class:`_orm.object_session` to retrieve the :class:`_orm.Session` which
    refers to the given instance, and from there links it to the original
    :class:`_asyncio.AsyncSession`.

    If the :class:`_asyncio.AsyncSession` has been garbage collected, the
    return value is ``None``.

    This functionality is also available from the
    :attr:`_orm.InstanceState.async_session` accessor.

    :param instance: an ORM mapped instance
    :return: an :class:`_asyncio.AsyncSession` object, or ``None``.

    .. versionadded:: 1.4.18

    """

    session = object_session(instance)
    if session is not None:
        return async_session(session)
    else:
        return None


def async_session(session: Session) -> Optional[AsyncSession]:
    """Return the :class:`_asyncio.AsyncSession` which is proxying the given
    :class:`_orm.Session` object, if any.

    :param session: a :class:`_orm.Session` instance.
    :return: a :class:`_asyncio.AsyncSession` instance, or ``None``.

    .. versionadded:: 1.4.18

    """
    return AsyncSession._retrieve_proxy_for_target(session, regenerate=False)


async def close_all_sessions() -> None:
    """Close all :class:`_asyncio.AsyncSession` sessions.

    .. versionadded:: 2.0.23

    .. seealso::

        :func:`.session.close_all_sessions`

    """
    await greenlet_spawn(_sync_close_all_sessions)


_instance_state._async_provider = async_session  # type: ignore
