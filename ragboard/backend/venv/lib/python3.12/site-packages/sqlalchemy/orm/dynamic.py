# orm/dynamic.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php


"""Dynamic collection API.

Dynamic collections act like Query() objects for read operations and support
basic add/delete mutation.

.. legacy:: the "dynamic" loader is a legacy feature, superseded by the
 "write_only" loader.


"""

from __future__ import annotations

from typing import Any
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Optional
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from . import attributes
from . import exc as orm_exc
from . import relationships
from . import util as orm_util
from .base import PassiveFlag
from .query import Query
from .session import object_session
from .writeonly import AbstractCollectionWriter
from .writeonly import WriteOnlyAttributeImpl
from .writeonly import WriteOnlyHistory
from .writeonly import WriteOnlyLoader
from .. import util
from ..engine import result


if TYPE_CHECKING:
    from . import QueryableAttribute
    from .mapper import Mapper
    from .relationships import _RelationshipOrderByArg
    from .session import Session
    from .state import InstanceState
    from .util import AliasedClass
    from ..event import _Dispatch
    from ..sql.elements import ColumnElement

_T = TypeVar("_T", bound=Any)


class DynamicCollectionHistory(WriteOnlyHistory[_T]):
    def __init__(
        self,
        attr: DynamicAttributeImpl,
        state: InstanceState[_T],
        passive: PassiveFlag,
        apply_to: Optional[DynamicCollectionHistory[_T]] = None,
    ) -> None:
        if apply_to:
            coll = AppenderQuery(attr, state).autoflush(False)
            self.unchanged_items = util.OrderedIdentitySet(coll)
            self.added_items = apply_to.added_items
            self.deleted_items = apply_to.deleted_items
            self._reconcile_collection = True
        else:
            self.deleted_items = util.OrderedIdentitySet()
            self.added_items = util.OrderedIdentitySet()
            self.unchanged_items = util.OrderedIdentitySet()
            self._reconcile_collection = False


class DynamicAttributeImpl(WriteOnlyAttributeImpl):
    _supports_dynamic_iteration = True
    collection_history_cls = DynamicCollectionHistory[Any]
    query_class: Type[AppenderMixin[Any]]  # type: ignore[assignment]

    def __init__(
        self,
        class_: Union[Type[Any], AliasedClass[Any]],
        key: str,
        dispatch: _Dispatch[QueryableAttribute[Any]],
        target_mapper: Mapper[_T],
        order_by: _RelationshipOrderByArg,
        query_class: Optional[Type[AppenderMixin[_T]]] = None,
        **kw: Any,
    ) -> None:
        attributes.AttributeImpl.__init__(
            self, class_, key, None, dispatch, **kw
        )
        self.target_mapper = target_mapper
        if order_by:
            self.order_by = tuple(order_by)
        if not query_class:
            self.query_class = AppenderQuery
        elif AppenderMixin in query_class.mro():
            self.query_class = query_class
        else:
            self.query_class = mixin_user_query(query_class)


@relationships.RelationshipProperty.strategy_for(lazy="dynamic")
class DynaLoader(WriteOnlyLoader):
    impl_class = DynamicAttributeImpl


class AppenderMixin(AbstractCollectionWriter[_T]):
    """A mixin that expects to be mixing in a Query class with
    AbstractAppender.


    """

    query_class: Optional[Type[Query[_T]]] = None
    _order_by_clauses: Tuple[ColumnElement[Any], ...]

    def __init__(
        self, attr: DynamicAttributeImpl, state: InstanceState[_T]
    ) -> None:
        Query.__init__(
            self,  # type: ignore[arg-type]
            attr.target_mapper,
            None,
        )
        super().__init__(attr, state)

    @property
    def session(self) -> Optional[Session]:
        sess = object_session(self.instance)
        if sess is not None and sess.autoflush and self.instance in sess:
            sess.flush()
        if not orm_util.has_identity(self.instance):
            return None
        else:
            return sess

    @session.setter
    def session(self, session: Session) -> None:
        self.sess = session

    def _iter(self) -> Union[result.ScalarResult[_T], result.Result[_T]]:
        sess = self.session
        if sess is None:
            state = attributes.instance_state(self.instance)
            if state.detached:
                util.warn(
                    "Instance %s is detached, dynamic relationship cannot "
                    "return a correct result.   This warning will become "
                    "a DetachedInstanceError in a future release."
                    % (orm_util.state_str(state))
                )

            return result.IteratorResult(
                result.SimpleResultMetaData([self.attr.class_.__name__]),
                self.attr._get_collection_history(  # type: ignore[arg-type]
                    attributes.instance_state(self.instance),
                    PassiveFlag.PASSIVE_NO_INITIALIZE,
                ).added_items,
                _source_supports_scalars=True,
            ).scalars()
        else:
            return self._generate(sess)._iter()

    if TYPE_CHECKING:

        def __iter__(self) -> Iterator[_T]:
            ...

    def __getitem__(self, index: Any) -> Union[_T, List[_T]]:
        sess = self.session
        if sess is None:
            return self.attr._get_collection_history(
                attributes.instance_state(self.instance),
                PassiveFlag.PASSIVE_NO_INITIALIZE,
            ).indexed(index)
        else:
            return self._generate(sess).__getitem__(index)  # type: ignore[no-any-return] # noqa: E501

    def count(self) -> int:
        sess = self.session
        if sess is None:
            return len(
                self.attr._get_collection_history(
                    attributes.instance_state(self.instance),
                    PassiveFlag.PASSIVE_NO_INITIALIZE,
                ).added_items
            )
        else:
            return self._generate(sess).count()

    def _generate(
        self,
        sess: Optional[Session] = None,
    ) -> Query[_T]:
        # note we're returning an entirely new Query class instance
        # here without any assignment capabilities; the class of this
        # query is determined by the session.
        instance = self.instance
        if sess is None:
            sess = object_session(instance)
            if sess is None:
                raise orm_exc.DetachedInstanceError(
                    "Parent instance %s is not bound to a Session, and no "
                    "contextual session is established; lazy load operation "
                    "of attribute '%s' cannot proceed"
                    % (orm_util.instance_str(instance), self.attr.key)
                )

        if self.query_class:
            query = self.query_class(self.attr.target_mapper, session=sess)
        else:
            query = sess.query(self.attr.target_mapper)

        query._where_criteria = self._where_criteria
        query._from_obj = self._from_obj
        query._order_by_clauses = self._order_by_clauses

        return query

    def add_all(self, iterator: Iterable[_T]) -> None:
        """Add an iterable of items to this :class:`_orm.AppenderQuery`.

        The given items will be persisted to the database in terms of
        the parent instance's collection on the next flush.

        This method is provided to assist in delivering forwards-compatibility
        with the :class:`_orm.WriteOnlyCollection` collection class.

        .. versionadded:: 2.0

        """
        self._add_all_impl(iterator)

    def add(self, item: _T) -> None:
        """Add an item to this :class:`_orm.AppenderQuery`.

        The given item will be persisted to the database in terms of
        the parent instance's collection on the next flush.

        This method is provided to assist in delivering forwards-compatibility
        with the :class:`_orm.WriteOnlyCollection` collection class.

        .. versionadded:: 2.0

        """
        self._add_all_impl([item])

    def extend(self, iterator: Iterable[_T]) -> None:
        """Add an iterable of items to this :class:`_orm.AppenderQuery`.

        The given items will be persisted to the database in terms of
        the parent instance's collection on the next flush.

        """
        self._add_all_impl(iterator)

    def append(self, item: _T) -> None:
        """Append an item to this :class:`_orm.AppenderQuery`.

        The given item will be persisted to the database in terms of
        the parent instance's collection on the next flush.

        """
        self._add_all_impl([item])

    def remove(self, item: _T) -> None:
        """Remove an item from this :class:`_orm.AppenderQuery`.

        The given item will be removed from the parent instance's collection on
        the next flush.

        """
        self._remove_impl(item)


class AppenderQuery(AppenderMixin[_T], Query[_T]):  # type: ignore[misc]
    """A dynamic query that supports basic collection storage operations.

    Methods on :class:`.AppenderQuery` include all methods of
    :class:`_orm.Query`, plus additional methods used for collection
    persistence.


    """


def mixin_user_query(cls: Any) -> type[AppenderMixin[Any]]:
    """Return a new class with AppenderQuery functionality layered over."""
    name = "Appender" + cls.__name__
    return type(name, (AppenderMixin, cls), {"query_class": cls})
