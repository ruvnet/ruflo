# ext/horizontal_shard.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Horizontal sharding support.

Defines a rudimental 'horizontal sharding' system which allows a Session to
distribute queries and persistence operations across multiple databases.

For a usage example, see the :ref:`examples_sharding` example included in
the source distribution.

.. deepalchemy:: The horizontal sharding extension is an advanced feature,
   involving a complex statement -> database interaction as well as
   use of semi-public APIs for non-trivial cases.   Simpler approaches to
   refering to multiple database "shards", most commonly using a distinct
   :class:`_orm.Session` per "shard", should always be considered first
   before using this more complex and less-production-tested system.



"""
from __future__ import annotations

from typing import Any
from typing import Callable
from typing import Dict
from typing import Iterable
from typing import Optional
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from .. import event
from .. import exc
from .. import inspect
from .. import util
from ..orm import PassiveFlag
from ..orm._typing import OrmExecuteOptionsParameter
from ..orm.interfaces import ORMOption
from ..orm.mapper import Mapper
from ..orm.query import Query
from ..orm.session import _BindArguments
from ..orm.session import _PKIdentityArgument
from ..orm.session import Session
from ..util.typing import Protocol
from ..util.typing import Self

if TYPE_CHECKING:
    from ..engine.base import Connection
    from ..engine.base import Engine
    from ..engine.base import OptionEngine
    from ..engine.result import IteratorResult
    from ..engine.result import Result
    from ..orm import LoaderCallableStatus
    from ..orm._typing import _O
    from ..orm.bulk_persistence import BulkUDCompileState
    from ..orm.context import QueryContext
    from ..orm.session import _EntityBindKey
    from ..orm.session import _SessionBind
    from ..orm.session import ORMExecuteState
    from ..orm.state import InstanceState
    from ..sql import Executable
    from ..sql._typing import _TP
    from ..sql.elements import ClauseElement

__all__ = ["ShardedSession", "ShardedQuery"]

_T = TypeVar("_T", bound=Any)


ShardIdentifier = str


class ShardChooser(Protocol):
    def __call__(
        self,
        mapper: Optional[Mapper[_T]],
        instance: Any,
        clause: Optional[ClauseElement],
    ) -> Any:
        ...


class IdentityChooser(Protocol):
    def __call__(
        self,
        mapper: Mapper[_T],
        primary_key: _PKIdentityArgument,
        *,
        lazy_loaded_from: Optional[InstanceState[Any]],
        execution_options: OrmExecuteOptionsParameter,
        bind_arguments: _BindArguments,
        **kw: Any,
    ) -> Any:
        ...


class ShardedQuery(Query[_T]):
    """Query class used with :class:`.ShardedSession`.

    .. legacy:: The :class:`.ShardedQuery` is a subclass of the legacy
       :class:`.Query` class.   The :class:`.ShardedSession` now supports
       2.0 style execution via the :meth:`.ShardedSession.execute` method.

    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        assert isinstance(self.session, ShardedSession)

        self.identity_chooser = self.session.identity_chooser
        self.execute_chooser = self.session.execute_chooser
        self._shard_id = None

    def set_shard(self, shard_id: ShardIdentifier) -> Self:
        """Return a new query, limited to a single shard ID.

        All subsequent operations with the returned query will
        be against the single shard regardless of other state.

        The shard_id can be passed for a 2.0 style execution to the
        bind_arguments dictionary of :meth:`.Session.execute`::

            results = session.execute(
                stmt,
                bind_arguments={"shard_id": "my_shard"}
            )

        """
        return self.execution_options(_sa_shard_id=shard_id)


class ShardedSession(Session):
    shard_chooser: ShardChooser
    identity_chooser: IdentityChooser
    execute_chooser: Callable[[ORMExecuteState], Iterable[Any]]

    def __init__(
        self,
        shard_chooser: ShardChooser,
        identity_chooser: Optional[IdentityChooser] = None,
        execute_chooser: Optional[
            Callable[[ORMExecuteState], Iterable[Any]]
        ] = None,
        shards: Optional[Dict[str, Any]] = None,
        query_cls: Type[Query[_T]] = ShardedQuery,
        *,
        id_chooser: Optional[
            Callable[[Query[_T], Iterable[_T]], Iterable[Any]]
        ] = None,
        query_chooser: Optional[Callable[[Executable], Iterable[Any]]] = None,
        **kwargs: Any,
    ) -> None:
        """Construct a ShardedSession.

        :param shard_chooser: A callable which, passed a Mapper, a mapped
          instance, and possibly a SQL clause, returns a shard ID.  This id
          may be based off of the attributes present within the object, or on
          some round-robin scheme. If the scheme is based on a selection, it
          should set whatever state on the instance to mark it in the future as
          participating in that shard.

        :param identity_chooser: A callable, passed a Mapper and primary key
         argument, which should return a list of shard ids where this
         primary key might reside.

          .. versionchanged:: 2.0  The ``identity_chooser`` parameter
             supersedes the ``id_chooser`` parameter.

        :param execute_chooser: For a given :class:`.ORMExecuteState`,
          returns the list of shard_ids
          where the query should be issued.  Results from all shards returned
          will be combined together into a single listing.

          .. versionchanged:: 1.4  The ``execute_chooser`` parameter
             supersedes the ``query_chooser`` parameter.

        :param shards: A dictionary of string shard names
          to :class:`~sqlalchemy.engine.Engine` objects.

        """
        super().__init__(query_cls=query_cls, **kwargs)

        event.listen(
            self, "do_orm_execute", execute_and_instances, retval=True
        )
        self.shard_chooser = shard_chooser

        if id_chooser:
            _id_chooser = id_chooser
            util.warn_deprecated(
                "The ``id_chooser`` parameter is deprecated; "
                "please use ``identity_chooser``.",
                "2.0",
            )

            def _legacy_identity_chooser(
                mapper: Mapper[_T],
                primary_key: _PKIdentityArgument,
                *,
                lazy_loaded_from: Optional[InstanceState[Any]],
                execution_options: OrmExecuteOptionsParameter,
                bind_arguments: _BindArguments,
                **kw: Any,
            ) -> Any:
                q = self.query(mapper)
                if lazy_loaded_from:
                    q = q._set_lazyload_from(lazy_loaded_from)
                return _id_chooser(q, primary_key)

            self.identity_chooser = _legacy_identity_chooser
        elif identity_chooser:
            self.identity_chooser = identity_chooser
        else:
            raise exc.ArgumentError(
                "identity_chooser or id_chooser is required"
            )

        if query_chooser:
            _query_chooser = query_chooser
            util.warn_deprecated(
                "The ``query_chooser`` parameter is deprecated; "
                "please use ``execute_chooser``.",
                "1.4",
            )
            if execute_chooser:
                raise exc.ArgumentError(
                    "Can't pass query_chooser and execute_chooser "
                    "at the same time."
                )

            def _default_execute_chooser(
                orm_context: ORMExecuteState,
            ) -> Iterable[Any]:
                return _query_chooser(orm_context.statement)

            if execute_chooser is None:
                execute_chooser = _default_execute_chooser

        if execute_chooser is None:
            raise exc.ArgumentError(
                "execute_chooser or query_chooser is required"
            )
        self.execute_chooser = execute_chooser
        self.__shards: Dict[ShardIdentifier, _SessionBind] = {}
        if shards is not None:
            for k in shards:
                self.bind_shard(k, shards[k])

    def _identity_lookup(
        self,
        mapper: Mapper[_O],
        primary_key_identity: Union[Any, Tuple[Any, ...]],
        identity_token: Optional[Any] = None,
        passive: PassiveFlag = PassiveFlag.PASSIVE_OFF,
        lazy_loaded_from: Optional[InstanceState[Any]] = None,
        execution_options: OrmExecuteOptionsParameter = util.EMPTY_DICT,
        bind_arguments: Optional[_BindArguments] = None,
        **kw: Any,
    ) -> Union[Optional[_O], LoaderCallableStatus]:
        """override the default :meth:`.Session._identity_lookup` method so
        that we search for a given non-token primary key identity across all
        possible identity tokens (e.g. shard ids).

        .. versionchanged:: 1.4  Moved :meth:`.Session._identity_lookup` from
           the :class:`_query.Query` object to the :class:`.Session`.

        """

        if identity_token is not None:
            obj = super()._identity_lookup(
                mapper,
                primary_key_identity,
                identity_token=identity_token,
                **kw,
            )

            return obj
        else:
            for shard_id in self.identity_chooser(
                mapper,
                primary_key_identity,
                lazy_loaded_from=lazy_loaded_from,
                execution_options=execution_options,
                bind_arguments=dict(bind_arguments) if bind_arguments else {},
            ):
                obj2 = super()._identity_lookup(
                    mapper,
                    primary_key_identity,
                    identity_token=shard_id,
                    lazy_loaded_from=lazy_loaded_from,
                    **kw,
                )
                if obj2 is not None:
                    return obj2

            return None

    def _choose_shard_and_assign(
        self,
        mapper: Optional[_EntityBindKey[_O]],
        instance: Any,
        **kw: Any,
    ) -> Any:
        if instance is not None:
            state = inspect(instance)
            if state.key:
                token = state.key[2]
                assert token is not None
                return token
            elif state.identity_token:
                return state.identity_token

        assert isinstance(mapper, Mapper)
        shard_id = self.shard_chooser(mapper, instance, **kw)
        if instance is not None:
            state.identity_token = shard_id
        return shard_id

    def connection_callable(  # type: ignore [override]
        self,
        mapper: Optional[Mapper[_T]] = None,
        instance: Optional[Any] = None,
        shard_id: Optional[ShardIdentifier] = None,
        **kw: Any,
    ) -> Connection:
        """Provide a :class:`_engine.Connection` to use in the unit of work
        flush process.

        """

        if shard_id is None:
            shard_id = self._choose_shard_and_assign(mapper, instance)

        if self.in_transaction():
            trans = self.get_transaction()
            assert trans is not None
            return trans.connection(mapper, shard_id=shard_id)
        else:
            bind = self.get_bind(
                mapper=mapper, shard_id=shard_id, instance=instance
            )

            if isinstance(bind, Engine):
                return bind.connect(**kw)
            else:
                assert isinstance(bind, Connection)
                return bind

    def get_bind(
        self,
        mapper: Optional[_EntityBindKey[_O]] = None,
        *,
        shard_id: Optional[ShardIdentifier] = None,
        instance: Optional[Any] = None,
        clause: Optional[ClauseElement] = None,
        **kw: Any,
    ) -> _SessionBind:
        if shard_id is None:
            shard_id = self._choose_shard_and_assign(
                mapper, instance=instance, clause=clause
            )
            assert shard_id is not None
        return self.__shards[shard_id]

    def bind_shard(
        self, shard_id: ShardIdentifier, bind: Union[Engine, OptionEngine]
    ) -> None:
        self.__shards[shard_id] = bind


class set_shard_id(ORMOption):
    """a loader option for statements to apply a specific shard id to the
    primary query as well as for additional relationship and column
    loaders.

    The :class:`_horizontal.set_shard_id` option may be applied using
    the :meth:`_sql.Executable.options` method of any executable statement::

        stmt = (
            select(MyObject).
            where(MyObject.name == 'some name').
            options(set_shard_id("shard1"))
        )

    Above, the statement when invoked will limit to the "shard1" shard
    identifier for the primary query as well as for all relationship and
    column loading strategies, including eager loaders such as
    :func:`_orm.selectinload`, deferred column loaders like :func:`_orm.defer`,
    and the lazy relationship loader :func:`_orm.lazyload`.

    In this way, the :class:`_horizontal.set_shard_id` option has much wider
    scope than using the "shard_id" argument within the
    :paramref:`_orm.Session.execute.bind_arguments` dictionary.


    .. versionadded:: 2.0.0

    """

    __slots__ = ("shard_id", "propagate_to_loaders")

    def __init__(
        self, shard_id: ShardIdentifier, propagate_to_loaders: bool = True
    ):
        """Construct a :class:`_horizontal.set_shard_id` option.

        :param shard_id: shard identifier
        :param propagate_to_loaders: if left at its default of ``True``, the
         shard option will take place for lazy loaders such as
         :func:`_orm.lazyload` and :func:`_orm.defer`; if False, the option
         will not be propagated to loaded objects. Note that :func:`_orm.defer`
         always limits to the shard_id of the parent row in any case, so the
         parameter only has a net effect on the behavior of the
         :func:`_orm.lazyload` strategy.

        """
        self.shard_id = shard_id
        self.propagate_to_loaders = propagate_to_loaders


def execute_and_instances(
    orm_context: ORMExecuteState,
) -> Union[Result[_T], IteratorResult[_TP]]:
    active_options: Union[
        None,
        QueryContext.default_load_options,
        Type[QueryContext.default_load_options],
        BulkUDCompileState.default_update_options,
        Type[BulkUDCompileState.default_update_options],
    ]

    if orm_context.is_select:
        active_options = orm_context.load_options

    elif orm_context.is_update or orm_context.is_delete:
        active_options = orm_context.update_delete_options
    else:
        active_options = None

    session = orm_context.session
    assert isinstance(session, ShardedSession)

    def iter_for_shard(
        shard_id: ShardIdentifier,
    ) -> Union[Result[_T], IteratorResult[_TP]]:
        bind_arguments = dict(orm_context.bind_arguments)
        bind_arguments["shard_id"] = shard_id

        orm_context.update_execution_options(identity_token=shard_id)
        return orm_context.invoke_statement(bind_arguments=bind_arguments)

    for orm_opt in orm_context._non_compile_orm_options:
        # TODO: if we had an ORMOption that gets applied at ORM statement
        # execution time, that would allow this to be more generalized.
        # for now just iterate and look for our options
        if isinstance(orm_opt, set_shard_id):
            shard_id = orm_opt.shard_id
            break
    else:
        if active_options and active_options._identity_token is not None:
            shard_id = active_options._identity_token
        elif "_sa_shard_id" in orm_context.execution_options:
            shard_id = orm_context.execution_options["_sa_shard_id"]
        elif "shard_id" in orm_context.bind_arguments:
            shard_id = orm_context.bind_arguments["shard_id"]
        else:
            shard_id = None

    if shard_id is not None:
        return iter_for_shard(shard_id)
    else:
        partial = []
        for shard_id in session.execute_chooser(orm_context):
            result_ = iter_for_shard(shard_id)
            partial.append(result_)
        return partial[0].merge(*partial[1:])
