# pool/base.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php


"""Base constructs for connection pools.

"""

from __future__ import annotations

from collections import deque
import dataclasses
from enum import Enum
import threading
import time
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Deque
from typing import Dict
from typing import List
from typing import Optional
from typing import Tuple
from typing import TYPE_CHECKING
from typing import Union
import weakref

from .. import event
from .. import exc
from .. import log
from .. import util
from ..util.typing import Literal
from ..util.typing import Protocol

if TYPE_CHECKING:
    from ..engine.interfaces import DBAPIConnection
    from ..engine.interfaces import DBAPICursor
    from ..engine.interfaces import Dialect
    from ..event import _DispatchCommon
    from ..event import _ListenerFnType
    from ..event import dispatcher
    from ..sql._typing import _InfoType


@dataclasses.dataclass(frozen=True)
class PoolResetState:
    """describes the state of a DBAPI connection as it is being passed to
    the :meth:`.PoolEvents.reset` connection pool event.

    .. versionadded:: 2.0.0b3

    """

    __slots__ = ("transaction_was_reset", "terminate_only", "asyncio_safe")

    transaction_was_reset: bool
    """Indicates if the transaction on the DBAPI connection was already
    essentially "reset" back by the :class:`.Connection` object.

    This boolean is True if the :class:`.Connection` had transactional
    state present upon it, which was then not closed using the
    :meth:`.Connection.rollback` or :meth:`.Connection.commit` method;
    instead, the transaction was closed inline within the
    :meth:`.Connection.close` method so is guaranteed to remain non-present
    when this event is reached.

    """

    terminate_only: bool
    """indicates if the connection is to be immediately terminated and
    not checked in to the pool.

    This occurs for connections that were invalidated, as well as asyncio
    connections that were not cleanly handled by the calling code that
    are instead being garbage collected.   In the latter case,
    operations can't be safely run on asyncio connections within garbage
    collection as there is not necessarily an event loop present.

    """

    asyncio_safe: bool
    """Indicates if the reset operation is occurring within a scope where
    an enclosing event loop is expected to be present for asyncio applications.

    Will be False in the case that the connection is being garbage collected.

    """


class ResetStyle(Enum):
    """Describe options for "reset on return" behaviors."""

    reset_rollback = 0
    reset_commit = 1
    reset_none = 2


_ResetStyleArgType = Union[
    ResetStyle,
    Literal[True, None, False, "commit", "rollback"],
]
reset_rollback, reset_commit, reset_none = list(ResetStyle)


class _ConnDialect:
    """partial implementation of :class:`.Dialect`
    which provides DBAPI connection methods.

    When a :class:`_pool.Pool` is combined with an :class:`_engine.Engine`,
    the :class:`_engine.Engine` replaces this with its own
    :class:`.Dialect`.

    """

    is_async = False
    has_terminate = False

    def do_rollback(self, dbapi_connection: PoolProxiedConnection) -> None:
        dbapi_connection.rollback()

    def do_commit(self, dbapi_connection: PoolProxiedConnection) -> None:
        dbapi_connection.commit()

    def do_terminate(self, dbapi_connection: DBAPIConnection) -> None:
        dbapi_connection.close()

    def do_close(self, dbapi_connection: DBAPIConnection) -> None:
        dbapi_connection.close()

    def _do_ping_w_event(self, dbapi_connection: DBAPIConnection) -> bool:
        raise NotImplementedError(
            "The ping feature requires that a dialect is "
            "passed to the connection pool."
        )

    def get_driver_connection(self, connection: DBAPIConnection) -> Any:
        return connection


class _AsyncConnDialect(_ConnDialect):
    is_async = True


class _CreatorFnType(Protocol):
    def __call__(self) -> DBAPIConnection:
        ...


class _CreatorWRecFnType(Protocol):
    def __call__(self, rec: ConnectionPoolEntry) -> DBAPIConnection:
        ...


class Pool(log.Identified, event.EventTarget):

    """Abstract base class for connection pools."""

    dispatch: dispatcher[Pool]
    echo: log._EchoFlagType

    _orig_logging_name: Optional[str]
    _dialect: Union[_ConnDialect, Dialect] = _ConnDialect()
    _creator_arg: Union[_CreatorFnType, _CreatorWRecFnType]
    _invoke_creator: _CreatorWRecFnType
    _invalidate_time: float

    def __init__(
        self,
        creator: Union[_CreatorFnType, _CreatorWRecFnType],
        recycle: int = -1,
        echo: log._EchoFlagType = None,
        logging_name: Optional[str] = None,
        reset_on_return: _ResetStyleArgType = True,
        events: Optional[List[Tuple[_ListenerFnType, str]]] = None,
        dialect: Optional[Union[_ConnDialect, Dialect]] = None,
        pre_ping: bool = False,
        _dispatch: Optional[_DispatchCommon[Pool]] = None,
    ):
        """
        Construct a Pool.

        :param creator: a callable function that returns a DB-API
          connection object.  The function will be called with
          parameters.

        :param recycle: If set to a value other than -1, number of
          seconds between connection recycling, which means upon
          checkout, if this timeout is surpassed the connection will be
          closed and replaced with a newly opened connection. Defaults to -1.

        :param logging_name:  String identifier which will be used within
          the "name" field of logging records generated within the
          "sqlalchemy.pool" logger. Defaults to a hexstring of the object's
          id.

        :param echo: if True, the connection pool will log
         informational output such as when connections are invalidated
         as well as when connections are recycled to the default log handler,
         which defaults to ``sys.stdout`` for output..   If set to the string
         ``"debug"``, the logging will include pool checkouts and checkins.

         The :paramref:`_pool.Pool.echo` parameter can also be set from the
         :func:`_sa.create_engine` call by using the
         :paramref:`_sa.create_engine.echo_pool` parameter.

         .. seealso::

             :ref:`dbengine_logging` - further detail on how to configure
             logging.

        :param reset_on_return: Determine steps to take on
         connections as they are returned to the pool, which were
         not otherwise handled by a :class:`_engine.Connection`.
         Available from :func:`_sa.create_engine` via the
         :paramref:`_sa.create_engine.pool_reset_on_return` parameter.

         :paramref:`_pool.Pool.reset_on_return` can have any of these values:

         * ``"rollback"`` - call rollback() on the connection,
           to release locks and transaction resources.
           This is the default value.  The vast majority
           of use cases should leave this value set.
         * ``"commit"`` - call commit() on the connection,
           to release locks and transaction resources.
           A commit here may be desirable for databases that
           cache query plans if a commit is emitted,
           such as Microsoft SQL Server.  However, this
           value is more dangerous than 'rollback' because
           any data changes present on the transaction
           are committed unconditionally.
         * ``None`` - don't do anything on the connection.
           This setting may be appropriate if the database / DBAPI
           works in pure "autocommit" mode at all times, or if
           a custom reset handler is established using the
           :meth:`.PoolEvents.reset` event handler.

         * ``True`` - same as 'rollback', this is here for
           backwards compatibility.
         * ``False`` - same as None, this is here for
           backwards compatibility.

         For further customization of reset on return, the
         :meth:`.PoolEvents.reset` event hook may be used which can perform
         any connection activity desired on reset.

         .. seealso::

            :ref:`pool_reset_on_return`

            :meth:`.PoolEvents.reset`

        :param events: a list of 2-tuples, each of the form
         ``(callable, target)`` which will be passed to :func:`.event.listen`
         upon construction.   Provided here so that event listeners
         can be assigned via :func:`_sa.create_engine` before dialect-level
         listeners are applied.

        :param dialect: a :class:`.Dialect` that will handle the job
         of calling rollback(), close(), or commit() on DBAPI connections.
         If omitted, a built-in "stub" dialect is used.   Applications that
         make use of :func:`_sa.create_engine` should not use this parameter
         as it is handled by the engine creation strategy.

        :param pre_ping: if True, the pool will emit a "ping" (typically
         "SELECT 1", but is dialect-specific) on the connection
         upon checkout, to test if the connection is alive or not.   If not,
         the connection is transparently re-connected and upon success, all
         other pooled connections established prior to that timestamp are
         invalidated.     Requires that a dialect is passed as well to
         interpret the disconnection error.

         .. versionadded:: 1.2

        """
        if logging_name:
            self.logging_name = self._orig_logging_name = logging_name
        else:
            self._orig_logging_name = None

        log.instance_logger(self, echoflag=echo)
        self._creator = creator
        self._recycle = recycle
        self._invalidate_time = 0
        self._pre_ping = pre_ping
        self._reset_on_return = util.parse_user_argument_for_enum(
            reset_on_return,
            {
                ResetStyle.reset_rollback: ["rollback", True],
                ResetStyle.reset_none: ["none", None, False],
                ResetStyle.reset_commit: ["commit"],
            },
            "reset_on_return",
        )

        self.echo = echo

        if _dispatch:
            self.dispatch._update(_dispatch, only_propagate=False)
        if dialect:
            self._dialect = dialect
        if events:
            for fn, target in events:
                event.listen(self, target, fn)

    @util.hybridproperty
    def _is_asyncio(self) -> bool:
        return self._dialect.is_async

    @property
    def _creator(self) -> Union[_CreatorFnType, _CreatorWRecFnType]:
        return self._creator_arg

    @_creator.setter
    def _creator(
        self, creator: Union[_CreatorFnType, _CreatorWRecFnType]
    ) -> None:
        self._creator_arg = creator

        # mypy seems to get super confused assigning functions to
        # attributes
        self._invoke_creator = self._should_wrap_creator(creator)

    @_creator.deleter
    def _creator(self) -> None:
        # needed for mock testing
        del self._creator_arg
        del self._invoke_creator

    def _should_wrap_creator(
        self, creator: Union[_CreatorFnType, _CreatorWRecFnType]
    ) -> _CreatorWRecFnType:
        """Detect if creator accepts a single argument, or is sent
        as a legacy style no-arg function.

        """

        try:
            argspec = util.get_callable_argspec(self._creator, no_self=True)
        except TypeError:
            creator_fn = cast(_CreatorFnType, creator)
            return lambda rec: creator_fn()

        if argspec.defaults is not None:
            defaulted = len(argspec.defaults)
        else:
            defaulted = 0
        positionals = len(argspec[0]) - defaulted

        # look for the exact arg signature that DefaultStrategy
        # sends us
        if (argspec[0], argspec[3]) == (["connection_record"], (None,)):
            return cast(_CreatorWRecFnType, creator)
        # or just a single positional
        elif positionals == 1:
            return cast(_CreatorWRecFnType, creator)
        # all other cases, just wrap and assume legacy "creator" callable
        # thing
        else:
            creator_fn = cast(_CreatorFnType, creator)
            return lambda rec: creator_fn()

    def _close_connection(
        self, connection: DBAPIConnection, *, terminate: bool = False
    ) -> None:
        self.logger.debug(
            "%s connection %r",
            "Hard-closing" if terminate else "Closing",
            connection,
        )
        try:
            if terminate:
                self._dialect.do_terminate(connection)
            else:
                self._dialect.do_close(connection)
        except BaseException as e:
            self.logger.error(
                f"Exception {'terminating' if terminate else 'closing'} "
                f"connection %r",
                connection,
                exc_info=True,
            )
            if not isinstance(e, Exception):
                raise

    def _create_connection(self) -> ConnectionPoolEntry:
        """Called by subclasses to create a new ConnectionRecord."""

        return _ConnectionRecord(self)

    def _invalidate(
        self,
        connection: PoolProxiedConnection,
        exception: Optional[BaseException] = None,
        _checkin: bool = True,
    ) -> None:
        """Mark all connections established within the generation
        of the given connection as invalidated.

        If this pool's last invalidate time is before when the given
        connection was created, update the timestamp til now.  Otherwise,
        no action is performed.

        Connections with a start time prior to this pool's invalidation
        time will be recycled upon next checkout.
        """
        rec = getattr(connection, "_connection_record", None)
        if not rec or self._invalidate_time < rec.starttime:
            self._invalidate_time = time.time()
        if _checkin and getattr(connection, "is_valid", False):
            connection.invalidate(exception)

    def recreate(self) -> Pool:
        """Return a new :class:`_pool.Pool`, of the same class as this one
        and configured with identical creation arguments.

        This method is used in conjunction with :meth:`dispose`
        to close out an entire :class:`_pool.Pool` and create a new one in
        its place.

        """

        raise NotImplementedError()

    def dispose(self) -> None:
        """Dispose of this pool.

        This method leaves the possibility of checked-out connections
        remaining open, as it only affects connections that are
        idle in the pool.

        .. seealso::

            :meth:`Pool.recreate`

        """

        raise NotImplementedError()

    def connect(self) -> PoolProxiedConnection:
        """Return a DBAPI connection from the pool.

        The connection is instrumented such that when its
        ``close()`` method is called, the connection will be returned to
        the pool.

        """
        return _ConnectionFairy._checkout(self)

    def _return_conn(self, record: ConnectionPoolEntry) -> None:
        """Given a _ConnectionRecord, return it to the :class:`_pool.Pool`.

        This method is called when an instrumented DBAPI connection
        has its ``close()`` method called.

        """
        self._do_return_conn(record)

    def _do_get(self) -> ConnectionPoolEntry:
        """Implementation for :meth:`get`, supplied by subclasses."""

        raise NotImplementedError()

    def _do_return_conn(self, record: ConnectionPoolEntry) -> None:
        """Implementation for :meth:`return_conn`, supplied by subclasses."""

        raise NotImplementedError()

    def status(self) -> str:
        raise NotImplementedError()


class ManagesConnection:
    """Common base for the two connection-management interfaces
    :class:`.PoolProxiedConnection` and :class:`.ConnectionPoolEntry`.

    These two objects are typically exposed in the public facing API
    via the connection pool event hooks, documented at :class:`.PoolEvents`.

    .. versionadded:: 2.0

    """

    __slots__ = ()

    dbapi_connection: Optional[DBAPIConnection]
    """A reference to the actual DBAPI connection being tracked.

    This is a :pep:`249`-compliant object that for traditional sync-style
    dialects is provided by the third-party
    DBAPI implementation in use.  For asyncio dialects, the implementation
    is typically an adapter object provided by the SQLAlchemy dialect
    itself; the underlying asyncio object is available via the
    :attr:`.ManagesConnection.driver_connection` attribute.

    SQLAlchemy's interface for the DBAPI connection is based on the
    :class:`.DBAPIConnection` protocol object

    .. seealso::

        :attr:`.ManagesConnection.driver_connection`

        :ref:`faq_dbapi_connection`

    """

    driver_connection: Optional[Any]
    """The "driver level" connection object as used by the Python
    DBAPI or database driver.

    For traditional :pep:`249` DBAPI implementations, this object will
    be the same object as that of
    :attr:`.ManagesConnection.dbapi_connection`.   For an asyncio database
    driver, this will be the ultimate "connection" object used by that
    driver, such as the ``asyncpg.Connection`` object which will not have
    standard pep-249 methods.

    .. versionadded:: 1.4.24

    .. seealso::

        :attr:`.ManagesConnection.dbapi_connection`

        :ref:`faq_dbapi_connection`

    """

    @util.ro_memoized_property
    def info(self) -> _InfoType:
        """Info dictionary associated with the underlying DBAPI connection
        referred to by this :class:`.ManagesConnection` instance, allowing
        user-defined data to be associated with the connection.

        The data in this dictionary is persistent for the lifespan
        of the DBAPI connection itself, including across pool checkins
        and checkouts.  When the connection is invalidated
        and replaced with a new one, this dictionary is cleared.

        For a :class:`.PoolProxiedConnection` instance that's not associated
        with a :class:`.ConnectionPoolEntry`, such as if it were detached, the
        attribute returns a dictionary that is local to that
        :class:`.ConnectionPoolEntry`. Therefore the
        :attr:`.ManagesConnection.info` attribute will always provide a Python
        dictionary.

        .. seealso::

            :attr:`.ManagesConnection.record_info`


        """
        raise NotImplementedError()

    @util.ro_memoized_property
    def record_info(self) -> Optional[_InfoType]:
        """Persistent info dictionary associated with this
        :class:`.ManagesConnection`.

        Unlike the :attr:`.ManagesConnection.info` dictionary, the lifespan
        of this dictionary is that of the :class:`.ConnectionPoolEntry`
        which owns it; therefore this dictionary will persist across
        reconnects and connection invalidation for a particular entry
        in the connection pool.

        For a :class:`.PoolProxiedConnection` instance that's not associated
        with a :class:`.ConnectionPoolEntry`, such as if it were detached, the
        attribute returns None. Contrast to the :attr:`.ManagesConnection.info`
        dictionary which is never None.


        .. seealso::

            :attr:`.ManagesConnection.info`

        """
        raise NotImplementedError()

    def invalidate(
        self, e: Optional[BaseException] = None, soft: bool = False
    ) -> None:
        """Mark the managed connection as invalidated.

        :param e: an exception object indicating a reason for the invalidation.

        :param soft: if True, the connection isn't closed; instead, this
         connection will be recycled on next checkout.

        .. seealso::

            :ref:`pool_connection_invalidation`


        """
        raise NotImplementedError()


class ConnectionPoolEntry(ManagesConnection):
    """Interface for the object that maintains an individual database
    connection on behalf of a :class:`_pool.Pool` instance.

    The :class:`.ConnectionPoolEntry` object represents the long term
    maintainance of a particular connection for a pool, including expiring or
    invalidating that connection to have it replaced with a new one, which will
    continue to be maintained by that same :class:`.ConnectionPoolEntry`
    instance. Compared to :class:`.PoolProxiedConnection`, which is the
    short-term, per-checkout connection manager, this object lasts for the
    lifespan of a particular "slot" within a connection pool.

    The :class:`.ConnectionPoolEntry` object is mostly visible to public-facing
    API code when it is delivered to connection pool event hooks, such as
    :meth:`_events.PoolEvents.connect` and :meth:`_events.PoolEvents.checkout`.

    .. versionadded:: 2.0  :class:`.ConnectionPoolEntry` provides the public
       facing interface for the :class:`._ConnectionRecord` internal class.

    """

    __slots__ = ()

    @property
    def in_use(self) -> bool:
        """Return True the connection is currently checked out"""

        raise NotImplementedError()

    def close(self) -> None:
        """Close the DBAPI connection managed by this connection pool entry."""
        raise NotImplementedError()


class _ConnectionRecord(ConnectionPoolEntry):

    """Maintains a position in a connection pool which references a pooled
    connection.

    This is an internal object used by the :class:`_pool.Pool` implementation
    to provide context management to a DBAPI connection maintained by
    that :class:`_pool.Pool`.   The public facing interface for this class
    is described by the :class:`.ConnectionPoolEntry` class.  See that
    class for public API details.

    .. seealso::

        :class:`.ConnectionPoolEntry`

        :class:`.PoolProxiedConnection`

    """

    __slots__ = (
        "__pool",
        "fairy_ref",
        "finalize_callback",
        "fresh",
        "starttime",
        "dbapi_connection",
        "__weakref__",
        "__dict__",
    )

    finalize_callback: Deque[Callable[[DBAPIConnection], None]]
    fresh: bool
    fairy_ref: Optional[weakref.ref[_ConnectionFairy]]
    starttime: float

    def __init__(self, pool: Pool, connect: bool = True):
        self.fresh = False
        self.fairy_ref = None
        self.starttime = 0
        self.dbapi_connection = None

        self.__pool = pool
        if connect:
            self.__connect()
        self.finalize_callback = deque()

    dbapi_connection: Optional[DBAPIConnection]

    @property
    def driver_connection(self) -> Optional[Any]:  # type: ignore[override]  # mypy#4125  # noqa: E501
        if self.dbapi_connection is None:
            return None
        else:
            return self.__pool._dialect.get_driver_connection(
                self.dbapi_connection
            )

    @property
    @util.deprecated(
        "2.0",
        "The _ConnectionRecord.connection attribute is deprecated; "
        "please use 'driver_connection'",
    )
    def connection(self) -> Optional[DBAPIConnection]:
        return self.dbapi_connection

    _soft_invalidate_time: float = 0

    @util.ro_memoized_property
    def info(self) -> _InfoType:
        return {}

    @util.ro_memoized_property
    def record_info(self) -> Optional[_InfoType]:
        return {}

    @classmethod
    def checkout(cls, pool: Pool) -> _ConnectionFairy:
        if TYPE_CHECKING:
            rec = cast(_ConnectionRecord, pool._do_get())
        else:
            rec = pool._do_get()

        try:
            dbapi_connection = rec.get_connection()
        except BaseException as err:
            with util.safe_reraise():
                rec._checkin_failed(err, _fairy_was_created=False)

            # not reached, for code linters only
            raise

        echo = pool._should_log_debug()
        fairy = _ConnectionFairy(pool, dbapi_connection, rec, echo)

        rec.fairy_ref = ref = weakref.ref(
            fairy,
            lambda ref: _finalize_fairy(
                None, rec, pool, ref, echo, transaction_was_reset=False
            )
            if _finalize_fairy is not None
            else None,
        )
        _strong_ref_connection_records[ref] = rec
        if echo:
            pool.logger.debug(
                "Connection %r checked out from pool", dbapi_connection
            )
        return fairy

    def _checkin_failed(
        self, err: BaseException, _fairy_was_created: bool = True
    ) -> None:
        self.invalidate(e=err)
        self.checkin(
            _fairy_was_created=_fairy_was_created,
        )

    def checkin(self, _fairy_was_created: bool = True) -> None:
        if self.fairy_ref is None and _fairy_was_created:
            # _fairy_was_created is False for the initial get connection phase;
            # meaning there was no _ConnectionFairy and we must unconditionally
            # do a checkin.
            #
            # otherwise, if fairy_was_created==True, if fairy_ref is None here
            # that means we were checked in already, so this looks like
            # a double checkin.
            util.warn("Double checkin attempted on %s" % self)
            return
        self.fairy_ref = None
        connection = self.dbapi_connection
        pool = self.__pool
        while self.finalize_callback:
            finalizer = self.finalize_callback.pop()
            if connection is not None:
                finalizer(connection)
        if pool.dispatch.checkin:
            pool.dispatch.checkin(connection, self)

        pool._return_conn(self)

    @property
    def in_use(self) -> bool:
        return self.fairy_ref is not None

    @property
    def last_connect_time(self) -> float:
        return self.starttime

    def close(self) -> None:
        if self.dbapi_connection is not None:
            self.__close()

    def invalidate(
        self, e: Optional[BaseException] = None, soft: bool = False
    ) -> None:
        # already invalidated
        if self.dbapi_connection is None:
            return
        if soft:
            self.__pool.dispatch.soft_invalidate(
                self.dbapi_connection, self, e
            )
        else:
            self.__pool.dispatch.invalidate(self.dbapi_connection, self, e)
        if e is not None:
            self.__pool.logger.info(
                "%sInvalidate connection %r (reason: %s:%s)",
                "Soft " if soft else "",
                self.dbapi_connection,
                e.__class__.__name__,
                e,
            )
        else:
            self.__pool.logger.info(
                "%sInvalidate connection %r",
                "Soft " if soft else "",
                self.dbapi_connection,
            )

        if soft:
            self._soft_invalidate_time = time.time()
        else:
            self.__close(terminate=True)
            self.dbapi_connection = None

    def get_connection(self) -> DBAPIConnection:
        recycle = False

        # NOTE: the various comparisons here are assuming that measurable time
        # passes between these state changes.  however, time.time() is not
        # guaranteed to have sub-second precision.  comparisons of
        # "invalidation time" to "starttime" should perhaps use >= so that the
        # state change can take place assuming no measurable  time has passed,
        # however this does not guarantee correct behavior here as if time
        # continues to not pass, it will try to reconnect repeatedly until
        # these timestamps diverge, so in that sense using > is safer.  Per
        # https://stackoverflow.com/a/1938096/34549, Windows time.time() may be
        # within 16 milliseconds accuracy, so unit tests for connection
        # invalidation need a sleep of at least this long between initial start
        # time and invalidation for the logic below to work reliably.

        if self.dbapi_connection is None:
            self.info.clear()
            self.__connect()
        elif (
            self.__pool._recycle > -1
            and time.time() - self.starttime > self.__pool._recycle
        ):
            self.__pool.logger.info(
                "Connection %r exceeded timeout; recycling",
                self.dbapi_connection,
            )
            recycle = True
        elif self.__pool._invalidate_time > self.starttime:
            self.__pool.logger.info(
                "Connection %r invalidated due to pool invalidation; "
                + "recycling",
                self.dbapi_connection,
            )
            recycle = True
        elif self._soft_invalidate_time > self.starttime:
            self.__pool.logger.info(
                "Connection %r invalidated due to local soft invalidation; "
                + "recycling",
                self.dbapi_connection,
            )
            recycle = True

        if recycle:
            self.__close(terminate=True)
            self.info.clear()

            self.__connect()

        assert self.dbapi_connection is not None
        return self.dbapi_connection

    def _is_hard_or_soft_invalidated(self) -> bool:
        return (
            self.dbapi_connection is None
            or self.__pool._invalidate_time > self.starttime
            or (self._soft_invalidate_time > self.starttime)
        )

    def __close(self, *, terminate: bool = False) -> None:
        self.finalize_callback.clear()
        if self.__pool.dispatch.close:
            self.__pool.dispatch.close(self.dbapi_connection, self)
        assert self.dbapi_connection is not None
        self.__pool._close_connection(
            self.dbapi_connection, terminate=terminate
        )
        self.dbapi_connection = None

    def __connect(self) -> None:
        pool = self.__pool

        # ensure any existing connection is removed, so that if
        # creator fails, this attribute stays None
        self.dbapi_connection = None
        try:
            self.starttime = time.time()
            self.dbapi_connection = connection = pool._invoke_creator(self)
            pool.logger.debug("Created new connection %r", connection)
            self.fresh = True
        except BaseException as e:
            with util.safe_reraise():
                pool.logger.debug("Error on connect(): %s", e)
        else:
            # in SQLAlchemy 1.4 the first_connect event is not used by
            # the engine, so this will usually not be set
            if pool.dispatch.first_connect:
                pool.dispatch.first_connect.for_modify(
                    pool.dispatch
                ).exec_once_unless_exception(self.dbapi_connection, self)

            # init of the dialect now takes place within the connect
            # event, so ensure a mutex is used on the first run
            pool.dispatch.connect.for_modify(
                pool.dispatch
            )._exec_w_sync_on_first_run(self.dbapi_connection, self)


def _finalize_fairy(
    dbapi_connection: Optional[DBAPIConnection],
    connection_record: Optional[_ConnectionRecord],
    pool: Pool,
    ref: Optional[
        weakref.ref[_ConnectionFairy]
    ],  # this is None when called directly, not by the gc
    echo: Optional[log._EchoFlagType],
    transaction_was_reset: bool = False,
    fairy: Optional[_ConnectionFairy] = None,
) -> None:
    """Cleanup for a :class:`._ConnectionFairy` whether or not it's already
    been garbage collected.

    When using an async dialect no IO can happen here (without using
    a dedicated thread), since this is called outside the greenlet
    context and with an already running loop. In this case function
    will only log a message and raise a warning.
    """

    is_gc_cleanup = ref is not None

    if is_gc_cleanup:
        assert ref is not None
        _strong_ref_connection_records.pop(ref, None)
        assert connection_record is not None
        if connection_record.fairy_ref is not ref:
            return
        assert dbapi_connection is None
        dbapi_connection = connection_record.dbapi_connection

    elif fairy:
        _strong_ref_connection_records.pop(weakref.ref(fairy), None)

    # null pool is not _is_asyncio but can be used also with async dialects
    dont_restore_gced = pool._dialect.is_async

    if dont_restore_gced:
        detach = connection_record is None or is_gc_cleanup
        can_manipulate_connection = not is_gc_cleanup
        can_close_or_terminate_connection = (
            not pool._dialect.is_async or pool._dialect.has_terminate
        )
        requires_terminate_for_close = (
            pool._dialect.is_async and pool._dialect.has_terminate
        )

    else:
        detach = connection_record is None
        can_manipulate_connection = can_close_or_terminate_connection = True
        requires_terminate_for_close = False

    if dbapi_connection is not None:
        if connection_record and echo:
            pool.logger.debug(
                "Connection %r being returned to pool", dbapi_connection
            )

        try:
            if not fairy:
                assert connection_record is not None
                fairy = _ConnectionFairy(
                    pool,
                    dbapi_connection,
                    connection_record,
                    echo,
                )
            assert fairy.dbapi_connection is dbapi_connection

            fairy._reset(
                pool,
                transaction_was_reset=transaction_was_reset,
                terminate_only=detach,
                asyncio_safe=can_manipulate_connection,
            )

            if detach:
                if connection_record:
                    fairy._pool = pool
                    fairy.detach()

                if can_close_or_terminate_connection:
                    if pool.dispatch.close_detached:
                        pool.dispatch.close_detached(dbapi_connection)

                    pool._close_connection(
                        dbapi_connection,
                        terminate=requires_terminate_for_close,
                    )

        except BaseException as e:
            pool.logger.error(
                "Exception during reset or similar", exc_info=True
            )
            if connection_record:
                connection_record.invalidate(e=e)
            if not isinstance(e, Exception):
                raise
        finally:
            if detach and is_gc_cleanup and dont_restore_gced:
                message = (
                    "The garbage collector is trying to clean up "
                    f"non-checked-in connection {dbapi_connection!r}, "
                    f"""which will be {
                        'dropped, as it cannot be safely terminated'
                        if not can_close_or_terminate_connection
                        else 'terminated'
                    }.  """
                    "Please ensure that SQLAlchemy pooled connections are "
                    "returned to "
                    "the pool explicitly, either by calling ``close()`` "
                    "or by using appropriate context managers to manage "
                    "their lifecycle."
                )
                pool.logger.error(message)
                util.warn(message)

    if connection_record and connection_record.fairy_ref is not None:
        connection_record.checkin()

    # give gc some help.  See
    # test/engine/test_pool.py::PoolEventsTest::test_checkin_event_gc[True]
    # which actually started failing when pytest warnings plugin was
    # turned on, due to util.warn() above
    if fairy is not None:
        fairy.dbapi_connection = None  # type: ignore
        fairy._connection_record = None
    del dbapi_connection
    del connection_record
    del fairy


# a dictionary of the _ConnectionFairy weakrefs to _ConnectionRecord, so that
# GC under pypy will call ConnectionFairy finalizers.  linked directly to the
# weakref that will empty itself when collected so that it should not create
# any unmanaged memory references.
_strong_ref_connection_records: Dict[
    weakref.ref[_ConnectionFairy], _ConnectionRecord
] = {}


class PoolProxiedConnection(ManagesConnection):
    """A connection-like adapter for a :pep:`249` DBAPI connection, which
    includes additional methods specific to the :class:`.Pool` implementation.

    :class:`.PoolProxiedConnection` is the public-facing interface for the
    internal :class:`._ConnectionFairy` implementation object; users familiar
    with :class:`._ConnectionFairy` can consider this object to be equivalent.

    .. versionadded:: 2.0  :class:`.PoolProxiedConnection` provides the public-
       facing interface for the :class:`._ConnectionFairy` internal class.

    """

    __slots__ = ()

    if typing.TYPE_CHECKING:

        def commit(self) -> None:
            ...

        def cursor(self) -> DBAPICursor:
            ...

        def rollback(self) -> None:
            ...

    @property
    def is_valid(self) -> bool:
        """Return True if this :class:`.PoolProxiedConnection` still refers
        to an active DBAPI connection."""

        raise NotImplementedError()

    @property
    def is_detached(self) -> bool:
        """Return True if this :class:`.PoolProxiedConnection` is detached
        from its pool."""

        raise NotImplementedError()

    def detach(self) -> None:
        """Separate this connection from its Pool.

        This means that the connection will no longer be returned to the
        pool when closed, and will instead be literally closed.  The
        associated :class:`.ConnectionPoolEntry` is de-associated from this
        DBAPI connection.

        Note that any overall connection limiting constraints imposed by a
        Pool implementation may be violated after a detach, as the detached
        connection is removed from the pool's knowledge and control.

        """

        raise NotImplementedError()

    def close(self) -> None:
        """Release this connection back to the pool.

        The :meth:`.PoolProxiedConnection.close` method shadows the
        :pep:`249` ``.close()`` method, altering its behavior to instead
        :term:`release` the proxied connection back to the connection pool.

        Upon release to the pool, whether the connection stays "opened" and
        pooled in the Python process, versus actually closed out and removed
        from the Python process, is based on the pool implementation in use and
        its configuration and current state.

        """
        raise NotImplementedError()


class _AdhocProxiedConnection(PoolProxiedConnection):
    """provides the :class:`.PoolProxiedConnection` interface for cases where
    the DBAPI connection is not actually proxied.

    This is used by the engine internals to pass a consistent
    :class:`.PoolProxiedConnection` object to consuming dialects in response to
    pool events that may not always have the :class:`._ConnectionFairy`
    available.

    """

    __slots__ = ("dbapi_connection", "_connection_record", "_is_valid")

    dbapi_connection: DBAPIConnection
    _connection_record: ConnectionPoolEntry

    def __init__(
        self,
        dbapi_connection: DBAPIConnection,
        connection_record: ConnectionPoolEntry,
    ):
        self.dbapi_connection = dbapi_connection
        self._connection_record = connection_record
        self._is_valid = True

    @property
    def driver_connection(self) -> Any:  # type: ignore[override]  # mypy#4125
        return self._connection_record.driver_connection

    @property
    def connection(self) -> DBAPIConnection:
        return self.dbapi_connection

    @property
    def is_valid(self) -> bool:
        """Implement is_valid state attribute.

        for the adhoc proxied connection it's assumed the connection is valid
        as there is no "invalidate" routine.

        """
        return self._is_valid

    def invalidate(
        self, e: Optional[BaseException] = None, soft: bool = False
    ) -> None:
        self._is_valid = False

    @util.ro_non_memoized_property
    def record_info(self) -> Optional[_InfoType]:
        return self._connection_record.record_info

    def cursor(self, *args: Any, **kwargs: Any) -> DBAPICursor:
        return self.dbapi_connection.cursor(*args, **kwargs)

    def __getattr__(self, key: Any) -> Any:
        return getattr(self.dbapi_connection, key)


class _ConnectionFairy(PoolProxiedConnection):

    """Proxies a DBAPI connection and provides return-on-dereference
    support.

    This is an internal object used by the :class:`_pool.Pool` implementation
    to provide context management to a DBAPI connection delivered by
    that :class:`_pool.Pool`.   The public facing interface for this class
    is described by the :class:`.PoolProxiedConnection` class.  See that
    class for public API details.

    The name "fairy" is inspired by the fact that the
    :class:`._ConnectionFairy` object's lifespan is transitory, as it lasts
    only for the length of a specific DBAPI connection being checked out from
    the pool, and additionally that as a transparent proxy, it is mostly
    invisible.

    .. seealso::

        :class:`.PoolProxiedConnection`

        :class:`.ConnectionPoolEntry`


    """

    __slots__ = (
        "dbapi_connection",
        "_connection_record",
        "_echo",
        "_pool",
        "_counter",
        "__weakref__",
        "__dict__",
    )

    pool: Pool
    dbapi_connection: DBAPIConnection
    _echo: log._EchoFlagType

    def __init__(
        self,
        pool: Pool,
        dbapi_connection: DBAPIConnection,
        connection_record: _ConnectionRecord,
        echo: log._EchoFlagType,
    ):
        self._pool = pool
        self._counter = 0
        self.dbapi_connection = dbapi_connection
        self._connection_record = connection_record
        self._echo = echo

    _connection_record: Optional[_ConnectionRecord]

    @property
    def driver_connection(self) -> Optional[Any]:  # type: ignore[override]  # mypy#4125  # noqa: E501
        if self._connection_record is None:
            return None
        return self._connection_record.driver_connection

    @property
    @util.deprecated(
        "2.0",
        "The _ConnectionFairy.connection attribute is deprecated; "
        "please use 'driver_connection'",
    )
    def connection(self) -> DBAPIConnection:
        return self.dbapi_connection

    @classmethod
    def _checkout(
        cls,
        pool: Pool,
        threadconns: Optional[threading.local] = None,
        fairy: Optional[_ConnectionFairy] = None,
    ) -> _ConnectionFairy:
        if not fairy:
            fairy = _ConnectionRecord.checkout(pool)

            if threadconns is not None:
                threadconns.current = weakref.ref(fairy)

        assert (
            fairy._connection_record is not None
        ), "can't 'checkout' a detached connection fairy"
        assert (
            fairy.dbapi_connection is not None
        ), "can't 'checkout' an invalidated connection fairy"

        fairy._counter += 1
        if (
            not pool.dispatch.checkout and not pool._pre_ping
        ) or fairy._counter != 1:
            return fairy

        # Pool listeners can trigger a reconnection on checkout, as well
        # as the pre-pinger.
        # there are three attempts made here, but note that if the database
        # is not accessible from a connection standpoint, those won't proceed
        # here.

        attempts = 2

        while attempts > 0:
            connection_is_fresh = fairy._connection_record.fresh
            fairy._connection_record.fresh = False
            try:
                if pool._pre_ping:
                    if not connection_is_fresh:
                        if fairy._echo:
                            pool.logger.debug(
                                "Pool pre-ping on connection %s",
                                fairy.dbapi_connection,
                            )
                        result = pool._dialect._do_ping_w_event(
                            fairy.dbapi_connection
                        )
                        if not result:
                            if fairy._echo:
                                pool.logger.debug(
                                    "Pool pre-ping on connection %s failed, "
                                    "will invalidate pool",
                                    fairy.dbapi_connection,
                                )
                            raise exc.InvalidatePoolError()
                    elif fairy._echo:
                        pool.logger.debug(
                            "Connection %s is fresh, skipping pre-ping",
                            fairy.dbapi_connection,
                        )

                pool.dispatch.checkout(
                    fairy.dbapi_connection, fairy._connection_record, fairy
                )
                return fairy
            except exc.DisconnectionError as e:
                if e.invalidate_pool:
                    pool.logger.info(
                        "Disconnection detected on checkout, "
                        "invalidating all pooled connections prior to "
                        "current timestamp (reason: %r)",
                        e,
                    )
                    fairy._connection_record.invalidate(e)
                    pool._invalidate(fairy, e, _checkin=False)
                else:
                    pool.logger.info(
                        "Disconnection detected on checkout, "
                        "invalidating individual connection %s (reason: %r)",
                        fairy.dbapi_connection,
                        e,
                    )
                    fairy._connection_record.invalidate(e)
                try:
                    fairy.dbapi_connection = (
                        fairy._connection_record.get_connection()
                    )
                except BaseException as err:
                    with util.safe_reraise():
                        fairy._connection_record._checkin_failed(
                            err,
                            _fairy_was_created=True,
                        )

                        # prevent _ConnectionFairy from being carried
                        # in the stack trace.  Do this after the
                        # connection record has been checked in, so that
                        # if the del triggers a finalize fairy, it won't
                        # try to checkin a second time.
                        del fairy

                    # never called, this is for code linters
                    raise

                attempts -= 1
            except BaseException as be_outer:
                with util.safe_reraise():
                    rec = fairy._connection_record
                    if rec is not None:
                        rec._checkin_failed(
                            be_outer,
                            _fairy_was_created=True,
                        )

                    # prevent _ConnectionFairy from being carried
                    # in the stack trace, see above
                    del fairy

                # never called, this is for code linters
                raise

        pool.logger.info("Reconnection attempts exhausted on checkout")
        fairy.invalidate()
        raise exc.InvalidRequestError("This connection is closed")

    def _checkout_existing(self) -> _ConnectionFairy:
        return _ConnectionFairy._checkout(self._pool, fairy=self)

    def _checkin(self, transaction_was_reset: bool = False) -> None:
        _finalize_fairy(
            self.dbapi_connection,
            self._connection_record,
            self._pool,
            None,
            self._echo,
            transaction_was_reset=transaction_was_reset,
            fairy=self,
        )

    def _close(self) -> None:
        self._checkin()

    def _reset(
        self,
        pool: Pool,
        transaction_was_reset: bool,
        terminate_only: bool,
        asyncio_safe: bool,
    ) -> None:
        if pool.dispatch.reset:
            pool.dispatch.reset(
                self.dbapi_connection,
                self._connection_record,
                PoolResetState(
                    transaction_was_reset=transaction_was_reset,
                    terminate_only=terminate_only,
                    asyncio_safe=asyncio_safe,
                ),
            )

        if not asyncio_safe:
            return

        if pool._reset_on_return is reset_rollback:
            if transaction_was_reset:
                if self._echo:
                    pool.logger.debug(
                        "Connection %s reset, transaction already reset",
                        self.dbapi_connection,
                    )
            else:
                if self._echo:
                    pool.logger.debug(
                        "Connection %s rollback-on-return",
                        self.dbapi_connection,
                    )
                pool._dialect.do_rollback(self)
        elif pool._reset_on_return is reset_commit:
            if self._echo:
                pool.logger.debug(
                    "Connection %s commit-on-return",
                    self.dbapi_connection,
                )
            pool._dialect.do_commit(self)

    @property
    def _logger(self) -> log._IdentifiedLoggerType:
        return self._pool.logger

    @property
    def is_valid(self) -> bool:
        return self.dbapi_connection is not None

    @property
    def is_detached(self) -> bool:
        return self._connection_record is None

    @util.ro_memoized_property
    def info(self) -> _InfoType:
        if self._connection_record is None:
            return {}
        else:
            return self._connection_record.info

    @util.ro_non_memoized_property
    def record_info(self) -> Optional[_InfoType]:
        if self._connection_record is None:
            return None
        else:
            return self._connection_record.record_info

    def invalidate(
        self, e: Optional[BaseException] = None, soft: bool = False
    ) -> None:
        if self.dbapi_connection is None:
            util.warn("Can't invalidate an already-closed connection.")
            return
        if self._connection_record:
            self._connection_record.invalidate(e=e, soft=soft)
        if not soft:
            # prevent any rollback / reset actions etc. on
            # the connection
            self.dbapi_connection = None  # type: ignore

            # finalize
            self._checkin()

    def cursor(self, *args: Any, **kwargs: Any) -> DBAPICursor:
        assert self.dbapi_connection is not None
        return self.dbapi_connection.cursor(*args, **kwargs)

    def __getattr__(self, key: str) -> Any:
        return getattr(self.dbapi_connection, key)

    def detach(self) -> None:
        if self._connection_record is not None:
            rec = self._connection_record
            rec.fairy_ref = None
            rec.dbapi_connection = None
            # TODO: should this be _return_conn?
            self._pool._do_return_conn(self._connection_record)

            # can't get the descriptor assignment to work here
            # in pylance.  mypy is OK w/ it
            self.info = self.info.copy()  # type: ignore

            self._connection_record = None

            if self._pool.dispatch.detach:
                self._pool.dispatch.detach(self.dbapi_connection, rec)

    def close(self) -> None:
        self._counter -= 1
        if self._counter == 0:
            self._checkin()

    def _close_special(self, transaction_reset: bool = False) -> None:
        self._counter -= 1
        if self._counter == 0:
            self._checkin(transaction_was_reset=transaction_reset)
