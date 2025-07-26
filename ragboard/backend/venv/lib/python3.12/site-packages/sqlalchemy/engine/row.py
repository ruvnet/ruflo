# engine/row.py
# Copyright (C) 2005-2024 the SQLAlchemy authors and contributors
# <see AUTHORS file>
#
# This module is part of SQLAlchemy and is released under
# the MIT License: https://www.opensource.org/licenses/mit-license.php

"""Define row constructs including :class:`.Row`."""

from __future__ import annotations

from abc import ABC
import collections.abc as collections_abc
import operator
import typing
from typing import Any
from typing import Callable
from typing import Dict
from typing import Generic
from typing import Iterator
from typing import List
from typing import Mapping
from typing import NoReturn
from typing import Optional
from typing import overload
from typing import Sequence
from typing import Tuple
from typing import TYPE_CHECKING
from typing import TypeVar
from typing import Union

from ..sql import util as sql_util
from ..util import deprecated
from ..util._has_cy import HAS_CYEXTENSION

if TYPE_CHECKING or not HAS_CYEXTENSION:
    from ._py_row import BaseRow as BaseRow
else:
    from sqlalchemy.cyextension.resultproxy import BaseRow as BaseRow

if TYPE_CHECKING:
    from .result import _KeyType
    from .result import _ProcessorsType
    from .result import RMKeyView

_T = TypeVar("_T", bound=Any)
_TP = TypeVar("_TP", bound=Tuple[Any, ...])


class Row(BaseRow, Sequence[Any], Generic[_TP]):
    """Represent a single result row.

    The :class:`.Row` object represents a row of a database result.  It is
    typically associated in the 1.x series of SQLAlchemy with the
    :class:`_engine.CursorResult` object, however is also used by the ORM for
    tuple-like results as of SQLAlchemy 1.4.

    The :class:`.Row` object seeks to act as much like a Python named
    tuple as possible.   For mapping (i.e. dictionary) behavior on a row,
    such as testing for containment of keys, refer to the :attr:`.Row._mapping`
    attribute.

    .. seealso::

        :ref:`tutorial_selecting_data` - includes examples of selecting
        rows from SELECT statements.

    .. versionchanged:: 1.4

        Renamed ``RowProxy`` to :class:`.Row`. :class:`.Row` is no longer a
        "proxy" object in that it contains the final form of data within it,
        and now acts mostly like a named tuple. Mapping-like functionality is
        moved to the :attr:`.Row._mapping` attribute. See
        :ref:`change_4710_core` for background on this change.

    """

    __slots__ = ()

    def __setattr__(self, name: str, value: Any) -> NoReturn:
        raise AttributeError("can't set attribute")

    def __delattr__(self, name: str) -> NoReturn:
        raise AttributeError("can't delete attribute")

    def _tuple(self) -> _TP:
        """Return a 'tuple' form of this :class:`.Row`.

        At runtime, this method returns "self"; the :class:`.Row` object is
        already a named tuple. However, at the typing level, if this
        :class:`.Row` is typed, the "tuple" return type will be a :pep:`484`
        ``Tuple`` datatype that contains typing information about individual
        elements, supporting typed unpacking and attribute access.

        .. versionadded:: 2.0.19 - The :meth:`.Row._tuple` method supersedes
           the previous :meth:`.Row.tuple` method, which is now underscored
           to avoid name conflicts with column names in the same way as other
           named-tuple methods on :class:`.Row`.

        .. seealso::

            :attr:`.Row._t` - shorthand attribute notation

            :meth:`.Result.tuples`


        """
        return self  # type: ignore

    @deprecated(
        "2.0.19",
        "The :meth:`.Row.tuple` method is deprecated in favor of "
        ":meth:`.Row._tuple`; all :class:`.Row` "
        "methods and library-level attributes are intended to be underscored "
        "to avoid name conflicts.  Please use :meth:`Row._tuple`.",
    )
    def tuple(self) -> _TP:
        """Return a 'tuple' form of this :class:`.Row`.

        .. versionadded:: 2.0

        """
        return self._tuple()

    @property
    def _t(self) -> _TP:
        """A synonym for :meth:`.Row._tuple`.

        .. versionadded:: 2.0.19 - The :attr:`.Row._t` attribute supersedes
           the previous :attr:`.Row.t` attribute, which is now underscored
           to avoid name conflicts with column names in the same way as other
           named-tuple methods on :class:`.Row`.

        .. seealso::

            :attr:`.Result.t`
        """
        return self  # type: ignore

    @property
    @deprecated(
        "2.0.19",
        "The :attr:`.Row.t` attribute is deprecated in favor of "
        ":attr:`.Row._t`; all :class:`.Row` "
        "methods and library-level attributes are intended to be underscored "
        "to avoid name conflicts.  Please use :attr:`Row._t`.",
    )
    def t(self) -> _TP:
        """A synonym for :meth:`.Row._tuple`.

        .. versionadded:: 2.0

        """
        return self._t

    @property
    def _mapping(self) -> RowMapping:
        """Return a :class:`.RowMapping` for this :class:`.Row`.

        This object provides a consistent Python mapping (i.e. dictionary)
        interface for the data contained within the row.   The :class:`.Row`
        by itself behaves like a named tuple.

        .. seealso::

            :attr:`.Row._fields`

        .. versionadded:: 1.4

        """
        return RowMapping(self._parent, None, self._key_to_index, self._data)

    def _filter_on_values(
        self, processor: Optional[_ProcessorsType]
    ) -> Row[Any]:
        return Row(self._parent, processor, self._key_to_index, self._data)

    if not TYPE_CHECKING:

        def _special_name_accessor(name: str) -> Any:
            """Handle ambiguous names such as "count" and "index" """

            @property
            def go(self: Row) -> Any:
                if self._parent._has_key(name):
                    return self.__getattr__(name)
                else:

                    def meth(*arg: Any, **kw: Any) -> Any:
                        return getattr(collections_abc.Sequence, name)(
                            self, *arg, **kw
                        )

                    return meth

            return go

        count = _special_name_accessor("count")
        index = _special_name_accessor("index")

    def __contains__(self, key: Any) -> bool:
        return key in self._data

    def _op(self, other: Any, op: Callable[[Any, Any], bool]) -> bool:
        return (
            op(self._to_tuple_instance(), other._to_tuple_instance())
            if isinstance(other, Row)
            else op(self._to_tuple_instance(), other)
        )

    __hash__ = BaseRow.__hash__

    if TYPE_CHECKING:

        @overload
        def __getitem__(self, index: int) -> Any:
            ...

        @overload
        def __getitem__(self, index: slice) -> Sequence[Any]:
            ...

        def __getitem__(self, index: Union[int, slice]) -> Any:
            ...

    def __lt__(self, other: Any) -> bool:
        return self._op(other, operator.lt)

    def __le__(self, other: Any) -> bool:
        return self._op(other, operator.le)

    def __ge__(self, other: Any) -> bool:
        return self._op(other, operator.ge)

    def __gt__(self, other: Any) -> bool:
        return self._op(other, operator.gt)

    def __eq__(self, other: Any) -> bool:
        return self._op(other, operator.eq)

    def __ne__(self, other: Any) -> bool:
        return self._op(other, operator.ne)

    def __repr__(self) -> str:
        return repr(sql_util._repr_row(self))

    @property
    def _fields(self) -> Tuple[str, ...]:
        """Return a tuple of string keys as represented by this
        :class:`.Row`.

        The keys can represent the labels of the columns returned by a core
        statement or the names of the orm classes returned by an orm
        execution.

        This attribute is analogous to the Python named tuple ``._fields``
        attribute.

        .. versionadded:: 1.4

        .. seealso::

            :attr:`.Row._mapping`

        """
        return tuple([k for k in self._parent.keys if k is not None])

    def _asdict(self) -> Dict[str, Any]:
        """Return a new dict which maps field names to their corresponding
        values.

        This method is analogous to the Python named tuple ``._asdict()``
        method, and works by applying the ``dict()`` constructor to the
        :attr:`.Row._mapping` attribute.

        .. versionadded:: 1.4

        .. seealso::

            :attr:`.Row._mapping`

        """
        return dict(self._mapping)


BaseRowProxy = BaseRow
RowProxy = Row


class ROMappingView(ABC):
    __slots__ = ()

    _items: Sequence[Any]
    _mapping: Mapping["_KeyType", Any]

    def __init__(
        self, mapping: Mapping["_KeyType", Any], items: Sequence[Any]
    ):
        self._mapping = mapping  # type: ignore[misc]
        self._items = items  # type: ignore[misc]

    def __len__(self) -> int:
        return len(self._items)

    def __repr__(self) -> str:
        return "{0.__class__.__name__}({0._mapping!r})".format(self)

    def __iter__(self) -> Iterator[Any]:
        return iter(self._items)

    def __contains__(self, item: Any) -> bool:
        return item in self._items

    def __eq__(self, other: Any) -> bool:
        return list(other) == list(self)

    def __ne__(self, other: Any) -> bool:
        return list(other) != list(self)


class ROMappingKeysValuesView(
    ROMappingView, typing.KeysView["_KeyType"], typing.ValuesView[Any]
):
    __slots__ = ("_items",)  # mapping slot is provided by KeysView


class ROMappingItemsView(ROMappingView, typing.ItemsView["_KeyType", Any]):
    __slots__ = ("_items",)  # mapping slot is provided by ItemsView


class RowMapping(BaseRow, typing.Mapping["_KeyType", Any]):
    """A ``Mapping`` that maps column names and objects to :class:`.Row`
    values.

    The :class:`.RowMapping` is available from a :class:`.Row` via the
    :attr:`.Row._mapping` attribute, as well as from the iterable interface
    provided by the :class:`.MappingResult` object returned by the
    :meth:`_engine.Result.mappings` method.

    :class:`.RowMapping` supplies Python mapping (i.e. dictionary) access to
    the  contents of the row.   This includes support for testing of
    containment of specific keys (string column names or objects), as well
    as iteration of keys, values, and items::

        for row in result:
            if 'a' in row._mapping:
                print("Column 'a': %s" % row._mapping['a'])

            print("Column b: %s" % row._mapping[table.c.b])


    .. versionadded:: 1.4 The :class:`.RowMapping` object replaces the
       mapping-like access previously provided by a database result row,
       which now seeks to behave mostly like a named tuple.

    """

    __slots__ = ()

    if TYPE_CHECKING:

        def __getitem__(self, key: _KeyType) -> Any:
            ...

    else:
        __getitem__ = BaseRow._get_by_key_impl_mapping

    def _values_impl(self) -> List[Any]:
        return list(self._data)

    def __iter__(self) -> Iterator[str]:
        return (k for k in self._parent.keys if k is not None)

    def __len__(self) -> int:
        return len(self._data)

    def __contains__(self, key: object) -> bool:
        return self._parent._has_key(key)

    def __repr__(self) -> str:
        return repr(dict(self))

    def items(self) -> ROMappingItemsView:
        """Return a view of key/value tuples for the elements in the
        underlying :class:`.Row`.

        """
        return ROMappingItemsView(
            self, [(key, self[key]) for key in self.keys()]
        )

    def keys(self) -> RMKeyView:
        """Return a view of 'keys' for string column names represented
        by the underlying :class:`.Row`.

        """

        return self._parent.keys

    def values(self) -> ROMappingKeysValuesView:
        """Return a view of values for the values represented in the
        underlying :class:`.Row`.

        """
        return ROMappingKeysValuesView(self, self._values_impl())
