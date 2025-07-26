# orm/collections.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Support for collections of mapped entities.

The collections package supplies the machinery used to inform the ORM of
collection membership changes.  An instrumentation via decoration approach is
used, allowing arbitrary types (including built-ins) to be used as entity
collections without requiring inheritance from a base class.

Instrumentation decoration relays membership change events to the
:class:`.CollectionAttributeImpl` that is currently managing the collection.
The decorators observe function call arguments and return values, tracking
entities entering or leaving the collection.  Two decorator approaches are
provided.  One is a bundle of generic decorators that map function arguments
and return values to events::

  from sqlalchemy.orm.collections import collection
  class MyClass:
      # ...

      @collection.adds(1)
      def store(self, item):
          self.data.append(item)

      @collection.removes_return()
      def pop(self):
          return self.data.pop()


The second approach is a bundle of targeted decorators that wrap appropriate
append and remove notifiers around the mutation methods present in the
standard Python ``list``, ``set`` and ``dict`` interfaces.  These could be
specified in terms of generic decorator recipes, but are instead hand-tooled
for increased efficiency.  The targeted decorators occasionally implement
adapter-like behavior, such as mapping bulk-set methods (``extend``,
``update``, ``__setslice__``, etc.) into the series of atomic mutation events
that the ORM requires.

The targeted decorators are used internally for automatic instrumentation of
entity collection classes.  Every collection class goes through a
transformation process roughly like so:

1. If the class is a built-in, substitute a trivial sub-class
2. Is this class already instrumented?
3. Add in generic decorators
4. Sniff out the collection interface through duck-typing
5. Add targeted decoration to any undecorated interface method

This process modifies the class at runtime, decorating methods and adding some
bookkeeping properties.  This isn't possible (or desirable) for built-in
classes like ``list``, so trivial sub-classes are substituted to hold
decoration::

  class InstrumentedList(list):
      pass

Collection classes can be specified in ``relationship(collection_class=)`` as
types or a function that returns an instance.  Collection classes are
inspected and instrumented during the mapper compilation phase.  The
collection_class callable will be executed once to produce a specimen
instance, and the type of that specimen will be instrumented.  Functions that
return built-in types like ``lists`` will be adapted to produce instrumented
instances.

When extending a known type like ``list``, additional decorations are not
generally not needed.  Odds are, the extension method will delegate to a
method that's already instrumented.  For example::

  class QueueIsh(list):
     def push(self, item):
         self.append(item)
     def shift(self):
         return self.pop(0)

There's no need to decorate these methods.  ``append`` and ``pop`` are already
instrumented as part of the ``list`` interface.  Decorating them would fire
duplicate events, which should be avoided.

The targeted decoration tries not to rely on other methods in the underlying
collection class, but some are unavoidable.  Many depend on 'read' methods
being present to properly instrument a 'write', for example, ``__setitem__``
needs ``__getitem__``.  "Bulk" methods like ``update`` and ``extend`` may also
reimplemented in terms of atomic appends and removes, so the ``extend``
decoration will actually perform many ``append`` operations and not call the
underlying method at all.

Tight control over bulk operation and the firing of events is also possible by
implementing the instrumentation internally in your methods.  The basic
instrumentation package works under the general assumption that collection
mutation will not raise unusual exceptions.  If you want to closely
orchestrate append and remove events with exception management, internal
instrumentation may be the answer.  Within your method,
``collection_adapter(self)`` will retrieve an object that you can use for
explicit control over triggering append and remove events.

The owning object and :class:`.CollectionAttributeImpl` are also reachable
through the adapter, allowing for some very sophisticated behavior.

"""
from __future__ import annotations

import operator
import threading
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Collection
from typing import Dict
from typing import Iterable
from typing import List
from typing import NoReturn
from typing import Optional
from typing import Set
from typing import Tuple
from typing import Type
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union
import weakref

from .base import NO_KEY
from .. import exc as sa_exc
from .. import util
from ..sql.base import NO_ARG
from ..util.compat import inspect_getfullargspec
from ..util.typing import Protocol

if typing.TYPE_CHECKING:
    from .attributes import AttributeEventToken
    from .attributes import CollectionAttributeImpl
    from .mapped_collection import attribute_keyed_dict
    from .mapped_collection import column_keyed_dict
    from .mapped_collection import keyfunc_mapping
    from .mapped_collection import KeyFuncDict  # noqa: F401
    from .state import InstanceState


__all__ = [
    "collection",
    "collection_adapter",
    "keyfunc_mapping",
    "column_keyed_dict",
    "attribute_keyed_dict",
    "column_keyed_dict",
    "attribute_keyed_dict",
    "MappedCollection",
    "KeyFuncDict",
]

__instrumentation_mutex = threading.Lock()


_CollectionFactoryType = Callable[[], "_AdaptedCollectionProtocol"]

_T = TypeVar("_T", bound=Any)
_KT = TypeVar("_KT", bound=Any)
_VT = TypeVar("_VT", bound=Any)
_COL = TypeVar("_COL", bound="Collection[Any]")
_FN = TypeVar("_FN", bound="Callable[..., Any]")


class _CollectionConverterProtocol(Protocol):
    def __call__(self, collection: _COL) -> _COL:
        ...


class _AdaptedCollectionProtocol(Protocol):
    _sa_adapter: CollectionAdapter
    _sa_appender: Callable[..., Any]
    _sa_remover: Callable[..., Any]
    _sa_iterator: Callable[..., Iterable[Any]]
    _sa_converter: _CollectionConverterProtocol


class collection:
    """Decorators for entity collection classes.

    The decorators fall into two groups: annotations and interception recipes.

    The annotating decorators (appender, remover, iterator, converter,
    internally_instrumented) indicate the method's purpose and take no
    arguments.  They are not written with parens::

        @collection.appender
        def append(self, append): ...

    The recipe decorators all require parens, even those that take no
    arguments::

        @collection.adds('entity')
        def insert(self, position, entity): ...

        @collection.removes_return()
        def popitem(self): ...

    """

    # Bundled as a class solely for ease of use: packaging, doc strings,
    # importability.

    @staticmethod
    def appender(fn):
        """Tag the method as the collection appender.

        The appender method is called with one positional argument: the value
        to append. The method will be automatically decorated with 'adds(1)'
        if not already decorated::

            @collection.appender
            def add(self, append): ...

            # or, equivalently
            @collection.appender
            @collection.adds(1)
            def add(self, append): ...

            # for mapping type, an 'append' may kick out a previous value
            # that occupies that slot.  consider d['a'] = 'foo'- any previous
            # value in d['a'] is discarded.
            @collection.appender
            @collection.replaces(1)
            def add(self, entity):
                key = some_key_func(entity)
                previous = None
                if key in self:
                    previous = self[key]
                self[key] = entity
                return previous

        If the value to append is not allowed in the collection, you may
        raise an exception.  Something to remember is that the appender
        will be called for each object mapped by a database query.  If the
        database contains rows that violate your collection semantics, you
        will need to get creative to fix the problem, as access via the
        collection will not work.

        If the appender method is internally instrumented, you must also
        receive the keyword argument '_sa_initiator' and ensure its
        promulgation to collection events.

        """
        fn._sa_instrument_role = "appender"
        return fn

    @staticmethod
    def remover(fn):
        """Tag the method as the collection remover.

        The remover method is called with one positional argument: the value
        to remove. The method will be automatically decorated with
        :meth:`removes_return` if not already decorated::

            @collection.remover
            def zap(self, entity): ...

            # or, equivalently
            @collection.remover
            @collection.removes_return()
            def zap(self, ): ...

        If the value to remove is not present in the collection, you may
        raise an exception or return None to ignore the error.

        If the remove method is internally instrumented, you must also
        receive the keyword argument '_sa_initiator' and ensure its
        promulgation to collection events.

        """
        fn._sa_instrument_role = "remover"
        return fn

    @staticmethod
    def iterator(fn):
        """Tag the method as the collection remover.

        The iterator method is called with no arguments.  It is expected to
        return an iterator over all collection members::

            @collection.iterator
            def __iter__(self): ...

        """
        fn._sa_instrument_role = "iterator"
        return fn

    @staticmethod
    def internally_instrumented(fn):
        """Tag the method as instrumented.

        This tag will prevent any decoration from being applied to the
        method. Use this if you are orchestrating your own calls to
        :func:`.collection_adapter` in one of the basic SQLAlchemy
        interface methods, or to prevent an automatic ABC method
        decoration from wrapping your implementation::

            # normally an 'extend' method on a list-like class would be
            # automatically intercepted and re-implemented in terms of
            # SQLAlchemy events and append().  your implementation will
            # never be called, unless:
            @collection.internally_instrumented
            def extend(self, items): ...

        """
        fn._sa_instrumented = True
        return fn

    @staticmethod
    @util.deprecated(
        "1.3",
        "The :meth:`.collection.converter` handler is deprecated and will "
        "be removed in a future release.  Please refer to the "
        ":class:`.AttributeEvents.bulk_replace` listener interface in "
        "conjunction with the :func:`.event.listen` function.",
    )
    def converter(fn):
        """Tag the method as the collection converter.

        This optional method will be called when a collection is being
        replaced entirely, as in::

            myobj.acollection = [newvalue1, newvalue2]

        The converter method will receive the object being assigned and should
        return an iterable of values suitable for use by the ``appender``
        method.  A converter must not assign values or mutate the collection,
        its sole job is to adapt the value the user provides into an iterable
        of values for the ORM's use.

        The default converter implementation will use duck-typing to do the
        conversion.  A dict-like collection will be convert into an iterable
        of dictionary values, and other types will simply be iterated::

            @collection.converter
            def convert(self, other): ...

        If the duck-typing of the object does not match the type of this
        collection, a TypeError is raised.

        Supply an implementation of this method if you want to expand the
        range of possible types that can be assigned in bulk or perform
        validation on the values about to be assigned.

        """
        fn._sa_instrument_role = "converter"
        return fn

    @staticmethod
    def adds(arg):
        """Mark the method as adding an entity to the collection.

        Adds "add to collection" handling to the method.  The decorator
        argument indicates which method argument holds the SQLAlchemy-relevant
        value.  Arguments can be specified positionally (i.e. integer) or by
        name::

            @collection.adds(1)
            def push(self, item): ...

            @collection.adds('entity')
            def do_stuff(self, thing, entity=None): ...

        """

        def decorator(fn):
            fn._sa_instrument_before = ("fire_append_event", arg)
            return fn

        return decorator

    @staticmethod
    def replaces(arg):
        """Mark the method as replacing an entity in the collection.

        Adds "add to collection" and "remove from collection" handling to
        the method.  The decorator argument indicates which method argument
        holds the SQLAlchemy-relevant value to be added, and return value, if
        any will be considered the value to remove.

        Arguments can be specified positionally (i.e. integer) or by name::

            @collection.replaces(2)
            def __setitem__(self, index, item): ...

        """

        def decorator(fn):
            fn._sa_instrument_before = ("fire_append_event", arg)
            fn._sa_instrument_after = "fire_remove_event"
            return fn

        return decorator

    @staticmethod
    def removes(arg):
        """Mark the method as removing an entity in the collection.

        Adds "remove from collection" handling to the method.  The decorator
        argument indicates which method argument holds the SQLAlchemy-relevant
        value to be removed. Arguments can be specified positionally (i.e.
        integer) or by name::

            @collection.removes(1)
            def zap(self, item): ...

        For methods where the value to remove is not known at call-time, use
        collection.removes_return.

        """

        def decorator(fn):
            fn._sa_instrument_before = ("fire_remove_event", arg)
            return fn

        return decorator

    @staticmethod
    def removes_return():
        """Mark the method as removing an entity in the collection.

        Adds "remove from collection" handling to the method.  The return
        value of the method, if any, is considered the value to remove.  The
        method arguments are not inspected::

            @collection.removes_return()
            def pop(self): ...

        For methods where the value to remove is known at call-time, use
        collection.remove.

        """

        def decorator(fn):
            fn._sa_instrument_after = "fire_remove_event"
            return fn

        return decorator


if TYPE_CHECKING:

    def collection_adapter(collection: Collection[Any]) -> CollectionAdapter:
        """Fetch the :class:`.CollectionAdapter` for a collection."""

else:
    collection_adapter = operator.attrgetter("_sa_adapter")


class CollectionAdapter:
    """Bridges between the ORM and arbitrary Python collections.

    Proxies base-level collection operations (append, remove, iterate)
    to the underlying Python collection, and emits add/remove events for
    entities entering or leaving the collection.

    The ORM uses :class:`.CollectionAdapter` exclusively for interaction with
    entity collections.


    """

    __slots__ = (
        "attr",
        "_key",
        "_data",
        "owner_state",
        "_converter",
        "invalidated",
        "empty",
    )

    attr: CollectionAttributeImpl
    _key: str

    # this is actually a weakref; see note in constructor
    _data: Callable[..., _AdaptedCollectionProtocol]

    owner_state: InstanceState[Any]
    _converter: _CollectionConverterProtocol
    invalidated: bool
    empty: bool

    def __init__(
        self,
        attr: CollectionAttributeImpl,
        owner_state: InstanceState[Any],
        data: _AdaptedCollectionProtocol,
    ):
        self.attr = attr
        self._key = attr.key

        # this weakref stays referenced throughout the lifespan of
        # CollectionAdapter.  so while the weakref can return None, this
        # is realistically only during garbage collection of this object, so
        # we type this as a callable that returns _AdaptedCollectionProtocol
        # in all cases.
        self._data = weakref.ref(data)  # type: ignore

        self.owner_state = owner_state
        data._sa_adapter = self
        self._converter = data._sa_converter
        self.invalidated = False
        self.empty = False

    def _warn_invalidated(self) -> None:
        util.warn("This collection has been invalidated.")

    @property
    def data(self) -> _AdaptedCollectionProtocol:
        "The entity collection being adapted."
        return self._data()

    @property
    def _referenced_by_owner(self) -> bool:
        """return True if the owner state still refers to this collection.

        This will return False within a bulk replace operation,
        where this collection is the one being replaced.

        """
        return self.owner_state.dict[self._key] is self._data()

    def bulk_appender(self):
        return self._data()._sa_appender

    def append_with_event(
        self, item: Any, initiator: Optional[AttributeEventToken] = None
    ) -> None:
        """Add an entity to the collection, firing mutation events."""

        self._data()._sa_appender(item, _sa_initiator=initiator)

    def _set_empty(self, user_data):
        assert (
            not self.empty
        ), "This collection adapter is already in the 'empty' state"
        self.empty = True
        self.owner_state._empty_collections[self._key] = user_data

    def _reset_empty(self) -> None:
        assert (
            self.empty
        ), "This collection adapter is not in the 'empty' state"
        self.empty = False
        self.owner_state.dict[
            self._key
        ] = self.owner_state._empty_collections.pop(self._key)

    def _refuse_empty(self) -> NoReturn:
        raise sa_exc.InvalidRequestError(
            "This is a special 'empty' collection which cannot accommodate "
            "internal mutation operations"
        )

    def append_without_event(self, item: Any) -> None:
        """Add or restore an entity to the collection, firing no events."""

        if self.empty:
            self._refuse_empty()
        self._data()._sa_appender(item, _sa_initiator=False)

    def append_multiple_without_event(self, items: Iterable[Any]) -> None:
        """Add or restore an entity to the collection, firing no events."""
        if self.empty:
            self._refuse_empty()
        appender = self._data()._sa_appender
        for item in items:
            appender(item, _sa_initiator=False)

    def bulk_remover(self):
        return self._data()._sa_remover

    def remove_with_event(
        self, item: Any, initiator: Optional[AttributeEventToken] = None
    ) -> None:
        """Remove an entity from the collection, firing mutation events."""
        self._data()._sa_remover(item, _sa_initiator=initiator)

    def remove_without_event(self, item: Any) -> None:
        """Remove an entity from the collection, firing no events."""
        if self.empty:
            self._refuse_empty()
        self._data()._sa_remover(item, _sa_initiator=False)

    def clear_with_event(
        self, initiator: Optional[AttributeEventToken] = None
    ) -> None:
        """Empty the collection, firing a mutation event for each entity."""

        if self.empty:
            self._refuse_empty()
        remover = self._data()._sa_remover
        for item in list(self):
            remover(item, _sa_initiator=initiator)

    def clear_without_event(self) -> None:
        """Empty the collection, firing no events."""

        if self.empty:
            self._refuse_empty()
        remover = self._data()._sa_remover
        for item in list(self):
            remover(item, _sa_initiator=False)

    def __iter__(self):
        """Iterate over entities in the collection."""

        return iter(self._data()._sa_iterator())

    def __len__(self):
        """Count entities in the collection."""
        return len(list(self._data()._sa_iterator()))

    def __bool__(self):
        return True

    def _fire_append_wo_mutation_event_bulk(
        self, items, initiator=None, key=NO_KEY
    ):
        if not items:
            return

        if initiator is not False:
            if self.invalidated:
                self._warn_invalidated()

            if self.empty:
                self._reset_empty()

            for item in items:
                self.attr.fire_append_wo_mutation_event(
                    self.owner_state,
                    self.owner_state.dict,
                    item,
                    initiator,
                    key,
                )

    def fire_append_wo_mutation_event(self, item, initiator=None, key=NO_KEY):
        """Notify that a entity is entering the collection but is already
        present.


        Initiator is a token owned by the InstrumentedAttribute that
        initiated the membership mutation, and should be left as None
        unless you are passing along an initiator value from a chained
        operation.

        .. versionadded:: 1.4.15

        """
        if initiator is not False:
            if self.invalidated:
                self._warn_invalidated()

            if self.empty:
                self._reset_empty()

            return self.attr.fire_append_wo_mutation_event(
                self.owner_state, self.owner_state.dict, item, initiator, key
            )
        else:
            return item

    def fire_append_event(self, item, initiator=None, key=NO_KEY):
        """Notify that a entity has entered the collection.

        Initiator is a token owned by the InstrumentedAttribute that
        initiated the membership mutation, and should be left as None
        unless you are passing along an initiator value from a chained
        operation.

        """
        if initiator is not False:
            if self.invalidated:
                self._warn_invalidated()

            if self.empty:
                self._reset_empty()

            return self.attr.fire_append_event(
                self.owner_state, self.owner_state.dict, item, initiator, key
            )
        else:
            return item

    def _fire_remove_event_bulk(self, items, initiator=None, key=NO_KEY):
        if not items:
            return

        if initiator is not False:
            if self.invalidated:
                self._warn_invalidated()

            if self.empty:
                self._reset_empty()

            for item in items:
                self.attr.fire_remove_event(
                    self.owner_state,
                    self.owner_state.dict,
                    item,
                    initiator,
                    key,
                )

    def fire_remove_event(self, item, initiator=None, key=NO_KEY):
        """Notify that a entity has been removed from the collection.

        Initiator is the InstrumentedAttribute that initiated the membership
        mutation, and should be left as None unless you are passing along
        an initiator value from a chained operation.

        """
        if initiator is not False:
            if self.invalidated:
                self._warn_invalidated()

            if self.empty:
                self._reset_empty()

            self.attr.fire_remove_event(
                self.owner_state, self.owner_state.dict, item, initiator, key
            )

    def fire_pre_remove_event(self, initiator=None, key=NO_KEY):
        """Notify that an entity is about to be removed from the collection.

        Only called if the entity cannot be removed after calling
        fire_remove_event().

        """
        if self.invalidated:
            self._warn_invalidated()
        self.attr.fire_pre_remove_event(
            self.owner_state,
            self.owner_state.dict,
            initiator=initiator,
            key=key,
        )

    def __getstate__(self):
        return {
            "key": self._key,
            "owner_state": self.owner_state,
            "owner_cls": self.owner_state.class_,
            "data": self.data,
            "invalidated": self.invalidated,
            "empty": self.empty,
        }

    def __setstate__(self, d):
        self._key = d["key"]
        self.owner_state = d["owner_state"]

        # see note in constructor regarding this type: ignore
        self._data = weakref.ref(d["data"])  # type: ignore

        self._converter = d["data"]._sa_converter
        d["data"]._sa_adapter = self
        self.invalidated = d["invalidated"]
        self.attr = getattr(d["owner_cls"], self._key).impl
        self.empty = d.get("empty", False)


def bulk_replace(values, existing_adapter, new_adapter, initiator=None):
    """Load a new collection, firing events based on prior like membership.

    Appends instances in ``values`` onto the ``new_adapter``. Events will be
    fired for any instance not present in the ``existing_adapter``.  Any
    instances in ``existing_adapter`` not present in ``values`` will have
    remove events fired upon them.

    :param values: An iterable of collection member instances

    :param existing_adapter: A :class:`.CollectionAdapter` of
     instances to be replaced

    :param new_adapter: An empty :class:`.CollectionAdapter`
     to load with ``values``


    """

    assert isinstance(values, list)

    idset = util.IdentitySet
    existing_idset = idset(existing_adapter or ())
    constants = existing_idset.intersection(values or ())
    additions = idset(values or ()).difference(constants)
    removals = existing_idset.difference(constants)

    appender = new_adapter.bulk_appender()

    for member in values or ():
        if member in additions:
            appender(member, _sa_initiator=initiator)
        elif member in constants:
            appender(member, _sa_initiator=False)

    if existing_adapter:
        existing_adapter._fire_append_wo_mutation_event_bulk(
            constants, initiator=initiator
        )
        existing_adapter._fire_remove_event_bulk(removals, initiator=initiator)


def prepare_instrumentation(
    factory: Union[Type[Collection[Any]], _CollectionFactoryType],
) -> _CollectionFactoryType:
    """Prepare a callable for future use as a collection class factory.

    Given a collection class factory (either a type or no-arg callable),
    return another factory that will produce compatible instances when
    called.

    This function is responsible for converting collection_class=list
    into the run-time behavior of collection_class=InstrumentedList.

    """

    impl_factory: _CollectionFactoryType

    # Convert a builtin to 'Instrumented*'
    if factory in __canned_instrumentation:
        impl_factory = __canned_instrumentation[factory]
    else:
        impl_factory = cast(_CollectionFactoryType, factory)

    cls: Union[_CollectionFactoryType, Type[Collection[Any]]]

    # Create a specimen
    cls = type(impl_factory())

    # Did factory callable return a builtin?
    if cls in __canned_instrumentation:
        # if so, just convert.
        # in previous major releases, this codepath wasn't working and was
        # not covered by tests.   prior to that it supplied a "wrapper"
        # function that would return the class, though the rationale for this
        # case is not known
        impl_factory = __canned_instrumentation[cls]
        cls = type(impl_factory())

    # Instrument the class if needed.
    if __instrumentation_mutex.acquire():
        try:
            if getattr(cls, "_sa_instrumented", None) != id(cls):
                _instrument_class(cls)
        finally:
            __instrumentation_mutex.release()

    return impl_factory


def _instrument_class(cls):
    """Modify methods in a class and install instrumentation."""

    # In the normal call flow, a request for any of the 3 basic collection
    # types is transformed into one of our trivial subclasses
    # (e.g. InstrumentedList).  Catch anything else that sneaks in here...
    if cls.__module__ == "__builtin__":
        raise sa_exc.ArgumentError(
            "Can not instrument a built-in type. Use a "
            "subclass, even a trivial one."
        )

    roles, methods = _locate_roles_and_methods(cls)

    _setup_canned_roles(cls, roles, methods)

    _assert_required_roles(cls, roles, methods)

    _set_collection_attributes(cls, roles, methods)


def _locate_roles_and_methods(cls):
    """search for _sa_instrument_role-decorated methods in
    method resolution order, assign to roles.

    """

    roles: Dict[str, str] = {}
    methods: Dict[str, Tuple[Optional[str], Optional[int], Optional[str]]] = {}

    for supercls in cls.__mro__:
        for name, method in vars(supercls).items():
            if not callable(method):
                continue

            # note role declarations
            if hasattr(method, "_sa_instrument_role"):
                role = method._sa_instrument_role
                assert role in (
                    "appender",
                    "remover",
                    "iterator",
                    "converter",
                )
                roles.setdefault(role, name)

            # transfer instrumentation requests from decorated function
            # to the combined queue
            before: Optional[Tuple[str, int]] = None
            after: Optional[str] = None

            if hasattr(method, "_sa_instrument_before"):
                op, argument = method._sa_instrument_before
                assert op in ("fire_append_event", "fire_remove_event")
                before = op, argument
            if hasattr(method, "_sa_instrument_after"):
                op = method._sa_instrument_after
                assert op in ("fire_append_event", "fire_remove_event")
                after = op
            if before:
                methods[name] = before + (after,)
            elif after:
                methods[name] = None, None, after
    return roles, methods


def _setup_canned_roles(cls, roles, methods):
    """see if this class has "canned" roles based on a known
    collection type (dict, set, list).  Apply those roles
    as needed to the "roles" dictionary, and also
    prepare "decorator" methods

    """
    collection_type = util.duck_type_collection(cls)
    if collection_type in __interfaces:
        assert collection_type is not None
        canned_roles, decorators = __interfaces[collection_type]
        for role, name in canned_roles.items():
            roles.setdefault(role, name)

        # apply ABC auto-decoration to methods that need it
        for method, decorator in decorators.items():
            fn = getattr(cls, method, None)
            if (
                fn
                and method not in methods
                and not hasattr(fn, "_sa_instrumented")
            ):
                setattr(cls, method, decorator(fn))


def _assert_required_roles(cls, roles, methods):
    """ensure all roles are present, and apply implicit instrumentation if
    needed

    """
    if "appender" not in roles or not hasattr(cls, roles["appender"]):
        raise sa_exc.ArgumentError(
            "Type %s must elect an appender method to be "
            "a collection class" % cls.__name__
        )
    elif roles["appender"] not in methods and not hasattr(
        getattr(cls, roles["appender"]), "_sa_instrumented"
    ):
        methods[roles["appender"]] = ("fire_append_event", 1, None)

    if "remover" not in roles or not hasattr(cls, roles["remover"]):
        raise sa_exc.ArgumentError(
            "Type %s must elect a remover method to be "
            "a collection class" % cls.__name__
        )
    elif roles["remover"] not in methods and not hasattr(
        getattr(cls, roles["remover"]), "_sa_instrumented"
    ):
        methods[roles["remover"]] = ("fire_remove_event", 1, None)

    if "iterator" not in roles or not hasattr(cls, roles["iterator"]):
        raise sa_exc.ArgumentError(
            "Type %s must elect an iterator method to be "
            "a collection class" % cls.__name__
        )


def _set_collection_attributes(cls, roles, methods):
    """apply ad-hoc instrumentation from decorators, class-level defaults
    and implicit role declarations

    """
    for method_name, (before, argument, after) in methods.items():
        setattr(
            cls,
            method_name,
            _instrument_membership_mutator(
                getattr(cls, method_name), before, argument, after
            ),
        )
    # intern the role map
    for role, method_name in roles.items():
        setattr(cls, "_sa_%s" % role, getattr(cls, method_name))

    cls._sa_adapter = None

    if not hasattr(cls, "_sa_converter"):
        cls._sa_converter = None
    cls._sa_instrumented = id(cls)


def _instrument_membership_mutator(method, before, argument, after):
    """Route method args and/or return value through the collection
    adapter."""
    # This isn't smart enough to handle @adds(1) for 'def fn(self, (a, b))'
    if before:
        fn_args = list(
            util.flatten_iterator(inspect_getfullargspec(method)[0])
        )
        if isinstance(argument, int):
            pos_arg = argument
            named_arg = len(fn_args) > argument and fn_args[argument] or None
        else:
            if argument in fn_args:
                pos_arg = fn_args.index(argument)
            else:
                pos_arg = None
            named_arg = argument
        del fn_args

    def wrapper(*args, **kw):
        if before:
            if pos_arg is None:
                if named_arg not in kw:
                    raise sa_exc.ArgumentError(
                        "Missing argument %s" % argument
                    )
                value = kw[named_arg]
            else:
                if len(args) > pos_arg:
                    value = args[pos_arg]
                elif named_arg in kw:
                    value = kw[named_arg]
                else:
                    raise sa_exc.ArgumentError(
                        "Missing argument %s" % argument
                    )

        initiator = kw.pop("_sa_initiator", None)
        if initiator is False:
            executor = None
        else:
            executor = args[0]._sa_adapter

        if before and executor:
            getattr(executor, before)(value, initiator)

        if not after or not executor:
            return method(*args, **kw)
        else:
            res = method(*args, **kw)
            if res is not None:
                getattr(executor, after)(res, initiator)
            return res

    wrapper._sa_instrumented = True  # type: ignore[attr-defined]
    if hasattr(method, "_sa_instrument_role"):
        wrapper._sa_instrument_role = method._sa_instrument_role  # type: ignore[attr-defined]  # noqa: E501
    wrapper.__name__ = method.__name__
    wrapper.__doc__ = method.__doc__
    return wrapper


def __set_wo_mutation(collection, item, _sa_initiator=None):
    """Run set wo mutation events.

    The collection is not mutated.

    """
    if _sa_initiator is not False:
        executor = collection._sa_adapter
        if executor:
            executor.fire_append_wo_mutation_event(
                item, _sa_initiator, key=None
            )


def __set(collection, item, _sa_initiator, key):
    """Run set events.

    This event always occurs before the collection is actually mutated.

    """

    if _sa_initiator is not False:
        executor = collection._sa_adapter
        if executor:
            item = executor.fire_append_event(item, _sa_initiator, key=key)
    return item


def __del(collection, item, _sa_initiator, key):
    """Run del events.

    This event occurs before the collection is actually mutated, *except*
    in the case of a pop operation, in which case it occurs afterwards.
    For pop operations, the __before_pop hook is called before the
    operation occurs.

    """
    if _sa_initiator is not False:
        executor = collection._sa_adapter
        if executor:
            executor.fire_remove_event(item, _sa_initiator, key=key)


def __before_pop(collection, _sa_initiator=None):
    """An event which occurs on a before a pop() operation occurs."""
    executor = collection._sa_adapter
    if executor:
        executor.fire_pre_remove_event(_sa_initiator)


def _list_decorators() -> Dict[str, Callable[[_FN], _FN]]:
    """Tailored instrumentation wrappers for any list-like class."""

    def _tidy(fn):
        fn._sa_instrumented = True
        fn.__doc__ = getattr(list, fn.__name__).__doc__

    def append(fn):
        def append(self, item, _sa_initiator=None):
            item = __set(self, item, _sa_initiator, NO_KEY)
            fn(self, item)

        _tidy(append)
        return append

    def remove(fn):
        def remove(self, value, _sa_initiator=None):
            __del(self, value, _sa_initiator, NO_KEY)
            # testlib.pragma exempt:__eq__
            fn(self, value)

        _tidy(remove)
        return remove

    def insert(fn):
        def insert(self, index, value):
            value = __set(self, value, None, index)
            fn(self, index, value)

        _tidy(insert)
        return insert

    def __setitem__(fn):
        def __setitem__(self, index, value):
            if not isinstance(index, slice):
                existing = self[index]
                if existing is not None:
                    __del(self, existing, None, index)
                value = __set(self, value, None, index)
                fn(self, index, value)
            else:
                # slice assignment requires __delitem__, insert, __len__
                step = index.step or 1
                start = index.start or 0
                if start < 0:
                    start += len(self)
                if index.stop is not None:
                    stop = index.stop
                else:
                    stop = len(self)
                if stop < 0:
                    stop += len(self)

                if step == 1:
                    if value is self:
                        return
                    for i in range(start, stop, step):
                        if len(self) > start:
                            del self[start]

                    for i, item in enumerate(value):
                        self.insert(i + start, item)
                else:
                    rng = list(range(start, stop, step))
                    if len(value) != len(rng):
                        raise ValueError(
                            "attempt to assign sequence of size %s to "
                            "extended slice of size %s"
                            % (len(value), len(rng))
                        )
                    for i, item in zip(rng, value):
                        self.__setitem__(i, item)

        _tidy(__setitem__)
        return __setitem__

    def __delitem__(fn):
        def __delitem__(self, index):
            if not isinstance(index, slice):
                item = self[index]
                __del(self, item, None, index)
                fn(self, index)
            else:
                # slice deletion requires __getslice__ and a slice-groking
                # __getitem__ for stepped deletion
                # note: not breaking this into atomic dels
                for item in self[index]:
                    __del(self, item, None, index)
                fn(self, index)

        _tidy(__delitem__)
        return __delitem__

    def extend(fn):
        def extend(self, iterable):
            for value in list(iterable):
                self.append(value)

        _tidy(extend)
        return extend

    def __iadd__(fn):
        def __iadd__(self, iterable):
            # list.__iadd__ takes any iterable and seems to let TypeError
            # raise as-is instead of returning NotImplemented
            for value in list(iterable):
                self.append(value)
            return self

        _tidy(__iadd__)
        return __iadd__

    def pop(fn):
        def pop(self, index=-1):
            __before_pop(self)
            item = fn(self, index)
            __del(self, item, None, index)
            return item

        _tidy(pop)
        return pop

    def clear(fn):
        def clear(self, index=-1):
            for item in self:
                __del(self, item, None, index)
            fn(self)

        _tidy(clear)
        return clear

    # __imul__ : not wrapping this.  all members of the collection are already
    # present, so no need to fire appends... wrapping it with an explicit
    # decorator is still possible, so events on *= can be had if they're
    # desired.  hard to imagine a use case for __imul__, though.

    l = locals().copy()
    l.pop("_tidy")
    return l


def _dict_decorators() -> Dict[str, Callable[[_FN], _FN]]:
    """Tailored instrumentation wrappers for any dict-like mapping class."""

    def _tidy(fn):
        fn._sa_instrumented = True
        fn.__doc__ = getattr(dict, fn.__name__).__doc__

    def __setitem__(fn):
        def __setitem__(self, key, value, _sa_initiator=None):
            if key in self:
                __del(self, self[key], _sa_initiator, key)
            value = __set(self, value, _sa_initiator, key)
            fn(self, key, value)

        _tidy(__setitem__)
        return __setitem__

    def __delitem__(fn):
        def __delitem__(self, key, _sa_initiator=None):
            if key in self:
                __del(self, self[key], _sa_initiator, key)
            fn(self, key)

        _tidy(__delitem__)
        return __delitem__

    def clear(fn):
        def clear(self):
            for key in self:
                __del(self, self[key], None, key)
            fn(self)

        _tidy(clear)
        return clear

    def pop(fn):
        def pop(self, key, default=NO_ARG):
            __before_pop(self)
            _to_del = key in self
            if default is NO_ARG:
                item = fn(self, key)
            else:
                item = fn(self, key, default)
            if _to_del:
                __del(self, item, None, key)
            return item

        _tidy(pop)
        return pop

    def popitem(fn):
        def popitem(self):
            __before_pop(self)
            item = fn(self)
            __del(self, item[1], None, 1)
            return item

        _tidy(popitem)
        return popitem

    def setdefault(fn):
        def setdefault(self, key, default=None):
            if key not in self:
                self.__setitem__(key, default)
                return default
            else:
                value = self.__getitem__(key)
                if value is default:
                    __set_wo_mutation(self, value, None)

                return value

        _tidy(setdefault)
        return setdefault

    def update(fn):
        def update(self, __other=NO_ARG, **kw):
            if __other is not NO_ARG:
                if hasattr(__other, "keys"):
                    for key in list(__other):
                        if key not in self or self[key] is not __other[key]:
                            self[key] = __other[key]
                        else:
                            __set_wo_mutation(self, __other[key], None)
                else:
                    for key, value in __other:
                        if key not in self or self[key] is not value:
                            self[key] = value
                        else:
                            __set_wo_mutation(self, value, None)
            for key in kw:
                if key not in self or self[key] is not kw[key]:
                    self[key] = kw[key]
                else:
                    __set_wo_mutation(self, kw[key], None)

        _tidy(update)
        return update

    l = locals().copy()
    l.pop("_tidy")
    return l


_set_binop_bases = (set, frozenset)


def _set_binops_check_strict(self: Any, obj: Any) -> bool:
    """Allow only set, frozenset and self.__class__-derived
    objects in binops."""
    return isinstance(obj, _set_binop_bases + (self.__class__,))


def _set_binops_check_loose(self: Any, obj: Any) -> bool:
    """Allow anything set-like to participate in set binops."""
    return (
        isinstance(obj, _set_binop_bases + (self.__class__,))
        or util.duck_type_collection(obj) == set
    )


def _set_decorators() -> Dict[str, Callable[[_FN], _FN]]:
    """Tailored instrumentation wrappers for any set-like class."""

    def _tidy(fn):
        fn._sa_instrumented = True
        fn.__doc__ = getattr(set, fn.__name__).__doc__

    def add(fn):
        def add(self, value, _sa_initiator=None):
            if value not in self:
                value = __set(self, value, _sa_initiator, NO_KEY)
            else:
                __set_wo_mutation(self, value, _sa_initiator)
            # testlib.pragma exempt:__hash__
            fn(self, value)

        _tidy(add)
        return add

    def discard(fn):
        def discard(self, value, _sa_initiator=None):
            # testlib.pragma exempt:__hash__
            if value in self:
                __del(self, value, _sa_initiator, NO_KEY)
                # testlib.pragma exempt:__hash__
            fn(self, value)

        _tidy(discard)
        return discard

    def remove(fn):
        def remove(self, value, _sa_initiator=None):
            # testlib.pragma exempt:__hash__
            if value in self:
                __del(self, value, _sa_initiator, NO_KEY)
            # testlib.pragma exempt:__hash__
            fn(self, value)

        _tidy(remove)
        return remove

    def pop(fn):
        def pop(self):
            __before_pop(self)
            item = fn(self)
            # for set in particular, we have no way to access the item
            # that will be popped before pop is called.
            __del(self, item, None, NO_KEY)
            return item

        _tidy(pop)
        return pop

    def clear(fn):
        def clear(self):
            for item in list(self):
                self.remove(item)

        _tidy(clear)
        return clear

    def update(fn):
        def update(self, value):
            for item in value:
                self.add(item)

        _tidy(update)
        return update

    def __ior__(fn):
        def __ior__(self, value):
            if not _set_binops_check_strict(self, value):
                return NotImplemented
            for item in value:
                self.add(item)
            return self

        _tidy(__ior__)
        return __ior__

    def difference_update(fn):
        def difference_update(self, value):
            for item in value:
                self.discard(item)

        _tidy(difference_update)
        return difference_update

    def __isub__(fn):
        def __isub__(self, value):
            if not _set_binops_check_strict(self, value):
                return NotImplemented
            for item in value:
                self.discard(item)
            return self

        _tidy(__isub__)
        return __isub__

    def intersection_update(fn):
        def intersection_update(self, other):
            want, have = self.intersection(other), set(self)
            remove, add = have - want, want - have

            for item in remove:
                self.remove(item)
            for item in add:
                self.add(item)

        _tidy(intersection_update)
        return intersection_update

    def __iand__(fn):
        def __iand__(self, other):
            if not _set_binops_check_strict(self, other):
                return NotImplemented
            want, have = self.intersection(other), set(self)
            remove, add = have - want, want - have

            for item in remove:
                self.remove(item)
            for item in add:
                self.add(item)
            return self

        _tidy(__iand__)
        return __iand__

    def symmetric_difference_update(fn):
        def symmetric_difference_update(self, other):
            want, have = self.symmetric_difference(other), set(self)
            remove, add = have - want, want - have

            for item in remove:
                self.remove(item)
            for item in add:
                self.add(item)

        _tidy(symmetric_difference_update)
        return symmetric_difference_update

    def __ixor__(fn):
        def __ixor__(self, other):
            if not _set_binops_check_strict(self, other):
                return NotImplemented
            want, have = self.symmetric_difference(other), set(self)
            remove, add = have - want, want - have

            for item in remove:
                self.remove(item)
            for item in add:
                self.add(item)
            return self

        _tidy(__ixor__)
        return __ixor__

    l = locals().copy()
    l.pop("_tidy")
    return l


class InstrumentedList(List[_T]):
    """An instrumented version of the built-in list."""


class InstrumentedSet(Set[_T]):
    """An instrumented version of the built-in set."""


class InstrumentedDict(Dict[_KT, _VT]):
    """An instrumented version of the built-in dict."""


__canned_instrumentation: util.immutabledict[
    Any, _CollectionFactoryType
] = util.immutabledict(
    {
        list: InstrumentedList,
        set: InstrumentedSet,
        dict: InstrumentedDict,
    }
)

__interfaces: util.immutabledict[
    Any,
    Tuple[
        Dict[str, str],
        Dict[str, Callable[..., Any]],
    ],
] = util.immutabledict(
    {
        list: (
            {
                "appender": "append",
                "remover": "remove",
                "iterator": "__iter__",
            },
            _list_decorators(),
        ),
        set: (
            {"appender": "add", "remover": "remove", "iterator": "__iter__"},
            _set_decorators(),
        ),
        # decorators are required for dicts and object collections.
        dict: ({"iterator": "values"}, _dict_decorators()),
    }
)


def __go(lcls):
    global keyfunc_mapping, mapped_collection
    global column_keyed_dict, column_mapped_collection
    global MappedCollection, KeyFuncDict
    global attribute_keyed_dict, attribute_mapped_collection

    from .mapped_collection import keyfunc_mapping
    from .mapped_collection import column_keyed_dict
    from .mapped_collection import attribute_keyed_dict
    from .mapped_collection import KeyFuncDict

    from .mapped_collection import mapped_collection
    from .mapped_collection import column_mapped_collection
    from .mapped_collection import attribute_mapped_collection
    from .mapped_collection import MappedCollection

    # ensure instrumentation is associated with
    # these built-in classes; if a user-defined class
    # subclasses these and uses @internally_instrumented,
    # the superclass is otherwise not instrumented.
    # see [ticket:2406].
    _instrument_class(InstrumentedList)
    _instrument_class(InstrumentedSet)
    _instrument_class(KeyFuncDict)


__go(locals())
