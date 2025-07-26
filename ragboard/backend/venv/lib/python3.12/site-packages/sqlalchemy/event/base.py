# event/base.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Base implementation classes.

The public-facing ``Events`` serves as the base class for an event interface;
its public attributes represent different kinds of events.   These attributes
are mirrored onto a ``_Dispatch`` class, which serves as a container for
collections of listener functions.   These collections are represented both
at the class level of a particular ``_Dispatch`` class as well as within
instances of ``_Dispatch``.

"""
from __future__ import annotations

import typing
from typing import Any
from typing import cast
from typing import Dict
from typing import Generic
from typing import Iterator
from typing import List
from typing import Mapping
from typing import MutableMapping
from typing import Optional
from typing import overload
from typing import Tuple
from typing import Type
from typing import Union
import weakref

from .attr import _ClsLevelDispatch
from .attr import _EmptyListener
from .attr import _InstanceLevelDispatch
from .attr import _JoinedListener
from .registry import _ET
from .registry import _EventKey
from .. import util
from ..util.typing import Literal

_registrars: MutableMapping[
    str, List[Type[_HasEventsDispatch[Any]]]
] = util.defaultdict(list)


def _is_event_name(name: str) -> bool:
    # _sa_event prefix is special to support internal-only event names.
    # most event names are just plain method names that aren't
    # underscored.

    return (
        not name.startswith("_") and name != "dispatch"
    ) or name.startswith("_sa_event")


class _UnpickleDispatch:
    """Serializable callable that re-generates an instance of
    :class:`_Dispatch` given a particular :class:`.Events` subclass.

    """

    def __call__(self, _instance_cls: Type[_ET]) -> _Dispatch[_ET]:
        for cls in _instance_cls.__mro__:
            if "dispatch" in cls.__dict__:
                return cast(
                    "_Dispatch[_ET]", cls.__dict__["dispatch"].dispatch
                )._for_class(_instance_cls)
        else:
            raise AttributeError("No class with a 'dispatch' member present.")


class _DispatchCommon(Generic[_ET]):
    __slots__ = ()

    _instance_cls: Optional[Type[_ET]]

    def _join(self, other: _DispatchCommon[_ET]) -> _JoinedDispatcher[_ET]:
        raise NotImplementedError()

    def __getattr__(self, name: str) -> _InstanceLevelDispatch[_ET]:
        raise NotImplementedError()

    @property
    def _events(self) -> Type[_HasEventsDispatch[_ET]]:
        raise NotImplementedError()


class _Dispatch(_DispatchCommon[_ET]):
    """Mirror the event listening definitions of an Events class with
    listener collections.

    Classes which define a "dispatch" member will return a
    non-instantiated :class:`._Dispatch` subclass when the member
    is accessed at the class level.  When the "dispatch" member is
    accessed at the instance level of its owner, an instance
    of the :class:`._Dispatch` class is returned.

    A :class:`._Dispatch` class is generated for each :class:`.Events`
    class defined, by the :meth:`._HasEventsDispatch._create_dispatcher_class`
    method.  The original :class:`.Events` classes remain untouched.
    This decouples the construction of :class:`.Events` subclasses from
    the implementation used by the event internals, and allows
    inspecting tools like Sphinx to work in an unsurprising
    way against the public API.

    """

    # "active_history" is an ORM case we add here.   ideally a better
    # system would be in place for ad-hoc attributes.
    __slots__ = "_parent", "_instance_cls", "__dict__", "_empty_listeners"

    _active_history: bool

    _empty_listener_reg: MutableMapping[
        Type[_ET], Dict[str, _EmptyListener[_ET]]
    ] = weakref.WeakKeyDictionary()

    _empty_listeners: Dict[str, _EmptyListener[_ET]]

    _event_names: List[str]

    _instance_cls: Optional[Type[_ET]]

    _joined_dispatch_cls: Type[_JoinedDispatcher[_ET]]

    _events: Type[_HasEventsDispatch[_ET]]
    """reference back to the Events class.

    Bidirectional against _HasEventsDispatch.dispatch

    """

    def __init__(
        self,
        parent: Optional[_Dispatch[_ET]],
        instance_cls: Optional[Type[_ET]] = None,
    ):
        self._parent = parent
        self._instance_cls = instance_cls

        if instance_cls:
            assert parent is not None
            try:
                self._empty_listeners = self._empty_listener_reg[instance_cls]
            except KeyError:
                self._empty_listeners = self._empty_listener_reg[
                    instance_cls
                ] = {
                    ls.name: _EmptyListener(ls, instance_cls)
                    for ls in parent._event_descriptors
                }
        else:
            self._empty_listeners = {}

    def __getattr__(self, name: str) -> _InstanceLevelDispatch[_ET]:
        # Assign EmptyListeners as attributes on demand
        # to reduce startup time for new dispatch objects.
        try:
            ls = self._empty_listeners[name]
        except KeyError:
            raise AttributeError(name)
        else:
            setattr(self, ls.name, ls)
            return ls

    @property
    def _event_descriptors(self) -> Iterator[_ClsLevelDispatch[_ET]]:
        for k in self._event_names:
            # Yield _ClsLevelDispatch related
            # to relevant event name.
            yield getattr(self, k)

    def _listen(self, event_key: _EventKey[_ET], **kw: Any) -> None:
        return self._events._listen(event_key, **kw)

    def _for_class(self, instance_cls: Type[_ET]) -> _Dispatch[_ET]:
        return self.__class__(self, instance_cls)

    def _for_instance(self, instance: _ET) -> _Dispatch[_ET]:
        instance_cls = instance.__class__
        return self._for_class(instance_cls)

    def _join(self, other: _DispatchCommon[_ET]) -> _JoinedDispatcher[_ET]:
        """Create a 'join' of this :class:`._Dispatch` and another.

        This new dispatcher will dispatch events to both
        :class:`._Dispatch` objects.

        """
        if "_joined_dispatch_cls" not in self.__class__.__dict__:
            cls = type(
                "Joined%s" % self.__class__.__name__,
                (_JoinedDispatcher,),
                {"__slots__": self._event_names},
            )
            self.__class__._joined_dispatch_cls = cls
        return self._joined_dispatch_cls(self, other)

    def __reduce__(self) -> Union[str, Tuple[Any, ...]]:
        return _UnpickleDispatch(), (self._instance_cls,)

    def _update(
        self, other: _Dispatch[_ET], only_propagate: bool = True
    ) -> None:
        """Populate from the listeners in another :class:`_Dispatch`
        object."""
        for ls in other._event_descriptors:
            if isinstance(ls, _EmptyListener):
                continue
            getattr(self, ls.name).for_modify(self)._update(
                ls, only_propagate=only_propagate
            )

    def _clear(self) -> None:
        for ls in self._event_descriptors:
            ls.for_modify(self).clear()


def _remove_dispatcher(cls: Type[_HasEventsDispatch[_ET]]) -> None:
    for k in cls.dispatch._event_names:
        _registrars[k].remove(cls)
        if not _registrars[k]:
            del _registrars[k]


class _HasEventsDispatch(Generic[_ET]):
    _dispatch_target: Optional[Type[_ET]]
    """class which will receive the .dispatch collection"""

    dispatch: _Dispatch[_ET]
    """reference back to the _Dispatch class.

    Bidirectional against _Dispatch._events

    """

    if typing.TYPE_CHECKING:

        def __getattr__(self, name: str) -> _InstanceLevelDispatch[_ET]:
            ...

    def __init_subclass__(cls) -> None:
        """Intercept new Event subclasses and create associated _Dispatch
        classes."""

        cls._create_dispatcher_class(cls.__name__, cls.__bases__, cls.__dict__)

    @classmethod
    def _accept_with(
        cls, target: Union[_ET, Type[_ET]], identifier: str
    ) -> Optional[Union[_ET, Type[_ET]]]:
        raise NotImplementedError()

    @classmethod
    def _listen(
        cls,
        event_key: _EventKey[_ET],
        *,
        propagate: bool = False,
        insert: bool = False,
        named: bool = False,
        asyncio: bool = False,
    ) -> None:
        raise NotImplementedError()

    @staticmethod
    def _set_dispatch(
        klass: Type[_HasEventsDispatch[_ET]],
        dispatch_cls: Type[_Dispatch[_ET]],
    ) -> _Dispatch[_ET]:
        # This allows an Events subclass to define additional utility
        # methods made available to the target via
        # "self.dispatch._events.<utilitymethod>"
        # @staticmethod to allow easy "super" calls while in a metaclass
        # constructor.
        klass.dispatch = dispatch_cls(None)
        dispatch_cls._events = klass
        return klass.dispatch

    @classmethod
    def _create_dispatcher_class(
        cls, classname: str, bases: Tuple[type, ...], dict_: Mapping[str, Any]
    ) -> None:
        """Create a :class:`._Dispatch` class corresponding to an
        :class:`.Events` class."""

        # there's all kinds of ways to do this,
        # i.e. make a Dispatch class that shares the '_listen' method
        # of the Event class, this is the straight monkeypatch.
        if hasattr(cls, "dispatch"):
            dispatch_base = cls.dispatch.__class__
        else:
            dispatch_base = _Dispatch

        event_names = [k for k in dict_ if _is_event_name(k)]
        dispatch_cls = cast(
            "Type[_Dispatch[_ET]]",
            type(
                "%sDispatch" % classname,
                (dispatch_base,),
                {"__slots__": event_names},
            ),
        )

        dispatch_cls._event_names = event_names
        dispatch_inst = cls._set_dispatch(cls, dispatch_cls)
        for k in dispatch_cls._event_names:
            setattr(dispatch_inst, k, _ClsLevelDispatch(cls, dict_[k]))
            _registrars[k].append(cls)

        for super_ in dispatch_cls.__bases__:
            if issubclass(super_, _Dispatch) and super_ is not _Dispatch:
                for ls in super_._events.dispatch._event_descriptors:
                    setattr(dispatch_inst, ls.name, ls)
                    dispatch_cls._event_names.append(ls.name)

        if getattr(cls, "_dispatch_target", None):
            dispatch_target_cls = cls._dispatch_target
            assert dispatch_target_cls is not None
            if (
                hasattr(dispatch_target_cls, "__slots__")
                and "_slots_dispatch" in dispatch_target_cls.__slots__
            ):
                dispatch_target_cls.dispatch = slots_dispatcher(cls)
            else:
                dispatch_target_cls.dispatch = dispatcher(cls)


class Events(_HasEventsDispatch[_ET]):
    """Define event listening functions for a particular target type."""

    @classmethod
    def _accept_with(
        cls, target: Union[_ET, Type[_ET]], identifier: str
    ) -> Optional[Union[_ET, Type[_ET]]]:
        def dispatch_is(*types: Type[Any]) -> bool:
            return all(isinstance(target.dispatch, t) for t in types)

        def dispatch_parent_is(t: Type[Any]) -> bool:
            return isinstance(
                cast("_JoinedDispatcher[_ET]", target.dispatch).parent, t
            )

        # Mapper, ClassManager, Session override this to
        # also accept classes, scoped_sessions, sessionmakers, etc.
        if hasattr(target, "dispatch"):
            if (
                dispatch_is(cls.dispatch.__class__)
                or dispatch_is(type, cls.dispatch.__class__)
                or (
                    dispatch_is(_JoinedDispatcher)
                    and dispatch_parent_is(cls.dispatch.__class__)
                )
            ):
                return target

        return None

    @classmethod
    def _listen(
        cls,
        event_key: _EventKey[_ET],
        *,
        propagate: bool = False,
        insert: bool = False,
        named: bool = False,
        asyncio: bool = False,
    ) -> None:
        event_key.base_listen(
            propagate=propagate, insert=insert, named=named, asyncio=asyncio
        )

    @classmethod
    def _remove(cls, event_key: _EventKey[_ET]) -> None:
        event_key.remove()

    @classmethod
    def _clear(cls) -> None:
        cls.dispatch._clear()


class _JoinedDispatcher(_DispatchCommon[_ET]):
    """Represent a connection between two _Dispatch objects."""

    __slots__ = "local", "parent", "_instance_cls"

    local: _DispatchCommon[_ET]
    parent: _DispatchCommon[_ET]
    _instance_cls: Optional[Type[_ET]]

    def __init__(
        self, local: _DispatchCommon[_ET], parent: _DispatchCommon[_ET]
    ):
        self.local = local
        self.parent = parent
        self._instance_cls = self.local._instance_cls

    def __getattr__(self, name: str) -> _JoinedListener[_ET]:
        # Assign _JoinedListeners as attributes on demand
        # to reduce startup time for new dispatch objects.
        ls = getattr(self.local, name)
        jl = _JoinedListener(self.parent, ls.name, ls)
        setattr(self, ls.name, jl)
        return jl

    def _listen(self, event_key: _EventKey[_ET], **kw: Any) -> None:
        return self.parent._listen(event_key, **kw)

    @property
    def _events(self) -> Type[_HasEventsDispatch[_ET]]:
        return self.parent._events


class dispatcher(Generic[_ET]):
    """Descriptor used by target classes to
    deliver the _Dispatch class at the class level
    and produce new _Dispatch instances for target
    instances.

    """

    def __init__(self, events: Type[_HasEventsDispatch[_ET]]):
        self.dispatch = events.dispatch
        self.events = events

    @overload
    def __get__(
        self, obj: Literal[None], cls: Type[Any]
    ) -> Type[_Dispatch[_ET]]:
        ...

    @overload
    def __get__(self, obj: Any, cls: Type[Any]) -> _DispatchCommon[_ET]:
        ...

    def __get__(self, obj: Any, cls: Type[Any]) -> Any:
        if obj is None:
            return self.dispatch

        disp = self.dispatch._for_instance(obj)
        try:
            obj.__dict__["dispatch"] = disp
        except AttributeError as ae:
            raise TypeError(
                "target %r doesn't have __dict__, should it be "
                "defining _slots_dispatch?" % (obj,)
            ) from ae
        return disp


class slots_dispatcher(dispatcher[_ET]):
    def __get__(self, obj: Any, cls: Type[Any]) -> Any:
        if obj is None:
            return self.dispatch

        if hasattr(obj, "_slots_dispatch"):
            return obj._slots_dispatch

        disp = self.dispatch._for_instance(obj)
        obj._slots_dispatch = disp
        return disp
