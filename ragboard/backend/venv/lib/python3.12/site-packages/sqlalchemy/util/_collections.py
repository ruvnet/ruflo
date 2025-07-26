# util/_collections.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php
# mypy: allow-untyped-defs, allow-untyped-calls

"""Collection classes and helpers."""
from __future__ import annotations

import operator
import threading
import types
import typing
from typing import Any
from typing import Callable
from typing import cast
from typing import Dict
from typing import FrozenSet
from typing import Generic
from typing import Iterable
from typing import Iterator
from typing import List
from typing import Mapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Set
from typing import Tuple
from typing import TypeVar
from typing import Union
from typing import ValuesView
import weakref

from ._has_cy import HAS_CYEXTENSION
from .typing import is_non_string_iterable
from .typing import Literal
from .typing import Protocol

if typing.TYPE_CHECKING or not HAS_CYEXTENSION:
    from ._py_collections import immutabledict as immutabledict
    from ._py_collections import IdentitySet as IdentitySet
    from ._py_collections import ReadOnlyContainer as ReadOnlyContainer
    from ._py_collections import ImmutableDictBase as ImmutableDictBase
    from ._py_collections import OrderedSet as OrderedSet
    from ._py_collections import unique_list as unique_list
else:
    from sqlalchemy.cyextension.immutabledict import (
        ReadOnlyContainer as ReadOnlyContainer,
    )
    from sqlalchemy.cyextension.immutabledict import (
        ImmutableDictBase as ImmutableDictBase,
    )
    from sqlalchemy.cyextension.immutabledict import (
        immutabledict as immutabledict,
    )
    from sqlalchemy.cyextension.collections import IdentitySet as IdentitySet
    from sqlalchemy.cyextension.collections import OrderedSet as OrderedSet
    from sqlalchemy.cyextension.collections import (  # noqa
        unique_list as unique_list,
    )


_T = TypeVar("_T", bound=Any)
_KT = TypeVar("_KT", bound=Any)
_VT = TypeVar("_VT", bound=Any)
_T_co = TypeVar("_T_co", covariant=True)

EMPTY_SET: FrozenSet[Any] = frozenset()
NONE_SET: FrozenSet[Any] = frozenset([None])


def merge_lists_w_ordering(a: List[Any], b: List[Any]) -> List[Any]:
    """merge two lists, maintaining ordering as much as possible.

    this is to reconcile vars(cls) with cls.__annotations__.

    Example::

        >>> a = ['__tablename__', 'id', 'x', 'created_at']
        >>> b = ['id', 'name', 'data', 'y', 'created_at']
        >>> merge_lists_w_ordering(a, b)
        ['__tablename__', 'id', 'name', 'data', 'y', 'x', 'created_at']

    This is not necessarily the ordering that things had on the class,
    in this case the class is::

        class User(Base):
            __tablename__ = "users"

            id: Mapped[int] = mapped_column(primary_key=True)
            name: Mapped[str]
            data: Mapped[Optional[str]]
            x = Column(Integer)
            y: Mapped[int]
            created_at: Mapped[datetime.datetime] = mapped_column()

    But things are *mostly* ordered.

    The algorithm could also be done by creating a partial ordering for
    all items in both lists and then using topological_sort(), but that
    is too much overhead.

    Background on how I came up with this is at:
    https://gist.github.com/zzzeek/89de958cf0803d148e74861bd682ebae

    """
    overlap = set(a).intersection(b)

    result = []

    current, other = iter(a), iter(b)

    while True:
        for element in current:
            if element in overlap:
                overlap.discard(element)
                other, current = current, other
                break

            result.append(element)
        else:
            result.extend(other)
            break

    return result


def coerce_to_immutabledict(d: Mapping[_KT, _VT]) -> immutabledict[_KT, _VT]:
    if not d:
        return EMPTY_DICT
    elif isinstance(d, immutabledict):
        return d
    else:
        return immutabledict(d)


EMPTY_DICT: immutabledict[Any, Any] = immutabledict()


class FacadeDict(ImmutableDictBase[_KT, _VT]):
    """A dictionary that is not publicly mutable."""

    def __new__(cls, *args: Any) -> FacadeDict[Any, Any]:
        new = ImmutableDictBase.__new__(cls)
        return new

    def copy(self) -> NoReturn:
        raise NotImplementedError(
            "an immutabledict shouldn't need to be copied.  use dict(d) "
            "if you need a mutable dictionary."
        )

    def __reduce__(self) -> Any:
        return FacadeDict, (dict(self),)

    def _insert_item(self, key: _KT, value: _VT) -> None:
        """insert an item into the dictionary directly."""
        dict.__setitem__(self, key, value)

    def __repr__(self) -> str:
        return "FacadeDict(%s)" % dict.__repr__(self)


_DT = TypeVar("_DT", bound=Any)

_F = TypeVar("_F", bound=Any)


class Properties(Generic[_T]):
    """Provide a __getattr__/__setattr__ interface over a dict."""

    __slots__ = ("_data",)

    _data: Dict[str, _T]

    def __init__(self, data: Dict[str, _T]):
        object.__setattr__(self, "_data", data)

    def __len__(self) -> int:
        return len(self._data)

    def __iter__(self) -> Iterator[_T]:
        return iter(list(self._data.values()))

    def __dir__(self) -> List[str]:
        return dir(super()) + [str(k) for k in self._data.keys()]

    def __add__(self, other: Properties[_F]) -> List[Union[_T, _F]]:
        return list(self) + list(other)

    def __setitem__(self, key: str, obj: _T) -> None:
        self._data[key] = obj

    def __getitem__(self, key: str) -> _T:
        return self._data[key]

    def __delitem__(self, key: str) -> None:
        del self._data[key]

    def __setattr__(self, key: str, obj: _T) -> None:
        self._data[key] = obj

    def __getstate__(self) -> Dict[str, Any]:
        return {"_data": self._data}

    def __setstate__(self, state: Dict[str, Any]) -> None:
        object.__setattr__(self, "_data", state["_data"])

    def __getattr__(self, key: str) -> _T:
        try:
            return self._data[key]
        except KeyError:
            raise AttributeError(key)

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def as_readonly(self) -> ReadOnlyProperties[_T]:
        """Return an immutable proxy for this :class:`.Properties`."""

        return ReadOnlyProperties(self._data)

    def update(self, value: Dict[str, _T]) -> None:
        self._data.update(value)

    @overload
    def get(self, key: str) -> Optional[_T]:
        ...

    @overload
    def get(self, key: str, default: Union[_DT, _T]) -> Union[_DT, _T]:
        ...

    def get(
        self, key: str, default: Optional[Union[_DT, _T]] = None
    ) -> Optional[Union[_T, _DT]]:
        if key in self:
            return self[key]
        else:
            return default

    def keys(self) -> List[str]:
        return list(self._data)

    def values(self) -> List[_T]:
        return list(self._data.values())

    def items(self) -> List[Tuple[str, _T]]:
        return list(self._data.items())

    def has_key(self, key: str) -> bool:
        return key in self._data

    def clear(self) -> None:
        self._data.clear()


class OrderedProperties(Properties[_T]):
    """Provide a __getattr__/__setattr__ interface with an OrderedDict
    as backing store."""

    __slots__ = ()

    def __init__(self):
        Properties.__init__(self, OrderedDict())


class ReadOnlyProperties(ReadOnlyContainer, Properties[_T]):
    """Provide immutable dict/object attribute to an underlying dictionary."""

    __slots__ = ()


def _ordered_dictionary_sort(d, key=None):
    """Sort an OrderedDict in-place."""

    items = [(k, d[k]) for k in sorted(d, key=key)]

    d.clear()

    d.update(items)


OrderedDict = dict
sort_dictionary = _ordered_dictionary_sort


class WeakSequence(Sequence[_T]):
    def __init__(self, __elements: Sequence[_T] = ()):
        # adapted from weakref.WeakKeyDictionary, prevent reference
        # cycles in the collection itself
        def _remove(item, selfref=weakref.ref(self)):
            self = selfref()
            if self is not None:
                self._storage.remove(item)

        self._remove = _remove
        self._storage = [
            weakref.ref(element, _remove) for element in __elements
        ]

    def append(self, item):
        self._storage.append(weakref.ref(item, self._remove))

    def __len__(self):
        return len(self._storage)

    def __iter__(self):
        return (
            obj for obj in (ref() for ref in self._storage) if obj is not None
        )

    def __getitem__(self, index):
        try:
            obj = self._storage[index]
        except KeyError:
            raise IndexError("Index %s out of range" % index)
        else:
            return obj()


class OrderedIdentitySet(IdentitySet):
    def __init__(self, iterable: Optional[Iterable[Any]] = None):
        IdentitySet.__init__(self)
        self._members = OrderedDict()
        if iterable:
            for o in iterable:
                self.add(o)


class PopulateDict(Dict[_KT, _VT]):
    """A dict which populates missing values via a creation function.

    Note the creation function takes a key, unlike
    collections.defaultdict.

    """

    def __init__(self, creator: Callable[[_KT], _VT]):
        self.creator = creator

    def __missing__(self, key: Any) -> Any:
        self[key] = val = self.creator(key)
        return val


class WeakPopulateDict(Dict[_KT, _VT]):
    """Like PopulateDict, but assumes a self + a method and does not create
    a reference cycle.

    """

    def __init__(self, creator_method: types.MethodType):
        self.creator = creator_method.__func__
        weakself = creator_method.__self__
        self.weakself = weakref.ref(weakself)

    def __missing__(self, key: Any) -> Any:
        self[key] = val = self.creator(self.weakself(), key)
        return val


# Define collections that are capable of storing
# ColumnElement objects as hashable keys/elements.
# At this point, these are mostly historical, things
# used to be more complicated.
column_set = set
column_dict = dict
ordered_column_set = OrderedSet


class UniqueAppender(Generic[_T]):
    """Appends items to a collection ensuring uniqueness.

    Additional appends() of the same object are ignored.  Membership is
    determined by identity (``is a``) not equality (``==``).
    """

    __slots__ = "data", "_data_appender", "_unique"

    data: Union[Iterable[_T], Set[_T], List[_T]]
    _data_appender: Callable[[_T], None]
    _unique: Dict[int, Literal[True]]

    def __init__(
        self,
        data: Union[Iterable[_T], Set[_T], List[_T]],
        via: Optional[str] = None,
    ):
        self.data = data
        self._unique = {}
        if via:
            self._data_appender = getattr(data, via)
        elif hasattr(data, "append"):
            self._data_appender = cast("List[_T]", data).append
        elif hasattr(data, "add"):
            self._data_appender = cast("Set[_T]", data).add

    def append(self, item: _T) -> None:
        id_ = id(item)
        if id_ not in self._unique:
            self._data_appender(item)
            self._unique[id_] = True

    def __iter__(self) -> Iterator[_T]:
        return iter(self.data)


def coerce_generator_arg(arg: Any) -> List[Any]:
    if len(arg) == 1 and isinstance(arg[0], types.GeneratorType):
        return list(arg[0])
    else:
        return cast("List[Any]", arg)


def to_list(x: Any, default: Optional[List[Any]] = None) -> List[Any]:
    if x is None:
        return default  # type: ignore
    if not is_non_string_iterable(x):
        return [x]
    elif isinstance(x, list):
        return x
    else:
        return list(x)


def has_intersection(set_, iterable):
    r"""return True if any items of set\_ are present in iterable.

    Goes through special effort to ensure __hash__ is not called
    on items in iterable that don't support it.

    """
    # TODO: optimize, write in C, etc.
    return bool(set_.intersection([i for i in iterable if i.__hash__]))


def to_set(x):
    if x is None:
        return set()
    if not isinstance(x, set):
        return set(to_list(x))
    else:
        return x


def to_column_set(x: Any) -> Set[Any]:
    if x is None:
        return column_set()
    if not isinstance(x, column_set):
        return column_set(to_list(x))
    else:
        return x


def update_copy(d, _new=None, **kw):
    """Copy the given dict and update with the given values."""

    d = d.copy()
    if _new:
        d.update(_new)
    d.update(**kw)
    return d


def flatten_iterator(x: Iterable[_T]) -> Iterator[_T]:
    """Given an iterator of which further sub-elements may also be
    iterators, flatten the sub-elements into a single iterator.

    """
    elem: _T
    for elem in x:
        if not isinstance(elem, str) and hasattr(elem, "__iter__"):
            yield from flatten_iterator(elem)
        else:
            yield elem


class LRUCache(typing.MutableMapping[_KT, _VT]):
    """Dictionary with 'squishy' removal of least
    recently used items.

    Note that either get() or [] should be used here, but
    generally its not safe to do an "in" check first as the dictionary
    can change subsequent to that call.

    """

    __slots__ = (
        "capacity",
        "threshold",
        "size_alert",
        "_data",
        "_counter",
        "_mutex",
    )

    capacity: int
    threshold: float
    size_alert: Optional[Callable[[LRUCache[_KT, _VT]], None]]

    def __init__(
        self,
        capacity: int = 100,
        threshold: float = 0.5,
        size_alert: Optional[Callable[..., None]] = None,
    ):
        self.capacity = capacity
        self.threshold = threshold
        self.size_alert = size_alert
        self._counter = 0
        self._mutex = threading.Lock()
        self._data: Dict[_KT, Tuple[_KT, _VT, List[int]]] = {}

    def _inc_counter(self):
        self._counter += 1
        return self._counter

    @overload
    def get(self, key: _KT) -> Optional[_VT]:
        ...

    @overload
    def get(self, key: _KT, default: Union[_VT, _T]) -> Union[_VT, _T]:
        ...

    def get(
        self, key: _KT, default: Optional[Union[_VT, _T]] = None
    ) -> Optional[Union[_VT, _T]]:
        item = self._data.get(key)
        if item is not None:
            item[2][0] = self._inc_counter()
            return item[1]
        else:
            return default

    def __getitem__(self, key: _KT) -> _VT:
        item = self._data[key]
        item[2][0] = self._inc_counter()
        return item[1]

    def __iter__(self) -> Iterator[_KT]:
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def values(self) -> ValuesView[_VT]:
        return typing.ValuesView({k: i[1] for k, i in self._data.items()})

    def __setitem__(self, key: _KT, value: _VT) -> None:
        self._data[key] = (key, value, [self._inc_counter()])
        self._manage_size()

    def __delitem__(self, __v: _KT) -> None:
        del self._data[__v]

    @property
    def size_threshold(self) -> float:
        return self.capacity + self.capacity * self.threshold

    def _manage_size(self) -> None:
        if not self._mutex.acquire(False):
            return
        try:
            size_alert = bool(self.size_alert)
            while len(self) > self.capacity + self.capacity * self.threshold:
                if size_alert:
                    size_alert = False
                    self.size_alert(self)  # type: ignore
                by_counter = sorted(
                    self._data.values(),
                    key=operator.itemgetter(2),
                    reverse=True,
                )
                for item in by_counter[self.capacity :]:
                    try:
                        del self._data[item[0]]
                    except KeyError:
                        # deleted elsewhere; skip
                        continue
        finally:
            self._mutex.release()


class _CreateFuncType(Protocol[_T_co]):
    def __call__(self) -> _T_co:
        ...


class _ScopeFuncType(Protocol):
    def __call__(self) -> Any:
        ...


class ScopedRegistry(Generic[_T]):
    """A Registry that can store one or multiple instances of a single
    class on the basis of a "scope" function.

    The object implements ``__call__`` as the "getter", so by
    calling ``myregistry()`` the contained object is returned
    for the current scope.

    :param createfunc:
      a callable that returns a new object to be placed in the registry

    :param scopefunc:
      a callable that will return a key to store/retrieve an object.
    """

    __slots__ = "createfunc", "scopefunc", "registry"

    createfunc: _CreateFuncType[_T]
    scopefunc: _ScopeFuncType
    registry: Any

    def __init__(
        self, createfunc: Callable[[], _T], scopefunc: Callable[[], Any]
    ):
        """Construct a new :class:`.ScopedRegistry`.

        :param createfunc:  A creation function that will generate
          a new value for the current scope, if none is present.

        :param scopefunc:  A function that returns a hashable
          token representing the current scope (such as, current
          thread identifier).

        """
        self.createfunc = createfunc
        self.scopefunc = scopefunc
        self.registry = {}

    def __call__(self) -> _T:
        key = self.scopefunc()
        try:
            return self.registry[key]  # type: ignore[no-any-return]
        except KeyError:
            return self.registry.setdefault(key, self.createfunc())  # type: ignore[no-any-return] # noqa: E501

    def has(self) -> bool:
        """Return True if an object is present in the current scope."""

        return self.scopefunc() in self.registry

    def set(self, obj: _T) -> None:
        """Set the value for the current scope."""

        self.registry[self.scopefunc()] = obj

    def clear(self) -> None:
        """Clear the current scope, if any."""

        try:
            del self.registry[self.scopefunc()]
        except KeyError:
            pass


class ThreadLocalRegistry(ScopedRegistry[_T]):
    """A :class:`.ScopedRegistry` that uses a ``threading.local()``
    variable for storage.

    """

    def __init__(self, createfunc: Callable[[], _T]):
        self.createfunc = createfunc
        self.registry = threading.local()

    def __call__(self) -> _T:
        try:
            return self.registry.value  # type: ignore[no-any-return]
        except AttributeError:
            val = self.registry.value = self.createfunc()
            return val

    def has(self) -> bool:
        return hasattr(self.registry, "value")

    def set(self, obj: _T) -> None:
        self.registry.value = obj

    def clear(self) -> None:
        try:
            del self.registry.value
        except AttributeError:
            pass


def has_dupes(sequence, target):
    """Given a sequence and search object, return True if there's more
    than one, False if zero or one of them.


    """
    # compare to .index version below, this version introduces less function
    # overhead and is usually the same speed.  At 15000 items (way bigger than
    # a relationship-bound collection in memory usually is) it begins to
    # fall behind the other version only by microseconds.
    c = 0
    for item in sequence:
        if item is target:
            c += 1
            if c > 1:
                return True
    return False


# .index version.  the two __contains__ calls as well
# as .index() and isinstance() slow this down.
# def has_dupes(sequence, target):
#    if target not in sequence:
#        return False
#    elif not isinstance(sequence, collections_abc.Sequence):
#        return False
#
#    idx = sequence.index(target)
#    return target in sequence[idx + 1:]
