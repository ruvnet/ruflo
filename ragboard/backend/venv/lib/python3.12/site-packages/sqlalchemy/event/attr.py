# event/attr.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Attribute implementation for _Dispatch classes.

The various listener targets for a particular event class are represented
as attributes, which refer to collections of listeners to be fired off.
These collections can exist at the class level as well as at the instance
level.  An event is fired off using code like this::

    some_object.dispatch.first_connect(arg1, arg2)

Above, ``some_object.dispatch`` would be an instance of ``_Dispatch`` and
``first_connect`` is typically an instance of ``_ListenerCollection``
if event listeners are present, or ``_EmptyListener`` if none are present.

The attribute mechanics here spend effort trying to ensure listener functions
are available with a minimum of function call overhead, that unnecessary
objects aren't created (i.e. many empty per-instance listener collections),
as well as that everything is garbage collectable when owning references are
lost.  Other features such as "propagation" of listener functions across
many ``_Dispatch`` instances, "joining" of multiple ``_Dispatch`` instances,
as well as support for subclass propagation (e.g. events assigned to
``Pool`` vs. ``QueuePool``) are all implemented here.

"""
from __future__ import annotations

import collections
from itertools import chain
import threading
from types import TracebackType
import typing
from typing import Any
from typing import cast
from typing import Collection
from typing import Deque
from typing import FrozenSet
from typing import Generic
from typing import Iterator
from typing import MutableMapping
from typing import MutableSequence
from typing import NoReturn
from typing import Optional
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import Type
from typing import TypeVar
from typing import Union
import weakref

from . import legacy
from . import registry
from .registry import _ET
from .registry import _EventKey
from .registry import _ListenerFnType
from .. import exc
from .. import util
from ..util.concurrency import AsyncAdaptedLock
from ..util.typing import Protocol

_T = TypeVar("_T", bound=Any)

if typing.TYPE_CHECKING:
    from .base import _Dispatch
    from .base import _DispatchCommon
    from .base import _HasEventsDispatch


class RefCollection(util.MemoizedSlots, Generic[_ET]):
    __slots__ = ("ref",)

    ref: weakref.ref[RefCollection[_ET]]

    def _memoized_attr_ref(self) -> weakref.ref[RefCollection[_ET]]:
        return weakref.ref(self, registry._collection_gced)


class _empty_collection(Collection[_T]):
    def append(self, element: _T) -> None:
        pass

    def appendleft(self, element: _T) -> None:
        pass

    def extend(self, other: Sequence[_T]) -> None:
        pass

    def remove(self, element: _T) -> None:
        pass

    def __contains__(self, element: Any) -> bool:
        return False

    def __iter__(self) -> Iterator[_T]:
        return iter([])

    def clear(self) -> None:
        pass

    def __len__(self) -> int:
        return 0


_ListenerFnSequenceType = Union[Deque[_T], _empty_collection[_T]]


class _ClsLevelDispatch(RefCollection[_ET]):
    """Class-level events on :class:`._Dispatch` classes."""

    __slots__ = (
        "clsname",
        "name",
        "arg_names",
        "has_kw",
        "legacy_signatures",
        "_clslevel",
        "__weakref__",
    )

    clsname: str
    name: str
    arg_names: Sequence[str]
    has_kw: bool
    legacy_signatures: MutableSequence[legacy._LegacySignatureType]
    _clslevel: MutableMapping[
        Type[_ET], _ListenerFnSequenceType[_ListenerFnType]
    ]

    def __init__(
        self,
        parent_dispatch_cls: Type[_HasEventsDispatch[_ET]],
        fn: _ListenerFnType,
    ):
        self.name = fn.__name__
        self.clsname = parent_dispatch_cls.__name__
        argspec = util.inspect_getfullargspec(fn)
        self.arg_names = argspec.args[1:]
        self.has_kw = bool(argspec.varkw)
        self.legacy_signatures = list(
            reversed(
                sorted(
                    getattr(fn, "_legacy_signatures", []), key=lambda s: s[0]
                )
            )
        )
        fn.__doc__ = legacy._augment_fn_docs(self, parent_dispatch_cls, fn)

        self._clslevel = weakref.WeakKeyDictionary()

    def _adjust_fn_spec(
        self, fn: _ListenerFnType, named: bool
    ) -> _ListenerFnType:
        if named:
            fn = self._wrap_fn_for_kw(fn)
        if self.legacy_signatures:
            try:
                argspec = util.get_callable_argspec(fn, no_self=True)
            except TypeError:
                pass
            else:
                fn = legacy._wrap_fn_for_legacy(self, fn, argspec)
        return fn

    def _wrap_fn_for_kw(self, fn: _ListenerFnType) -> _ListenerFnType:
        def wrap_kw(*args: Any, **kw: Any) -> Any:
            argdict = dict(zip(self.arg_names, args))
            argdict.update(kw)
            return fn(**argdict)

        return wrap_kw

    def _do_insert_or_append(
        self, event_key: _EventKey[_ET], is_append: bool
    ) -> None:
        target = event_key.dispatch_target
        assert isinstance(
            target, type
        ), "Class-level Event targets must be classes."
        if not getattr(target, "_sa_propagate_class_events", True):
            raise exc.InvalidRequestError(
                f"Can't assign an event directly to the {target} class"
            )

        cls: Type[_ET]

        for cls in util.walk_subclasses(target):
            if cls is not target and cls not in self._clslevel:
                self.update_subclass(cls)
            else:
                if cls not in self._clslevel:
                    self.update_subclass(cls)
                if is_append:
                    self._clslevel[cls].append(event_key._listen_fn)
                else:
                    self._clslevel[cls].appendleft(event_key._listen_fn)
        registry._stored_in_collection(event_key, self)

    def insert(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        self._do_insert_or_append(event_key, is_append=False)

    def append(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        self._do_insert_or_append(event_key, is_append=True)

    def update_subclass(self, target: Type[_ET]) -> None:
        if target not in self._clslevel:
            if getattr(target, "_sa_propagate_class_events", True):
                self._clslevel[target] = collections.deque()
            else:
                self._clslevel[target] = _empty_collection()

        clslevel = self._clslevel[target]
        cls: Type[_ET]
        for cls in target.__mro__[1:]:
            if cls in self._clslevel:
                clslevel.extend(
                    [fn for fn in self._clslevel[cls] if fn not in clslevel]
                )

    def remove(self, event_key: _EventKey[_ET]) -> None:
        target = event_key.dispatch_target
        cls: Type[_ET]
        for cls in util.walk_subclasses(target):
            if cls in self._clslevel:
                self._clslevel[cls].remove(event_key._listen_fn)
        registry._removed_from_collection(event_key, self)

    def clear(self) -> None:
        """Clear all class level listeners"""

        to_clear: Set[_ListenerFnType] = set()
        for dispatcher in self._clslevel.values():
            to_clear.update(dispatcher)
            dispatcher.clear()
        registry._clear(self, to_clear)

    def for_modify(self, obj: _Dispatch[_ET]) -> _ClsLevelDispatch[_ET]:
        """Return an event collection which can be modified.

        For _ClsLevelDispatch at the class level of
        a dispatcher, this returns self.

        """
        return self


class _InstanceLevelDispatch(RefCollection[_ET], Collection[_ListenerFnType]):
    __slots__ = ()

    parent: _ClsLevelDispatch[_ET]

    def _adjust_fn_spec(
        self, fn: _ListenerFnType, named: bool
    ) -> _ListenerFnType:
        return self.parent._adjust_fn_spec(fn, named)

    def __contains__(self, item: Any) -> bool:
        raise NotImplementedError()

    def __len__(self) -> int:
        raise NotImplementedError()

    def __iter__(self) -> Iterator[_ListenerFnType]:
        raise NotImplementedError()

    def __bool__(self) -> bool:
        raise NotImplementedError()

    def exec_once(self, *args: Any, **kw: Any) -> None:
        raise NotImplementedError()

    def exec_once_unless_exception(self, *args: Any, **kw: Any) -> None:
        raise NotImplementedError()

    def _exec_w_sync_on_first_run(self, *args: Any, **kw: Any) -> None:
        raise NotImplementedError()

    def __call__(self, *args: Any, **kw: Any) -> None:
        raise NotImplementedError()

    def insert(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        raise NotImplementedError()

    def append(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        raise NotImplementedError()

    def remove(self, event_key: _EventKey[_ET]) -> None:
        raise NotImplementedError()

    def for_modify(
        self, obj: _DispatchCommon[_ET]
    ) -> _InstanceLevelDispatch[_ET]:
        """Return an event collection which can be modified.

        For _ClsLevelDispatch at the class level of
        a dispatcher, this returns self.

        """
        return self


class _EmptyListener(_InstanceLevelDispatch[_ET]):
    """Serves as a proxy interface to the events
    served by a _ClsLevelDispatch, when there are no
    instance-level events present.

    Is replaced by _ListenerCollection when instance-level
    events are added.

    """

    __slots__ = "parent", "parent_listeners", "name"

    propagate: FrozenSet[_ListenerFnType] = frozenset()
    listeners: Tuple[()] = ()
    parent: _ClsLevelDispatch[_ET]
    parent_listeners: _ListenerFnSequenceType[_ListenerFnType]
    name: str

    def __init__(self, parent: _ClsLevelDispatch[_ET], target_cls: Type[_ET]):
        if target_cls not in parent._clslevel:
            parent.update_subclass(target_cls)
        self.parent = parent
        self.parent_listeners = parent._clslevel[target_cls]
        self.name = parent.name

    def for_modify(
        self, obj: _DispatchCommon[_ET]
    ) -> _ListenerCollection[_ET]:
        """Return an event collection which can be modified.

        For _EmptyListener at the instance level of
        a dispatcher, this generates a new
        _ListenerCollection, applies it to the instance,
        and returns it.

        """
        obj = cast("_Dispatch[_ET]", obj)

        assert obj._instance_cls is not None
        result = _ListenerCollection(self.parent, obj._instance_cls)
        if getattr(obj, self.name) is self:
            setattr(obj, self.name, result)
        else:
            assert isinstance(getattr(obj, self.name), _JoinedListener)
        return result

    def _needs_modify(self, *args: Any, **kw: Any) -> NoReturn:
        raise NotImplementedError("need to call for_modify()")

    def exec_once(self, *args: Any, **kw: Any) -> NoReturn:
        self._needs_modify(*args, **kw)

    def exec_once_unless_exception(self, *args: Any, **kw: Any) -> NoReturn:
        self._needs_modify(*args, **kw)

    def insert(self, *args: Any, **kw: Any) -> NoReturn:
        self._needs_modify(*args, **kw)

    def append(self, *args: Any, **kw: Any) -> NoReturn:
        self._needs_modify(*args, **kw)

    def remove(self, *args: Any, **kw: Any) -> NoReturn:
        self._needs_modify(*args, **kw)

    def clear(self, *args: Any, **kw: Any) -> NoReturn:
        self._needs_modify(*args, **kw)

    def __call__(self, *args: Any, **kw: Any) -> None:
        """Execute this event."""

        for fn in self.parent_listeners:
            fn(*args, **kw)

    def __contains__(self, item: Any) -> bool:
        return item in self.parent_listeners

    def __len__(self) -> int:
        return len(self.parent_listeners)

    def __iter__(self) -> Iterator[_ListenerFnType]:
        return iter(self.parent_listeners)

    def __bool__(self) -> bool:
        return bool(self.parent_listeners)


class _MutexProtocol(Protocol):
    def __enter__(self) -> bool:
        ...

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[TracebackType],
    ) -> Optional[bool]:
        ...


class _CompoundListener(_InstanceLevelDispatch[_ET]):
    __slots__ = (
        "_exec_once_mutex",
        "_exec_once",
        "_exec_w_sync_once",
        "_is_asyncio",
    )

    _exec_once_mutex: _MutexProtocol
    parent_listeners: Collection[_ListenerFnType]
    listeners: Collection[_ListenerFnType]
    _exec_once: bool
    _exec_w_sync_once: bool

    def __init__(self, *arg: Any, **kw: Any):
        super().__init__(*arg, **kw)
        self._is_asyncio = False

    def _set_asyncio(self) -> None:
        self._is_asyncio = True

    def _memoized_attr__exec_once_mutex(self) -> _MutexProtocol:
        if self._is_asyncio:
            return AsyncAdaptedLock()
        else:
            return threading.Lock()

    def _exec_once_impl(
        self, retry_on_exception: bool, *args: Any, **kw: Any
    ) -> None:
        with self._exec_once_mutex:
            if not self._exec_once:
                try:
                    self(*args, **kw)
                    exception = False
                except:
                    exception = True
                    raise
                finally:
                    if not exception or not retry_on_exception:
                        self._exec_once = True

    def exec_once(self, *args: Any, **kw: Any) -> None:
        """Execute this event, but only if it has not been
        executed already for this collection."""

        if not self._exec_once:
            self._exec_once_impl(False, *args, **kw)

    def exec_once_unless_exception(self, *args: Any, **kw: Any) -> None:
        """Execute this event, but only if it has not been
        executed already for this collection, or was called
        by a previous exec_once_unless_exception call and
        raised an exception.

        If exec_once was already called, then this method will never run
        the callable regardless of whether it raised or not.

        .. versionadded:: 1.3.8

        """
        if not self._exec_once:
            self._exec_once_impl(True, *args, **kw)

    def _exec_w_sync_on_first_run(self, *args: Any, **kw: Any) -> None:
        """Execute this event, and use a mutex if it has not been
        executed already for this collection, or was called
        by a previous _exec_w_sync_on_first_run call and
        raised an exception.

        If _exec_w_sync_on_first_run was already called and didn't raise an
        exception, then a mutex is not used.

        .. versionadded:: 1.4.11

        """
        if not self._exec_w_sync_once:
            with self._exec_once_mutex:
                try:
                    self(*args, **kw)
                except:
                    raise
                else:
                    self._exec_w_sync_once = True
        else:
            self(*args, **kw)

    def __call__(self, *args: Any, **kw: Any) -> None:
        """Execute this event."""

        for fn in self.parent_listeners:
            fn(*args, **kw)
        for fn in self.listeners:
            fn(*args, **kw)

    def __contains__(self, item: Any) -> bool:
        return item in self.parent_listeners or item in self.listeners

    def __len__(self) -> int:
        return len(self.parent_listeners) + len(self.listeners)

    def __iter__(self) -> Iterator[_ListenerFnType]:
        return chain(self.parent_listeners, self.listeners)

    def __bool__(self) -> bool:
        return bool(self.listeners or self.parent_listeners)


class _ListenerCollection(_CompoundListener[_ET]):
    """Instance-level attributes on instances of :class:`._Dispatch`.

    Represents a collection of listeners.

    As of 0.7.9, _ListenerCollection is only first
    created via the _EmptyListener.for_modify() method.

    """

    __slots__ = (
        "parent_listeners",
        "parent",
        "name",
        "listeners",
        "propagate",
        "__weakref__",
    )

    parent_listeners: Collection[_ListenerFnType]
    parent: _ClsLevelDispatch[_ET]
    name: str
    listeners: Deque[_ListenerFnType]
    propagate: Set[_ListenerFnType]

    def __init__(self, parent: _ClsLevelDispatch[_ET], target_cls: Type[_ET]):
        super().__init__()
        if target_cls not in parent._clslevel:
            parent.update_subclass(target_cls)
        self._exec_once = False
        self._exec_w_sync_once = False
        self.parent_listeners = parent._clslevel[target_cls]
        self.parent = parent
        self.name = parent.name
        self.listeners = collections.deque()
        self.propagate = set()

    def for_modify(
        self, obj: _DispatchCommon[_ET]
    ) -> _ListenerCollection[_ET]:
        """Return an event collection which can be modified.

        For _ListenerCollection at the instance level of
        a dispatcher, this returns self.

        """
        return self

    def _update(
        self, other: _ListenerCollection[_ET], only_propagate: bool = True
    ) -> None:
        """Populate from the listeners in another :class:`_Dispatch`
        object."""
        existing_listeners = self.listeners
        existing_listener_set = set(existing_listeners)
        self.propagate.update(other.propagate)
        other_listeners = [
            l
            for l in other.listeners
            if l not in existing_listener_set
            and not only_propagate
            or l in self.propagate
        ]

        existing_listeners.extend(other_listeners)

        if other._is_asyncio:
            self._set_asyncio()

        to_associate = other.propagate.union(other_listeners)
        registry._stored_in_collection_multi(self, other, to_associate)

    def insert(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        if event_key.prepend_to_list(self, self.listeners):
            if propagate:
                self.propagate.add(event_key._listen_fn)

    def append(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        if event_key.append_to_list(self, self.listeners):
            if propagate:
                self.propagate.add(event_key._listen_fn)

    def remove(self, event_key: _EventKey[_ET]) -> None:
        self.listeners.remove(event_key._listen_fn)
        self.propagate.discard(event_key._listen_fn)
        registry._removed_from_collection(event_key, self)

    def clear(self) -> None:
        registry._clear(self, self.listeners)
        self.propagate.clear()
        self.listeners.clear()


class _JoinedListener(_CompoundListener[_ET]):
    __slots__ = "parent_dispatch", "name", "local", "parent_listeners"

    parent_dispatch: _DispatchCommon[_ET]
    name: str
    local: _InstanceLevelDispatch[_ET]
    parent_listeners: Collection[_ListenerFnType]

    def __init__(
        self,
        parent_dispatch: _DispatchCommon[_ET],
        name: str,
        local: _EmptyListener[_ET],
    ):
        self._exec_once = False
        self.parent_dispatch = parent_dispatch
        self.name = name
        self.local = local
        self.parent_listeners = self.local

    if not typing.TYPE_CHECKING:
        # first error, I don't really understand:
        # Signature of "listeners" incompatible with
        # supertype "_CompoundListener"  [override]
        # the name / return type are exactly the same
        # second error is getattr_isn't typed, the cast() here
        # adds too much method overhead
        @property
        def listeners(self) -> Collection[_ListenerFnType]:
            return getattr(self.parent_dispatch, self.name)

    def _adjust_fn_spec(
        self, fn: _ListenerFnType, named: bool
    ) -> _ListenerFnType:
        return self.local._adjust_fn_spec(fn, named)

    def for_modify(self, obj: _DispatchCommon[_ET]) -> _JoinedListener[_ET]:
        self.local = self.parent_listeners = self.local.for_modify(obj)
        return self

    def insert(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        self.local.insert(event_key, propagate)

    def append(self, event_key: _EventKey[_ET], propagate: bool) -> None:
        self.local.append(event_key, propagate)

    def remove(self, event_key: _EventKey[_ET]) -> None:
        self.local.remove(event_key)

    def clear(self) -> None:
        raise NotImplementedError()
