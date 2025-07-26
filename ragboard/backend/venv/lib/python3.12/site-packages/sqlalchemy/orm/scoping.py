# orm/scoping.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

from __future__ import annotations

from typing import Any
from typing import Callable
from typing import Dict
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from .session import _S
from .session import Session
from .. import exc as sa_exc
from .. import util
from ..util import create_proxy_methods
from ..util import ScopedRegistry
from ..util import ThreadLocalRegistry
from ..util import warn
from ..util import warn_deprecated
from ..util.typing import Protocol

if TYPE_CHECKING:
    from ._typing import _EntityType
    from ._typing import _IdentityKeyType
    from ._typing import OrmExecuteOptionsParameter
    from .identity import IdentityMap
    from .interfaces import ORMOption
    from .mapper import Mapper
    from .query import Query
    from .query import RowReturningQuery
    from .session import _BindArguments
    from .session import _EntityBindKey
    from .session import _PKIdentityArgument
    from .session import _SessionBind
    from .session import sessionmaker
    from .session import SessionTransaction
    from ..engine import Connection
    from ..engine import CursorResult
    from ..engine import Engine
    from ..engine import Result
    from ..engine import Row
    from ..engine import RowMapping
    from ..engine.interfaces import _CoreAnyExecuteParams
    from ..engine.interfaces import _CoreSingleExecuteParams
    from ..engine.interfaces import CoreExecuteOptionsParameter
    from ..engine.result import ScalarResult
    from ..sql._typing import _ColumnsClauseArgument
    from ..sql._typing import _T0
    from ..sql._typing import _T1
    from ..sql._typing import _T2
    from ..sql._typing import _T3
    from ..sql._typing import _T4
    from ..sql._typing import _T5
    from ..sql._typing import _T6
    from ..sql._typing import _T7
    from ..sql._typing import _TypedColumnClauseArgument as _TCCA
    from ..sql.base import Executable
    from ..sql.dml import UpdateBase
    from ..sql.elements import ClauseElement
    from ..sql.roles import TypedColumnsClauseRole
    from ..sql.selectable import ForUpdateParameter
    from ..sql.selectable import TypedReturnsRows

_T = TypeVar("_T", bound=Any)


class QueryPropertyDescriptor(Protocol):
    """Describes the type applied to a class-level
    :meth:`_orm.scoped_session.query_property` attribute.

    .. versionadded:: 2.0.5

    """

    def __get__(self, instance: Any, owner: Type[_T]) -> Query[_T]:
        ...


_O = TypeVar("_O", bound=object)

__all__ = ["scoped_session"]


@create_proxy_methods(
    Session,
    ":class:`_orm.Session`",
    ":class:`_orm.scoping.scoped_session`",
    classmethods=["close_all", "object_session", "identity_key"],
    methods=[
        "__contains__",
        "__iter__",
        "add",
        "add_all",
        "begin",
        "begin_nested",
        "close",
        "reset",
        "commit",
        "connection",
        "delete",
        "execute",
        "expire",
        "expire_all",
        "expunge",
        "expunge_all",
        "flush",
        "get",
        "get_one",
        "get_bind",
        "is_modified",
        "bulk_save_objects",
        "bulk_insert_mappings",
        "bulk_update_mappings",
        "merge",
        "query",
        "refresh",
        "rollback",
        "scalar",
        "scalars",
    ],
    attributes=[
        "bind",
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
class scoped_session(Generic[_S]):
    """Provides scoped management of :class:`.Session` objects.

    See :ref:`unitofwork_contextual` for a tutorial.

    .. note::

       When using :ref:`asyncio_toplevel`, the async-compatible
       :class:`_asyncio.async_scoped_session` class should be
       used in place of :class:`.scoped_session`.

    """

    _support_async: bool = False

    session_factory: sessionmaker[_S]
    """The `session_factory` provided to `__init__` is stored in this
    attribute and may be accessed at a later time.  This can be useful when
    a new non-scoped :class:`.Session` is needed."""

    registry: ScopedRegistry[_S]

    def __init__(
        self,
        session_factory: sessionmaker[_S],
        scopefunc: Optional[Callable[[], Any]] = None,
    ):
        """Construct a new :class:`.scoped_session`.

        :param session_factory: a factory to create new :class:`.Session`
         instances. This is usually, but not necessarily, an instance
         of :class:`.sessionmaker`.
        :param scopefunc: optional function which defines
         the current scope.   If not passed, the :class:`.scoped_session`
         object assumes "thread-local" scope, and will use
         a Python ``threading.local()`` in order to maintain the current
         :class:`.Session`.  If passed, the function should return
         a hashable token; this token will be used as the key in a
         dictionary in order to store and retrieve the current
         :class:`.Session`.

        """
        self.session_factory = session_factory

        if scopefunc:
            self.registry = ScopedRegistry(session_factory, scopefunc)
        else:
            self.registry = ThreadLocalRegistry(session_factory)

    @property
    def _proxied(self) -> _S:
        return self.registry()

    def __call__(self, **kw: Any) -> _S:
        r"""Return the current :class:`.Session`, creating it
        using the :attr:`.scoped_session.session_factory` if not present.

        :param \**kw: Keyword arguments will be passed to the
         :attr:`.scoped_session.session_factory` callable, if an existing
         :class:`.Session` is not present.  If the :class:`.Session` is present
         and keyword arguments have been passed,
         :exc:`~sqlalchemy.exc.InvalidRequestError` is raised.

        """
        if kw:
            if self.registry.has():
                raise sa_exc.InvalidRequestError(
                    "Scoped session is already present; "
                    "no new arguments may be specified."
                )
            else:
                sess = self.session_factory(**kw)
                self.registry.set(sess)
        else:
            sess = self.registry()
        if not self._support_async and sess._is_asyncio:
            warn_deprecated(
                "Using `scoped_session` with asyncio is deprecated and "
                "will raise an error in a future version. "
                "Please use `async_scoped_session` instead.",
                "1.4.23",
            )
        return sess

    def configure(self, **kwargs: Any) -> None:
        """reconfigure the :class:`.sessionmaker` used by this
        :class:`.scoped_session`.

        See :meth:`.sessionmaker.configure`.

        """

        if self.registry.has():
            warn(
                "At least one scoped session is already present. "
                " configure() can not affect sessions that have "
                "already been created."
            )

        self.session_factory.configure(**kwargs)

    def remove(self) -> None:
        """Dispose of the current :class:`.Session`, if present.

        This will first call :meth:`.Session.close` method
        on the current :class:`.Session`, which releases any existing
        transactional/connection resources still being held; transactions
        specifically are rolled back.  The :class:`.Session` is then
        discarded.   Upon next usage within the same scope,
        the :class:`.scoped_session` will produce a new
        :class:`.Session` object.

        """

        if self.registry.has():
            self.registry().close()
        self.registry.clear()

    def query_property(
        self, query_cls: Optional[Type[Query[_T]]] = None
    ) -> QueryPropertyDescriptor:
        """return a class property which produces a legacy
        :class:`_query.Query` object against the class and the current
        :class:`.Session` when called.

        .. legacy:: The :meth:`_orm.scoped_session.query_property` accessor
           is specific to the legacy :class:`.Query` object and is not
           considered to be part of :term:`2.0-style` ORM use.

        e.g.::

            from sqlalchemy.orm import QueryPropertyDescriptor
            from sqlalchemy.orm import scoped_session
            from sqlalchemy.orm import sessionmaker

            Session = scoped_session(sessionmaker())

            class MyClass:
                query: QueryPropertyDescriptor = Session.query_property()

            # after mappers are defined
            result = MyClass.query.filter(MyClass.name=='foo').all()

        Produces instances of the session's configured query class by
        default.  To override and use a custom implementation, provide
        a ``query_cls`` callable.  The callable will be invoked with
        the class's mapper as a positional argument and a session
        keyword argument.

        There is no limit to the number of query properties placed on
        a class.

        """

        class query:
            def __get__(s, instance: Any, owner: Type[_O]) -> Query[_O]:
                if query_cls:
                    # custom query class
                    return query_cls(owner, session=self.registry())  # type: ignore  # noqa: E501
                else:
                    # session's configured query class
                    return self.registry().query(owner)

        return query()

    # START PROXY METHODS scoped_session

    # code within this block is **programmatically,
    # statically generated** by tools/generate_proxy_methods.py

    def __contains__(self, instance: object) -> bool:
        r"""Return True if the instance is associated with this session.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        The instance may be pending or persistent within the Session for a
        result of True.


        """  # noqa: E501

        return self._proxied.__contains__(instance)

    def __iter__(self) -> Iterator[object]:
        r"""Iterate over all pending or persistent instances within this
        Session.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.


        """  # noqa: E501

        return self._proxied.__iter__()

    def add(self, instance: object, _warn: bool = True) -> None:
        r"""Place an object into this :class:`_orm.Session`.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

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
            behalf of the :class:`_orm.scoping.scoped_session` class.

        See the documentation for :meth:`_orm.Session.add` for a general
        behavioral description.

        .. seealso::

            :meth:`_orm.Session.add`

            :ref:`session_adding` - at :ref:`session_basics`


        """  # noqa: E501

        return self._proxied.add_all(instances)

    def begin(self, nested: bool = False) -> SessionTransaction:
        r"""Begin a transaction, or nested transaction,
        on this :class:`.Session`, if one is not already begun.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        The :class:`_orm.Session` object features **autobegin** behavior,
        so that normally it is not necessary to call the
        :meth:`_orm.Session.begin`
        method explicitly. However, it may be used in order to control
        the scope of when the transactional state is begun.

        When used to begin the outermost transaction, an error is raised
        if this :class:`.Session` is already inside of a transaction.

        :param nested: if True, begins a SAVEPOINT transaction and is
         equivalent to calling :meth:`~.Session.begin_nested`. For
         documentation on SAVEPOINT transactions, please see
         :ref:`session_begin_nested`.

        :return: the :class:`.SessionTransaction` object.  Note that
         :class:`.SessionTransaction`
         acts as a Python context manager, allowing :meth:`.Session.begin`
         to be used in a "with" block.  See :ref:`session_explicit_begin` for
         an example.

        .. seealso::

            :ref:`session_autobegin`

            :ref:`unitofwork_transaction`

            :meth:`.Session.begin_nested`



        """  # noqa: E501

        return self._proxied.begin(nested=nested)

    def begin_nested(self) -> SessionTransaction:
        r"""Begin a "nested" transaction on this Session, e.g. SAVEPOINT.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        The target database(s) and associated drivers must support SQL
        SAVEPOINT for this method to function correctly.

        For documentation on SAVEPOINT
        transactions, please see :ref:`session_begin_nested`.

        :return: the :class:`.SessionTransaction` object.  Note that
         :class:`.SessionTransaction` acts as a context manager, allowing
         :meth:`.Session.begin_nested` to be used in a "with" block.
         See :ref:`session_begin_nested` for a usage example.

        .. seealso::

            :ref:`session_begin_nested`

            :ref:`pysqlite_serializable` - special workarounds required
            with the SQLite driver in order for SAVEPOINT to work
            correctly. For asyncio use cases, see the section
            :ref:`aiosqlite_serializable`.


        """  # noqa: E501

        return self._proxied.begin_nested()

    def close(self) -> None:
        r"""Close out the transactional resources and ORM objects used by this
        :class:`_orm.Session`.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        This expunges all ORM objects associated with this
        :class:`_orm.Session`, ends any transaction in progress and
        :term:`releases` any :class:`_engine.Connection` objects which this
        :class:`_orm.Session` itself has checked out from associated
        :class:`_engine.Engine` objects. The operation then leaves the
        :class:`_orm.Session` in a state which it may be used again.

        .. tip::

            In the default running mode the :meth:`_orm.Session.close`
            method **does not prevent the Session from being used again**.
            The :class:`_orm.Session` itself does not actually have a
            distinct "closed" state; it merely means
            the :class:`_orm.Session` will release all database connections
            and ORM objects.

            Setting the parameter :paramref:`_orm.Session.close_resets_only`
            to ``False`` will instead make the ``close`` final, meaning that
            any further action on the session will be forbidden.

        .. versionchanged:: 1.4  The :meth:`.Session.close` method does not
           immediately create a new :class:`.SessionTransaction` object;
           instead, the new :class:`.SessionTransaction` is created only if
           the :class:`.Session` is used again for a database operation.

        .. seealso::

            :ref:`session_closing` - detail on the semantics of
            :meth:`_orm.Session.close` and :meth:`_orm.Session.reset`.

            :meth:`_orm.Session.reset` - a similar method that behaves like
            ``close()`` with  the parameter
            :paramref:`_orm.Session.close_resets_only` set to ``True``.


        """  # noqa: E501

        return self._proxied.close()

    def reset(self) -> None:
        r"""Close out the transactional resources and ORM objects used by this
        :class:`_orm.Session`, resetting the session to its initial state.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        This method provides for same "reset-only" behavior that the
        :meth:`_orm.Session.close` method has provided historically, where the
        state of the :class:`_orm.Session` is reset as though the object were
        brand new, and ready to be used again.
        This method may then be useful for :class:`_orm.Session` objects
        which set :paramref:`_orm.Session.close_resets_only` to ``False``,
        so that "reset only" behavior is still available.

        .. versionadded:: 2.0.22

        .. seealso::

            :ref:`session_closing` - detail on the semantics of
            :meth:`_orm.Session.close` and :meth:`_orm.Session.reset`.

            :meth:`_orm.Session.close` - a similar method will additionally
            prevent re-use of the Session when the parameter
            :paramref:`_orm.Session.close_resets_only` is set to ``False``.

        """  # noqa: E501

        return self._proxied.reset()

    def commit(self) -> None:
        r"""Flush pending changes and commit the current transaction.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        When the COMMIT operation is complete, all objects are fully
        :term:`expired`, erasing their internal contents, which will be
        automatically re-loaded when the objects are next accessed. In the
        interim, these objects are in an expired state and will not function if
        they are :term:`detached` from the :class:`.Session`. Additionally,
        this re-load operation is not supported when using asyncio-oriented
        APIs. The :paramref:`.Session.expire_on_commit` parameter may be used
        to disable this behavior.

        When there is no transaction in place for the :class:`.Session`,
        indicating that no operations were invoked on this :class:`.Session`
        since the previous call to :meth:`.Session.commit`, the method will
        begin and commit an internal-only "logical" transaction, that does not
        normally affect the database unless pending flush changes were
        detected, but will still invoke event handlers and object expiration
        rules.

        The outermost database transaction is committed unconditionally,
        automatically releasing any SAVEPOINTs in effect.

        .. seealso::

            :ref:`session_committing`

            :ref:`unitofwork_transaction`

            :ref:`asyncio_orm_avoid_lazyloads`


        """  # noqa: E501

        return self._proxied.commit()

    def connection(
        self,
        bind_arguments: Optional[_BindArguments] = None,
        execution_options: Optional[CoreExecuteOptionsParameter] = None,
    ) -> Connection:
        r"""Return a :class:`_engine.Connection` object corresponding to this
        :class:`.Session` object's transactional state.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        Either the :class:`_engine.Connection` corresponding to the current
        transaction is returned, or if no transaction is in progress, a new
        one is begun and the :class:`_engine.Connection`
        returned (note that no
        transactional state is established with the DBAPI until the first
        SQL statement is emitted).

        Ambiguity in multi-bind or unbound :class:`.Session` objects can be
        resolved through any of the optional keyword arguments.   This
        ultimately makes usage of the :meth:`.get_bind` method for resolution.

        :param bind_arguments: dictionary of bind arguments.  May include
         "mapper", "bind", "clause", other custom arguments that are passed
         to :meth:`.Session.get_bind`.

        :param execution_options: a dictionary of execution options that will
         be passed to :meth:`_engine.Connection.execution_options`, **when the
         connection is first procured only**.   If the connection is already
         present within the :class:`.Session`, a warning is emitted and
         the arguments are ignored.

         .. seealso::

            :ref:`session_transaction_isolation`


        """  # noqa: E501

        return self._proxied.connection(
            bind_arguments=bind_arguments, execution_options=execution_options
        )

    def delete(self, instance: object) -> None:
        r"""Mark an instance as deleted.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        The object is assumed to be either :term:`persistent` or
        :term:`detached` when passed; after the method is called, the
        object will remain in the :term:`persistent` state until the next
        flush proceeds.  During this time, the object will also be a member
        of the :attr:`_orm.Session.deleted` collection.

        When the next flush proceeds, the object will move to the
        :term:`deleted` state, indicating a ``DELETE`` statement was emitted
        for its row within the current transaction.   When the transaction
        is successfully committed,
        the deleted object is moved to the :term:`detached` state and is
        no longer present within this :class:`_orm.Session`.

        .. seealso::

            :ref:`session_deleting` - at :ref:`session_basics`


        """  # noqa: E501

        return self._proxied.delete(instance)

    @overload
    def execute(
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
    def execute(
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
    def execute(
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

    def execute(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        _parent_execute_state: Optional[Any] = None,
        _add_event: Optional[Any] = None,
    ) -> Result[Any]:
        r"""Execute a SQL expression construct.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        Returns a :class:`_engine.Result` object representing
        results of the statement execution.

        E.g.::

            from sqlalchemy import select
            result = session.execute(
                select(User).where(User.id == 5)
            )

        The API contract of :meth:`_orm.Session.execute` is similar to that
        of :meth:`_engine.Connection.execute`, the :term:`2.0 style` version
        of :class:`_engine.Connection`.

        .. versionchanged:: 1.4 the :meth:`_orm.Session.execute` method is
           now the primary point of ORM statement execution when using
           :term:`2.0 style` ORM usage.

        :param statement:
            An executable statement (i.e. an :class:`.Executable` expression
            such as :func:`_expression.select`).

        :param params:
            Optional dictionary, or list of dictionaries, containing
            bound parameter values.   If a single dictionary, single-row
            execution occurs; if a list of dictionaries, an
            "executemany" will be invoked.  The keys in each dictionary
            must correspond to parameter names present in the statement.

        :param execution_options: optional dictionary of execution options,
         which will be associated with the statement execution.  This
         dictionary can provide a subset of the options that are accepted
         by :meth:`_engine.Connection.execution_options`, and may also
         provide additional options understood only in an ORM context.

         .. seealso::

            :ref:`orm_queryguide_execution_options` - ORM-specific execution
            options

        :param bind_arguments: dictionary of additional arguments to determine
         the bind.  May include "mapper", "bind", or other custom arguments.
         Contents of this dictionary are passed to the
         :meth:`.Session.get_bind` method.

        :return: a :class:`_engine.Result` object.



        """  # noqa: E501

        return self._proxied.execute(
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            _parent_execute_state=_parent_execute_state,
            _add_event=_add_event,
        )

    def expire(
        self, instance: object, attribute_names: Optional[Iterable[str]] = None
    ) -> None:
        r"""Expire the attributes on an instance.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

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
            behalf of the :class:`_orm.scoping.scoped_session` class.

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
            behalf of the :class:`_orm.scoping.scoped_session` class.

        This will free all internal references to the instance.  Cascading
        will be applied according to the *expunge* cascade rule.


        """  # noqa: E501

        return self._proxied.expunge(instance)

    def expunge_all(self) -> None:
        r"""Remove all object instances from this ``Session``.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        This is equivalent to calling ``expunge(obj)`` on all objects in this
        ``Session``.


        """  # noqa: E501

        return self._proxied.expunge_all()

    def flush(self, objects: Optional[Sequence[Any]] = None) -> None:
        r"""Flush all the object changes to the database.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        Writes out all pending object creations, deletions and modifications
        to the database as INSERTs, DELETEs, UPDATEs, etc.  Operations are
        automatically ordered by the Session's unit of work dependency
        solver.

        Database operations will be issued in the current transactional
        context and do not affect the state of the transaction, unless an
        error occurs, in which case the entire transaction is rolled back.
        You may flush() as often as you like within a transaction to move
        changes from Python to the database's transaction buffer.

        :param objects: Optional; restricts the flush operation to operate
          only on elements that are in the given collection.

          This feature is for an extremely narrow set of use cases where
          particular objects may need to be operated upon before the
          full flush() occurs.  It is not intended for general use.


        """  # noqa: E501

        return self._proxied.flush(objects=objects)

    def get(
        self,
        entity: _EntityBindKey[_O],
        ident: _PKIdentityArgument,
        *,
        options: Optional[Sequence[ORMOption]] = None,
        populate_existing: bool = False,
        with_for_update: ForUpdateParameter = None,
        identity_token: Optional[Any] = None,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
    ) -> Optional[_O]:
        r"""Return an instance based on the given primary key identifier,
        or ``None`` if not found.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        E.g.::

            my_user = session.get(User, 5)

            some_object = session.get(VersionedFoo, (5, 10))

            some_object = session.get(
                VersionedFoo,
                {"id": 5, "version_id": 10}
            )

        .. versionadded:: 1.4 Added :meth:`_orm.Session.get`, which is moved
           from the now legacy :meth:`_orm.Query.get` method.

        :meth:`_orm.Session.get` is special in that it provides direct
        access to the identity map of the :class:`.Session`.
        If the given primary key identifier is present
        in the local identity map, the object is returned
        directly from this collection and no SQL is emitted,
        unless the object has been marked fully expired.
        If not present,
        a SELECT is performed in order to locate the object.

        :meth:`_orm.Session.get` also will perform a check if
        the object is present in the identity map and
        marked as expired - a SELECT
        is emitted to refresh the object as well as to
        ensure that the row is still present.
        If not, :class:`~sqlalchemy.orm.exc.ObjectDeletedError` is raised.

        :param entity: a mapped class or :class:`.Mapper` indicating the
         type of entity to be loaded.

        :param ident: A scalar, tuple, or dictionary representing the
         primary key.  For a composite (e.g. multiple column) primary key,
         a tuple or dictionary should be passed.

         For a single-column primary key, the scalar calling form is typically
         the most expedient.  If the primary key of a row is the value "5",
         the call looks like::

            my_object = session.get(SomeClass, 5)

         The tuple form contains primary key values typically in
         the order in which they correspond to the mapped
         :class:`_schema.Table`
         object's primary key columns, or if the
         :paramref:`_orm.Mapper.primary_key` configuration parameter were
         used, in
         the order used for that parameter. For example, if the primary key
         of a row is represented by the integer
         digits "5, 10" the call would look like::

             my_object = session.get(SomeClass, (5, 10))

         The dictionary form should include as keys the mapped attribute names
         corresponding to each element of the primary key.  If the mapped class
         has the attributes ``id``, ``version_id`` as the attributes which
         store the object's primary key value, the call would look like::

            my_object = session.get(SomeClass, {"id": 5, "version_id": 10})

        :param options: optional sequence of loader options which will be
         applied to the query, if one is emitted.

        :param populate_existing: causes the method to unconditionally emit
         a SQL query and refresh the object with the newly loaded data,
         regardless of whether or not the object is already present.

        :param with_for_update: optional boolean ``True`` indicating FOR UPDATE
          should be used, or may be a dictionary containing flags to
          indicate a more specific set of FOR UPDATE flags for the SELECT;
          flags should match the parameters of
          :meth:`_query.Query.with_for_update`.
          Supersedes the :paramref:`.Session.refresh.lockmode` parameter.

        :param execution_options: optional dictionary of execution options,
         which will be associated with the query execution if one is emitted.
         This dictionary can provide a subset of the options that are
         accepted by :meth:`_engine.Connection.execution_options`, and may
         also provide additional options understood only in an ORM context.

         .. versionadded:: 1.4.29

         .. seealso::

            :ref:`orm_queryguide_execution_options` - ORM-specific execution
            options

        :param bind_arguments: dictionary of additional arguments to determine
         the bind.  May include "mapper", "bind", or other custom arguments.
         Contents of this dictionary are passed to the
         :meth:`.Session.get_bind` method.

         .. versionadded: 2.0.0rc1

        :return: The object instance, or ``None``.


        """  # noqa: E501

        return self._proxied.get(
            entity,
            ident,
            options=options,
            populate_existing=populate_existing,
            with_for_update=with_for_update,
            identity_token=identity_token,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
        )

    def get_one(
        self,
        entity: _EntityBindKey[_O],
        ident: _PKIdentityArgument,
        *,
        options: Optional[Sequence[ORMOption]] = None,
        populate_existing: bool = False,
        with_for_update: ForUpdateParameter = None,
        identity_token: Optional[Any] = None,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
    ) -> _O:
        r"""Return exactly one instance based on the given primary key
        identifier, or raise an exception if not found.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        Raises ``sqlalchemy.orm.exc.NoResultFound`` if the query
        selects no rows.

        For a detailed documentation of the arguments see the
        method :meth:`.Session.get`.

        .. versionadded:: 2.0.22

        :return: The object instance.

        .. seealso::

            :meth:`.Session.get` - equivalent method that instead
              returns ``None`` if no row was found with the provided primary
              key


        """  # noqa: E501

        return self._proxied.get_one(
            entity,
            ident,
            options=options,
            populate_existing=populate_existing,
            with_for_update=with_for_update,
            identity_token=identity_token,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
        )

    def get_bind(
        self,
        mapper: Optional[_EntityBindKey[_O]] = None,
        *,
        clause: Optional[ClauseElement] = None,
        bind: Optional[_SessionBind] = None,
        _sa_skip_events: Optional[bool] = None,
        _sa_skip_for_implicit_returning: bool = False,
        **kw: Any,
    ) -> Union[Engine, Connection]:
        r"""Return a "bind" to which this :class:`.Session` is bound.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        The "bind" is usually an instance of :class:`_engine.Engine`,
        except in the case where the :class:`.Session` has been
        explicitly bound directly to a :class:`_engine.Connection`.

        For a multiply-bound or unbound :class:`.Session`, the
        ``mapper`` or ``clause`` arguments are used to determine the
        appropriate bind to return.

        Note that the "mapper" argument is usually present
        when :meth:`.Session.get_bind` is called via an ORM
        operation such as a :meth:`.Session.query`, each
        individual INSERT/UPDATE/DELETE operation within a
        :meth:`.Session.flush`, call, etc.

        The order of resolution is:

        1. if mapper given and :paramref:`.Session.binds` is present,
           locate a bind based first on the mapper in use, then
           on the mapped class in use, then on any base classes that are
           present in the ``__mro__`` of the mapped class, from more specific
           superclasses to more general.
        2. if clause given and ``Session.binds`` is present,
           locate a bind based on :class:`_schema.Table` objects
           found in the given clause present in ``Session.binds``.
        3. if ``Session.binds`` is present, return that.
        4. if clause given, attempt to return a bind
           linked to the :class:`_schema.MetaData` ultimately
           associated with the clause.
        5. if mapper given, attempt to return a bind
           linked to the :class:`_schema.MetaData` ultimately
           associated with the :class:`_schema.Table` or other
           selectable to which the mapper is mapped.
        6. No bind can be found, :exc:`~sqlalchemy.exc.UnboundExecutionError`
           is raised.

        Note that the :meth:`.Session.get_bind` method can be overridden on
        a user-defined subclass of :class:`.Session` to provide any kind
        of bind resolution scheme.  See the example at
        :ref:`session_custom_partitioning`.

        :param mapper:
          Optional mapped class or corresponding :class:`_orm.Mapper` instance.
          The bind can be derived from a :class:`_orm.Mapper` first by
          consulting the "binds" map associated with this :class:`.Session`,
          and secondly by consulting the :class:`_schema.MetaData` associated
          with the :class:`_schema.Table` to which the :class:`_orm.Mapper` is
          mapped for a bind.

        :param clause:
            A :class:`_expression.ClauseElement` (i.e.
            :func:`_expression.select`,
            :func:`_expression.text`,
            etc.).  If the ``mapper`` argument is not present or could not
            produce a bind, the given expression construct will be searched
            for a bound element, typically a :class:`_schema.Table`
            associated with
            bound :class:`_schema.MetaData`.

        .. seealso::

             :ref:`session_partitioning`

             :paramref:`.Session.binds`

             :meth:`.Session.bind_mapper`

             :meth:`.Session.bind_table`


        """  # noqa: E501

        return self._proxied.get_bind(
            mapper=mapper,
            clause=clause,
            bind=bind,
            _sa_skip_events=_sa_skip_events,
            _sa_skip_for_implicit_returning=_sa_skip_for_implicit_returning,
            **kw,
        )

    def is_modified(
        self, instance: object, include_collections: bool = True
    ) -> bool:
        r"""Return ``True`` if the given instance has locally
        modified attributes.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

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

    def bulk_save_objects(
        self,
        objects: Iterable[object],
        return_defaults: bool = False,
        update_changed_only: bool = True,
        preserve_order: bool = True,
    ) -> None:
        r"""Perform a bulk save of the given list of objects.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        .. legacy::

            This method is a legacy feature as of the 2.0 series of
            SQLAlchemy.   For modern bulk INSERT and UPDATE, see
            the sections :ref:`orm_queryguide_bulk_insert` and
            :ref:`orm_queryguide_bulk_update`.

            For general INSERT and UPDATE of existing ORM mapped objects,
            prefer standard :term:`unit of work` data management patterns,
            introduced in the :ref:`unified_tutorial` at
            :ref:`tutorial_orm_data_manipulation`.  SQLAlchemy 2.0
            now uses :ref:`engine_insertmanyvalues` with modern dialects
            which solves previous issues of bulk INSERT slowness.

        :param objects: a sequence of mapped object instances.  The mapped
         objects are persisted as is, and are **not** associated with the
         :class:`.Session` afterwards.

         For each object, whether the object is sent as an INSERT or an
         UPDATE is dependent on the same rules used by the :class:`.Session`
         in traditional operation; if the object has the
         :attr:`.InstanceState.key`
         attribute set, then the object is assumed to be "detached" and
         will result in an UPDATE.  Otherwise, an INSERT is used.

         In the case of an UPDATE, statements are grouped based on which
         attributes have changed, and are thus to be the subject of each
         SET clause.  If ``update_changed_only`` is False, then all
         attributes present within each object are applied to the UPDATE
         statement, which may help in allowing the statements to be grouped
         together into a larger executemany(), and will also reduce the
         overhead of checking history on attributes.

        :param return_defaults: when True, rows that are missing values which
         generate defaults, namely integer primary key defaults and sequences,
         will be inserted **one at a time**, so that the primary key value
         is available.  In particular this will allow joined-inheritance
         and other multi-table mappings to insert correctly without the need
         to provide primary key values ahead of time; however,
         :paramref:`.Session.bulk_save_objects.return_defaults` **greatly
         reduces the performance gains** of the method overall.  It is strongly
         advised to please use the standard :meth:`_orm.Session.add_all`
         approach.

        :param update_changed_only: when True, UPDATE statements are rendered
         based on those attributes in each state that have logged changes.
         When False, all attributes present are rendered into the SET clause
         with the exception of primary key attributes.

        :param preserve_order: when True, the order of inserts and updates
         matches exactly the order in which the objects are given.   When
         False, common types of objects are grouped into inserts
         and updates, to allow for more batching opportunities.

        .. seealso::

            :doc:`queryguide/dml`

            :meth:`.Session.bulk_insert_mappings`

            :meth:`.Session.bulk_update_mappings`


        """  # noqa: E501

        return self._proxied.bulk_save_objects(
            objects,
            return_defaults=return_defaults,
            update_changed_only=update_changed_only,
            preserve_order=preserve_order,
        )

    def bulk_insert_mappings(
        self,
        mapper: Mapper[Any],
        mappings: Iterable[Dict[str, Any]],
        return_defaults: bool = False,
        render_nulls: bool = False,
    ) -> None:
        r"""Perform a bulk insert of the given list of mapping dictionaries.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        .. legacy::

            This method is a legacy feature as of the 2.0 series of
            SQLAlchemy.   For modern bulk INSERT and UPDATE, see
            the sections :ref:`orm_queryguide_bulk_insert` and
            :ref:`orm_queryguide_bulk_update`.  The 2.0 API shares
            implementation details with this method and adds new features
            as well.

        :param mapper: a mapped class, or the actual :class:`_orm.Mapper`
         object,
         representing the single kind of object represented within the mapping
         list.

        :param mappings: a sequence of dictionaries, each one containing the
         state of the mapped row to be inserted, in terms of the attribute
         names on the mapped class.   If the mapping refers to multiple tables,
         such as a joined-inheritance mapping, each dictionary must contain all
         keys to be populated into all tables.

        :param return_defaults: when True, the INSERT process will be altered
         to ensure that newly generated primary key values will be fetched.
         The rationale for this parameter is typically to enable
         :ref:`Joined Table Inheritance <joined_inheritance>` mappings to
         be bulk inserted.

         .. note:: for backends that don't support RETURNING, the
            :paramref:`_orm.Session.bulk_insert_mappings.return_defaults`
            parameter can significantly decrease performance as INSERT
            statements can no longer be batched.   See
            :ref:`engine_insertmanyvalues`
            for background on which backends are affected.

        :param render_nulls: When True, a value of ``None`` will result
         in a NULL value being included in the INSERT statement, rather
         than the column being omitted from the INSERT.   This allows all
         the rows being INSERTed to have the identical set of columns which
         allows the full set of rows to be batched to the DBAPI.  Normally,
         each column-set that contains a different combination of NULL values
         than the previous row must omit a different series of columns from
         the rendered INSERT statement, which means it must be emitted as a
         separate statement.   By passing this flag, the full set of rows
         are guaranteed to be batchable into one batch; the cost however is
         that server-side defaults which are invoked by an omitted column will
         be skipped, so care must be taken to ensure that these are not
         necessary.

         .. warning::

            When this flag is set, **server side default SQL values will
            not be invoked** for those columns that are inserted as NULL;
            the NULL value will be sent explicitly.   Care must be taken
            to ensure that no server-side default functions need to be
            invoked for the operation as a whole.

        .. seealso::

            :doc:`queryguide/dml`

            :meth:`.Session.bulk_save_objects`

            :meth:`.Session.bulk_update_mappings`


        """  # noqa: E501

        return self._proxied.bulk_insert_mappings(
            mapper,
            mappings,
            return_defaults=return_defaults,
            render_nulls=render_nulls,
        )

    def bulk_update_mappings(
        self, mapper: Mapper[Any], mappings: Iterable[Dict[str, Any]]
    ) -> None:
        r"""Perform a bulk update of the given list of mapping dictionaries.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        .. legacy::

            This method is a legacy feature as of the 2.0 series of
            SQLAlchemy.   For modern bulk INSERT and UPDATE, see
            the sections :ref:`orm_queryguide_bulk_insert` and
            :ref:`orm_queryguide_bulk_update`.  The 2.0 API shares
            implementation details with this method and adds new features
            as well.

        :param mapper: a mapped class, or the actual :class:`_orm.Mapper`
         object,
         representing the single kind of object represented within the mapping
         list.

        :param mappings: a sequence of dictionaries, each one containing the
         state of the mapped row to be updated, in terms of the attribute names
         on the mapped class.   If the mapping refers to multiple tables, such
         as a joined-inheritance mapping, each dictionary may contain keys
         corresponding to all tables.   All those keys which are present and
         are not part of the primary key are applied to the SET clause of the
         UPDATE statement; the primary key values, which are required, are
         applied to the WHERE clause.


        .. seealso::

            :doc:`queryguide/dml`

            :meth:`.Session.bulk_insert_mappings`

            :meth:`.Session.bulk_save_objects`


        """  # noqa: E501

        return self._proxied.bulk_update_mappings(mapper, mappings)

    def merge(
        self,
        instance: _O,
        *,
        load: bool = True,
        options: Optional[Sequence[ORMOption]] = None,
    ) -> _O:
        r"""Copy the state of a given instance into a corresponding instance
        within this :class:`.Session`.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        :meth:`.Session.merge` examines the primary key attributes of the
        source instance, and attempts to reconcile it with an instance of the
        same primary key in the session.   If not found locally, it attempts
        to load the object from the database based on primary key, and if
        none can be located, creates a new instance.  The state of each
        attribute on the source instance is then copied to the target
        instance.  The resulting target instance is then returned by the
        method; the original source instance is left unmodified, and
        un-associated with the :class:`.Session` if not already.

        This operation cascades to associated instances if the association is
        mapped with ``cascade="merge"``.

        See :ref:`unitofwork_merging` for a detailed discussion of merging.

        :param instance: Instance to be merged.
        :param load: Boolean, when False, :meth:`.merge` switches into
         a "high performance" mode which causes it to forego emitting history
         events as well as all database access.  This flag is used for
         cases such as transferring graphs of objects into a :class:`.Session`
         from a second level cache, or to transfer just-loaded objects
         into the :class:`.Session` owned by a worker thread or process
         without re-querying the database.

         The ``load=False`` use case adds the caveat that the given
         object has to be in a "clean" state, that is, has no pending changes
         to be flushed - even if the incoming object is detached from any
         :class:`.Session`.   This is so that when
         the merge operation populates local attributes and
         cascades to related objects and
         collections, the values can be "stamped" onto the
         target object as is, without generating any history or attribute
         events, and without the need to reconcile the incoming data with
         any existing related objects or collections that might not
         be loaded.  The resulting objects from ``load=False`` are always
         produced as "clean", so it is only appropriate that the given objects
         should be "clean" as well, else this suggests a mis-use of the
         method.
        :param options: optional sequence of loader options which will be
         applied to the :meth:`_orm.Session.get` method when the merge
         operation loads the existing version of the object from the database.

         .. versionadded:: 1.4.24


        .. seealso::

            :func:`.make_transient_to_detached` - provides for an alternative
            means of "merging" a single object into the :class:`.Session`


        """  # noqa: E501

        return self._proxied.merge(instance, load=load, options=options)

    @overload
    def query(self, _entity: _EntityType[_O]) -> Query[_O]:
        ...

    @overload
    def query(
        self, _colexpr: TypedColumnsClauseRole[_T]
    ) -> RowReturningQuery[Tuple[_T]]:
        ...

    # START OVERLOADED FUNCTIONS self.query RowReturningQuery 2-8

    # code within this block is **programmatically,
    # statically generated** by tools/generate_tuple_map_overloads.py

    @overload
    def query(
        self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1]
    ) -> RowReturningQuery[Tuple[_T0, _T1]]:
        ...

    @overload
    def query(
        self, __ent0: _TCCA[_T0], __ent1: _TCCA[_T1], __ent2: _TCCA[_T2]
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2]]:
        ...

    @overload
    def query(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3]]:
        ...

    @overload
    def query(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4]]:
        ...

    @overload
    def query(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
        __ent5: _TCCA[_T5],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4, _T5]]:
        ...

    @overload
    def query(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
        __ent5: _TCCA[_T5],
        __ent6: _TCCA[_T6],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6]]:
        ...

    @overload
    def query(
        self,
        __ent0: _TCCA[_T0],
        __ent1: _TCCA[_T1],
        __ent2: _TCCA[_T2],
        __ent3: _TCCA[_T3],
        __ent4: _TCCA[_T4],
        __ent5: _TCCA[_T5],
        __ent6: _TCCA[_T6],
        __ent7: _TCCA[_T7],
    ) -> RowReturningQuery[Tuple[_T0, _T1, _T2, _T3, _T4, _T5, _T6, _T7]]:
        ...

    # END OVERLOADED FUNCTIONS self.query

    @overload
    def query(
        self, *entities: _ColumnsClauseArgument[Any], **kwargs: Any
    ) -> Query[Any]:
        ...

    def query(
        self, *entities: _ColumnsClauseArgument[Any], **kwargs: Any
    ) -> Query[Any]:
        r"""Return a new :class:`_query.Query` object corresponding to this
        :class:`_orm.Session`.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        Note that the :class:`_query.Query` object is legacy as of
        SQLAlchemy 2.0; the :func:`_sql.select` construct is now used
        to construct ORM queries.

        .. seealso::

            :ref:`unified_tutorial`

            :ref:`queryguide_toplevel`

            :ref:`query_api_toplevel` - legacy API doc


        """  # noqa: E501

        return self._proxied.query(*entities, **kwargs)

    def refresh(
        self,
        instance: object,
        attribute_names: Optional[Iterable[str]] = None,
        with_for_update: ForUpdateParameter = None,
    ) -> None:
        r"""Expire and refresh attributes on the given instance.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        The selected attributes will first be expired as they would when using
        :meth:`_orm.Session.expire`; then a SELECT statement will be issued to
        the database to refresh column-oriented attributes with the current
        value available in the current transaction.

        :func:`_orm.relationship` oriented attributes will also be immediately
        loaded if they were already eagerly loaded on the object, using the
        same eager loading strategy that they were loaded with originally.

        .. versionadded:: 1.4 - the :meth:`_orm.Session.refresh` method
           can also refresh eagerly loaded attributes.

        :func:`_orm.relationship` oriented attributes that would normally
        load using the ``select`` (or "lazy") loader strategy will also
        load **if they are named explicitly in the attribute_names
        collection**, emitting a SELECT statement for the attribute using the
        ``immediate`` loader strategy.  If lazy-loaded relationships are not
        named in :paramref:`_orm.Session.refresh.attribute_names`, then
        they remain as "lazy loaded" attributes and are not implicitly
        refreshed.

        .. versionchanged:: 2.0.4  The :meth:`_orm.Session.refresh` method
           will now refresh lazy-loaded :func:`_orm.relationship` oriented
           attributes for those which are named explicitly in the
           :paramref:`_orm.Session.refresh.attribute_names` collection.

        .. tip::

            While the :meth:`_orm.Session.refresh` method is capable of
            refreshing both column and relationship oriented attributes, its
            primary focus is on refreshing of local column-oriented attributes
            on a single instance. For more open ended "refresh" functionality,
            including the ability to refresh the attributes on many objects at
            once while having explicit control over relationship loader
            strategies, use the
            :ref:`populate existing <orm_queryguide_populate_existing>` feature
            instead.

        Note that a highly isolated transaction will return the same values as
        were previously read in that same transaction, regardless of changes
        in database state outside of that transaction.   Refreshing
        attributes usually only makes sense at the start of a transaction
        where database rows have not yet been accessed.

        :param attribute_names: optional.  An iterable collection of
          string attribute names indicating a subset of attributes to
          be refreshed.

        :param with_for_update: optional boolean ``True`` indicating FOR UPDATE
          should be used, or may be a dictionary containing flags to
          indicate a more specific set of FOR UPDATE flags for the SELECT;
          flags should match the parameters of
          :meth:`_query.Query.with_for_update`.
          Supersedes the :paramref:`.Session.refresh.lockmode` parameter.

        .. seealso::

            :ref:`session_expire` - introductory material

            :meth:`.Session.expire`

            :meth:`.Session.expire_all`

            :ref:`orm_queryguide_populate_existing` - allows any ORM query
            to refresh objects as they would be loaded normally.


        """  # noqa: E501

        return self._proxied.refresh(
            instance,
            attribute_names=attribute_names,
            with_for_update=with_for_update,
        )

    def rollback(self) -> None:
        r"""Rollback the current transaction in progress.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        If no transaction is in progress, this method is a pass-through.

        The method always rolls back
        the topmost database transaction, discarding any nested
        transactions that may be in progress.

        .. seealso::

            :ref:`session_rollback`

            :ref:`unitofwork_transaction`


        """  # noqa: E501

        return self._proxied.rollback()

    @overload
    def scalar(
        self,
        statement: TypedReturnsRows[Tuple[_T]],
        params: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Optional[_T]:
        ...

    @overload
    def scalar(
        self,
        statement: Executable,
        params: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Any:
        ...

    def scalar(
        self,
        statement: Executable,
        params: Optional[_CoreSingleExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Any:
        r"""Execute a statement and return a scalar result.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        Usage and parameters are the same as that of
        :meth:`_orm.Session.execute`; the return result is a scalar Python
        value.


        """  # noqa: E501

        return self._proxied.scalar(
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            **kw,
        )

    @overload
    def scalars(
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
    def scalars(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> ScalarResult[Any]:
        ...

    def scalars(
        self,
        statement: Executable,
        params: Optional[_CoreAnyExecuteParams] = None,
        *,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> ScalarResult[Any]:
        r"""Execute a statement and return the results as scalars.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        Usage and parameters are the same as that of
        :meth:`_orm.Session.execute`; the return result is a
        :class:`_result.ScalarResult` filtering object which
        will return single elements rather than :class:`_row.Row` objects.

        :return:  a :class:`_result.ScalarResult` object

        .. versionadded:: 1.4.24 Added :meth:`_orm.Session.scalars`

        .. versionadded:: 1.4.26 Added :meth:`_orm.scoped_session.scalars`

        .. seealso::

            :ref:`orm_queryguide_select_orm_entities` - contrasts the behavior
            of :meth:`_orm.Session.execute` to :meth:`_orm.Session.scalars`


        """  # noqa: E501

        return self._proxied.scalars(
            statement,
            params=params,
            execution_options=execution_options,
            bind_arguments=bind_arguments,
            **kw,
        )

    @property
    def bind(self) -> Optional[Union[Engine, Connection]]:
        r"""Proxy for the :attr:`_orm.Session.bind` attribute
        on behalf of the :class:`_orm.scoping.scoped_session` class.

        """  # noqa: E501

        return self._proxied.bind

    @bind.setter
    def bind(self, attr: Optional[Union[Engine, Connection]]) -> None:
        self._proxied.bind = attr

    @property
    def dirty(self) -> Any:
        r"""The set of all persistent instances considered dirty.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_orm.scoping.scoped_session` class.

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
            on behalf of the :class:`_orm.scoping.scoped_session` class.

        """  # noqa: E501

        return self._proxied.deleted

    @property
    def new(self) -> Any:
        r"""The set of all instances marked as 'new' within this ``Session``.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class
            on behalf of the :class:`_orm.scoping.scoped_session` class.

        """  # noqa: E501

        return self._proxied.new

    @property
    def identity_map(self) -> IdentityMap:
        r"""Proxy for the :attr:`_orm.Session.identity_map` attribute
        on behalf of the :class:`_orm.scoping.scoped_session` class.

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
            on behalf of the :class:`_orm.scoping.scoped_session` class.

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
        on behalf of the :class:`_orm.scoping.scoped_session` class.

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
            on behalf of the :class:`_orm.scoping.scoped_session` class.

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
            on behalf of the :class:`_orm.scoping.scoped_session` class.

        The initial value of this dictionary can be populated using the
        ``info`` argument to the :class:`.Session` constructor or
        :class:`.sessionmaker` constructor or factory methods.  The dictionary
        here is always local to this :class:`.Session` and can be modified
        independently of all other :class:`.Session` objects.


        """  # noqa: E501

        return self._proxied.info

    @classmethod
    def close_all(cls) -> None:
        r"""Close *all* sessions in memory.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

        .. deprecated:: 1.3 The :meth:`.Session.close_all` method is deprecated and will be removed in a future release.  Please refer to :func:`.session.close_all_sessions`.

        """  # noqa: E501

        return Session.close_all()

    @classmethod
    def object_session(cls, instance: object) -> Optional[Session]:
        r"""Return the :class:`.Session` to which an object belongs.

        .. container:: class_bases

            Proxied for the :class:`_orm.Session` class on
            behalf of the :class:`_orm.scoping.scoped_session` class.

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
            behalf of the :class:`_orm.scoping.scoped_session` class.

        This is an alias of :func:`.util.identity_key`.


        """  # noqa: E501

        return Session.identity_key(
            class_=class_,
            ident=ident,
            instance=instance,
            row=row,
            identity_token=identity_token,
        )

    # END PROXY METHODS scoped_session


ScopedSession = scoped_session
"""Old name for backwards compatibility."""
