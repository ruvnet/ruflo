# event/registry.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Provides managed registration services on behalf of :func:`.listen`
arguments.

By "managed registration", we mean that event listening functions and
other objects can be added to various collections in such a way that their
membership in all those collections can be revoked at once, based on
an equivalent :class:`._EventKey`.

"""
from __future__ import annotations

import collections
import types
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Deque
from typing import Dict
from typing import Generic
from typing import Iterable
from typing import Optional
from typing import Tuple
from typing import TypeVar
from typing import Union
import weakref

from .. import exc
from .. import util

if typing.TYPE_CHECKING:
    from .attr import RefCollection
    from .base import dispatcher

_ListenerFnType = Callable[..., Any]
_ListenerFnKeyType = Union[int, Tuple[int, int]]
_EventKeyTupleType = Tuple[int, str, _ListenerFnKeyType]


_ET = TypeVar("_ET", bound="EventTarget")


class EventTarget:
    """represents an event target, that is, something we can listen on
    either with that target as a class or as an instance.

    Examples include:  Connection, Mapper, Table, Session,
    InstrumentedAttribute, Engine, Pool, Dialect.

    """

    __slots__ = ()

    dispatch: dispatcher[Any]


_RefCollectionToListenerType = Dict[
    "weakref.ref[RefCollection[Any]]",
    "weakref.ref[_ListenerFnType]",
]

_key_to_collection: Dict[
    _EventKeyTupleType, _RefCollectionToListenerType
] = collections.defaultdict(dict)
"""
Given an original listen() argument, can locate all
listener collections and the listener fn contained

(target, identifier, fn) -> {
                            ref(listenercollection) -> ref(listener_fn)
                            ref(listenercollection) -> ref(listener_fn)
                            ref(listenercollection) -> ref(listener_fn)
                        }
"""

_ListenerToEventKeyType = Dict[
    "weakref.ref[_ListenerFnType]",
    _EventKeyTupleType,
]
_collection_to_key: Dict[
    weakref.ref[RefCollection[Any]],
    _ListenerToEventKeyType,
] = collections.defaultdict(dict)
"""
Given a _ListenerCollection or _ClsLevelListener, can locate
all the original listen() arguments and the listener fn contained

ref(listenercollection) -> {
                            ref(listener_fn) -> (target, identifier, fn),
                            ref(listener_fn) -> (target, identifier, fn),
                            ref(listener_fn) -> (target, identifier, fn),
                        }
"""


def _collection_gced(ref: weakref.ref[Any]) -> None:
    # defaultdict, so can't get a KeyError
    if not _collection_to_key or ref not in _collection_to_key:
        return

    ref = cast("weakref.ref[RefCollection[EventTarget]]", ref)

    listener_to_key = _collection_to_key.pop(ref)
    for key in listener_to_key.values():
        if key in _key_to_collection:
            # defaultdict, so can't get a KeyError
            dispatch_reg = _key_to_collection[key]
            dispatch_reg.pop(ref)
            if not dispatch_reg:
                _key_to_collection.pop(key)


def _stored_in_collection(
    event_key: _EventKey[_ET], owner: RefCollection[_ET]
) -> bool:
    key = event_key._key

    dispatch_reg = _key_to_collection[key]

    owner_ref = owner.ref
    listen_ref = weakref.ref(event_key._listen_fn)

    if owner_ref in dispatch_reg:
        return False

    dispatch_reg[owner_ref] = listen_ref

    listener_to_key = _collection_to_key[owner_ref]
    listener_to_key[listen_ref] = key

    return True


def _removed_from_collection(
    event_key: _EventKey[_ET], owner: RefCollection[_ET]
) -> None:
    key = event_key._key

    dispatch_reg = _key_to_collection[key]

    listen_ref = weakref.ref(event_key._listen_fn)

    owner_ref = owner.ref
    dispatch_reg.pop(owner_ref, None)
    if not dispatch_reg:
        del _key_to_collection[key]

    if owner_ref in _collection_to_key:
        listener_to_key = _collection_to_key[owner_ref]
        listener_to_key.pop(listen_ref)


def _stored_in_collection_multi(
    newowner: RefCollection[_ET],
    oldowner: RefCollection[_ET],
    elements: Iterable[_ListenerFnType],
) -> None:
    if not elements:
        return

    oldowner_ref = oldowner.ref
    newowner_ref = newowner.ref

    old_listener_to_key = _collection_to_key[oldowner_ref]
    new_listener_to_key = _collection_to_key[newowner_ref]

    for listen_fn in elements:
        listen_ref = weakref.ref(listen_fn)
        try:
            key = old_listener_to_key[listen_ref]
        except KeyError:
            # can occur during interpreter shutdown.
            # see #6740
            continue

        try:
            dispatch_reg = _key_to_collection[key]
        except KeyError:
            continue

        if newowner_ref in dispatch_reg:
            assert dispatch_reg[newowner_ref] == listen_ref
        else:
            dispatch_reg[newowner_ref] = listen_ref

        new_listener_to_key[listen_ref] = key


def _clear(
    owner: RefCollection[_ET],
    elements: Iterable[_ListenerFnType],
) -> None:
    if not elements:
        return

    owner_ref = owner.ref
    listener_to_key = _collection_to_key[owner_ref]
    for listen_fn in elements:
        listen_ref = weakref.ref(listen_fn)
        key = listener_to_key[listen_ref]
        dispatch_reg = _key_to_collection[key]
        dispatch_reg.pop(owner_ref, None)

        if not dispatch_reg:
            del _key_to_collection[key]


class _EventKey(Generic[_ET]):
    """Represent :func:`.listen` arguments."""

    __slots__ = (
        "target",
        "identifier",
        "fn",
        "fn_key",
        "fn_wrap",
        "dispatch_target",
    )

    target: _ET
    identifier: str
    fn: _ListenerFnType
    fn_key: _ListenerFnKeyType
    dispatch_target: Any
    _fn_wrap: Optional[_ListenerFnType]

    def __init__(
        self,
        target: _ET,
        identifier: str,
        fn: _ListenerFnType,
        dispatch_target: Any,
        _fn_wrap: Optional[_ListenerFnType] = None,
    ):
        self.target = target
        self.identifier = identifier
        self.fn = fn
        if isinstance(fn, types.MethodType):
            self.fn_key = id(fn.__func__), id(fn.__self__)
        else:
            self.fn_key = id(fn)
        self.fn_wrap = _fn_wrap
        self.dispatch_target = dispatch_target

    @property
    def _key(self) -> _EventKeyTupleType:
        return (id(self.target), self.identifier, self.fn_key)

    def with_wrapper(self, fn_wrap: _ListenerFnType) -> _EventKey[_ET]:
        if fn_wrap is self._listen_fn:
            return self
        else:
            return _EventKey(
                self.target,
                self.identifier,
                self.fn,
                self.dispatch_target,
                _fn_wrap=fn_wrap,
            )

    def with_dispatch_target(self, dispatch_target: Any) -> _EventKey[_ET]:
        if dispatch_target is self.dispatch_target:
            return self
        else:
            return _EventKey(
                self.target,
                self.identifier,
                self.fn,
                dispatch_target,
                _fn_wrap=self.fn_wrap,
            )

    def listen(self, *args: Any, **kw: Any) -> None:
        once = kw.pop("once", False)
        once_unless_exception = kw.pop("_once_unless_exception", False)
        named = kw.pop("named", False)

        target, identifier, fn = (
            self.dispatch_target,
            self.identifier,
            self._listen_fn,
        )

        dispatch_collection = getattr(target.dispatch, identifier)

        adjusted_fn = dispatch_collection._adjust_fn_spec(fn, named)

        self = self.with_wrapper(adjusted_fn)

        stub_function = getattr(
            self.dispatch_target.dispatch._events, self.identifier
        )
        if hasattr(stub_function, "_sa_warn"):
            stub_function._sa_warn()

        if once or once_unless_exception:
            self.with_wrapper(
                util.only_once(
                    self._listen_fn, retry_on_exception=once_unless_exception
                )
            ).listen(*args, **kw)
        else:
            self.dispatch_target.dispatch._listen(self, *args, **kw)

    def remove(self) -> None:
        key = self._key

        if key not in _key_to_collection:
            raise exc.InvalidRequestError(
                "No listeners found for event %s / %r / %s "
                % (self.target, self.identifier, self.fn)
            )

        dispatch_reg = _key_to_collection.pop(key)

        for collection_ref, listener_ref in dispatch_reg.items():
            collection = collection_ref()
            listener_fn = listener_ref()
            if collection is not None and listener_fn is not None:
                collection.remove(self.with_wrapper(listener_fn))

    def contains(self) -> bool:
        """Return True if this event key is registered to listen."""
        return self._key in _key_to_collection

    def base_listen(
        self,
        propagate: bool = False,
        insert: bool = False,
        named: bool = False,
        retval: Optional[bool] = None,
        asyncio: bool = False,
    ) -> None:
        target, identifier = self.dispatch_target, self.identifier

        dispatch_collection = getattr(target.dispatch, identifier)

        for_modify = dispatch_collection.for_modify(target.dispatch)
        if asyncio:
            for_modify._set_asyncio()

        if insert:
            for_modify.insert(self, propagate)
        else:
            for_modify.append(self, propagate)

    @property
    def _listen_fn(self) -> _ListenerFnType:
        return self.fn_wrap or self.fn

    def append_to_list(
        self,
        owner: RefCollection[_ET],
        list_: Deque[_ListenerFnType],
    ) -> bool:
        if _stored_in_collection(self, owner):
            list_.append(self._listen_fn)
            return True
        else:
            return False

    def remove_from_list(
        self,
        owner: RefCollection[_ET],
        list_: Deque[_ListenerFnType],
    ) -> None:
        _removed_from_collection(self, owner)
        list_.remove(self._listen_fn)

    def prepend_to_list(
        self,
        owner: RefCollection[_ET],
        list_: Deque[_ListenerFnType],
    ) -> bool:
        if _stored_in_collection(self, owner):
            list_.appendleft(self._listen_fn)
            return True
        else:
            return False
